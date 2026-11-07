/**
 * What each audience sees of a school's books, worked out for a clock: `audienceViews` gives, for every audience, the
 * `AudienceView` of the ledger UI's disclosure contract (grain, delay, rounding, small counts, cell rules, the period
 * control's presets and periods, and the wording the UI prints). The UI derives none of it, so the wording is made here.
 *
 * Worker-safe (`atm/worker`): pure, no I/O, no clock read, no Ajv, no hledger. It is the disclosure spec's rules
 * (buzz-school `2026-11-05-school-books-disclosure-design.md`) applied to the effective file (the B4 Uni file with the
 * school's override), with the period rules of the mockup (`plans/ledger-ui/design/mockup.html`: `pAllow`, `pList`,
 * `pMeta`) that the UI's fixture `src/fixtures/disclosure.json` was generated from. `tests/audience-views.test.ts` runs it
 * over that fixture and over cases the fixture does not hold.
 */
import type {
	AudienceView,
	GatedSurface,
	HiddenReason,
	LockPanel,
	PeriodGate,
	PresetGate,
} from "./audience-view-types.js";
import {
	type Audience,
	applyOverride,
	audienceNames,
	audiences,
	classRule,
	type DetailStep,
	type DisclosureFile,
	type DisclosureGrain,
	type DisclosureOverride,
	detailSteps,
	disclosureGrains,
	kpiClassNames,
	kpiRule,
	type ResolvedRule,
	type RuledClass,
	type SchoolSize,
} from "./kpi-disclosure.js";

/** The KPI whose rule is the audience's income rule: the grain, delay and detail of its money. */
const INCOME_KPI = "gross_collected";
const PLAN_KPI = "revenue_by_tier";
const RULED_CLASSES: RuledClass[] = [
	"income",
	"losses",
	"cash",
	"people",
	"activity",
];
/** A cell shows only with at least this many contributing holders (the cell rules, spec v4). */
const MINIMUM_HOLDERS = 5;
/** A month closes this many days after it ends (spec "Closed months"); a quarter or a year when its last month does. */
const CLOSE_DELAY_DAYS = 7;
const MONTHS_IN_YEAR = 12;
const MONTHS_IN_QUARTER = 3;
const QUARTERS_IN_YEAR = 4;
const PRESET_COUNT_MONTHS_BACK = 2;
const MILLISECONDS_IN_DAY = 86_400_000;

const grainPlural: Record<DisclosureGrain, string> = {
	year: "years",
	quarter: "quarters",
	month: "months",
	day: "days",
};
/** The subject of "Public sees years". */
const audienceSees: Record<Audience, string> = {
	public: "Public sees",
	member: "Members see",
	governance: "Governance sees",
	finance: "Finance admins see",
	owner: "The owner sees",
};
const detailWords: Record<DetailStep, string> = {
	total: "totals",
	categories: "categories",
	breakdown: "plans",
	spread: "spread",
	rows: "rows",
	names: "names",
};
const monthNames = [
	"Jan",
	"Feb",
	"Mar",
	"Apr",
	"May",
	"Jun",
	"Jul",
	"Aug",
	"Sep",
	"Oct",
	"Nov",
	"Dec",
] as const;
const liveSummaries: Partial<Record<Audience, string>> = {
	owner:
		"Sees everything live, donor names, anonymous donors. Cannot be previewed by anyone but the owner.",
	finance:
		"Sees everything live, payer and donor names. Cannot see anonymous donors' names or change roles.",
};
const adminsOnlyLock: LockPanel = {
	reason: "admins_only",
	who: "Owners and admins see school settings",
	when: "The School books table is the disclosure file; members and the public read the document their audience gets.",
};

const detailRank = (detail: DetailStep): number => detailSteps.indexOf(detail);
const grainRank = (grain: DisclosureGrain): number =>
	disclosureGrains.indexOf(grain);

// Dates are `YYYY-MM-DD` strings in the school's time zone; arithmetic is in UTC so it has no zone of its own.
const toDate = (day: string): Date => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date): string => date.toISOString().slice(0, 10);
const addDays = (day: string, count: number): string =>
	toDay(new Date(toDate(day).getTime() + count * MILLISECONDS_IN_DAY));
