// SPDX-License-Identifier: Apache-2.0
/**
 * Offline verification of note documents (src/notes.ts): the CC0 vectors in tfd-notes verify, and each way a document,
 * a chain or a bundle can be wrong gets its own code. The signing keys are the published TEST keys of tfd-notes
 * (tests/note-signer.ts); nothing here is a real key.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
	buildChain,
	type ChainLink,
	canonicalJson,
	chainHead,
	chainSealBody,
	paymentReceiptBody,
	signDocument,
	toBase64Url,
	utf8Bytes,
	validateStream,
} from "tfd-notes";
import type { PublicKeys } from "tfd-verify";
import {
	makeTestSigner,
	TEST_RECEIPT_KEY_ID,
	TEST_SEAL_KEY_ID,
	type TestSigner,
} from "../../tfd-notes/tests/note-signer";
import {
	type NoteBundle,
	verifyNoteBundle,
	verifyNoteChain,
	verifyNoteDocument,
} from "../src/notes";

const NOTES_TESTS = join(import.meta.dir, "../../tfd-notes/tests/golden");
const SRC = join(import.meta.dir, "../src");
const SPKI_PREFIX_HEX = "302a300506032b6570032100";
const ISSUED_AT = "2026-03-05T12:00:00Z";

type Json = Record<string, unknown>;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const readGolden = async (relative: string): Promise<Json> => {
	const path = join(NOTES_TESTS, relative);
	try {
		return JSON.parse(await readFile(path, "utf8")) as Json;
	} catch (error) {
		throw new Error(
			`the tfd-notes vector ${path} is missing or unreadable; these tests read it by relative path (${String(error)})`,
		);
	}
};

const fromHex = (hex: string): Uint8Array =>
	Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));

const base64 = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes));

const pemOfPublicHex = (publicKeyHex: string): string =>
	`-----BEGIN PUBLIC KEY-----\n${base64(fromHex(`${SPKI_PREFIX_HEX}${publicKeyHex}`))}\n-----END PUBLIC KEY-----\n`;

/** Signs `body` as `signer` does, but lets a test choose the key id and the purpose the signature block declares. */
const signWith = async (
	body: Json,
	signer: TestSigner,
	declared: { keyId?: string; purpose?: string } = {},
): Promise<Json> => ({
	...body,
	signature: {
		key_id: declared.keyId ?? signer.keyId,
		purpose: declared.purpose ?? signer.purpose,
		alg: "Ed25519",
		sig: toBase64Url(await signer.sign(utf8Bytes(canonicalJson(body)))),
	},
});

const bodyOf = (document: Json): Json => {
	const { signature: _signature, ...body } = document;
	return body;
};

const WINDOW = { not_before: "2026-01-01T00:00:00Z", not_after: null };

let input: Json;
let documents: Record<string, Json>;
let events: unknown[];
let links: ChainLink[];
let receiptSigner: TestSigner;
let sealSigner: TestSigner;
let bareKeys: PublicKeys;
let windowedKeys: PublicKeys;
let bundle: NoteBundle;

const keysWith = (
	receipt: Record<string, unknown>,
	seal: Record<string, unknown> = {},
): PublicKeys => ({
	[TEST_RECEIPT_KEY_ID]: {
		pem: pemOfPublicHex(receiptSigner.publicKeyHex),
		purpose: "receipt",
		...WINDOW,
		...receipt,
	} as PublicKeys[string],
	[TEST_SEAL_KEY_ID]: {
		pem: pemOfPublicHex(sealSigner.publicKeyHex),
		purpose: "seal",
		...WINDOW,
		...seal,
	} as PublicKeys[string],
});

const verifyBundle = (changes: Partial<NoteBundle>) =>
	verifyNoteBundle({ ...bundle, ...changes });

beforeAll(async () => {
	input = await readGolden("documents/small-note.input.json");
	const expected = await readGolden("documents/small-note.expected.json");
	documents = expected.documents as Record<string, Json>;
	events = input.events as unknown[];
	links = await buildChain(validateStream(events));
	receiptSigner = await makeTestSigner(TEST_RECEIPT_KEY_ID, "receipt");
	sealSigner = await makeTestSigner(TEST_SEAL_KEY_ID, "seal");
	const publicKeys = expected.public_keys as Record<string, string>;
	expect(publicKeys[TEST_RECEIPT_KEY_ID]).toBe(receiptSigner.publicKeyHex);
	expect(publicKeys[TEST_SEAL_KEY_ID]).toBe(sealSigner.publicKeyHex);
	bareKeys = {
		[TEST_RECEIPT_KEY_ID]: pemOfPublicHex(receiptSigner.publicKeyHex),
		[TEST_SEAL_KEY_ID]: pemOfPublicHex(sealSigner.publicKeyHex),
	};
	windowedKeys = keysWith({});
	bundle = {
		events,
		links,
		documents: [
			documents.payment_receipt,
			documents.payoff_statement,
			documents.release,
			documents.chain_seal,
		],
		keys: windowedKeys,
	};
});

