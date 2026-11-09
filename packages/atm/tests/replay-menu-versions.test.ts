/**
 * Members on different menu versions replay in one call (plan §13, item 10): a command runs under the catalog of its
 * event's `labels.menu_version`. The bundle `credits-menu-version` has both versions in one log (fam_8k2 on version 1,
 * fam_b2 on version 2, who bought after the publish and get a different grant); the other cases are single-catalog parity,
 * a version with no catalog, and the readers that take catalogs (`membersOf`, `simulate`, `tfd simulate`).
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { menuCatalogRows } from "../src/billing/grants.js";
import type { Menu } from "../src/billing/types.js";
import { balancesOf } from "../src/index.js";
import { catalogPublishedEvent } from "../src/ledger/catalog.js";
import { ReplayError, replayEvents } from "../src/ledger/replay.js";
import { simulate } from "../src/ledger/simulate.js";
import { membersOf } from "../src/ledger/summary.js";
import { canonicalize } from "../src/ledger/util.js";
import {
	loadScenarioBundle,
	resolveBundleDirectory,
} from "../src/scenario/bundle.js";
import { runBundle } from "../src/scenario/bundle-run.js";
import type { AtmCatalogRow, AtmEvent } from "../src/types.js";
import { tmp } from "./helpers.js";

const BIN = join(import.meta.dir, "../src/bin.ts");
const FAMILY_ONE = "family:fam_8k2";
const FAMILY_TWO = "family:fam_b2";

type Loaded = {
	events: AtmEvent[];
	school: string;
	rows: (version: string) => AtmCatalogRow[];
	menu: (version: string) => Menu;
};

const load = async (id: string): Promise<Loaded> => {
	const bundle = await loadScenarioBundle(resolveBundleDirectory(id));
	const run = await runBundle(bundle, { channels: [] });
	try {
		const school = bundle.scenario.school;
		return {
			events: run.schools[0]?.events ?? [],
			school,
			menu: (version) =>
				bundle.scenario.menus?.[version] ?? bundle.scenario.menu,
			rows: (version) =>
				menuCatalogRows({
					menu: bundle.scenario.menus?.[version] ?? bundle.scenario.menu,
					school,
				}),
		};
	} finally {
		await run.dispose();
	}
};

let mixed: Loaded;
let single: Loaded;

beforeAll(async () => {
	mixed = await load("credits-menu-version");
	single = await load("credits-rollover-cap");
});

const availOf = (balances: ReturnType<typeof balancesOf>) =>
	Object.fromEntries(
		balances.map((b) => [`${b.holder}:${b.feature}`, [b.avail, b.held]]),
	);

describe("replayEvents with a catalog per menu version", () => {
	test("a log of members on two menu versions replays in one call, to what each holder alone replays to", () => {
		const catalogs = { "1": mixed.rows("1"), "2": mixed.rows("2") };
		const versions = new Set(mixed.events.map((e) => e.labels.menu_version));
		expect([...versions].filter((v) => v !== undefined).sort()).toEqual([
			"1",
			"2",
		]);

		const whole = replayEvents({ events: mixed.events, catalogs });

		// the check the bundle used to make: each holder under the catalog of its own version
		const perHolder = [FAMILY_ONE, FAMILY_TWO].flatMap((key) => {
			const own = mixed.events.filter((e) => e.key === key);
			const version = own.find((e) => e.labels.menu_version)?.labels
				.menu_version as string;
			return replayEvents({ events: own, catalog: mixed.rows(version) })
				.balances;
		});
		expect(availOf(whole.balances)).toEqual(availOf(perHolder));
		expect(whole.applied).toBe(mixed.events.length);
		// the two versions grant differently: 2 visits a month on version 1, 3 on version 2
		expect(
			whole.balances
				.filter((b) => b.feature === "visit")
				.map((b) => [b.holder, b.avail]),
		).toEqual([
			[FAMILY_ONE, 4],
			[FAMILY_TWO, 6],
		]);
	});

	test("a single catalog cannot replay that log: it is the limit the per-version form lifts", () => {
		expect(() =>
			replayEvents({ events: mixed.events, catalog: mixed.rows("1") }),
		).toThrow(ReplayError);
	});

	test("an event whose menu version has no catalog is a ReplayError that names the version", () => {
		let error: unknown;
		try {
			replayEvents({
				events: mixed.events,
				catalogs: { "1": mixed.rows("1") },
			});
		} catch (caught) {
			error = caught;
		}
		expect(error).toBeInstanceOf(ReplayError);
		const failure = error as ReplayError;
		expect(failure.message).toContain('no catalog for menu version "2"');
		expect(failure.message).toContain('catalogs given for "1"');
		const named = mixed.events.find((e) => e.id === failure.eventId);
		expect(named?.labels.menu_version).toBe("2");
		expect(named?.key).toBe(FAMILY_TWO);
	});

	test("an event with no menu version label cannot choose among several catalogs, and takes the only one", () => {
		const unlabelled = single.events.map((e) => {
			const { menu_version: _version, ...labels } = e.labels;
			return { ...e, labels };
		});
		// not a replay of the log as written: the labels are part of each event, so only the choice is under test
		const rows = single.rows("1");
		expect(() =>
			replayEvents({ events: unlabelled, catalogs: { "1": rows, "2": rows } }),
		).toThrow(/no labels\.menu_version/);
		let error: unknown;
		try {
			replayEvents({ events: unlabelled, catalogs: { "1": rows } });
		} catch (caught) {
			error = caught;
		}
		// the choice was made (a ReplayError, if any, is about the events no longer matching, never about the choice)
		expect(String(error)).not.toContain("labels.menu_version");
	});

	test("both forms, or neither, are refused", () => {
		const rows = single.rows("1");
		expect(() =>
			replayEvents({
				events: single.events,
				catalog: rows,
				catalogs: { "1": rows },
			} as never),
		).toThrow(/not both/);
		expect(() => replayEvents({ events: single.events } as never)).toThrow(
			/give catalog or catalogs/,
		);
		expect(() => replayEvents({ events: single.events, catalogs: {} })).toThrow(
			/no menu version/,
		);
	});
});

describe("single-catalog parity", () => {
	test("one catalog replays a one-version log as it always did; the same rows under their version give the same result", () => {
		const rows = single.rows("1");
		const one = replayEvents({ events: single.events, catalog: rows });
		const version = single.events.find((e) => e.labels.menu_version)?.labels
			.menu_version as string;
		const keyed = replayEvents({
			events: single.events,
			catalogs: { [version]: rows },
		});
		expect(canonicalize(keyed)).toBe(canonicalize(one));
		expect(one.applied).toBe(single.events.length);
		expect(one.balances.length).toBeGreaterThan(0);
	});

	test("one catalog ignores the labels: the log of one version replays under it whatever the version is called", () => {
		const relabelled = replayEvents({
			events: mixed.events.filter((e) => e.key === FAMILY_ONE),
			catalog: mixed.rows("1"),
		});
		expect(relabelled.applied).toBeGreaterThan(0);
	});

	test("balancesOf takes either form", () => {
		const replay = replayEvents({
			events: mixed.events,
			catalogs: { "1": mixed.rows("1"), "2": mixed.rows("2") },
		});
		const input = {
			states: replay.snapshot.states,
			holds: replay.snapshot.holds,
			asOfMs: Date.parse(replay.asOf as string),
		};
		expect(balancesOf({ ...input, catalog: mixed.rows("1") })).toEqual(
			replay.balances,
		);
		expect(
			balancesOf({
				...input,
				catalogs: { "1": mixed.rows("1"), "2": mixed.rows("2") },
			}),
		).toEqual(replay.balances);
	});
});

describe("readers that take a catalog", () => {
	test("membersOf takes the catalogs of two published versions from the log's own catalog.published events", () => {
		const published = [1, 2].map((version) =>
			catalogPublishedEvent({
				school: mixed.school,
				menu: mixed.menu(String(version)),
				version,
				eventTime: `2026-01-0${version}T00:00:00Z`,
			}),
		);
		const events = [...published, ...mixed.events];
		const asOf = new Date(
			Math.max(...events.map((e) => Date.parse(e.event_time))),
		);
		const members = membersOf(events, asOf);
		expect(members.ok).toBe(true);
		if (!members.ok) return;
		expect(members.members[FAMILY_ONE]?.features.visit?.available).toBe(4);
		expect(members.members[FAMILY_TWO]?.features.visit?.available).toBe(6);
	});

	test("membersOf summarises both versions from catalogs given, and names a version it lacks", () => {
		const asOf = new Date(
			Math.max(...mixed.events.map((e) => Date.parse(e.event_time))),
		);
		const members = membersOf(mixed.events, asOf, {
			catalogs: { "1": mixed.rows("1"), "2": mixed.rows("2") },
		});
		expect(members.ok).toBe(true);
		if (!members.ok) return;
		expect(members.members[FAMILY_ONE]?.features.visit?.available).toBe(4);
		expect(members.members[FAMILY_TWO]?.features.visit?.available).toBe(6);

		const missing = membersOf(mixed.events, asOf, {
			catalogs: { "1": mixed.rows("1") },
		});
		expect(missing.ok).toBe(false);
		if (!missing.ok)
			expect(missing.error).toMatchObject({
				kind: "replay",
				message: expect.stringContaining('menu version "2"'),
			});
		expect(() =>
			membersOf(mixed.events, asOf, {
				catalog: mixed.rows("1"),
				catalogs: { "1": mixed.rows("1") },
			}),
		).toThrow(/not both/);
	});

	test("simulate: the identity on a mixed-version log is no difference, and a candidate for one version changes only its members", () => {
		const catalogs = { "1": mixed.rows("1"), "2": mixed.rows("2") };
		const identity = simulate({
			events: mixed.events,
			catalogs,
			candidate: {},
		});
		expect(identity.differences).toBe(0);
		expect(identity.refused).toEqual([]);

		const thinner = structuredClone(mixed.rows("2")) as AtmCatalogRow[];
		for (const row of thinner)
			if (row.table === "entitlements" && row.row.allowance === 3)
				row.row.allowance = 1;
		const trial = simulate({
			events: mixed.events,
			catalogs,
			candidate: { catalogs: { ...catalogs, "2": thinner } },
		});
		const changed = trial.balanceChanges.map((c) => c.holder);
		expect(new Set(changed)).toEqual(new Set([FAMILY_TWO]));
		expect(() =>
			simulate({
				events: mixed.events,
				catalog: mixed.rows("1"),
				catalogs,
				candidate: {},
			}),
		).toThrow(/not both/);
	});
});

describe("tfd simulate --current-catalog with a catalog per menu version", () => {
	const run = async (...args: string[]) => {
		const child = Bun.spawn(["bun", BIN, "simulate", ...args], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, stderr, exitCode] = await Promise.all([
			new Response(child.stdout).text(),
			new Response(child.stderr).text(),
			child.exited,
		]);
		return { stdout, stderr, exitCode };
	};

	const folderOf = async (events: readonly AtmEvent[], school: string) => {
		const root = await tmp("replay-menu-versions");
		const byDate = new Map<string, AtmEvent[]>();
		for (const event of events)
			byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
		for (const [date, group] of byDate) {
			const ids = group.map((e) => e.id).sort();
			const directory = join(root, "schools", school, "events", `date=${date}`);
			await mkdir(directory, { recursive: true });
			await writeFile(
				join(directory, `${ids[0]}-${ids.at(-1)}.jsonl`),
				group
					.sort((a, b) => (a.id < b.id ? -1 : 1))
					.map((e) => `${canonicalize(e)}\n`)
					.join(""),
			);
		}
		return root;
	};

	test("a file of lists by version replays the mixed log; a list for one version names the version it lacks", async () => {
		const root = await folderOf(mixed.events, mixed.school);
		const files = await tmp("replay-menu-versions-files");
		const both = join(files, "both.json");
		const one = join(files, "one.json");
		const wrong = join(files, "wrong.json");
		await writeFile(
			both,
			JSON.stringify({ "1": mixed.rows("1"), "2": mixed.rows("2") }),
		);
		await writeFile(one, JSON.stringify({ "1": mixed.rows("1") }));
		await writeFile(wrong, JSON.stringify({ "1": "not rows" }));

		const same = await run(
			"--root",
			root,
			"--school",
			mixed.school,
			"--current-catalog",
			both,
			"--catalog",
			both,
		);
		expect(same.stderr).toBe("");
		expect(same.exitCode).toBe(0);
		expect(same.stdout).toContain("no differences");

		const lacking = await run(
			"--root",
			root,
			"--school",
			mixed.school,
			"--current-catalog",
			one,
			"--catalog",
			one,
		);
		expect(lacking.exitCode).toBe(2);
		expect(lacking.stderr).toContain('no catalog for menu version "2"');

		const bad = await run(
			"--root",
			root,
			"--school",
			mixed.school,
			"--current-catalog",
			wrong,
			"--catalog",
			both,
		);
		expect(bad.exitCode).toBe(2);
		expect(bad.stderr).toContain("by menu version");
	});
});
