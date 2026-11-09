/**
 * A member's credits from the event log: pure functions over `AtmEvent[]`, for a reader that has no database (the admin
 * UI in a Cloudflare Worker). Balances come from `replayEvents` and `balancesOf` (replay.ts), so they are the numbers the
 * engine counts; `used` and `plan` come from the events themselves.
 *
 * Never carries a name or an email: the output has holder keys, feature ids, plan ids, counts and instants, and the
 * events' personal fields (a payment's `billing_name`, `billing_email`) are not read.
 *
 * Not derivable from the events today, so not here: the quantity a member bought (a tier sold in quantities leaves only
 * the credits it granted), the renewal date of a subscription (a `plan.*` event carries no period end), and the start
 * time of a booking (the only time on a booking is `payload.command.lock.expiresAt` of its `credit.held`, the instant
 * the hold lapses).
 */
import type { SubjectState } from "@autumn/balance-engine";
import { menuCatalogRows } from "../billing/grants.js";
import type { Menu } from "../billing/types.js";
import type {
	AtmCatalogRow,
	AtmCatalogsByVersion,
	AtmEvent,
	AtmSubjectState,
} from "../types.js";
import { byEventId, byText } from "./order.js";
import {
	type CatalogInput,
	type CatalogSet,
	catalogSetOf,
	mutationRevision,
	ReplayError,
	ReplayGapError,
	replayEvents,
} from "./replay.js";
import { decimalToUnits, isoInstant } from "./util.js";

/** What one feature holds for one member, in the feature's own units. */
export type FeatureSummary = {
	/** Units a booking can take now: grants and rollovers not yet past their expiry at `asOf`. */
	available: number;
	/** Units open locks hold for bookings not yet settled. */
	held: number;
	/**
	 * Units the member has consumed for good: the net of the postings to `credits:spent:*` and `credits:forfeited` over the
	 * member's events for the feature. A `credit.spent` (a finalized booking) and a `credit.forfeited` (a hold that
	 * expired and confirmed, a no-show) add their units; a `credit.refunded` takes its units off again. Credits that lapsed
	 * (`credit.expired`) or were released back are not used. Counted over the events up to `asOf` (`eventsAsOf`).
	 */
	used: number;
	/** The earliest instant a row that still holds credits at `asOf` expires; null when none of them expires. */
	nextExpiryAt: string | null;
};

export type MemberSummary = {
	/** The envelope's `key`: the holder, e.g. `family:fam_8k2`. */
	key: string;
	/** `labels.plan` of the member's latest event that has one (`sparkle-2@v1`); null when none has, or the latest is a `plan.canceled`. */
	plan: string | null;
	features: Record<string, FeatureSummary>;
	/** `event_time` of the member's latest event (by id); null only for a key with no events. */
	lastEventAt: string | null;
};

/** The log cannot be replayed: nothing a caller can show for it, so the reason, as a value. */
export type SummaryProblem =
	| {
			kind: "replay-gap";
			eventId: string;
			subject: string;
			after: number;
			before: number;
			message: string;
	  }
	| { kind: "replay"; eventId: string; message: string }
	| { kind: "no-catalog"; message: string };

export type MembersResult =
	| { ok: true; asOf: string; members: Record<string, MemberSummary> }
	| { ok: false; error: SummaryProblem };

export type MemberResult =
	| { ok: true; asOf: string; summary: MemberSummary | null }
	| { ok: false; error: SummaryProblem };

export type SummaryOptions = {
	/**
	 * The catalog rows the log was written under (`menuCatalogRows`). Default: the menu of the latest `catalog.published`
	 * event in `events`, which is what a log that records its own settings holds.
	 */
	catalog?: readonly AtmCatalogRow[];
	/**
	 * The catalog rows per menu version, instead of `catalog`, for a log whose members bought on different versions (each
	 * command replays under the catalog of its event's `labels.menu_version`). Default: when the log's `catalog.published`
	 * events carry two or more versions, one catalog per version from them.
	 */
	catalogs?: AtmCatalogsByVersion;
};

const SPENT_PREFIX = "credits:spent:";
const FORFEITED_ACCOUNT = "credits:forfeited";
const NO_DECIMALS = 0;

