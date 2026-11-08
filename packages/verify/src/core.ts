// SPDX-License-Identifier: Apache-2.0
/**
 * tfd-verify: tfd's receipt and seal checks (packages/atm/src/ledger/receipt.ts, seal.ts, sign.ts, util.ts) for any
 * JavaScript runtime with WebCrypto, ported line for line so a receipt gets the verdict here that it gets from tfd:
 *
 * - canonical bytes: JSON.stringify with object keys sorted (UTF-16 code unit order) and undefined values dropped;
 * - event_hash and events_hash: sha256 (hex) of those bytes as UTF-8;
 * - sig: Ed25519 (RFC 8032, strict) over the receipt's canonical bytes, base64url without padding, one spelling only;
 * - keys: key id to a PEM, read as tfd's createPublicKey reads it under Bun (ed25519FromPem has the one difference).
 *
 * In a browser it runs entirely on the page: no network, nothing uploaded. Hashing uses WebCrypto; Ed25519 uses
 * @noble/ed25519, whose own SHA-512 also comes from WebCrypto, so the code shipped is small. No node:* imports.
 * tests/golden.test.ts runs tfd's receipt test vectors against it; tests/pem.test.ts holds its key reading to tfd's verdicts.
 */
import { getPublicKeyAsync, verifyAsync } from "@noble/ed25519";

export type PublicKeys = Record<string, string>;

export type Receipt = {
	v: 1;
	school: string;
	key: string;
	event_id: string;
	event_type: "payment.succeeded" | "payment.refunded";
	event_time: string;
	date: string;
	amount: number;
	currency: string;
	stripe_id: string;
	cause: string | null;
	event_hash: string;
};

export type SignedReceipt = { receipt: Receipt; key_id: string; sig: string };

export type Seal = {
	v: 1;
	school: string;
	month: string;
	events: number;
	event_ids: string[];
	transactions: number;
	events_hash: string;
	sealed_at: string;
	prev_seal_hash: string | null;
};

export type SignedSeal = { seal: Seal; key_id: string; sig: string };

/** The fields of a tfd event the checks read. Everything else is hashed as given. */
export type BooksEvent = {
	id: string;
	event_type: string;
	school: string;
	key: string;
	event_time: string;
	date: string;
	cause?: string;
	postings: unknown[];
	payload: Record<string, unknown>;
	[field: string]: unknown;
};

export type SignatureVerdict =
	| "ok"
	| "malformed"
	| "unknown_key"
	| "bad_signature";
export type BooksVerdict =
	| "ok"
	| "missing_event"
	| "event_changed"
	| "not_receipted";
export type SealVerdict =
	| "ok"
	| "malformed"
	| "unknown_key"
	| "bad_signature"
	| "broken_link"
	| "events_changed";

// ---- canonical bytes (tfd src/ledger/util.ts) ----

const sortKeys = (value: unknown): unknown => {
	if (Array.isArray(value)) return value.map(sortKeys);
	if (typeof value === "object" && value !== null) {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.filter(([, v]) => v !== undefined)
				.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
				.map(([k, v]) => [k, sortKeys(v)]),
		);
	}
	return value;
};

export const canonicalize = (value: unknown): string =>
	JSON.stringify(sortKeys(value));

const encoder = new TextEncoder();

export const sha256Hex = async (text: string): Promise<string> => {
	const digest = await crypto.subtle.digest("SHA-256", encoder.encode(text));
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
};

// ---- base64 and keys (tfd src/ledger/sign.ts) ----

const BASE64URL =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const base64urlDecode = (text: string): Uint8Array => {
	const bytes: number[] = [];
	let buffer = 0;
	let bits = 0;
	for (const char of text) {
		const index = BASE64URL.indexOf(char);
		if (index < 0) continue;
		buffer = (buffer << 6) | index;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((buffer >> bits) & 0xff);
		}
	}
	return Uint8Array.from(bytes);
};

const base64urlEncode = (bytes: Uint8Array): string => {
	let text = "";
	let buffer = 0;
	let bits = 0;
	for (const byte of bytes) {
		buffer = (buffer << 8) | byte;
		bits += 8;
		while (bits >= 6) {
			bits -= 6;
			text += BASE64URL[(buffer >> bits) & 0x3f];
		}
	}
	if (bits > 0) text += BASE64URL[(buffer << (6 - bits)) & 0x3f];
	return text;
};

