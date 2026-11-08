import { describe, expect, test } from "bun:test";
import { backupKey } from "../src/backup";
import { pruneSuperseded, RETENTION_DAYS } from "../src/prune";
import { memoryBucket } from "./fakes";

const quiet = { error: () => {} };
const DAY = 86_400_000;
const NOW = new Date("2026-12-31T00:00:00Z");
const OLD = new Date(NOW.getTime() - (RETENTION_DAYS + 5) * DAY);
const RECENT = new Date(NOW.getTime() - 2 * DAY);

/** A source and a backup whose copies were uploaded at chosen times. */
const setup = () => {
	let clock = OLD;
	const source = memoryBucket({}, () => clock);
	const backup = memoryBucket({}, () => clock);
	const copy = (key: string, etag: string, at: Date) => {
		clock = at;
		backup.write(backupKey(key, etag), "copy");
	};
	const put = (key: string, bytes: string, at: Date) => {
		clock = at;
		source.write(key, bytes);
		return source.objects.get(key)?.etag as string;
	};
	return { source, backup, copy, put };
};

describe("pruning superseded copies", () => {
	test("an old copy of an object that never changed is kept forever", async () => {
		const { source, backup, copy, put } = setup();
		const etag = put("schools/a/events/1.jsonl", "one", OLD);
		copy("schools/a/events/1.jsonl", etag, OLD);
		const result = await pruneSuperseded({
			source: source.bucket,
			backup: backup.bucket,
			state: {},
			now: NOW,
			budget: 900,
			log: quiet,
		});
		expect(result).toMatchObject({ deleted: 0, kept: 1, complete: true });
		expect(backup.objects.size).toBe(1);
	});

	test("an old copy of a rewritten object is deleted; the current version's copy stays", async () => {
		const { source, backup, copy, put } = setup();
		const first = put("schools/a/views/manifest.json", "m1", OLD);
		copy("schools/a/views/manifest.json", first, OLD);
		const second = put("schools/a/views/manifest.json", "m2", OLD);
		copy("schools/a/views/manifest.json", second, OLD);
		const result = await pruneSuperseded({
			source: source.bucket,
			backup: backup.bucket,
			state: {},
			now: NOW,
			budget: 900,
			log: quiet,
		});
		expect(result).toMatchObject({ deleted: 1, kept: 1 });
		expect(
			backup.objects.has(backupKey("schools/a/views/manifest.json", first)),
		).toBe(false);
		expect(
			backup.objects.has(backupKey("schools/a/views/manifest.json", second)),
		).toBe(true);
	});

	test("a superseded copy younger than the retention is kept", async () => {
		const { source, backup, copy, put } = setup();
		const first = put("k", "1", RECENT);
		copy("k", first, RECENT);
		put("k", "2", RECENT);
		const result = await pruneSuperseded({
			source: source.bucket,
			backup: backup.bucket,
			state: {},
			now: NOW,
			budget: 900,
			log: quiet,
		});
		expect(result).toMatchObject({ deleted: 0, kept: 1 });
	});

	test("an old copy of an object deleted at the source is deleted", async () => {
		const { source, backup, copy, put } = setup();
		const etag = put("gone", "x", OLD);
		copy("gone", etag, OLD);
		source.objects.delete("gone");
		const result = await pruneSuperseded({
			source: source.bucket,
			backup: backup.bucket,
			state: {},
			now: NOW,
			budget: 900,
			log: quiet,
		});
		expect(result.deleted).toBe(1);
	});

	test("a large backup is pruned across runs within the budget", async () => {
		const { source, backup, copy, put } = setup();
		for (let index = 0; index < 500; index += 1) {
			const key = `k/${index}`;
			const first = put(key, "1", OLD);
			copy(key, first, OLD);
			put(key, "2", OLD);
		}
		let state = {};
		let deleted = 0;
		let runs = 0;
		while (runs < 20) {
			const before = source.calls() + backup.calls();
			const result = await pruneSuperseded({
				source: source.bucket,
				backup: backup.bucket,
				state,
				now: NOW,
				budget: 300,
				log: quiet,
			});
			expect(source.calls() + backup.calls() - before).toBeLessThanOrEqual(300);
			deleted += result.deleted;
			state = result.state;
			runs += 1;
			if (result.complete) break;
		}
		expect(deleted).toBe(500);
		expect(runs).toBeGreaterThan(1);
	});
});
