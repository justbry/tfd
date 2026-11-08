// SPDX-License-Identifier: Apache-2.0
/**
 * checkReceipt, the whole check a verifier page runs: a pass and the ways it fails, untrusted seal entries that must not
 * throw, and which of a month's seals decides (the latest with a good signature, as in tfd's verifySeals).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { type Books, checkReceipt } from "../src/check";
import {
	type BooksEvent,
	canonicalize,
	type PublicKeys,
	type Receipt,
	receiptOf,
	type SignedReceipt,
	sha256Hex,
} from "../src/core";

const EVENT = join(
	import.meta.dir,
	"../../atm/tests/golden/receipt/event.json",
);
const KEY_ID = "check-test";
const KEY_PHRASE = "tfd-verify check test key";
const OTHER_KEY_PHRASE = "tfd-verify check other key";

/** The DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410); the 32-byte public key follows it. */
const ED25519_SPKI_PREFIX = Uint8Array.from([
	0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

const encoder = new TextEncoder();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const base64 = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes));

const base64url = (bytes: Uint8Array): string =>
	base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const seedOf = async (phrase: string): Promise<Uint8Array> =>
	new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(phrase)));

const pemOf = async (seed: Uint8Array): Promise<string> => {
	const publicKey = await getPublicKeyAsync(seed);
	const spki = new Uint8Array(ED25519_SPKI_PREFIX.length + publicKey.length);
	spki.set(ED25519_SPKI_PREFIX);
	spki.set(publicKey, ED25519_SPKI_PREFIX.length);
	return `-----BEGIN PUBLIC KEY-----\n${base64(spki)}\n-----END PUBLIC KEY-----\n`;
};

const signText = async (seed: Uint8Array, value: unknown): Promise<string> =>
	base64url(await signAsync(encoder.encode(canonicalize(value)), seed));

let event: BooksEvent;
let month: string;
let seed: Uint8Array;
let otherSeed: Uint8Array;
let keys: PublicKeys;
let signed: SignedReceipt;

const sealOver = async (
	events: BooksEvent[],
	prevSealHash: string | null,
	withSeed = seed,
) => {
	const seal = {
		v: 1,
		school: event.school,
		month,
		events: events.length,
		event_ids: events.map((sealed) => sealed.id),
		transactions: events.filter((sealed) => sealed.postings.length > 0).length,
		events_hash: await sha256Hex(
			events.map((sealed) => canonicalize(sealed)).join("\n"),
		),
		sealed_at: "2026-11-01T07:00:00Z",
		prev_seal_hash: prevSealHash,
	};
	return { seal, key_id: KEY_ID, sig: await signText(withSeed, seal) };
};

const booksOf =
	(seals: unknown[], events = [event]) =>
	async () =>
		({ school: event.school, events, seals }) satisfies Books;

beforeAll(async () => {
	event = JSON.parse(await readFile(EVENT, "utf8")) as BooksEvent;
	month = event.date.slice(0, 7);
	seed = await seedOf(KEY_PHRASE);
	otherSeed = await seedOf(OTHER_KEY_PHRASE);
	keys = { [KEY_ID]: await pemOf(seed) };
	const receipt = (await receiptOf(event)) as Receipt;
	signed = { receipt, key_id: KEY_ID, sig: await signText(seed, receipt) };
});

describe("checkReceipt", () => {
	test("a receipt in the books, under the month's seal, passes", async () => {
		const seal = await sealOver([event], null);
		expect(await checkReceipt(signed, keys, booksOf([seal]))).toEqual({
			kind: "signed",
			signed,
			books: "ok",
			seal: { month, verdict: "ok", covers: true },
		});
	});

	test("without the school's books, only the signature is checked", async () => {
		expect(await checkReceipt(signed, keys, async () => null)).toEqual({
			kind: "signed",
			signed,
			books: null,
			seal: null,
		});
	});

	test("a changed receipt, an unknown key or a malformed receipt fails", async () => {
		const tampered = clone(signed);
		tampered.receipt.amount += 1;
		const books = booksOf([]);
		expect(await checkReceipt(tampered, keys, books)).toEqual({
			kind: "bad_signature",
		});
		expect(await checkReceipt(signed, {}, books)).toEqual({
			kind: "unknown_key",
			keyId: KEY_ID,
		});
		for (const malformed of [null, "receipt", 1, [], { ...signed, v: 2 }])
			expect(await checkReceipt(malformed, keys, books)).toEqual({
				kind: "malformed",
			});
	});

	test("an edited event fails against the books and its seal", async () => {
		const seal = await sealOver([event], null);
		const edited = { ...clone(event), text: "edited later" };
		expect(
			await checkReceipt(signed, keys, booksOf([seal], [edited])),
		).toMatchObject({
			books: "event_changed",
			seal: { month, verdict: "events_changed", covers: true },
		});
		expect(await checkReceipt(signed, keys, booksOf([seal], []))).toMatchObject(
			{ books: "missing_event" },
		);
	});

	test("a null or text seal entry is malformed and never throws", async () => {
		const seal = await sealOver([event], null);
		expect(
			await checkReceipt(signed, keys, booksOf([null, "seal", 7])),
		).toMatchObject({ books: "ok", seal: null });
		expect(
			await checkReceipt(signed, keys, booksOf([seal, null, "seal"])),
		).toMatchObject({ seal: { month, verdict: "ok", covers: true } });
		expect(
			await checkReceipt(
				signed,
				keys,
				booksOf([{ seal: null }, { seal: "x" }]),
			),
		).toMatchObject({ seal: null });
	});

	test("the month's latest seal with a good signature decides, not a later bad one", async () => {
		const good = await sealOver([event], null);
		const forged = await sealOver(
			[event],
			await sha256Hex(canonicalize(good)),
			otherSeed,
		);
		const malformed = clone(good);
		malformed.seal.events = 5;
		for (const later of [forged, malformed])
			expect(
				await checkReceipt(signed, keys, booksOf([good, later])),
			).toMatchObject({ seal: { month, verdict: "ok", covers: true } });
	});

	test("a month with only a badly signed or malformed seal reports it, covering nothing", async () => {
		const forged = await sealOver([event], null, otherSeed);
		expect(await checkReceipt(signed, keys, booksOf([forged]))).toMatchObject({
			seal: { month, verdict: "bad_signature", covers: false },
		});
		const malformed = clone(forged);
		malformed.seal.events = 5;
		expect(
			await checkReceipt(signed, keys, booksOf([malformed])),
		).toMatchObject({ seal: { month, verdict: "malformed", covers: false } });
	});

	test("event_ids as text naming the event is malformed: no substring match", async () => {
		const seal = await sealOver([event], null);
		const asText = clone(seal) as unknown as {
			seal: Record<string, unknown>;
		};
		asText.seal.event_ids = `[${event.id}]`;
		expect(await checkReceipt(signed, keys, booksOf([asText]))).toMatchObject({
			seal: { month, verdict: "malformed", covers: false },
		});
	});

	test("a seal that names other events does not cover the receipt", async () => {
		const seal = await sealOver([], null);
		expect(await checkReceipt(signed, keys, booksOf([seal]))).toMatchObject({
			seal: { month, verdict: "ok", covers: false },
		});
	});
});
