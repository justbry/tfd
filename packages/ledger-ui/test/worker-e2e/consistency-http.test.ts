import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	documentKey,
	documentVariants,
	type KpiRow,
	type MonthlySource,
	martSource,
	kpiDocument as oracleDocument,
} from "../../gates/oracle.ts";
import { mountApp } from "../../src/app/mount.tsx";
import type { DisclosureFile, SchoolSize } from "../../src/data/disclosure.ts";
import type { KpiDocument } from "../../src/data/kpi-document.ts";
import disclosureFixture from "../../src/fixtures/disclosure.json";
import { createFixtureWriter } from "../../src/fixtures/writer.ts";
import type { LedgerSchoolClaim } from "../../src/http/ledger-token.ts";
import { localWallTime } from "../../src/http/school-routes.ts";
import { dashboardProblems, documentProblems } from "../consistency-checks.ts";
import {
	harness,
	harnessTimeoutMilliseconds,
	httpAdaptersOn,
	type LedgerHarness,
	menuOf,
	rawGet,
	type SeededEvent,
} from "./worker-harness.ts";

/**
 * Gate C over the HTTP Reader (S8e part 2): the checks of test/consistency.test.ts that real data can answer, run on
 * part 1's HTTP Reader against the real ledger Worker, for the 15 atm presets S8c's harness seeds, one school each.
 *
 * - C1: the events the Worker serves are atm's golden fixture (`fixtureHash`), and atm's KPI rows for them are the
 *   golden's (`kpisHash`).
 * - C2: the Worker's exact (owner) document carries those rows' money for every month.
 * - C3: every audience's and PIN state's document from the Worker equals what `gates/oracle.ts` computes from the
 *   same rows, the school's menu, its gross by day, the B4 Uni disclosure file and the Worker's clock.
 * - C4: the Dashboard renders every cell of every document the owner may preview exactly (`dashboardProblems`).
 * - C5: no member-facing document holds a family key or a profile id.
 *
 * Fixture-only, because the Worker serves no such data: the mart snapshot's exports and views (C1 and C2 as the
 * fixtures run them), the committed documents and provenance, the mockup schools (Harbor Arts Academy, Vibes of Light
 * and the others of `gates/mockup-schools.json`) and their donors, the disclosure fixture's per-school overrides and
 * View as copy, and the member portal (C5 as test/s6/family-scope.test.ts runs it: `memberPortal` is not available).
 */

const repositoryRoot = join(import.meta.dir, "..", "..", "..", "..");
/** atm's scenario code, loaded by computed paths: it is checked under atm's compiler options, not this package's. */
const atmSource = (path: string): string =>
	join(repositoryRoot, "packages/atm/src", path);
type Compute =
	| { op: "ratio"; num: string; den: string }
	| { op: "combine"; terms: Array<{ kpi: string }> }
	| { op: "sum"; commodity: string }
	| { op: "count" | "distinct"; where: { eventType?: string[] } };
const { SCHOOL_KPI_SPEC } = (await import(
	atmSource("ledger/contributions.ts")
)) as { SCHOOL_KPI_SPEC: { kpis: Array<{ id: string; compute: Compute }> } };
const { runScenario } = (await import(atmSource("scenario/cli.ts"))) as {
	runScenario(options: {
		profile: string;
		channels: string;
	}): Promise<{ rows: KpiRow[] }>;
};
const { fixtureHash } = (await import(atmSource("scenario/fixture.ts"))) as {
	fixtureHash(scenario: unknown, events: readonly unknown[]): string;
};
const { kpiHash } = (await import(atmSource("scenario/kpis.ts"))) as {
	kpiHash(rows: readonly KpiRow[]): string;
};
const { resolveScenario } = (await import(
	atmSource("scenario/profiles.ts")
)) as { resolveScenario(input: unknown): unknown };
const goldens = join(repositoryRoot, "packages/atm/tests/golden/scenarios");
const presets = readdirSync(
	join(repositoryRoot, "plans/ledger-ui/design/mart/kpis"),
)
	.filter((name) => name.endsWith(".json.gz"))
	.map((name) => name.slice(0, -".json.gz".length))
	.sort();
