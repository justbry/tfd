import { describe, expect, test } from "bun:test";
import { backupKey } from "../src/backup";
import { runCron } from "../src/cron";
import { fakeEnv, memoryBucket, memoryD1 } from "./fakes";

const quiet = { log: () => {}, error: () => {} };
const DAY = 86_400_000;

describe("hourly cron", () => {
	test("backs up, then prunes copies superseded for longer than the retention", async () => {
		const now = new Date("2026-12-31T00:00:00Z");
		let clock = new Date(now.getTime() - 40 * DAY);
		const books = memoryBucket({}, () => clock);
		const backups = memoryBucket({}, () => clock);
		books.write("k", "1");
		const oldEtag = books.objects.get("k")?.etag as string;
		backups.write(backupKey("k", oldEtag), "1");
		clock = new Date(now.getTime() - DAY);
		books.write("k", "2");
		const env = {
			...fakeEnv(),
			DB: memoryD1().db,
			BOOKS: books.bucket,
			BACKUPS: backups.bucket,
		};
		await runCron(env, now, quiet);
		const currentEtag = books.objects.get("k")?.etag as string;
		expect(backups.objects.has(backupKey("k", currentEtag))).toBe(true);
		// Superseded from now on: kept for the retention, then pruned.
		expect(backups.objects.has(backupKey("k", oldEtag))).toBe(true);
		await runCron(env, new Date(now.getTime() + 31 * DAY), quiet);
		expect(backups.objects.has(backupKey("k", oldEtag))).toBe(false);
	});

	test("throws when a copy fails, so the invocation shows as an error", async () => {
		const books = memoryBucket({ a: "1" });
		const backups = memoryBucket();
		backups.failingPuts.add(
			backupKey("a", books.objects.get("a")?.etag as string),
		);
		const env = {
			...fakeEnv(),
			DB: memoryD1().db,
			BOOKS: books.bucket,
			BACKUPS: backups.bucket,
		};
		await expect(runCron(env, new Date(), quiet)).rejects.toThrow(
			"1 backup and 0 prune failures",
		);
	});

	test("refuses a budget that is not a number or below the minimum", async () => {
		for (const value of ["lots", "3", "-1"]) {
			const env = { ...fakeEnv(), BACKUP_SUBREQUEST_BUDGET: value };
			await expect(runCron(env, new Date(), quiet)).rejects.toThrow(
				"BACKUP_SUBREQUEST_BUDGET must be a number",
			);
		}
	});
});
