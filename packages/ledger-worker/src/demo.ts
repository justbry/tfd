/**
 * Demo schools (owner decision 2026-11-08): on staging, anyone may read the golden school scenarios, signed in or not.
 * A school id is a demo school when it matches `demo-<preset>` and the environment sets `LEDGER_DEMO_SCHOOLS=on`
 * (`wrangler.jsonc` staging only; production has no env and never gets it). Real school ids are UUIDs, so the prefix
 * cannot meet one. A demo school's data is fictional: every caller reads it as its owner with the finance grant, and
 * nothing writes to it.
 */
import type { SchoolGrant } from "./auth/claims.js";
import type { Store } from "./data/store-io.js";
import { textOf } from "./data/store-io.js";
import type { LedgerEnv } from "./env.js";

export const DEMO_SCHOOL = /^demo-[a-z0-9-]+$/;
export const DEMO_PREFIX = "demo-";
/** What every caller holds on a demo school. */
export const DEMO_GRANT: SchoolGrant = { role: "owner", finance: true };

export const demoSchoolsOn = (env: Pick<LedgerEnv, "LEDGER_DEMO_SCHOOLS">) =>
	env.LEDGER_DEMO_SCHOOLS === "on";

export const isDemoSchool = (
	school: string,
	env: Pick<LedgerEnv, "LEDGER_DEMO_SCHOOLS">,
): boolean => demoSchoolsOn(env) && DEMO_SCHOOL.test(school);

/** The display facts `GET /v1/schools` lists for a demo school: buzz-school has none for it. */
export type DemoFacts = {
	name: string;
	timeZone: string;
	/** ISO 4217, upper case. */
	currency: string;
	creditUnit: { one: string; other: string };
};

/** Where the seed leaves a demo school's facts, worked out from its preset's latest `catalog.published`. */
export const demoFactsKey = (school: string): string =>
	`schools/${school}/demo.json`;

const FALLBACK_TIME_ZONE = "America/Denver";
const FALLBACK_CURRENCY = "USD";
const FALLBACK_UNIT = { one: "credit", other: "credits" };
const HYPHENS = /-/g;

/** The words of each school preset's name, where the preset's id does not read well as it is. */
const PRESET_LABELS: Record<string, string> = {
	"growth-12mo": "Growth over 12 months",
	"non-usd": "Non-USD",
};

/** `demo-monthly-members` reads "Demo · Monthly members". */
export const demoNameOf = (school: string): string => {
	const preset = school.slice(DEMO_PREFIX.length);
	const words = PRESET_LABELS[preset] ?? preset.replace(HYPHENS, " ");
	return `Demo · ${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
};

const isText = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0;

/** The local date (`YYYY-MM-DD`) of the school's latest booking: its Bookings tab opens on that week when it lies
 * before the current one (`demo/demo-api-store.ts`). */
export type DemoBookingsFact = { bookingsOpenOn: string | null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The school's stored facts, each one the seed left out or garbled replaced by a plain label. */
export const readDemoFacts = async (
	store: Store,
	school: string,
): Promise<DemoFacts & DemoBookingsFact> => {
	let stored: Record<string, unknown> = {};
	try {
		const text = await textOf(store, demoFactsKey(school));
		const body: unknown = text === null ? null : JSON.parse(text);
		if (typeof body === "object" && body !== null)
			stored = body as Record<string, unknown>;
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
	}
	const unit = stored.creditUnit as Record<string, unknown> | undefined;
	return {
		name: isText(stored.name) ? stored.name : demoNameOf(school),
		timeZone: isText(stored.timeZone) ? stored.timeZone : FALLBACK_TIME_ZONE,
		currency: isText(stored.currency)
			? stored.currency.toUpperCase()
			: FALLBACK_CURRENCY,
		creditUnit:
			isText(unit?.one) && isText(unit.other)
				? { one: unit.one, other: unit.other }
				: FALLBACK_UNIT,
		bookingsOpenOn:
			typeof stored.bookingsOpenOn === "string" &&
			DAY.test(stored.bookingsOpenOn)
				? stored.bookingsOpenOn
				: null,
	};
};
