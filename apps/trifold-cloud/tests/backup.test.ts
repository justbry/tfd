import { describe, expect, test } from "bun:test";
import {
	backupBucket,
	backupKey,
	DEFAULT_SUBREQUEST_BUDGET,
	readBackupState,
	runBackup,
} from "../src/backup";
import { memoryBucket, memoryD1 } from "./fakes";

const quiet = { log: () => {}, error: () => {} };
const NOW = new Date("2026-11-08T03:17:00Z");

describe("backup keys", () => {
	test("versions/<etag>/<key>, unambiguous even for keys with @ or /", () => {
		expect(backupKey("schools/a/x@y.json", "abc123")).toBe(
			"versions/abc123/schools/a/x@y.json",
		);
	});
});

describe("nightly backup", () => {
	test("copies everything the first time, nothing the next pass", async () => {
		const source = memoryBucket(
			{
				"schools/a/events/1.jsonl": "one",
				"schools/a/views/manifest.json": "m1",
			},
			() => new Date("2026-11-01T00:00:00Z"),
		);
		const backup = memoryBucket();
		const { db } = memoryD1();
		const first = await runBackup(
			{ db, source: source.bucket, backup: backup.bucket },
			NOW,
			quiet,
		);
		expect(first).toMatchObject({
			copied: 2,
			failed: 0,
			complete: true,
			state: { watermark: NOW.toISOString() },
		});
		const etag = source.objects.get("schools/a/events/1.jsonl")?.etag as string;
		expect(
			backup.objects.get(backupKey("schools/a/events/1.jsonl", etag))?.bytes,
		).toBe("one");
		const second = await runBackup(
			{ db, source: source.bucket, backup: backup.bucket },
			new Date(NOW.getTime() + 86_400_000),
			quiet,
		);
		expect(second).toMatchObject({
			copied: 0,
			skipped: 0,
			failed: 0,
			complete: true,
		});
	});

	test("an object changed in place gains a new copy and the old one stays", async () => {
		let now = new Date("2026-11-07T00:00:00Z");
		const source = memoryBucket(
			{ "schools/a/views/manifest.json": "m1" },
			() => now,
		);
		const backup = memoryBucket();
		const { db } = memoryD1();
		await runBackup(
			{ db, source: source.bucket, backup: backup.bucket },
			NOW,
			quiet,
		);
		const firstEtag = source.objects.get("schools/a/views/manifest.json")
			?.etag as string;
		now = new Date(NOW.getTime() + 3_600_000);
		source.write("schools/a/views/manifest.json", "m2");
		const secondEtag = source.objects.get("schools/a/views/manifest.json")
			?.etag as string;
		const result = await runBackup(
			{ db, source: source.bucket, backup: backup.bucket },
			new Date(NOW.getTime() + 86_400_000),
			quiet,
		);
		expect(result.copied).toBe(1);
		expect(
			backup.objects.get(backupKey("schools/a/views/manifest.json", firstEtag))
				?.bytes,
		).toBe("m1");
		expect(
			backup.objects.get(backupKey("schools/a/views/manifest.json", secondEtag))
				?.bytes,
		).toBe("m2");
	});

	test("a large bucket is copied across runs within the subrequest budget, resuming from the saved cursor", async () => {
		const many = Object.fromEntries(
			Array.from({ length: 1200 }, (_, index) => [
				`k/${String(index).padStart(5, "0")}`,
				"x",
			]),
		);
		const source = memoryBucket(many);
		const backup = memoryBucket();
		const { db } = memoryD1();
		let runs = 0;
		let result: Awaited<ReturnType<typeof runBackup>>;
		do {
			const before = source.calls() + backup.calls();
			result = await runBackup(
				{ db, source: source.bucket, backup: backup.bucket },
				NOW,
				quiet,
			);
			expect(source.calls() + backup.calls() - before).toBeLessThanOrEqual(
				DEFAULT_SUBREQUEST_BUDGET,
			);
			runs += 1;
		} while (!result.complete && runs < 20);
		expect(result.complete).toBe(true);
		expect(runs).toBeGreaterThan(1);
		expect(backup.objects.size).toBe(1200);
		expect((await readBackupState(db)).watermark).toBe(NOW.toISOString());
	});

	test("a failed object is counted and logged, the rest still copy, and the watermark doesn't move", async () => {
		const source = memoryBucket({ a: "1", b: "2", c: "3" });
		const backup = memoryBucket();
		backup.failingPuts.add(
			backupKey("b", source.objects.get("b")?.etag as string),
		);
		const errors: string[] = [];
		const result = await backupBucket({
			source: source.bucket,
			backup: backup.bucket,
			state: { watermark: null },
			now: NOW,
			log: { error: (message: string) => errors.push(message) },
		});
		expect(result).toMatchObject({
			copied: 2,
			failed: 1,
			complete: true,
			state: { watermark: null },
		});
		expect(errors).toHaveLength(1);
	});

	test("a pass that failed is retried in full next time and then advances", async () => {
		const source = memoryBucket({ a: "1", b: "2" });
		const backup = memoryBucket();
		const { db } = memoryD1();
		const target = backupKey("b", source.objects.get("b")?.etag as string);
		backup.failingPuts.add(target);
		expect(
			(
				await runBackup(
					{ db, source: source.bucket, backup: backup.bucket },
					NOW,
					quiet,
				)
			).failed,
		).toBe(1);
		backup.failingPuts.delete(target);
		const retry = await runBackup(
			{ db, source: source.bucket, backup: backup.bucket },
			NOW,
			quiet,
		);
		expect(retry).toMatchObject({
			copied: 1,
			skipped: 1,
			failed: 0,
			complete: true,
		});
		expect((await readBackupState(db)).watermark).toBe(NOW.toISOString());
	});

	test("an object rewritten between the listing and the copy is not stored under the old ETag", async () => {
		const source = memoryBucket(
			{ a: "old" },
			() => new Date("2026-11-01T00:00:00Z"),
		);
		const backup = memoryBucket();
		const listedEtag = source.objects.get("a")?.etag as string;
		// Rewrite "a" after the list call but before the get: wrap list to rewrite once it has answered.
		const list = source.bucket.list;
		source.bucket.list = async (options) => {
			const page = await list(options);
			source.write("a", "new");
			return page;
		};
		const result = await backupBucket({
			source: source.bucket,
			backup: backup.bucket,
			state: { watermark: null },
			now: NOW,
			log: quiet,
		});
		expect(result).toMatchObject({
			copied: 0,
			failed: 1,
			state: { watermark: null },
		});
		expect(backup.objects.has(backupKey("a", listedEtag))).toBe(false);
	});

	test("bodies are streamed into the backup, not buffered", async () => {
		const source = memoryBucket({ a: "1", b: "2" });
		const backup = memoryBucket();
		await backupBucket({
			source: source.bucket,
			backup: backup.bucket,
			state: { watermark: null },
			now: NOW,
			log: quiet,
		});
		expect(backup.streamedPuts()).toBe(2);
	});
});
