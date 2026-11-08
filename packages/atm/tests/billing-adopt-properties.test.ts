/**
 * D12 import property: for generated B4 Uni members (tiers and quantities, raises mid-cycle, rollovers, refunds of some
 * invoices, admin adjustments up and down, recurring add-ons kept and dropped, one-time packs and gift sessions, spent
 * and lapsed lots, canceled memberships), `grantsStateFromCallerRows` never throws, the credits atm counts per member per
 * feature equal what the caller's live lots hold at the same `now`, and a log of the opening events replays to the same.
 * `ATM_IMPORT_MEMBERS` sets how many (default 1000; the stage 1 exit runs 10,000).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { makeRng } from "../fixtures/rng.js";
import { grantsStateFromCallerRows } from "../src/billing/adopt.js";
import { menuCatalogRows } from "../src/billing/grants.js";
import { type BillingRow, stateFromRows } from "../src/billing/rows.js";
import { balancesOf, replayEvents } from "../src/ledger/replay.js";
import { toCatalog } from "../src/ledger/run.js";
import { isoInstant } from "../src/ledger/util.js";
import type {
	CallerCreditLotRow,
	CallerMembershipRow,
	Interval,
	Menu,
} from "../src/types.js";
import {
	addMonthsInZone,
	callerAdjust,
	callerAvail,
	callerGrant,
	callerRaise,
} from "./caller-lots.js";

const SCHOOL = "sch_vol";
const MEMBERS = Number(process.env.ATM_IMPORT_MEMBERS ?? 1000);
const DAY_MS = 86_400_000;
/** About 3 ms a member: 10,000 take half a minute. */
const PROPERTY_TIMEOUT_MS = 10 * MEMBERS + 5000;
const FEATURES = ["visit", "retreat"] as const;

const menu: Menu = {
	...(JSON.parse(
		readFileSync(
			`${import.meta.dir}/../fixtures/billing/grants/menu.json`,
			"utf8",
		),
	) as Menu),
	timeZone: "UTC",
};
const catalogRows = menuCatalogRows({ menu, school: SCHOOL });
const catalog = toCatalog(catalogRows);

type Rng = ReturnType<typeof makeRng>;

/** Spends `units` of `feature` from the live lots, soonest to expire first, as a booking or a correction does. */
const spend = (
	lots: CallerCreditLotRow[],
	feature: string,
	units: number,
	at: number,
): void => {
	let left = units;
	const live = lots
		.filter(
			(l) =>
				l.feature_id === feature &&
				l.balance > 0 &&
				(l.expires_at === null || l.expires_at > at),
		)
		.sort(
			(a, b) =>
				(a.expires_at ?? Number.POSITIVE_INFINITY) -
					(b.expires_at ?? Number.POSITIVE_INFINITY) ||
				a.created_at - b.created_at,
		);
	for (const lot of live) {
		if (left <= 0) break;
		const take = Math.min(lot.balance, left);
		lot.balance -= take;
		left -= take;
	}
};

/** The caller's `removeForInvoice`: each lot of the invoice not taken back yet loses min(balance, allowance). */
const refund = (
	lots: CallerCreditLotRow[],
	invoiceId: string,
	at: number,
	only?: (lot: CallerCreditLotRow) => boolean,
): void => {
	for (const lot of lots) {
		if (lot.invoice_id !== invoiceId || lot.removed_at !== null) continue;
		if (only && !only(lot)) continue;
		lot.balance -= Math.min(lot.balance, lot.allowance);
		lot.removed_at = at;
	}
};

