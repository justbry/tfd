/**
 * `audienceViews` of `atm/worker`: what each audience sees of a school's books, worked out at a clock.
 *
 * - **Fixture-proven:** for each school of `packages/ledger-ui/src/fixtures/disclosure.json` (its file, override, size and
 *   year) at the fixture clock `2026-11-05T12:00`, the function returns exactly that record's `views`, and `surfaceLocks`
 *   its `viewAs[].locks`. The fixture holds the B4 Uni defaults and no override, so it proves the default file only: two
 *   different outcomes in all (small and large, Public's rounding) and one clock.
 * - **Spec-only:** the rest. Overrides, the size bands, the delay rules by audience, the small-count wording, the
 *   publication boundary and the other clocks follow the disclosure spec and the mockup's period rules; no fixture
 *   shows them, so each case below says what it rests on.
 *
 * The comparison is by leaf path with `canonicalize` on each leaf. `EXPECTED_DIFFERENCES` is the named list of the
 * leaves where the function does not equal the fixture on purpose; it is empty because there is none today, and a
 * difference not on it fails the test.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { canonicalize } from "../src/ledger/util.js";
import {
	type AudienceView,
	audiences,
	audienceViews,
	type DisclosureFile,
	type DisclosureOverride,
	schoolSize,
	surfaceLocks,
} from "../src/worker.js";

const REPOSITORY = resolve(import.meta.dir, "../../..");
const UI = join(REPOSITORY, "packages/ledger-ui");
const FIXTURE_CLOCK = { today: "2026-11-05", now: "2026-11-05T12:00" };

type FixtureSchool = {
	school: string;
	year: number;
	size: "small" | "large";
	override: DisclosureOverride;
	views: Record<(typeof audiences)[number], AudienceView>;
	viewAs: Array<{
		value: string;
		audience: (typeof audiences)[number];
		admin: boolean;
		locks: unknown;
	}>;
};
type DisclosureFixture = {
	file: DisclosureFile;
	schools: Record<string, FixtureSchool>;
};

const fixture = JSON.parse(
	readFileSync(join(UI, "src/fixtures/disclosure.json"), "utf8"),
) as DisclosureFixture;
const FILE = fixture.file;

/** `school.audience.path` of each leaf where the function differs from the fixture on purpose. */
const EXPECTED_DIFFERENCES: string[] = [];

const leaves = (value: unknown, path: string, into: Map<string, string>) => {
	if (Array.isArray(value)) {
		for (const [index, item] of value.entries())
			leaves(item, `${path}[${index}]`, into);
		if (value.length === 0) into.set(path, "[]");
	} else if (typeof value === "object" && value !== null) {
		for (const [key, item] of Object.entries(value))
			leaves(item, `${path}.${key}`, into);
	} else into.set(path, canonicalize(value));
};
const differences = (
	school: string,
	actual: Record<string, AudienceView>,
	expected: Record<string, AudienceView>,
): string[] => {
	const got = new Map<string, string>();
	const want = new Map<string, string>();
	leaves(actual, school, got);
	leaves(expected, school, want);
	return [...new Set([...got.keys(), ...want.keys()])]
		.filter((path) => got.get(path) !== want.get(path))
		.sort();
};

const viewsAt = (
	today: string,
	override: DisclosureOverride = {},
	size: "small" | "large" = "small",
) =>
	audienceViews({
		file: FILE,
		override,
		size,
		year: Number(today.slice(0, 4)),
		clock: { today, now: `${today}T12:00` },
	});
const presetOf = (view: AudienceView, label: string) => {
	const preset = view.presets.find((each) => each.label === label);
	if (!preset) throw new Error(`no preset ${label}`);
	return preset;
};
const periodOf = (view: AudienceView, key: string) => {
	const period = view.periods.find((each) => each.period === key);
	if (!period) throw new Error(`no period ${key}`);
	return period;
};