const grants: LedgerSchoolClaim[] = presets.map((id) => ({
	id,
	role: "owner",
	finance: true,
}));
const disclosureFile = disclosureFixture.file as unknown as DisclosureFile;
const millisecondsPerSecond = 1000;
const centsPerUnit = 100;
const billingIncome = "income:billing:";
const months = 12;
const dashboardBudgetMilliseconds = 240_000;

type Golden = { fixtureHash: string; kpisHash: string };

/** The KPIs that read `marked` computes: base ones by their compute, a ratio or a combination when any input does. */
const kpisReading = (marked: (compute: Compute) => boolean): Set<string> => {
	const ids = new Set<string>();
	for (const { id, compute } of SCHOOL_KPI_SPEC.kpis)
		if (
			compute.op === "ratio"
				? ids.has(compute.num) || ids.has(compute.den)
				: compute.op === "combine"
					? compute.terms.some((term) => ids.has(term.kpi))
					: marked(compute)
		)
			ids.add(id);
	return ids;
};
const moneyEvent = /^(payment|dispute|payout)\./;
const creditKpis = kpisReading(
	(compute) => compute.op === "sum" && compute.commodity === "credits",
);
const moneyKpis = kpisReading(
	(compute) =>
		(compute.op === "sum" && compute.commodity === "usd") ||
		((compute.op === "count" || compute.op === "distinct") &&
			(compute.where.eventType ?? []).some((type) => moneyEvent.test(type))),
);
/**
 * Section 11's "no endpoint answers 0 for something it cannot know" (D11, D12) on atm's rows: a KPI the log cannot
 * answer has no row, so the document says "not computed": the money KPIs when the log skipped money in another
 * currency (the books are USD only), the credit KPIs when the log holds no credit event.
 */
const answerableRows = (
	rows: readonly KpiRow[],
	events: readonly SeededEvent[],
): KpiRow[] => {
	const unknown = new Set<string>();
	if (!events.some((event) => event.event_type.startsWith("credit.")))
		for (const id of creditKpis) unknown.add(id);
	if (
		events.some(
			(event) =>
				event.event_type === "money.skipped" &&
				event.payload.reason === "non_usd",
		)
	)
		for (const id of moneyKpis) unknown.add(id);
	return rows.filter((row) => !unknown.has(row.kpiId.split(":")[0] ?? ""));
};
type Inputs = {
	preset: string;
	rows: KpiRow[];
	events: SeededEvent[];
	asOf: string;
	size: SchoolSize;
};

let worker: LedgerHarness;
const inputs = new Map<string, Inputs>();
const skip = typeof harness === "string";

beforeAll(async () => {
	if (typeof harness === "string") return;
	worker = await harness.startLedgerWorker({ presets });
	const status = (await rawGet(worker, grants, "/schools")).body.data as {
		schools: Array<{ id: string; asOf: string }>;
	};
	for (const preset of presets) {
		const run = await runScenario({ profile: preset, channels: "atm" });
		const disclosure = (
			await rawGet(worker, grants, `/schools/${preset}/disclosure`)
		).body.data as { size: SchoolSize };
		inputs.set(preset, {
			preset,
			rows: run.rows,
			events: worker.seeded[preset]?.events ?? [],
			asOf: status.schools.find(({ id }) => id === preset)?.asOf ?? "",
			size: disclosure.size,
		});
	}
}, harnessTimeoutMilliseconds);
afterAll(async () => {
	await worker?.stop();
});

const minuteMilliseconds = 60_000;
/** A school's inputs, with the Worker's clock set one minute after the school's own last event, as the harness sets it
 * for one school: one clock for all 15 would put most schools' documents in a year their logs never reach
 * (annual-prepay runs to the end of 2027). */
const inputsOf = (preset: string): Inputs => {
	const found = inputs.get(preset);
	if (!found) throw new Error(`${preset} was not seeded`);
	const seeded = worker.seeded[preset]?.asOf ?? found.asOf;
	worker.clock.set(
		new Date(Date.parse(seeded) + minuteMilliseconds).toISOString(),
	);
	return found;
};
const capitalized = (text: string): string =>
	`${text.charAt(0).toUpperCase()}${text.slice(1)}`;
