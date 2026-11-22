// SPDX-License-Identifier: Apache-2.0
/**
 * Offline checks of promissory-note documents (docs/specs/promissory-notes.md, build step 3), for any runtime with
 * WebCrypto. Served from the `tfd-verify/notes` subpath only, so the base verifier bundle (core.ts) does not carry it and
 * does not import tfd-notes.
 *
 * What a passing check says: the signature verifies for this key, the key was published for this use and was in its
 * window at the document's signed time, and the document is unchanged since it was signed. It says nothing about whether
 * the facts in it are true. The bytes signed are the UTF-8 bytes of the body's canonical JSON, produced by tfd-notes'
 * `canonicalJson` (never reimplemented here).
 *
 * Nothing here throws on bad input: every check returns a verdict with a stable machine-readable `code`. Nothing here
 * reads a clock, the network or a file.
 */
import { verifyAsync } from "@noble/ed25519";
import {
	type ChainFailure,
	type ChainHead,
	type ChainLink,
	canonicalJson,
	ENGINE_VERSION,
	fromBase64Url,
	isValidCivilDate,
	linkHash,
	NOTE_DOCUMENT_SCHEMA,
	type NoteDocumentBody,
	type NoteEvent,
	PAYOFF_WORDING,
	parseNoteEvent,
	RELEASE_WORDING,
	type SignedDocument,
	type SigningPurpose,
	utf8Bytes,
	verifyChain,
} from "tfd-notes";
import {
	ed25519FromPem,
	type KeyUseVerdict,
	keyEntryOf,
	keyUse,
	type PublicKeys,
} from "tfd-verify";

/** The keys a note document is checked against: whatever core.ts takes (a PEM, or a PEM with purpose and window). */
export type KeysInput = PublicKeys;

export type NoteDocumentType = NoteDocumentBody["type"];

/** Why one document did not verify. Each code is one check; the strings are stable. */
export type NoteDocumentFailure =
	| "not_an_object"
	| "unknown_type"
	| "wrong_schema"
	| "bad_shape"
	| "wrong_purpose"
	| "unknown_key"
	| "bad_signature_encoding"
	| "bad_signature"
	| "not_canonical"
	| KeyUseVerdict
	| "bad_options"
	| "signed_in_future";

export type NoteVerdict =
	| {
			ok: true;
			type: NoteDocumentType;
			key_id: string;
			note_id: string;
			/** `issued_at`, or `sealed_at` for a chain seal: the time the key window was checked against. */
			signed_at: string;
			/** The chain head the document names (a seal's `head_seq` and `head_hash`). */
			chain_head: ChainHead;
			document: SignedDocument;
	  }
	| { ok: false; code: NoteDocumentFailure; message: string };

export interface VerifyOptions {
	/**
	 * A UTC instant ending in Z. When given, a document signed after it fails with `signed_in_future`. When absent, no
	 * clock check is made (the verifier never reads the clock on its own).
	 */
	now?: string;
}

const failure = (code: NoteDocumentFailure, message: string): NoteVerdict => ({
	ok: false,
	code,
	message,
});

// ---- shape checks (schema/note-document.v1.json in tfd-notes) ----

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

type FieldCheck = (value: unknown) => boolean;

const UTC_INSTANT =
	/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?Z$/u;
const SHA256_HEX = /^[0-9a-f]{64}$/u;
const MINOR_UNSIGNED = /^(0|[1-9][0-9]*)$/u;
const MINOR_SIGNED = /^(0|-?[1-9][0-9]*)$/u;
const CURRENCY = /^[A-Z]{3}$/u;
const OPAQUE_REF = /^[A-Za-z0-9._:-]{1,128}$/u;
const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MAXIMUM_EXPONENT = 4;

const matches =
	(pattern: RegExp): FieldCheck =>
	(value) =>
		typeof value === "string" && pattern.test(value);

const isText: FieldCheck = (value) =>
	typeof value === "string" && value.length > 0;
const isInstant: FieldCheck = (value) =>
	typeof value === "string" &&
	UTC_INSTANT.test(value) &&
	!Number.isNaN(Date.parse(value));