/**
 * The events that had happened by `asOf`: `event_time` at or before it. `event_time`, not `ingest_time`: `asOf` asks what
 * the school's members held at an instant, so a batch that reached the log late (a `late-*` batch, a re-ship) still counts
 * from the instant it happened; `ingest_time` would answer a different question, what the log knew then, and would put
 * the same grant on either side of `asOf` depending on when it shipped.
 *
 * An event of a subject's revision chain (one that carries a `mutation`) also leaves with every later revision of its
 * subject: the engine's reset can be stamped hours before the payment that came first, and replaying the reset without
 * that payment would be a replay gap, not a balance.
 */
export const eventsAsOf = (
	events: readonly AtmEvent[],
	asOf: Date,
): AtmEvent[] => {
	const asOfMs = asOf.getTime();
	const cutAt = new Map<string, number>();
	for (const event of events) {
		const revision = mutationRevision(event);
		if (revision === null || Date.parse(event.event_time) <= asOfMs) continue;
		const known = cutAt.get(event.key);
		if (known === undefined || revision.after < known)
			cutAt.set(event.key, revision.after);
	}
	return events.filter((event) => {
		if (Date.parse(event.event_time) > asOfMs) return false;
		const revision = mutationRevision(event);
		const cut = cutAt.get(event.key);
		return revision === null || cut === undefined || revision.after < cut;
	});
};

/** A key is a member when the log books credits or a plan to it: the keys of payments and payouts alone are not. */
const isMemberEvent = (event: AtmEvent) =>
	event.event_type.startsWith("credit.") ||
	event.event_type.startsWith("plan.");

/**
 * The catalog of the log's own `catalog.published` events: the latest event's menu, or, when menus of two or more versions
 * were published, one catalog per version (the latest event of each), so that members on different versions replay.
 */
const catalogFromEvents = (
	events: readonly AtmEvent[],
): CatalogInput | null => {
	const latestByVersion = new Map<string, AtmEvent>();
	let latest: AtmEvent | null = null;
	for (const event of events) {
		if (event.event_type !== "catalog.published") continue;
		if (latest === null || byEventId(latest, event) < 0) latest = event;
		const version = (event.payload as { version?: unknown }).version;
		const known = latestByVersion.get(String(version));
		if (known === undefined || byEventId(known, event) < 0)
			latestByVersion.set(String(version), event);
	}
	const rowsOf = (event: AtmEvent): readonly AtmCatalogRow[] | null => {
		const menu = (event.payload as { menu?: unknown }).menu;
		if (typeof menu !== "object" || menu === null) return null;
		try {
			return menuCatalogRows({ menu: menu as Menu, school: event.school });
		} catch {
			// a menu the commodity rules cannot turn into rows is no usable catalog; the caller answers no-catalog
			return null;
		}
	};
	if (latest === null) return null;
	if (latestByVersion.size < 2) {
		const rows = rowsOf(latest);
		return rows === null ? null : { catalog: rows };
	}
	const catalogs: Record<string, readonly AtmCatalogRow[]> = {};
	for (const [version, event] of latestByVersion) {
		const rows = rowsOf(event);
		if (rows === null) return null;
		catalogs[version] = rows;
	}
	return { catalogs };
};

const unitsUsed = (event: AtmEvent): number => {
	let units = 0n;
	for (const posting of event.postings)
		if (
			posting.account.startsWith(SPENT_PREFIX) ||
			posting.account === FORFEITED_ACCOUNT
		)
			units += decimalToUnits(posting.amount, NO_DECIMALS);
	return Number(units);
};

/** Per holder and feature, the earliest expiry among rows that hold credits at `asOfMs`; the rows `balancesOf` counts. */
const nextExpiries = ({
	states,
	catalog,
	asOfMs,
}: {
	states: Record<string, AtmSubjectState>;
	catalog: CatalogSet["features"];
	asOfMs: number;
}): Map<string, number> => {
	const out = new Map<string, number>();
	const note = (holder: string, feature: string, expiresAt: number | null) => {
		if (expiresAt === null || expiresAt <= asOfMs) return;
		const slot = `${holder}\u0000${feature}`;
		const known = out.get(slot);
		if (known === undefined || expiresAt < known) out.set(slot, expiresAt);
	};
	for (const [holder, stored] of Object.entries(states)) {
		// the same view of a stored state as `balancesOf` (replay.ts) takes: the engine's rows, typed
		const state = stored as unknown as SubjectState;
		const featureOfRow = new Map<string, string>();
		for (const row of state.customerEntitlements) {
			const feature =
				catalog.features[row.internal_feature_id]?.id ??
				row.internal_feature_id;
			featureOfRow.set(row.id, feature);
			if (row.balance > 0) note(holder, feature, row.expires_at);
		}
		for (const row of state.rollovers) {
			const feature = featureOfRow.get(row.cus_ent_id);
			if (feature && row.balance > 0) note(holder, feature, row.expires_at);
		}
	}
	return out;
};