const byKpi = (first: KpiRow, second: KpiRow): number =>
	first.kpiId < second.kpiId ? -1 : first.kpiId > second.kpiId ? 1 : 0;
const daysInMonth = (year: number, month: number): number =>
	new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/** The school's clock as the Worker reads it: its menu's zone (else the last event's), today at the harness's
 * instant, and `asOf` as wall time. */
const clockOf = (school: Inputs) => {
	const zone =
		menuOf(school.events)?.timeZone ??
		(school.events.at(-1) as { tz?: string } | undefined)?.tz ??
		"UTC";
	return {
		today: localWallTime(
			Date.parse(worker.clock.now()) / millisecondsPerSecond,
			zone,
		).slice(0, 10),
		now: localWallTime(Date.parse(school.asOf) / millisecondsPerSecond, zone),
	};
};

/** Gross collected per day of each month of `year`, from the log itself: each `payment.succeeded` credit to
 * `income:billing:*` in USD, on the event's local date. */
const grossByDay = (events: readonly SeededEvent[], year: number) => {
	const days = Array.from({ length: months }, (_, month) =>
		new Array<number>(daysInMonth(year, month)).fill(0),
	);
	for (const event of events) {
		if (event.event_type !== "payment.succeeded") continue;
		if (Number(event.date.slice(0, 4)) !== year) continue;
		const month = days[Number(event.date.slice(5, 7)) - 1];
		const day = Number(event.date.slice(8, 10)) - 1;
		for (const posting of event.postings)
			if (
				posting.commodity === "USD" &&
				posting.account.startsWith(billingIncome) &&
				month
			)
				month[day] =
					(month[day] ?? 0) - Math.round(Number(posting.amount) * centsPerUnit);
	}
	return days;
};

/** The oracle's input for a school whose figures come from its events: atm's rows, the plans in the menu's order (then
 * any other plan paid, by name), and the gross by day. */
const oracleSource = (school: Inputs, year: number): MonthlySource => {
	const rows = answerableRows(school.rows, school.events).sort(byKpi);
	const source = martSource(
		rows,
		{ periods: [], params: {}, contrib: {}, tiers: {} },
		year,
		[],
		null,
	);
	const paid = [
		...new Set(
			rows
				.filter((row) => row.kpiId.startsWith("revenue_by_tier:"))
				.map((row) => row.kpiId.slice("revenue_by_tier:".length)),
		),
	];
	const menu = menuOf(school.events);
	const plans = menu
		? [
				...menu.tierIds,
				...paid.filter((plan) => !menu.tierIds.includes(plan)).sort(),
			]
		: paid;
	return {
		...source,
		kind: "events",
		tiers: plans.map((plan) => ({ id: plan, title: capitalized(plan) })),
		days: grossByDay(school.events, year),
	};
};

const oracleOf = (
	school: Inputs,
	variant: { audience: KpiDocument["audience"]; pinLocked: boolean },
): KpiDocument => {
	const clock = clockOf(school);
	const year = Number(clock.today.slice(0, 4));
	return oracleDocument({
		school: school.preset,
		size: school.size,
		file: disclosureFile,
		audience: variant.audience,
		pinLocked: variant.pinLocked,
		currency: menuOf(school.events)?.currency ?? "usd",
		preset: null,
		source: oracleSource(school, year),
		clock,
	});
};