describe("the CC0 vectors verify", () => {
	for (const name of [
		"payment_receipt",
		"payoff_statement",
		"release",
		"chain_seal",
	]) {
		test(`${name} verifies with bare PEMs and with windowed keys`, async () => {
			for (const keys of [bareKeys, windowedKeys]) {
				const verdict = await verifyNoteDocument(documents[name], keys);
				expect(verdict.ok).toBe(true);
			}
		});
	}

	test("the verdict names the type, key and signed time", async () => {
		const receipt = await verifyNoteDocument(
			documents.payment_receipt,
			windowedKeys,
		);
		expect(receipt).toMatchObject({
			ok: true,
			type: "note.payment-receipt",
			key_id: TEST_RECEIPT_KEY_ID,
			note_id: "note-demo-1",
			signed_at: ISSUED_AT,
		});
		const seal = await verifyNoteDocument(documents.chain_seal, windowedKeys);
		expect(seal).toMatchObject({
			ok: true,
			type: "note.chain-seal",
			key_id: TEST_SEAL_KEY_ID,
			chain_head: { seq: 9 },
		});
	});

	test("the vector's seal is at the head of its chain, so the bundle names it", async () => {
		const verdict = await verifyNoteBundle(bundle);
		expect(verdict.seal).toMatchObject({
			ok: true,
			key_id: TEST_SEAL_KEY_ID,
			head: { seq: 9 },
		});
		expect(verdict.code).toBeUndefined();
	});

	test("the chain and the whole bundle verify", async () => {
		const chain = await verifyNoteChain(events, links, "note-demo-1");
		expect(chain).toMatchObject({
			ok: true,
			note_id: "note-demo-1",
			length: 9,
		});
		const head = await chainHead(links);
		expect(chain.ok && chain.head).toEqual(head);
		const verdict = await verifyNoteBundle(bundle);
		expect(verdict.ok).toBe(true);
		expect(verdict.documents).toHaveLength(4);
		expect(verdict.documents.every((entry) => entry.ok)).toBe(true);
	});

	test("the tfd-notes chain vectors verify too", async () => {
		for (const name of ["small-note", "value-dates-out-of-order"]) {
			const chainInput = await readGolden(`chain/${name}.input.json`);
			const expected = await readGolden(`chain/${name}.expected.json`);
			const verdict = await verifyNoteChain(
				chainInput.events as unknown[],
				expected.links as unknown[],
			);
			expect(verdict.ok).toBe(true);
		}
	});
});

