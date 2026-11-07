import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { canonicalize, sha256Hex } from "../../atm/src/ledger/util.ts";
import {
	type DisclosureFixture,
	importRows,
	namedRow,
	type Provenance,
	plan,
} from "../scripts/import-mart.ts";
import type { KpiDocument, KpiQuery } from "../src/data/kpi-document.ts";
import type { Reader } from "../src/data/reader.ts";
import { dashboardProblems } from "./consistency-checks.ts";

/**
 * Gate C (protocol §5): one chain from atm's fixtures to the UI's pixels, hashed with atm's own canonicalize and
 * sha256Hex. C1 and C2 need only data; C3 checks every school's and audience's document against the oracle, the
 * committed provenance, atm's goldens and the disclosure object; C4 mounts the Dashboard on every document a school's
 * viewer may preview. The parts that need the S1b build (the fixture Reader's `kpiDocument` on the audiences) skip
 * until it exists.
 */
type KpiRow = { kpiId: string; period: string; unit: string; value: number };
type KpiExport = {
	fixtureHash: string;
	kpisHash: string;
	profile: string;
	rows: KpiRow[];
};
type ViewsManifest = { objects: Record<string, string> };
type MonthView = {
	month: string;
	money?: { grossCents: number; refundedCents: number; feeCents: number };
};

const repositoryRoot = join(import.meta.dir, "..", "..", "..");
const snapshot = join(repositoryRoot, "plans/ledger-ui/design/mart");
const goldens = join(repositoryRoot, "packages/atm/tests/golden/scenarios");
const byId = (first: KpiRow, second: KpiRow): number =>
	first.kpiId < second.kpiId
		? -1
		: first.kpiId > second.kpiId
			? 1
			: first.period < second.period
				? -1
				: first.period > second.period
					? 1
					: 0;
/** atm's kpiHash (packages/atm/src/scenario/kpis.ts), reproduced with atm's own canonicalize and sha256Hex. */
const kpiHash = (rows: readonly KpiRow[]): string =>
	sha256Hex(
		canonicalize(
			[...rows]
				.sort(byId)
				.map(({ kpiId, period, value }) => ({ kpiId, period, value })),
		),
	);
const readExport = (preset: string): KpiExport =>
	JSON.parse(
		gunzipSync(
			readFileSync(join(snapshot, "kpis", `${preset}.json.gz`)),
		).toString("utf8"),
	) as KpiExport;

const presets = readdirSync(join(snapshot, "kpis"))
	.filter((name) => name.endsWith(".json.gz"))
	.map((name) => name.slice(0, -".json.gz".length))
	.sort();

describe("C1: atm export equals atm's goldens", () => {
	test("the snapshot has the 15 presets", () => {
		expect(presets.length).toBe(15);
	});
	for (const preset of presets) {
		test(preset, () => {
			const exported = readExport(preset);
			const golden = JSON.parse(
				readFileSync(join(goldens, `${preset}.json`), "utf8"),
			) as KpiExport;
			expect({
				fixtureHash: exported.fixtureHash,
				kpisHash: exported.kpisHash,
			}).toEqual({
				fixtureHash: golden.fixtureHash,
				kpisHash: golden.kpisHash,
			});
			expect(kpiHash(exported.rows)).toBe(exported.kpisHash);
		});
	}
});

describe("C2: atm's read-slice views agree with the export", () => {
	const withViews = presets.filter((preset) =>
		existsSync(join(snapshot, "views", preset)),
	);
	test("every preset replays in atm's read slice (atm #127)", () => {
		expect(withViews).toEqual(presets);
	});
	for (const preset of withViews) {
		test(preset, () => {
			const schools = readdirSync(join(snapshot, "views", preset, "schools"));
			expect(schools.length).toBe(1);
			const root = join(snapshot, "views", preset);
			const viewsDirectory = join(root, "schools", schools[0] ?? "", "views");
			const manifest = JSON.parse(
				readFileSync(join(viewsDirectory, "manifest.json"), "utf8"),
			) as ViewsManifest;
			for (const [key, hash] of Object.entries(manifest.objects)) {
				expect({
					key,
					hash: sha256Hex(readFileSync(join(root, key), "utf8")),
				}).toEqual({ key, hash });
			}
			const value = new Map(
				readExport(preset).rows.map((row) => [
					`${row.kpiId}@${row.period}`,
					row.value,
				]),
			);
			for (const name of readdirSync(join(viewsDirectory, "months"))) {
				const view = JSON.parse(
					readFileSync(join(viewsDirectory, "months", name), "utf8"),
				) as MonthView;
				const rows = {
					grossCents: value.get(`gross_collected@${view.month}`) ?? 0,
					refundedCents: value.get(`refunds@${view.month}`) ?? 0,
					feeCents: value.get(`stripe_fees@${view.month}`) ?? 0,
				};
				const money = {
					grossCents: view.money?.grossCents ?? 0,
					refundedCents: view.money?.refundedCents ?? 0,
					feeCents: view.money?.feeCents ?? 0,
				};
				expect({ month: view.month, ...money }).toEqual({
					month: view.month,
					...rows,
				});
			}
		});
	}
});