describe("audienceViews equals the fixture (fixture-proven)", () => {
	test("the fixture holds the five schools and the clock the function is given", () => {
		expect(Object.keys(fixture.schools)).toEqual([
			"vol",
			"b4u",
			"map",
			"nw",
			"har",
		]);
	});

	for (const [id, record] of Object.entries(fixture.schools)) {
		test(`${id}: the views are the record's, bar the expected differences`, () => {
			const views = audienceViews({
				file: fixture.file,
				override: record.override,
				size: record.size,
				year: record.year,
				clock: FIXTURE_CLOCK,
			});
			const found = differences(id, views, record.views);
			const unexpected = found.filter(
				(path) => !EXPECTED_DIFFERENCES.includes(path),
			);
			expect(unexpected).toEqual([]);
			expect(found).toEqual(
				EXPECTED_DIFFERENCES.filter((path) => path.startsWith(`${id}.`)),
			);
			if (EXPECTED_DIFFERENCES.length === 0)
				expect(canonicalize(views)).toBe(canonicalize(record.views));
		});

		test(`${id}: the lock panels of every View as row are the record's`, () => {
			for (const row of record.viewAs)
				expect(
					canonicalize(
						surfaceLocks({
							file: fixture.file,
							override: record.override,
							audience: row.audience,
							admin: row.admin,
						}),
					),
					`${id} ${row.value}`,
				).toBe(canonicalize(row.locks));
		});
	}

	test("the five records differ in one leaf only: Public's rounding, small against large", () => {
		const small = fixture.schools.vol?.views;
		const large = fixture.schools.har?.views;
		expect(small && large && differences("x", small, large)).toEqual([
			"x.public.roundTo",
		]);
	});

	test("(control) a wrong size is a difference the comparison sees", () => {
		const record = fixture.schools.har;
		if (!record) throw new Error("no har");
		const wrong = audienceViews({
			file: FILE,
			override: {},
			size: "small",
			year: 2026,
			clock: FIXTURE_CLOCK,
		});
		expect(differences("har", wrong, record.views)).toEqual([
			"har.public.roundTo",
		]);
	});
});

describe("the default file by audience (spec rules; the clock is the fixture's)", () => {
	const views = viewsAt("2026-11-05");

	test("grain, delay, PIN and cell rules follow the spec's audience table", () => {
		const table = audiences.map((audience) => {
			const view = views[audience];
			return [
				audience,
				view.grain,
				view.delay,
				view.pin,
				view.cellRules,
				view.live,
			];
		});
		expect(table).toEqual([
			["public", "year", "12 months", false, "on", false],
			["member", "quarter", "6 weeks", false, "on", false],
			["governance", "month", null, true, "breakdown and spread", false],
			["finance", "day", null, true, "off", true],
			["owner", "day", null, true, "off", true],
		]);
	});

	test("the finest detail is categories, categories, spread, names, names", () => {
		expect(audiences.map((audience) => views[audience].detail)).toEqual([
			"categories",
			"categories",
			"spread",
			"names",
			"names",
		]);
	});

	test("only finance and the owner have identities and a live view with no periods", () => {
		expect(audiences.map((audience) => views[audience].identities)).toEqual([
			false,
			false,
			false,
			true,
			true,
		]);
		expect(views.finance.periods).toEqual([]);
		expect(views.owner.customRangeNote).toBeNull();
	});

	test("a month closes 7 days after it ends: October publishes to governance after 7 Nov", () => {
		expect(presetOf(views.governance, "Last month")).toEqual({
			label: "Last month",
			state: "embargoed",
			reason: "embargoed",
			title: "Published after 7 Nov 2026",
		});
		expect(periodOf(views.governance, "2026-12")).toMatchObject({
			state: "future",
			title: "Not started yet",
		});
	});

	test("public sees a year 12 months after it closes, a member a quarter 6 weeks after", () => {
		expect(periodOf(views.public, "2024").state).toBe("shown");
		expect(periodOf(views.public, "2025")).toMatchObject({
			state: "embargoed",
			title: "Published after 7 Jan 2027",
		});
		expect(periodOf(views.member, "2026-Q2").state).toBe("shown");
		expect(periodOf(views.member, "2026-Q3")).toMatchObject({
			state: "embargoed",
			title: "Published after 18 Nov 2026",
		});
	});

	test("small counts fail to the nearest 10 below finance, 1 to 9 as <10; finance and the owner have none", () => {
		for (const audience of ["public", "member", "governance"] as const)
			expect(views[audience].smallCounts).toEqual({
				fewerThan: 5,
				roundTo: 10,
				under: "<10",
			});
		expect(views.finance.smallCounts).toBeNull();
		expect(views.owner.smallCounts).toBeNull();
	});

	test("the failing-count rounding is the file's: 20 reads <20", () => {
		const coarser = audienceViews({
			file: { ...FILE, counts: { failingRoundTo: 20 } },
			override: {},
			size: "small",
			year: 2026,
			clock: FIXTURE_CLOCK,
		});
		expect(coarser.public.smallCounts).toEqual({
			fewerThan: 5,
			roundTo: 20,
			under: "<20",
		});
	});
});