const isCivilDate: FieldCheck = (value) =>
	typeof value === "string" &&
	CIVIL_DATE.test(value) &&
	isValidCivilDate(value);
const isSequence: FieldCheck = (value) =>
	typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
const isExponent: FieldCheck = (value) =>
	typeof value === "number" &&
	Number.isInteger(value) &&
	value >= 0 &&
	value <= MAXIMUM_EXPONENT;
const isBoolean: FieldCheck = (value) => typeof value === "boolean";
const isHash = matches(SHA256_HEX);
const isMinor = matches(MINOR_UNSIGNED);
const isSignedMinor = matches(MINOR_SIGNED);
const isRole: FieldCheck = (value) =>
	value === "lender" || value === "borrower";
const oneOf =
	(allowed: readonly string[]): FieldCheck =>
	(value) =>
		typeof value === "string" && allowed.includes(value);
const equals =
	(expected: string): FieldCheck =>
	(value) =>
		value === expected;

/** An object with exactly the required keys, plus any of the optional ones, each passing its check. */
const objectOf = (
	required: Record<string, FieldCheck>,
	optional: Record<string, FieldCheck> = {},
): FieldCheck => {
	return (value) => problemWith(value, required, optional) === null;
};

const isChainHead = objectOf({ seq: isSequence, head_hash: isHash });
const isParties = objectOf(
	{},
	{ lender_ref: matches(OPAQUE_REF), borrower_ref: matches(OPAQUE_REF) },
);
const isViewBalance = objectOf({
	principal_minor: isMinor,
	interest_minor: isMinor,
	payoff_minor: isMinor,
});

const PAYMENT_STATUSES = [
	"confirmed by both parties",
	"claimed by lender",
	"claimed by borrower",
	"disputed",
	"resolved by agreement",
	"reversed",
] as const;

const SIGNATURE_FIELDS: Record<string, FieldCheck> = {
	key_id: isText,
	purpose: oneOf(["receipt", "seal"]),
	alg: equals("Ed25519"),
	// The spelling of `sig` is its own check (bad_signature_encoding), so here it only has to be text.
	sig: (value) => typeof value === "string",
};

const SHARED_FIELDS: Record<string, FieldCheck> = {
	schema: equals(NOTE_DOCUMENT_SCHEMA),
	engine_version: equals(ENGINE_VERSION),
	note_id: isText,
	chain_head: isChainHead,
	issued_at: isInstant,
	signature: objectOf(SIGNATURE_FIELDS),
};
const SHARED_OPTIONAL: Record<string, FieldCheck> = { parties: isParties };

const FIELDS_OF_TYPE: Record<
	NoteDocumentType,
	{ required: Record<string, FieldCheck>; optional: Record<string, FieldCheck> }
> = {
	"note.payment-receipt": {
		required: {
			...SHARED_FIELDS,
			type: equals("note.payment-receipt"),
			payment_event_id: isText,
			event_hash: isHash,
			kind: oneOf(["payment", "reversal"]),
			amount_minor: isMinor,
			currency: matches(CURRENCY),
			exponent: isExponent,
			value_date: isCivilDate,
			recorded_by: isRole,
			status: oneOf(PAYMENT_STATUSES),
			lender_payoff_minor: isMinor,
			borrower_payoff_minor: isMinor,
		},
		optional: { ...SHARED_OPTIONAL, via: oneOf(["email-link", "account"]) },
	},
	"note.payoff-statement": {
		required: {
			...SHARED_FIELDS,
			type: equals("note.payoff-statement"),
			as_of: isCivilDate,
			currency: matches(CURRENCY),
			exponent: isExponent,
			lender: isViewBalance,
			borrower: isViewBalance,
			payoff_gap_minor: isSignedMinor,
			wording: equals(PAYOFF_WORDING),
		},
		optional: SHARED_OPTIONAL,
	},
	"note.release": {
		required: {
			...SHARED_FIELDS,
			type: equals("note.release"),
			release_event_id: isText,
			release_event_hash: isHash,
			as_of: isCivilDate,
			currency: matches(CURRENCY),
			exponent: isExponent,
			balance_at_release_minor: isMinor,
			released_with_balance: isBoolean,
			wording: equals(RELEASE_WORDING),
		},
		optional: SHARED_OPTIONAL,
	},
	"note.chain-seal": {
		required: {
			schema: equals(NOTE_DOCUMENT_SCHEMA),
			type: equals("note.chain-seal"),
			note_id: isText,
			head_seq: isSequence,
			head_hash: isHash,
			sealed_at: isInstant,
			signature: objectOf(SIGNATURE_FIELDS),
		},
		optional: {},
	},
};

