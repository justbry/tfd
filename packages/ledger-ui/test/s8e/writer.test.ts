import { describe, expect, test } from "bun:test";
import { adminReleaseReason } from "../../src/data/bookings.ts";
import { releaseReason } from "../../src/data/members.ts";
import { AdapterError } from "../../src/http/errors.ts";
import { pendingStorageKey } from "../../src/http/pending.ts";
import {
	adminPubkey,
	apiBase,
	bookingId,
	familyId,
	membershipId,
	schoolId,
} from "./helpers.ts";
import {
	adjustAnswer,
	billingStateAnswer,
	cancelAnswer,
	grantAnswer,
	invoiceAnswer,
	issuedAt,
	keyBody,
	keyCreateAnswer,
	menu,
	okAnswer,
	outcomeAnswer,
	pinVerifiedAnswer,
	refundAnswer,
	refusal,
	tokenLifetime,
} from "./recorded.ts";
import { adapters, apiCalls } from "./setup.ts";

const school = `/school-admin/schools/${schoolId}`;
const shipsBy = new Date((issuedAt + tokenLifetime) * 1000).toISOString();

const rejection = async (promise: Promise<unknown>): Promise<AdapterError> => {
	try {
		await promise;
	} catch (error) {
		if (error instanceof AdapterError) return error;
		throw error;
	}
	throw new Error("expected a rejection");
};

/** What one write sent: method, path, the CSRF and Idempotency-Key headers, the body. */
const sent = (http: ReturnType<typeof adapters>["http"]) =>
	apiCalls(http).map(({ url, method, headers, body, credentials }) => ({
		method,
		path: url.slice(apiBase.length),
		csrf: headers["x-b4u"],
		key: headers["idempotency-key"],
		credentials,
		body,
	}));

