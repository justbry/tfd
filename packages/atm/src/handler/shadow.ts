/**
 * The compare-only shadow's nightly diff (D12 T7, plan §5). The caller runs the handler on a separate SQLite database
 * (`UPGRADING.md`, "Compare-only"), imported from its own lots, beside its own billing; each night it asks how the
 * shadow's balances differ from its own. Read only: `atm_rows` -> `stateFromRows` -> `balancesOf`, at one `now`, against
 * the caller's sums per member per feature.
 *
 * Every difference is tagged with the reason that excuses it, as data, from evidence both sides hold (the caller's lots,
 * the shadow's rows, grants state and outbox); a difference no rule covers is `unexplained` and should alert.
 */
import type { SubjectState } from "@autumn/balance-engine";
import { resolveEnv } from "../billing/env.js";
import { grantsFromRows, stateFromRows, subjectKey } from "../billing/rows.js";
import { balancesOf } from "../ledger/replay.js";
import { toCatalog } from "../ledger/run.js";
import type {
	AtmEvent,
	BalanceDifference,
	CallerCreditLotRow,
	DiffBalancesInput,
	GrantsState,
	ShadowDiffReason,
	ShadowMember,
} from "../types.js";
import { assertCurrentSchema } from "./schema.js";
import { loadSubject } from "./stripe-webhook.js";

/** Two expiries this close are one expiry computed in two zones (a DST change moves a wall clock by an hour). */
const DST_WINDOW_MS = 3_600_000;
const ADJUST_SOURCE = "adjust:";
const ADDON_SOURCE = "addon:";

type Catalog = ReturnType<typeof toCatalog>;
type Bound = { lower: number; higher: number };

const atOrInfinity = (at: number | null | undefined): number =>
	at ?? Number.POSITIVE_INFINITY;

const between = (now: number, first: number, second: number): boolean =>
	now >= Math.min(first, second) && now < Math.max(first, second);

/** A credit the shadow holds that lapses on its own: a row with an expiry, or a rollover. */
type TfdExpiring = { id: string; expiresAt: number; balance: number };

/** The shadow's credits of one feature: its rows and their rollovers. */
const tfdCredits = (
	state: SubjectState | null,
	feature: string,
	catalog: Catalog,
) => {
	const rows = (state?.customerEntitlements ?? []).filter(
		(row) =>
			(catalog.features[row.internal_feature_id]?.id ??
				row.internal_feature_id) === feature,
	);
	const ids = new Set(rows.map((row) => row.id));
	const rollovers = (state?.rollovers ?? []).filter((rollover) =>
		ids.has(rollover.cus_ent_id),
	);
	return { rows, rollovers };
};

/** The caller's `adjust:*` lots made after the import: credits the shadow never saw. */
const adjustedSince = (
	lots: readonly CallerCreditLotRow[],
	importedAt: number,
): number =>
	lots
		.filter(
			(lot) =>
				lot.source.startsWith(ADJUST_SOURCE) &&
				lot.created_at > importedAt &&
				lot.removed_at === null,
		)
		.reduce((sum, lot) => sum + lot.allowance, 0);

/** tfd's refilling rows past their reset at `now`: a cycle that ended and was not paid, which the lapse job has not ended yet. */
const unrenewedBound = (
	rows: ReturnType<typeof tfdCredits>["rows"],
	now: number,
): number =>
	rows
		.filter(
			(row) =>
				row.next_reset_at !== null &&
				row.next_reset_at !== undefined &&
				row.next_reset_at <= now &&
				atOrInfinity(row.expires_at) > now,
		)
		.reduce((sum, row) => sum + Math.max(0, row.balance), 0);

/** What tfd granted for each invoice paid since the import beyond the caller's lots of that invoice. */
const upgradeBound = (
	grants: GrantsState,
	lots: readonly CallerCreditLotRow[],
	feature: string,
	importedAt: number,
): number => {
	let bound = 0;
	for (const [invoiceId, record] of Object.entries(grants.invoices)) {
		if (record.paidAt < importedAt || record.removed) continue;
		const granted = record.granted
			.filter((row) => row.feature === feature)
			.reduce((sum, row) => sum + row.units, 0);
		const lotted = lots
			.filter(
				(lot) => lot.invoice_id === invoiceId && lot.feature_id === feature,
			)
			.reduce((sum, lot) => sum + lot.allowance, 0);
		bound += Math.max(0, granted - lotted);
	}
	return bound;
};

