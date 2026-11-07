import type { CancelBooking, RecordOutcome } from "../data/bookings.ts";
import type { DownloadFile } from "../data/ledger.ts";
import type {
	Accepted,
	CancelBookingRequest,
	RecordOutcomeRequest,
	RefundResult,
} from "../data/members.ts";
import type { CreatedKey } from "../data/settings.ts";
import type { Writer } from "../data/writer.ts";
import {
	AdapterError,
	isRetryable,
	notAvailable,
	schemaMismatch,
} from "./errors.ts";
import type { LedgerTokenSource } from "./ledger-token.ts";
import type { PendingStore } from "./pending.ts";
import { menuBodyOf, pubkeyOf, routes } from "./school-routes.ts";
import type { ApiClient } from "./transport.ts";
import { isRecord, numberOf, oneOf, recordOf, stringOf } from "./wire.ts";

/**
 * The HTTP Writer (S8e): every `Writer` call that a buzz-school route serves, from the ledger origin with the session
 * cookie, CSRF and an `Idempotency-Key`; the rest reject `not_available` with the gap.
 *
 * - **One key per user action.** The pending store holds the action's key from before the request until the answer;
 *   asking the same action again (after a network failure, a 503 or a reload) sends the same key, and the PIN retry
 *   below does too. A refusal drops it, so a corrected request is a new action.
 * - **Pending until shipped.** A write that puts an event in the ledger stays in the pending store, `accepted`, until
 *   a Worker read's `asOf` passes it (`pending.ts`).
 * - **The PIN.** `publishMenu` opens the PIN first (`POST /family/pin/verify`; buzz-school's publish needs the PIN
 *   open and no mailed link), with the PIN the `pinSource` gives; any other write that answers `pin_required` opens it
 *   the same way and is sent once more. The Stripe key writes carry their PIN in the request. A missing PIN rejects
 *   `pin_required`.
 * - **The mailed-link step-up** (money writes and finance grants, 403 `step_up_required`) rejects `step_up`: only the
 *   person can open the mailed link.
 */

export type PinSource = {
	/** The family PIN for this write, or null when the person gives none. */
	pin(query: { school: string; purpose: string }): Promise<string | null>;
};
export const noPinSource: PinSource = { pin: async () => null };

export type FileSaver = { save(file: DownloadFile): Promise<void> };

/** The writes that put an event in the ledger (atm), so they stay pending until it ships. */
const ledgerWrites: ReadonlySet<string> = new Set([
	"recordOutcome",
	"cancelBooking",
	"refund",
	"adjustCredits",
	"sendInvoice",
	"publishMenu",
]);
/** Never kept in the pending store. */
const secretFields: ReadonlySet<string> = new Set([
	"pin",
	"restrictedKey",
	"apiKey",
]);
const storedRequestOf = (request: unknown): unknown =>
	isRecord(request)
		? Object.fromEntries(
				Object.entries(request).filter(([name]) => !secretFields.has(name)),
			)
		: request;

const instantOf = (unixSeconds: number): string =>
	new Date(unixSeconds * 1000).toISOString();