describe("each write: request and mapped answer", () => {
	test("recordOutcome, both tabs' requests, one route", async () => {
		const { writer, http, pending } = adapters();
		http.always("POST", /\/outcome$/, { status: 200, body: outcomeAnswer });
		expect(
			await writer.recordOutcome({
				school: schoolId,
				bookingId,
				state: "attended",
				note: "on time",
			}),
		).toEqual({
			creditEffect: "not_wired",
		});
		expect(
			await writer.recordOutcome({ schoolId, bookingId, state: "no_show" }),
		).toEqual({ creditEffect: "not_wired" });
		expect(sent(http)).toEqual([
			{
				method: "POST",
				path: `${school}/bookings/${bookingId}/outcome`,
				csrf: "1",
				key: "action-0001",
				credentials: "include",
				body: { state: "attended", note: "on time" },
			},
			{
				method: "POST",
				path: `${school}/bookings/${bookingId}/outcome`,
				csrf: "1",
				key: "action-0002",
				credentials: "include",
				body: { state: "no_show" },
			},
		]);
		expect(
			pending.forSchool(schoolId).map(({ state, shipsBy: at }) => [state, at]),
		).toEqual([
			["accepted", shipsBy],
			["accepted", shipsBy],
		]);
	});

	test("cancelBooking: Bookings answers nothing, Members answers accepted", async () => {
		const { writer, http } = adapters();
		http.always("POST", /\/cancel$/, { status: 200, body: cancelAnswer });
		expect(
			await writer.cancelBooking({
				school: schoolId,
				bookingId,
				reason: adminReleaseReason,
			}),
		).toBeUndefined();
		expect(
			await writer.cancelBooking({
				schoolId,
				bookingId,
				reason: releaseReason,
				waiveCutoff: true,
			}),
		).toEqual({ accepted: true });
		expect(sent(http).map(({ path, body }) => [path, body])).toEqual([
			[`${school}/bookings/${bookingId}/cancel`, { reason: "admin_release" }],
			[
				`${school}/bookings/${bookingId}/cancel`,
				{ reason: "Released by an admin", waiveCutoff: true },
			],
		]);
	});

	test("refund, adjustCredits and sendInvoice: the money routes and their answers", async () => {
		const { writer, http } = adapters();
		http.on("POST", /refunds$/, { status: 200, body: refundAnswer });
		http.on("POST", /credits\/adjust$/, { status: 200, body: adjustAnswer });
		http.on("POST", /invoices$/, { status: 200, body: invoiceAnswer });
		expect(
			await writer.refund({
				schoolId,
				paymentIntentId: "pi_1A2b3C4d5E",
				amountCents: 2500,
				reason: "requested_by_customer",
				note: "double charge",
			}),
		).toEqual({
			refundId: "re_1A2b3C4d5E",
			status: "pending",
			refundedCents: 2500,
			remainingCents: 4000,
		});
		expect(
			await writer.adjustCredits({
				schoolId,
				membershipId,
				featureId: "sessions",
				amount: 2,
				kind: "goodwill",
				note: "sorry",
			}),
		).toEqual({ accepted: true });
		expect(
			await writer.sendInvoice({ schoolId, familyId, addonId: "pack8" }),
		).toEqual({ invoiceId: "in_1A2b3C4d5E", status: "open" });
		expect(sent(http).map(({ path, body, key }) => [path, body, key])).toEqual([
			[
				`${school}/billing/refunds`,
				{
					paymentIntentId: "pi_1A2b3C4d5E",
					amountCents: 2500,
					reason: "requested_by_customer",
					note: "double charge",
				},
				"action-0001",
			],
			[
				`${school}/billing/credits/adjust`,
				{
					membershipId,
					featureId: "sessions",
					amount: 2,
					kind: "goodwill",
					note: "sorry",
				},
				"action-0002",
			],
			[
				`${school}/billing/invoices`,
				{ familyId, addonId: "pack8" },
				"action-0003",
			],
		]);
	});

	test("grantFinance and revokeFinance send the pubkey; a profile id is refused before any request", async () => {
		const { writer, http } = adapters();
		http.always("POST", /finance-grants(\/remove)?$/, {
			status: 200,
			body: grantAnswer,
		});
		expect(
			await writer.grantFinance({ schoolId, subject: adminPubkey }),
		).toEqual({ accepted: true });
		expect(
			await writer.revokeFinance({ schoolId, subject: adminPubkey }),
		).toEqual({ accepted: true });
		expect(sent(http).map(({ path, body }) => [path, body])).toEqual([
			[`${school}/finance-grants`, { pubkey: adminPubkey }],
			[`${school}/finance-grants/remove`, { pubkey: adminPubkey }],
		]);
		expect(
			(await rejection(writer.grantFinance({ schoolId, subject: "m_012" })))
				.kind,
		).toBe("schema_mismatch");
		expect(apiCalls(http)).toHaveLength(2);
	});

	test("saveMenu sends buzz-school's Menu (no tier audience); publishMenu opens the PIN first", async () => {
		const { writer, http, pinAsks, pending } = adapters();
		http.always("POST", /billing\/menu(\/publish)?$/, {
			status: 200,
			body: billingStateAnswer,
		});
		http.always("POST", /pin\/verify$/, {
			status: 200,
			body: pinVerifiedAnswer,
		});
		const draft = {
			...menu,
			tiers: menu.tiers.map((tier) => ({
				...tier,
				audience: "governance" as const,
			})),
		} as never;
		await writer.saveMenu(schoolId, draft);
		await writer.publishMenu(schoolId);
		expect(sent(http).map(({ path, body }) => [path, body])).toEqual([
			[`${school}/billing/menu`, menu],
			["/family/pin/verify", { pin: "4821" }],
			[`${school}/billing/menu/publish`, {}],
		]);
		expect(pinAsks).toEqual([{ school: schoolId, purpose: "publishMenu" }]);
		// The menu save is not a ledger event; the publish is (catalog.published).
		expect(pending.forSchool(schoolId).map(({ method }) => method)).toEqual([
			"publishMenu",
		]);
	});

	test("publishMenu with no PIN given rejects pin_required and sends nothing", async () => {
		const { writer, http } = adapters({ pin: null });
		expect((await rejection(writer.publishMenu(schoolId))).kind).toBe(
			"pin_required",
		);
		expect(apiCalls(http)).toEqual([]);
	});

	test("the key and Stripe key writes", async () => {
		const { writer, http, storage } = adapters();
		http.on("POST", /key-create$/, { status: 200, body: keyCreateAnswer });
		http.on("POST", /key-revoke$/, { status: 200, body: okAnswer });
		http.always("POST", /pin\/verify$/, {
			status: 200,
			body: pinVerifiedAnswer,
		});
		http.always("POST", /stripe-key(\/remove)?$/, {
			status: 200,
			body: billingStateAnswer,
		});
		expect(
			await writer.createKey({
				school: schoolId,
				kind: "pk",
				label: "Website",
			}),
		).toEqual({
			kind: "pk",
			key: {
				id: keyCreateAnswer.row.id,
				kind: "pk",
				label: "Website",
				prefix: keyBody.slice(0, 15),
				used: "never",
			},
			secret: keyBody,
		});
		await writer.revokeKey({ school: schoolId, keyId: "k9" });
		const restrictedKey = ["rk", "live", "Z".repeat(24)].join("_");
		await writer.saveStripeKey({
			school: schoolId,
			restrictedKey,
			pin: "1357",
		});
		await writer.removeStripeKey({ school: schoolId, pin: "1357" });
		expect(sent(http).map(({ path, body }) => [path, body])).toEqual([
			[
				"/school-admin/key-create",
				{ school: schoolId, kind: "pk", label: "Website" },
			],
			["/school-admin/key-revoke", { school: schoolId, id: "k9" }],
			["/family/pin/verify", { pin: "1357" }],
			[`${school}/billing/stripe-key`, { restrictedKey }],
			["/family/pin/verify", { pin: "1357" }],
			[`${school}/billing/stripe-key/remove`, {}],
		]);
		// Neither the PIN nor the key is ever kept in storage.
		const stored = storage.getItem(pendingStorageKey) ?? "";
		expect(stored).not.toContain("1357");
		expect(stored).not.toContain(restrictedKey);
	});

	test("download goes to the injected file saver", async () => {
		const { writer, saved, http } = adapters();
		const file = {
			name: "ledger.csv",
			type: "text/csv;charset=utf-8" as const,
			text: "a,b\n",
		};
		await writer.download(file);
		expect(saved).toEqual([file]);
		expect(http.calls).toEqual([]);
	});
});