const expiredUnits = (event: AtmEvent): number =>
	event.postings
		.filter((posting) => posting.account === "credits:expired")
		.reduce((sum, posting) => sum + Number(posting.amount), 0);

/** What the shadow expired at its renewals since the import (the rollover cap's trim among it). */
const capBound = (
	outbox: readonly AtmEvent[],
	customerId: string,
	feature: string,
	importedAt: number,
	now: number,
): number =>
	outbox
		.filter((event) => {
			const at = Date.parse(event.event_time);
			return (
				event.event_type === "credit.expired" &&
				event.key === customerId &&
				event.labels.feature === feature &&
				"rolled_over" in event.payload &&
				at >= importedAt &&
				at <= now
			);
		})
		.reduce((sum, event) => sum + expiredUnits(event), 0);

/**
 * The credits that are live on one side and lapsed on the other at `now` because the two sides set different expiries:
 * a one-time lot and tfd's row of the same invoice (`gift`), or any lot and a tfd row or rollover lapsing within an hour
 * of it (`dst`). `lower` is what tfd is short by (the lot still live), `higher` what it holds over (the lot lapsed).
 */
const expiryBounds = ({
	lots,
	rows,
	rollovers,
	feature,
	now,
}: {
	lots: readonly CallerCreditLotRow[];
	feature: string;
	now: number;
} & ReturnType<typeof tfdCredits>): { gift: Bound; dst: Bound } => {
	const gift: Bound = { lower: 0, higher: 0 };
	const dst: Bound = { lower: 0, higher: 0 };
	const expiring: TfdExpiring[] = [
		...rows
			.filter((row) => row.expires_at !== null && row.expires_at !== undefined)
			.map((row) => ({
				id: row.id,
				expiresAt: row.expires_at as number,
				balance: Math.max(0, row.balance),
			})),
		...rollovers
			.filter(
				(rollover) =>
					rollover.expires_at !== null && rollover.expires_at !== undefined,
			)
			.map((rollover) => ({
				id: rollover.id,
				expiresAt: rollover.expires_at as number,
				balance: Math.max(0, rollover.balance),
			})),
	];
	const used = new Set<string>();
	const add = (bound: Bound, lotLive: boolean, lot: number, tfd: number) => {
		if (lotLive) bound.lower += lot;
		else bound.higher += tfd;
	};
	for (const lot of lots) {
		if (lot.feature_id !== feature || lot.removed_at !== null) continue;
		const lotAt = atOrInfinity(lot.expires_at);
		const lotLive = lotAt > now;
		if (lot.every === "once" && lot.source.startsWith(ADDON_SOURCE)) {
			const row = rows.find(
				(candidate) =>
					(candidate.id.startsWith("ce_gift_") ||
						candidate.id.startsWith("ce_once_")) &&
					candidate.id.includes(`_${lot.invoice_id}_`) &&
					candidate.id.endsWith(`_${feature}`),
			);
			if (row) {
				used.add(row.id);
				const rowAt = atOrInfinity(row.expires_at);
				if (
					Math.abs(lotAt - rowAt) > DST_WINDOW_MS &&
					between(now, lotAt, rowAt)
				)
					add(gift, lotLive, lot.balance, Math.max(0, row.balance));
				continue;
			}
		}
		if (lot.expires_at === null) continue;
		const match = expiring.find(
			(item) =>
				!used.has(item.id) &&
				item.expiresAt !== lotAt &&
				Math.abs(item.expiresAt - lotAt) <= DST_WINDOW_MS,
		);
		if (!match) continue;
		used.add(match.id);
		if (between(now, lotAt, match.expiresAt))
			add(dst, lotLive, lot.balance, match.balance);
	}
	return { gift, dst };
};