const isDocumentType = (value: unknown): value is NoteDocumentType =>
	typeof value === "string" && Object.hasOwn(FIELDS_OF_TYPE, value);

/** The first thing wrong with `value` as an object of these fields, as a sentence, or null when it is right. */
function problemWith(
	value: unknown,
	required: Record<string, FieldCheck>,
	optional: Record<string, FieldCheck>,
): string | null {
	if (!isRecord(value)) return "is not an object";
	for (const key of Object.keys(value)) {
		if (!(Object.hasOwn(required, key) || Object.hasOwn(optional, key))) {
			return `has an unknown property ${JSON.stringify(key)}`;
		}
	}
	for (const [key, check] of Object.entries(required)) {
		if (!Object.hasOwn(value, key)) return `is missing ${JSON.stringify(key)}`;
		if (!check(value[key])) return `has a bad value for ${JSON.stringify(key)}`;
	}
	for (const [key, check] of Object.entries(optional)) {
		if (Object.hasOwn(value, key) && !check(value[key])) {
			return `has a bad value for ${JSON.stringify(key)}`;
		}
	}
	return null;
}

/** The body and its signature block, taken apart. Only called on a document whose shape has been checked. */
const signedTimeOf = (document: SignedDocument): string =>
	document.type === "note.chain-seal" ? document.sealed_at : document.issued_at;

const headOf = (document: SignedDocument): ChainHead =>
	document.type === "note.chain-seal"
		? { seq: document.head_seq, head_hash: document.head_hash }
		: document.chain_head;

const REQUIRED_PURPOSE: Record<NoteDocumentType, SigningPurpose> = {
	"note.payment-receipt": "receipt",
	"note.payoff-statement": "receipt",
	"note.release": "receipt",
	"note.chain-seal": "seal",
};

const KEY_USE_MESSAGES: Record<KeyUseVerdict, string> = {
	key_revoked: "the key that signed this document is revoked",
	key_wrong_purpose:
		"the key that signed this document was not published for this use",
	outside_key_window:
		"the document's signed time is outside the window the key was published for",
};

const SIGNATURE_BYTES = 64;

/** The 64 signature bytes of a strictly spelled base64url string, or null for any other spelling. */
const signatureBytes = (sig: string): Uint8Array | null => {
	try {
		const bytes = fromBase64Url(sig);
		return bytes.length === SIGNATURE_BYTES ? bytes : null;
	} catch {
		return null;
	}
};

const checkNow = (options: VerifyOptions | undefined): string | null => {
	const now = isRecord(options) ? options.now : undefined;
	if (now === undefined) return null;
	return isInstant(now) ? null : "now must be a UTC instant ending in Z";
};