type KpiReader = Reader & {
	kpiDocument?: (
		query: KpiQuery,
	) => Promise<KpiDocument | undefined> | KpiDocument | undefined;
};

const packageRoot = join(import.meta.dir, "..");
const mart = join(packageRoot, "src/fixtures/mart");
const readJson = <T>(path: string): T =>
	JSON.parse(readFileSync(path, "utf8")) as T;
const clock = { today: "2026-11-05", now: "2026-11-05T12:00" };
const committedRows = readJson<Record<string, KpiRow[]>>(
	join(mart, "rows.json"),
);
const committedDocuments = readJson<Record<string, KpiDocument>>(
	join(mart, "documents.json"),
);
const committedProvenance = readJson<Record<string, Provenance>>(
	join(mart, "provenance.json"),
);
const disclosure = readJson<DisclosureFixture>(
	join(packageRoot, "src/fixtures/disclosure.json"),
);
const { rows: importedRows, sources } = importRows();
const plans = plan(importedRows, sources);

/** The fixture adapters load lazily: the Reader is the builder's, and the gate must not fall over when it lags. */
const loaded = await Promise.all([
	import("../src/app/mount.tsx"),
	import("../src/fixtures/reader.ts"),
	import("../src/fixtures/writer.ts"),
]).catch(() => null);
const fixtureReader = (): KpiReader | null =>
	loaded ? (loaded[1].createFixtureReader({ clock }) as KpiReader) : null;
/** The Reader answers the audience query (not a books level). */
const hasKpiDocument = await (async () => {
	const reader = fixtureReader();
	if (typeof reader?.kpiDocument !== "function") return false;
	const answer = await reader.kpiDocument({
		school: "b4u",
		preset: "monthly-members",
		audience: "public",
		pinLocked: false,
	});
	return answer?.audience === "public";
})();

