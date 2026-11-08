// SPDX-License-Identifier: Apache-2.0
/**
 * tfd-verify against tfd's receipt test vectors (packages/atm/tests/golden/receipt/, CC0-1.0), read here as data files:
 * the vectors' event, receipt and signed receipt must come out byte for byte, the signed receipt must verify, and every
 * tampered or malformed variant must get the verdict tfd's own tests (packages/atm/tests/receipt.test.ts) expect.
 *
 * The vectors pin the test key by its SPKI fingerprint only. The key is the Ed25519 key whose 32-byte seed is the sha256
 * of the phrase below; Ed25519 is deterministic, so signing the vector receipt with it gives the pinned signature again.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { checkReceipt } from "../src/check";
import {
	type BooksEvent,
	canonicalize,
	checkReceiptAgainstEvents,
	type PublicKeys,
	type Receipt,
	receiptOf,
	type SignedReceipt,
	sha256Hex,
	verifyReceipt,
	verifySealChain,
} from "../src/core";
import { decodeReceiptParam, encodeReceiptParam } from "../src/link";

const VECTORS = join(import.meta.dir, "../../atm/tests/golden/receipt");
const TEST_KEY_PHRASE = "atm test key v1";
const OTHER_KEY_PHRASE = "tfd-verify another key";

/** The DER prefix of an Ed25519 SubjectPublicKeyInfo (RFC 8410); the 32-byte public key follows it. */
const ED25519_SPKI_PREFIX = Uint8Array.from([
	0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);
const PEM_LINE = /.{1,64}/g;

const encoder = new TextEncoder();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const toHex = (bytes: Uint8Array): string =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");

const base64 = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes));

const base64url = (bytes: Uint8Array): string =>
	base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const pemOf = (spki: Uint8Array): string =>
	`-----BEGIN PUBLIC KEY-----\n${base64(spki).match(PEM_LINE)?.join("\n")}\n-----END PUBLIC KEY-----\n`;

const seedOf = async (phrase: string): Promise<Uint8Array> =>
	new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(phrase)));

const spkiOf = async (seed: Uint8Array): Promise<Uint8Array> => {
	const publicKey = await getPublicKeyAsync(seed);
	const spki = new Uint8Array(ED25519_SPKI_PREFIX.length + publicKey.length);
	spki.set(ED25519_SPKI_PREFIX);
	spki.set(publicKey, ED25519_SPKI_PREFIX.length);
	return spki;
};

const signWith = async (seed: Uint8Array, receipt: Receipt): Promise<string> =>
	base64url(await signAsync(encoder.encode(canonicalize(receipt)), seed));

const readVector = (name: string): Promise<string> =>
	readFile(join(VECTORS, name), "utf8");

let event: BooksEvent;
let pinnedKey: { key_id: string; spki_sha256: string };
let pinned: SignedReceipt;
let testSeed: Uint8Array;
let otherSeed: Uint8Array;
let keys: PublicKeys;
let rsaPem: string;

beforeAll(async () => {
	event = JSON.parse(await readVector("event.json")) as BooksEvent;
	pinnedKey = JSON.parse(await readVector("key.json"));
	pinned = JSON.parse(await readVector("signed.canonical.jsonl"));
	testSeed = await seedOf(TEST_KEY_PHRASE);
	otherSeed = await seedOf(OTHER_KEY_PHRASE);
	keys = { [pinnedKey.key_id]: pemOf(await spkiOf(testSeed)) };
	const rsa = (await crypto.subtle.generateKey(
		{
			name: "RSASSA-PKCS1-v1_5",
			modulusLength: 2048,
			publicExponent: Uint8Array.from([1, 0, 1]),
			hash: "SHA-256",
		},
		true,
		["sign", "verify"],
	)) as CryptoKeyPair;
	rsaPem = pemOf(
		new Uint8Array(await crypto.subtle.exportKey("spki", rsa.publicKey)),
	);
});

/** A payment.succeeded event made from the vector's refund: the receipt's amount is then amount_paid. */
const paymentOf = (refund: BooksEvent): BooksEvent => {
	const payment = clone(refund);
	payment.event_type = "payment.succeeded";
	payment.payload = {
		id: "in_vector",
		currency: "usd",
		amount_paid: 26000,
		billing_email: "member@example.test",
		billing_name: "Test Member",
	};
	delete payment.cause;
	return payment;
};

describe("the vectors, byte for byte", () => {
	test("the event's canonical bytes", async () => {
		expect(`${canonicalize(event)}\n`).toBe(
			await readVector("event.canonical.jsonl"),
		);
	});

	test("the receipt made from the event, and its event_hash", async () => {
		const receipt = await receiptOf(event);
		expect(`${canonicalize(receipt)}\n`).toBe(
			await readVector("receipt.canonical.jsonl"),
		);
		expect(receipt?.event_hash).toBe(await sha256Hex(canonicalize(event)));
	});

	test("the test key is the pinned one", async () => {
		const digest = new Uint8Array(
			await crypto.subtle.digest("SHA-256", await spkiOf(testSeed)),
		);
		expect(toHex(digest)).toBe(pinnedKey.spki_sha256);
		expect(pinned.key_id).toBe(pinnedKey.key_id);
	});

	test("signing the receipt again gives the pinned signed receipt", async () => {
		const receipt = (await receiptOf(event)) as Receipt;
		const signed = {
			receipt,
			key_id: pinnedKey.key_id,
			sig: await signWith(testSeed, receipt),
		};
		expect(`${canonicalize(signed)}\n`).toBe(
			await readVector("signed.canonical.jsonl"),
		);
	});

	test("the pinned signed receipt verifies", async () => {
		expect(await verifyReceipt(pinned, keys)).toBe("ok");
	});
});

