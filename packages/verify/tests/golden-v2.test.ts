// SPDX-License-Identifier: Apache-2.0
/**
 * tfd-verify against tfd's receipt v2 test vectors (packages/atm/tests/golden/receipt-v2/, CC0-1.0) and keys with a
 * purpose and a window: each vector must get the verdict tfd pins in cases.json. Then the seal chain's revocation rule
 * (a revoked key's seal is superseded by a later ok seal of its month, and still a link) and checkReceiptInSeal.
 *
 * The vectors pin each key by its SPKI fingerprint and window only. Each key's 32-byte seed is the sha256 of its phrase
 * below, as in packages/atm/tests/signing-keys.ts.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getPublicKeyAsync, signAsync } from "@noble/ed25519";
import { checkReceipt, checkReceiptInSeal } from "../src/check";
import {
	type BooksEvent,
	canonicalize,
	checkReceiptAgainstEvents,
	type KeyEntry,
	type PublicKeys,
	type Receipt,
	type ReceiptV2,
	receiptOf,
	receiptOfV2,
	type Seal,
	type SignedReceipt,
	type SignedSeal,
	sha256Hex,
	verifyReceipt,
	verifySealChain,
} from "../src/core";

const VECTORS = join(import.meta.dir, "../../atm/tests/golden/receipt-v2");
const V1_VECTORS = join(import.meta.dir, "../../atm/tests/golden/receipt");

const PHRASES = {
	"trifold-test-2026-10": "tfd test receipt key 2026-10",
	"trifold-test-2026-11": "tfd test receipt key 2026-11",
	"trifold-test-seal-2026-10": "tfd test seal key 2026-10",
	"trifold-test-seal-2026-11": "tfd test seal key 2026-11",
} as const;
type KeyId = keyof typeof PHRASES;

const ED25519_SPKI_PREFIX = Uint8Array.from([
	0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);
const PEM_LINE = /.{1,64}/g;
const ISSUED_AT = "2026-11-02T09:00:00Z";
const RESIGNED_AT = "2026-11-05T12:00:00Z";
const OCTOBER_SEALED_AT = "2026-10-31T23:00:00Z";
const RESEALED_AT = "2026-12-08T00:00:00Z";

const encoder = new TextEncoder();
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const toHex = (bytes: Uint8Array): string =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const base64 = (bytes: Uint8Array): string =>
	btoa(String.fromCharCode(...bytes));
const base64url = (bytes: Uint8Array): string =>
	base64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const spkiOf = async (seed: Uint8Array): Promise<Uint8Array> => {
	const publicKey = await getPublicKeyAsync(seed);
	const spki = new Uint8Array(ED25519_SPKI_PREFIX.length + publicKey.length);
	spki.set(ED25519_SPKI_PREFIX);
	spki.set(publicKey, ED25519_SPKI_PREFIX.length);
	return spki;
};

const pemOf = (spki: Uint8Array): string =>
	`-----BEGIN PUBLIC KEY-----\n${base64(spki).match(PEM_LINE)?.join("\n")}\n-----END PUBLIC KEY-----\n`;

const readVector = (name: string): Promise<string> =>
	readFile(join(VECTORS, name), "utf8");

type Pinned = Omit<KeyEntry, "pem"> & { spki_sha256: string };

let event: BooksEvent;
let pinnedKeys: Record<KeyId, Pinned>;
let seeds: Record<KeyId, Uint8Array>;
let keys: PublicKeys;

beforeAll(async () => {
	event = JSON.parse(
		await readFile(join(V1_VECTORS, "event.json"), "utf8"),
	) as BooksEvent;
	pinnedKeys = JSON.parse(await readVector("keys.json"));
	const entries = await Promise.all(
		(Object.keys(PHRASES) as KeyId[]).map(async (keyId) => {
			const seed = new Uint8Array(
				await crypto.subtle.digest("SHA-256", encoder.encode(PHRASES[keyId])),
			);
			const { spki_sha256: _fingerprint, ...use } = pinnedKeys[keyId];
			return [keyId, seed, { pem: pemOf(await spkiOf(seed)), ...use }] as const;
		}),
	);
	seeds = Object.fromEntries(entries.map(([id, seed]) => [id, seed])) as Record<
		KeyId,
		Uint8Array
	>;
	keys = Object.fromEntries(entries.map(([id, , entry]) => [id, entry]));
});

const signWith = async (keyId: KeyId, body: unknown): Promise<string> =>
	base64url(await signAsync(encoder.encode(canonicalize(body)), seeds[keyId]));

const signReceipt = async (
	receipt: Receipt,
	keyId: KeyId,
): Promise<SignedReceipt> => ({
	receipt,
	key_id: keyId,
	sig: await signWith(keyId, receipt),
});

const v2 = async (issuedAt: string): Promise<ReceiptV2> =>
	(await receiptOfV2(event, issuedAt)) as ReceiptV2;

describe("the v2 vectors", () => {
	test("each key made from its phrase is the pinned one", async () => {
		for (const keyId of Object.keys(PHRASES) as KeyId[]) {
			const digest = new Uint8Array(
				await crypto.subtle.digest("SHA-256", await spkiOf(seeds[keyId])),
			);
			expect([keyId, toHex(digest)]).toEqual([
				keyId,
				pinnedKeys[keyId].spki_sha256,
			]);
		}
	});

	test("the v2 receipt made from the event, byte for byte", async () => {
		expect(`${canonicalize(await v2(ISSUED_AT))}\n`).toBe(
			await readVector("receipt.canonical.jsonl"),
		);
	});

	test("each vector gets the verdict tfd pins", async () => {
		const cases = JSON.parse(await readVector("cases.json")) as {
			file: string;
			verdict: { ok: true } | { ok: false; reason: string };
		}[];
		expect(cases.length).toBeGreaterThanOrEqual(8);
		expect(cases.map(({ file }) => file)).toContain(
			"v1-windowed-key.signed.canonical.jsonl",
		);
		for (const { file, verdict } of cases) {
			const signed = JSON.parse(await readVector(file)) as unknown;
			const expected = verdict.ok ? "ok" : verdict.reason;
			expect([file, await verifyReceipt(signed, keys)]).toEqual([
				file,
				expected,
			]);
		}
	});

	test("the valid and re-signed vectors are the books' receipt again; the forgery is not", async () => {
		for (const [file, books] of [
			["valid.signed.canonical.jsonl", "ok"],
			["resigned.signed.canonical.jsonl", "ok"],
			["backdated-forgery.signed.canonical.jsonl", "event_changed"],
		] as const) {
			const signed = JSON.parse(await readVector(file)) as SignedReceipt;
			expect([file, await checkReceiptAgainstEvents(signed, [event])]).toEqual([
				file,
				books,
			]);
		}
	});

	test("the v1 vector still verifies, with first-form and windowed keys side by side", async () => {
		const pinned = JSON.parse(
			await readFile(join(V1_VECTORS, "signed.canonical.jsonl"), "utf8"),
		) as SignedReceipt;
		const seed = new Uint8Array(
			await crypto.subtle.digest("SHA-256", encoder.encode("atm test key v1")),
		);
		const mixed = { ...keys, [pinned.key_id]: pemOf(await spkiOf(seed)) };
		expect(await verifyReceipt(pinned, mixed)).toBe("ok");
		expect(await checkReceiptAgainstEvents(pinned, [event])).toBe("ok");
	});
});

describe("receipts under windowed keys", () => {
	test("a revoked key fails, before or after its revocation; re-signing with the current key and a fresh issued_at verifies", async () => {
		for (const issuedAt of [
			"2026-10-18T16:03:02Z",
			"2026-10-20T00:00:00Z",
			"2026-11-06T00:00:00Z",
		])
			expect(
				await verifyReceipt(
					await signReceipt(await v2(issuedAt), "trifold-test-2026-10"),
					keys,
				),
			).toBe("key_revoked");
		const resigned = await signReceipt(
			await v2(RESIGNED_AT),
			"trifold-test-2026-11",
		);
		expect(await verifyReceipt(resigned, keys)).toBe("ok");
	});

	test("the window is [not_before, not_after): its start is in, its end is out", async () => {
		const unrevoked: PublicKeys = {
			...keys,
			"trifold-test-2026-10": {
				...(keys["trifold-test-2026-10"] as KeyEntry),
				revoked_at: undefined,
			},
		};
		const at = async (issuedAt: string) =>
			verifyReceipt(
				await signReceipt(await v2(issuedAt), "trifold-test-2026-10"),
				unrevoked,
			);
		expect(await at("2026-10-01T00:00:00Z")).toBe("ok");
		expect(await at("2026-10-31T23:59:59.999Z")).toBe("ok");
		expect(await at("2026-11-01T00:00:00Z")).toBe("outside_key_window");
		expect(await at("2026-09-30T23:59:59Z")).toBe("outside_key_window");
	});

	test("a key with a window never vouches for a v1 receipt; revocation and purpose are named first", async () => {
		const v1 = (await receiptOf(event)) as Receipt;
		expect(
			await verifyReceipt(await signReceipt(v1, "trifold-test-2026-11"), keys),
		).toBe("key_requires_v2");
		expect(
			await verifyReceipt(
				await signReceipt(v1, "trifold-test-seal-2026-11"),
				keys,
			),
		).toBe("key_wrong_purpose");
		expect(
			await verifyReceipt(await signReceipt(v1, "trifold-test-2026-10"), keys),
		).toBe("key_revoked");
		const unrevoked: PublicKeys = {
			...keys,
			"trifold-test-2026-10": {
				...(keys["trifold-test-2026-10"] as KeyEntry),
				revoked_at: undefined,
			},
		};
		const forged = { ...v1, amount: 99_000 };
		expect(
			await verifyReceipt(
				await signReceipt(forged, "trifold-test-2026-10"),
				unrevoked,
			),
		).toBe("key_requires_v2");
	});

	test("checkReceipt and checkReceiptInSeal name key_requires_v2", async () => {
		const v1 = await signReceipt(
			(await receiptOf(event)) as Receipt,
			"trifold-test-2026-11",
		);
		expect(await checkReceipt(v1, keys, async () => null)).toEqual({
			kind: "key_requires_v2",
			keyId: "trifold-test-2026-11",
		});
		expect(await checkReceiptInSeal(v1, null, keys)).toBe(
			"receipt_key_requires_v2",
		);
	});

	test("a misshapen keys entry is unknown_key; misshapen v2 input is malformed; never an exception", async () => {
		const signed = await signReceipt(
			await v2(ISSUED_AT),
			"trifold-test-2026-11",
		);
		const entry = keys["trifold-test-2026-11"] as KeyEntry;
		for (const value of [
			null,
			[],
			{ ...entry, purpose: "anything" },
			{ ...entry, not_before: "soon" },
			{ ...entry, not_after: undefined },
			// revoked_at is absent or a time: null is not "not revoked".
			{ ...entry, revoked_at: null },
			// A time without Z would be read in the verifier's own zone, so its verdict would depend on where it runs.
			{ ...entry, not_before: "2026-11-01T00:00:00" },
			{ ...entry, not_before: "2026-11-01" },
			{ ...entry, not_before: "2026-11-01T00:00:00+00:00" },
			{ ...entry, not_after: "2026-12-01T00:00:00" },
			{ ...entry, revoked_at: "2026-12-01T00:00:00" },
		])
			expect(
				await verifyReceipt(signed, {
					"trifold-test-2026-11": value,
				} as unknown as PublicKeys),
			).toBe("unknown_key");
		const { issued_at: _issuedAt, ...withoutIssuedAt } =
			signed.receipt as ReceiptV2;
		for (const input of [
			{ ...signed, receipt: withoutIssuedAt },
			{ ...signed, receipt: { ...signed.receipt, issued_at: "2026-11-02" } },
			{ ...signed, receipt: { ...signed.receipt, v: 3 } },
			{
				...signed,
				receipt: { ...withoutIssuedAt, v: 1, issued_at: ISSUED_AT },
			},
		])
			expect(await verifyReceipt(input, keys)).toBe("malformed");
		await expect(receiptOfV2(event, "2026-11-02")).rejects.toThrow("issuedAt");
	});

	test("checkReceipt names the key's verdict", async () => {
		const revoked = await signReceipt(
			await v2("2026-10-18T16:03:02Z"),
			"trifold-test-2026-10",
		);
		expect(await checkReceipt(revoked, keys, async () => null)).toEqual({
			kind: "key_revoked",
			keyId: "trifold-test-2026-10",
		});
	});
});

const sealOver = async (
	month: string,
	sealedAt: string,
	previous: SignedSeal | null,
	keyId: KeyId,
	covered: BooksEvent[] = [event],
): Promise<SignedSeal> => {
	const seal: Seal = {
		v: 1,
		school: event.school,
		month,
		events: covered.length,
		event_ids: covered.map((sealed) => sealed.id).sort(),
		transactions: covered.filter((sealed) => sealed.postings.length > 0).length,
		events_hash: await sha256Hex(
			covered.map((sealed) => canonicalize(sealed)).join("\n"),
		),
		sealed_at: sealedAt,
		prev_seal_hash: previous ? await sha256Hex(canonicalize(previous)) : null,
	};
	return { seal, key_id: keyId, sig: await signWith(keyId, seal) };
};

describe("verifySealChain with windowed keys", () => {
	test("purpose and window by sealed_at", async () => {
		expect(
			await verifySealChain(
				[
					await sealOver(
						"2026-10",
						RESEALED_AT,
						null,
						"trifold-test-seal-2026-11",
					),
				],
				[event],
				keys,
			),
		).toEqual(["ok"]);
		expect(
			await verifySealChain(
				[await sealOver("2026-10", RESEALED_AT, null, "trifold-test-2026-11")],
				[event],
				keys,
			),
		).toEqual(["key_wrong_purpose"]);
		expect(
			await verifySealChain(
				[
					await sealOver(
						"2026-10",
						OCTOBER_SEALED_AT,
						null,
						"trifold-test-seal-2026-11",
					),
				],
				[event],
				keys,
			),
		).toEqual(["outside_key_window"]);
	});

	test("revocation, then an appended re-seal: the revoked line is superseded and the chain links through it", async () => {
		const october = await sealOver(
			"2026-10",
			OCTOBER_SEALED_AT,
			null,
			"trifold-test-seal-2026-10",
		);
		const november = await sealOver(
			"2026-11",
			"2026-12-07T00:00:00Z",
			october,
			"trifold-test-seal-2026-11",
			[],
		);
		expect(await verifySealChain([october, november], [event], keys)).toEqual([
			"key_revoked",
			"ok",
		]);
		const resealed = await sealOver(
			"2026-10",
			RESEALED_AT,
			november,
			"trifold-test-seal-2026-11",
		);
		expect(
			await verifySealChain([october, november, resealed], [event], keys),
		).toEqual(["superseded", "ok", "ok"]);
		const byRevoked = await sealOver(
			"2026-10",
			RESEALED_AT,
			november,
			"trifold-test-seal-2026-10",
		);
		expect(
			await verifySealChain([october, november, byRevoked], [event], keys),
		).toEqual(["key_revoked", "ok", "key_revoked"]);
	});

	test("a revoked line with a broken link is key_revoked, superseded by a later re-seal, and still a link", async () => {
		const first = await sealOver(
			"2026-10",
			OCTOBER_SEALED_AT,
			null,
			"trifold-test-seal-2026-10",
		);
		const misplaced = await sealOver(
			"2026-10",
			OCTOBER_SEALED_AT,
			null,
			"trifold-test-seal-2026-10",
		);
		expect(await verifySealChain([first, misplaced], [event], keys)).toEqual([
			"key_revoked",
			"key_revoked",
		]);
		const resealed = await sealOver(
			"2026-10",
			RESEALED_AT,
			misplaced,
			"trifold-test-seal-2026-11",
		);
		expect(
			await verifySealChain([first, misplaced, resealed], [event], keys),
		).toEqual(["superseded", "superseded", "ok"]);
		const books = async () => ({
			school: event.school,
			events: [event],
			seals: [first, misplaced, resealed] as unknown[],
		});
		const receipt = await signReceipt(
			await v2(ISSUED_AT),
			"trifold-test-2026-11",
		);
		expect(await checkReceipt(receipt, keys, books)).toMatchObject({
			seal: { month: "2026-10", verdict: "ok", covers: true },
		});
	});

	test("checkReceipt does not let a revoked key's seal decide the month", async () => {
		const receipt = await signReceipt(
			await v2(ISSUED_AT),
			"trifold-test-2026-11",
		);
		const october = await sealOver(
			"2026-10",
			OCTOBER_SEALED_AT,
			null,
			"trifold-test-seal-2026-10",
		);
		const resealed = await sealOver(
			"2026-10",
			RESEALED_AT,
			october,
			"trifold-test-seal-2026-11",
		);
		const books = async () => ({
			school: event.school,
			events: [event],
			seals: [october, resealed] as unknown[],
		});
		expect(await checkReceipt(receipt, keys, books)).toMatchObject({
			kind: "signed",
			books: "ok",
			seal: { month: "2026-10", verdict: "ok", covers: true },
		});
		const onlyRevoked = async () => ({
			school: event.school,
			events: [event],
			seals: [october] as unknown[],
		});
		expect(await checkReceipt(receipt, keys, onlyRevoked)).toMatchObject({
			seal: { month: "2026-10", verdict: "key_revoked", covers: false },
		});
	});
});

describe("checkReceiptInSeal", () => {
	let receipt: SignedReceipt;
	let seal: SignedSeal;

	beforeAll(async () => {
		receipt = await signReceipt(await v2(ISSUED_AT), "trifold-test-2026-11");
		seal = await sealOver(
			"2026-10",
			RESEALED_AT,
			null,
			"trifold-test-seal-2026-11",
		);
	});

	const resign = async (
		change: (body: Seal) => void,
		keyId: KeyId = "trifold-test-seal-2026-11",
	): Promise<SignedSeal> => {
		const body = clone(seal.seal);
		change(body);
		return { seal: body, key_id: keyId, sig: await signWith(keyId, body) };
	};

	test("a receipt its month's seal names passes; no seal yet is not_sealed", async () => {
		expect(await checkReceiptInSeal(receipt, seal, keys)).toBe("ok");
		expect(await checkReceiptInSeal(receipt, null, keys)).toBe("not_sealed");
		expect(await checkReceiptInSeal(receipt, undefined, keys)).toBe(
			"not_sealed",
		);
	});

	test("a v1 receipt and a first-form seal key pass too", async () => {
		const seed = new Uint8Array(
			await crypto.subtle.digest("SHA-256", encoder.encode("atm test key v1")),
		);
		const firstForm = { ...keys, "atm-test-1": pemOf(await spkiOf(seed)) };
		const v1 = (await receiptOf(event)) as Receipt;
		const v1Signed = {
			receipt: v1,
			key_id: "atm-test-1",
			sig: base64url(await signAsync(encoder.encode(canonicalize(v1)), seed)),
		};
		const sealBody = seal.seal;
		const sealFirstForm = {
			seal: sealBody,
			key_id: "atm-test-1",
			sig: base64url(
				await signAsync(encoder.encode(canonicalize(sealBody)), seed),
			),
		};
		expect(await checkReceiptInSeal(v1Signed, sealFirstForm, firstForm)).toBe(
			"ok",
		);
	});

	test("each receipt failure is its own verdict, checked before the seal", async () => {
		const tampered = clone(receipt);
		tampered.receipt.amount += 1;
		expect(await checkReceiptInSeal(tampered, seal, keys)).toBe(
			"receipt_bad_signature",
		);
		expect(await checkReceiptInSeal({}, seal, keys)).toBe("receipt_malformed");
		expect(
			await checkReceiptInSeal({ ...receipt, key_id: "nobody" }, seal, keys),
		).toBe("receipt_unknown_key");
		const revoked = await signReceipt(
			await v2("2026-10-18T16:03:02Z"),
			"trifold-test-2026-10",
		);
		expect(await checkReceiptInSeal(revoked, null, keys)).toBe(
			"receipt_key_revoked",
		);
	});

	test("each seal failure is its own verdict", async () => {
		const flipped = {
			...seal,
			sig: `${seal.sig.startsWith("A") ? "B" : "A"}${seal.sig.slice(1)}`,
		};
		const cases: [unknown, string][] = [
			["garbage", "seal_malformed"],
			[{ ...seal, extra: 1 }, "seal_malformed"],
			[flipped, "seal_bad_signature"],
			[{ ...seal, key_id: "nobody" }, "seal_unknown_key"],
			[
				await resign(() => {}, "trifold-test-2026-11"),
				"seal_key_wrong_purpose",
			],
			[
				await resign((body) => {
					body.sealed_at = OCTOBER_SEALED_AT;
				}),
				"seal_outside_key_window",
			],
			[
				await resign((body) => {
					body.sealed_at = OCTOBER_SEALED_AT;
				}, "trifold-test-seal-2026-10"),
				"seal_key_revoked",
			],
			[
				await resign((body) => {
					body.school = "sch_other";
				}),
				"seal_other_school",
			],
			[
				await resign((body) => {
					body.month = "2026-11";
				}),
				"seal_other_month",
			],
			[
				await resign((body) => {
					body.event_ids = [];
					body.events = 0;
				}),
				"not_in_seal",
			],
		];
		for (const [input, verdict] of cases)
			expect(await checkReceiptInSeal(receipt, input, keys)).toBe(
				verdict as Awaited<ReturnType<typeof checkReceiptInSeal>>,
			);
	});
});