describe("rounding and the size bands (spec 'Rounding')", () => {
	test("small: $100 for public and member, exact for governance and up", () => {
		const views = viewsAt("2026-11-05", {}, "small");
		expect(audiences.map((audience) => views[audience].roundTo)).toEqual([
			10_000, 10_000, 0, 0, 0,
		]);
	});

	test("large: $1,000 for public, $100 for member, exact above", () => {
		const views = viewsAt("2026-11-05", {}, "large");
		expect(audiences.map((audience) => views[audience].roundTo)).toEqual([
			100_000, 10_000, 0, 0, 0,
		]);
	});

	test("a school is large from $100,000 of income in the last closed year, small below it and with no closed year", () => {
		expect(schoolSize(FILE, null)).toBe("small");
		expect(schoolSize(FILE, 0)).toBe("small");
		expect(schoolSize(FILE, 9_999_999)).toBe("small");
		expect(schoolSize(FILE, 10_000_000)).toBe("large");
		expect(schoolSize(FILE, 25_000_000)).toBe("large");
	});

	test("an override may round coarser, never finer", () => {
		const coarser = viewsAt(
			"2026-11-05",
			{ rounding: { small: { public: 100_000, member: 50_000 } } },
			"small",
		);
		expect([coarser.public.roundTo, coarser.member.roundTo]).toEqual([
			100_000, 50_000,
		]);
		const finer = viewsAt(
			"2026-11-05",
			{ rounding: { small: { public: 100, member: 0 } } },
			"small",
		);
		expect([finer.public.roundTo, finer.member.roundTo]).toEqual([
			10_000, 10_000,
		]);
	});

	test("an override for the other size does not move this one", () => {
		const views = viewsAt(
			"2026-11-05",
			{ rounding: { large: { public: 500_000 } } },
			"small",
		);
		expect(views.public.roundTo).toBe(10_000);
	});

	test("the summary says money is rounded for public and member, exact for governance", () => {
		const views = viewsAt("2026-11-05");
		expect(views.public.summary).toContain("money rounded");
		expect(views.member.summary).toContain("money rounded");
		expect(views.governance.summary).toContain("exact");
		const exact = viewsAt("2026-11-05", {}, "small");
		expect(exact.governance.roundTo).toBe(0);
	});
});

describe("overrides (spec 'School overrides'; no fixture has one)", () => {
	test("tightening: public income at total, by year, 24 months after close", () => {
		const views = viewsAt("2026-11-05", {
			rules: {
				"income.public": { detail: "total", every: "year", after: "24 months" },
			},
		});
		expect(views.public.delay).toBe("24 months");
		expect(periodOf(views.public, "2024")).toMatchObject({
			state: "embargoed",
			title: "Published after 7 Jan 2027",
		});
		expect(periodOf(views.public, "2025")).toMatchObject({
			state: "embargoed",
			title: "Published after 7 Jan 2028",
		});
		expect(views.public.summary).toContain("after a delay");
		expect(views.public.summary).toContain("totals");
	});

	test("tightening: members lose the losses class; nothing else of the view moves", () => {
		const base = viewsAt("2026-11-05");
		const views = viewsAt("2026-11-05", { rules: { "losses.member": null } });
		expect(canonicalize(views)).toBe(canonicalize(base));
	});

	test("loosening: members see income by month, 6 weeks after close, and the strip is months", () => {
		const views = viewsAt("2026-11-05", {
			rules: {
				"income.member": {
					detail: "categories",
					every: "month",
					after: "6 weeks",
				},
			},
		});
		expect(views.member.grain).toBe("month");
		expect(views.member.sees).toBe("Members see months");
		expect(views.member.periods.map((period) => period.period)).toEqual(
			Array.from(
				{ length: 12 },
				(_, i) => `2026-${String(i + 1).padStart(2, "0")}`,
			),
		);
		expect(presetOf(views.member, "Last month")).toEqual({
			label: "Last month",
			state: "embargoed",
			reason: "embargoed",
			title: "Published after 19 Dec 2026",
		});
		expect(presetOf(views.member, "This quarter").state).toBe("embargoed");
		// the order rule needs governance at least as open: it still is (month, no delay)
		expect(views.governance.grain).toBe("month");
	});

	test("removing public's income rule: no periods, every preset hidden with the first audience that sees it", () => {
		const views = viewsAt("2026-11-05", { rules: { "income.public": null } });
		// public then inherits nothing (it is the root): no income rule
		expect(views.public.periods).toEqual([]);
		for (const preset of views.public.presets)
			expect(preset).toMatchObject({
				state: "hidden",
				reason: "no_grant",
				title: "Members see this",
			});
		expect(views.public.summary).toBe(
			"Sees no money figures. Cannot see rows.",
		);
	});

	test("moving a KPI between classes: gross_collected into cash takes cash's rules", () => {
		const views = viewsAt("2026-11-05", {
			moves: { gross_collected: "cash" },
		});
		// cash has a rule for governance only: public and member see no gross collected
		expect(views.public.periods).toEqual([]);
		expect(views.member.periods).toEqual([]);
		expect(views.governance.grain).toBe("month");
	});

	test("an override does not change the input", () => {
		const override: DisclosureOverride = {
			rules: { "income.public": { detail: "total", every: "year" } },
		};
		const before = canonicalize({ FILE, override });
		viewsAt("2026-11-05", override);
		expect(canonicalize({ FILE, override })).toBe(before);
	});
});

