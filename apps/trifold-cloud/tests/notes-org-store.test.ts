import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import {
	migrateNote,
	RemoteNoteStore,
	SqliteNoteStore,
} from "../src/notes/do-store";
import { MemoryNoteStore } from "../src/notes/memory-store";
import { D1OrgStore } from "../src/notes/org-d1-store";
import { MemoryOrgStore } from "../src/notes/org-memory-store";
import type { OrgStore } from "../src/notes/org-store";
import type { NoteStore } from "../src/notes/store";
import { applyD1Migrations, durableState, sqliteD1 } from "./fakes";
import { BORROWER_EMAIL, noteNamespace, notesEnv } from "./notes-fakes";
import {
	BOARD,
	expectOk,
	ORG_ID,
	orgHarness,
	TREASURER,
	VIEWER,
} from "./notes-org-fakes";

const d1Store = (): OrgStore => {
	const db = new Database(":memory:");
	applyD1Migrations(db);
	return new D1OrgStore(sqliteD1(db));
};

const orgStores: [string, () => OrgStore][] = [
	["memory", () => new MemoryOrgStore()],
	["D1 (migration 0003, real SQL)", d1Store],
];

const at = (second: number): string =>
	`2026-11-22T00:00:${String(second).padStart(2, "0")}.000Z`;
const HOUR = 3_600_000;

