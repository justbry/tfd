import type {
	DetailStep,
	Disclosure,
	DisclosureChange,
	DisclosureDelay,
	DisclosureGrain,
	DisclosureOverride,
} from "$contract/data/disclosure.ts";
import { kpiClasses, type RuledClass } from "$contract/data/disclosure.ts";
import type {
	ApiKey,
	ApiKeyKind,
	SchoolSettings,
	StripeConnection,
	ZeffyConnection,
} from "$contract/data/settings.ts";
import type {
	BookingRulesConfig,
	DisclosureConfig,
	DisclosureOverrideConfig,
	SettingsConfig,
} from "$worker-config/types.ts";
import { UiError } from "../../effect/ui-error.ts";
import { formatMoney } from "../books-shared/books-text.ts";
import type { PaneIconName } from "../pane-icons.ts";

/** What the Settings tab shows and writes that is not markup (the Preact package's settings.tsx and settings-books.tsx
 * keep these inside their components, which import Preact; test/s9-5/consistency.test.ts compares the constants with
 * theirs). The school's settings, booking rules and disclosure are three objects of the ledger's R2 config (S9-plan
 * section 3.1), each with its own ETag; a school with none stored yet starts from the Reader's. */

/** The school's money without decimals, as the mockup's `kusd0` writes it; minor units in. */
export const moneyOf =
	(currency: string | null) =>
	(minorUnits: number): string =>
		formatMoney(minorUnits, currency, true);

/** The `settings` object of a school with none stored: what the Reader says (the booking rules are their own object). */
export const settingsSeed = (settings: SchoolSettings): SettingsConfig => ({
	schemaVersion: 1,
	school: settings.school,
	basis: settings.basis,
	basisFrom: settings.basisFrom,
	stripe: settings.stripe,
	zeffy: settings.zeffy,
	keys: settings.keys,
});
export const rulesSeed = (settings: SchoolSettings): BookingRulesConfig => ({
	schemaVersion: 1,
	cancelCutoffHours: settings.bookingRules.cancelCutoffHours,
	noShow: settings.bookingRules.noShow,
	lateCancel: settings.bookingRules.lateCancel,
});
export const disclosureSeed = ({ override }: Disclosure): DisclosureConfig => ({
	schemaVersion: 1,
	override: override as DisclosureOverrideConfig,
});
/** The stored override as the contract's editor takes it (the same JSON: the config's keys are plain strings). */
export const overrideOf = (config: DisclosureConfig): DisclosureOverride =>
	config.override as DisclosureOverride;

/** Why a write control is off while the route previews another audience (the contract's wording). */
export const exitPreviewTitle = "Exit preview to act";

export const keyNames: Record<ApiKeyKind, string> = {
	pk: "publishable key",
	sk: "secret key",
	rd: "ledger read credential",
};
export const keyHints: Record<ApiKeyKind, string> = {
	pk: "For browsers, from your allowed origins. Reads public school data.",
	sk: "For servers only. A browser request with it is refused.",
	rd: "Read-only, limited to your school's folder.",
};
export const keyBadges: Record<ApiKeyKind, string> = {
	pk: "Publishable",
	sk: "Secret",
	rd: "Ledger read",
};
export const keyIcons: Record<ApiKeyKind, PaneIconName> = {
	pk: "key",
	sk: "key",
	rd: "db",
};
export const keyMenuLabels: Record<ApiKeyKind, string> = {
	pk: "Publishable key",
	sk: "Secret key",
	rd: "Ledger read credential",
};
export const keyKinds: ApiKeyKind[] = ["pk", "sk", "rd"];
export const copyFailedToast =
	"Could not copy: the browser blocked the clipboard. Select the text and copy it by hand.";

export const disclosureSavedToast =
	"Disclosure saved. Logged as books.disclosure_changed; applies from the next document build.";
export const detailChoices: DetailStep[] = [
	"total",
	"categories",
	"breakdown",
	"spread",
];
export const everyChoices: DisclosureGrain[] = ["year", "quarter", "month"];
export const afterChoices: DisclosureDelay[] = [
	"6 weeks",
	"3 months",
	"12 months",
	"24 months",
];
export const roundChoices = [1000, 10_000, 100_000, 1_000_000];
export const ruleClasses = kpiClasses.filter(
	(kpiClass): kpiClass is RuledClass => kpiClass !== "personal",
);
export const changeTable: Array<[string, string, string]> = [
	["Stricter", "Owner", "PIN open"],
	["More open for Member or Governance", "Owner", "PIN open"],
	[
		"More open for Public",
		"Owner",
		"PIN and the mailed-link step-up (it publishes); audited",
	],
	["Below the floor", "Nobody", "Refused"],
];
export const changeNotes: Record<Exclude<DisclosureChange, "none">, string> = {
	stricter:
		"This is stricter than today. Already-published documents for periods still inside their delay are withdrawn. It applies from the next document build.",
	open: "This makes the Member or Governance document more open. It applies from the next document build.",
	public_open:
		"This makes the Public document more open. After your PIN, a mailed link confirms it: it publishes your books. It applies from the next document build.",
};

export type SettingsAction =
	| "zeffy"
	| "ledger-read-credential"
	| "disclosure-public";

/** Gaps nothing in the HTTP build provides yet (the Preact HTTP Writer rejects these `not_available`): Zeffy's key, a
 * ledger read credential, and the mailed link that opening Public needs (no route sends it, so the change cannot be
 * confirmed). The controls say so before they are used; in the fixture build every one works. */
export const knownGaps = (httpBuild: boolean): readonly SettingsAction[] =>
	httpBuild
		? ["zeffy", "ledger-read-credential", "disclosure-public"]
		: ["disclosure-public"];

const gapReasons: Record<SettingsAction, string> = {
	zeffy: "Zeffy's key has no route on the ledger yet",
	"ledger-read-credential": "ledger read credentials have no route yet",
	"disclosure-public":
		"the mailed link that opening Public needs has no route yet",
};

/** The `not_available` error of an action, as the message table words it (Not available yet, it arrives in a later
 * release); the control that cannot work shows it. */
export const gapError = (action: SettingsAction): UiError =>
	new UiError({
		kind: "not_available",
		detail: { code: "not_available" },
		reason: `${action} is not available: ${gapReasons[action]}`,
		retryable: false,
	});

export type KeysView = {
	keys: ApiKey[];
	stripe: StripeConnection;
	zeffy: ZeffyConnection;
};

/** The keys and connections as the screen shows them: the stored object, then what this session has done through the
 * Writer since (a key made or revoked, a Stripe or Zeffy key saved or removed), each applied only once the Writer
 * answered. */
export const withSessionChanges = (
	stored: Pick<SettingsConfig, "keys" | "stripe" | "zeffy">,
	session: {
		added: ApiKey[];
		revoked: string[];
		stripe: StripeConnection | null;
		zeffy: ZeffyConnection | null;
	},
): KeysView => ({
	keys: [
		...stored.keys.filter(({ id }) => !session.revoked.includes(id)),
		...session.added,
	],
	stripe: session.stripe ?? stored.stripe,
	zeffy: session.zeffy ?? stored.zeffy,
});
