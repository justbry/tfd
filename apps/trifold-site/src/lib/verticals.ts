/**
 * The demo verticals: one demo org per kind of organization, run through the same engine and the same three-way KPI
 * check (the engine's fold, hledger, DuckDB). Every org is synthetic: invented names, prices and ids, never a customer.
 * Source: packages/atm/docs/scenario-orgs.md (SCENARIO_ORGS_URL).
 *
 * All five have a demo dashboard: a static page per org under /demo/orgs/ (`dashboard`), copied byte for byte from
 * plans/ledger-ui/design/mart/orgs/ by scripts/sync-org-demos.ts. The school also has a live demo (DEMO_URL): the real
 * app, on staging. Preset numbers are copied from verified runs on atm dev; tests/proof.test.ts checks them against
 * that run and against every page and llms.txt that shows them, and tests/org-demos.test.ts checks each preset's KPI
 * hash against its dashboard page. Copy rules: describe only what the generator models (no win-back, pledges, refund
 * windows or failed payments) and use only KPIs the engine computes (MRR and its movements, but no ARR, no logo churn and
 * no retention).
 */
import { DEMO_URL, GITHUB_URL } from "#lib/config";

export const SCENARIO_ORGS_URL = `${GITHUB_URL}/blob/dev/packages/atm/docs/scenario-orgs.md`;

/** The demo orgs' dashboards, one static page each, and their gallery (static/demo/orgs/). */
export type DemoOrg = "school" | "studio" | "church" | "saas" | "creator";
export const dashboardPath = (org: DemoOrg) => `/demo/orgs/${org}.html`;
export const DASHBOARDS_GALLERY = "/demo/orgs/index.html";

/** One verified preset run. `hash` is the KPI hash, first eight and last four characters. */
export type Preset = {
	name: string;
	seed: number;
	months: string;
	/** new_paying_members */
	members: number;
	/** payments_count */
	invoices: number;
	refunds: number;
	disputes: number;
	/** gross_collected, as the CLI prints it in dollars. */
	grossCollected: string;
	/** paying_members_last_month */
	payingLastMonth: number;
	/** Why paying_members_last_month reads as it does, when it needs saying. */
	payingNote?: string;
	/** mrr in the last month, in dollars as the KPI table holds it (cents dropped when zero). */
	mrr: string;
	hash: string;
	what: string;
};

export type StatKey = "grossCollected" | "members" | "payingLastMonth" | "mrr";
/** A headline number's label and the engine's KPI name, shown beside it in mono. */
export const STATS: Record<StatKey, { label: string; kpi: string }> = {
	grossCollected: { label: "Gross collected", kpi: "gross_collected" },
	members: { label: "New paying members", kpi: "new_paying_members" },
	payingLastMonth: {
		label: "Paying members last month",
		kpi: "paying_members_last_month",
	},
	mrr: { label: "MRR last month", kpi: "mrr" },
};
export const STAT_KEYS: StatKey[] = [
	"grossCollected",
	"members",
	"payingLastMonth",
	"mrr",
];

/**
 * What MRR does and doesn't cover, said wherever MRR is described. The engine records each subscription's recurring
 * price from Stripe, and the engine, hledger and DuckDB each compute MRR from the books.
 */
export const MRR_LIMITS =
	"There's no ARR yet and no logo churn yet. For a full invoice, the billing interval comes from the billing handler's published price list, because this Stripe API version gives invoice lines only a price id.";

/** The KPIs every simulated preset produces (the engine's own list; nothing else is claimed). */
export const SIMULATED_KPIS = [
	"Gross collected",
	"Net income",
	"Refunds",
	"Disputes",
	"Stripe fees",
	"Payouts",
	"Payments",
	"New paying members",
	"Paying members last month",
	"MRR",
	"New, expansion, contraction and churned MRR",
	"Net new MRR",
	"Credits granted, consumed and expired",
];

export type Vertical = {
	slug: string;
	name: string;
	/** The demo org's invented name. */
	org: string;
	/** "a simulated studio": how the org is introduced after its name. */
	orgKind: string;
	/** The organization's own words, in the order a reader meets them. */
	vocabulary: string[];
	/** What the scenario models, honestly. */
	simulates: string[];
	/** The school: what its live demo shows. The others: SIMULATED_KPIS, in the org's words where they differ. */
	kpis: string[];
	/** Every vertical has a demo dashboard (static, synthetic data). */
	status: "dashboard";
	/** Which page under /demo/orgs/ is this org's dashboard. */
	demoOrg: DemoOrg;
	/** The demo dashboard: dashboardPath(demoOrg). */
	dashboard: string;
	/** The live demo, the real app on synthetic data: the school only. */
	demoUrl?: string;
	/** The audience page, when there is one. */
	forPage?: string;
	/** Verified preset runs; the first is the headline. */
	presets: Preset[];
	/** Labels in the org's own words, where a KPI's name doesn't fit (a church has givers and giving). */
	labels?: Partial<Record<StatKey, string>>;
};