const addMonths = (day: string, count: number): string => {
	const date = toDate(day);
	date.setUTCMonth(date.getUTCMonth() + count);
	return toDay(date);
};
const endOfMonth = (day: string): string => {
	const date = toDate(day);
	date.setUTCMonth(date.getUTCMonth() + 1, 0);
	return toDay(date);
};
const pad = (value: number): string => String(value).padStart(2, "0");
const monthStart = (year: number, monthIndex: number): string =>
	`${year}-${pad(monthIndex + 1)}-01`;
const monthOf = (day: string): number => Number(day.slice(5, 7)) - 1;
const yearOf = (day: string): number => Number(day.slice(0, 4));
const monthsSpanned = (from: string, to: string): number =>
	(yearOf(to) - yearOf(from)) * MONTHS_IN_YEAR +
	monthOf(to) -
	monthOf(from) +
	1;
const formatDay = (day: string): string =>
	`${Number(day.slice(8, 10))} ${monthNames[monthOf(day)]} ${yearOf(day)}`;
const closeOf = (to: string): string =>
	addDays(endOfMonth(to), CLOSE_DELAY_DAYS);
/** The day a delay after the close publishes: "6 weeks" or "N months". */
const publishDay = (to: string, after: ResolvedRule["after"]): string => {
	const close = closeOf(to);
	if (!after) return close;
	const [count = "0", unit = ""] = after.split(" ");
	return unit.startsWith("week")
		? addDays(close, 7 * Number(count))
		: addMonths(close, Number(count));
};

type Period = { from: string; to: string };
/** The grain a period is: `year` and `quarter` only when it starts on one; other whole months are `month`; the rest `day`. */
const grainOf = ({ from, to }: Period): DisclosureGrain => {
	const wholeMonths = from.endsWith("-01") && endOfMonth(to) === to;
	if (!wholeMonths) return "day";
	const months = monthsSpanned(from, to);
	const first = monthOf(from);
	if (months === MONTHS_IN_YEAR && first === 0) return "year";
	if (months === MONTHS_IN_QUARTER && first % MONTHS_IN_QUARTER === 0)
		return "quarter";
	return "month";
};