describe("clocks other than the fixture's (mockup period rules; no fixture)", () => {
	test("the strip follows the clock's year", () => {
		const views = viewsAt("2027-02-10");
		expect(views.public.periods.map((period) => period.period)).toEqual([
			"2025",
			"2026",
			"2027",
		]);
		expect(views.member.periods[0]?.period).toBe("2026-Q1");
		expect(views.governance.periods[0]?.period).toBe("2027-01");
	});

	test("a figure publishes on the day its delay ends (the title says 'after', the mockup shows it that day)", () => {
		const before = viewsAt("2026-11-17");
		const on = viewsAt("2026-11-18");
		expect(periodOf(before.member, "2026-Q3").state).toBe("embargoed");
		expect(periodOf(on.member, "2026-Q3").state).toBe("shown");
	});

	test("presets follow the clock: on 31 Dec the open year is still embargoed for the public", () => {
		const views = viewsAt("2026-12-31");
		expect(presetOf(views.finance, "This quarter").state).toBe("shown");
		expect(presetOf(views.public, "Last year")).toMatchObject({
			state: "embargoed",
			title: "Published after 7 Jan 2027",
		});
		expect(presetOf(views.public, "This year").title).toBe(
			"Published after 7 Jan 2028",
		);
	});

	test("on 5 Jan the last quarter is still inside its close for governance", () => {
		const views = viewsAt("2027-01-05");
		expect(presetOf(views.governance, "Last quarter")).toMatchObject({
			state: "embargoed",
			title: "Published after 7 Jan 2027",
		});
	});

	test("a year that is not the clock's is refused", () => {
		expect(() =>
			audienceViews({
				file: FILE,
				override: {},
				size: "small",
				year: 2025,
				clock: FIXTURE_CLOCK,
			}),
		).toThrow(RangeError);
	});

	test("deterministic: the same input twice is the same bytes", () => {
		expect(canonicalize(viewsAt("2026-11-05"))).toBe(
			canonicalize(viewsAt("2026-11-05")),
		);
	});
});

describe("surfaceLocks beyond the fixture", () => {
	test("an override that opens plans to members lifts their plan locks", () => {
		const locks = surfaceLocks({
			file: FILE,
			override: {
				rules: {
					"income.member": {
						detail: "breakdown",
						every: "quarter",
						after: "6 weeks",
					},
				},
			},
			audience: "member",
			admin: false,
		});
		expect(Object.keys(locks)).toEqual(["settings-books"]);
	});

	test("an override that opens plans to members names members in the public lock", () => {
		const locks = surfaceLocks({
			file: FILE,
			override: {
				rules: {
					"income.member": {
						detail: "breakdown",
						every: "quarter",
						after: "6 weeks",
					},
				},
			},
			audience: "public",
			admin: false,
		});
		expect(locks["dashboard-plan"]).toEqual({
			reason: "members_only",
			who: "Members see this",
			when: "Members see breakdown by quarter",
		});
	});

	test("owner and finance rows have no locks", () => {
		for (const audience of ["owner", "finance"] as const)
			expect(
				surfaceLocks({ file: FILE, override: {}, audience, admin: true }),
			).toEqual({});
	});
});

describe("the output types are the UI's", () => {
	test("audience-view-types.ts holds the block of ledger-ui's disclosure.ts from HiddenReason to AudienceView", () => {
		const text = readFileSync(join(UI, "src/data/disclosure.ts"), "utf8");
		const block = text.slice(
			text.indexOf("/** Why a figure or a surface is not shown"),
			text.indexOf("/** What View as previews"),
		);
		const copy = readFileSync(
			join(import.meta.dir, "../src/ledger/audience-view-types.ts"),
			"utf8",
		);
		expect(block.length).toBeGreaterThan(2000);
		expect(copy).toContain(block.trimEnd());
	});

	test("(control) a UI block with one line changed is not in the copy", () => {
		const copy = readFileSync(
			join(import.meta.dir, "../src/ledger/audience-view-types.ts"),
			"utf8",
		);
		expect(copy).toContain('cellRules: "on" | "breakdown and spread" | "off";');
		expect(copy).not.toContain('cellRules: "on" | "off";');
	});
});
