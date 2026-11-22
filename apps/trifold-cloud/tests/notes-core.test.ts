import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import {
	migrateNote,
	NOTE_MIGRATIONS,
	RemoteNoteStore,
	SqliteNoteStore,
} from "../src/notes/do-store";
import {
	confirmedByWording,
	isPlausibleEmail,
	maskEmail,
	normalizeEmail,
} from "../src/notes/masking";
import { MemoryNoteStore } from "../src/notes/memory-store";
import {
	escapeHtml,
	formatAmount,
	parseAmount,
	ratePercent,
} from "../src/notes/pages";
import { constantTimeEqual } from "../src/notes/sessions";
import type { NoteStore } from "../src/notes/store";
import { durableState } from "./fakes";
import { noteNamespace, notesEnv } from "./notes-fakes";

describe("masking", () => {
	test("keeps the first letter and the top-level domain", () => {
		expect(maskEmail("ana@example.com")).toBe("a**@e******.com");
		expect(maskEmail("maria.lopez@mail.school.org")).toBe(
			"m**********@m***.s*****.org",
		);
		expect(maskEmail("x@y.io")).toBe("x@y.io");
	});

	test("the confirmation wording names the holder of the masked address, never a signature", () => {
		const wording = confirmedByWording(maskEmail("ana@example.com"));
		expect(wording).toBe("confirmed by the holder of a**@e******.com");
		expect(wording).not.toMatch(/sign/i);
	});

	test("addresses are normalized and plausibility-checked", () => {
		expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
		expect(isPlausibleEmail("ana@example.com")).toBe(true);
		for (const bad of [
			"ana",
			"ana@",
			"@example.com",
			"a b@example.com",
			"a@b",
			"a@@b.com",
			"<a>@b.com",
		])
			expect(isPlausibleEmail(bad)).toBe(false);
	});
});

describe("escapeHtml", () => {
	test("escapes markup, quotes and ampersands", () => {
		expect(escapeHtml(`<script>alert("x")</script> & 'y'`)).toBe(
			"&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;y&#39;",
		);
		expect(escapeHtml("plain")).toBe("plain");
	});
});

describe("money text", () => {
	test("formats minor units with the exponent, without floats", () => {
		expect(formatAmount("35000", 2)).toBe("350.00");
		expect(formatAmount("5", 2)).toBe("0.05");
		expect(formatAmount("0", 2)).toBe("0.00");
		expect(formatAmount("123456789012345678901234", 2)).toBe(
			"1,234,567,890,123,456,789,012.34",
		);
		expect(formatAmount("-1250", 2)).toBe("-12.50");
		expect(formatAmount("1200", 0)).toBe("1,200");
		expect(formatAmount("12345", 4)).toBe("1.2345");
		expect(formatAmount("12x", 2)).toBe("?");
	});

	test("reads what a person typed, within the note's decimals", () => {
		expect(parseAmount("350", 2)).toBe("35000");
		expect(parseAmount("350.5", 2)).toBe("35050");
		expect(parseAmount(" 0.05 ", 2)).toBe("5");
		expect(parseAmount("350.505", 2)).toBeNull();
		expect(parseAmount("350.5", 0)).toBeNull();
		expect(parseAmount("-5", 2)).toBeNull();
		expect(parseAmount("1e3", 2)).toBeNull();
		expect(parseAmount("", 2)).toBeNull();
	});

	test("shows a rate as a percent by string arithmetic", () => {
		expect(ratePercent("0.0525")).toBe("5.25%");
		expect(ratePercent("0")).toBe("0%");
		expect(ratePercent("0.05")).toBe("5%");
		expect(ratePercent("0.123456")).toBe("12.3456%");
		expect(ratePercent("0.005")).toBe("0.5%");
	});
});

describe("constantTimeEqual", () => {
	test("is true only for equal strings, and never throws on different lengths", () => {
		expect(constantTimeEqual("abc", "abc")).toBe(true);
		expect(constantTimeEqual("abc", "abd")).toBe(false);
		expect(constantTimeEqual("abc", "abcd")).toBe(false);
		expect(constantTimeEqual("", "a")).toBe(false);
		expect(constantTimeEqual("", "")).toBe(true);
		expect(constantTimeEqual("é", "é")).toBe(false);
	});
});

const sqliteStore = (): NoteStore => {
	const state = durableState(new Database(":memory:"));
	migrateNote(state);
	return new SqliteNoteStore(state);
};

const link = (seq: number) => ({
	seq,
	event_id: `e${seq}`,
	event_hash: "h",
	prev_hash: "p",
});