describe("document failures", () => {
	test("changing one field of the body breaks the signature", async () => {
		const edits: [string, (document: Json) => void][] = [
			[
				"amount_minor",
				(document) => {
					document.amount_minor = "20001";
				},
			],
			[
				"note_id",
				(document) => {
					document.note_id = "note-demo-2";
				},
			],
			[
				"issued_at",
				(document) => {
					document.issued_at = "2026-03-05T12:00:01Z";
				},
			],
			[
				"chain_head.head_hash",
				(document) => {
					(document.chain_head as Json).head_hash = `0${String(
						(document.chain_head as Json).head_hash,
					).slice(1)}`;
				},
			],
			[
				"status",
				(document) => {
					document.status = "disputed";
				},
			],
		];
		for (const [field, edit] of edits) {
			const document = clone(documents.payment_receipt) as Json;
			edit(document);
			const verdict = await verifyNoteDocument(document, windowedKeys);
			expect({ field, ok: verdict.ok }).toEqual({ field, ok: false });
			expect(!verdict.ok && verdict.code).toBe("bad_signature");
		}
	});

	test("a changed byte in any field of any document is refused", async () => {
		for (const [name, original] of Object.entries(documents)) {
			for (const field of Object.keys(bodyOf(original))) {
				const document = clone(original) as Json;
				const value = document[field];
				if (typeof value === "string") {
					document[field] = value.endsWith("x")
						? `${value.slice(0, -1)}y`
						: `${value.slice(0, -1)}x`;
				} else if (typeof value === "number") {
					document[field] = value + 1;
				} else if (typeof value === "boolean") {
					document[field] = !value;
				} else {
					const nested = value as Json;
					const [first] = Object.keys(nested);
					nested[first as string] = "x";
				}
				const verdict = await verifyNoteDocument(document, windowedKeys);
				expect({ name, field, ok: verdict.ok }).toEqual({
					name,
					field,
					ok: false,
				});
			}
		}
	});

	test("a key id nobody published is unknown_key", async () => {
		const document = clone(documents.payment_receipt) as Json;
		(document.signature as Json).key_id = "note-test-2";
		const verdict = await verifyNoteDocument(document, windowedKeys);
		expect(!verdict.ok && verdict.code).toBe("unknown_key");
	});

	test("another published key's id fails the signature", async () => {
		const document = clone(documents.payment_receipt) as Json;
		(document.signature as Json).key_id = TEST_SEAL_KEY_ID;
		const verdict = await verifyNoteDocument(document, bareKeys);
		expect(!verdict.ok && verdict.code).toBe("bad_signature");
	});

	test("a receipt signed with the seal key is refused", async () => {
		const body = bodyOf(documents.payment_receipt);
		const declaresSeal = await signWith(body, sealSigner);
		const declaredSeal = await verifyNoteDocument(declaresSeal, windowedKeys);
		expect(!declaredSeal.ok && declaredSeal.code).toBe("wrong_purpose");
		const claimsReceipt = await signWith(body, sealSigner, {
			purpose: "receipt",
		});
		const keyPurpose = await verifyNoteDocument(claimsReceipt, windowedKeys);
		expect(!keyPurpose.ok && keyPurpose.code).toBe("key_wrong_purpose");
	});

	test("a seal signed with the receipt key is refused", async () => {
		const body = bodyOf(documents.chain_seal);
		const declaresReceipt = await signWith(body, receiptSigner);
		const declared = await verifyNoteDocument(declaresReceipt, windowedKeys);
		expect(!declared.ok && declared.code).toBe("wrong_purpose");
		const claimsSeal = await signWith(body, receiptSigner, { purpose: "seal" });
		const keyPurpose = await verifyNoteDocument(claimsSeal, windowedKeys);
		expect(!keyPurpose.ok && keyPurpose.code).toBe("key_wrong_purpose");
	});

	test("an expired key and a key not yet valid fail as keyUse says", async () => {
		const expired = keysWith({ not_after: "2026-03-05T12:00:00Z" });
		const verdict = await verifyNoteDocument(
			documents.payment_receipt,
			expired,
		);
		expect(!verdict.ok && verdict.code).toBe("outside_key_window");
		const early = keysWith({ not_before: "2026-03-05T12:00:01Z" });
		const tooEarly = await verifyNoteDocument(documents.payment_receipt, early);
		expect(!tooEarly.ok && tooEarly.code).toBe("outside_key_window");
		const justValid = keysWith({ not_before: ISSUED_AT });
		expect(
			(await verifyNoteDocument(documents.payment_receipt, justValid)).ok,
		).toBe(true);
	});

	test("a seal is checked against its sealed_at", async () => {
		const expired = keysWith({}, { not_after: "2026-03-05T12:00:01Z" });
		const verdict = await verifyNoteDocument(documents.chain_seal, expired);
		expect(!verdict.ok && verdict.code).toBe("outside_key_window");
	});

	test("a revoked key never vouches, whatever the dates say", async () => {
		const revoked = keysWith({ revoked_at: "2030-01-01T00:00:00Z" });
		const verdict = await verifyNoteDocument(
			documents.payment_receipt,
			revoked,
		);
		expect(!verdict.ok && verdict.code).toBe("key_revoked");
	});

	test("a signature moved to another document does not verify", async () => {
		const document = clone(documents.payoff_statement) as Json;
		document.signature = clone(documents.payment_receipt.signature);
		const verdict = await verifyNoteDocument(document, windowedKeys);
		expect(!verdict.ok && verdict.code).toBe("bad_signature");
	});

	test("an unknown property is refused, signed or not", async () => {
		const added = { ...clone(documents.release), extra: 1 };
		const verdict = await verifyNoteDocument(added, windowedKeys);
		expect(!verdict.ok && verdict.code).toBe("bad_shape");
		const signedWithExtra = await signWith(
			{ ...bodyOf(documents.release), extra: 1 },
			receiptSigner,
		);
		const resigned = await verifyNoteDocument(signedWithExtra, windowedKeys);
		expect(!resigned.ok && resigned.code).toBe("bad_shape");
		const insideSignature = clone(documents.release) as Json;
		(insideSignature.signature as Json).extra = true;
		const nested = await verifyNoteDocument(insideSignature, windowedKeys);
		expect(!nested.ok && nested.code).toBe("bad_shape");
	});

	test("a missing field, a wrong type and a bad money string are bad_shape", async () => {
		const missing = clone(documents.payment_receipt) as Json;
		delete missing.currency;
		const wrongType = clone(documents.payment_receipt) as Json;
		wrongType.exponent = "2";
		const badMoney: Json[] = [];
		for (const value of ["020000", "-5", "1.5", "", " 1", "1e3", "٣"]) {
			const document = clone(documents.payment_receipt) as Json;
			document.amount_minor = value;
			badMoney.push(document);
		}
		for (const document of [missing, wrongType, ...badMoney]) {
			const verdict = await verifyNoteDocument(document, windowedKeys);
			expect(!verdict.ok && verdict.code).toBe("bad_shape");
		}
	});

	test("uppercase hex is a bad hash", async () => {
		const document = clone(documents.payment_receipt) as Json;
		document.event_hash = String(document.event_hash).toUpperCase();
		const verdict = await verifyNoteDocument(document, windowedKeys);
		expect(!verdict.ok && verdict.code).toBe("bad_shape");
		const seal = clone(documents.chain_seal) as Json;
		seal.head_hash = String(seal.head_hash).toUpperCase();
		const sealVerdict = await verifyNoteDocument(seal, windowedKeys);
		expect(!sealVerdict.ok && sealVerdict.code).toBe("bad_shape");
	});

	test("base64 padding, the standard alphabet and short signatures are bad_signature_encoding", async () => {
		const original = String((documents.payment_receipt.signature as Json).sig);
		const spellings = [
			`${original}=`,
			`${original}==`,
			original.replaceAll("-", "+").replaceAll("_", "/") === original
				? `${original.slice(0, -1)}+`
				: original.replaceAll("-", "+").replaceAll("_", "/"),
			original.slice(0, -4),
			"",
			` ${original}`,
		];
		for (const sig of spellings) {
			const document = clone(documents.payment_receipt) as Json;
			(document.signature as Json).sig = sig;
			const verdict = await verifyNoteDocument(document, windowedKeys);
			expect({ sig, code: !verdict.ok && verdict.code }).toEqual({
				sig,
				code: "bad_signature_encoding",
			});
		}
	});

	test("the schema string and the type are checked first", async () => {
		const otherSchema = {
			...clone(documents.release),
			schema: "tfd.note-document.v2",
		};
		const wrongSchema = await verifyNoteDocument(otherSchema, windowedKeys);
		expect(!wrongSchema.ok && wrongSchema.code).toBe("wrong_schema");
		const otherType = { ...clone(documents.release), type: "note.gift" };
		const unknownType = await verifyNoteDocument(otherType, windowedKeys);
		expect(!unknownType.ok && unknownType.code).toBe("unknown_type");
	});

	test("the now option refuses a document signed after it", async () => {
		const early = await verifyNoteDocument(documents.release, windowedKeys, {
			now: "2026-03-05T11:59:59Z",
		});
		expect(!early.ok && early.code).toBe("signed_in_future");
		const later = await verifyNoteDocument(documents.release, windowedKeys, {
			now: "2026-04-01T00:00:00Z",
		});
		expect(later.ok).toBe(true);
		const bad = await verifyNoteDocument(documents.release, windowedKeys, {
			now: "yesterday",
		});
		expect(!bad.ok && bad.code).toBe("bad_options");
	});

	test("text with no canonical spelling is refused, not thrown", async () => {
		const decomposed = clone(documents.release) as Json;
		decomposed.note_id = `cafe${String.fromCodePoint(0x301)}`;
		const verdict = await verifyNoteDocument(decomposed, windowedKeys);
		expect(!verdict.ok && verdict.code).toBe("not_canonical");
	});

	test("the messages avoid words a record does not earn", async () => {
		const forbidden = /proof|enforceable|binding|tamper-proof|legally/iu;
		const bad = clone(documents.payment_receipt) as Json;
		bad.amount_minor = "1";
		const verdicts = [
			await verifyNoteDocument(bad, windowedKeys),
			await verifyNoteDocument(null, windowedKeys),
			await verifyNoteDocument(
				documents.release,
				keysWith({ revoked_at: "2030-01-01T00:00:00Z" }),
			),
		];
		for (const verdict of verdicts) {
			expect(!verdict.ok && forbidden.test(verdict.message)).toBe(false);
		}
	});
});