const verifyDocumentChecked = async (
	document: unknown,
	keys: KeysInput,
	options: VerifyOptions | undefined,
): Promise<NoteVerdict> => {
	if (!isRecord(document)) {
		return failure("not_an_object", "the document is not an object");
	}
	const { type } = document;
	if (!isDocumentType(type)) {
		return failure(
			"unknown_type",
			"the document type is not one of note.payment-receipt, note.payoff-statement, note.release or note.chain-seal",
		);
	}
	if (document.schema !== NOTE_DOCUMENT_SCHEMA) {
		return failure("wrong_schema", `the schema is not ${NOTE_DOCUMENT_SCHEMA}`);
	}
	const { required, optional } = FIELDS_OF_TYPE[type];
	const shapeProblem = problemWith(document, required, optional);
	if (shapeProblem !== null) {
		return failure("bad_shape", `the ${type} ${shapeProblem}`);
	}
	// The shape is now exactly the schema's, so the typed view below is what the checks above established.
	const signed = document as unknown as SignedDocument;
	const { signature } = signed;
	const requiredPurpose = REQUIRED_PURPOSE[type];
	if (signature.purpose !== requiredPurpose) {
		return failure(
			"wrong_purpose",
			`a ${type} is signed with a ${requiredPurpose} key; this one says ${signature.purpose}`,
		);
	}
	const signedAt = signedTimeOf(signed);
	const nowProblem = checkNow(options);
	if (nowProblem !== null) return failure("bad_options", nowProblem);
	const now = options?.now;
	if (now !== undefined && Date.parse(signedAt) > Date.parse(now)) {
		return failure("signed_in_future", "the document is signed in the future");
	}
	const publicKey = await publicKeyOf(keys, signature.key_id);
	if (publicKey === null) {
		return failure(
			"unknown_key",
			`no usable public key is published for ${JSON.stringify(signature.key_id)}`,
		);
	}
	const bytes = signatureBytes(signature.sig);
	if (bytes === null) {
		return failure(
			"bad_signature_encoding",
			"the signature is not 64 bytes spelled as base64url without padding",
		);
	}
	const { signature: _signature, ...body } = signed;
	let signedBytes: Uint8Array;
	try {
		signedBytes = utf8Bytes(canonicalJson(body));
	} catch {
		return failure(
			"not_canonical",
			"the document holds text that has no single canonical spelling",
		);
	}
	if (!(await ed25519Verifies(bytes, signedBytes, publicKey))) {
		return failure(
			"bad_signature",
			"the signature does not verify for this key",
		);
	}
	const use = keyUse(keys, signature.key_id, requiredPurpose, signedAt);
	if (use !== "ok") return failure(use, KEY_USE_MESSAGES[use]);
	return {
		ok: true,
		type,
		key_id: signature.key_id,
		note_id: signed.note_id,
		signed_at: signedAt,
		chain_head: headOf(signed),
		document: signed,
	};
};

const publicKeyOf = async (
	keys: KeysInput,
	keyId: string,
): Promise<Uint8Array | null> => {
	const pem = keyEntryOf(keys, keyId)?.pem;
	if (pem === undefined) return null;
	return await ed25519FromPem(pem);
};

const ed25519Verifies = async (
	signature: Uint8Array,
	message: Uint8Array,
	publicKey: Uint8Array,
): Promise<boolean> => {
	try {
		return await verifyAsync(signature, message, publicKey, { zip215: false });
	} catch {
		return false;
	}
};

/**
 * Checks one signed note document against published keys: its type and schema, its exact shape, that the signature block
 * names the purpose its type needs, the key (published, that purpose, in its window at `issued_at` or `sealed_at`, not
 * revoked, as core.ts's `keyUse` reads them), the spelling of the signature, and the Ed25519 signature over the UTF-8
 * bytes of the body's canonical JSON. Never throws; the verdict says which check failed.
 */
export const verifyNoteDocument = async (
	document: unknown,
	keys: KeysInput,
	options?: VerifyOptions,
): Promise<NoteVerdict> => {
	try {
		return await verifyDocumentChecked(document, keys, options);
	} catch {
		return failure(
			"bad_shape",
			"the document could not be read as a note document",
		);
	}
};

// ---- the chain ----

/** Why a chain did not verify: the shape of the input, or one of tfd-notes' `verifyChain` reasons with a `chain_` prefix. */
export type NoteChainFailure =
	| "bad_input"
	| "bad_event"
	| "bad_link"
	| "chain_events_out_of_order"
	| "chain_mixed_note_ids"
	| "chain_wrong_note_id"
	| "chain_duplicated_link"
	| "chain_links_out_of_order"
	| "chain_missing_link"
	| "chain_extra_link"
	| "chain_link_event_mismatch"
	| "chain_event_hash_mismatch"
	| "chain_wrong_genesis"
	| "chain_broken_link";

