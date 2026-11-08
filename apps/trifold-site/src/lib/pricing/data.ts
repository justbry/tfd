/**
 * Planned prices, from docs/business/pricing-strategy.md (the owner's plan decisions of 2026-11-07: Free at about 300
 * events, Starter as the wedge plan, Witnessed renamed Audited). Proposals, not offers. CTAs follow the site's rule:
 * nothing says "Start free" for the hosted product, which isn't open yet.
 *
 * The plans themselves (which ones, their names and order, prices, events and credits) come from Trifold's tfd catalog,
 * catalog/trifold/ at the repo root; this module adds the marketing copy. Change a price or a limit there, not here.
 */
import { CLI_URL } from "#lib/config";
import {
	TRIFOLD_ANNUAL_MONTHS,
	TRIFOLD_PLANS,
	type TrifoldPlan,
	trifoldPlan,
} from "../../../../../catalog/trifold/index.ts";

export const ANNUAL_MONTHS_CHARGED = TRIFOLD_ANNUAL_MONTHS;
export const EVENTS_PER_FAMILY = 7;
/** Credits a countersigned receipt costs (the CREDITS table and the non-profit FAQ). */
export const COUNTERSIGNED_RECEIPT_CREDITS = 3;

const count = (value: number) => value.toLocaleString("en-US");

export type Org = "std" | "np";
export type Feature =
	| string
	| { text: string; soon?: boolean; np?: boolean; plus?: boolean };

/** A plan's marketing copy: what the catalog does not say. */
type PlanCopy = {
	tagline: string;
	/** What the card shows instead of events, credits and seats (those live in the matrix only). */
	families: string;
	cta: { label: string; href: string; external?: boolean };
	badge?: string;
	featured?: boolean;
	witness?: boolean;
	features: Feature[];
};

export type Plan = PlanCopy & {
	id: string;
	name: string;
	/** Dollars a month. */
	price: Record<Org, number>;
	/** Ledger events a month. */
	events: number;
	/** Credits a month. */
	credits: number;
};

const EARLY = { label: "Get early access", href: "/early-access" };

const PLAN_COPY: Record<string, PlanCopy> = {
	free: {
		tagline: "Hosted books for small organizations getting started.",
		families: "About 40 families",
		cta: EARLY,
		features: [
			"Books built from your Stripe events",
			"Signed receipts on every plan, even Free",
			"Sealed months",
			"Reports and on-demand reconcile",
			{ text: "1 Pricing Lab forecast a month", soon: true },
			{
				text: "Countersigned receipts free for non-profits under $50K a year",
				np: true,
				plus: true,
				soon: true,
			},
		],
	},
	starter: {
		tagline: "The plan for small schools: hosted books and signed receipts.",
		badge: "Recommended",
		featured: true,
		families: "About 700 families",
		cta: EARLY,
		features: [
			"Everything in Free",
			{
				text: "Compliance pack for state program receipts (add-on)",
				soon: true,
			},
			{ text: "QuickBooks or Xero sync", soon: true },
			"Email support",
			"Free seats for your CPA",
		],
	},
	pro: {
		tagline: "Your month closes on a schedule. On sale once its features ship.",
		families: "About 3,500 families",
		cta: EARLY,
		features: [
			"Everything in Starter",
			"Up to 3 organizations",
			{ text: "Pricing Lab: forecasts and saved scenarios", soon: true },
			{ text: "Daily reconcile with alerts", soon: true },
			{ text: "Scheduled monthly close", soon: true },
			"Roles, approvals and Google sign-in",
			{ text: "Bank-statement import (CSV/OFX)", soon: true },
			{
				text: "Rifo drafts. You approve. The engine does the math.",
				soon: true,
			},
			{ text: 'Public "open books" page', np: true, soon: true },
		],
	},
	audited: {
		tagline:
			"Audit-ready books an auditor, grantor or state program can check.",
		badge: "Early access",
		witness: true,
		families: "About 3,500 families",
		cta: EARLY,
		features: [
			"Everything in Pro",
			{
				text: 'Trifold countersigns every receipt and seal ("Witnessed by Trifold")',
				soon: true,
				plus: true,
			},
			{ text: "Auditor portal", soon: true, plus: true },
			{ text: "Compliance pack included", soon: true, plus: true },
			{ text: "Daily matching to Stripe payouts", soon: true, plus: true },
			{ text: "Public transparency log", soon: true, plus: true },
			"Priority support",
			{ text: "Donation receipts use no credits", np: true, plus: true },
			{ text: "Unlimited board and member seats", np: true, plus: true },
		],
	},
};

