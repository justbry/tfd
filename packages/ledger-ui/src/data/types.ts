/** The clock the UI runs on (protocol §3): the UI never reads the system time. `today` is `YYYY-MM-DD`, `now` is
 * `YYYY-MM-DDTHH:MM`. */
export type Clock = { today: string; now: string };

/** A school the session may open, as the switcher and the tabs row show it. */
export type School = {
	id: string;
	name: string;
	/** IANA time zone, e.g. `America/Denver`. */
	timeZone: string;
	/** ISO 4217 code, e.g. `USD`. Null when nothing gives the school one (no published menu and no Stripe account,
	 * S8-contract section 11): it has no money to show, so every money figure reads "—", never `$0.00`. */
	currency: string | null;
	role: "owner" | "admin";
	/** What the school calls a held credit (mockup `unit`): "1 session held", "2 sessions held". */
	creditUnit: { one: string; other: string };
	/** The month the Dashboard opens on (the mockup opens its fixture school on Jun); without it, the clock's month.
	 * Either snaps to a period the viewed audience may pick. */
	dashboardOpensOn?: string;
	/** The ledger shipper is behind; `lagMinutes` says by how much. */
	stale: boolean;
	/** Null when the school has no ledger views yet (nothing has shipped): it is listed all the same. */
	lagMinutes: number | null;
	/** Members that need attention; null when no source counts them (the HTTP build): no badge, never 0. */
	attentionCount: number | null;
	/** A demo school (staging's golden scenarios, S8-contract section 11 "Demo schools"): fictional, read-only, listed
	 * after the person's own schools under "Demo". */
	demo: boolean;
	/** Null when no source has them (the HTTP build): the tabs show no badge. */
	tabBadges: {
		/** The plans have unpublished changes. */
		plansDraft: boolean;
		bookingsOverdue: number;
		promosExpiring: number;
	} | null;
};

/** A fixture scenario the Dashboard's switcher offers (mockup `KFIX`): an atm preset, its label and, where the mockup
 * has one, the caveat shown above the cards. */
export type Preset = { id: string; label: string; note?: string };

/** What the Dashboard may ask the Reader for: the presets of the fixture schools, in switcher order. The audiences
 * come from the disclosure (`disclosure.ts`), and each cell carries its own text. Real data has none: an empty list,
 * and the Dashboard shows no scenario control. */
export type DashboardOptions = {
	presets: Preset[];
};