export type NoteChainVerdict =
	| {
			ok: true;
			note_id: string;
			length: number;
			/** The head recomputed from the links: its seq and the hash of the last link. */
			head: ChainHead;
	  }
	| {
			ok: false;
			code: NoteChainFailure;
			message: string;
			/** The seq the problem was found at, when the chain library gives one. */
			seq?: number;
	  };

const CHAIN_FAILURES: Record<
	ChainFailure,
	{ code: NoteChainFailure; message: string }
> = {
	events_out_of_order: {
		code: "chain_events_out_of_order",
		message: "the events are not in order, seq 1 to n",
	},
	mixed_note_ids: {
		code: "chain_mixed_note_ids",
		message: "the events are not all of one note",
	},
	wrong_note_id: {
		code: "chain_wrong_note_id",
		message: "the events are not of the note that was asked for",
	},
	duplicated_link: {
		code: "chain_duplicated_link",
		message: "a link repeats the seq of another link",
	},
	links_out_of_order: {
		code: "chain_links_out_of_order",
		message: "the links are not in order, seq 1 to n",
	},
	missing_link: {
		code: "chain_missing_link",
		message: "a link is missing for an event",
	},
	extra_link: {
		code: "chain_extra_link",
		message: "there is a link for an event that was not supplied",
	},
	link_event_mismatch: {
		code: "chain_link_event_mismatch",
		message: "a link names a different event than the one at its seq",
	},
	event_hash_mismatch: {
		code: "chain_event_hash_mismatch",
		message: "an event is not the event its link was made from",
	},
	wrong_genesis: {
		code: "chain_wrong_genesis",
		message: "the first link is not bound to this note",
	},
	broken_link: {
		code: "chain_broken_link",
		message: "a link does not follow from the link before it",
	},
};

const chainFailure = (
	code: NoteChainFailure,
	message: string,
	seq?: number,
): NoteChainVerdict =>
	seq === undefined
		? { ok: false, code, message }
		: { ok: false, code, message, seq };

const isLink = objectOf({
	seq: isSequence,
	event_id: isText,
	event_hash: isHash,
	prev_hash: isHash,
});

const readEvents = (events: readonly unknown[]): NoteEvent[] | null => {
	const parsed: NoteEvent[] = [];
	for (const event of events) {
		try {
			parsed.push(parseNoteEvent(event));
		} catch {
			return null;
		}
	}
	return parsed;
};

const readLinks = (links: readonly unknown[]): ChainLink[] | null => {
	const parsed: ChainLink[] = [];
	for (const link of links) {
		if (!isLink(link)) return null;
		// `isLink` checked the exact keys and their spellings.
		parsed.push(link as unknown as ChainLink);
	}
	return parsed;
};

interface ReadChain {
	events: NoteEvent[];
	links: ChainLink[];
}

const readChain = (
	events: unknown,
	links: unknown,
): ReadChain | NoteChainVerdict => {
	if (!(Array.isArray(events) && Array.isArray(links))) {
		return chainFailure("bad_input", "events and links must be arrays");
	}
	const parsedEvents = readEvents(events);
	if (parsedEvents === null) {
		return chainFailure("bad_event", "an event is not a note event");
	}
	const parsedLinks = readLinks(links);
	if (parsedLinks === null) {
		return chainFailure(
			"bad_link",
			"a link does not have exactly seq, event_id, event_hash and prev_hash",
		);
	}
	return { events: parsedEvents, links: parsedLinks };
};

const isReadChain = (value: ReadChain | NoteChainVerdict): value is ReadChain =>
	"links" in value;

const verifyReadChain = async (
	read: ReadChain,
	expectedNoteId: string | undefined,
): Promise<NoteChainVerdict> => {
	const verdict = await verifyChain(read.events, read.links, expectedNoteId);
	if (!verdict.ok) {
		const { code, message } = CHAIN_FAILURES[verdict.reason];
		return chainFailure(code, message, verdict.seq);
	}
	const last = read.links[read.links.length - 1];
	const [first] = read.events;
	if (last === undefined || first === undefined) {
		return chainFailure("chain_missing_link", "the chain is empty");
	}
	return {
		ok: true,
		note_id: first.note_id,
		length: read.links.length,
		head: { seq: last.seq, head_hash: await linkHash(last) },
	};
};

