/**
 * The verify page's words and its signet: every outcome gets a fact headline and the four-row checklist, never an
 * over-claim, and the signet's fingerprint and rosette are deterministic and change with any change to the receipt.
 */
import { describe, expect, test } from "bun:test";
import { canonicalize, type PublicKeys } from "tfd-verify";
import { type Books, checkReceipt, type Outcome } from "tfd-verify/check";
import books from "../src/lib/samples/books.json";
import publicKey from "../src/lib/samples/public-key.json";
import sample from "../src/lib/samples/receipt.json";
import tampered from "../src/lib/samples/receipt-tampered.json";
import { SCHOOL_NAMES } from "../src/lib/samples/sample";
import {
	DOESNT_TELL_YOU,
	type ReportContext,
	reportOf,
} from "../src/lib/verify/report";
import {
	BANDS_FULL,
	fingerprintOf,
	rosettePaths,
} from "../src/lib/verify/signet";

const keys = publicKey.keys as PublicKeys;
const withBooks = async () => books as unknown as Books;
const withoutBooks = async () => null;
const context: ReportContext = {
	orgName: (school) => SCHOOL_NAMES[school] ?? school,
	keyEntry: keys[sample.key_id],
	keySource: "sample",
	sealedAt: "2026-11-01T08:00:00Z",
};

/** Words the page must never say about a result (AGENTS.md Claims, docs/website/messaging.md). */
const BANNED =
	/\b(verified payment|paid in full|authentic|fraud|forged|witness|triple-entry|immutable|tax[- ]deductible|tax[- ]eligible|verified by stripe|guarantee)/i;

const allText = (outcome: Outcome, ctx = context): string => {
	const report = reportOf(outcome, ctx);
	return [
		report.eyebrow,
		report.headline,
		report.body,
		report.guidance ?? "",
		...report.rows.flatMap((row) => [row.label, row.note]),
		DOESNT_TELL_YOU,
	].join(" ");
};

const signed = sample as unknown as Extract<
	Outcome,
	{ kind: "signed" }
>["signed"];
const OUTCOMES: Outcome[] = [
	{ kind: "malformed" },
	{ kind: "unknown_key", keyId: "other-key" },
	{ kind: "bad_signature" },
	{ kind: "key_revoked", keyId: sample.key_id },
	{ kind: "key_wrong_purpose", keyId: sample.key_id },
	{ kind: "outside_key_window", keyId: sample.key_id },
	{ kind: "key_requires_v2", keyId: sample.key_id },
	{ kind: "signed", signed, books: null, seal: null },
	{ kind: "signed", signed, books: "ok", seal: null },
	{
		kind: "signed",
		signed,
		books: "ok",
		seal: { month: "2026-10", verdict: "ok", covers: true },
	},
	{
		kind: "signed",
		signed,
		books: "ok",
		seal: { month: "2026-10", verdict: "events_changed", covers: false },
	},
	{ kind: "signed", signed, books: "missing_event", seal: null },
	{ kind: "signed", signed, books: "event_changed", seal: null },
	{ kind: "signed", signed, books: "not_receipted", seal: null },
];

describe("the report for each outcome", () => {
	test("the sample passes every check, with a fact headline", async () => {
		const outcome = await checkReceipt(sample, keys, withBooks);
		const report = reportOf(outcome, context);
		expect(report.tone).toBe("pass");
		expect(report.headline).toBe(
			"Signed with Juniper Microschool's key and unchanged since it was signed.",
		);
		expect(report.rows.map((row) => row.state)).toEqual([
			"pass",
			"pass",
			"pass",
			"pass",
		]);
		expect(report.rows[3]?.note).toContain("November 1, 2026");
	});

	test("without the books it still passes, and says what it didn't check", async () => {
		const outcome = await checkReceipt(sample, keys, withoutBooks);
		const report = reportOf(outcome, context);
		expect(report.tone).toBe("pass");
		expect(report.rows.map((row) => row.state)).toEqual([
			"pass",
			"pass",
			"skip",
			"skip",
		]);
	});

	test("the tampered copy doesn't match its signature: calm words, no verdict on anyone", async () => {
		const outcome = await checkReceipt(tampered, keys, withBooks);
		const report = reportOf(outcome, context);
		expect(report.tone).toBe("mismatch");
		expect(report.headline).toBe("This receipt doesn't match its signature.");
		expect(report.rows[0]?.state).toBe("fail");
	});

	test("an unsealed month is neutral, not a failure", () => {
		const report = reportOf(
			{ kind: "signed", signed, books: "ok", seal: null },
			{ ...context, sealedAt: null },
		);
		expect(report.tone).toBe("pass");
		expect(report.rows[3]?.state).toBe("neutral");
	});

	test("couldn't-check is kept apart from doesn't-match", () => {
		const tone = (outcome: Outcome) => reportOf(outcome, context).tone;
		expect(tone({ kind: "malformed" })).toBe("unchecked");
		expect(tone({ kind: "unknown_key", keyId: "x" })).toBe("unchecked");
		expect(tone({ kind: "key_requires_v2", keyId: "x" })).toBe("unchecked");
		expect(tone({ kind: "bad_signature" })).toBe("mismatch");
		expect(tone({ kind: "key_revoked", keyId: "x" })).toBe("mismatch");
		expect(
			reportOf({ kind: "unknown_key", keyId: "x" }, context).offerKeys,
		).toBe(true);
	});

	test('only a malformed file is "This isn\'t a Trifold receipt"', () => {
		for (const outcome of OUTCOMES)
			expect(
				reportOf(outcome, context).headline === "This isn't a Trifold receipt.",
			).toBe(outcome.kind === "malformed");
	});

	test("no result over-claims", () => {
		for (const outcome of OUTCOMES) {
			expect(allText(outcome)).not.toMatch(BANNED);
			expect(allText(outcome, { ...context, keySource: "custom" })).not.toMatch(
				BANNED,
			);
		}
	});

	test("a v2 receipt's headline names its signing time", () => {
		const v2 = {
			...signed,
			receipt: {
				...signed.receipt,
				v: 2 as const,
				issued_at: "2026-10-03T19:40:12Z",
			},
		};
		const report = reportOf(
			{ kind: "signed", signed: v2, books: null, seal: null },
			context,
		);
		expect(report.headline).toBe(
			"Signed with Juniper Microschool's key and unchanged since October 3, 2026 at 19:40 UTC.",
		);
	});
});

describe("the signet", () => {
	test("the fingerprint is the first 8 hex of SHA-256 over the receipt's canonical bytes", async () => {
		expect(await fingerprintOf(sample, canonicalize)).toBe("48bf5377");
		expect(await fingerprintOf(tampered, canonicalize)).toBe("5becb567");
		expect(await fingerprintOf("not a receipt", canonicalize)).toBeNull();
		expect(await fingerprintOf({ receipt: null }, canonicalize)).toBeNull();
	});

	test("the rosette is deterministic and differs between fingerprints", () => {
		const one = rosettePaths("48bf5377", BANDS_FULL);
		expect(rosettePaths("48bf5377", BANDS_FULL)).toEqual(one);
		expect(rosettePaths("5becb567", BANDS_FULL)).not.toEqual(one);
		expect(one).toHaveLength(
			BANDS_FULL.reduce((sum, band) => sum + band.copies, 0),
		);
	});
});
