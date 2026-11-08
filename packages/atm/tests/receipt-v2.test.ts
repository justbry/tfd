/**
 * Receipt v2 (`receiptOfV2`, `schema/receipt.v2.json`) and keys with a purpose and a window. A v2 receipt signs
 * `issued_at`; the verifier checks it against the key's window, fails a key of another purpose, and fails everything a
 * revoked key ever signed, whatever `issued_at` claims (a thief can backdate it). The vectors in tests/golden/receipt-v2/
 * pin one verdict per case; set UPDATE_GOLDEN=1 to rewrite them. v1 and the first keys form behave as before.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
	checkReceiptAgainstEvents,
	receiptOf,
	receiptOfV2,
	signReceipt,
	verifyReceipt,
} from "../src/ledger/receipt.js";
import { canonicalize } from "../src/ledger/util.js";
import type {
	AtmEvent,
	AtmPublicKeys,
	AtmReceipt,
	AtmSignedReceipt,
	AtmSigner,
	ReceiptVerdict,
	TfdReceiptV2,
} from "../src/types.js";
import {
	REVOKED_AT,
	TEST_KEY_ID,
	testKeys,
	testSigner,
	windowedKeys,
	windowedKeysPinned,
	windowedSigners,
} from "./signing-keys.js";

const V1_DIR = join(import.meta.dir, "golden/receipt");
const GOLDEN_DIR = join(import.meta.dir, "golden/receipt-v2");

/** In November's window, after October's keys were revoked. */
const ISSUED_AT = "2026-11-02T09:00:00Z";
/** The revocation runbook's fresh `issued_at` when it re-signs under the current key. */
const RESIGNED_AT = "2026-11-05T12:00:00Z";
/** When the refund happened: in October's window. */
const OCTOBER_ISSUED_AT = "2026-10-18T16:03:02Z";
/** A forger's claimed signing time: inside October's window and before the revocation. */
const BACKDATED_AT = "2026-10-20T00:00:00Z";
const FORGED_AMOUNT = 99_000;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

let event: AtmEvent;

beforeAll(async () => {
	event = JSON.parse(
		await readFile(join(V1_DIR, "event.json"), "utf8"),
	) as AtmEvent;
});

const v2 = (issuedAt: string): TfdReceiptV2 =>
	receiptOfV2(event, issuedAt) as TfdReceiptV2;

const sign = (
	receipt: AtmReceipt | TfdReceiptV2,
	signer: AtmSigner,
): AtmSignedReceipt => signReceipt(receipt, signer);

type Case = {
	name: string;
	verdict: ReceiptVerdict;
	make: () => AtmSignedReceipt;
};

/** One vector per rule: the file is `<name>.signed.canonical.jsonl`. */
const CASES: Case[] = [
	{
		name: "valid",
		verdict: { ok: true },
		make: () => sign(v2(ISSUED_AT), windowedSigners["trifold-test-2026-11"]),
	},
	{
		name: "tampered",
		verdict: { ok: false, reason: "bad_signature" },
		make: () => {
			const signed = sign(
				v2(ISSUED_AT),
				windowedSigners["trifold-test-2026-11"],
			);
			signed.receipt.amount += 1;
			return signed;
		},
	},
	{
		name: "wrong-purpose",
		verdict: { ok: false, reason: "key_wrong_purpose" },
		make: () =>
			sign(v2(ISSUED_AT), windowedSigners["trifold-test-seal-2026-11"]),
	},
	{
		name: "outside-window",
		verdict: { ok: false, reason: "outside_key_window" },
		make: () =>
			sign(v2(OCTOBER_ISSUED_AT), windowedSigners["trifold-test-2026-11"]),
	},
	{
		name: "revoked",
		verdict: { ok: false, reason: "key_revoked" },
		make: () =>
			sign(v2(OCTOBER_ISSUED_AT), windowedSigners["trifold-test-2026-10"]),
	},
	{
		name: "backdated-forgery",
		verdict: { ok: false, reason: "key_revoked" },
		make: () =>
			sign(
				{ ...v2(BACKDATED_AT), amount: FORGED_AMOUNT },
				windowedSigners["trifold-test-2026-10"],
			),
	},
	{
		name: "resigned",
		verdict: { ok: true },
		make: () => sign(v2(RESIGNED_AT), windowedSigners["trifold-test-2026-11"]),
	},
	{
		name: "v1-windowed-key",
		verdict: { ok: false, reason: "key_requires_v2" },
		make: () =>
			sign(
				receiptOf(event) as AtmReceipt,
				windowedSigners["trifold-test-2026-11"],
			),
	},
];