/**
 * Shape-checks `events` (each must be a note event) and `links` (each exactly seq, event_id, event_hash, prev_hash), then
 * has tfd-notes recompute the chain from the events and compare it with the links. `events` must be in seq order.
 * Never throws.
 *
 * A pass proves hash-chain consistency only, not authenticity: anyone can edit an event, rebuild every link and pass
 * this check. Authenticity needs a verified `note.chain-seal` at the head of the chain, which `verifyNoteBundle` checks.
 */
export const verifyNoteChain = async (
	events: unknown[],
	links: unknown[],
	expectedNoteId?: string,
): Promise<NoteChainVerdict> => {
	try {
		const read = readChain(events, links);
		if (!isReadChain(read)) return read;
		return await verifyReadChain(read, expectedNoteId);
	} catch {
		return chainFailure("bad_input", "the chain could not be read");
	}
};

// ---- the bundle ----

/** Why a bundle has no verified seal at the head of its chain. */
export type NoteSealFailure =
	| "chain_unsealed"
	| "chain_seal_stale"
	| "chain_seal_mismatch";

export type NoteSealVerdict =
	| {
			ok: true;
			key_id: string;
			sealed_at: string;
			/** The head the seal names, which is the head of the supplied chain. */
			head: ChainHead;
	  }
	| {
			ok: false;
			code: NoteSealFailure;
			message: string;
			/** For `chain_seal_stale`: how many events come after the latest seal's head. */
			unsealed_events?: number;
	  };

/** Why a document that verified on its own does not fit the chain it came with. */
export type NoteBundleFailure =
	| "chain_not_verified"
	| "note_id_mismatch"
	| "chain_head_unknown"
	| "chain_head_mismatch"
	| "event_not_in_chain"
	| "event_after_head"
	| "event_hash_mismatch"
	| "wrong_event_type";

export type NoteBundleDocumentVerdict =
	| Extract<NoteVerdict, { ok: true }>
	| {
			ok: false;
			code: NoteDocumentFailure | NoteBundleFailure;
			message: string;
	  };

export interface NoteBundle {
	events: unknown[];
	links: unknown[];
	documents: unknown[];
	keys: KeysInput;
}

export interface NoteBundleVerdict {
	/**
	 * True only when the chain passes, every document passes and fits the chain, and a verified `note.chain-seal` names
	 * the chain's head: its `head_seq` is the number of links and its `head_hash` is the recomputed head.
	 */
	ok: boolean;
	/** Set when `ok` is false only because the chain has no verified seal at its head (see `seal`). */
	code?: NoteSealFailure;
	chain: NoteChainVerdict;
	/** The seal at the head of the chain, or why there is none; null when the chain itself did not verify. */
	seal: NoteSealVerdict | null;
	/** One verdict per supplied document, in the order they were given. */
	documents: NoteBundleDocumentVerdict[];
}

const bundleFailure = (
	code: NoteBundleFailure,
	message: string,
): NoteBundleDocumentVerdict => ({ ok: false, code, message });

/** What a chain recomputed from the links says: the head hash at each seq, and the link of each event id. */
interface ChainIndex {
	noteId: string;
	headHashBySeq: Map<number, string>;
	linkByEventId: Map<string, ChainLink>;
	eventById: Map<string, NoteEvent>;
}

const indexChain = async (read: ReadChain): Promise<ChainIndex> => {
	const headHashBySeq = new Map<number, string>();
	const linkByEventId = new Map<string, ChainLink>();
	for (const link of read.links) {
		headHashBySeq.set(link.seq, await linkHash(link));
		linkByEventId.set(link.event_id, link);
	}
	const eventById = new Map<string, NoteEvent>();
	for (const event of read.events) eventById.set(event.id, event);
	return {
		noteId: read.events[0]?.note_id ?? "",
		headHashBySeq,
		linkByEventId,
		eventById,
	};
};