const planOf = (catalog: TrifoldPlan): Plan => {
	const copy = PLAN_COPY[catalog.id];
	if (!copy)
		throw new Error(`No pricing copy for the catalog's plan ${catalog.id}`);
	return {
		id: catalog.id,
		name: catalog.name,
		price: catalog.monthly,
		events: catalog.events,
		credits: catalog.credits,
		...copy,
	};
};

export const PLANS: Plan[] = TRIFOLD_PLANS.map(planOf);
const FREE = planOf(trifoldPlan("free"));

export const SIDE_PLANS = [
	{
		id: "community",
		name: "Community · self-hosted",
		body: "The tfd engine and its CLI on your own machine: receipts, seals, reconcile, simulate. The source is public on GitHub and free to self-host (FSL-1.1-ALv2).",
		cta: { label: "Install the CLI", href: CLI_URL, external: true },
	},
	{
		id: "platform",
		name: "Platform",
		body: "For school networks, fiscal sponsors, federations and software vendors. Rollups across organizations, SSO, SLA, white-label verify.",
		cta: {
			label: "Talk to us",
			href: "/early-access?role=network",
			external: false,
		},
	},
];

export const ADDONS: {
	name: string;
	price: Record<Org, string>;
	body: string;
	npOnly?: boolean;
}[] = [
	{
		name: "Audited + Bookkeeper",
		price: { std: "~$349/mo", np: "~$249/mo" },
		body: "A partner bookkeeper closes your month on audited books. Less than most bookkeeping services alone.",
	},
	{
		name: "Compliance pack",
		price: { std: "$15–30/mo per program", np: "$15–30/mo per program" },
		body: "Not built yet (Next). Itemised receipts for one education savings or tax-credit program, with who paid, per child, kept current as the rules change. Included in Audited.",
	},
	{
		name: "Non-profit pack",
		price: { std: "$15–25/mo", np: "$15–25/mo" },
		npOnly: true,
		body: "Signed donation acknowledgments, restricted funds, grant reports, and a Form 990 package for your CPA.",
	},
	{
		name: "Co-op pack",
		price: { std: "$15–25/mo", np: "$15–25/mo" },
		npOnly: true,
		body: "Member capital accounts, patronage allocation, and 1099-PATR export.",
	},
	{
		name: "Credit top-ups",
		price: { std: "$10 = 1,000 credits", np: "$10 = 1,000 credits" },
		body: "For heavy Rifo use or a busy month of countersigned receipts. Opt-in only.",
	},
	{
		name: "Witness API",
		price: {
			std: "500/mo free, then $0.03–0.05",
			np: "500/mo free, then $0.03–0.05",
		},
		body: "Just the witness, for platforms and other software that issue their own receipts, under the Platform agreement. Not sold to a single organization in place of Audited.",
	},
];

export type Cell =
	| boolean
	| string
	| { value: boolean | string; soon: true }
	| { std: Cell; np: Cell };
const SOFT_LIMIT = "Soft limit: books keep running; we'll suggest an upgrade";
const S = (value: boolean | string): Cell => ({ value, soon: true });
const N = (std: Cell, np: Cell): Cell => ({ std, np });

export const COLUMNS: {
	id: string;
	name: string;
	price?: Record<Org, number>;
	self?: boolean;
	custom?: boolean;
}[] = [
	{ id: "community", name: "Community", self: true },
	...PLANS.map((plan) => ({ id: plan.id, name: plan.name, price: plan.price })),
	{ id: "platform", name: "Platform", custom: true },
];