for (const [name, make] of orgStores) {
	describe(`OrgStore contract: ${name}`, () => {
		test("a note is indexed once, listed in id order and cut at the limit; organizations are apart", async () => {
			const store = make();
			await store.registerNote("o1", "nt_b", "lender", at(0));
			await store.registerNote("o1", "nt_a", "lender", at(1));
			await store.registerNote("o1", "nt_a", "lender", at(2));
			await store.registerNote("o2", "nt_z", "lender", at(0));
			expect(await store.listNotes("o1", 10)).toEqual(["nt_a", "nt_b"]);
			expect(await store.listNotes("o1", 1)).toEqual(["nt_a"]);
			expect(await store.listNotes("o2", 10)).toEqual(["nt_z"]);
			expect(await store.listNotes("o3", 10)).toEqual([]);
		});

		test("an agent is found or made by address hash, keeps its ref, and takes the latest role and comes back active", async () => {
			const store = make();
			const first = await store.upsertAgent("o1", {
				newRef: "ag_1",
				emailHash: "h1",
				role: "treasurer",
				now: at(0),
			});
			expect(first).toEqual({
				agentRef: "ag_1",
				role: "treasurer",
				active: true,
			});
			expect(await store.setAgentActive("o1", "ag_1", false)).toBe(true);
			expect((await store.getAgent("o1", "ag_1"))?.active).toBe(false);
			const again = await store.upsertAgent("o1", {
				newRef: "ag_other",
				emailHash: "h1",
				role: "board",
				now: at(1),
			});
			expect(again).toEqual({ agentRef: "ag_1", role: "board", active: true });
			expect(await store.findAgent("o1", "h1")).toEqual(again);
			expect(await store.findAgent("o1", "nope")).toBeNull();
			// The same hash in another organization is another agent.
			const other = await store.upsertAgent("o2", {
				newRef: "ag_2",
				emailHash: "h1",
				role: "viewer",
				now: at(2),
			});
			expect(other.agentRef).toBe("ag_2");
			expect(await store.getAgent("o2", "ag_1")).toBeNull();
			expect(await store.setAgentActive("o1", "ag_missing", true)).toBe(false);
		});

		test("a link opens once, not after expiry, and only in its own organization; deleting an agent's links removes them", async () => {
			const store = make();
			const link = (hash: string, agentRef = "ag_1") => ({
				hash,
				agentRef,
				expiresAt: "2026-11-23T00:00:00.000Z",
			});
			await store.putLink("o1", link("l1"));
			await store.putLink("o1", link("l2"));
			await store.putLink("o1", link("l3", "ag_2"));
			expect(await store.redeemLink("o2", "l1", at(0))).toBeNull();
			expect(await store.redeemLink("o1", "l1", at(0))).toBe("ag_1");
			expect(await store.redeemLink("o1", "l1", at(1))).toBeNull();
			expect(
				await store.redeemLink("o1", "l2", "2026-11-23T00:00:00.000Z"),
			).toBeNull();
			await store.putLink("o1", link("l4"));
			await store.deleteLinksOf("o1", "ag_1");
			expect(await store.redeemLink("o1", "l4", at(2))).toBeNull();
			expect(await store.redeemLink("o1", "l3", at(2))).toBe("ag_2");
		});

		test("a session slides, ends when idle or at its absolute time, belongs to one organization, and can be deleted by agent", async () => {
			const store = make();
			const session = (hash: string, agentRef = "ag_1") => ({
				hash,
				orgId: "o1",
				agentRef,
				createdAt: "2026-11-22T00:00:00.000Z",
				lastSeenAt: "2026-11-22T00:00:00.000Z",
				absoluteExpiresAt: "2026-11-22T05:00:00.000Z",
			});
			await store.putSession(session("s1"));
			expect(
				await store.touchSession(
					"o2",
					"s1",
					"2026-11-22T01:00:00.000Z",
					2 * HOUR,
				),
			).toBeNull();
			expect(
				(
					await store.touchSession(
						"o1",
						"s1",
						"2026-11-22T01:30:00.000Z",
						2 * HOUR,
					)
				)?.agentRef,
			).toBe("ag_1");
			expect(
				(
					await store.touchSession(
						"o1",
						"s1",
						"2026-11-22T03:00:00.000Z",
						2 * HOUR,
					)
				)?.agentRef,
			).toBe("ag_1");
			expect(
				await store.touchSession(
					"o1",
					"s1",
					"2026-11-22T05:30:00.000Z",
					2 * HOUR,
				),
			).toBeNull();
			expect(
				await store.touchSession(
					"o1",
					"s1",
					"2026-11-22T05:31:00.000Z",
					2 * HOUR,
				),
			).toBeNull();
			await store.putSession(session("s2"));
			expect(
				await store.touchSession(
					"o1",
					"s2",
					"2026-11-22T05:00:00.000Z",
					10 * HOUR,
				),
			).toBeNull();
			await store.putSession(session("s3"));
			await store.putSession(session("s4", "ag_2"));
			await store.deleteSessionsOf("o1", "ag_1");
			expect(
				await store.touchSession(
					"o1",
					"s3",
					"2026-11-22T00:30:00.000Z",
					2 * HOUR,
				),
			).toBeNull();
			expect(
				(
					await store.touchSession(
						"o1",
						"s4",
						"2026-11-22T00:30:00.000Z",
						2 * HOUR,
					)
				)?.agentRef,
			).toBe("ag_2");
			await store.deleteSession("o1", "s4");
			expect(
				await store.touchSession(
					"o1",
					"s4",
					"2026-11-22T00:31:00.000Z",
					2 * HOUR,
				),
			).toBeNull();
		});

		test("a counter allows `limit` hits per window and starts over after it, per organization", async () => {
			const store = make();
			expect(await store.hit("o1", "k", at(0), 10_000, 2)).toBe(true);
			expect(await store.hit("o1", "k", at(1), 10_000, 2)).toBe(true);
			expect(await store.hit("o1", "k", at(2), 10_000, 2)).toBe(false);
			expect(await store.hit("o2", "k", at(2), 10_000, 2)).toBe(true);
			expect(await store.hit("o1", "other", at(2), 10_000, 2)).toBe(true);
			expect(await store.hit("o1", "k", at(10), 10_000, 2)).toBe(true);
			expect(await store.hit("o1", "k", at(11), 10_000, 2)).toBe(true);
			expect(await store.hit("o1", "k", at(12), 10_000, 2)).toBe(false);
		});
	});
}

