/**
 * The shapes of the school's config objects (`schools/<id>/config/<name>.json`), mirroring the ledger UI's TypeScript
 * types (`packages/ledger-ui/src/data/settings.ts`, `disclosure.ts`, `plans.ts`, `ledger.ts`). They are copied, not
 * imported: the Worker does not depend on the UI package. `tests/config-parity.test.ts` keeps the value lists equal to
 * the UI's.
 */

export const SCHEMA_VERSION = 1;

export const CONFIG_NAMES = [
	"settings",
	"disclosure",
	"booking-rules",
	"plans-draft",
	"promos",
] as const;
export type ConfigName = (typeof CONFIG_NAMES)[number];

/** A problem with a value: where (`promos[0].value`), what is wrong, and what to do about it. */
export type Problem = { path: string; message: string; hint: string };

export type AccountingBasis = "cash" | "deferred";
export type StripeConnection =
	| {
			connected: true;
			account: string;
			mode: "live";
			last4: string;
			missing: string[];
	  }
	| { connected: false };
export type ZeffyConnection =
	| { connected: true; last4: string }
	| { connected: false };
export type ApiKeyKind = "pk" | "sk" | "rd";
export type ApiKey = {
	id: string;
	kind: ApiKeyKind;
	label: string;
	prefix: string;
	used: string;
};

/** `config/settings.json`: what the Settings drawer shows. The booking rules are their own object. */
export type SettingsConfig = {
	schemaVersion: 1;
	school: string;
	basis: AccountingBasis;
	basisFrom: string;
	stripe: StripeConnection;
	zeffy: ZeffyConnection;
	keys: ApiKey[];
};

export type KpiClass =
	| "income"
	| "losses"
	| "cash"
	| "people"
	| "activity"
	| "personal";
export type DisclosureRule = {
	detail: string;
	every: string;
	after?: string;
};
export type RoundingOverride = { public?: number; member?: number };
export type DisclosureOverrideConfig = {
	moves?: Record<string, KpiClass>;
	rules?: Record<string, DisclosureRule | null>;
	rounding?: { small?: RoundingOverride; large?: RoundingOverride };
};
/** `config/disclosure.json`: the school's stored differences from the B4 Uni disclosure file. */
export type DisclosureConfig = {
	schemaVersion: 1;
	override: DisclosureOverrideConfig;
};

/** `config/booking-rules.json`: the school's rules in force (Reports' "Rules in force"). */
export type BookingRulesConfig = {
	schemaVersion: 1;
	cancelCutoffHours: number;
	noShow: "spend" | "release";
	lateCancel: "spend" | "release";
};

export type PlanFeature = {
	id: string;
	name: string;
	unit: { one: string; other: string };
};
export type PlanTierCopy = {
	id: string;
	name: string;
	blurb: string;
	public: boolean;
	audience?: "member" | "governance" | "public";
};
/** `config/plans-draft.json`: the Plans tab's draft copy and tier order. No prices, no counts. */
export type PlansDraftConfig = {
	schemaVersion: 1;
	/** The unpublished version the copy belongs to; null when it is the live menu's. */
	draftVersion: number | null;
	features: PlanFeature[];
	tierOrder: string[];
	tiers: PlanTierCopy[];
	purchaseLinkShared: boolean;
};

export type PromoConfig = {
	id: string;
	code: string;
	type: "member" | "dollar" | "session";
	value: number;
	used: number;
	maxUses: number | null;
	expiresOn: string;
	status: "active" | "disabled" | "redeemed";
};
/** `config/promos.json`: a display mirror of the school's promo codes (buzz-school stays the source). Money-bearing. */
export type PromosConfig = { schemaVersion: 1; promos: PromoConfig[] };

export type ConfigValues = {
	settings: SettingsConfig;
	disclosure: DisclosureConfig;
	"booking-rules": BookingRulesConfig;
	"plans-draft": PlansDraftConfig;
	promos: PromosConfig;
};

export type ManifestEntry = {
	sha256: string;
	bytes: number;
	updatedAt: string;
	updatedBy: string;
};
/** `config/manifest.json`: the hash, size and last writer of each object. */
export type ConfigManifest = {
	schemaVersion: 1;
	objects: Partial<Record<ConfigName, ManifestEntry>>;
};