describe("C3: every school's and audience's document equals the oracle, its provenance and the disclosure", () => {
	test("one document per planned key, and provenance for each", () => {
		const keys = plans.map(({ key }) => key).sort();
		expect(new Set(keys).size).toBe(keys.length);
		expect(Object.keys(committedDocuments).sort()).toEqual(keys);
		expect(Object.keys(committedProvenance).sort()).toEqual(keys);
	});
	test("no document carries a hash", () => {
		expect(
			/[0-9a-f]{64}/.test(readFileSync(join(mart, "documents.json"), "utf8")),
		).toBe(false);
	});
	test("the mockup schools come from the frozen mockup", () => {
		const mockupSha256 = sha256Hex(
			readFileSync(
				join(repositoryRoot, "plans/ledger-ui/design/mockup.html"),
				"utf8",
			),
		);
		expect(
			readJson<{ mockupSha256: string }>(
				join(packageRoot, "gates/mockup-schools.json"),
			).mockupSha256,
		).toBe(mockupSha256);
	});
	for (const preset of presets)
		test(`${preset}: the rows are atm's export rows of school-level KPIs`, () => {
			const exported = readExport(preset).rows.filter((row) =>
				namedRow(row.kpiId),
			);
			const byKey = new Map(
				exported.map((row) => [`${row.kpiId}@${row.period}`, row]),
			);
			const rows = committedRows[preset] ?? [];
			expect(rows.length).toBe(exported.length);
			expect(
				rows.filter((row) => {
					const source = byKey.get(`${row.kpiId}@${row.period}`);
					return (
						!source || source.value !== row.value || source.unit !== row.unit
					);
				}),
			).toEqual([]);
			expect(
				rows.filter((row) =>
					/closing_balance|family:|profile:/.test(row.kpiId),
				),
			).toEqual([]);
		});
	const groups = [
		...new Set(plans.map((entry) => `${entry.school}/${entry.preset ?? ""}`)),
	];
	for (const group of groups)
		test(`${group}: every audience's document equals the oracle now, traces to its sources and follows the disclosure`, () => {
			for (const entry of plans.filter(
				(candidate) =>
					`${candidate.school}/${candidate.preset ?? ""}` === group,
			)) {
				const committed = committedDocuments[entry.key];
				expect({ key: entry.key, document: committed }).toEqual({
					key: entry.key,
					document: entry.build(),
				});
				const recorded = committedProvenance[entry.key];
				expect({ key: entry.key, provenance: recorded }).toEqual({
					key: entry.key,
					provenance: entry.provenance(sha256Hex(canonicalize(committed))),
				});
				if (recorded && "fixtureHash" in recorded) {
					const golden = readJson<KpiExport>(
						join(goldens, `${recorded.preset}.json`),
					);
					expect({
						key: entry.key,
						fixtureHash: recorded.fixtureHash,
						kpisHash: recorded.kpisHash,
					}).toEqual({
						key: entry.key,
						fixtureHash: golden.fixtureHash,
						kpisHash: golden.kpisHash,
					});
				}
				const view =
					disclosure.schools[entry.school]?.views[
						committed?.audience ?? "public"
					];
				expect({
					key: entry.key,
					roundTo: committed?.roundTo,
					cellRules: committed?.cellRules,
					live: committed?.live,
					size: committed?.size,
				}).toEqual({
					key: entry.key,
					roundTo: view?.roundTo,
					cellRules: view?.cellRules,
					live: view?.live,
					size: disclosure.schools[entry.school]?.size,
				});
				/** The strip follows the period control (the disclosure's periods), except that a period the control calls
				 * "Not started yet" waits on the Dashboard for its close plus the delay (mockup dashFull's strip). */
				const notStarted = /^Published after \d{1,2} [A-Z][a-z]{2} \d{4}$/;
				if (committed && !committed.live)
					expect({
						key: entry.key,
						periods: committed.periods.map(
							({ period, label, state, title }) => ({
								period,
								label,
								state,
								title:
									state === "embargoed" &&
									view?.periods.find((gate) => gate.period === period)
										?.state === "future" &&
									notStarted.test(title ?? "")
										? "Not started yet"
										: title,
							}),
						),
					}).toEqual({
						key: entry.key,
						periods: (view?.periods ?? []).map(
							({ period, label, state, title }) => ({
								period,
								label,
								state: state === "future" ? "embargoed" : state,
								title,
							}),
						),
					});
			}
		});
	test.if(hasKpiDocument)(
		"the fixture Reader returns exactly the committed documents",
		async () => {
			const reader = fixtureReader();
			for (const entry of plans) {
				const committed = committedDocuments[entry.key];
				if (!committed) continue;
				expect({
					key: entry.key,
					document: await reader?.kpiDocument?.({
						school: entry.school,
						preset: entry.preset ?? "monthly-members",
						audience: committed.audience,
						pinLocked: committed.pinLocked,
					}),
				}).toEqual({ key: entry.key, document: committed });
			}
		},
	);
});

/** The documents a school's viewer can reach: the audiences of the View as rows they hold (mockup vaAllowed). */
const reachable = (document: KpiDocument): boolean =>
	(disclosure.schools[document.school]?.viewAs ?? []).some(
		(option) => option.value === document.audience && option.held,
	);

/** C4 budget (protocol §5): all mounts and their renders. */
const c4BudgetMilliseconds = 120_000;
let c4Milliseconds = 0;
let c4Renders = 0;
describe("C4: the Dashboard renders every document cell it shows exactly, for every audience a viewer may preview", () => {
	const schools = [...new Set(plans.map((entry) => entry.school))];
	for (const school of schools)
		test.if(hasKpiDocument)(
			school,
			async () => {
				if (!loaded) return;
				const [{ mountApp }, , { createFixtureWriter }] = loaded;
				const started = performance.now();
				const problems: string[] = [];
				for (const entry of plans.filter(
					(candidate) => candidate.school === school,
				)) {
					const expected = committedDocuments[entry.key];
					if (!expected || !reachable(expected)) continue;
					const reader = fixtureReader();
					if (!reader) continue;
					const { problems: found, renders } = await dashboardProblems(
						{
							mount: mountApp,
							reader,
							writer: createFixtureWriter({ mode: "instant" }),
							clock,
						},
						expected,
					);
					c4Renders += renders;
					problems.push(...found);
				}
				c4Milliseconds += performance.now() - started;
				expect(problems.slice(0, 25)).toEqual([]);
			},
			c4BudgetMilliseconds,
		);
	test.if(hasKpiDocument)("the matrix runs within its budget", () => {
		process.stdout.write(
			`C4: ${c4Renders} renders in ${(c4Milliseconds / 1000).toFixed(1)} s (budget ${c4BudgetMilliseconds / 1000} s)\n`,
		);
		expect(c4Milliseconds).toBeLessThanOrEqual(c4BudgetMilliseconds);
	});
});