export const MATRIX: [string, [string, string, Cell[]][]][] = [
	[
		"Limits",
		[
			[
				"Ledger events a month",
				"",
				["Unlimited", ...PLANS.map((plan) => count(plan.events)), "Custom"],
			],
			[
				"Roughly how many families",
				"At about 7 events each",
				["Any", "~40", "~700", "~3,500", "~3,500", "Any"],
			],
			[
				"Credits a month",
				"For Rifo and witness signatures",
				["—", ...PLANS.map((plan) => count(plan.credits)), "Pooled"],
			],
			[
				"Seats",
				"CPA and auditor seats never count",
				["Yours", "2", "5", "Unlimited", "Unlimited", "Unlimited"],
			],
			[
				"Storage and compute",
				"",
				[
					"Your own",
					"Included",
					"Included",
					"Included",
					"Included",
					"Included",
				],
			],
			[
				"Over the event limit",
				"No metered overage",
				["—", SOFT_LIMIT, SOFT_LIMIT, SOFT_LIMIT, SOFT_LIMIT, "~$1 / 10K"],
			],
		],
	],
	[
		"Books",
		[
			[
				"Billing engine",
				"Credits, plans, bookings, codes, memberships",
				[true, true, true, true, true, true],
			],
			[
				"Books built from Stripe events",
				"Event log and journal",
				[true, true, true, true, true, true],
			],
			["Financial reports", "", [true, true, true, true, true, true]],
			[
				"Hosted, backed-up books",
				"",
				[false, true, true, true, true, "+ data residency"],
			],
			[
				"Scheduled monthly close",
				"",
				[false, false, false, S(true), S(true), S(true)],
			],
			[
				"Month-end package for your CPA",
				"",
				["CLI", false, false, true, true, true],
			],
			[
				"Consolidation across organizations",
				"",
				[false, false, false, false, false, true],
			],
		],
	],
	[
		"Receipts and seals",
		[
			[
				"Signed receipt for every payment",
				"",
				[
					"Self-signed",
					"Self-signed",
					"Self-signed",
					"Self-signed",
					S("Countersigned"),
					S("Countersigned"),
				],
			],
			[
				"Sealed months",
				"",
				[
					"Self-signed",
					"Self-signed",
					"Self-signed",
					"Self-signed",
					S("Countersigned"),
					S("Countersigned"),
				],
			],
			["Anyone can verify, free", "", [true, true, true, true, true, true]],
			[
				"Itemised receipts for state programs",
				"The compliance pack: who paid, per child",
				[false, false, S("Pack"), S("Pack"), S(true), S(true)],
			],
			[
				"Trifold as independent witness",
				"",
				[false, N(false, S("Under $50K")), false, false, S(true), S(true)],
			],
			[
				"Public transparency log",
				"",
				[false, false, false, false, S(true), S(true)],
			],
			[
				"Per-event hash chain",
				"",
				[false, false, false, false, S(true), S(true)],
			],
			["Auditor portal", "", [false, false, false, false, S(true), S(true)]],
			[
				"White-label verify page",
				"",
				[false, false, false, false, false, true],
			],
		],
	],
	[
		"Reconcile",
		[
			["Stripe reconcile on demand", "", [true, true, true, true, true, true]],
			[
				"Daily automatic reconcile with alerts",
				"",
				[false, false, false, S(true), S(true), S(true)],
			],
			[
				"Daily matching to Stripe payouts",
				"Recorded in the countersigned record",
				[false, false, false, false, S(true), S(true)],
			],
		],
	],
	[
		"Pricing Lab",
		[
			[
				"Replay the past under new prices",
				"",
				["CLI", true, true, true, true, true],
			],
			[
				"Forecast revenue under new prices",
				"",
				[false, S("1 a month"), S("1 a month"), S(true), S(true), S(true)],
			],
			[
				"Saved, shareable scenarios",
				"Side by side, for an owner or board",
				[false, false, false, S(true), S(true), S(true)],
			],
			[
				"Hosted CI check and staged rollouts",
				"",
				[false, false, false, S(true), S(true), S(true)],
			],
			[
				"Network-wide pricing tests",
				"",
				[false, false, false, false, false, true],
			],
		],
	],
	[
		"Rifo AI",
		[
			[
				"Ask Rifo about your books",
				"Uses credits",
				[false, S("Small quota"), S(true), S(true), S(true), S(true)],
			],
			[
				"Rifo closes your month",
				"Uses credits",
				[false, false, false, S(true), S(true), S(true)],
			],
			[
				"Custom agents and API",
				"",
				[false, false, false, false, false, S(true)],
			],
		],
	],
	[
		"Team and access",
		[
			[
				"Ledger web app",
				"",
				["Read-only viewer", true, true, true, true, true],
			],
			[
				"Free CPA and bookkeeper seats",
				"",
				[false, true, true, true, true, true],
			],
			["Roles and approvals", "", [false, false, false, true, true, true]],
			["Google sign-in", "", [false, false, false, true, true, true]],
			["Auditor role", "", [false, false, false, false, S(true), S(true)]],
			[
				"SAML single sign-on and audit log",
				"",
				[false, false, false, false, false, true],
			],
		],
	],
	[
		"Integrations",
		[
			["CSV and hledger export", "", [true, true, true, true, true, true]],
			[
				"QuickBooks or Xero sync",
				"",
				[false, false, S(true), S(true), S(true), S(true)],
			],
			[
				"Witness API",
				"For platforms and issuers",
				[false, false, false, false, S("Included"), S("Included")],
			],
		],
	],
	[
		"Non-profits and co-ops",
		[
			[
				"Signed donation acknowledgments",
				"Written to IRS acknowledgment rules",
				[
					false,
					N(false, S("Under $50K")),
					S("Pack"),
					S("Pack"),
					N(S("Pack"), S("Included, 0 credits")),
					S(true),
				],
			],
			[
				"Restricted funds and grant reports",
				"",
				[false, false, S("Pack"), S("Pack"), S("Pack"), S(true)],
			],
			[
				"Form 990 package for your CPA",
				"",
				[false, false, false, S("Pack"), S("Pack"), S(true)],
			],
			[
				"Member capital accounts and patronage",
				"",
				[
					false,
					false,
					S("Co-op pack"),
					S("Co-op pack"),
					S("Co-op pack"),
					S(true),
				],
			],
			[
				"1099-PATR export",
				"",
				[
					false,
					false,
					S("Co-op pack"),
					S("Co-op pack"),
					S("Co-op pack"),
					S(true),
				],
			],
			[
				'Public "open books" page',
				"",
				[false, false, false, S(true), S(true), S(true)],
			],
			[
				"Unlimited board and member viewer seats",
				"",
				[false, false, false, N(false, true), true, true],
			],
		],
	],
	[
		"Support",
		[
			["Community forum and GitHub", "", [true, true, true, true, true, true]],
			["Email support", "", [false, false, true, true, true, true]],
			["Priority support", "", [false, false, false, false, true, true]],
			["Uptime SLA", "", [false, false, false, false, false, true]],
		],
	],
	[
		"Never paywalled",
		[
			["Verify receipts and seals", "", [true, true, true, true, true, true]],
			["Export all your data", "", [true, true, true, true, true, true]],
			["Erasure and privacy tools", "", [true, true, true, true, true, true]],
			["Security fixes", "", [true, true, true, true, true, true]],
		],
	],
];