/** One member's life on the caller's rules, up to `now`. */
const generate = (
	rng: Rng,
	index: number,
): {
	membership: CallerMembershipRow;
	lots: CallerCreditLotRow[];
	now: number;
} => {
	const interval: Interval = rng.next() < 0.15 ? "year" : "month";
	const tierId =
		interval === "year"
			? "sparkle-2"
			: rng.pick(["sparkle-1", "sparkle-2", "sparkle-4"]);
	let quantity = rng.int(1, 3);
	const recurring = interval === "month" && rng.next() < 0.35;
	const once = [
		...(rng.next() < 0.2 ? ["pack"] : []),
		...(rng.next() < 0.2 ? ["gift-visit"] : []),
	];
	let addonIds = [...(recurring ? ["glow"] : []), ...once];
	const months = interval === "year" ? 12 : 1;
	const cycles = interval === "year" ? rng.int(1, 2) : rng.int(1, 5);
	const start = Date.UTC(2025, rng.int(0, 11), rng.int(1, 28), 18);
	const id = `mem_${index}`;
	const membershipAt = (): CallerMembershipRow => ({
		id,
		school_id: SCHOOL,
		family_id: `fam_${index}`,
		profile_id: null,
		tier_id: tierId,
		interval,
		addon_ids: addonIds.join(","),
		menu_version: 3,
		stripe_customer_id: `cus_${index}`,
		quantity,
		stripe_subscription_id: `sub_${index}`,
		status: "active",
		current_period_end: null,
		cancel_at_period_end: 0,
		revision: 1,
		stripe_event_at: null,
		created_at: Math.floor(start / 1000) + 10,
		updated_at: Math.floor(start / 1000) + 10,
	});
	const lots: CallerCreditLotRow[] = [];
	let periodStart = start;
	let periodEnd = start;
	let adjustments = 0;
	for (let cycle = 0; cycle < cycles; cycle++) {
		periodEnd = addMonthsInZone(periodStart, months, "UTC");
		const invoice = {
			id: `in_${index}_${cycle}`,
			reason:
				cycle === 0
					? ("subscription_create" as const)
					: ("subscription_cycle" as const),
			periodStart,
			periodEnd,
			atMs: periodStart + 10_000,
		};
		lots.push(
			...callerGrant({
				membership: membershipAt(),
				menu,
				invoice,
				existing: lots,
			}),
		);
		// One-time add-ons come with the first invoice only.
		if (cycle === 0) addonIds = addonIds.filter((a) => !once.includes(a));
		const span = periodEnd - periodStart;
		const at = (share: number) => periodStart + Math.floor(span * share);
		const last = cycle === cycles - 1;
		// What happens during the cycle, in time order.
		const moments = [rng.next(), rng.next(), rng.next(), rng.next()].sort();
		const [raiseAt, adjustAt, spendAt, refundAt] = moments as [
			number,
			number,
			number,
			number,
		];
		if (rng.next() < 0.25 && quantity < 5) {
			const to = quantity + rng.int(1, 2);
			lots.push(
				...callerRaise({
					membership: membershipAt(),
					menu,
					invoiceId: `in_${index}_${cycle}_raise`,
					atMs: at(raiseAt * 0.9),
					from: quantity,
					to,
					cycleStart: periodStart,
					cycleEnd: periodEnd,
				}),
			);
			quantity = to;
		}
		if (rng.next() < 0.2) {
			adjustments++;
			lots.push(
				callerAdjust({
					membership: membershipAt(),
					key: `k_${index}_${adjustments}`,
					kind: rng.pick(["goodwill", "gift", "correction"]),
					feature: rng.next() < 0.8 ? "visit" : "retreat",
					amount: rng.int(1, 4),
					atMs: at(adjustAt * 0.9),
				}),
			);
		}
		if (rng.next() < 0.15) {
			// A negative correction: from the live lots, soonest to expire first.
			spend(lots, "visit", rng.int(1, 2), at(adjustAt * 0.9) + 1);
		}
		if (rng.next() < 0.7)
			spend(lots, rng.pick(FEATURES), rng.int(0, 3), at(spendAt * 0.9));
		if (rng.next() < 0.12) {
			const target = rng.pick([
				...new Set(
					lots
						.filter((l) => !l.source.startsWith("adjust:"))
						.map((l) => l.invoice_id),
				),
			]);
			// Now and then only the tier's lots of an invoice are taken back.
			const tierOnly = rng.next() < 0.3;
			refund(
				lots,
				target,
				at(refundAt * 0.9),
				tierOnly ? (l) => l.source === "tier" : undefined,
			);
		}
		if (last && recurring && rng.next() < 0.3)
			// The member drops the add-on mid-cycle: its lot keeps its credits until it lapses.
			addonIds = addonIds.filter((a) => a !== "glow");
		if (!last) periodStart = periodEnd;
	}
	const canceled = rng.next() < 0.12;
	// An active member is imported during the cycle; a canceled one at any time up to a few months after it.
	const span = periodEnd - periodStart;
	const now = canceled
		? periodStart + Math.floor(span * 0.95) + rng.int(0, 120) * DAY_MS
		: periodStart + Math.floor(span * (0.92 + rng.next() * 0.07));
	const membership: CallerMembershipRow = {
		...membershipAt(),
		status: canceled ? "canceled" : "active",
		current_period_end: Math.floor(periodEnd / 1000),
		stripe_event_at: Math.floor((canceled ? now - DAY_MS : periodStart) / 1000),
		updated_at: Math.floor((canceled ? now - DAY_MS : periodStart) / 1000),
	};
	return { membership, lots, now };
};