const problemOf = (error: unknown): SummaryProblem => {
	if (error instanceof ReplayGapError)
		return {
			kind: "replay-gap",
			eventId: error.eventId,
			subject: error.gap.subject,
			after: error.gap.after,
			before: error.gap.before,
			message: error.message,
		};
	if (error instanceof ReplayError)
		return { kind: "replay", eventId: error.eventId, message: error.message };
	throw error;
};

/** Every member's summary as of `asOf` (the events up to it, `eventsAsOf`), or why the log cannot be replayed. Pure; returns instead of throwing for a log it cannot replay. */
export const membersOf = (
	allEvents: readonly AtmEvent[],
	asOf: Date,
	options: SummaryOptions = {},
): MembersResult => {
	const events = eventsAsOf(allEvents, asOf);
	if (options.catalog !== undefined && options.catalogs !== undefined)
		throw new Error(
			"give catalog or catalogs (one per menu version), not both",
		);
	const catalogSource: CatalogInput | null = options.catalogs
		? { catalogs: options.catalogs }
		: options.catalog
			? { catalog: options.catalog }
			: catalogFromEvents(events);
	if (catalogSource === null)
		return {
			ok: false,
			error: {
				kind: "no-catalog",
				message:
					"no catalog rows given and the log has no catalog.published event with a usable menu",
			},
		};
	const asOfMs = asOf.getTime();
	const asOfIso = isoInstant(asOfMs);
	let replay: ReturnType<typeof replayEvents>;
	try {
		replay = replayEvents({
			events,
			...catalogSource,
			asOf: asOfIso,
		});
	} catch (error) {
		return { ok: false, error: problemOf(error) };
	}
	const members = new Map<string, MemberSummary>();
	const memberOf = (key: string): MemberSummary => {
		let member = members.get(key);
		if (!member) {
			member = { key, plan: null, features: {}, lastEventAt: null };
			members.set(key, member);
		}
		return member;
	};
	const featureOf = (key: string, feature: string): FeatureSummary => {
		const member = memberOf(key);
		member.features[feature] ??= {
			available: 0,
			held: 0,
			used: 0,
			nextExpiryAt: null,
		};
		return member.features[feature];
	};
	const latestPlan = new Map<string, AtmEvent>();
	for (const event of [...events].sort(byEventId)) {
		if (!isMemberEvent(event)) continue;
		const member = memberOf(event.key);
		member.lastEventAt = event.event_time;
		if (event.labels.plan !== undefined || event.event_type === "plan.canceled")
			latestPlan.set(event.key, event);
		const feature = event.labels.feature;
		if (feature !== undefined) {
			const slot = featureOf(event.key, feature);
			slot.used += unitsUsed(event);
		}
	}
	for (const [key, event] of latestPlan)
		memberOf(key).plan =
			event.event_type === "plan.canceled" ? null : (event.labels.plan ?? null);
	for (const balance of replay.balances) {
		const slot = featureOf(balance.holder, balance.feature);
		slot.available = balance.avail;
		slot.held = balance.held;
	}
	const expiries = nextExpiries({
		states: replay.snapshot.states,
		catalog: catalogSetOf(catalogSource).features,
		asOfMs,
	});
	for (const [slot, expiresAt] of expiries) {
		const [holder, feature] = slot.split("\u0000") as [string, string];
		featureOf(holder, feature).nextExpiryAt = isoInstant(expiresAt);
	}
	return {
		ok: true,
		asOf: asOfIso,
		members: Object.fromEntries(
			[...members.entries()].sort(([a], [b]) => byText(a, b)),
		),
	};
};

/** One member's summary (null when the log has no credit or plan event for `key`). Replays the whole log: for several members call `membersOf` once. */
export const memberSummary = (
	events: readonly AtmEvent[],
	key: string,
	asOf: Date,
	options: SummaryOptions = {},
): MemberResult => {
	const result = membersOf(events, asOf, options);
	if (!result.ok) return result;
	return { ok: true, asOf: result.asOf, summary: result.members[key] ?? null };
};
