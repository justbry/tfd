// SPDX-License-Identifier: Apache-2.0
/**
 * The whole check of one receipt, as a verifier page runs it: the signature (always), then the school's books and seal
 * when the caller holds them (checkReceipt), or the month's published seal alone (checkReceiptInSeal). Each step is one
 * of core.ts's ports of tfd's checks.
 */
import {
	type BooksEvent,
	type BooksVerdict,
	canonicalize,
	checkReceiptAgainstEvents,
	isSignedReceipt,
	isSignedSeal,
	type KeyUseVerdict,
	keyUse,
	type PublicKeys,
	type SealVerdict,
	type SignatureVerdict,
	type SignedReceipt,
	verifyBytes,
	verifyReceipt,
	verifySealChain,
} from "./core";

export type Books = {
	school: string;
	events: BooksEvent[];
	seals: unknown[];
};

export type Outcome =
	| { kind: "malformed" }
	| { kind: "unknown_key"; keyId: string }
	| { kind: "bad_signature" }
	/** Signed by the key, but the key does not vouch for it: revoked, another purpose, or issued_at outside its window. */
	| { kind: KeyUseVerdict; keyId: string }
	| {
			kind: "signed";
			signed: SignedReceipt;
			/** null when the verifier doesn't hold this school's books. */
			books: BooksVerdict | null;
			/** The month's seal: null when there is no books copy or no seal for the month. */
			seal: { month: string; verdict: SealVerdict; covers: boolean } | null;
	  };

/**
 * The verdicts of a seal whose shape and signature are good, as tfd's verifySeals counts a month's latest seal (its key
 * must also vouch for it: a revoked key's seal never decides).
 */
const WELL_SIGNED: readonly SealVerdict[] = [
	"ok",
	"broken_link",
	"events_changed",
];

/** The `seal.month` of an untrusted seal, if it has one as text. */
const monthOf = (raw: unknown): string | null => {
	if (typeof raw !== "object" || raw === null) return null;
	const inner = (raw as { seal?: unknown }).seal;
	if (typeof inner !== "object" || inner === null) return null;
	const month = (inner as { month?: unknown }).month;
	return typeof month === "string" ? month : null;
};

/**
 * A receipt's signature against `keys`, then, when `loadBooks` has the school's books, the receipt against its event and
 * the month's seal against the seal chain. The month's latest seal with a good signature decides, as in tfd's
 * verifySeals; when the month has none, its latest seal of any kind is reported, covering nothing. Never throws for an
 * untrusted receipt or seal; `books.events` must be the school's tfd events.
 */
export const checkReceipt = async (
	value: unknown,
	keys: PublicKeys,
	loadBooks: (school: string) => Promise<Books | null>,
): Promise<Outcome> => {
	const signature: SignatureVerdict = await verifyReceipt(value, keys);
	if (signature === "malformed" || !isSignedReceipt(value))
		return { kind: "malformed" };
	if (signature === "unknown_key")
		return { kind: "unknown_key", keyId: value.key_id };
	if (signature === "bad_signature") return { kind: "bad_signature" };
	if (signature !== "ok") return { kind: signature, keyId: value.key_id };

	const books = await loadBooks(value.receipt.school);
	if (!books) return { kind: "signed", signed: value, books: null, seal: null };

	const booksVerdict = await checkReceiptAgainstEvents(value, books.events);
	const month = value.receipt.date.slice(0, 7);
	const seals: readonly unknown[] = Array.isArray(books.seals)
		? books.seals
		: [];
	const verdicts = await verifySealChain(seals, books.events, keys);
	type MonthSeal = Extract<Outcome, { kind: "signed" }>["seal"];
	let wellSigned: MonthSeal = null;
	let latest: MonthSeal = null;
	for (const [index, raw] of seals.entries()) {
		const verdict = verdicts[index] ?? "malformed";
		const vouched =
			isSignedSeal(raw) &&
			WELL_SIGNED.includes(verdict) &&
			keyUse(keys, raw.key_id, "seal", raw.seal.sealed_at) === "ok";
		if (vouched) {
			if (raw.seal.month !== month) continue;
			wellSigned = {
				month,
				verdict,
				covers: raw.seal.event_ids.includes(value.receipt.event_id),
			};
		} else if (monthOf(raw) === month) {
			latest = { month, verdict, covers: false };
		}
	}
	return {
		kind: "signed",
		signed: value,
		books: booksVerdict,
		seal: wellSigned ?? latest,
	};
};

/**
 * What checkReceiptInSeal found. `not_sealed` (no seal for the month yet) is not a failure. A `receipt_*` verdict is the
 * receipt's own (verifyReceipt), a `seal_*` one the seal's signature and key; `seal_other_school` and `seal_other_month`
 * mean the seal is not the receipt's school's or month's; `not_in_seal` that the month's seal does not name the event.
 */
export type ReceiptInSealVerdict =
	| "ok"
	| "not_sealed"
	| `receipt_${Exclude<SignatureVerdict, "ok">}`
	| `seal_${"malformed" | "unknown_key" | "bad_signature" | KeyUseVerdict}`
	| "seal_other_school"
	| "seal_other_month"
	| "not_in_seal";

/**
 * A receipt against its month's published seal, without the school's events: the receipt verifies (verifyReceipt), the
 * seal's shape and signature verify under a `seal` key (or a bare PEM) with sealed_at in its window, the seal is the
 * receipt's school's and the month of its date, and it names the receipt's event_id. `seal` null or undefined (nothing
 * published for the month) is `not_sealed`. The seal's chain and events are not checked: the events are not published.
 * Never throws for an untrusted receipt or seal.
 */
export const checkReceiptInSeal = async (
	receipt: unknown,
	seal: unknown,
	keys: PublicKeys,
): Promise<ReceiptInSealVerdict> => {
	const signature = await verifyReceipt(receipt, keys);
	if (signature !== "ok" || !isSignedReceipt(receipt))
		return `receipt_${signature === "ok" ? "malformed" : signature}`;
	if (seal === null || seal === undefined) return "not_sealed";
	if (!isSignedSeal(seal)) return "seal_malformed";
	const { seal: body, key_id, sig } = seal;
	const sealSignature = await verifyBytes(
		canonicalize(body),
		key_id,
		sig,
		keys,
	);
	if (sealSignature !== "ok") return `seal_${sealSignature}`;
	const use = keyUse(keys, key_id, "seal", body.sealed_at);
	if (use !== "ok") return `seal_${use}`;
	if (body.school !== receipt.receipt.school) return "seal_other_school";
	if (body.month !== receipt.receipt.date.slice(0, 7))
		return "seal_other_month";
	return body.event_ids.includes(receipt.receipt.event_id)
		? "ok"
		: "not_in_seal";
};