// ---- PEM, as tfd's createPublicKey reads it (BoringSSL under Bun: PEM_read_bio, PEM_bytes_read_bio) ----

const BEGIN = "-----BEGIN ";
const END = "-----END ";
const TAIL = "-----\n";
/** BIO_gets(bio, buffer, 254) reads at most 253 bytes: a longer line comes in pieces. */
const PEM_PIECE_BYTES = 253;
/** After a header's blank line, every data line but the last is 64 characters and a newline. */
const PEM_DATA_LINE = 65;
const PEM_BASE64 =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

type PemBlock = { name: string; header: string; data: Uint8Array };

/** The text's UTF-8 bytes, one character per byte, in the pieces BIO_gets reads: up to and including a newline. */
const pemPieces = (text: string): string[] => {
	let bytes = "";
	for (const byte of encoder.encode(text)) bytes += String.fromCharCode(byte);
	const pieces: string[] = [];
	let start = 0;
	while (start < bytes.length) {
		const newline = bytes.indexOf("\n", start);
		const lineEnd = newline < 0 ? bytes.length : newline + 1;
		const end = Math.min(lineEnd, start + PEM_PIECE_BYTES);
		pieces.push(bytes.slice(start, end));
		start = end;
	}
	return pieces;
};

/** A piece with trailing bytes up to space dropped, then a newline. `char` is signed, so bytes from 0x80 count too. */
const stripPiece = (piece: string): string => {
	let length = piece.length;
	while (length > 0) {
		const code = piece.charCodeAt(length - 1);
		if (code > 0x20 && code < 0x80) break;
		length--;
	}
	return `${piece.slice(0, length)}\n`;
};

/** EVP_DecodeUpdate then EVP_DecodeFinal: whitespace skipped, whole quads, `=` only to end the last one. */
const decodePemBase64 = (text: string): Uint8Array | null => {
	const bytes: number[] = [];
	let quad: string[] = [];
	let ended = false;
	for (const char of text) {
		if (char === " " || char === "\t" || char === "\r" || char === "\n")
			continue;
		if (ended) return null;
		quad.push(char);
		if (quad.length < 4) continue;
		const [a, b, c, d] = quad.map((each) =>
			each === "=" ? 0 : PEM_BASE64.indexOf(each),
		) as [number, number, number, number];
		const padding = quad.map((each) => (each === "=" ? "=" : "x")).join("") as
			| "xxxx"
			| "xxx="
			| "xx==";
		if (a < 0 || b < 0 || c < 0 || d < 0) return null;
		if (padding !== "xxxx" && padding !== "xxx=" && padding !== "xx==")
			return null;
		const value = (a << 18) | (b << 12) | (c << 6) | d;
		bytes.push((value >> 16) & 0xff);
		if (padding !== "xx==") bytes.push((value >> 8) & 0xff);
		if (padding === "xxxx") bytes.push(value & 0xff);
		else ended = true;
		quad = [];
	}
	return quad.length === 0 ? Uint8Array.from(bytes) : null;
};

/**
 * PEM_read_bio over the whole text: each block's name, header and data in order, up to the first block it cannot read
 * (the reader stops there, so later blocks are never seen). Text between blocks is skipped.
 */
const readPemBlocks = (text: string): PemBlock[] => {
	const pieces = pemPieces(text);
	const blocks: PemBlock[] = [];
	let at = 0;
	const next = (): string | null =>
		at < pieces.length ? stripPiece(pieces[at++] as string) : null;
	for (;;) {
		let name: string | null = null;
		for (let line = next(); line !== null && name === null; ) {
			if (
				line.startsWith(BEGIN) &&
				line.length >= BEGIN.length + TAIL.length &&
				line.endsWith(TAIL)
			)
				name = line.slice(BEGIN.length, -TAIL.length);
			else line = next();
		}
		if (name === null) return blocks;
		// Lines up to a blank one are the header; with no blank line before the end line, they are the data.
		let header = "";
		let data = "";
		let line = next();
		while (line !== null && line !== "\n" && !line.startsWith(END)) {
			header += line;
			line = next();
		}
		if (line === null) return blocks;
		if (line.startsWith(END)) {
			data = header;
			header = "";
		} else {
			line = next();
			while (line !== null && !line.startsWith(END)) {
				if (line.length > PEM_DATA_LINE) break;
				data += line;
				if (line.length !== PEM_DATA_LINE) {
					line = next();
					break;
				}
				line = next();
			}
		}
		if (line !== `${END}${name}${TAIL}`) return blocks;
		const decoded = decodePemBase64(data);
		if (!decoded || decoded.length === 0) return blocks;
		blocks.push({ name, header, data: decoded });
	}
};