export const VERTICALS: Vertical[] = [
	{
		slug: "schools",
		name: "Schools",
		org: "Honeycomb Hill Academy",
		orgKind: "a sample school",
		vocabulary: ["families", "tiers", "class credits", "yearly prepay"],
		simulates: [
			"Families on tiers",
			"Class credits",
			"Add-ons",
			"Yearly prepay",
			"Refunds",
			"Disputes",
		],
		kpis: ["Collected", "Net income", "Stripe fees", "Payouts"],
		status: "dashboard",
		demoOrg: "school",
		dashboard: dashboardPath("school"),
		demoUrl: DEMO_URL,
		forPage: "/for/schools",
		presets: [],
	},
	{
		slug: "studios",
		name: "Studios and gyms",
		org: "Ironbark Studio",
		orgKind: "a simulated studio",
		vocabulary: ["members", "memberships", "class packs", "drop-ins"],
		simulates: [
			"Four memberships: off-peak (4 classes a month), core (12, up to 4 carry over), class pack and all access",
			"About 1 in 7 pays annually",
			"Drop-ins, ten-class packs and PT intro sessions as add-ons",
			"Unused classes roll over or expire",
			"About 1 in 16 cancels each month",
		],
		kpis: SIMULATED_KPIS,
		status: "dashboard",
		demoOrg: "studio",
		dashboard: dashboardPath("studio"),
		forPage: "/for/studios",
		presets: [
			{
				name: "studio-members",
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
				what: "A year of memberships, add-ons and class credits.",
			},
			{
				name: "studio-class-packs",
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
				what: "Nine months of five-class packs, bought one or two at a time; unused classes roll over two months, then expire.",
			},
		],
	},
	{
		slug: "churches",
		name: "Churches",
		org: "Cedar Hill Community Church",
		orgKind: "a simulated church",
		vocabulary: ["givers", "giving", "gifts", "roof campaign"],
		simulates: [
			"Sixty households give $25, $50, $100 or $250 a month, or the same yearly",
			"About a quarter give yearly",
			"Some add a one-time gift, a roof-campaign gift or a retreat registration",
			"A few mistaken gifts refunded, often in part",
			"A nonprofit card rate: 2.2% + 30¢",
		],
		// The engine's KPIs in a church's words; each label's KPI name is shown beside its number.
		kpis: [
			"Giving collected",
			"Net income",
			"Refunds",
			"Disputes",
			"Stripe fees",
			"Payouts",
			"Payments",
			"New givers",
			"Givers giving last month",
			"Recurring giving (MRR)",
			"New, expansion, contraction and churned MRR",
			"Net new MRR",
			"Credits granted, consumed and expired",
		],
		status: "dashboard",
		demoOrg: "church",
		dashboard: dashboardPath("church"),
		forPage: "/for/churches",
		labels: {
			grossCollected: "Giving collected",
			members: "New givers",
			payingLastMonth: "Givers giving last month",
			mrr: "Recurring giving last month",
		},
		presets: [
			{
				name: "church-giving",
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
				what: "A year of giving at four fixed levels, monthly or yearly, with one-time and roof-campaign gifts.",
			},
		],
	},
	{
		slug: "saas",
		name: "SaaS and digital products",
		org: "Lumen Notes",
		orgKind: "a simulated SaaS product",
		vocabulary: ["seats", "plans", "proration", "usage credits"],
		simulates: [
			"Solo, team (3, 5 or 10 seats) and business (10, 25 or 50 seats), priced per seat",
			"About a third prepay annually",
			"Seats added mid-month, billed at once with proration; dropped at renewal",
			"Upgrades from solo to team to business",
			"API usage as credit blocks of 1,000 calls",
			"Boost packs and support add-ons",
		],
		kpis: SIMULATED_KPIS,
		status: "dashboard",
		demoOrg: "saas",
		dashboard: dashboardPath("saas"),
		forPage: "/for/saas",
		presets: [
			{
				name: "saas-seats",
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
				what: "A year of seat plans, seats added and dropped, upgrades and API credits.",
			},
			{
				name: "saas-annual",
				seed: 402,
				months: "2026-01..2027-12",
				members: 20,
				invoices: 38,
				refunds: 0,
				disputes: 0,
				grossCollected: "$52,993",
				payingLastMonth: 0,
				mrr: "$2,046.67",
				payingNote: "every plan is yearly, so nobody pays in a given month",
				hash: "e816e133…e4ee",
				what: "Everyone prepays a year, over 24 months so the renewals show.",
			},
		],
	},
	{
		slug: "creators",
		name: "Creators and online courses",
		org: "Night Kitchen Courses",
		orgKind: "a simulated course creator",
		vocabulary: ["members", "courses", "launch month", "cook-alongs"],
		simulates: [
			"90 members join the paid community in the launch month, then four a month",
			"Many buy a course (sourdough, knife skills) or the recipe pack at sign-up",
			"Members book live cook-alongs",
			"Refunds on about 7% of payments",
			"About 1 in 12 leaves each month",
		],
		kpis: SIMULATED_KPIS,
		status: "dashboard",
		demoOrg: "creator",
		dashboard: dashboardPath("creator"),
		forPage: "/for/creators",
		presets: [
			{
				name: "creator-launch",
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
				what: "A launch month, a steady trickle after it, course sales and refunds.",
			},
		],
	},
];

