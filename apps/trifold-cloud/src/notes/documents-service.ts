import type { DocumentSigner, NoteEvent, Statement } from "tfd-notes";
import type { CloudEnv } from "../env";
import { loadSigningKeys } from "../signing";
import type { StoredDocument } from "./store";

/**
 * The pieces of the signed-document flow that need no store (docs/specs/promissory-notes.md build step 3; plan D3):
 * the two signers, the release summary a page shows, and the notice email. `service.ts` holds the methods that use them.
 */

/**
 * Who signs. Receipts, payoff statements and releases use the `receipt` signer; chain seals use the `seal` signer
 * (plan D3). Each is the `tfd-notes` `DocumentSigner` shape, so `signDocument` refuses a wrong pairing.
 */
export interface DocumentSigners {
	receipt: DocumentSigner;
	seal: DocumentSigner;
}

/** A release is confirmed no sooner than this after its draft unless a test injects another value. */
export const DEFAULT_RELEASE_COOLING_MS = 24 * 60 * 60 * 1000;

/** Most notices one note may send in a day: a lender cannot use the notice button to flood a borrower. */
export const NOTICES_PER_DAY = 5;
export const NOTICE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Most payoff statements one note may issue in an hour: each one adds an event to the shared log. */
export const PAYOFFS_PER_HOUR = 10;
export const PAYOFF_WINDOW_MS = 60 * 60 * 1000;

export const MAX_CURE_DAYS = 365;

/**
 * The production signers: Ed25519 over the Secrets Store keys of `loadSigningKeys`. The key ids are not in the Secrets
 * Store (it holds the PEM only), so they come from `NOTES_RECEIPT_KEY_ID` and `NOTES_SEAL_KEY_ID`, the ids published in
 * the key directory (PLAN.md section 3.5, `trifold-YYYY-MM`). Null when either id is unset: the document routes then
 * answer 503. The keys are imported on first use and only then.
 */
export const documentSignersFromEnv = (
	env: CloudEnv,
): DocumentSigners | null => {
	const receiptId = env.NOTES_RECEIPT_KEY_ID;
	const sealId = env.NOTES_SEAL_KEY_ID;
	if (!(receiptId && sealId)) return null;
	let keys: ReturnType<typeof loadSigningKeys> | undefined;
	const signWith =
		(purpose: "receipt" | "seal") =>
		async (bytes: Uint8Array): Promise<Uint8Array> => {
			keys ??= loadSigningKeys(env);
			const key = (await keys)[purpose];
			return new Uint8Array(await crypto.subtle.sign("Ed25519", key, bytes));
		};
	return {
		receipt: {
			keyId: receiptId,
			purpose: "receipt",
			sign: signWith("receipt"),
		},
		seal: { keyId: sealId, purpose: "seal", sign: signWith("seal") },
	};
};

/** What a page needs to show about releasing the note. */
export interface ReleaseSummary {
	/** The draft nobody has confirmed yet, if any, and when it may be confirmed. */
	draft: { id: string; enteredAt: string; confirmableAt: string } | null;
	/** The latest `release.confirmed` event and its signed document, if one exists. */
	confirmed: {
		eventId: string;
		enteredAt: string;
		documentId: string | null;
	} | null;
	/** A release was confirmed once and a later reversal reopened the note. */
	reopened: boolean;
}

/** The release state of a validated stream, from the events alone plus the stored documents. */
export const releaseSummary = (
	events: readonly NoteEvent[],
	state: Statement["state"],
	documents: readonly StoredDocument[],
	coolingMs: number,
): ReleaseSummary => {
	const confirmedTargets = new Set<string>();
	let confirmedEvent: NoteEvent | undefined;
	for (const event of events) {
		if (event.type !== "release.confirmed") continue;
		confirmedTargets.add(event.target);
		confirmedEvent = event;
	}
	let draft: ReleaseSummary["draft"] = null;
	for (const event of events) {
		if (event.type !== "release.drafted" || confirmedTargets.has(event.id))
			continue;
		draft = {
			id: event.id,
			enteredAt: event.entered_at,
			confirmableAt: new Date(
				Date.parse(event.entered_at) + coolingMs,
			).toISOString(),
		};
	}
	const confirmedDocument =
		confirmedEvent === undefined
			? undefined
			: documents.find(
					(document) =>
						document.type === "note.release" &&
						document.eventId === confirmedEvent.id,
				);
	return {
		draft,
		confirmed:
			confirmedEvent === undefined
				? null
				: {
						eventId: confirmedEvent.id,
						enteredAt: confirmedEvent.entered_at,
						documentId: confirmedDocument?.id ?? null,
					},
		reopened: confirmedEvent !== undefined && !state.closed,
	};
};

/**
 * The email a borrower gets when the lender records a notice. It states no amount and makes no claim: it says a notice
 * was recorded and points at the note. The link holds no token; a borrower with no session asks for a new link there.
 */
export const noticeEmail = (
	noteId: string,
	baseUrl: string,
): { subject: string; text: string } => ({
	subject: "Your lender recorded a notice",
	text: [
		"Your lender recorded a notice on your loan record: open your note to read it.",
		"",
		`${baseUrl}/n/${noteId}`,
		"",
		"If the link asks you to sign in, ask for a new link there.",
		"A record, not legal or tax advice.",
	].join("\n"),
});
