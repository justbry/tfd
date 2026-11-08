import { describe, expect, test } from "bun:test";
import { backupKey } from "../src/backup";
import { pruneSuperseded, RETENTION_DAYS } from "../src/prune";
import { memoryBucket, memoryD1 } from "./fakes";

const quiet = { error: () => {} };
const DAY = 86_400_000;
const NOW = new Date("2026-12-31T00:00:00Z");
const LATER = new Date(NOW.getTime() + (RETENTION_DAYS + 1) * DAY);
const OLD = new Date(NOW.getTime() - 365 * DAY);

/** A source and a backup whose objects were written at chosen times, plus the D1 that remembers supersession. */
const setup = () => {
	let clock = OLD;
	const source = memoryBucket({}, () => clock);
	const backup = memoryBucket({}, () => clock);
	const { db } = memoryD1();
	const put = (key: string, bytes: string, at: Date) => {
		clock = at;
		source.write(key, bytes);
		return source.objects.get(key)?.etag as string;
	};
	const copy = (key: string, etag: string, at: Date) => {
		clock = at;
		backup.write(backupKey(key, etag), "copy");
	};
	const prune = (now: Date, budget = 900) =>
		pruneSuperseded({
			db,
			source: source.bucket,
			backup: backup.bucket,
			state: {},
			now,
			budget,
			log: quiet,
		});
	return { source, backup, put, copy, prune };
};

describe("pruning superseded copies", () => {
	test("an old copy of an object that never changed is kept forever", async () => {
		const { backup, put, copy, prune } = setup();
		copy("a", put("a", "one", OLD), OLD);
		await prune(NOW);
		await prune(LATER);
		expect(backup.objects.size).toBe(1);
	});

	test("a year-old object deleted at the source just now keeps its copy for 30 days, then the copy goes", async () => {
		const { source, backup, put, copy, prune } = setup();
		const etag = put("a", "one", OLD);
		copy("a", etag, OLD);
		source.objects.delete("a");
		expect(await prune(NOW)).toMatchObject({ deleted: 0 });
		expect(backup.objects.has(backupKey("a", etag))).toBe(true);
		expect(await prune(new Date(NOW.getTime() + 10 * DAY))).toMatchObject({
			deleted: 0,
		});
		expect(await prune(LATER)).toMatchObject({ deleted: 1 });
		expect(backup.objects.has(backupKey("a", etag))).toBe(false);
	});

	test("a copy restored to the source and deleted again gets a fresh 30 days", async () => {
		const { source, backup, put, copy, prune } = setup();
		const etag = put("a", "one", OLD);
		copy("a", etag, OLD);
		const stored = source.objects.get("a");
		source.objects.delete("a");
		await prune(NOW);
		if (stored) source.objects.set("a", stored);
		await prune(new Date(NOW.getTime() + DAY));
		source.objects.delete("a");
		expect(await prune(LATER)).toMatchObject({ deleted: 0 });
		expect(backup.objects.has(backupKey("a", etag))).toBe(true);
	});

	test("a year-old object rewritten just now keeps its old copy for 30 days, and longer until the new version is copied", async () => {
		const { backup, put, copy, prune } = setup();
		const first = put("a", "one", OLD);
		copy("a", first, OLD);
		const second = put("a", "two", NOW);
		expect(await prune(NOW)).toMatchObject({ deleted: 0 });
		// 30 days on, but the current version was never backed up: the old copy is the only one, so it stays.
		expect(await prune(LATER)).toMatchObject({ deleted: 0 });
		copy("a", second, LATER);
		expect(await prune(new Date(LATER.getTime() + DAY))).toMatchObject({
			deleted: 1,
		});
		expect(backup.objects.has(backupKey("a", first))).toBe(false);
		expect(backup.objects.has(backupKey("a", second))).toBe(true);
	});

	test("a young copy superseded the same day is deleted 30 days later, not 60", async () => {
		const { source, backup, put, copy, prune } = setup();
		const etag = put("a", "one", NOW);
		copy("a", etag, NOW);
		source.objects.delete("a");
		expect(await prune(NOW)).toMatchObject({ deleted: 0, kept: 1 });
		expect(await prune(new Date(NOW.getTime() + 10 * DAY))).toMatchObject({
			deleted: 0,
		});
		expect(await prune(LATER)).toMatchObject({ deleted: 1 });
		expect(backup.objects.has(backupKey("a", etag))).toBe(false);
	});

	test("a large backup is pruned across runs within the budget", async () => {
		const { source, backup, put, copy } = setup();
		const { db } = memoryD1();
		for (let index = 0; index < 300; index += 1) {
			const key = `k/${String(index).padStart(4, "0")}`;
			copy(key, put(key, "1", OLD), OLD);
			copy(key, put(key, "2", OLD), OLD);
		}
		const runPass = async (now: Date) => {
			let state = {};
			let deleted = 0;
			for (let runs = 0; runs < 50; runs += 1) {
				const before = source.calls() + backup.calls();
				const result = await pruneSuperseded({
					db,
					source: source.bucket,
					backup: backup.bucket,
					state,
					now,
					budget: 300,
					log: quiet,
				});
				expect(source.calls() + backup.calls() - before).toBeLessThanOrEqual(
					300,
				);
				deleted += result.deleted;
				state = result.state;
				if (result.complete) return { deleted, runs: runs + 1 };
			}
			throw new Error("pass never completed");
		};
		expect((await runPass(NOW)).deleted).toBe(0);
		const second = await runPass(LATER);
		expect(second.deleted).toBe(300);
		expect(second.runs).toBeGreaterThan(1);
	});

	test("restoring an object clears its supersession, so a later mistake gets the full 30 days", async () => {
		const { source, backup, put, copy, prune } = setup();
		const etag = put("a", "one", OLD);
		copy("a", etag, OLD);
		source.objects.delete("a");
		await prune(NOW);
		// Restored three days later with the original bytes: the fake gives a new ETag on every write, so pin it back.
		const restoredAt = new Date(NOW.getTime() + 3 * DAY);
		put("a", "one", restoredAt);
		(source.objects.get("a") as { etag: string }).etag = etag;
		await prune(restoredAt);
		// Deleted again 200 days later: the copy must survive the next 30 days.
		const secondMistake = new Date(NOW.getTime() + 200 * DAY);
		source.objects.delete("a");
		expect(await prune(secondMistake)).toMatchObject({ deleted: 0 });
		expect(
			await prune(new Date(secondMistake.getTime() + 10 * DAY)),
		).toMatchObject({ deleted: 0 });
		expect(backup.objects.has(backupKey("a", etag))).toBe(true);
		expect(
			await prune(new Date(secondMistake.getTime() + 31 * DAY)),
		).toMatchObject({ deleted: 1 });
	});
});
