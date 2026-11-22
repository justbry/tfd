// SPDX-License-Identifier: Apache-2.0
/**
 * Signed note documents (docs/specs/promissory-notes.md, build step 3): a payment receipt, a payoff statement, a release
 * and a chain-head seal. This file builds the document BODY (plain JSON, every figure computed by `statement`) and signs
 * it through an injected port. No signing key lives in this package. A body names the chain head it was made against, so
 * a verifier can recompute the chain from the events and check the document against it.
 *
 * Documents carry no name or email: `parties` holds only opaque references the caller chose.
 */
import { canonicalJson, sha256Hex, toBase64Url, utf8Bytes } from "./canonical";
import { type ChainHead, type ChainLink, chainHead, eventHash } from "./chain";
import { statement, statusLabel } from "./statement";
import {
	type CivilDate,
	ENGINE_VERSION,
	type EventVia,
	type MinorString,
	type NoteEvent,
	type PaymentRecordedEvent,
	type PaymentStatus,
	type Role,
} from "./types";

export const NOTE_DOCUMENT_SCHEMA = "tfd.note-document.v1";

export const PAYOFF_WORDING =
	"Computed by tfd-notes from the recorded events. A record, not legal or tax advice.";
export const RELEASE_WORDING = "The lender states this note is released.";

/** UTC instant with `Z`, as in the signed ledger documents: it reads the same in every time zone. */
const UTC_INSTANT =
	/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?Z$/;
/** An opaque reference: letters, digits and `._:-`. No `@`, no space, so an email or a display name cannot be passed. */
const OPAQUE_REF = /^[A-Za-z0-9._:-]{1,128}$/;
const DATE_LENGTH = 10;

/** Caller-supplied opaque references to the two parties. Never names or emails. */
export interface DocumentParties {
	lender_ref?: string;
	borrower_ref?: string;
}

interface DocumentBase {
	schema: typeof NOTE_DOCUMENT_SCHEMA;
	engine_version: typeof ENGINE_VERSION;
	note_id: string;
	chain_head: ChainHead;
	/** UTC instant ending in Z. */
	issued_at: string;
	parties?: DocumentParties;
}

export interface PaymentReceiptBody extends DocumentBase {
	type: "note.payment-receipt";
	payment_event_id: string;
	/** sha256 hex of the payment event's canonical JSON. */
	event_hash: string;
	kind: "payment" | "reversal";
	amount_minor: MinorString;
	currency: string;
	exponent: number;
	value_date: CivilDate;
	recorded_by: Role;
	via?: EventVia;
	/** The statement's wording for the payment's status, such as "claimed by borrower". Never proof. */
	status: string;
	/** Each view's payoff on `value_date`, from `statement`. */
	lender_payoff_minor: MinorString;
	borrower_payoff_minor: MinorString;
}

export interface ViewBalance {
	principal_minor: MinorString;
	interest_minor: MinorString;
	payoff_minor: MinorString;
}

export interface PayoffStatementBody extends DocumentBase {
	type: "note.payoff-statement";
	as_of: CivilDate;
	currency: string;
	exponent: number;
	lender: ViewBalance;
	borrower: ViewBalance;
	/** lender payoff minus borrower payoff; negative when the borrower's count is higher. */
	payoff_gap_minor: MinorString;
	wording: typeof PAYOFF_WORDING;
}

export interface ReleaseBody extends DocumentBase {
	type: "note.release";
	release_event_id: string;
	release_event_hash: string;
	/** The UTC date of the release event's `entered_at`. */
	as_of: CivilDate;
	currency: string;
	exponent: number;
	/** The lender view's payoff on `as_of`. */
	balance_at_release_minor: MinorString;
	released_with_balance: boolean;
	wording: typeof RELEASE_WORDING;
}

export interface ChainSealBody {
	schema: typeof NOTE_DOCUMENT_SCHEMA;
	type: "note.chain-seal";
	note_id: string;
	head_seq: number;
	head_hash: string;
	/** UTC instant ending in Z. */
	sealed_at: string;
}

export type NoteDocumentBody =
	| PaymentReceiptBody
	| PayoffStatementBody
	| ReleaseBody
	| ChainSealBody;

export type SigningPurpose = "receipt" | "seal";

/** The signing port. The package never holds a key: the caller passes whatever signs with the published key `keyId`. */
export interface DocumentSigner {
	keyId: string;
	purpose: SigningPurpose;
	/** An Ed25519 signature of `bytes` (64 bytes). */
	sign(bytes: Uint8Array): Promise<Uint8Array>;
}

export interface DocumentSignature {
	key_id: string;
	purpose: SigningPurpose;
	alg: "Ed25519";
	/** base64url without padding, over the UTF-8 bytes of the body's canonical JSON. */
	sig: string;
}

export type SignedDocument<Body extends NoteDocumentBody = NoteDocumentBody> =
	Body & { signature: DocumentSignature };

const PURPOSE_OF_TYPE: Record<NoteDocumentBody["type"], SigningPurpose> = {
	"note.payment-receipt": "receipt",
	"note.payoff-statement": "receipt",
	"note.release": "receipt",
	"note.chain-seal": "seal",
};