describe("chain failures", () => {
	test("an edited event is refused", async () => {
		const edited = clone(events) as Json[];
		edited[2] = { ...edited[2], amount_minor: "30001" };
		const verdict = await verifyNoteChain(edited, links);
		expect(!verdict.ok && verdict.code).toBe("chain_event_hash_mismatch");
		expect(!verdict.ok && verdict.seq).toBe(3);
	});

	test("a missing link is refused", async () => {
		const dropped = [...links.slice(0, 4), ...links.slice(5)];
		const verdict = await verifyNoteChain(events, dropped);
		expect(!verdict.ok && verdict.code).toBe("chain_missing_link");
		const shortened = await verifyNoteChain(events, links.slice(0, 8));
		expect(!shortened.ok && shortened.code).toBe("chain_missing_link");
	});

	test("an extra link, a rewritten prev_hash and a wrong note are refused", async () => {
		const extra = await verifyNoteChain(events, [
			...links,
			{ ...links[8], seq: 10 },
		]);
		expect(!extra.ok && extra.code).toBe("chain_extra_link");
		const rewritten = clone(links) as ChainLink[];
		(rewritten[4] as ChainLink).prev_hash = "0".repeat(64);
		const broken = await verifyNoteChain(events, rewritten);
		expect(!broken.ok && broken.code).toBe("chain_broken_link");
		const wrongNote = await verifyNoteChain(events, links, "note-other");
		expect(!wrongNote.ok && wrongNote.code).toBe("chain_wrong_note_id");
	});

	test("input that is not events and links is named, not thrown", async () => {
		const notEvent = await verifyNoteChain([{ type: "x" }], links);
		expect(!notEvent.ok && notEvent.code).toBe("bad_event");
		const notLink = await verifyNoteChain(events, [{ seq: 1 }]);
		expect(!notLink.ok && notLink.code).toBe("bad_link");
		const upperHex = clone(links) as ChainLink[];
		(upperHex[0] as ChainLink).event_hash =
			upperHex[0]?.event_hash.toUpperCase() ?? "";
		const badSpelling = await verifyNoteChain(events, upperHex);
		expect(!badSpelling.ok && badSpelling.code).toBe("bad_link");
		const empty = await verifyNoteChain([], []);
		expect(empty.ok).toBe(false);
	});
});