export const verticalBySlug = (slug: string): Vertical => {
	const vertical = VERTICALS.find((entry) => entry.slug === slug);
	if (!vertical) throw new Error(`No vertical "${slug}"`);
	return vertical;
};

/** A headline number as shown: the org's label, the KPI's name, and the value. */
export const statOf = (vertical: Vertical, preset: Preset, key: StatKey) => ({
	label: vertical.labels?.[key] ?? STATS[key].label,
	kpi: STATS[key].kpi,
	value:
		key === "grossCollected" || key === "mrr"
			? preset[key]
			: String(preset[key]),
});

/** A preset as a card shows it: its run and its three headline numbers in the org's words. */
export type PresetView = {
	name: string;
	seed: number;
	months: string;
	stats: ReturnType<typeof statOf>[];
};
export const presetView = (vertical: Vertical, preset: Preset): PresetView => ({
	name: preset.name,
	seed: preset.seed,
	months: preset.months,
	stats: STAT_KEYS.map((key) => statOf(vertical, preset, key)),
});

/**
 * The homepage gallery's cards: only what a compact card shows. vite.config.ts inlines them as __GALLERY__
 * (src/lib/gallery.ts), so the homepage doesn't ship this module.
 */
export type GalleryCard = Pick<
	Vertical,
	| "slug"
	| "name"
	| "org"
	| "orgKind"
	| "status"
	| "dashboard"
	| "demoUrl"
	| "forPage"
> & {
	vocabulary?: string[];
	simulates?: string[];
	kpis?: string[];
	preset?: PresetView;
};
export const galleryCards = (): GalleryCard[] =>
	VERTICALS.map((vertical) => {
		const {
			slug,
			name,
			org,
			orgKind,
			status,
			dashboard,
			demoUrl,
			forPage,
			vocabulary,
			simulates,
			kpis,
			presets,
		} = vertical;
		const [headline] = presets;
		return {
			slug,
			name,
			org,
			orgKind,
			status,
			dashboard,
			demoUrl,
			forPage,
			// The school's card describes its live demo; the others show their headline preset.
			...(demoUrl ? { vocabulary, simulates, kpis } : {}),
			...(headline ? { preset: presetView(vertical, headline) } : {}),
		};
	});

export const describeCommand = (preset: Preset) =>
	`bun ./src/bin.ts scenarios describe ${preset.name}`;

/** Where the simulations are the closest honest fit, not an exact one (scenario-orgs.md). */
export const SIMPLIFICATIONS = [
	"Everyone who pays is a member.",
	"A one-time purchase (a gift, a course, a drop-in) comes only with a member's first invoice, and each member has one add-on at most.",
	"Add-on money is booked to the member's tier, not a separate income line.",
	"Monthly and yearly church giving comes at four fixed amounts: no pledges, no custom amounts, no campaign goals.",
	"SaaS usage is counted in blocks of 1,000 calls.",
	"A launch spike is the founding month.",
	`MRR is computed three ways, like every KPI. ${MRR_LIMITS}`,
];