/** The DER prefix of an Ed25519 SubjectPublicKeyInfo: SEQUENCE { SEQUENCE { OID 1.3.101.112 }, BIT STRING (33 bytes) }. */
const ED25519_SPKI_PREFIX = [
	0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];
/** The DER prefix of an Ed25519 PKCS#8 v1 key: SEQUENCE { INTEGER 0, SEQUENCE { OID }, OCTET STRING { OCTET STRING (32) } }. */
const ED25519_PKCS8_PREFIX = [
	0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04,
	0x22, 0x04, 0x20,
];
const ED25519_KEY_BYTES = 32;
/** The private-key names PEM_read_bio_PrivateKey takes; only PKCS#8 can hold an Ed25519 key. */
const PRIVATE_KEY_NAMES = [
	"PRIVATE KEY",
	"ENCRYPTED PRIVATE KEY",
	"RSA PRIVATE KEY",
	"EC PRIVATE KEY",
	"DSA PRIVATE KEY",
];

/** The 32 bytes after `prefix`, which d2i reads as one element: bytes after it are ignored. */
const keyAfter = (
	der: Uint8Array,
	prefix: readonly number[],
): Uint8Array | null =>
	der.length >= prefix.length + ED25519_KEY_BYTES &&
	prefix.every((byte, index) => der[index] === byte)
		? der.slice(prefix.length, prefix.length + ED25519_KEY_BYTES)
		: null;

/**
 * The raw 32-byte Ed25519 public key that tfd's createPublicKey finds in `pem`, or null where tfd gets none or another
 * kind of key (tfd calls both `unknown_key`). Like node:crypto it takes the first PUBLIC KEY block; failing that, an RSA
 * PUBLIC KEY or CERTIFICATE block (never Ed25519 here); failing that, the first private key, whose public key it derives.
 * A block with a header line is skipped by that step. The one difference: an Ed25519 X.509 certificate gives tfd its key
 * and gives null here.
 */
export const ed25519FromPem = async (
	pem: string,
): Promise<Uint8Array | null> => {
	const blocks = readPemBlocks(pem);
	const first = (names: readonly string[]): PemBlock | undefined =>
		blocks.find((block) => names.includes(block.name));
	const publicBlock = first(["PUBLIC KEY"]);
	if (publicBlock?.header === "")
		return keyAfter(publicBlock.data, ED25519_SPKI_PREFIX);
	for (const names of [
		["RSA PUBLIC KEY"],
		["CERTIFICATE", "X509 CERTIFICATE"],
	]) {
		if (first(names)?.header === "") return null;
	}
	const privateBlock = first(PRIVATE_KEY_NAMES);
	if (privateBlock?.name !== "PRIVATE KEY" || privateBlock.header !== "")
		return null;
	const seed = keyAfter(privateBlock.data, ED25519_PKCS8_PREFIX);
	return seed ? getPublicKeyAsync(seed) : null;
};

/** tfd's verifyBytes: the key by id, then the one base64url spelling of 64 bytes, then strict Ed25519. Never throws. */
export const verifyBytes = async (
	text: string,
	keyId: string,
	sig: string,
	keys: PublicKeys,
): Promise<"ok" | "unknown_key" | "bad_signature"> => {
	const pem = Object.hasOwn(keys, keyId) ? keys[keyId] : undefined;
	if (typeof pem !== "string") return "unknown_key";
	const publicKey = await ed25519FromPem(pem);
	if (!publicKey) return "unknown_key";
	const bytes = base64urlDecode(sig);
	if (base64urlEncode(bytes) !== sig) return "bad_signature";
	try {
		return (await verifyAsync(bytes, encoder.encode(text), publicKey, {
			zip215: false,
		}))
			? "ok"
			: "bad_signature";
	} catch {
		return "bad_signature";
	}
};