const checkHead = (
	head: ChainHead,
	index: ChainIndex,
): NoteBundleDocumentVerdict | null => {
	const expected = index.headHashBySeq.get(head.seq);
	if (expected === undefined) {
		return bundleFailure(
			"chain_head_unknown",
			`the document names chain seq ${head.seq}, which is beyond the supplied chain`,
		);
	}
	if (expected !== head.head_hash) {
		return bundleFailure(
			"chain_head_mismatch",
			`the document's head at seq ${head.seq} is not the head of the supplied chain`,
		);
	}
	return null;
};

const checkNamedEvent = (
	eventId: string,
	namedHash: string,
	expectedType: NoteEvent["type"],
	head: ChainHead,
	index: ChainIndex,
): NoteBundleDocumentVerdict | null => {
	const link = index.linkByEventId.get(eventId);
	const event = index.eventById.get(eventId);
	if (link === undefined || event === undefined) {
		return bundleFailure(
			"event_not_in_chain",
			`event ${eventId} is not in the supplied chain`,
		);
	}
	if (event.type !== expectedType) {
		return bundleFailure(
			"wrong_event_type",
			`event ${eventId} is not a ${expectedType} event`,
		);
	}
	if (link.seq > head.seq) {
		return bundleFailure(
			"event_after_head",
			`event ${eventId} comes after the chain head the document names`,
		);
	}
	if (link.event_hash !== namedHash) {
		return bundleFailure(
			"event_hash_mismatch",
			`the hash the document names for event ${eventId} is not the hash of that event`,
		);
	}
	return null;
};

const fitDocumentToChain = (
	verdict: Extract<NoteVerdict, { ok: true }>,
	index: ChainIndex,
): NoteBundleDocumentVerdict => {
	const { document } = verdict;
	if (document.note_id !== index.noteId) {
		return bundleFailure(
			"note_id_mismatch",
			"the document is for a different note than the supplied chain",
		);
	}
	const headProblem = checkHead(verdict.chain_head, index);
	if (headProblem !== null) return headProblem;
	if (document.type === "note.payment-receipt") {
		const problem = checkNamedEvent(
			document.payment_event_id,
			document.event_hash,
			"payment.recorded",
			verdict.chain_head,
			index,
		);
		if (problem !== null) return problem;
	}
	if (document.type === "note.release") {
		const problem = checkNamedEvent(
			document.release_event_id,
			document.release_event_hash,
			"release.confirmed",
			verdict.chain_head,
			index,
		);
		if (problem !== null) return problem;
	}
	return verdict;
};

/** A seal that verified on its own, for this note: the document verdicts before they are fitted to the chain. */
type VerifiedSeal = Extract<NoteVerdict, { ok: true }> & {
	document: Extract<SignedDocument, { type: "note.chain-seal" }>;
};

const isSealOf = (
	verdict: NoteVerdict,
	noteId: string,
): verdict is VerifiedSeal =>
	verdict.ok &&
	verdict.document.type === "note.chain-seal" &&
	verdict.document.note_id === noteId;

const sealFailure = (
	code: NoteSealFailure,
	message: string,
	unsealedEvents?: number,
): NoteSealVerdict =>
	unsealedEvents === undefined
		? { ok: false, code, message }
		: { ok: false, code, message, unsealed_events: unsealedEvents };

/**
 * Whether a verified seal names the head of the chain. Among the verified seals of this note it looks at the latest one
 * (highest `head_seq`): equal to the chain's length with the recomputed head hash is sealed; an earlier seq whose hash
 * is the chain's head at that seq is stale (events came after it); anything else does not match the chain.
 */