describe("bundle failures", () => {
	const codesOf = (verdict: Awaited<ReturnType<typeof verifyNoteBundle>>) =>
		verdict.documents.map((entry) => (entry.ok ? "ok" : entry.code));

	const sealOf = (
		head: { seq: number; hash: string },
		noteId = "note-demo-1",
	) =>
		signWith(
			{
				schema: "tfd.note-document.v1",
				type: "note.chain-seal",
				note_id: noteId,
				head_seq: head.seq,
				head_hash: head.hash,
				sealed_at: ISSUED_AT,
			},
			sealSigner,
		);

	test("an edited event fails the chain and no document is trusted against it", async () => {
		const edited = clone(events) as Json[];
		edited[2] = { ...edited[2], amount_minor: "30001" };
		const verdict = await verifyBundle({ events: edited });
		expect(verdict.ok).toBe(false);
		expect(verdict.chain.ok).toBe(false);
		expect(codesOf(verdict)).toEqual(Array(4).fill("chain_not_verified"));
	});

	test("a document whose chain_head names a seq beyond the chain is chain_head_unknown", async () => {
		const beyond = await sealOf({ seq: 10, hash: "a".repeat(64) });
		const verdict = await verifyBundle({ documents: [beyond] });
		expect(codesOf(verdict)).toEqual(["chain_head_unknown"]);
		const shortChain = await verifyBundle({
			events: events.slice(0, 8),
			links: links.slice(0, 8),
		});
		expect(codesOf(shortChain)).toEqual(Array(4).fill("chain_head_unknown"));
	});

	test("a document pointing at a head from a different note is refused", async () => {
		const otherInput = await readGolden(
			"chain/value-dates-out-of-order.input.json",
		);
		const otherEvents = otherInput.events as unknown[];
		const otherLinks = await buildChain(validateStream(otherEvents));
		const otherHead = await chainHead(otherLinks);
		const otherSealBody = await chainSealBody(
			"note-other",
			otherLinks,
			ISSUED_AT,
		);
		const otherSeal = await signDocument(otherSealBody, sealSigner);
		const foreign = await verifyBundle({ documents: [otherSeal] });
		expect(codesOf(foreign)).toEqual(["note_id_mismatch"]);
		const sameIdOtherHash = await sealOf({
			seq: Math.min(otherHead.seq, 9),
			hash: otherHead.head_hash,
		});
		const swapped = await verifyBundle({ documents: [sameIdOtherHash] });
		expect(codesOf(swapped)).toEqual(["chain_head_mismatch"]);
		const receipt = await signWith(
			{
				...bodyOf(documents.payment_receipt),
				chain_head: { seq: 9, head_hash: otherHead.head_hash },
			},
			receiptSigner,
		);
		const receiptVerdict = await verifyBundle({ documents: [receipt] });
		expect(codesOf(receiptVerdict)).toEqual(["chain_head_mismatch"]);
	});

	test("a seal for an earlier head of the same chain is accepted, one with a wrong hash is not", async () => {
		const earlier = await sealOf({
			seq: 5,
			hash: await headHashAt(5),
		});
		const accepted = await verifyBundle({ documents: [earlier] });
		expect(codesOf(accepted)).toEqual(["ok"]);
		const wrong = await sealOf({ seq: 5, hash: await headHashAt(6) });
		const refused = await verifyBundle({ documents: [wrong] });
		expect(codesOf(refused)).toEqual(["chain_head_mismatch"]);
	});

	test("a receipt whose event_hash was edited is refused, signed or not", async () => {
		const edited = clone(documents.payment_receipt) as Json;
		edited.event_hash = `0${String(edited.event_hash).slice(1)}`;
		const unsigned = await verifyBundle({ documents: [edited] });
		expect(codesOf(unsigned)).toEqual(["bad_signature"]);
		const resigned = await signWith(bodyOf(edited), receiptSigner);
		const verdict = await verifyBundle({ documents: [resigned] });
		expect(codesOf(verdict)).toEqual(["event_hash_mismatch"]);
	});

	test("a receipt or release naming a missing or wrong kind of event is refused", async () => {
		const missing = await signWith(
			{ ...bodyOf(documents.payment_receipt), payment_event_id: "evt-99" },
			receiptSigner,
		);
		const wrongKind = await signWith(
			{ ...bodyOf(documents.payment_receipt), payment_event_id: "evt-4" },
			receiptSigner,
		);
		const releaseHash = await signWith(
			{
				...bodyOf(documents.release),
				release_event_hash: "f".repeat(64),
			},
			receiptSigner,
		);
		const verdict = await verifyBundle({
			documents: [missing, wrongKind, releaseHash],
		});
		expect(codesOf(verdict)).toEqual([
			"event_not_in_chain",
			"wrong_event_type",
			"event_hash_mismatch",
		]);
	});

	test("a receipt for an event after its own head is refused", async () => {
		const earlyHead = {
			seq: 2,
			head_hash: await headHashAt(2),
		};
		const early = await signWith(
			{ ...bodyOf(documents.payment_receipt), chain_head: earlyHead },
			receiptSigner,
		);
		const verdict = await verifyBundle({ documents: [early] });
		expect(codesOf(verdict)).toEqual(["event_after_head"]);
	});

	test("one bad document makes the bundle not ok and the others keep their verdicts", async () => {
		const bad = clone(documents.release) as Json;
		bad.balance_at_release_minor = "1";
		const verdict = await verifyBundle({
			documents: [documents.payment_receipt, bad],
		});
		expect(verdict.ok).toBe(false);
		expect(codesOf(verdict)).toEqual(["ok", "bad_signature"]);
	});

	test("a revoked key fails the bundle", async () => {
		const verdict = await verifyBundle({
			keys: keysWith({ revoked_at: "2030-01-01T00:00:00Z" }),
		});
		expect(verdict.ok).toBe(false);
		expect(codesOf(verdict)).toEqual([
			"key_revoked",
			"key_revoked",
			"key_revoked",
			"ok",
		]);
	});

	test("a document built from the library's own builders fits", async () => {
		const body = await paymentReceiptBody(
			validateStream(events),
			"evt-3",
			links,
			ISSUED_AT,
		);
		const signed = await signDocument(body, receiptSigner);
		const sealed = await verifyBundle({
			documents: [signed, documents.chain_seal],
		});
		expect(sealed.ok).toBe(true);
		const unsealed = await verifyBundle({ documents: [signed] });
		expect(codesOf(unsealed)).toEqual(["ok"]);
		expect(unsealed.ok).toBe(false);
		expect(unsealed.code).toBe("chain_unsealed");
	});

	const headHashAt = async (seq: number): Promise<string> => {
		const head = await chainHead(links.slice(0, seq));
		return head.head_hash;
	};
});