const list = (items: string[]): string =>
	items.length < 2
		? (items[0] ?? "")
		: `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;

/** The first audience, nearest the public, whose rule for a KPI is at least this detail and this fine a grain. */
const whoSees = (
	file: DisclosureFile,
	kpi: string,
	atLeast: { detail?: DetailStep; grain?: DisclosureGrain } = {},
): Audience | undefined =>
	audiences.find((audience) => {
		const rule = kpiRule(file, audience, kpi);
		if (!rule) return false;
		if (atLeast.detail && detailRank(rule.detail) < detailRank(atLeast.detail))
			return false;
		return !(atLeast.grain && grainRank(rule.every) < grainRank(atLeast.grain));
	});
/** "Members see this", "Governance and up see this", else "Finance admins and the owner see this". */
const whoText = (who: Audience | undefined): string =>
	who === "member"
		? "Members see this"
		: who === "governance"
			? "Governance and up see this"
			: "Finance admins and the owner see this";
const hiddenReason = (who: Audience | undefined): HiddenReason =>
	who === "member" ? "members_only" : "no_grant";

type Gate =
	| { state: "shown" }
	| { state: "future"; title: string }
	| { state: "embargoed"; title: string }
	| { state: "hidden"; reason: HiddenReason; title: string };

/** Whether an audience may pick a period (mockup `pAllow`): its income grain or coarser, once published. */
const gateOf = (
	file: DisclosureFile,
	audience: Audience,
	income: ResolvedRule | null,
	period: Period,
	today: string,
): Gate => {
	if (!income)
		return {
			state: "hidden",
			reason: "no_grant",
			title: whoText(whoSees(file, INCOME_KPI)),
		};
	if (period.from > today) return { state: "future", title: "Not started yet" };
	if (income.live) return { state: "shown" };
	const grain = grainOf(period);
	if (grainRank(grain) > grainRank(income.every)) {
		const who = whoSees(file, INCOME_KPI, { grain });
		return {
			state: "hidden",
			reason: hiddenReason(who),
			title: `${whoText(who)}: ${audienceSees[audience]} ${grainPlural[income.every]}`,
		};
	}
	const publishes = publishDay(period.to, income.after);
	if (publishes > today)
		return {
			state: "embargoed",
			title: `Published after ${formatDay(publishes)}`,
		};
	return { state: "shown" };
};

/** The period control's eight presets (mockup `PRE`) at the clock. */
const presetPeriods = (today: string): Array<[PresetGate["label"], Period]> => {
	const year = yearOf(today);
	const month = monthOf(today);
	const quarterFirst = month - (month % MONTHS_IN_QUARTER);
	const thisQuarter = monthStart(year, quarterFirst);
	const quarterOf = (first: string): Period => ({
		from: first,
		to: endOfMonth(addMonths(first, MONTHS_IN_QUARTER - 1)),
	});
	const thisMonth = monthStart(year, month);
	const monthOfFirst = (first: string): Period => ({
		from: first,
		to: endOfMonth(first),
	});
	return [
		["This month", monthOfFirst(thisMonth)],
		["Last month", monthOfFirst(addMonths(thisMonth, -1))],
		["This quarter", quarterOf(thisQuarter)],
		["Last quarter", quarterOf(addMonths(thisQuarter, -MONTHS_IN_QUARTER))],
		[
			"Last 3 months",
			{
				from: addMonths(thisMonth, -PRESET_COUNT_MONTHS_BACK),
				to: endOfMonth(thisMonth),
			},
		],
		["This year", { from: monthStart(year, 0), to: `${year}-12-31` }],
		["Last year", { from: monthStart(year - 1, 0), to: `${year - 1}-12-31` }],
		["Year to date", { from: monthStart(year, 0), to: today }],
	];
};

/** The periods the control lists for an audience below `finance` (mockup `pList`): the last three years, this and last
 * year's quarters, or this year's months. */
const periodList = (
	grain: DisclosureGrain,
	year: number,
): Array<Period & { key: string; label: string }> => {
	if (grain === "year")
		return [year - 2, year - 1, year].map((each) => ({
			key: String(each),
			label: String(each),
			from: monthStart(each, 0),
			to: `${each}-12-31`,
		}));
	if (grain === "quarter")
		return [year - 1, year].flatMap((each) =>
			Array.from({ length: QUARTERS_IN_YEAR }, (_, quarter) => {
				const from = monthStart(each, quarter * MONTHS_IN_QUARTER);
				return {
					key: `${each}-Q${quarter + 1}`,
					label: `Q${quarter + 1} ${each}`,
					from,
					to: endOfMonth(addMonths(from, MONTHS_IN_QUARTER - 1)),
				};
			}),
		);
	return Array.from({ length: MONTHS_IN_YEAR }, (_, index) => {
		const from = monthStart(year, index);
		return {
			key: `${year}-${pad(index + 1)}`,
			label: `${monthNames[index]} ${year}`,
			from,
			to: endOfMonth(from),
		};
	});
};

const finestDetail = (file: DisclosureFile, audience: Audience): DetailStep => {
	let finest: DetailStep = "total";
	for (const kpiClass of RULED_CLASSES) {
		const rule = classRule(file, kpiClass, audience);
		if (rule && detailRank(rule.detail) > detailRank(finest))
			finest = rule.detail;
	}
	return finest;
};

const summaryOf = (
	file: DisclosureFile,
	audience: Audience,
	income: ResolvedRule | null,
	roundTo: number,
): string => {
	const live = liveSummaries[audience];
	if (live) return live;
	const money = roundTo > 0 ? "money rounded" : "exact";
	if (!income) return "Sees no money figures. Cannot see rows.";
	const grain = grainPlural[income.every];
	const moneyDetail = detailWords[income.detail];
	if (audience === "governance")
		return `Sees ${grain}, ${moneyDetail}, ${detailWords[finestDetail(file, audience)]}, ${roundTo > 0 ? "rounded" : "exact"}. Cannot see names or per-person rows.`;
	if (audience === "member") {
		const hidden =
			detailRank(income.detail) < detailRank("breakdown")
				? ["plans, funds"]
				: ["names"];
		return `Sees ${grain}, ${moneyDetail}, ${money}. Cannot see ${list([...hidden, "anyone's rows"])}.`;
	}
	const unseen = RULED_CLASSES.filter(
		(kpiClass) => !classRule(file, kpiClass, audience),
	).map((kpiClass) => kpiClassNames[kpiClass].toLowerCase());
	const after = income.after ? ", after a delay" : "";
	return `Sees ${grain}, ${moneyDetail}, ${money}${after}. Cannot see ${list([...unseen, "rows"])}.`;
};

/** The unit money is rounded to for an audience: the effective file's, never finer than the B4 Uni file's (a school may
 * round coarser, never finer). */
const roundingOf = (
	base: DisclosureFile,
	effective: DisclosureFile,
	size: SchoolSize,
	audience: Audience,
): number => {
	if (audience !== "public" && audience !== "member") return 0;
	return Math.max(
		effective.rounding[size][audience],
		base.rounding[size][audience],
	);
};

export type AudienceViewsInput = {
	/** The B4 Uni disclosure file, unchanged. */
	file: DisclosureFile;
	/** The school's stored differences; `{}` for none. */
	override: DisclosureOverride;
	/** The school's size for `year` (`schoolSize`), fixed on the year's first day. */
	size: SchoolSize;
	/** The year the rounding size is fixed for: the clock's year. */
	year: number;
	/** The server's clock: `today` (`YYYY-MM-DD`, in the school's time zone) fixes the embargoes and the open month. */
	clock: { today: string; now: string };
};

/**
 * Each audience as this school's documents give it at the clock. Pure: the same input gives the same views, and the
 * input is not changed. `year` must be the clock's year, because the period lists and the size are for that year.
 */
export function audienceViews(
	input: AudienceViewsInput,
): Record<Audience, AudienceView> {
	const { file, override, size, year, clock } = input;
	const today = clock.today.slice(0, 10);
	if (yearOf(today) !== year)
		throw new RangeError(
			`audienceViews: year ${year} is not the clock's year (${today})`,
		);
	const effective = applyOverride(file, override);
	const presets = presetPeriods(today);
	const views = {} as Record<Audience, AudienceView>;
	for (const audience of audiences) {
		const income = kpiRule(effective, audience, INCOME_KPI);
		const live = income?.live === true;
		const roundTo = roundingOf(file, effective, size, audience);
		const grain: DisclosureGrain = live ? "day" : (income?.every ?? "year");
		// the strip and the notes name the selector's grain: months for a live audience
		const selectorGrain: DisclosureGrain = live ? "month" : grain;
		const failingRoundTo = effective.counts.failingRoundTo;
		const identities = effective.audiences[audience].identities === true;
		views[audience] = {
			name: audienceNames[audience],
			summary: summaryOf(effective, audience, income, roundTo),
			live,
			identities,
			detail: identities ? "names" : finestDetail(effective, audience),
			grain,
			delay: income?.after ?? null,
			roundTo,
			smallCounts: live
				? null
				: {
						fewerThan: MINIMUM_HOLDERS,
						roundTo: failingRoundTo,
						under: `<${failingRoundTo}`,
					},
			cellRules: live
				? "off"
				: audience === "governance"
					? "breakdown and spread"
					: "on",
			pin: audiences.indexOf(audience) >= audiences.indexOf("governance"),
			sees: `${audienceSees[audience]} ${grainPlural[selectorGrain]}`,
			periodNote: `${audienceNames[audience]}: ${live ? "months and days, live" : `${grainPlural[selectorGrain]} only`}. One period for Dashboard, Reports, Ledger and Members.`,
			customRangeNote: live
				? null
				: `Days show to finance admins and the owner. ${audienceSees[audience]} ${grainPlural[selectorGrain]}.`,
			presets: presets.map(([label, period]): PresetGate => {
				const gate = gateOf(effective, audience, income, period, today);
				if (gate.state === "shown")
					return { label, state: "shown", reason: null, title: null };
				if (gate.state === "hidden")
					return {
						label,
						state: "hidden",
						reason: gate.reason,
						title: gate.title,
					};
				if (gate.state === "embargoed")
					return {
						label,
						state: "embargoed",
						reason: "embargoed",
						title: gate.title,
					};
				throw new Error("a preset never starts after the clock");
			}),
			periods:
				live || !income
					? []
					: periodList(grain, year).map(
							({ key, label, from, to }): PeriodGate => {
								const gate = gateOf(
									effective,
									audience,
									income,
									{ from, to },
									today,
								);
								if (gate.state === "hidden")
									throw new Error(
										"a period of the audience's own grain is never hidden",
									);
								return {
									period: key,
									label,
									from,
									to,
									state: gate.state,
									title: gate.state === "shown" ? null : gate.title,
								};
							},
						),
		};
	}
	return views;
}