describe.skipIf(skip)(
	"gate C on the HTTP Reader and the real ledger Worker",
	() => {
		test("the harness seeds the 15 presets", () => {
			expect(presets).toHaveLength(15);
			expect(Object.keys(worker.seeded).sort()).toEqual(presets);
		});

		for (const preset of presets) {
			test(`C1 ${preset}: the Worker's events are atm's golden fixture, and their KPI rows the golden's`, () => {
				const golden = JSON.parse(
					readFileSync(join(goldens, `${preset}.json`), "utf8"),
				) as Golden;
				const school = inputsOf(preset);
				// The harness puts the menu's catalog.published first; the rest is the scenario's log as generated.
				const [published, ...events] = school.events;
				expect(published?.event_type).toBe("catalog.published");
				expect(fixtureHash(resolveScenario({ profile: preset }), events)).toBe(
					golden.fixtureHash,
				);
				expect(kpiHash(school.rows)).toBe(golden.kpisHash);
			});

			test(`C2 ${preset}: the owner's exact document carries atm's money for every month`, async () => {
				const school = inputsOf(preset);
				const { reader } = httpAdaptersOn(worker, grants);
				const document = await reader.kpiDocument({
					school: preset,
					preset: "",
					audience: "owner",
					pinLocked: false,
				});
				const table = document?.tables.month;
				const year = clockOf(school).today.slice(0, 4);
				expect(document?.year).toBe(Number(year));
				const mismatches: string[] = [];
				let compared = 0;
				for (const kpiId of ["gross_collected", "refunds", "stripe_fees"])
					for (const row of answerableRows(school.rows, school.events).filter(
						(candidate) =>
							candidate.kpiId === kpiId &&
							table?.periods.includes(candidate.period),
					)) {
						compared += 1;
						const cell =
							table?.series[kpiId]?.[table.periods.indexOf(row.period)];
						if (cell !== row.value)
							mismatches.push(
								`${kpiId}@${row.period}: ${JSON.stringify(cell)}, atm ${row.value}`,
							);
					}
				expect(document?.roundTo).toBe(0);
				expect(mismatches).toEqual([]);
				// A school whose log has USD money has it in the document's year, so the check is never empty.
				if (preset !== "non-usd") expect(compared).toBeGreaterThan(0);
			});

			test(`C3 ${preset}: every audience's and PIN state's document equals the oracle`, async () => {
				const school = inputsOf(preset);
				const { reader } = httpAdaptersOn(worker, grants);
				const cases = documentVariants().map((variant) => ({
					key: documentKey({ school: preset, preset: null, ...variant }),
					query: { school: preset, preset: "", ...variant },
					expected: oracleOf(school, variant),
				}));
				const problems = await documentProblems(reader, cases);
				// A year the log never reaches would be all "not computed" on both sides: the owner must see figures.
				const owner = cases.find(({ query }) => query.audience === "owner");
				expect(
					Object.values(owner?.expected.tables.month?.series ?? {}).some(
						(cells) =>
							cells.some((cell) => typeof cell === "number" && cell !== 0),
					),
				).toBe(true);
				// On a mismatch, show the first one whole.
				if (problems.length) {
					const first = cases.find(({ key }) => problems[0]?.startsWith(key));
					if (first)
						expect(await reader.kpiDocument(first.query)).toEqual(
							first.expected,
						);
				}
				expect(problems).toEqual([]);
			});

			test(`C5 ${preset}: no member-facing document holds a family key or a profile id`, async () => {
				const { reader } = httpAdaptersOn(worker, grants);
				for (const audience of ["public", "member", "governance"] as const) {
					const text = JSON.stringify(
						await reader.kpiDocument({
							school: preset,
							preset: "",
							audience,
							pinLocked: false,
						}),
					);
					expect({ audience, leaks: /family:|profile:/.test(text) }).toEqual({
						audience,
						leaks: false,
					});
				}
			});
		}

		test(
			"C4: the Dashboard renders every cell of every document the owner may preview, on the HTTP Reader",
			async () => {
				const started = performance.now();
				const problems: string[] = [];
				let renders = 0;
				for (const preset of presets) {
					const school = inputsOf(preset);
					const { reader } = httpAdaptersOn(worker, grants);
					for (const variant of documentVariants()) {
						const expected = await reader.kpiDocument({
							school: preset,
							preset: "",
							...variant,
						});
						if (!expected) {
							problems.push(`${preset}: no ${variant.audience} document`);
							continue;
						}
						const found = await dashboardProblems(
							{
								mount: mountApp,
								reader,
								writer: createFixtureWriter({ mode: "instant" }),
								clock: clockOf(school),
							},
							expected,
						);
						renders += found.renders;
						problems.push(...found.problems);
					}
				}
				process.stdout.write(
					`C4 over HTTP: ${renders} renders in ${((performance.now() - started) / 1000).toFixed(1)} s\n`,
				);
				expect(renders).toBeGreaterThan(0);
				expect(problems.slice(0, 25)).toEqual([]);
			},
			dashboardBudgetMilliseconds,
		);
	},
);