describe("nothing throws on bad input", () => {
	const hostile: unknown[] = [
		null,
		undefined,
		0,
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		1e308,
		42n,
		true,
		"",
		"x".repeat(2_000_000),
		[],
		[null],
		[[]],
		{},
		{ type: "note.release" },
		{ __proto__: null },
		JSON.parse('{"__proto__":{"type":"note.release"}}'),
		() => 1,
		Symbol("x"),
		new Date(),
		new Map(),
	];

	test("verifyNoteDocument returns a verdict for every input", async () => {
		for (const value of hostile) {
			for (const keys of [windowedKeys, {}, null, [], "x"]) {
				const verdict = await verifyNoteDocument(value, keys as PublicKeys);
				expect(verdict.ok).toBe(false);
			}
		}
		const giant = {
			...clone(documents.release),
			note_id: "x".repeat(2_000_000),
		};
		expect((await verifyNoteDocument(giant, windowedKeys)).ok).toBe(false);
		const giantSignature = clone(documents.release) as Json;
		(giantSignature.signature as Json).sig = "A".repeat(2_000_000);
		expect((await verifyNoteDocument(giantSignature, windowedKeys)).ok).toBe(
			false,
		);
		const giantKey = clone(documents.release) as Json;
		(giantKey.signature as Json).key_id = "k".repeat(2_000_000);
		expect((await verifyNoteDocument(giantKey, windowedKeys)).ok).toBe(false);
		const badOptions = await verifyNoteDocument(
			documents.release,
			windowedKeys,
			null as never,
		);
		expect(badOptions.ok).toBe(true);
	});

	test("verifyNoteChain returns a verdict for every input", async () => {
		for (const first of hostile) {
			for (const second of hostile) {
				const verdict = await verifyNoteChain(
					first as unknown[],
					second as unknown[],
				);
				expect(verdict.ok).toBe(false);
			}
		}
		const verdict = await verifyNoteChain(events, links, 7 as never);
		expect(verdict.ok).toBe(false);
	});

	test("verifyNoteBundle returns a verdict for every input", async () => {
		for (const value of hostile) {
			const verdict = await verifyNoteBundle(value as NoteBundle);
			expect(verdict.ok).toBe(false);
		}
		for (const field of ["events", "links", "documents", "keys"] as const) {
			for (const value of hostile) {
				// An empty list of documents is a bundle with nothing to check beyond its chain.
				const emptyDocuments =
					field === "documents" && Array.isArray(value) && value.length === 0;
				if (emptyDocuments) continue;
				const verdict = await verifyBundle({
					[field]: value,
				} as Partial<NoteBundle>);
				expect(verdict.ok).toBe(false);
			}
		}
		const withHostileDocuments = await verifyBundle({
			documents: hostile,
		});
		expect(withHostileDocuments.ok).toBe(false);
		expect(withHostileDocuments.documents).toHaveLength(hostile.length);
	});
});