describe("verifyReceipt rejects what tfd rejects", () => {
	test("changing amount, event_time, stripe_id or event_hash is bad_signature", async () => {
		const changes: ((receipt: Receipt) => void)[] = [
			(receipt) => {
				receipt.amount += 1;
			},
			(receipt) => {
				receipt.event_time = "2026-01-17T16:04:00Z";
			},
			(receipt) => {
				receipt.stripe_id = "in_other";
			},
			async (receipt) => {
				receipt.event_hash = await sha256Hex("another event");
			},
		];
		for (const change of changes) {
			const tampered = clone(pinned);
			await change(tampered.receipt);
			expect(await verifyReceipt(tampered, keys)).toBe("bad_signature");
		}
	});

	test("a signature by another key, or a changed signature, is bad_signature", async () => {
		const byOther = {
			...pinned,
			sig: await signWith(otherSeed, pinned.receipt),
		};
		expect(await verifyReceipt(byOther, keys)).toBe("bad_signature");
		const flipped = `${pinned.sig.startsWith("A") ? "B" : "A"}${pinned.sig.slice(1)}`;
		expect(await verifyReceipt({ ...pinned, sig: flipped }, keys)).toBe(
			"bad_signature",
		);
	});

	test("a signature with a non-canonical last character is bad_signature", async () => {
		const alphabet =
			"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
		const last = alphabet.indexOf(pinned.sig.at(-1) as string);
		const respelled = `${pinned.sig.slice(0, -1)}${alphabet[last ^ 1]}`;
		expect(await verifyReceipt({ ...pinned, sig: respelled }, keys)).toBe(
			"bad_signature",
		);
	});

	test("an unknown key id, or a key that isn't Ed25519, is unknown_key", async () => {
		expect(await verifyReceipt({ ...pinned, key_id: "nobody" }, keys)).toBe(
			"unknown_key",
		);
		expect(
			await verifyReceipt({ ...pinned, key_id: "constructor" }, keys),
		).toBe("unknown_key");
		expect(await verifyReceipt(pinned, { [pinnedKey.key_id]: rsaPem })).toBe(
			"unknown_key",
		);
		expect(await verifyReceipt(pinned, {})).toBe("unknown_key");
	});

	test("untrusted input is malformed, never an exception", async () => {
		const { cause: _cause, ...withoutCause } = pinned.receipt;
		const inputs: unknown[] = [
			null,
			undefined,
			"garbage",
			42,
			[],
			{},
			{ receipt: pinned.receipt, key_id: pinnedKey.key_id },
			{ ...pinned, receipt: withoutCause },
			{ ...pinned, extra: true },
			{ ...pinned, receipt: { ...pinned.receipt, name: "Test Member" } },
			{ ...pinned, receipt: { ...pinned.receipt, amount: "13000" } },
			{ ...pinned, receipt: { ...pinned.receipt, amount: 130.5 } },
			{ ...pinned, receipt: { ...pinned.receipt, v: 2 } },
			{ ...pinned, receipt: { ...pinned.receipt, cause: "" } },
			{ ...pinned, receipt: { ...pinned.receipt, event_id: "not-a-ulid" } },
			{ ...pinned, sig: `${pinned.sig}==` },
			{ ...pinned, sig: pinned.sig.slice(1) },
			{ ...pinned, key_id: 1 },
		];
		for (const input of inputs)
			expect(await verifyReceipt(input, keys)).toBe("malformed");
	});
});

describe("receiptOf", () => {
	test("a refund's amount is amount and its Stripe id the payload's id; cause passes through", async () => {
		expect(await receiptOf(event)).toMatchObject({
			event_type: "payment.refunded",
			amount: event.payload.amount as number,
			stripe_id: event.payload.id as string,
			cause: event.cause as string,
		});
	});

	test("a payment's amount is amount_paid; no name or email reaches the receipt", async () => {
		const payment = paymentOf(event);
		const receipt = await receiptOf(payment);
		expect(receipt).toMatchObject({
			event_type: "payment.succeeded",
			amount: 26000,
			stripe_id: "in_vector",
			cause: null,
		});
		const text = canonicalize(receipt);
		expect(text).not.toContain("billing_");
		expect(text).not.toContain("member@example.test");
		expect(text).not.toContain("Test Member");
	});

	test("a missing or wrongly typed required payload field throws", async () => {
		const payment = paymentOf(event);
		const cases: [BooksEvent, string, unknown][] = [
			[payment, "amount_paid", undefined],
			[payment, "amount_paid", "26000"],
			[payment, "amount_paid", 260.5],
			[payment, "currency", undefined],
			[payment, "id", 7],
			[event, "amount", undefined],
			[event, "currency", ""],
			[event, "id", null],
		];
		for (const [source, field, value] of cases) {
			const broken = clone(source);
			if (value === undefined) delete broken.payload[field];
			else broken.payload[field] = value;
			await expect(receiptOf(broken)).rejects.toThrow();
		}
	});

	test("an event type without receipts gives null", async () => {
		for (const eventType of ["payment.disputed", "payment.failed", "note"])
			expect(
				await receiptOf({ ...clone(event), event_type: eventType }),
			).toBeNull();
	});
});

