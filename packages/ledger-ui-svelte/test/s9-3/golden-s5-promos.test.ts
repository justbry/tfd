import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { flushSync } from "svelte";
import type { MountedApp } from "../../src/app/mount.ts";
import { found, type GoldenFile, runEntry } from "./golden-runner.ts";
import { openPane, settle } from "./harness.ts";

/**
 * The Promos entries of the Preact package's Ledger, Reports and Promos golden file (packages/ledger-ui/test/golden/S5.json,
 * read in place and unchanged): every entry whose id starts with `promos-` runs against the Svelte Promos tab with the
 * runner and the mapping of golden-s3.test.ts. The other S5 entries (Ledger, Reports) are S9.4's.
 */
const golden = JSON.parse(
	readFileSync(
		join(import.meta.dir, "../../../ledger-ui/test/golden/S5.json"),
		"utf8",
	),
) as GoldenFile;
/** `promos-redemptions` ends on the Ledger tab's filter chip, which is S9.4's: its click is checked by hash below. */
const ledgerEntry = "promos-redemptions";
const entries = golden.entries.filter(
	(entry) => entry.id.startsWith("promos-") && entry.id !== ledgerEntry,
);

let mounted: MountedApp | undefined;
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
	document.body.innerHTML = "";
});

describe("golden S5 (Promos) on the Svelte Promos tab", () => {
	test("the file has the Promos entries this test runs", () => {
		expect(entries.map((entry) => entry.id)).toContain("promos-default");
		expect(entries.length).toBe(15);
	});
	test("Redemptions opens the Ledger for the year to date filtered to that code (the filter chip itself is S9.4's)", async () => {
		const entry = golden.entries.find(({ id }) => id === ledgerEntry);
		if (!entry)
			throw new Error("the golden file has no promos-redemptions entry");
		const { app, root } = await openPane(entry.route);
		mounted = app;
		await settle(root);
		(
			await found(
				"[data-test=promo-row][data-promo=c_01] [data-test=promo-redemptions]",
			)
		).click();
		flushSync();
		expect(window.location.hash).toContain("/vol/ledger");
		expect(window.location.hash).toContain("promo=c_01");
		expect(window.location.hash).toContain("month=2026-01-01..2026-11-05");
	});
	for (const entry of entries)
		test(entry.id, async () => {
			await runEntry(entry, (app) => {
				mounted = app;
			});
		});
});
