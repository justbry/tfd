// SPDX-License-Identifier: Apache-2.0
import type {
	AtmEvent,
	AtmPublicKeys,
	AtmReceipt,
	AtmSignedReceipt,
	AtmSigner,
	LedgerVerdict,
	ReceiptVerdict,
	TfdReceiptV2,
} from "../types.js";
import { receiptSchema, receiptV2Schema } from "./schemas.js";
import { keyUse, shapeCheck, signBytes, verifyBytes } from "./sign.js";
import { canonicalize, sha256Hex } from "./util.js";

/**
 * The event types that get a receipt, and the payload field that is their amount. A dispute gets none: it is between the
 * family and its bank, not an agreement between school and family.
 */
const AMOUNT_FIELD = {
	"payment.succeeded": "amount_paid",
	"payment.refunded": "amount",
} as const;

type ReceiptedType = keyof typeof AMOUNT_FIELD;

const isReceipted = (type: string): type is ReceiptedType =>
	Object.hasOwn(AMOUNT_FIELD, type);

/** A required payload field, or an error naming it: a receipt never carries a guessed value. */
const required = <T>(
	event: AtmEvent,
	field: string,
	is: (value: unknown) => value is T,
	what: string,
): T => {
	const value = event.payload[field];
	if (!is(value))
		throw new Error(
			`${event.event_type} ${event.id}: payload.${field} must be ${what}, got ${JSON.stringify(value) ?? "nothing"}`,
		);
	return value;
};

const isText = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

const isCents = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value > 0;

/**
 * The receipt of a `payment.succeeded` or `payment.refunded` event, from the event alone; `null` for every other type.
 * Throws an error naming the field when a required payload field is missing or of the wrong type. Pure: the same event
 * always gives the same receipt, so the books can make a family's receipt again at any time.
 */
export const receiptOf = (event: AtmEvent): AtmReceipt | null => {
	if (!isReceipted(event.event_type)) return null;
	const amount = required(
		event,
		AMOUNT_FIELD[event.event_type],
		isCents,
		"whole cents above 0",
	);
	return {
		v: 1,
		school: event.school,
		key: event.key,
		event_id: event.id,
		event_type: event.event_type,
		event_time: event.event_time,
		date: event.date,
		amount,
		currency: required(event, "currency", isText, "a non-empty string"),
		stripe_id: required(event, "id", isText, "a non-empty string"),
		cause: event.cause ?? null,
		event_hash: sha256Hex(canonicalize(event)),
	};
};

/** RFC 3339 UTC, as `schema/receipt.v2.json` takes `issued_at`. */
const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

/**
 * Receipt v2 of an event: `receiptOf`'s fields with `v: 2` and `issuedAt`, the time it is signed (the caller's clock).
 * `null` for an event type without receipts. Throws as `receiptOf` does, and when `issuedAt` is not an RFC 3339 UTC
 * instant. Pure: the books make it again from the event and the receipt's own `issued_at`.
 */
export const receiptOfV2 = (
	event: AtmEvent,
	issuedAt: string,
): TfdReceiptV2 | null => {
	if (!(UTC_INSTANT.test(issuedAt) && !Number.isNaN(Date.parse(issuedAt))))
		throw new Error(
			`issuedAt must be an RFC 3339 UTC instant, got ${issuedAt}`,
		);
	const v1 = receiptOf(event);
	return v1 ? { ...v1, v: 2, issued_at: issuedAt } : null;
};

/** The receipt (v1 or v2) signed with Ed25519 over `canonicalize(receipt)`. Throws naming the key type when the key is not Ed25519. */
export const signReceipt = (
	receipt: AtmReceipt | TfdReceiptV2,
	signer: AtmSigner,
): AtmSignedReceipt => ({
	receipt,
	key_id: signer.keyId,
	sig: signBytes(canonicalize(receipt), signer),
});

const isSignedV1 = shapeCheck(receiptSchema);
const isSignedV2 = shapeCheck(receiptV2Schema);

/** The receipt's `v`, read without trusting its shape. */
const versionOf = (signed: unknown): unknown =>
	typeof signed === "object" && signed !== null
		? (signed as { receipt?: { v?: unknown } }).receipt?.v
		: undefined;

const isSignedReceipt = (signed: unknown): signed is AtmSignedReceipt =>
	versionOf(signed) === 2 ? isSignedV2(signed) : isSignedV1(signed);

/**
 * A signed receipt from anyone (a family's file is untrusted): its shape against `schema/receipt.v1.json` or
 * `schema/receipt.v2.json` (by its `v`), then its key id, then its signature, then whether the key vouches for it: a
 * revoked key never does, a key of another purpose never does, and a v2 receipt's `issued_at` must be in the key's
 * window (`keyUse`). Never throws.
 */
export const verifyReceipt = (
	signed: unknown,
	keys: AtmPublicKeys,
): ReceiptVerdict => {
	if (!isSignedReceipt(signed)) return { ok: false, reason: "malformed" };
	const { receipt, key_id, sig } = signed;
	const verdict = verifyBytes(canonicalize(receipt), key_id, sig, keys);
	if (verdict !== "ok") return { ok: false, reason: verdict };
	const at = receipt.v === 2 ? receipt.issued_at : null;
	const use = keyUse(keys, key_id, "receipt", at);
	return use === "ok" ? { ok: true } : { ok: false, reason: use };
};

/**
 * A signed receipt against the school's events: the event it names, made into a receipt again and compared byte for
 * byte. `missing_event` when no event has its id, `not_receipted` when the event's type no longer gets a receipt,
 * `event_changed` for any other difference (also an event that no longer makes a receipt at all). A v2 receipt is made
 * again with its own `issued_at`. The signature is `verifyReceipt`'s job.
 */
export const checkReceiptAgainstEvents = (
	signed: AtmSignedReceipt,
	events: readonly AtmEvent[],
): LedgerVerdict => {
	const event = events.find((e) => e.id === signed.receipt.event_id);
	if (!event) return { ok: false, reason: "missing_event" };
	const { receipt } = signed;
	let again: AtmReceipt | TfdReceiptV2 | null;
	try {
		again =
			receipt.v === 2
				? receiptOfV2(event, receipt.issued_at)
				: receiptOf(event);
	} catch {
		return { ok: false, reason: "event_changed" };
	}
	if (!again) return { ok: false, reason: "not_receipted" };
	return canonicalize(again) === canonicalize(receipt)
		? { ok: true }
		: { ok: false, reason: "event_changed" };
};