const availOf = (rows: readonly BillingRow[], holder: string, at: number) => {
	const state = stateFromRows({
		identity: {
			orgId: SCHOOL,
			env: "live",
			customerId: holder,
			entityId: null,
		},
		revision: 1,
		rows,
	});
	const out: Record<string, number> = {};
	if (!state) return out;
	for (const b of balancesOf({
		states: { [holder]: state as never },
		holds: {},
		catalog,
		asOfMs: at,
	}))
		out[b.feature] = b.avail;
	return out;
};

describe("D12 import property: generated members import to the caller's balances", () => {
	test(
		`${MEMBERS} members: no throw, per-feature sums equal the caller's live lots, and the opening events replay to them`,
		() => {
			const rng = makeRng("d12-import");
			const seen = {
				raises: 0,
				adjustments: 0,
				refunded: 0,
				dropped: 0,
				canceled: 0,
				lapsed: 0,
			};
			for (let index = 0; index < MEMBERS; index++) {
				const { membership, lots, now } = generate(rng, index);
				if (lots.some((l) => l.invoice_id.endsWith("_raise"))) seen.raises++;
				if (lots.some((l) => l.source.startsWith("adjust:")))
					seen.adjustments++;
				if (lots.some((l) => l.removed_at !== null)) seen.refunded++;
				if (
					lots.some((l) => l.source === "addon:glow") &&
					!membership.addon_ids.includes("glow")
				)
					seen.dropped++;
				if (membership.status === "canceled") seen.canceled++;
				if (lots.some((l) => l.expires_at !== null && l.expires_at <= now))
					seen.lapsed++;
				const label = `member ${index} (${membership.tier_id} x${membership.quantity} ${membership.interval}, ${lots.length} lots)`;
				let imported: ReturnType<typeof grantsStateFromCallerRows>;
				try {
					imported = grantsStateFromCallerRows({ membership, lots, menu, now });
				} catch (error) {
					throw new Error(`${label}: ${(error as Error).message}`);
				}
				const holder = `family:${membership.family_id}`;
				const atm = availOf(imported.rows, holder, now);
				const replay = replayEvents({
					events: imported.events,
					catalog: catalogRows,
					asOf: isoInstant(now),
				});
				const replayed = Object.fromEntries(
					replay.balances.map((b) => [b.feature, b.avail]),
				);
				for (const feature of FEATURES) {
					const caller = callerAvail(lots, now, feature);
					if (
						(atm[feature] ?? 0) !== caller ||
						(replayed[feature] ?? 0) !== caller
					)
						throw new Error(
							`${label}: ${feature} is ${atm[feature] ?? 0} in atm's rows and ${replayed[feature] ?? 0} replayed, the caller's lots hold ${caller}`,
						);
				}
				expect(imported.state.menuVersion).toBe("3");
				expect(imported.state.quantity).toBe(membership.quantity);
			}
			if (process.env.ATM_IMPORT_SEEN) console.log(seen);
			// The generator reaches every class it is meant to.
			for (const [kind, count] of Object.entries(seen))
				expect({ kind, count: count > 0 }).toEqual({ kind, count: true });
		},
		PROPERTY_TIMEOUT_MS,
	);
});