const requireInstant = (value: string, label: string): void => {
	if (!UTC_INSTANT.test(value) || Number.isNaN(Date.parse(value))) {
		throw new Error(
			`${label} must be a UTC instant ending in Z, got ${JSON.stringify(value)}`,
		);
	}
};

const checkedParties = (
	parties: DocumentParties | undefined,
): { parties?: DocumentParties } => {
	if (parties === undefined) return {};
	const checked: DocumentParties = {};
	for (const key of Object.keys(parties)) {
		if (key !== "lender_ref" && key !== "borrower_ref") {
			throw new Error(
				`parties may hold lender_ref and borrower_ref only, got ${JSON.stringify(key)}`,
			);
		}
	}
	for (const key of ["lender_ref", "borrower_ref"] as const) {
		const value = parties[key];
		if (value === undefined) continue;
		if (!OPAQUE_REF.test(value)) {
			throw new Error(
				`${key} must be an opaque reference (letters, digits and ._:-; never a name or an email)`,
			);
		}
		checked[key] = value;
	}
	return { parties: checked };
};

const noteIdOf = (events: readonly NoteEvent[]): string => {
	const [first] = events;
	if (first === undefined) {
		throw new Error("a document needs the note's events");
	}
	return first.note_id;
};

/** Fields every body shares. Throws when `chain` is not the chain of exactly these events. */
const baseOf = async (
	events: readonly NoteEvent[],
	chain: readonly ChainLink[],
	issuedAt: string,
	parties: DocumentParties | undefined,
): Promise<DocumentBase> => {
	requireInstant(issuedAt, "issued_at");
	if (chain.length !== events.length) {
		throw new Error(
			`the chain has ${chain.length} links but there are ${events.length} events; build it from these events`,
		);
	}
	return {
		schema: NOTE_DOCUMENT_SCHEMA,
		engine_version: ENGINE_VERSION,
		note_id: noteIdOf(events),
		chain_head: await chainHead(chain),
		issued_at: issuedAt,
		...checkedParties(parties),
	};
};

/** The chain's own hash for `event`, so a body never names an event the chain does not hold as it is. */
const chainedEventHash = async (
	event: NoteEvent,
	chain: readonly ChainLink[],
): Promise<string> => {
	const hash = await eventHash(event);
	const link = chain.find((candidate) => candidate.event_id === event.id);
	if (link === undefined || link.event_hash !== hash) {
		throw new Error(
			`event ${event.id} is not in the chain as it stands (edited or missing)`,
		);
	}
	return hash;
};

const findEvent = <Type extends NoteEvent["type"]>(
	events: readonly NoteEvent[],
	id: string,
	type: Type,
): Extract<NoteEvent, { type: Type }> => {
	const event = events.find((candidate) => candidate.id === id);
	if (event === undefined || event.type !== type) {
		throw new Error(`${id} is not a ${type} event of this note`);
	}
	return event as Extract<NoteEvent, { type: Type }>;
};

/**
 * The status of one payment for its receipt. A payment the two views count differently is in the statement's difference
 * with its status. A payment they count the same needs the events: the latest confirm, dispute or resolution decides
 * (R-11); with none, only the recorder has said it, so it reads as claimed by the recorder (R-19).
 */
const paymentStatus = (
	events: readonly NoteEvent[],
	payment: PaymentRecordedEvent,
	itemStatus: PaymentStatus | undefined,
): PaymentStatus => {
	if (itemStatus !== undefined) return itemStatus;
	let latest: NoteEvent | undefined;
	for (const event of events) {
		const decides =
			(event.type === "payment.confirmed" ||
				event.type === "payment.disputed" ||
				event.type === "payment.resolved") &&
			event.target === payment.id;
		if (decides) latest = event;
	}
	if (latest === undefined) return `claimed-by-${payment.entered_by}`;
	if (latest.type === "payment.confirmed") return "confirmed";
	if (latest.type === "payment.disputed") return "disputed";
	return "resolved";
};

/**
 * The body of a receipt for one recorded payment: its amount, date, recorder and hash, how far the two parties agree on
 * it, and each view's payoff on its value date. `chain` must be the chain of `events`.
 */
export const paymentReceiptBody = async (
	events: readonly NoteEvent[],
	paymentEventId: string,
	chain: readonly ChainLink[],
	issuedAt: string,
	parties?: DocumentParties,
): Promise<PaymentReceiptBody> => {
	const base = await baseOf(events, chain, issuedAt, parties);
	const payment = findEvent(events, paymentEventId, "payment.recorded");
	const eventHashHex = await chainedEventHash(payment, chain);
	const asOfValueDate = statement([...events], payment.value_date);
	const item = asOfValueDate.difference.find(
		(candidate) => candidate.event_id === payment.id,
	);
	const status = paymentStatus(events, payment, item?.status);
	return {
		...base,
		type: "note.payment-receipt",
		payment_event_id: payment.id,
		event_hash: eventHashHex,
		kind: payment.kind,
		amount_minor: payment.amount_minor,
		currency: asOfValueDate.currency,
		exponent: asOfValueDate.exponent,
		value_date: payment.value_date,
		recorded_by: payment.entered_by,
		...(payment.via === undefined ? {} : { via: payment.via }),
		status: statusLabel(status),
		lender_payoff_minor: asOfValueDate.lender.payoff_minor,
		borrower_payoff_minor: asOfValueDate.borrower.payoff_minor,
	};
};