describe("golden: receipt v2 vectors", () => {
	test("the vectors are pinned byte for byte, with the keys' fingerprints and windows and each case's verdict", async () => {
		const files: Record<string, string> = {
			"receipt.canonical.jsonl": `${canonicalize(v2(ISSUED_AT))}\n`,
			"keys.json": `${JSON.stringify(windowedKeysPinned, null, "\t")}\n`,
			"cases.json": `${JSON.stringify(
				CASES.map(({ name, verdict }) => ({
					file: `${name}.signed.canonical.jsonl`,
					verdict,
				})),
				null,
				"\t",
			)}\n`,
		};
		for (const { name, make } of CASES)
			files[`${name}.signed.canonical.jsonl`] = `${canonicalize(make())}\n`;
		if (process.env.UPDATE_GOLDEN) {
			await mkdir(GOLDEN_DIR, { recursive: true });
			for (const [name, text] of Object.entries(files))
				await writeFile(join(GOLDEN_DIR, name), text);
		}
		for (const [name, text] of Object.entries(files))
			expect(text).toBe(await readFile(join(GOLDEN_DIR, name), "utf8"));
	});

	test("each pinned vector gets its verdict", async () => {
		const cases = JSON.parse(
			await readFile(join(GOLDEN_DIR, "cases.json"), "utf8"),
		) as { file: string; verdict: ReceiptVerdict }[];
		expect(cases.length).toBe(CASES.length);
		for (const { file, verdict } of cases) {
			const pinned = JSON.parse(
				await readFile(join(GOLDEN_DIR, file), "utf8"),
			) as unknown;
			expect([file, verifyReceipt(pinned, windowedKeys)]).toEqual([
				file,
				verdict,
			]);
		}
	});

	test("the v1 vector still verifies, under its first-form key", async () => {
		const pinned = JSON.parse(
			await readFile(join(V1_DIR, "signed.canonical.jsonl"), "utf8"),
		) as unknown;
		expect(verifyReceipt(pinned, testKeys)).toEqual({ ok: true });
		expect(verifyReceipt(pinned, { ...testKeys, ...windowedKeys })).toEqual({
			ok: true,
		});
	});
});

describe("receiptOfV2", () => {
	test("is receiptOf's receipt with v 2 and issued_at", () => {
		const { v: _v, ...fields } = receiptOf(event) as AtmReceipt;
		expect(receiptOfV2(event, ISSUED_AT)).toEqual({
			...fields,
			v: 2,
			issued_at: ISSUED_AT,
		});
	});

	test("an event type without receipts gives null; a bad issuedAt throws", () => {
		expect(
			receiptOfV2(
				{ ...clone(event), event_type: "payment.disputed" },
				ISSUED_AT,
			),
		).toBeNull();
		for (const bad of [
			"2026-11-02",
			"2026-11-02T09:00:00+01:00",
			"2026-11-02 09:00:00Z",
			"2026-13-02T09:00:00Z",
			"",
		])
			expect(() => receiptOfV2(event, bad)).toThrow("issuedAt");
	});
});

