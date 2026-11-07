import { expect, test } from "bun:test";
import {
	adminPubkey,
	apiBase,
	bookingId,
	familyId,
	membershipId,
	schoolId,
} from "./helpers.ts";
import { isLedgerRoute, ledgerRoutesSourceCommit } from "./ledger-routes.ts";
import {
	adjustAnswer,
	billingStateAnswer,
	bookingRow,
	bookingsAnswer,
	cancelAnswer,
	capabilitiesAnswer,
	financeGrantsAnswer,
	grantAnswer,
	invoiceAnswer,
	keyCreateAnswer,
	memberRow,
	membersAnswer,
	menu,
	okAnswer,
	outcomeAnswer,
	pinVerifiedAnswer,
	refundAnswer,
	schoolFactsAnswer,
	versionBodyAnswer,
	versionsAnswer,
} from "./recorded.ts";
import { adapters } from "./setup.ts";

/** Every Reader and Writer call, made once against recorded answers: every path they send to api.b4uni.com must be
 * one of buzz-school's LEDGER_ROUTES (the copy in ledger-routes.ts). */
test(`every api.b4uni.com path the adapters call is in LEDGER_ROUTES (buzz-school ${ledgerRoutesSourceCommit.slice(0, 9)})`, async () => {
	const { reader, writer, http } = adapters({ worker: "fetch" });
	const answers: Array<[string, RegExp, unknown]> = [
		["GET", /ledger\/school$/, schoolFactsAnswer],
		["GET", /ledger\/capabilities$/, capabilitiesAnswer],
		["GET", /members-list$/, membersAnswer([memberRow()])],
		["GET", /versions$/, versionsAnswer],
		["GET", /versions\/[0-9]+$/, versionBodyAnswer],
		["GET", /bookings$/, bookingsAnswer([bookingRow()])],
		["GET", /finance-grants$/, financeGrantsAnswer],
		["POST", /\/outcome$/, outcomeAnswer],
		["POST", /\/cancel$/, cancelAnswer],
		["POST", /finance-grants(\/remove)?$/, grantAnswer],
		["POST", /billing\/refunds$/, refundAnswer],
		["POST", /credits\/adjust$/, adjustAnswer],
		["POST", /billing\/invoices$/, invoiceAnswer],
		[
			"POST",
			/billing\/(menu|menu\/publish|stripe-key|stripe-key\/remove)$/,
			billingStateAnswer,
		],
		["POST", /key-create$/, keyCreateAnswer],
		["POST", /key-revoke$/, okAnswer],
		["POST", /pin\/verify$/, pinVerifiedAnswer],
	];
	for (const [method, path, body] of answers)
		http.always(method, path, { status: 200, body });
	http.always("GET", /^\/v1\//, {
		status: 501,
		body: { error: { code: "not_available", message: "sweep" } },
	});

	const calls: Array<() => Promise<unknown>> = [
		() => reader.schools(),
		() =>
			reader.bookings({
				school: schoolId,
				from: "2026-11-01",
				to: "2026-11-30",
			}),
		() => reader.menuVersions(schoolId),
		() => reader.menuVersion(schoolId, 2),
		() => reader.members({ schoolId }),
		() => reader.capabilities({ schoolId }),
		() => reader.financeGrants({ schoolId }),
		() => reader.invoiceItems({ schoolId }),
		() => reader.switchTiers({ schoolId }),
		() =>
			reader.ledger({
				school: schoolId,
				from: "2026-11-01",
				to: "2026-11-07",
				type: null,
				drill: null,
				promo: null,
			}),
		() => writer.recordOutcome({ schoolId, bookingId, state: "attended" }),
		() =>
			writer.cancelBooking({
				school: schoolId,
				bookingId,
				reason: "admin_release",
			}),
		() => writer.saveMenu(schoolId, menu as never),
		() => writer.publishMenu(schoolId),
		() =>
			writer.refund({
				schoolId,
				paymentIntentId: "pi_1A2b3C4d5E",
				amountCents: 1,
				reason: "requested_by_customer",
				note: "abc",
			}),
		() =>
			writer.adjustCredits({
				schoolId,
				membershipId,
				featureId: "sessions",
				amount: 1,
				kind: "gift",
				note: "abc",
			}),
		() => writer.sendInvoice({ schoolId, familyId, addonId: "pack8" }),
		() => writer.grantFinance({ schoolId, subject: adminPubkey }),
		() => writer.revokeFinance({ schoolId, subject: adminPubkey }),
		() => writer.createKey({ school: schoolId, kind: "sk", label: "Server" }),
		() => writer.revokeKey({ school: schoolId, keyId: "k1" }),
		() =>
			writer.saveStripeKey({
				school: schoolId,
				restrictedKey: ["rk", "live", "Z".repeat(24)].join("_"),
				pin: "1357",
			}),
		() => writer.removeStripeKey({ school: schoolId, pin: "1357" }),
	];
	for (const call of calls) await call().catch(() => undefined);

	const apiPaths = http.calls
		.filter(({ url }) => url.startsWith(apiBase))
		.map(({ url }) => new URL(url).pathname);
	expect(apiPaths.filter((path) => !isLedgerRoute(path))).toEqual([]);
	const shapes = [
		...new Set(
			apiPaths.map((path) =>
				path
					.replaceAll(schoolId, "<id>")
					.replaceAll(bookingId, "<booking>")
					.replace(/\/[0-9]+$/, "/<n>"),
			),
		),
	].sort();
	expect(shapes).toEqual([
		"/family/pin/verify",
		"/school-admin/key-create",
		"/school-admin/key-revoke",
		"/school-admin/ledger-token",
		"/school-admin/schools/<id>/billing/credits/adjust",
		"/school-admin/schools/<id>/billing/invoices",
		"/school-admin/schools/<id>/billing/members-list",
		"/school-admin/schools/<id>/billing/menu",
		"/school-admin/schools/<id>/billing/menu/publish",
		"/school-admin/schools/<id>/billing/menu/versions",
		"/school-admin/schools/<id>/billing/menu/versions/<n>",
		"/school-admin/schools/<id>/billing/refunds",
		"/school-admin/schools/<id>/billing/stripe-key",
		"/school-admin/schools/<id>/billing/stripe-key/remove",
		"/school-admin/schools/<id>/bookings",
		"/school-admin/schools/<id>/bookings/<booking>/cancel",
		"/school-admin/schools/<id>/bookings/<booking>/outcome",
		"/school-admin/schools/<id>/finance-grants",
		"/school-admin/schools/<id>/finance-grants/remove",
		"/school-admin/schools/<id>/ledger/capabilities",
		"/school-admin/schools/<id>/ledger/school",
	]);
});

test("the copy refuses a path outside the list", () => {
	expect(isLedgerRoute(`/school-admin/schools/${schoolId}/billing`)).toBe(true);
	expect(isLedgerRoute("/school-admin/people")).toBe(false);
	expect(
		isLedgerRoute(
			`/school-admin/schools/${schoolId}/billing/memberships/x/cancel`,
		),
	).toBe(false);
});
