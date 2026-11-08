/**
 * The proof page, the live demo link and the simulated verticals: claim rules checked on the source and on what
 * `bun run build` wrote into build/. Run `bun run build` first.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { BUILD } from "../scripts/agent-files";
import { DEMO_URL, SITE_ORIGIN } from "../src/lib/config";
import { dashboardPath, type Preset, VERTICALS } from "../src/lib/verticals";

const SRC = join(import.meta.dir, "../src");
const CONFIG = "lib/config.ts";
const DEMO_HOST = new URL(DEMO_URL).host;

/** "Recurring giving" is the church's name for MRR only: its stat ("… last month") and KPI ("… (MRR)") labels. */
const CHURCH_MRR_ELSEWHERE = /recurring giving(?! last month| \(MRR\))/i;
/** Claims the site must never make, in any built page, mirror or agent file. */
const BANNED: [string, RegExp][] = [
	["a speed or duration number", /\b\d+\s*(seconds?|minutes?|mins?)\b/i],
	["600/600", /600\/600/],
	["the view-hash count", /256 view/i],
	["S3", /\bS3\b/],
	["DuckDB over R2", /duckdb over r2/i],
	["a fourth path", /fourth path/i],
	["the wrong school name", /honeycomb hollow/i],
	["ARR, except saying there is none", /(?<!no )\bARR\b/],
	["logo churn, except saying there is none", /(?<!no )logo churn/i],
	["pledges, except saying there are none", /(?<!no )\bpledges?\b/i],
	["win-back", /win-back/i],
	["refund windows", /refund window/i],
	["giver retention", /giver retention/i],
	[
		"recurring giving, except as the church's MRR label (its income, Giving, includes one-time gifts)",
		CHURCH_MRR_ELSEWHERE,
	],
	["a vertical still coming", /simulation coming/i],
];
/** Words for what the generator doesn't model, or KPIs the engine doesn't compute: never in vertical copy. */
const NOT_MODELLED =
	/win-back|pledge|refund window|failed payment|retention|\bARR\b|logo churn|recurring revenue|seat changes|coming/i;

/**
 * The verified runs on tfd dev (a5f769038, 2026-11-07: `simulate --profile <preset> --json`, every channel equal), with
 * mrr read from the last month of the KPI table: verticals.ts must match.
 */
const VERIFIED: Record<string, Omit<Preset, "name" | "what" | "payingNote">> = {
	"studio-members": {
		seed: 201,
		months: "2026-01..2026-12",
		members: 73,
		invoices: 512,
		refunds: 3,
		disputes: 1,
		grossCollected: "$47,527",
		payingLastMonth: 45,
		mrr: "$4,060.67",
		hash: "4d2a1faf…27f9",
	},
	"studio-class-packs": {
		seed: 202,
		months: "2026-01..2026-09",
		members: 40,
		invoices: 199,
		refunds: 1,
		disputes: 2,
		grossCollected: "$17,771.63",
		payingLastMonth: 22,
		mrr: "$1,989",
		hash: "5f1c2862…96ad",
	},
	"church-giving": {
		seed: 301,
		months: "2026-01..2026-12",
		members: 82,
		invoices: 608,
		refunds: 5,
		disputes: 0,
		grossCollected: "$68,050",
		payingLastMonth: 52,
		mrr: "$5,655",
		hash: "7e300ea9…1c08",
	},
	"saas-seats": {
		seed: 401,
		months: "2026-01..2026-12",
		members: 89,
		invoices: 515,
		refunds: 3,
		disputes: 1,
		grossCollected: "$69,521",
		payingLastMonth: 49,
		mrr: "$7,401.01",
		hash: "2a8acedb…74e6",
	},
	"saas-annual": {
		seed: 402,
		months: "2026-01..2027-12",
		members: 20,
		invoices: 38,
		refunds: 0,
		disputes: 0,
		grossCollected: "$52,993",
		payingLastMonth: 0,
		mrr: "$2,046.67",
		hash: "e816e133…e4ee",
	},
	"creator-launch": {
		seed: 501,
		months: "2026-01..2026-12",
		members: 134,
		invoices: 851,
		refunds: 61,
		disputes: 6,
		grossCollected: "$25,297",
		payingLastMonth: 66,
		mrr: "$1,460.85",
		hash: "04940170…d901",
	},
};
const PRESETS = VERTICALS.flatMap((vertical) => vertical.presets);
const presetByName = new Map(PRESETS.map((preset) => [preset.name, preset]));
/** The orgs with presets: every vertical but the school. */
const SIMULATED = VERTICALS.filter((vertical) => vertical.presets.length > 0);
const NEAR_VERTICAL = /customers?|used by|trusted by/i;
/** Characters either side of a vertical's name that must stay clear of customer language. */
const NEAR_WINDOW = 400;
const TAG = /<[^>]*>/g;
const CARD =
	/<article\b[^>]*data-vertical="([^"]+)"[^>]*data-status="([^"]+)"[^>]*>([\s\S]*?)<\/article>/g;
/** A preset's numbers as rendered: a /proof table row, or a card's stats (up to the end of its list). */
const PRESET_BLOCK =
	/<(tr|div)\b[^>]*data-preset="([^"]+)"[^>]*>([\s\S]*?)<\/(?:tr|dl)>/g;