export const CREDITS: [string, string, string][] = [
	["Ask Rifo a question", "2–10", "Passes on the AI cost"],
	[
		"Rifo closes your month",
		"500–1,500",
		"Categorize, reconcile, write the summary",
	],
	["Pricing Lab forecast", "25", "Replays a year of events under new prices"],
	[
		'Countersigned receipt ("Witnessed by Trifold")',
		String(COUNTERSIGNED_RECEIPT_CREDITS),
		"Kept cheap on purpose: one per payment",
	],
	["Countersigned month seal", "25", "Once a month"],
	[
		"Donation acknowledgment (verified non-profits)",
		"0",
		"Every donor's receipt carries a verify link",
	],
	[
		"Self-signed receipt or seal, verifying, CLI simulate",
		"0, always",
		"Free for everyone",
	],
];

export const PROMISE =
	"No per-seat fees. No per-transaction fees. No surprise bills.";

export const NEVER: [string, string][] = [
	[
		"Verify anything",
		"Families, CPAs and auditors check receipts and seals for free.",
	],
	["Export everything", "Your books are yours, in open formats."],
	["Erasure & privacy", "Delete personal data without breaking your books."],
	["Security fixes", "For every plan and every self-hosted install."],
	["Open formats", "The receipt and seal formats are open to anyone."],
];