describe("D1 migration 0003", () => {
	test("builds the index tables, runs twice without harm, and follows the numbering of the earlier files", () => {
		const db = new Database(":memory:");
		const files = applyD1Migrations(db);
		expect(files.slice(0, 3)).toEqual([
			"0001_meta.sql",
			"0002_backup_superseded.sql",
			"0003_notes_org_index.sql",
		]);
		expect(() => applyD1Migrations(db)).not.toThrow();
		const tables = (
			db
				.query(
					"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
				)
				.all() as { name: string }[]
		).map((row) => row.name);
		for (const table of [
			"note_org_index",
			"org_agents",
			"org_links",
			"org_sessions",
			"org_counters",
		])
			expect(tables).toContain(table);
	});

	test("after a full flow the D1 rows hold hashes only: no address, no cookie value, no link token", async () => {
		const db = new Database(":memory:");
		applyD1Migrations(db);
		const h = orgHarness({ orgs: new D1OrgStore(sqliteD1(db)) });
		const created = await h.createOrgNote();
		const token = h.mailer.linkTokenFor(TREASURER);
		const opened = await h.org.sessions.redeem(ORG_ID, token);
		expect(opened).not.toBeNull();
		await h.org.requestLink(ORG_ID, "stranger@elsewhere.test");
		const dump = JSON.stringify(
			(
				db
					.query("SELECT name FROM sqlite_master WHERE type = 'table'")
					.all() as { name: string }[]
			).flatMap(({ name }) => db.query(`SELECT * FROM ${name}`).all()),
		);
		for (const secret of [
			TREASURER,
			BOARD,
			VIEWER,
			BORROWER_EMAIL,
			"stranger@elsewhere.test",
			token,
			opened?.cookieValue ?? "",
		])
			expect(dump).not.toContain(secret);
		expect(dump).not.toContain("@");
		expect(dump).toContain(created.noteId);
		// The counters keep a hash prefix of the address, never the address.
		expect(dump).toContain("link:address:");
	});
});

const noteStores: [string, () => NoteStore][] = [
	["memory", () => new MemoryNoteStore()],
	[
		"sqlite Durable Object storage",
		() => {
			const state = durableState(new Database(":memory:"));
			migrateNote(state);
			return new SqliteNoteStore(state);
		},
	],
	[
		"remote (Worker to NoteDO)",
		() => new RemoteNoteStore(noteNamespace(notesEnv())),
	],
];

for (const [name, make] of noteStores) {
	describe(`NoteStore contract, organization part: ${name}`, () => {
		test("the lender organization is written once", async () => {
			const store = make();
			expect(await store.getOrg("n1")).toBeNull();
			await store.putOrg("n1", "org-a");
			await store.putOrg("n1", "org-b");
			expect(await store.getOrg("n1")).toBe("org-a");
		});

		test("agents are added, updated by ref, listed in order and switched on and off", async () => {
			const store = make();
			const agent = (agentRef: string, email: string) => ({
				agentRef,
				email,
				role: "treasurer" as const,
				active: true,
				addedAt: "2026-11-22T00:00:00.000Z",
			});
			await store.putAgent("n1", agent("ag_1", "a@x.test"));
			await store.putAgent("n1", agent("ag_2", "b@x.test"));
			await store.putAgent("n1", {
				...agent("ag_1", "a2@x.test"),
				role: "board",
			});
			expect(
				(await store.listAgents("n1")).map((entry) => entry.agentRef),
			).toEqual(["ag_1", "ag_2"]);
			expect(await store.getAgent("n1", "ag_1")).toMatchObject({
				email: "a2@x.test",
				role: "board",
				active: true,
			});
			expect(await store.setAgentActive("n1", "ag_2", false)).toBe(true);
			expect((await store.getAgent("n1", "ag_2"))?.active).toBe(false);
			expect(await store.setAgentActive("n1", "ag_missing", false)).toBe(false);
			expect(await store.getAgent("n1", "ag_missing")).toBeNull();
		});
	});
}

describe("emails live in the note's store and nowhere that reaches an event", () => {
	test("agent addresses are in the note's agent records; the log and the chain hold none", async () => {
		const h = orgHarness();
		const created = await h.createOrgNote();
		const agents = await h.store.listAgents(created.noteId);
		expect(agents.map((agent) => agent.email).sort()).toEqual(
			[BOARD, TREASURER, VIEWER].sort(),
		);
		const log = await h.store.readLog(created.noteId);
		const text = JSON.stringify(log);
		for (const email of [BOARD, TREASURER, VIEWER, BORROWER_EMAIL])
			expect(text).not.toContain(email);
		const noRefLeak = expectOk(
			await h.service.view(
				(await h.enterAgent(created.noteId, TREASURER)).session,
			),
		);
		expect(JSON.stringify(noRefLeak.view)).not.toContain("@");
	});
});