/** A block's text as space-separated tokens, padded so `includes(" 45 ")` matches whole tokens. */
const tokens = (html: string) =>
	` ${html
		.replace(TAG, " ")
		.replace(/&nbsp;|\u00a0/g, " ")
		.replace(/\s+/g, " ")
		.trim()} `;

function files(dir: string, keep: (file: string) => boolean): string[] {
	return readdirSync(dir, { recursive: true, withFileTypes: true })
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath, entry.name))
		.filter(keep);
}

describe("source", () => {
	test("the demo URL is spelled only in config.ts; everything else reads DEMO_URL", () => {
		const spelled = files(SRC, (file) =>
			/\.(ts|svelte|md|json|css|html)$/.test(file),
		)
			.filter((file) => readFileSync(file, "utf8").includes(DEMO_HOST))
			.map((file) => relative(SRC, file));
		expect(spelled).toEqual([CONFIG]);
	});

	test("every org has a demo dashboard; only the school has the live demo; the simulated orgs have presets", () => {
		expect(
			VERTICALS.filter((vertical) => vertical.demoUrl).map(
				(vertical) => vertical.slug,
			),
		).toEqual(["schools"]);
		for (const vertical of VERTICALS)
			expect({
				slug: vertical.slug,
				status: vertical.status,
				dashboard: vertical.dashboard,
			}).toEqual({
				slug: vertical.slug,
				status: "dashboard",
				dashboard: dashboardPath(vertical.demoOrg),
			});
		expect(SIMULATED.length).toBe(VERTICALS.length - 1);
		expect(VERTICALS[0]?.demoUrl).toBe(DEMO_URL);
		for (const vertical of SIMULATED)
			expect({
				slug: vertical.slug,
				presets: vertical.presets.length > 0,
			}).toEqual({ slug: vertical.slug, presets: true });
	});

	test("every preset's numbers match the verified runs", () => {
		expect(PRESETS.map((preset) => preset.name).sort()).toEqual(
			Object.keys(VERIFIED).sort(),
		);
		for (const preset of PRESETS) {
			const { name, what: _what, payingNote: _note, ...numbers } = preset;
			expect({ name, ...numbers }).toEqual({ name, ...VERIFIED[name] });
		}
	});

	test("vertical copy describes only what's modelled and only KPIs the engine computes", () => {
		for (const vertical of VERTICALS) {
			const copy = [
				...vertical.vocabulary,
				...vertical.simulates,
				...vertical.kpis,
				...Object.values(vertical.labels ?? {}),
			];
			for (const line of copy)
				expect({
					slug: vertical.slug,
					line,
					match: NOT_MODELLED.exec(line)?.[0] ?? null,
				}).toMatchObject({ match: null });
		}
	});

	test("the church vertical speaks of givers and giving; recurring giving only names its MRR; never members", () => {
		const nonprofit = VERTICALS.find((entry) => entry.slug === "churches");
		// The church's own words; the engine's KPI names (new_paying_members) are shown beside them, not instead.
		const text = JSON.stringify([
			nonprofit?.name,
			nonprofit?.vocabulary,
			nonprofit?.simulates,
			nonprofit?.kpis,
			Object.values(nonprofit?.labels ?? {}),
		]);
		expect(text).toContain("giver");
		expect(text).toContain("giving");
		expect(text).not.toMatch(CHURCH_MRR_ELSEWHERE);
		expect(text).not.toMatch(/\bmembers?\b/i);
		expect(nonprofit?.labels?.mrr).toBe("Recurring giving last month");
	});
});

