/**
 * Seals under keys with a purpose and a window (`verifySeals`): a seal key of another purpose, or a `sealed_at` outside
 * its window, fails the seal. A revoked key fails its seals, but the revocation runbook cannot re-sign a line in place (its
 * hash is the next seal's `prev_seal_hash`), so it appends a new seal of the month under the current key: the revoked line
 * is then `superseded`, and the chain still links through it by its hash.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { readEvents } from "../src/ledger/files.js";
import { sealOf, signSeal, verifySeals } from "../src/ledger/seal.js";
import type { AtmEvent, AtmSignedSeal, AtmSigner } from "../src/types.js";
import {
	testKeys,
	testSigner,
	windowedKeys,
	windowedSigners,
} from "./signing-keys.js";

const FIXTURE = join(import.meta.dir, "../fixtures/vibes-year");
const SCHOOL = "sch_vol";
/** In the October keys' window, before their revocation. */
const OCTOBER_SEALED_AT = "2026-10-31T23:00:00Z";
const NOVEMBER_SEALED_AT = "2026-12-07T00:00:00Z";
/** The runbook's re-seal, after the revocation. */
const RESEALED_AT = "2026-12-08T00:00:00Z";

let events: AtmEvent[] = [];

beforeAll(async () => {
	({ events } = await readEvents(FIXTURE, SCHOOL));
});

const seal = (
	month: string,
	sealedAt: string,
	previous: AtmSignedSeal | null,
	signer: AtmSigner,
): AtmSignedSeal =>
	signSeal(
		sealOf({ school: SCHOOL, month, events, sealedAt, previous }),
		signer,
	);

const revokedSeal = windowedSigners["trifold-test-seal-2026-10"];
const currentSeal = windowedSigners["trifold-test-seal-2026-11"];

const verdicts = (seals: readonly unknown[]) =>
	verifySeals(seals, events, windowedKeys).seals.map((row) => row.verdict);

describe("verifySeals with windowed keys", () => {
	test("a seal key in its window verifies; a receipt key is key_wrong_purpose; a sealed_at outside the window is outside_key_window", () => {
		expect(
			verdicts([seal("2026-11", NOVEMBER_SEALED_AT, null, currentSeal)]),
		).toEqual(["ok"]);
		expect(
			verdicts([
				seal(
					"2026-11",
					NOVEMBER_SEALED_AT,
					null,
					windowedSigners["trifold-test-2026-11"],
				),
			]),
		).toEqual(["key_wrong_purpose"]);
		expect(
			verdicts([seal("2026-10", OCTOBER_SEALED_AT, null, currentSeal)]),
		).toEqual(["outside_key_window"]);
	});

	test("a revoked key fails its seal, whatever sealed_at says, until the month is sealed again", () => {
		const october = seal("2026-10", OCTOBER_SEALED_AT, null, revokedSeal);
		const november = seal("2026-11", NOVEMBER_SEALED_AT, october, currentSeal);
		const report = verifySeals([october, november], events, windowedKeys);
		expect(report.seals.map((row) => row.verdict)).toEqual([
			"key_revoked",
			"ok",
		]);
		expect(report.ok).toBe(false);
	});

	test("revocation, then an appended re-seal of the month under the current key: the revoked line is superseded and still a link", () => {
		const october = seal("2026-10", OCTOBER_SEALED_AT, null, revokedSeal);
		const november = seal("2026-11", NOVEMBER_SEALED_AT, october, currentSeal);
		const resealed = seal("2026-10", RESEALED_AT, november, currentSeal);
		const report = verifySeals(
			[october, november, resealed],
			events,
			windowedKeys,
		);
		expect(report).toEqual({
			ok: true,
			seals: [
				{
					month: "2026-10",
					sealed_at: OCTOBER_SEALED_AT,
					verdict: "superseded",
				},
				{ month: "2026-11", sealed_at: NOVEMBER_SEALED_AT, verdict: "ok" },
				{ month: "2026-10", sealed_at: RESEALED_AT, verdict: "ok" },
			],
			unsealedLate: [],
		});
	});

	test("a later seal of another month, or a later seal that fails, does not supersede", () => {
		const october = seal("2026-10", OCTOBER_SEALED_AT, null, revokedSeal);
		const november = seal("2026-11", NOVEMBER_SEALED_AT, october, currentSeal);
		const unlinked = seal("2026-10", RESEALED_AT, october, currentSeal);
		expect(verdicts([october, november, unlinked])).toEqual([
			"key_revoked",
			"ok",
			"broken_link",
		]);
		const byRevoked = seal("2026-10", RESEALED_AT, november, revokedSeal);
		expect(verdicts([october, november, byRevoked])).toEqual([
			"key_revoked",
			"ok",
			"key_revoked",
		]);
	});

	test("a revoked line that does not link to the seal before it is key_revoked, not broken_link, and superseded by a later re-seal", () => {
		const first = seal("2026-10", OCTOBER_SEALED_AT, null, revokedSeal);
		const misplaced = seal("2026-10", OCTOBER_SEALED_AT, null, revokedSeal);
		expect(verdicts([first, misplaced])).toEqual([
			"key_revoked",
			"key_revoked",
		]);
		const resealed = seal("2026-10", RESEALED_AT, misplaced, currentSeal);
		expect(verdicts([first, misplaced, resealed])).toEqual([
			"superseded",
			"superseded",
			"ok",
		]);
	});

	test("a seal after a revoked line with a broken link still links to that line by its hash", () => {
		const first = seal("2026-10", OCTOBER_SEALED_AT, null, revokedSeal);
		const misplaced = seal("2026-11", NOVEMBER_SEALED_AT, null, revokedSeal);
		const next = seal("2026-12", RESEALED_AT, misplaced, currentSeal);
		expect(verdicts([first, misplaced, next])).toEqual([
			"key_revoked",
			"key_revoked",
			"ok",
		]);
	});

	test("a forged seal under the stolen key, backdated into its window, is key_revoked", () => {
		const forged = signSeal(
			{
				...sealOf({
					school: SCHOOL,
					month: "2026-10",
					events,
					sealedAt: OCTOBER_SEALED_AT,
					previous: null,
				}),
				events: 0,
				event_ids: [],
			},
			revokedSeal,
		);
		expect(verdicts([forged])).toEqual(["key_revoked"]);
	});

	test("first-form keys behave as before", () => {
		const october = seal("2026-10", OCTOBER_SEALED_AT, null, testSigner);
		expect(
			verifySeals([october], events, testKeys).seals.map((row) => row.verdict),
		).toEqual(["ok"]);
	});
});
