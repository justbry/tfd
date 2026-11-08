// SPDX-License-Identifier: Apache-2.0
/**
 * The whole check of one receipt, as a verifier page runs it: the signature (always), then the school's books and seal
 * when the caller holds them. Each step is one of core.ts's ports of tfd's checks.
 */
import {
	type BooksEvent,
	type BooksVerdict,
	checkReceiptAgainstEvents,
	isSignedReceipt,
	isSignedSeal,
	type PublicKeys,
	type SealVerdict,
	type SignatureVerdict,
	type SignedReceipt,
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
	| {
			kind: "signed";
			signed: SignedReceipt;
			/** null when the verifier doesn't hold this school's books. */
			books: BooksVerdict | null;
			/** The month's seal: null when there is no books copy or no seal for the month. */
			seal: { month: string; verdict: SealVerdict; covers: boolean } | null;
	  };

/** The verdicts of a seal whose shape and signature are good, as tfd's verifySeals counts a month's latest seal. */
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
		if (isSignedSeal(raw) && WELL_SIGNED.includes(verdict)) {
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