const sealAtHead = (
	verdicts: readonly NoteVerdict[],
	index: ChainIndex,
): NoteSealVerdict => {
	const seals = verdicts.filter((verdict): verdict is VerifiedSeal =>
		isSealOf(verdict, index.noteId),
	);
	if (seals.length === 0) {
		return sealFailure(
			"chain_unsealed",
			"no verified chain seal came with the chain, so nothing shows it is the chain the keys signed",
		);
	}
	const length = index.headHashBySeq.size;
	const exact = seals.find(
		(seal) =>
			seal.document.head_seq === length &&
			seal.document.head_hash === index.headHashBySeq.get(length),
	);
	if (exact !== undefined) {
		return {
			ok: true,
			key_id: exact.key_id,
			sealed_at: exact.signed_at,
			head: exact.chain_head,
		};
	}
	const latest = seals.reduce((best, seal) =>
		seal.document.head_seq > best.document.head_seq ? seal : best,
	);
	const { head_seq: headSeq, head_hash: headHash } = latest.document;
	if (headSeq < length && index.headHashBySeq.get(headSeq) === headHash) {
		return sealFailure(
			"chain_seal_stale",
			`the latest chain seal is at seq ${headSeq}, and ${length - headSeq} event(s) come after it without a seal`,
			length - headSeq,
		);
	}
	return sealFailure(
		"chain_seal_mismatch",
		`the chain seal at seq ${headSeq} does not name the head of the supplied chain (${length} events)`,
	);
};

const verifyBundleChecked = async (
	bundle: unknown,
): Promise<NoteBundleVerdict> => {
	if (
		!(
			isRecord(bundle) &&
			Array.isArray(bundle.documents) &&
			isRecord(bundle.keys)
		)
	) {
		return {
			ok: false,
			chain: chainFailure(
				"bad_input",
				"a bundle needs events, links, documents and keys",
			),
			seal: null,
			documents: [],
		};
	}
	const keys = bundle.keys as KeysInput;
	const read = readChain(bundle.events, bundle.links);
	const chain = isReadChain(read)
		? await verifyReadChain(read, undefined)
		: read;
	const index =
		chain.ok && isReadChain(read) ? await indexChain(read) : undefined;
	const documents: NoteBundleDocumentVerdict[] = [];
	const alone: NoteVerdict[] = [];
	for (const document of bundle.documents) {
		const verdict = await verifyNoteDocument(document, keys);
		alone.push(verdict);
		if (!verdict.ok) {
			documents.push(verdict);
		} else if (index === undefined) {
			documents.push(
				bundleFailure(
					"chain_not_verified",
					"the supplied chain did not verify, so the document cannot be checked against it",
				),
			);
		} else {
			documents.push(fitDocumentToChain(verdict, index));
		}
	}
	const seal = index === undefined ? null : sealAtHead(alone, index);
	const documentsOk = documents.every((verdict) => verdict.ok);
	const verdict: NoteBundleVerdict = {
		ok: chain.ok && documentsOk && seal?.ok === true,
		chain,
		seal,
		documents,
	};
	if (seal !== null && !seal.ok) verdict.code = seal.code;
	return verdict;
};

/**
 * Verifies a note's chain and every document that came with it, then checks that each document fits the chain: it is
 * for this note, the head it names is the chain's head at that seq (`chain_head_unknown` when that seq is beyond the
 * supplied chain), a chain seal's head equals a recomputed link head, and a payment receipt's or release's event hash is
 * the hash of the event it names. It then needs a seal at the head: `ok` is true only when a `note.chain-seal` document
 * verifies and names the chain's head (`head_seq` equal to the number of links, `head_hash` equal to the recomputed
 * head). Without one `ok` is false with `code` `chain_unsealed` (no verified seal), `chain_seal_stale` (the latest seal
 * is at an earlier seq; `seal.unsealed_events` counts the events after it) or `chain_seal_mismatch`. A chain with no
 * seal, or an event added after the last seal, therefore never passes. Never throws.
 */
export const verifyNoteBundle = async (
	bundle: NoteBundle,
): Promise<NoteBundleVerdict> => {
	try {
		return await verifyBundleChecked(bundle);
	} catch {
		return {
			ok: false,
			chain: chainFailure("bad_input", "the bundle could not be read"),
			seal: null,
			documents: [],
		};
	}
};