const stores: [string, () => NoteStore][] = [
	["memory", () => new MemoryNoteStore()],
	["sqlite Durable Object storage", sqliteStore],
	[
		"remote (Worker to NoteDO)",
		() => new RemoteNoteStore(noteNamespace(notesEnv())),
	],
];

for (const [name, make] of stores) {
	describe(`NoteStore contract: ${name}`, () => {
		test("compare-and-append: a writer that read an old seq gets a conflict and nothing is written", async () => {
			const store = make();
			expect(
				await store.append("n1", 0, { eventJson: "{}", link: link(1) }),
			).toEqual({ ok: true });
			expect(
				await store.append("n1", 0, { eventJson: '{"x":1}', link: link(1) }),
			).toEqual({
				ok: false,
				reason: "conflict",
				seq: 1,
			});
			expect(
				await store.append("n1", 1, { eventJson: '{"y":2}', link: link(2) }),
			).toEqual({ ok: true });
			const log = await store.readLog("n1");
			expect(log.events).toEqual(["{}", '{"y":2}']);
			expect(log.links.map((entry) => entry.seq)).toEqual([1, 2]);
		});

		test("contacts are written once", async () => {
			const store = make();
			expect(await store.getContacts("n1")).toBeNull();
			await store.putContacts("n1", { lender: "a@x.com", borrower: "b@x.com" });
			await store.putContacts("n1", { lender: "c@x.com", borrower: "d@x.com" });
			expect(await store.getContacts("n1")).toEqual({
				lender: "a@x.com",
				borrower: "b@x.com",
			});
		});

		test("an invite opens once and not after its expiry", async () => {
			const store = make();
			await store.putInvite("n1", {
				hash: "h1",
				role: "borrower",
				expiresAt: "2026-11-23T00:00:00.000Z",
			});
			await store.putInvite("n1", {
				hash: "h2",
				role: "lender",
				expiresAt: "2026-11-23T00:00:00.000Z",
			});
			expect(
				await store.redeemInvite("n1", "h1", "2026-11-22T00:00:00.000Z"),
			).toBe("borrower");
			expect(
				await store.redeemInvite("n1", "h1", "2026-11-22T00:00:01.000Z"),
			).toBeNull();
			expect(
				await store.redeemInvite("n1", "h2", "2026-11-23T00:00:00.000Z"),
			).toBeNull();
			expect(
				await store.redeemInvite("n1", "nope", "2026-11-22T00:00:00.000Z"),
			).toBeNull();
		});

		test("a session slides on use, ends when idle too long, and ends at its absolute time", async () => {
			const store = make();
			const session = {
				hash: "s1",
				role: "lender" as const,
				createdAt: "2026-11-22T00:00:00.000Z",
				lastSeenAt: "2026-11-22T00:00:00.000Z",
				absoluteExpiresAt: "2026-11-22T05:00:00.000Z",
			};
			await store.putSession("n1", session);
			const hour = 3_600_000;
			expect(
				(
					await store.touchSession(
						"n1",
						"s1",
						"2026-11-22T01:30:00.000Z",
						2 * hour,
					)
				)?.role,
			).toBe("lender");
			expect(
				(
					await store.touchSession(
						"n1",
						"s1",
						"2026-11-22T03:00:00.000Z",
						2 * hour,
					)
				)?.role,
			).toBe("lender");
			expect(
				await store.touchSession(
					"n1",
					"s1",
					"2026-11-22T05:30:00.000Z",
					2 * hour,
				),
			).toBeNull();
			expect(
				await store.touchSession(
					"n1",
					"s1",
					"2026-11-22T05:31:00.000Z",
					2 * hour,
				),
			).toBeNull();
			await store.putSession("n1", { ...session, hash: "s2" });
			expect(
				await store.touchSession(
					"n1",
					"s2",
					"2026-11-22T05:00:00.000Z",
					10 * hour,
				),
			).toBeNull();
		});

		test("a code allows N tries, expires, and is used once", async () => {
			const store = make();
			const code = {
				codeHash: "c",
				action: "terms.accepted",
				expiresAt: "2026-11-22T00:10:00.000Z",
			};
			await store.putCode("n1", "s1", code);
			const now = "2026-11-22T00:01:00.000Z";
			expect((await store.takeAttempt("n1", "s1", now, 2)).status).toBe("ok");
			expect((await store.takeAttempt("n1", "s1", now, 2)).status).toBe("ok");
			expect((await store.takeAttempt("n1", "s1", now, 2)).status).toBe(
				"locked",
			);
			await store.putCode("n1", "s1", code);
			expect(
				(await store.takeAttempt("n1", "s1", "2026-11-22T00:10:00.000Z", 5))
					.status,
			).toBe("expired");
			expect((await store.takeAttempt("n1", "s1", now, 5)).status).toBe("none");
			await store.putCode("n1", "s1", code);
			expect(await store.clearCode("n1", "s1")).toBe(true);
			expect(await store.clearCode("n1", "s1")).toBe(false);
		});

		test("a counter allows `limit` hits per window and starts over after it", async () => {
			const store = make();
			const at = (second: number) =>
				`2026-11-22T00:00:${String(second).padStart(2, "0")}.000Z`;
			expect(await store.hit("n1", "k", at(0), 10_000, 2)).toBe(true);
			expect(await store.hit("n1", "k", at(1), 10_000, 2)).toBe(true);
			expect(await store.hit("n1", "k", at(2), 10_000, 2)).toBe(false);
			expect(await store.hit("n1", "other", at(2), 10_000, 2)).toBe(true);
			expect(await store.hit("n1", "k", at(10), 10_000, 2)).toBe(true);
		});

		test("an idempotency key is new once, then the same request is `same` and another is `different`", async () => {
			const store = make();
			expect(await store.claimIdempotency("n1", "api", "k", "f1")).toBe("new");
			expect(await store.claimIdempotency("n1", "api", "k", "f1")).toBe("same");
			expect(await store.claimIdempotency("n1", "api", "k", "f2")).toBe(
				"different",
			);
			expect(await store.claimIdempotency("n1", "other", "k", "f2")).toBe(
				"new",
			);
		});
	});
}