// ---- shape checks (schema/receipt.v1.json, schema/seal.v1.json) ----

const isObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const hasExactly = (
	value: Record<string, unknown>,
	keys: readonly string[],
): boolean => {
	const own = Object.keys(value);
	return (
		own.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
	);
};

const isText = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;
const matches = (value: unknown, pattern: RegExp): boolean =>
	typeof value === "string" && pattern.test(value);
const isInteger = (value: unknown, minimum: number): boolean =>
	typeof value === "number" && Number.isInteger(value) && value >= minimum;

const EVENT_ID = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
const MONTH = /^\d{4}-\d{2}$/u;
const HASH = /^[0-9a-f]{64}$/u;
const SIG = /^[A-Za-z0-9_-]{86}$/u;

const RECEIPT_FIELDS = [
	"v",
	"school",
	"key",
	"event_id",
	"event_type",
	"event_time",
	"date",
	"amount",
	"currency",
	"stripe_id",
	"cause",
	"event_hash",
] as const;

const SEAL_FIELDS = [
	"v",
	"school",
	"month",
	"events",
	"event_ids",
	"transactions",
	"events_hash",
	"sealed_at",
	"prev_seal_hash",
] as const;

const SIGNED_FIELDS = (inner: string) => [inner, "key_id", "sig"] as const;

const isReceipt = (value: unknown): value is Receipt =>
	isObject(value) &&
	hasExactly(value, RECEIPT_FIELDS) &&
	value.v === 1 &&
	isText(value.school) &&
	isText(value.key) &&
	matches(value.event_id, EVENT_ID) &&
	(value.event_type === "payment.succeeded" ||
		value.event_type === "payment.refunded") &&
	matches(value.event_time, INSTANT) &&
	matches(value.date, DATE) &&
	isInteger(value.amount, 1) &&
	isText(value.currency) &&
	isText(value.stripe_id) &&
	(value.cause === null || isText(value.cause)) &&
	matches(value.event_hash, HASH);

/** schema/receipt.v1.json, as tfd's Ajv check reads it. */
export const isSignedReceipt = (value: unknown): value is SignedReceipt =>
	isObject(value) &&
	hasExactly(value, SIGNED_FIELDS("receipt")) &&
	isReceipt(value.receipt) &&
	isText(value.key_id) &&
	matches(value.sig, SIG);

const isSeal = (value: unknown): value is Seal => {
	if (!(isObject(value) && hasExactly(value, SEAL_FIELDS))) return false;
	const ids = value.event_ids;
	return (
		value.v === 1 &&
		isText(value.school) &&
		matches(value.month, MONTH) &&
		isInteger(value.events, 0) &&
		Array.isArray(ids) &&
		ids.every(isText) &&
		new Set(ids).size === ids.length &&
		isInteger(value.transactions, 0) &&
		matches(value.events_hash, HASH) &&
		matches(value.sealed_at, INSTANT) &&
		(value.prev_seal_hash === null || matches(value.prev_seal_hash, HASH))
	);
};

/** schema/seal.v1.json plus what tfd's isSignedSeal adds: event_ids strictly increasing and as many as `events`. */
export const isSignedSeal = (value: unknown): value is SignedSeal => {
	if (!(isObject(value) && hasExactly(value, SIGNED_FIELDS("seal"))))
		return false;
	if (!(isSeal(value.seal) && isText(value.key_id) && matches(value.sig, SIG)))
		return false;
	const { event_ids: ids, events } = value.seal;
	return (
		ids.length === events &&
		ids.every((id, index) => index === 0 || (ids[index - 1] as string) < id)
	);
};

// ---- receipts (tfd src/ledger/receipt.ts) ----

const AMOUNT_FIELD: Record<string, string> = {
	"payment.succeeded": "amount_paid",
	"payment.refunded": "amount",
};

const isCents = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value > 0;