describe("verifyReceipt, v2 and windowed keys", () => {
	const current = (): AtmSignedReceipt =>
		sign(v2(ISSUED_AT), windowedSigners["trifold-test-2026-11"]);

	test("a v2 receipt under a first-form key verifies as before: no window to check", () => {
		const signed = sign(v2(ISSUED_AT), testSigner);
		expect(verifyReceipt(signed, testKeys)).toEqual({ ok: true });
	});

	test("changing issued_at breaks the signature", () => {
		const moved = clone(current());
		(moved.receipt as TfdReceiptV2).issued_at = "2026-11-03T09:00:00Z";
		expect(verifyReceipt(moved, windowedKeys)).toEqual({
			ok: false,
			reason: "bad_signature",
		});
	});

	test("the window is [not_before, not_after): its start is in, its end is out", () => {
		const october = windowedSigners["trifold-test-2026-10"];
		const unrevoked: AtmPublicKeys = {
			...windowedKeys,
			"trifold-test-2026-10": {
				...(windowedKeys["trifold-test-2026-10"] as object),
				revoked_at: undefined,
			} as AtmPublicKeys[string],
		};
		const at = (issuedAt: string) =>
			verifyReceipt(sign(v2(issuedAt), october), unrevoked);
		expect(at("2026-10-01T00:00:00Z")).toEqual({ ok: true });
		expect(at("2026-10-31T23:59:59.999Z")).toEqual({ ok: true });
		expect(at("2026-11-01T00:00:00Z")).toEqual({
			ok: false,
			reason: "outside_key_window",
		});
		expect(at("2026-09-30T23:59:59Z")).toEqual({
			ok: false,
			reason: "outside_key_window",
		});
	});

	test("a revoked key fails what it signed before its revocation, after it, and backdated", () => {
		const october = windowedSigners["trifold-test-2026-10"];
		for (const issuedAt of [OCTOBER_ISSUED_AT, BACKDATED_AT, REVOKED_AT])
			expect(verifyReceipt(sign(v2(issuedAt), october), windowedKeys)).toEqual({
				ok: false,
				reason: "key_revoked",
			});
	});

	test("a key with a window never vouches for a v1 receipt (no signing time to check); revocation and purpose are named first", () => {
		const v1 = receiptOf(event) as AtmReceipt;
		expect(
			verifyReceipt(
				sign(v1, windowedSigners["trifold-test-2026-11"]),
				windowedKeys,
			),
		).toEqual({ ok: false, reason: "key_requires_v2" });
		expect(
			verifyReceipt(
				sign(v1, windowedSigners["trifold-test-seal-2026-11"]),
				windowedKeys,
			),
		).toEqual({ ok: false, reason: "key_wrong_purpose" });
		expect(
			verifyReceipt(
				sign(v1, windowedSigners["trifold-test-2026-10"]),
				windowedKeys,
			),
		).toEqual({ ok: false, reason: "key_revoked" });
	});

	test("an expired, unrevoked key cannot mint v1 receipts that pass", () => {
		const october = windowedSigners["trifold-test-2026-10"];
		const unrevoked: AtmPublicKeys = {
			...windowedKeys,
			"trifold-test-2026-10": {
				...(windowedKeys["trifold-test-2026-10"] as object),
				revoked_at: undefined,
			} as AtmPublicKeys[string],
		};
		const v1 = { ...(receiptOf(event) as AtmReceipt), amount: FORGED_AMOUNT };
		expect(verifyReceipt(sign(v1, october), unrevoked)).toEqual({
			ok: false,
			reason: "key_requires_v2",
		});
	});

	test("v1 receipts under a first-form key verify as before", () => {
		const signed = sign(receiptOf(event) as AtmReceipt, testSigner);
		expect(verifyReceipt(signed, { ...testKeys, ...windowedKeys })).toEqual({
			ok: true,
		});
	});

	test("revocation, then re-signing with the current key and a fresh issued_at, verifies", () => {
		const original = sign(
			v2(OCTOBER_ISSUED_AT),
			windowedSigners["trifold-test-2026-10"],
		);
		expect(verifyReceipt(original, windowedKeys)).toEqual({
			ok: false,
			reason: "key_revoked",
		});
		const { issued_at: _issuedAt, ...facts } = original.receipt as TfdReceiptV2;
		const resigned = sign(
			{ ...facts, issued_at: RESIGNED_AT },
			windowedSigners["trifold-test-2026-11"],
		);
		expect(verifyReceipt(resigned, windowedKeys)).toEqual({ ok: true });
		expect(checkReceiptAgainstEvents(resigned, [event])).toEqual({ ok: true });
	});

	test("an unknown key, or a keys entry missing a field or with a bad one, is unknown_key", () => {
		const signed = current();
		const entry = windowedKeys["trifold-test-2026-11"] as Record<
			string,
			unknown
		>;
		const broken: unknown[] = [
			undefined,
			null,
			[],
			{ ...entry, pem: undefined },
			{ ...entry, pem: 7 },
			{ ...entry, purpose: "anything" },
			{ ...entry, purpose: undefined },
			{ ...entry, not_before: "soon" },
			{ ...entry, not_before: undefined },
			{ ...entry, not_after: undefined },
			{ ...entry, not_after: 0 },
			{ ...entry, revoked_at: "never" },
			{ ...entry, revoked_at: null },
			// A time without `Z` would be read in the verifier's own zone, so its verdict would depend on where it runs.
			{ ...entry, not_before: "2026-11-01T00:00:00" },
			{ ...entry, not_before: "2026-11-01" },
			{ ...entry, not_before: "2026-11-01T00:00:00+00:00" },
			{ ...entry, not_after: "2026-12-01T00:00:00" },
			{ ...entry, revoked_at: "2026-12-01T00:00:00" },
		];
		for (const value of broken)
			expect(
				verifyReceipt(signed, {
					"trifold-test-2026-11": value,
				} as unknown as AtmPublicKeys),
			).toEqual({ ok: false, reason: "unknown_key" });
	});

	test("untrusted v2 input is malformed, never an exception", () => {
		const good = current();
		const receipt = good.receipt as TfdReceiptV2;
		const { issued_at: _issuedAt, ...withoutIssuedAt } = receipt;
		const inputs: unknown[] = [
			{ ...good, receipt: withoutIssuedAt },
			{ ...good, receipt: { ...receipt, issued_at: "2026-11-02" } },
			{
				...good,
				receipt: { ...receipt, issued_at: "2026-11-02T09:00:00+00:00" },
			},
			{ ...good, receipt: { ...receipt, issued_at: 1 } },
			{ ...good, receipt: { ...receipt, v: 3 } },
			{ ...good, receipt: { ...receipt, v: 1 } },
			{ ...good, receipt: { ...receipt, name: "Test Member" } },
			{ receipt: { v: 2 } },
		];
		for (const input of inputs)
			expect(verifyReceipt(input, windowedKeys)).toEqual({
				ok: false,
				reason: "malformed",
			});
	});

	test("the v1 test key id stays unknown to the windowed keys", () => {
		const signed = sign(receiptOf(event) as AtmReceipt, testSigner);
		expect(signed.key_id).toBe(TEST_KEY_ID);
		expect(verifyReceipt(signed, windowedKeys)).toEqual({
			ok: false,
			reason: "unknown_key",
		});
	});
});

describe("checkReceiptAgainstEvents, v2", () => {
	test("a v2 receipt is made again with its own issued_at", () => {
		const signed = sign(v2(ISSUED_AT), windowedSigners["trifold-test-2026-11"]);
		expect(checkReceiptAgainstEvents(signed, [event])).toEqual({ ok: true });
		const edited = { ...clone(event), text: "edited" };
		expect(checkReceiptAgainstEvents(signed, [edited])).toEqual({
			ok: false,
			reason: "event_changed",
		});
	});

	test("a forged amount is event_changed against the books", () => {
		const forged = sign(
			{ ...v2(BACKDATED_AT), amount: FORGED_AMOUNT },
			windowedSigners["trifold-test-2026-10"],
		);
		expect(checkReceiptAgainstEvents(forged, [event])).toEqual({
			ok: false,
			reason: "event_changed",
		});
	});

	test("a v1 receipt is checked as before", () => {
		const signed = sign(receiptOf(event) as AtmReceipt, testSigner);
		expect(checkReceiptAgainstEvents(signed, [event])).toEqual({ ok: true });
	});
});