describe("note Durable Object migrations", () => {
	test("a new object runs every step once and waking again changes nothing", () => {
		const db = new Database(":memory:");
		expect(migrateNote(durableState(db))).toBe(NOTE_MIGRATIONS.length);
		expect(migrateNote(durableState(db))).toBe(NOTE_MIGRATIONS.length);
		expect(db.query("SELECT COUNT(*) AS n FROM schema_version").get()).toEqual({
			n: 1,
		});
	});

	test("the Durable Object refuses a method outside the store's list", async () => {
		const env = notesEnv();
		const stub = env.NOTE.get(env.NOTE.idFromName("n1"));
		const response = await stub.fetch(
			new Request("https://note.internal/rpc", {
				method: "POST",
				body: JSON.stringify({ method: "constructor", noteId: "n1", args: [] }),
			}),
		);
		expect(response.status).toBe(400);
	});
});

describe("source scan: src/notes", () => {
	const directory = join(import.meta.dir, "..", "src", "notes");
	const files = readdirSync(directory).filter((file) => file.endsWith(".ts"));

	test("there are files to scan", () => {
		expect(files.length).toBeGreaterThanOrEqual(9);
	});

	test("no console.log, no Math.random, no banned claim words", async () => {
		const banned =
			/\b(proof|enforceable|binding|tamper-proof|legally|credit)\b/i;
		for (const file of files) {
			const text = await Bun.file(join(directory, file)).text();
			expect({ file, hit: /console\.log/.test(text) }).toEqual({
				file,
				hit: false,
			});
			expect({ file, hit: /Math\.random/.test(text) }).toEqual({
				file,
				hit: false,
			});
			expect({ file, hit: banned.exec(text)?.[0] ?? null }).toEqual({
				file,
				hit: null,
			});
		}
	});

	test("no node: import in src/notes", async () => {
		for (const file of files) {
			const text = await Bun.file(join(directory, file)).text();
			expect({ file, hit: /from "node:/.test(text) }).toEqual({
				file,
				hit: false,
			});
		}
	});
});

describe("wiring", () => {
	test("NOTE is bound as NoteDO at the top level and in staging, with its own SQLite migration", async () => {
		const COMMENT_LINE = /^\s*\/\/.*$/gm;
		const config = JSON.parse(
			(
				await Bun.file(join(import.meta.dir, "..", "wrangler.jsonc")).text()
			).replace(COMMENT_LINE, ""),
		);
		const binding = { name: "NOTE", class_name: "NoteDO" };
		expect(config.durable_objects.bindings).toContainEqual(binding);
		expect(config.env.staging.durable_objects.bindings).toContainEqual(binding);
		expect(config.migrations).toContainEqual({
			tag: "v2",
			new_sqlite_classes: ["NoteDO"],
		});
	});
});