describe("portability and size", () => {
	const lines = async (name: string): Promise<string[]> =>
		(await readFile(join(SRC, name), "utf8")).split("\n");

	const codeLines = (all: string[]): string[] =>
		all.filter((line) => !/^\s*(\/\/|\/\*|\*)/u.test(line));

	test("notes.ts is Apache-2.0 and has no node:, Buffer, eval or any", async () => {
		const all = await lines("notes.ts");
		expect(all[0]).toBe("// SPDX-License-Identifier: Apache-2.0");
		const code = codeLines(all).join("\n");
		const banned: [string, RegExp][] = [
			["node: import", /["']node:/u],
			["require(", /\brequire\(/u],
			["Buffer", /\bBuffer\b/u],
			["eval(", /\beval\(/u],
			["new Function", /\bnew\s+Function\b/u],
			["console", /\bconsole\./u],
			["any", /(:|<|as)\s*any\b/u],
			["@atm", /from\s+["'](\.\.\/)+atm|from\s+["']tfd["']/u],
		];
		for (const [label, pattern] of banned) {
			expect({ label, found: pattern.test(code) }).toEqual({
				label,
				found: false,
			});
		}
	});

	test("notes.ts imports only @noble/ed25519, tfd-notes and tfd-verify", async () => {
		const code = (await lines("notes.ts")).join("\n");
		const specifiers = [...code.matchAll(/from\s+"([^"]+)"/gu)].map(
			(match) => match[1],
		);
		for (const specifier of specifiers) {
			expect(["@noble/ed25519", "tfd-notes", "tfd-verify"]).toContain(
				specifier,
			);
		}
	});

	test("tfd-verify core.ts, check.ts and link.ts do not import tfd-notes or notes", async () => {
		for (const name of ["core.ts", "check.ts", "link.ts"]) {
			const verifySource = await readFile(
				join(import.meta.dir, "../../verify/src", name),
				"utf8",
			);
			const imports = verifySource
				.split("\n")
				.filter((line) =>
					/^\s*(import|export)\b.*\bfrom\b|^\s*\}\s*from\b/u.test(line),
				);
			for (const line of imports) {
				expect(line).not.toMatch(/tfd-notes|notes/u);
			}
		}
	});
});

describe("the seal at the head of the chain", () => {
	const keys = (): PublicKeys => windowedKeys;

	const sealOfLinks = async (
		chainLinks: ChainLink[],
		noteId = "note-demo-1",
	): Promise<Json> =>
		(await signDocument(
			await chainSealBody(noteId, chainLinks, ISSUED_AT),
			sealSigner,
		)) as unknown as Json;

	/** The vector's events with one forged payment appended at seq 10, and the chain rebuilt over all ten. */
	const extendedChain = async (): Promise<{
		forged: Json[];
		forgedLinks: ChainLink[];
	}> => {
		const forgedEvent: Json = {
			schema: "tfd.note-event.v1",
			id: "evt-10",
			note_id: "note-demo-1",
			seq: 10,
			entered_at: "2026-03-03T10:00:00Z",
			entered_by: "lender",
			type: "payment.recorded",
			kind: "payment",
			amount_minor: "99999",
			value_date: "2026-03-03",
		};
		const forged = [...clone(events as Json[]), forgedEvent];
		return { forged, forgedLinks: await buildChain(validateStream(forged)) };
	};

	test("the attack of editing an amount and rebuilding the chain, without documents, is not ok", async () => {
		const edited = clone(events) as Json[];
		edited[2] = { ...edited[2], amount_minor: "1" };
		const rebuilt = await buildChain(validateStream(edited));
		const alone = await verifyNoteChain(edited, rebuilt);
		// The chain by itself is only consistent: it cannot say it is the chain anyone signed.
		expect(alone.ok).toBe(true);
		const verdict = await verifyNoteBundle({
			events: edited,
			links: rebuilt,
			documents: [],
			keys: keys(),
		});
		expect(verdict.chain.ok).toBe(true);
		expect(verdict.ok).toBe(false);
		expect(verdict.code).toBe("chain_unsealed");
		expect(verdict.seal).toMatchObject({ ok: false, code: "chain_unsealed" });
	});

	test("the same edit with the real seal and receipts is not ok either: the head no longer matches", async () => {
		const edited = clone(events) as Json[];
		edited[2] = { ...edited[2], amount_minor: "1" };
		const rebuilt = await buildChain(validateStream(edited));
		const verdict = await verifyNoteBundle({
			events: edited,
			links: rebuilt,
			documents: bundle.documents,
			keys: keys(),
		});
		expect(verdict.ok).toBe(false);
		expect(verdict.code).toBe("chain_seal_mismatch");
		expect(verdict.documents.some((entry) => !entry.ok)).toBe(true);
	});

	test("the attack of appending a forged event after the real seal is chain_seal_stale, with the count", async () => {
		const { forged, forgedLinks } = await extendedChain();
		expect((await verifyNoteChain(forged, forgedLinks)).ok).toBe(true);
		const verdict = await verifyNoteBundle({
			events: forged,
			links: forgedLinks,
			documents: bundle.documents,
			keys: keys(),
		});
		expect(verdict.chain.ok).toBe(true);
		// The real seal and receipts still fit their own head at seq 9.
		expect(verdict.documents.every((entry) => entry.ok)).toBe(true);
		expect(verdict.ok).toBe(false);
		expect(verdict.code).toBe("chain_seal_stale");
		expect(verdict.seal).toMatchObject({
			ok: false,
			code: "chain_seal_stale",
			unsealed_events: 1,
		});
	});

	test("two events after the seal are counted as two", async () => {
		const { forged, forgedLinks } = await extendedChain();
		const second = {
			...clone(forged[9] as Json),
			id: "evt-11",
			seq: 11,
			amount_minor: "1",
		};
		const longer = [...forged, second];
		const verdict = await verifyNoteBundle({
			events: longer,
			links: await buildChain(validateStream(longer)),
			documents: bundle.documents,
			keys: keys(),
		});
		expect(forgedLinks).toHaveLength(10);
		expect(verdict.seal).toMatchObject({
			code: "chain_seal_stale",
			unsealed_events: 2,
		});
	});

	test("a new seal at the extended head makes the extended chain ok, a stale one beside it does not matter", async () => {
		const { forged, forgedLinks } = await extendedChain();
		const headSeal = await sealOfLinks(forgedLinks);
		const verdict = await verifyNoteBundle({
			events: forged,
			links: forgedLinks,
			documents: [...bundle.documents, headSeal],
			keys: keys(),
		});
		expect(verdict.documents.every((entry) => entry.ok)).toBe(true);
		expect(verdict.ok).toBe(true);
		expect(verdict.seal).toMatchObject({ ok: true, head: { seq: 10 } });
	});

	test("a seal with a bad signature is not a seal", async () => {
		const forgedSeal = clone(documents.chain_seal) as Json;
		(forgedSeal.signature as Json).sig = toBase64Url(new Uint8Array(64));
		const verdict = await verifyBundle({ documents: [forgedSeal] });
		expect(verdict.ok).toBe(false);
		expect(verdict.code).toBe("chain_unsealed");
		expect(verdict.documents[0]).toMatchObject({
			ok: false,
			code: "bad_signature",
		});
	});

	test("a seal signed by a key that is not published for seals is not a seal", async () => {
		const wrongKey = await signWith(
			bodyOf(documents.chain_seal),
			receiptSigner,
			{
				purpose: "seal",
			},
		);
		const verdict = await verifyBundle({ documents: [wrongKey] });
		expect(verdict.ok).toBe(false);
		expect(verdict.code).toBe("chain_unsealed");
	});

	test("a seal of another note does not seal this one", async () => {
		const other = await signDocument(
			await chainSealBody("note-other", links, ISSUED_AT),
			sealSigner,
		);
		const verdict = await verifyBundle({ documents: [other] });
		expect(verdict.ok).toBe(false);
		expect(verdict.code).toBe("chain_unsealed");
	});

	test("a receipt, payoff statement or release is not a seal", async () => {
		const verdict = await verifyBundle({
			documents: [
				documents.payment_receipt,
				documents.payoff_statement,
				documents.release,
			],
		});
		expect(verdict.documents.every((entry) => entry.ok)).toBe(true);
		expect(verdict.ok).toBe(false);
		expect(verdict.code).toBe("chain_unsealed");
	});

	test("a seal of an earlier seq with a hash that is not the chain's is a mismatch, not stale", async () => {
		const wrong = await signWith(
			{
				...bodyOf(documents.chain_seal),
				head_seq: 5,
				head_hash: "b".repeat(64),
			},
			sealSigner,
		);
		const verdict = await verifyBundle({ documents: [wrong] });
		expect(verdict.ok).toBe(false);
		expect(verdict.code).toBe("chain_seal_mismatch");
		expect(verdict.seal).not.toHaveProperty("unsealed_events");
	});

	test("a seal at the right seq with the wrong hash is a mismatch", async () => {
		const wrong = await signWith(
			{ ...bodyOf(documents.chain_seal), head_hash: "c".repeat(64) },
			sealSigner,
		);
		const verdict = await verifyBundle({ documents: [wrong] });
		expect(verdict.code).toBe("chain_seal_mismatch");
	});

	test("a chain cut short below the seal is a mismatch and the seal's own document is chain_head_unknown", async () => {
		const verdict = await verifyNoteBundle({
			events: events.slice(0, 8),
			links: links.slice(0, 8),
			documents: [documents.chain_seal],
			keys: keys(),
		});
		expect(verdict.ok).toBe(false);
		expect(verdict.code).toBe("chain_seal_mismatch");
		expect(verdict.documents[0]).toMatchObject({
			ok: false,
			code: "chain_head_unknown",
		});
	});

	test("a chain that does not verify has no seal verdict and no code", async () => {
		const edited = clone(events) as Json[];
		edited[2] = { ...edited[2], amount_minor: "30001" };
		const verdict = await verifyBundle({ events: edited });
		expect(verdict.seal).toBeNull();
		expect(verdict.code).toBeUndefined();
	});

	test("an unreadable bundle has no seal verdict either", async () => {
		const verdict = await verifyNoteBundle(null as never);
		expect(verdict).toMatchObject({ ok: false, seal: null });
	});

	test("the messages avoid words a record does not earn", async () => {
		const forbidden = /proof|enforceable|binding|tamper-proof|legally/iu;
		const { forged, forgedLinks } = await extendedChain();
		const stale = await verifyNoteBundle({
			events: forged,
			links: forgedLinks,
			documents: bundle.documents,
			keys: keys(),
		});
		const unsealed = await verifyBundle({ documents: [] });
		for (const verdict of [stale, unsealed]) {
			expect(
				verdict.seal && !verdict.seal.ok && verdict.seal.message,
			).toBeTruthy();
			expect(
				verdict.seal &&
					!verdict.seal.ok &&
					forbidden.test(verdict.seal.message),
			).toBe(false);
		}
	});
});
