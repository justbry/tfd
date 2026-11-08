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

/**
 * A receipt's signature against `keys`, then, when `loadBooks` has the school's books, the receipt against its event and
 * the month's seal against the seal chain. The month's latest seal decides, as in tfd's verifySeals. Never throws for
 * untrusted input.
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
	const verdicts = await verifySealChain(books.seals, books.events, keys);
	// The month's latest seal decides, as in tfd's verifySeals.
	let seal: Extract<Outcome, { kind: "signed" }>["seal"] = null;
	for (const [index, raw] of books.seals.entries()) {
		// Untrusted: a seal may be null or have any shape, so read it defensively.
		const candidate = raw as {
			seal?: { month?: unknown; event_ids?: unknown };
		} | null;
		if (candidate?.seal?.month !== month) continue;
		const eventIds = candidate.seal.event_ids;
		seal = {
			month,
			verdict: verdicts[index] ?? "malformed",
			covers:
				Array.isArray(eventIds) && eventIds.includes(value.receipt.event_id),
		};
	}
	return { kind: "signed", signed: value, books: booksVerdict, seal };
};