const fits = (residual: number, bound: Bound): boolean =>
	residual < 0 ? -residual <= bound.lower : residual <= bound.higher;

/** The reason that excuses a difference, from the rules in plan §5, or `unexplained`. */
const reasonOf = ({
	delta,
	adjusted,
	member,
	state,
	grants,
	outbox,
	feature,
	input,
	catalog,
}: {
	delta: number;
	adjusted: number;
	member: ShadowMember;
	state: SubjectState | null;
	grants: GrantsState;
	outbox: readonly AtmEvent[];
	feature: string;
	input: DiffBalancesInput;
	catalog: Catalog;
}): ShadowDiffReason => {
	// The shadow never saw the caller's adjustments since the import: what is left once they are added is the difference.
	const residual = delta + adjusted;
	if (residual === 0) return "admin_adjust";
	const lots = member.lots ?? [];
	const credits = tfdCredits(state, feature, catalog);
	const { gift, dst } = expiryBounds({
		lots,
		feature,
		now: input.now,
		...credits,
	});
	if (fits(residual, dst)) return "expiry_dst";
	if (fits(residual, gift)) return "gift_expiry";
	if (residual > 0 && residual <= unrenewedBound(credits.rows, input.now))
		return "unrenewed_cycle";
	if (
		member.lots !== undefined &&
		residual > 0 &&
		residual <= upgradeBound(grants, lots, feature, input.importedAt)
	)
		return "upgrade_grant";
	if (
		residual < 0 &&
		-residual <=
			capBound(outbox, member.customerId, feature, input.importedAt, input.now)
	)
		return "rollover_cap";
	return "unexplained";
};

/**
 * The members' balances in the shadow against the caller's, per feature, at `now`: one difference per member and feature
 * whose balances are not equal (a feature either side holds), sorted by member then feature, each with the reason that
 * excuses it or `unexplained`. A member the shadow has no rows for holds nothing there. Reads only.
 */
export const diffBalances = (input: DiffBalancesInput): BalanceDifference[] => {
	assertCurrentSchema(input.db);
	const env = resolveEnv(input.env);
	const catalog = toCatalog(input.catalog);
	const outbox = input.db
		.all<{ body: string }>(
			`SELECT body FROM ledger_outbox WHERE school_id = ? AND env = ?`,
			[input.school, env],
		)
		.map((row) => JSON.parse(row.body) as AtmEvent);
	const out: BalanceDifference[] = [];
	for (const member of input.members) {
		const identity = {
			orgId: input.school,
			env,
			customerId: member.customerId,
			entityId: null,
		};
		const { rows, revision } = loadSubject(input.db, subjectKey(identity));
		const state = stateFromRows({ identity, revision, rows });
		const grants = grantsFromRows(rows);
		const tfd = new Map<string, number>(
			state
				? balancesOf({
						states: { [member.customerId]: state as never },
						holds: {},
						catalog,
						asOfMs: input.now,
					}).map((balance) => [balance.feature, balance.avail])
				: [],
		);
		const features = [
			...new Set([...Object.keys(member.balances), ...tfd.keys()]),
		].sort();
		for (const feature of features) {
			const callerBalance = member.balances[feature] ?? 0;
			const tfdBalance = tfd.get(feature) ?? 0;
			const delta = tfdBalance - callerBalance;
			if (delta === 0) continue;
			const adjusted = adjustedSince(
				(member.lots ?? []).filter((lot) => lot.feature_id === feature),
				input.importedAt,
			);
			out.push({
				customerId: member.customerId,
				feature,
				callerBalance,
				tfdBalance,
				delta,
				reason: reasonOf({
					delta,
					adjusted,
					member,
					state,
					grants,
					outbox,
					feature,
					input,
					catalog,
				}),
				adjustedSinceImport: adjusted,
			});
		}
	}
	return out.sort((first, second) =>
		first.customerId === second.customerId
			? first.feature < second.feature
				? -1
				: 1
			: first.customerId < second.customerId
				? -1
				: 1,
	);
};