describe("retries keep the Idempotency-Key of the user action", () => {
	test("a refund that met no answer, asked again, sends the same key", async () => {
		const { writer, http, pending } = adapters();
		http.on("POST", /refunds$/, "network", { status: 200, body: refundAnswer });
		const request = {
			schoolId,
			paymentIntentId: "pi_1A2b3C4d5E",
			amountCents: 2500,
			reason: "requested_by_customer" as const,
			note: "double charge",
		};
		expect((await rejection(writer.refund(request))).kind).toBe("network");
		expect(pending.forSchool(schoolId).map(({ state }) => state)).toEqual([
			"sending",
		]);
		await writer.refund(request);
		const keys = sent(http).map(({ key }) => key);
		expect(keys).toHaveLength(2);
		expect(keys[0]).toBe(keys[1]);
		expect(pending.forSchool(schoolId).map(({ state }) => state)).toEqual([
			"accepted",
		]);
	});

	test("after a reload, the same action finds its key in storage", async () => {
		const first = adapters();
		first.http.on(
			"POST",
			/credits\/adjust$/,
			{ status: 503, body: refusal("school_api_unavailable") },
			{ status: 503, body: refusal("school_api_unavailable") },
			{ status: 503, body: refusal("school_api_unavailable") },
		);
		const request = {
			schoolId,
			membershipId,
			featureId: "sessions",
			amount: 2,
			kind: "goodwill" as const,
			note: "sorry",
		};
		expect((await rejection(first.writer.adjustCredits(request))).kind).toBe(
			"unavailable",
		);
		const firstKey = sent(first.http)[0]?.key;

		const reloaded = adapters({ storage: first.storage });
		reloaded.http.on("POST", /credits\/adjust$/, {
			status: 200,
			body: adjustAnswer,
		});
		await reloaded.writer.adjustCredits(request);
		expect(sent(reloaded.http)[0]?.key).toBe(firstKey);
	});

	test("a closed PIN opens it and sends the write again with the same key", async () => {
		const { writer, http, pinAsks } = adapters();
		http.on(
			"POST",
			/refunds$/,
			{ status: 403, body: refusal("pin_required") },
			{ status: 200, body: refundAnswer },
		);
		http.on("POST", /pin\/verify$/, { status: 200, body: pinVerifiedAnswer });
		await writer.refund({
			schoolId,
			paymentIntentId: "pi_1A2b3C4d5E",
			amountCents: 2500,
			reason: "requested_by_customer",
			note: "double charge",
		});
		const calls = sent(http);
		expect(calls.map(({ path }) => path)).toEqual([
			`${school}/billing/refunds`,
			"/family/pin/verify",
			`${school}/billing/refunds`,
		]);
		expect(calls[0]?.key).toBe(calls[2]?.key as string);
		expect(pinAsks).toEqual([{ school: schoolId, purpose: "refund" }]);
	});

	test("a locked PIN rejects pin_locked and the write is dropped", async () => {
		const { writer, http, pending } = adapters();
		http.on("POST", /refunds$/, { status: 403, body: refusal("pin_required") });
		http.on("POST", /pin\/verify$/, {
			status: 429,
			body: refusal("rate_limited"),
		});
		const error = await rejection(
			writer.refund({
				schoolId,
				paymentIntentId: "pi_1A2b3C4d5E",
				amountCents: 2500,
				reason: "requested_by_customer",
				note: "double charge",
			}),
		);
		expect(error.kind).toBe("pin_locked");
		expect(pending.all()).toEqual([]);
	});

	test("a step-up refusal rejects step_up and the write is dropped (a new action next time)", async () => {
		const { writer, http, pending } = adapters();
		http.on("POST", /invoices$/, {
			status: 403,
			body: refusal("step_up_required"),
		});
		expect(
			(
				await rejection(
					writer.sendInvoice({ schoolId, familyId, addonId: "pack8" }),
				)
			).kind,
		).toBe("step_up");
		expect(pending.all()).toEqual([]);
	});

	test("an answer that does not map still leaves the write accepted: it is never sent again under a new key", async () => {
		const { writer, http, pending } = adapters();
		http.on("POST", /refunds$/, {
			status: 200,
			body: { ...refundAnswer, status: "requires_action" },
		});
		expect(
			(
				await rejection(
					writer.refund({
						schoolId,
						paymentIntentId: "pi_1A2b3C4d5E",
						amountCents: 2500,
						reason: "requested_by_customer",
						note: "x y z",
					}),
				)
			).kind,
		).toBe("schema_mismatch");
		expect(pending.forSchool(schoolId).map(({ state }) => state)).toEqual([
			"accepted",
		]);
	});
});