/** The body of a payoff statement on `asOf`: both views' principal, interest and payoff, and the gap between them. */
export const payoffStatementBody = async (
	events: readonly NoteEvent[],
	asOf: CivilDate,
	chain: readonly ChainLink[],
	issuedAt: string,
	parties?: DocumentParties,
): Promise<PayoffStatementBody> => {
	const base = await baseOf(events, chain, issuedAt, parties);
	const computed = statement([...events], asOf);
	const viewOf = (view: typeof computed.lender): ViewBalance => ({
		principal_minor: view.principal_minor,
		interest_minor: view.interest_minor,
		payoff_minor: view.payoff_minor,
	});
	return {
		...base,
		type: "note.payoff-statement",
		as_of: asOf,
		currency: computed.currency,
		exponent: computed.exponent,
		lender: viewOf(computed.lender),
		borrower: viewOf(computed.borrower),
		payoff_gap_minor: computed.payoff_gap_minor,
		wording: PAYOFF_WORDING,
	};
};

/**
 * The body of a release, from a `release.confirmed` event. It states what the lender said and what the lender's count
 * was that day. It never says the note was paid: `released_with_balance` is true when the lender's payoff that day was
 * above zero.
 */
export const releaseBody = async (
	events: readonly NoteEvent[],
	releaseEventId: string,
	chain: readonly ChainLink[],
	issuedAt: string,
	parties?: DocumentParties,
): Promise<ReleaseBody> => {
	const base = await baseOf(events, chain, issuedAt, parties);
	const release = findEvent(events, releaseEventId, "release.confirmed");
	const releaseHash = await chainedEventHash(release, chain);
	const asOf = release.entered_at.slice(0, DATE_LENGTH);
	const computed = statement([...events], asOf);
	return {
		...base,
		type: "note.release",
		release_event_id: release.id,
		release_event_hash: releaseHash,
		as_of: asOf,
		currency: computed.currency,
		exponent: computed.exponent,
		balance_at_release_minor: computed.lender.payoff_minor,
		released_with_balance: computed.lender.payoff_minor !== "0",
		wording: RELEASE_WORDING,
	};
};

/** The body of a chain-head seal: the note's head as it stood at `sealedAt`. Sign it with purpose `seal`. */
export const chainSealBody = async (
	noteId: string,
	chain: readonly ChainLink[],
	sealedAt: string,
): Promise<ChainSealBody> => {
	requireInstant(sealedAt, "sealed_at");
	const head = await chainHead(chain);
	return {
		schema: NOTE_DOCUMENT_SCHEMA,
		type: "note.chain-seal",
		note_id: noteId,
		head_seq: head.seq,
		head_hash: head.head_hash,
		sealed_at: sealedAt,
	};
};

/** sha256 hex of the body's canonical JSON: the value `payoff.issued.document_sha256` names. Never includes a signature. */
export const documentSha256 = (body: NoteDocumentBody): Promise<string> =>
	sha256Hex(canonicalJson(body));

/** The body of a signed document: everything but `signature`. */
export const documentBody = <Body extends NoteDocumentBody>(
	document: SignedDocument<Body>,
): Body => {
	const { signature: _signature, ...body } = document;
	return body as unknown as Body;
};

/** The bytes a signature covers: the UTF-8 bytes of the body's canonical JSON. */
export const documentSigningBytes = (body: NoteDocumentBody): Uint8Array =>
	utf8Bytes(canonicalJson(body));

/**
 * Signs `body`. Receipts, payoff statements and releases need a signer with purpose `receipt`; a chain seal needs
 * `seal` (decision D3). Throws on any other pairing, so a key published for one use cannot be used for the other here.
 */
export const signDocument = async <Body extends NoteDocumentBody>(
	body: Body,
	signer: DocumentSigner,
): Promise<SignedDocument<Body>> => {
	const required = PURPOSE_OF_TYPE[body.type];
	if (required === undefined) {
		throw new Error(`unknown document type ${JSON.stringify(body.type)}`);
	}
	if (signer.purpose !== required) {
		throw new Error(
			`a ${body.type} is signed with a ${required} key; ${signer.keyId} is a ${signer.purpose} key`,
		);
	}
	if ("signature" in body) {
		throw new Error("the body is already signed; sign a body, not a document");
	}
	const signature = await signer.sign(documentSigningBytes(body));
	return {
		...body,
		signature: {
			key_id: signer.keyId,
			purpose: signer.purpose,
			alg: "Ed25519",
			sig: toBase64Url(signature),
		},
	};
};