export type SurfaceLocksInput = {
	file: DisclosureFile;
	override: DisclosureOverride;
	/** The books audience the View as row shows. */
	audience: Audience;
	/** The row is Owner, Finance admin or Admin: it sees the roster, plans, bookings and settings. */
	admin: boolean;
};

/**
 * The lock panel of each gated surface a View as row may not see (`ViewAsOption.locks`): the plan breakdown of the
 * Dashboard and the Plans tab when the audience's plan revenue is coarser than `breakdown`, and the Settings drawer's
 * School books table for a row that is not an admin. Nothing for a row that sees them.
 */
export function surfaceLocks(
	input: SurfaceLocksInput,
): Partial<Record<GatedSurface, LockPanel>> {
	const { audience, admin } = input;
	const effective = applyOverride(input.file, input.override);
	const locks: Partial<Record<GatedSurface, LockPanel>> = {};
	const plans = kpiRule(effective, audience, PLAN_KPI);
	const seesPlans =
		plans &&
		(plans.live || detailRank(plans.detail) >= detailRank("breakdown"));
	if (!seesPlans) {
		const who = whoSees(effective, PLAN_KPI, { detail: "breakdown" });
		const rule = who ? kpiRule(effective, who, PLAN_KPI) : null;
		const when = !(who && rule)
			? ""
			: rule.live
				? `${audienceSees[who]} everything, live`
				: `${audienceSees[who]} ${rule.detail} by ${rule.every}`;
		const lock: LockPanel = {
			reason: hiddenReason(who),
			who: whoText(who),
			when,
		};
		locks["dashboard-plan"] = lock;
		locks["plans-revenue"] =
			admin && who === "governance"
				? { ...lock, who: "Finance or governance only" }
				: lock;
	}
	if (!admin) locks["settings-books"] = { ...adminsOnlyLock };
	return locks;
}