describe("checkReceiptAgainstEvents", () => {
	test("the unchanged event is ok", async () => {
		expect(await checkReceiptAgainstEvents(pinned, [event])).toBe("ok");
	});

	test("an edited amount, payload field or text, or a deleted amount, is event_changed", async () => {
		const edits: ((edited: BooksEvent) => void)[] = [
			(edited) => {
				edited.payload.amount = (edited.payload.amount as number) + 1;
			},
			(edited) => {
				edited.payload.fee = 0;
			},
			(edited) => {
				edited.text = "edited";
			},
			(edited) => {
				delete edited.payload.amount;
			},
		];
		for (const edit of edits) {
			const edited = clone(event);
			edit(edited);
			expect(await checkReceiptAgainstEvents(pinned, [edited])).toBe(
				"event_changed",
			);
		}
	});

	test("a deleted event is missing_event", async () => {
		expect(await checkReceiptAgainstEvents(pinned, [])).toBe("missing_event");
	});

	test("an event whose type was changed to one without receipts is not_receipted", async () => {
		const changed = { ...clone(event), event_type: "payment.disputed" };
		expect(await checkReceiptAgainstEvents(pinned, [changed])).toBe(
			"not_receipted",
		);
	});
});

describe("verifySealChain", () => {
	const sealOver = async (
		events: BooksEvent[],
		prevSealHash: string | null,
	) => {
		const seal = {
			v: 1,
			school: event.school,
			month: event.date.slice(0, 7),
			events: events.length,
			event_ids: events.map((sealed) => sealed.id),
			transactions: events.filter((sealed) => sealed.postings.length > 0)
				.length,
			events_hash: await sha256Hex(
				events.map((sealed) => canonicalize(sealed)).join("\n"),
			),
			sealed_at: "2026-11-01T07:00:00Z",
			prev_seal_hash: prevSealHash,
		};
		return {
			seal,
			key_id: pinnedKey.key_id,
			sig: base64url(
				await signAsync(encoder.encode(canonicalize(seal)), testSeed),
			),
		};
	};

	test("a seal over the vector's event verifies; an edit, a broken link or a wrong count does not", async () => {
		const first = await sealOver([event], null);
		expect(await verifySealChain([first], [event], keys)).toEqual(["ok"]);

		const edited = { ...clone(event), text: "edited later" };
		expect(await verifySealChain([first], [edited], keys)).toEqual([
			"events_changed",
		]);

		const unlinked = await sealOver([event], await sha256Hex("no such seal"));
		expect(await verifySealChain([first, unlinked], [event], keys)).toEqual([
			"ok",
			"broken_link",
		]);

		const linked = await sealOver(
			[event],
			await sha256Hex(canonicalize(first)),
		);
		expect(await verifySealChain([first, linked], [event], keys)).toEqual([
			"ok",
			"ok",
		]);

		const miscounted = clone(first);
		miscounted.seal.events = 2;
		expect(await verifySealChain([miscounted], [event], keys)).toEqual([
			"malformed",
		]);
		expect(await verifySealChain([first], [event], {})).toEqual([
			"unknown_key",
		]);
	});

	test("null or misshapen seals and events are verdicts, never an exception", async () => {
		const first = await sealOver([event], null);
		const junkEvents = [
			null,
			{},
			{ date: 7 },
			event,
		] as unknown as BooksEvent[];
		expect(await verifySealChain([first], junkEvents, keys)).toEqual(["ok"]);
		expect(await checkReceiptAgainstEvents(pinned, junkEvents)).toBe("ok");

		const month = event.date.slice(0, 7);
		const junkSeals = [null, { seal: { month, event_ids: "not a list" } }];
		const outcome = await checkReceipt(pinned, keys, async () => ({
			school: event.school,
			events: junkEvents,
			seals: junkSeals,
		}));
		expect(outcome).toMatchObject({
			kind: "signed",
			books: "ok",
			seal: { month, verdict: "malformed", covers: false },
		});
	});
});

test("?r= links carry the vector's signed receipt intact", async () => {
	const json = await readVector("signed.canonical.jsonl");
	expect(decodeReceiptParam(encodeReceiptParam(json))).toBe(json);
	expect(decodeReceiptParam("%%%")).toBeNull();
});