describe("writes with no route answer not available and send nothing", () => {
	type Built = ReturnType<typeof adapters>["writer"];
	const calls: Array<[string, (writer: Built) => Promise<unknown>]> = [
		[
			"remindHost",
			(writer) => writer.remindHost({ school: schoolId, bookingId }),
		],
		[
			"changeRole",
			(writer) => writer.changeRole({ schoolId, personId: "p", role: "admin" }),
		],
		[
			"switchTier",
			(writer) =>
				writer.switchTier({
					schoolId,
					membershipId,
					tierId: "sparkle",
					quantity: 1,
				}),
		],
		[
			"cancelMembership",
			(writer) =>
				writer.cancelMembership({ schoolId, membershipId, at: "period_end" }),
		],
		[
			"resumeMembership",
			(writer) => writer.resumeMembership({ schoolId, membershipId }),
		],
		[
			"resendReceipt",
			(writer) => writer.resendReceipt({ schoolId, personId: "p" }),
		],
		[
			"createPromo",
			(writer) =>
				writer.createPromo({
					school: schoolId,
					type: "member",
					value: 10,
					expiresOn: "2026-12-31",
				} as never),
		],
		[
			"disablePromo",
			(writer) => writer.disablePromo({ school: schoolId, promoId: "c1" }),
		],
		[
			"portalChangeQuantity",
			(writer) =>
				writer.portalChangeQuantity({
					school: schoolId,
					profileId: "p",
					quantity: 2,
				}),
		],
		[
			"portalCancelMembership",
			(writer) =>
				writer.portalCancelMembership({ school: schoolId, profileId: "p" }),
		],
		[
			"portalResumeMembership",
			(writer) =>
				writer.portalResumeMembership({ school: schoolId, profileId: "p" }),
		],
		[
			"portalCancelBooking",
			(writer) =>
				writer.portalCancelBooking({
					school: schoolId,
					profileId: "p",
					bookingId,
				}),
		],
		[
			"saveAccountingBasis",
			(writer) =>
				writer.saveAccountingBasis({
					school: schoolId,
					basis: "cash",
					from: "2026-11-01",
				}),
		],
		[
			"createKey rd",
			(writer) =>
				writer.createKey({ school: schoolId, kind: "rd", label: "Ledger" }),
		],
		[
			"saveZeffyKey",
			(writer) =>
				writer.saveZeffyKey({ school: schoolId, apiKey: "zeffy-key-1" }),
		],
		[
			"removeZeffyKey",
			(writer) => writer.removeZeffyKey({ school: schoolId, pin: "1357" }),
		],
		[
			"saveDisclosure",
			(writer) =>
				writer.saveDisclosure({ school: schoolId, override: {}, pin: "1357" }),
		],
		[
			"confirmDisclosureStepUp",
			(writer) => writer.confirmDisclosureStepUp({ school: schoolId }),
		],
	];
	for (const [name, call] of calls)
		test(name, async () => {
			const { writer, http } = adapters();
			expect((await rejection(call(writer))).kind).toBe("not_available");
			expect(http.calls).toEqual([]);
		});
});