/** The View as dropdown's rows, in the mockup's order (`SUBS`): the five audiences and Admin, an admin without the
 * finance grant. */
export const viewAsValues = [
	"owner",
	"finance",
	"admin",
	"governance",
	"member",
	"public",
] as const;
export type ViewAs = (typeof viewAsValues)[number];
/** What the server words for a View as row (`ViewAsOption` without `value`, `held`, `audience` and `admin`, which the
 * UI's adapter works out from the viewer). */
export type ViewAsRow = {
	name: string;
	summary: string;
	locks: Partial<Record<GatedSurface, LockPanel>>;
};

/** The Admin row's copy (mockup `plans/ledger-ui/design/mockup.html`: `SUB_NAME.admin` from `SUBS`, and `vaSummary`'s
 * `admin`): the same at every school, because an admin's books audience is not a file rule. */
const ADMIN_ROW_NAME = "Admin";
const ADMIN_ROW_SUMMARY =
	"Sees roster, plans, bookings and balances. Cannot see money per person, the ledger or names.";
const ADMIN_ROWS: ReadonlySet<ViewAs> = new Set(["owner", "finance", "admin"]);

export type ViewAsRowsInput = {
	file: DisclosureFile;
	override: DisclosureOverride;
	/** `audienceViews` of the same file and override: each audience row's name and summary are its view's. */
	views: Record<Audience, AudienceView>;
	/** The books audience the Admin row shows (mockup `VW`): an admin's own, `member` when an owner or a finance admin
	 * previews it. */
	adminAudience?: Audience;
};

/** Each View as row's name, summary and lock panels. Pure. */
export function viewAsRows(input: ViewAsRowsInput): Record<ViewAs, ViewAsRow> {
	const { file, override, views } = input;
	const rows = {} as Record<ViewAs, ViewAsRow>;
	for (const value of viewAsValues) {
		const isAdminRow = value === "admin";
		const audience: Audience = isAdminRow
			? (input.adminAudience ?? "member")
			: value;
		rows[value] = {
			name: isAdminRow ? ADMIN_ROW_NAME : views[value].name,
			summary: isAdminRow ? ADMIN_ROW_SUMMARY : views[value].summary,
			locks: surfaceLocks({
				file,
				override,
				audience,
				admin: ADMIN_ROWS.has(value),
			}),
		};
	}
	return rows;
}

/** The school's size for a year (spec "Rounding"): large from `rounding.largeFrom` of income in the last closed year, small
 * below it and for a school with no closed year (`null`). */
export function schoolSize(
	file: DisclosureFile,
	lastClosedYearIncome: number | null,
): SchoolSize {
	return lastClosedYearIncome !== null &&
		lastClosedYearIncome >= file.rounding.largeFrom
		? "large"
		: "small";
}