export function createHttpWriter(options: {
	api: ApiClient;
	tokens: LedgerTokenSource;
	pending: PendingStore;
	pinSource?: PinSource;
	files: FileSaver;
}): Writer {
	const { api, tokens, pending, files } = options;
	const pinSource = options.pinSource ?? noPinSource;

	const openPin = async (
		school: string,
		purpose: string,
		typed?: string,
	): Promise<void> => {
		const pin = typed ?? (await pinSource.pin({ school, purpose }));
		if (!pin)
			throw new AdapterError(
				"pin_required",
				`${purpose} needs the family PIN open`,
				{ code: "pin_required" },
			);
		await api.post(routes.pinVerify, { pin });
	};

	/** Sends one user action and answers the route's raw answer. The entry is settled before the answer is mapped:
	 * a write the server took is never retried under a new key because its answer did not map. */
	const perform = async (
		method: string,
		school: string,
		request: unknown,
		send: (idempotencyKey: string) => Promise<unknown>,
	): Promise<unknown> => {
		const entry = pending.begin({
			method,
			school,
			request: storedRequestOf(request),
		});
		let answer: unknown;
		try {
			try {
				answer = await send(entry.id);
			} catch (error) {
				if (!(error instanceof AdapterError) || error.kind !== "pin_required")
					throw error;
				await openPin(school, method);
				answer = await send(entry.id);
			}
		} catch (error) {
			if (!isRetryable(error)) pending.drop(entry.id);
			throw error;
		}
		if (ledgerWrites.has(method)) {
			const token = await tokens.current().catch(() => null);
			pending.accept(entry.id, token ? instantOf(token.expiresAt) : null);
		} else pending.drop(entry.id);
		return answer;
	};

	const post = (
		method: string,
		school: string,
		request: unknown,
		path: string,
		body: unknown,
	) =>
		perform(method, school, request, (idempotencyKey) =>
			api.post(path, body, { idempotencyKey }),
		);

	const outcomeOf = (answer: unknown) => {
		const route = "POST .../bookings/<id>/outcome";
		const body = recordOf(route, answer, "answer");
		return {
			creditEffect: oneOf(route, body.creditEffect, "creditEffect", [
				"not_wired",
			] as const),
		};
	};

	/** The Bookings tab's requests name `school`, the Members tab's `schoolId` (both contracts, one route each). */
	function recordOutcome(
		request: RecordOutcome,
	): Promise<{ creditEffect: "not_wired" }>;
	function recordOutcome(
		request: RecordOutcomeRequest,
	): Promise<{ creditEffect: "not_wired" }>;
	async function recordOutcome(request: RecordOutcome | RecordOutcomeRequest) {
		const school = "schoolId" in request ? request.schoolId : request.school;
		const body = {
			state: request.state,
			...("note" in request && request.note !== undefined
				? { note: request.note }
				: {}),
		};
		return outcomeOf(
			await post(
				"recordOutcome",
				school,
				request,
				routes.outcome(school, request.bookingId),
				body,
			),
		);
	}

	function cancelBooking(request: CancelBooking): Promise<void>;
	function cancelBooking(request: CancelBookingRequest): Promise<Accepted>;
	async function cancelBooking(
		request: CancelBooking | CancelBookingRequest,
		// biome-ignore lint/suspicious/noConfusingVoidType: the implementation of both overloads, one of which answers nothing
	): Promise<Accepted | void> {
		const school = "schoolId" in request ? request.schoolId : request.school;
		const body = {
			reason: request.reason,
			...(request.waiveCutoff !== undefined
				? { waiveCutoff: request.waiveCutoff }
				: {}),
		};
		await post(
			"cancelBooking",
			school,
			request,
			routes.cancel(school, request.bookingId),
			body,
		);
		if ("schoolId" in request) return { accepted: true };
	}

	const accepted = (): Accepted => ({ accepted: true });
	const unavailable =
		(call: string, reference: string) => async (): Promise<never> => {
			throw notAvailable(call, reference);
		};

	return {
		recordOutcome,
		cancelBooking,
		remindHost: unavailable(
			"remindHost",
			"no route (build list group 2, POST .../bookings/<id>/remind)",
		),

		saveMenu: async (schoolId, menu) => {
			await post(
				"saveMenu",
				schoolId,
				{ schoolId },
				routes.menu(schoolId),
				menuBodyOf(menu),
			);
		},
		publishMenu: async (schoolId) => {
			await openPin(schoolId, "publishMenu");
			await post(
				"publishMenu",
				schoolId,
				{ schoolId },
				routes.publish(schoolId),
				{},
			);
		},

		refund: async (request) => {
			const answer = await post(
				"refund",
				request.schoolId,
				request,
				routes.refunds(request.schoolId),
				{
					paymentIntentId: request.paymentIntentId,
					amountCents: request.amountCents,
					reason: request.reason,
					note: request.note,
				},
			);
			const route = "POST .../billing/refunds";
			const body = recordOf(route, answer, "answer");
			const result: RefundResult = {
				refundId: stringOf(route, body.refundId, "refundId"),
				status: oneOf(route, body.status, "status", [
					"pending",
					"succeeded",
					"failed",
				] as const),
				refundedCents: numberOf(route, body.refundedCents, "refundedCents"),
				remainingCents: numberOf(route, body.remainingCents, "remainingCents"),
			};
			return result;
		},
		adjustCredits: async (request) => {
			await post(
				"adjustCredits",
				request.schoolId,
				request,
				routes.adjust(request.schoolId),
				{
					membershipId: request.membershipId,
					featureId: request.featureId,
					amount: request.amount,
					kind: request.kind,
					note: request.note,
				},
			);
			return accepted();
		},
		sendInvoice: async (request) => {
			const answer = await post(
				"sendInvoice",
				request.schoolId,
				request,
				routes.invoices(request.schoolId),
				{
					familyId: request.familyId,
					addonId: request.addonId,
					...(request.memo ? { memo: request.memo } : {}),
				},
			);
			const route = "POST .../billing/invoices";
			const body = recordOf(route, answer, "answer");
			return {
				invoiceId: stringOf(route, body.invoiceId, "invoiceId"),
				status: oneOf(route, body.status, "status", ["open"] as const),
			};
		},
		grantFinance: async (request) => {
			const pubkey = pubkeyOf(request.subject);
			await post(
				"grantFinance",
				request.schoolId,
				request,
				routes.financeGrants(request.schoolId),
				{ pubkey },
			);
			return accepted();
		},
		revokeFinance: async (request) => {
			const pubkey = pubkeyOf(request.subject);
			await post(
				"revokeFinance",
				request.schoolId,
				request,
				routes.financeGrantsRemove(request.schoolId),
				{
					pubkey,
				},
			);
			return accepted();
		},
		changeRole: unavailable(
			"changeRole",
			"no route (build list group 3, POST ledger/roles)",
		),
		switchTier: unavailable(
			"switchTier",
			"capability switchTier is not_built (D8, build list group 5)",
		),
		cancelMembership: unavailable(
			"cancelMembership",
			"capability cancelMembership is not_built (D8)",
		),
		resumeMembership: unavailable("resumeMembership", "no route (D8)"),
		resendReceipt: unavailable(
			"resendReceipt",
			"capability resendReceipt is not_built (D8, build list group 4)",
		),

		download: (file) => files.save(file),
		createPromo: unavailable("createPromo", "no promo route (D8)"),
		disablePromo: unavailable("disablePromo", "no promo route (D8)"),

		portalChangeQuantity: unavailable(
			"portalChangeQuantity",
			"portal writes stay off the ledger origin (D6)",
		),
		portalCancelMembership: unavailable(
			"portalCancelMembership",
			"portal writes stay off the ledger origin (D6)",
		),
		portalResumeMembership: unavailable(
			"portalResumeMembership",
			"portal writes stay off the ledger origin (D6)",
		),
		portalCancelBooking: unavailable(
			"portalCancelBooking",
			"portal writes stay off the ledger origin (D6)",
		),

		saveAccountingBasis: unavailable(
			"saveAccountingBasis",
			"no accounting basis in buzz-school (section 7)",
		),
		createKey: async (request) => {
			if (request.kind === "rd")
				throw notAvailable(
					"createKey rd",
					"buzz-school mints pk and sk keys only; no ledger read credential exists",
				);
			const answer = await post(
				"createKey",
				request.school,
				request,
				routes.keyCreate,
				{
					school: request.school,
					kind: request.kind,
					label: request.label,
				},
			);
			const route = "POST /school-admin/key-create";
			const body = recordOf(route, answer, "answer");
			const row = recordOf(route, body.row, "row");
			if (row.last_used_at !== null)
				throw schemaMismatch(route, "a new key has a last use");
			const created: CreatedKey = {
				kind: request.kind,
				key: {
					id: stringOf(route, row.id, "row.id"),
					kind: oneOf(route, row.kind, "row.kind", ["pk", "sk"] as const),
					label: stringOf(route, row.label, "row.label"),
					prefix: stringOf(route, row.prefix, "row.prefix"),
					used: "never",
				},
				secret: stringOf(route, body.key, "key"),
			};
			return created;
		},
		revokeKey: async (request) => {
			await post("revokeKey", request.school, request, routes.keyRevoke, {
				school: request.school,
				id: request.keyId,
			});
		},
		saveStripeKey: async (request) => {
			await openPin(request.school, "saveStripeKey", request.pin);
			await post(
				"saveStripeKey",
				request.school,
				request,
				routes.stripeKey(request.school),
				{
					restrictedKey: request.restrictedKey,
				},
			);
		},
		removeStripeKey: async (request) => {
			await openPin(request.school, "removeStripeKey", request.pin);
			await post(
				"removeStripeKey",
				request.school,
				request,
				routes.stripeKeyRemove(request.school),
				{},
			);
		},
		saveZeffyKey: unavailable(
			"saveZeffyKey",
			"no Zeffy storage in buzz-school (section 7)",
		),
		removeZeffyKey: unavailable(
			"removeZeffyKey",
			"no Zeffy storage in buzz-school (section 7)",
		),
		saveDisclosure: unavailable(
			"saveDisclosure",
			"no disclosure route (build list group 8)",
		),
		confirmDisclosureStepUp: unavailable(
			"confirmDisclosureStepUp",
			"no disclosure route (build list group 8)",
		),
	};
}