describe("build output", () => {
	if (!existsSync(join(BUILD, "llms.txt")))
		throw new Error("No build/llms.txt: run `bun run build` before `bun test`");
	const read = (file: string) => readFileSync(join(BUILD, file), "utf8");
	// The demo dashboards under demo/orgs/ are copies of generated pages, checked in tests/org-demos.test.ts.
	const built = files(
		BUILD,
		(file) =>
			/\.(html|md|txt)$/.test(file) &&
			!file.includes("/_app/") &&
			!relative(BUILD, file).startsWith("demo/"),
	);

	test("llms.txt lists /proof, the live demo and every simulation", () => {
		const llms = read("llms.txt");
		expect(llms).toContain(`](${SITE_ORIGIN}/proof.md): `);
		expect(llms).toContain(DEMO_URL);
		expect(llms).toContain("\n## Simulations\n");
		for (const vertical of VERTICALS)
			expect(llms).toContain(`- ${vertical.name}: ${vertical.org}`);
		for (const preset of PRESETS) {
			const line =
				llms
					.split("\n")
					.find((text) =>
						text.includes(`\`${preset.name}\` (seed ${preset.seed}`),
					) ?? "";
			for (const value of [
				preset.grossCollected,
				preset.hash,
				`${preset.members} new paying members`,
				`${preset.invoices} payments`,
			])
				expect({
					preset: preset.name,
					value,
					found: line.includes(value),
				}).toMatchObject({ found: true });
		}
		expect(llms).toContain("Where the simulations simplify: ");
	});

	test("no banned claim in any built page, mirror or agent file", () => {
		expect(built.length).toBeGreaterThan(20);
		for (const file of built) {
			const raw = readFileSync(file, "utf8");
			// Text only: class names such as "mt-1.5 min-h-[22px]" aren't claims.
			const text = file.endsWith(".html") ? raw.replace(TAG, " ") : raw;
			for (const [what, pattern] of BANNED) {
				const match = pattern.exec(text)?.[0] ?? null;
				expect({ file: relative(BUILD, file), what, match }).toEqual({
					file: relative(BUILD, file),
					what,
					match: null,
				});
			}
		}
	});

	test("only the school's card links the live demo; every gallery card links its dashboard; nothing unmodelled", () => {
		const seen: Record<string, number> = {};
		for (const file of built.filter((entry) => entry.endsWith(".html"))) {
			for (const [, slug = "", status = "", inner = ""] of read(
				relative(BUILD, file),
			).matchAll(CARD)) {
				seen[status] = (seen[status] ?? 0) + 1;
				const where = { file: relative(BUILD, file), slug };
				if (slug !== "schools")
					expect({ ...where, demo: inner.includes(DEMO_HOST) }).toEqual({
						...where,
						demo: false,
					});
				if (relative(BUILD, file) === "index.html") {
					const dashboard = VERTICALS.find(
						(vertical) => vertical.slug === slug,
					)?.dashboard;
					expect({
						...where,
						dashboard:
							Boolean(dashboard) && inner.includes(`href="${dashboard}"`),
					}).toEqual({ ...where, dashboard: true });
				}
				if (slug !== "schools")
					expect({
						...where,
						match: NOT_MODELLED.exec(tokens(inner))?.[0] ?? null,
					}).toEqual({ ...where, match: null });
			}
		}
		// The homepage gallery (5), and one card each on /for/studios, /churches, /nonprofits, /saas and /creators.
		expect(seen).toEqual({ dashboard: VERTICALS.length + 5 });
	});

	test("every number shown for a preset equals verticals.ts, and /proof has a row for each", () => {
		const rows = new Set<string>();
		for (const file of built.filter((entry) => entry.endsWith(".html"))) {
			for (const [, kind = "", name = "", inner = ""] of read(
				relative(BUILD, file),
			).matchAll(PRESET_BLOCK)) {
				const preset = presetByName.get(name);
				expect({ name, known: Boolean(preset) }).toEqual({ name, known: true });
				if (!preset) continue;
				if (kind === "tr" && file.endsWith("proof.html")) rows.add(name);
				const shown =
					kind === "tr"
						? [
								preset.members,
								preset.invoices,
								preset.refunds,
								preset.disputes,
								preset.grossCollected,
								preset.payingLastMonth,
								preset.mrr,
								preset.hash,
								preset.months,
							]
						: [
								preset.grossCollected,
								preset.members,
								preset.payingLastMonth,
								preset.mrr,
								preset.seed,
								preset.months,
							];
				const text = tokens(inner);
				for (const value of shown)
					expect({
						file: relative(BUILD, file),
						name,
						value,
						found: text.includes(` ${value} `),
					}).toMatchObject({ found: true });
			}
		}
		expect([...rows].sort()).toEqual([...presetByName.keys()].sort());
	});

	test("no customer, used-by or trusted-by language near a vertical's name", () => {
		const mirrors = [
			"index.md",
			"proof.md",
			...readdirSync(join(BUILD, "for"))
				.filter((file) => file.endsWith(".md"))
				.map((file) => `for/${file}`),
		];
		for (const file of mirrors) {
			const text = read(file);
			for (const name of VERTICALS.flatMap((vertical) => [
				vertical.name,
				vertical.org,
			])) {
				const vertical = { name };
				let at = text.indexOf(vertical.name);
				while (at !== -1) {
					const near = text.slice(
						Math.max(0, at - NEAR_WINDOW),
						at + vertical.name.length + NEAR_WINDOW,
					);
					const match = NEAR_VERTICAL.exec(near)?.[0] ?? null;
					expect({ file, vertical: vertical.name, match }).toEqual({
						file,
						vertical: vertical.name,
						match: null,
					});
					at = text.indexOf(vertical.name, at + 1);
				}
			}
		}
	});

	test("the churches page says giver and giving, recurring giving only for its MRR, never members", () => {
		const page = read("for/churches.md");
		expect(page).toContain("giver");
		expect(page).toContain("Giving collected");
		expect(page).toContain("Recurring giving last month");
		expect(page).not.toMatch(CHURCH_MRR_ELSEWHERE);
		expect(page).not.toMatch(/\bmembers?\b/i);
	});

	test("the homepage shows the diagram once and the demo with its caption", () => {
		const home = read("index.html");
		expect(home.split("One sample school year").length).toBe(2);
		expect(home).toContain(
			"Honeycomb Hill Academy is a sample school with synthetic data.",
		);
		const demoLinks = [...home.matchAll(/<a\b[^>]*>/g)]
			.map(([tag]) => tag)
			.filter((tag) => tag.includes(`href="${DEMO_URL}"`));
		expect(demoLinks.length).toBeGreaterThan(0);
		for (const tag of demoLinks) {
			expect(tag).toContain('rel="noopener"');
			expect(tag).toContain('target="_blank"');
		}
		expect(home).not.toContain("<iframe");
	});
});