/** tfd's receiptOf: null for an event type that gets no receipt; throws when a required payload field is missing. */
export const receiptOf = async (event: BooksEvent): Promise<Receipt | null> => {
	const amountField = Object.hasOwn(AMOUNT_FIELD, event.event_type)
		? AMOUNT_FIELD[event.event_type]
		: undefined;
	if (!amountField) return null;
	const amount = event.payload[amountField];
	const currency = event.payload.currency;
	const stripeId = event.payload.id;
	if (!(isCents(amount) && isText(currency) && isText(stripeId)))
		throw new Error(
			`${event.event_type} ${event.id}: a required payload field is missing`,
		);
	return {
		v: 1,
		school: event.school,
		key: event.key,
		event_id: event.id,
		event_type: event.event_type as Receipt["event_type"],
		event_time: event.event_time,
		date: event.date,
		amount,
		currency,
		stripe_id: stripeId,
		cause: event.cause ?? null,
		event_hash: await sha256Hex(canonicalize(event)),
	};
};

/** tfd's verifyReceipt: shape, then key id, then signature. Never throws. */
export const verifyReceipt = async (
	signed: unknown,
	keys: PublicKeys,
): Promise<SignatureVerdict> => {
	if (!isSignedReceipt(signed)) return "malformed";
	return verifyBytes(
		canonicalize(signed.receipt),
		signed.key_id,
		signed.sig,
		keys,
	);
};

/** tfd's checkReceiptAgainstEvents: the books' event made into a receipt again and compared byte for byte. */
export const checkReceiptAgainstEvents = async (
	signed: SignedReceipt,
	events: readonly BooksEvent[],
): Promise<BooksVerdict> => {
	const event = events.find(
		(candidate) => candidate.id === signed.receipt.event_id,
	);
	if (!event) return "missing_event";
	let again: Receipt | null;
	try {
		again = await receiptOf(event);
	} catch {
		return "event_changed";
	}
	if (!again) return "not_receipted";
	return canonicalize(again) === canonicalize(signed.receipt)
		? "ok"
		: "event_changed";
};

// ---- seals (tfd src/ledger/seal.ts) ----

/** What the next seal names as prev_seal_hash. */
const sealHash = (signed: unknown): Promise<string> =>
	sha256Hex(canonicalize(signed));

/**
 * tfd's verifySeals verdicts for a school's seal chain (in the order made) against its events: shape and signature,
 * the link to the seal before, then the named events hashed and counted again.
 */
export const verifySealChain = async (
	seals: readonly unknown[],
	events: readonly BooksEvent[],
	keys: PublicKeys,
): Promise<SealVerdict[]> => {
	const byMonth = new Map<string, Map<string, BooksEvent>>();
	for (const event of events) {
		if (event.date[7] !== "-") continue;
		const month = event.date.slice(0, 7);
		const byId = byMonth.get(month) ?? new Map<string, BooksEvent>();
		byId.set(event.id, event);
		byMonth.set(month, byId);
	}
	const verdicts: SealVerdict[] = [];
	for (const [index, raw] of seals.entries()) {
		if (!isSignedSeal(raw)) {
			verdicts.push("malformed");
			continue;
		}
		const signature = await verifyBytes(
			canonicalize(raw.seal),
			raw.key_id,
			raw.sig,
			keys,
		);
		if (signature !== "ok") {
			verdicts.push(signature);
			continue;
		}
		const expected = index === 0 ? null : await sealHash(seals[index - 1]);
		if (raw.seal.prev_seal_hash !== expected) {
			verdicts.push("broken_link");
			continue;
		}
		const inMonth = byMonth.get(raw.seal.month);
		const covered = raw.seal.event_ids.map((id) => inMonth?.get(id));
		if (covered.some((event) => event === undefined)) {
			verdicts.push("events_changed");
			continue;
		}
		const present = covered as BooksEvent[];
		const transactions = present.filter(
			(event) => event.postings.length > 0,
		).length;
		const eventsHash = await sha256Hex(
			present.map((event) => canonicalize(event)).join("\n"),
		);
		verdicts.push(
			transactions === raw.seal.transactions &&
				eventsHash === raw.seal.events_hash
				? "ok"
				: "events_changed",
		);
	}
	return verdicts;
};