export const PRICING_FAQ = [
	{
		q: "Are these prices final?",
		a: "No. They are planned prices, published so you can see where we're headed, and they may change before launch. Design partners pay nothing during the pilot.",
	},
	{
		q: "What's a ledger event?",
		a: `One thing that happened to your money: a payment, a refund, a credit used, a booking. A typical family or member makes about ${EVENTS_PER_FAMILY} a month, so Free's ${count(FREE.events)} events cover ${FREE.families.toLowerCase()}. Most organizations upgrade for features, not limits.`,
	},
	{
		q: "What happens if I go over my limit?",
		a: "Nothing stops and nothing is billed. Event limits are soft on Free, Starter, Pro and Audited: your books keep running, and if you stay over for two months we'll suggest a plan that fits. There is no metered overage. Only Platform pays per event, about $1 per 10,000.",
	},
	{
		q: "Can I get a refund?",
		a: "Yes. A full refund within 30 days of your first paid charge.",
	},
	{
		q: "How do I cancel?",
		a: "Two clicks in settings. No retention call, no email chain.",
	},
	{
		q: "Can I change plans?",
		a: "Any time. Upgrades are prorated to the day; downgrades credit your next invoice.",
	},
	{
		q: "Is onboarding extra?",
		a: "No. Onboarding is included on every paid plan, with no setup fee.",
	},
	{
		q: "What happens to my data if I cancel?",
		a: "Export everything in open formats, before and after cancelling. Export is never behind a paywall.",
	},
	{
		q: "Who qualifies for non-profit & co-op pricing?",
		a: `US 501(c) organizations (we check your IRS determination letter or EIN), and cooperatives (we check your articles or bylaws). Non-profits with gross receipts of $50,000 or less get Trifold's witness free on the Free plan, up to about ${count(Math.floor(FREE.credits / COUNTERSIGNED_RECEIPT_CREDITS))} countersigned receipts a month (Free's ${count(FREE.credits)} credits at ${COUNTERSIGNED_RECEIPT_CREDITS} each), once the witness ships.`,
	},
	{
		q: "Do the annual and non-profit discounts stack?",
		a: "Yes. Annual billing is ten months' price for twelve months, applied to whichever price you qualify for.",
	},
	{
		q: "Does the Audited plan mean my books are audited?",
		a: "No. Audited is the plan for audit-ready books; it isn't an audit and doesn't replace your auditor. Once the witness ships, Trifold will countersign each receipt and monthly seal (\"Witnessed by Trifold\") and log it publicly, which proves Trifold saw that exact record at that time and that nobody changed it afterwards. The countersignature doesn't prove the money moved or that the books are complete. With the auditor portal, the compliance pack and daily Stripe matching, it makes your auditor's job easier, not unnecessary.",
	},
	{
		q: "I'm an accountant. What do I pay?",
		a: "Nothing for your own seats: a firm's seats are free on every client's books. Planned: clients a firm brings get 20% off their first year. Trifold pays no referral fees to tax preparers.",
	},
	{
		q: "Can I run it myself?",
		a: "The engine's source and its CLI are public on GitHub, including receipts, seals, reconcile and simulate. The license is the Functional Source License: free to use and change for your own books, but not to sell as a competing service. Every release becomes Apache-2.0 two years after it ships. The verifier and receipt format are Apache-2.0.",
	},
	{
		q: "Does Trifold file my taxes?",
		a: "No. Trifold keeps books that show their work and prepares the records your CPA or enrolled agent needs. Partner bookkeepers can close the month for you.",
	},
];
