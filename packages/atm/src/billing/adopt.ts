/**
 * Moving a caller that grants credits on its own onto `handleStripeEvent`. B4 Uni's family service keeps one
 * `school_memberships` row per subscription and one `school_credit_lots` row per grant per invoice (a lot is a balance
 * with an `expires_at`; nothing refills it). atm keeps one refilling row per tier or add-on grant, the leftovers of
 * earlier cycles as rollover rows, and a `GrantsState` that remembers which invoices were granted. This builds atm's
 * rows from the caller's, so that the next Stripe event decides what the caller's own rules would have decided and an
 * invoice the caller already granted grants nothing again.
 *
 * What the rows determine is read from them; what they do not is not guessed. It throws, naming every problem, on
 * anything it cannot place: a tier, add-on or feature the menu does not have, a lot that is no grant of the
 * membership's tier, a tier grant or add-on with no lot (atm would never refill it), rows on different cycles.
 *
 * What the caller does that atm's rules place on their own rows (D12 T2):
 * - an admin adjustment (`adjust:<kind>`): a row of its own that never refills and never lapses (`adjustRowOp`, the row `adjustCredits` writes);
 * - a quantity raise mid-cycle (a `subscription_update` invoice's tier lot, lasting to the same cycle end as the cycle's
 *   lot): folded into the cycle's row, as atm's own raise adds to it. The quantity is the membership's, never read back
 *   from a lot's amount (a prorated raise can be a whole number of units by chance);
 * - a refund of some of a row's invoices: each invoice with a lot taken back is recorded as taken back;
 * - a recurring add-on dropped while its lots still hold credits: a retired row, lapsing where its lots do.
 *
 * It also returns the opening events (D12 T3): the engine command that makes the subject with exactly these rows, so a
 * log that starts at the import replays (without them a member's log has no subject until the next invoice).
 *
 * Pure: no I/O, no clock (`now` is passed). The same input always gives the same output.
 */
import { deterministicUlid } from "../ledger/ids.js";
import { runOnState, toCatalog } from "../ledger/run.js";
import type {
	AdjustKind,
	AtmEnv,
	AtmEvent,
	BillingRow,
	CallerCreditLotRow,
	CallerMembershipRow,
	CallerRowsImport,
	CallerRowsInput,
	GrantedRow,
	GrantsState,
	Interval,
	InvoiceRecord,
	MembershipRecord,
	Menu,
	MenuAddon,
	MenuTier,
} from "../types.js";
import { adjustKindOfLabel, adjustRowOp } from "./adjust.js";
import { resolveEnv } from "./env.js";
import {
	addonCp,
	addonProductId,
	addonSpecs,
	addUtcMonths,
	addZonedMonths,
	customerRow,
	EMPTY_GRANTS_STATE,
	giftEntId,
	menuCatalogRows,
	ORG,
	onceEntId,
	productOp,
	type RowSpec,
	rolloverExpiry,
	rowOp,
	TIER_CP,
	tierProductId,
	tierSpecs,
} from "./grants.js";
import { eventsOf, planChangedOf } from "./handle.js";
import { grantsRow, rowsFromState, sortRows } from "./rows.js";
import { subscriptionStatus } from "./status.js";

const MS_PER_SECOND = 1000;
const MONTHS_PER_INTERVAL: Record<Interval, number> = { month: 1, year: 12 };
const TIER_SOURCE = "tier";
const ADDON_SOURCE_PREFIX = "addon:";
/** `allowance / amount` is a whole quantity up to the floating point a REAL column carries. */
const QUANTITY_TOLERANCE = 1e-9;
const IMPORT_MAPPING = "import/caller-rows";
const IMPORT_REASON = "imported from the caller's credit lots";

type Lot = CallerCreditLotRow;

/**
 * One credit row atm will hold, with the caller's lots that fed it (oldest first), in refills: the lots of one cycle (the
 * cycle's own lot, then the raises that last to the same end). `retired`: a dropped add-on's row, which no longer refills.
 */
type RowPlan = {
	rowId: string;
	spec: RowSpec;
	cpId: string;
	lots: Lot[];
	refills: Lot[][];
	retired: boolean;
};

/** A one-time add-on's lot: its own row, never refilled. */
type OncePlan = { lot: Lot; addon: MenuAddon; feature: string };

/** An admin adjustment's lot: its own row, never refilled, never lapsing. */
type AdjustPlan = { lot: Lot; kind: AdjustKind };

/** UTF-16 code unit order (not the locale's), so the output is the same wherever it runs. */
const compareText = (left: string, right: string): number => {
	if (left < right) return -1;
	return left > right ? 1 : 0;
};

const byCreation = (first: Lot, second: Lot): number =>
	first.created_at - second.created_at || compareText(first.id, second.id);

const lapsed = (lot: Lot, now: number): boolean =>
	lot.expires_at !== null && lot.expires_at <= now;

const customerIdOf = (familyId: string): string => `family:${familyId}`;

const sumOf = (lots: readonly Lot[], read: (lot: Lot) => number): number =>
	lots.reduce((sum, lot) => sum + read(lot), 0);

/**
 * A row's lots as refills. A quantity raise mid-cycle is a lot of the tier that lasts to the same end as the cycle's own
 * lot (the caller's `raiseLots`), so on a tier row that refills with the plan it joins the refill before it; every other
 * lot is a refill of its own.
 */
const refillsOf = (lots: readonly Lot[], foldRaises: boolean): Lot[][] => {
	const refills: Lot[][] = [];
	for (const lot of lots) {
		const current = refills[refills.length - 1];
		const cycleLot = current?.[0];
		if (
			foldRaises &&
			current &&
			cycleLot &&
			lot.expires_at !== null &&
			lot.expires_at === cycleLot.expires_at
		)
			current.push(lot);
		else refills.push([lot]);
	}
	return refills;
};

/** What the caller's rows say about one member, as atm's rows and grants state. See the file comment. */
export const grantsStateFromCallerRows = (
	input: CallerRowsInput,
): CallerRowsImport => {
	const { membership, lots, menu, now } = input;
	const env = resolveEnv(input.env);
	const problems: string[] = [];
	const problem = (message: string) => problems.push(message);
	const label = `membership ${membership.id}`;
	const holder = {
		orgId: membership.school_id,
		customerId: customerIdOf(membership.family_id),
	};

	const tier = menu.tiers.find((t) => t.id === membership.tier_id);
	if (!tier)
		problem(
			`${label} is on tier ${JSON.stringify(membership.tier_id)}, which the menu does not have`,
		);
	else if (!tier.prices.some((p) => p.interval === membership.interval))
		problem(
			`${label} is on tier ${tier.id} billed every ${membership.interval}, which the menu does not price`,
		);
	if (!Number.isInteger(membership.quantity) || membership.quantity < 1)
		problem(
			`${label} has quantity ${membership.quantity}, not a whole number from 1`,
		);

	const addonIds = membership.addon_ids
		.split(",")
		.map((id) => id.trim())
		.filter((id, index, ids) => id !== "" && ids.indexOf(id) === index);
	const membershipAddons: MenuAddon[] = [];
	for (const id of addonIds) {
		const addon = menu.addons.find((a) => a.id === id);
		if (addon) membershipAddons.push(addon);
		else
			problem(
				`${label} has add-on ${JSON.stringify(id)}, which the menu does not have`,
			);
	}
	const recurringAddons = membershipAddons.filter(
		(a) => a.price.every !== "once",
	);

	const membershipRecord = membershipRecordOf(membership, tier);
	const customerId = holder.customerId;
	const createdAtMs = membership.created_at * MS_PER_SECOND;
	const ended = membership.status === "canceled";

	// ---- no lots: the subscription is known, nothing has been paid for yet -------------------------------------
	if (lots.length === 0) {
		throwIfAny(problems);
		const state: GrantsState = {
			...structuredClone(EMPTY_GRANTS_STATE),
			holder,
			membership: membershipRecord,
			menuVersion: String(membership.menu_version),
		};
		return { state, rows: [grantsRow(state)], events: [], revision: 0 };
	}

	// ---- place every lot on a row atm will hold ---------------------------------------------------------------
	const cycleLength = MONTHS_PER_INTERVAL[membership.interval];
	const tierRowSpecs = tier
		? tierSpecs(menu, tier.id, membership.interval)
		: [];
	const rowPlans = new Map<string, RowPlan>();
	const onceLots: OncePlan[] = [];
	const adjustLots: AdjustPlan[] = [];
	const planOf = (spec: RowSpec, cpId: string, retired = false): RowPlan => {
		const have = rowPlans.get(spec.rowId);
		if (have) return have;
		const made: RowPlan = {
			rowId: spec.rowId,
			spec,
			cpId,
			lots: [],
			refills: [],
			retired,
		};
		rowPlans.set(spec.rowId, made);
		return made;
	};
	for (const lot of [...lots].sort(byCreation)) {
		const where = `lot ${lot.id} (${lot.source}, ${lot.feature_id}, invoice ${lot.invoice_id})`;
		if (lot.membership_id !== membership.id)
			problem(
				`${where} belongs to membership ${lot.membership_id}, not ${membership.id}`,
			);
		if (lot.school_id !== membership.school_id)
			problem(
				`${where} belongs to school ${lot.school_id}, not ${membership.school_id}`,
			);
		if (!menu.features.some((f) => f.id === lot.feature_id)) {
			problem(
				`${where} grants feature ${JSON.stringify(lot.feature_id)}, which the menu does not have`,
			);
			continue;
		}
		if (lot.source === TIER_SOURCE) {
			if (!tier) continue;
			if (lot.every === "once") {
				problem(`${where} is a one-time lot of the tier, which has none`);
				continue;
			}
			// A monthly grant paid yearly is one yearly row of twelve times the amount (the caller records `every: month`).
			const interval: Interval =
				membership.interval === "year" && lot.every === "month"
					? "year"
					: lot.every;
			const spec = tierRowSpecs.find(
				(s) => s.feature === lot.feature_id && s.interval === interval,
			);
			if (!spec) {
				problem(
					`${where} is not a grant of tier ${tier.id} (${membership.interval}) on the menu: it grants ${lot.feature_id} every ${lot.every}`,
				);
				continue;
			}
			planOf(spec, TIER_CP).lots.push(lot);
			continue;
		}
		const adjustKind = adjustKindOfLabel(lot.source);
		if (adjustKind !== null) {
			if (lot.expires_at !== null) {
				problem(
					`${where} is an adjustment that expires at ${lot.expires_at}: an adjustment row never lapses`,
				);
				continue;
			}
			adjustLots.push({ lot, kind: adjustKind });
			continue;
		}
		if (!lot.source.startsWith(ADDON_SOURCE_PREFIX)) {
			problem(
				`${where} has a source atm does not know (expected tier, addon:<id> or adjust:<kind>)`,
			);
			continue;
		}
		const addonId = lot.source.slice(ADDON_SOURCE_PREFIX.length);
		const addon = menu.addons.find((a) => a.id === addonId);
		if (!addon) {
			problem(
				`${where} is for add-on ${JSON.stringify(addonId)}, which the menu does not have`,
			);
			continue;
		}
		if (addon.price.every === "once") {
			const grants = addon.grants.some((g) => g.featureId === lot.feature_id);
			if (!grants || lot.every !== "once") {
				problem(
					`${where} is not a one-time grant of add-on ${addon.id} on the menu`,
				);
				continue;
			}
			if (addon.gift === "dollars") {
				problem(
					`${where} is a credit lot of a dollar gift certificate, which grants no credits`,
				);
				continue;
			}
			onceLots.push({ lot, addon, feature: lot.feature_id });
			continue;
		}
		// An add-on the membership no longer has: its lots still hold credits until they lapse, on a row that no longer refills.
		const dropped = !recurringAddons.some((a) => a.id === addon.id);
		const specs = addonSpecs(menu, addon.id).filter(
			(s) => s.feature === lot.feature_id,
		);
		const spec = specs.length === 1 ? specs[0] : undefined;
		if (!spec) {
			problem(
				`${where} matches ${specs.length} grants of add-on ${addon.id} on the menu, not one`,
			);
			continue;
		}
		planOf(spec, addonCp(addon.id), dropped).lots.push(lot);
	}
	for (const plan of rowPlans.values())
		plan.refills = refillsOf(
			plan.lots,
			plan.cpId === TIER_CP && plan.spec.interval === plan.spec.plan,
		);
	const retiredAddons = [
		...new Set(
			[...rowPlans.values()]
				.filter((p) => p.retired)
				.map((p) => p.cpId.slice("cp_addon_".length)),
		),
	].sort(compareText);

	// Everything the menu says the plan grants must have a lot, or atm would never refill it (it refills rows it holds).
	if (tier)
		for (const spec of tierRowSpecs)
			if (!rowPlans.has(spec.rowId))
				problem(
					`${label} has no lot for tier ${tier.id}'s grant of ${spec.feature} every ${spec.interval}: atm would never refill it`,
				);
	for (const addon of recurringAddons)
		for (const spec of addonSpecs(menu, addon.id))
			if (!rowPlans.has(spec.rowId))
				problem(
					`${label} has no lot for add-on ${addon.id}'s grant of ${spec.feature}: atm would never refill it`,
				);

	// Each credit row's lots by invoice, with the refill each went into: an invoice twice in one row is not something the
	// caller's unique index allows.
	const epochs = new Map<string, Map<string, number>>();
	for (const plan of rowPlans.values()) {
		const byInvoice = new Map<string, number>();
		for (const [index, refill] of plan.refills.entries())
			for (const lot of refill) {
				if (byInvoice.has(lot.invoice_id))
					problem(
						`credit row ${plan.rowId} has two lots for invoice ${lot.invoice_id}`,
					);
				byInvoice.set(lot.invoice_id, index + 1);
			}
		epochs.set(plan.rowId, byInvoice);
	}
	// ---- the cycle the credits are in: read from the newest refill of every row that refills with the plan ---------
	const zone = menu.timeZone;
	const cycleRows = [...rowPlans.values()].filter(
		(p) => !p.retired && p.spec.interval === p.spec.plan,
	);
	const cycleEnds = new Map<string, number>();
	for (const plan of cycleRows) {
		const newest = cycleLotOf(plan);
		const end = cycleEndOf({
			lot: newest,
			rollover: plan.spec.rollover,
			membershipEnd:
				membership.current_period_end === null
					? null
					: membership.current_period_end * MS_PER_SECOND,
			zone,
		});
		if (end === null)
			problem(
				`lot ${newest.id} expires at ${newest.expires_at}, which is not the end of a cycle plus the ${plan.spec.rollover?.months ?? 0} rollover month(s) the menu gives ${plan.spec.feature}: the lot and the menu disagree`,
			);
		else cycleEnds.set(plan.rowId, end);
	}
	const distinctEnds = new Set(cycleEnds.values());
	if (distinctEnds.size > 1)
		problem(
			`the credit rows of ${label} are on different cycles (ends ${[...distinctEnds].join(", ")}): a renewal was granted to some and not others`,
		);
	const cycleEnd =
		[...distinctEnds][0] ??
		(membership.current_period_end === null
			? null
			: membership.current_period_end * MS_PER_SECOND);
	const cycleStart =
		cycleEnd === null ? null : addUtcMonths(cycleEnd, -cycleLength);

	// ---- the quantity the credits reflect: the membership's ------------------------------------------------------
	// Not read back from a lot: a raise's prorated amount can be a whole number of units by chance (1 of a 1-a-unit grant,
	// raised from 2 to 3 with half the cycle left), which would read as quantity 1. The cycle's own lot must still be a
	// whole number of the menu's per-unit amount, or it is no grant of this tier.
	const creditQuantity = membership.quantity;
	for (const plan of cycleRows.filter((p) => p.cpId === TIER_CP)) {
		const cycleLot = cycleLotOf(plan);
		const units = cycleLot.allowance / plan.spec.amount;
		const whole = Math.round(units);
		if (whole < 1 || Math.abs(units - whole) > QUANTITY_TOLERANCE)
			problem(
				`lot ${cycleLot.id} grants ${cycleLot.allowance} ${plan.spec.feature}, which is not a whole number of the menu's ${plan.spec.amount} per unit`,
			);
	}
	for (const plan of cycleRows.filter((p) => p.cpId !== TIER_CP)) {
		const cycleLot = cycleLotOf(plan);
		if (cycleLot.allowance !== plan.spec.amount)
			problem(
				`lot ${cycleLot.id} grants ${cycleLot.allowance} ${plan.spec.feature}, but add-on ${plan.cpId.replace("cp_addon_", "")} grants ${plan.spec.amount} on the menu`,
			);
	}
	throwIfAny(problems);

	// ---- build the rows -----------------------------------------------------------------------------------------
	const engineRows: BillingRow[] = [];
	const addRow = (table: BillingRow["table"], id: string, data: unknown) =>
		engineRows.push({
			table,
			id,
			data: JSON.parse(JSON.stringify(data)) as BillingRow["data"],
		});
	const customer = customerRow(customerId);
	addRow("customer", customer.internal_id, customer);
	const tierId = (tier as MenuTier).id;
	const tierProduct = productOp(
		TIER_CP,
		tierProductId(tierId, membership.interval),
		customerId,
		createdAtMs,
		creditQuantity,
	).row as { id: string };
	addRow("customerProducts", tierProduct.id, tierProduct);
	// A dropped add-on keeps its product, as atm's own drop does (it stops the rows refilling and leaves the product).
	for (const addon of [
		...recurringAddons,
		...retiredAddons.map(
			(id) => menu.addons.find((a) => a.id === id) as MenuAddon,
		),
	]) {
		const product = productOp(
			addonCp(addon.id),
			addonProductId(addon.id, addon.price.every),
			customerId,
			createdAtMs,
		).row as { id: string };
		addRow("customerProducts", product.id, product);
	}

	const state: GrantsState = {
		...structuredClone(EMPTY_GRANTS_STATE),
		identity: holder,
		holder,
		subscriptionId: membership.stripe_subscription_id,
		tierId,
		interval: membership.interval,
		anchor: null,
		cycleStart,
		cycleEnd,
		quantity: creditQuantity,
		addonIds: recurringAddons.map((a) => a.id),
		endedAt: ended
			? (membership.stripe_event_at ?? membership.updated_at) * MS_PER_SECOND
			: null,
		membership: membershipRecord,
		menuVersion: String(membership.menu_version),
	};
	const granted = new Map<string, GrantedRow[]>();
	const grantedOf = (invoiceId: string): GrantedRow[] => {
		const have = granted.get(invoiceId);
		if (have) return have;
		const made: GrantedRow[] = [];
		granted.set(invoiceId, made);
		return made;
	};

	for (const plan of rowPlans.values()) {
		const { spec, refills } = plan;
		const first = plan.lots[0] as Lot;
		const current = refills[refills.length - 1] as Lot[];
		const newest = current[current.length - 1] as Lot;
		const own = spec.interval === spec.plan;
		// A row on its own interval (a yearly grant on a monthly plan) is refilled a full interval after its seed: the lot's
		// event time is the nearest the rows come to the seed (the invoice's period start is not kept). A retired row does
		// not refill: it lapses where its newest lots do.
		const boundary = own
			? (cycleEnds.get(plan.rowId) ?? (newest.expires_at as number))
			: addUtcMonths(newest.created_at, MONTHS_PER_INTERVAL[spec.interval]);
		const stopped = ended || plan.retired;
		const row = rowOp({
			rowId: plan.rowId,
			cpId: plan.cpId,
			entitlementId: spec.entId,
			feature: spec.feature,
			customerId,
			balance: sumOf(current, (lot) => (lapsed(lot, now) ? 0 : lot.balance)),
			nextResetAt: stopped ? null : boundary,
			expiresAt: stopped ? newest.expires_at : null,
			t: first.created_at,
		}).row as Record<string, unknown>;
		row.adjustment = sumOf(current, (lot) => lot.adjustment);
		row.additional_balance = sumOf(current, (lot) => lot.additional_balance);
		addRow("customerEntitlements", plan.rowId, row);
		if (plan.retired) state.retired[plan.rowId] = refills.length;
		else state.rows[plan.rowId] = refills.length;

		// What earlier cycles left, still alive: the rollovers the engine would have made, with the caller's own expiry.
		for (const older of refills.slice(0, -1).flat()) {
			if (lapsed(older, now) || older.balance <= 0) continue;
			addRow("rollovers", `roll_${older.id}`, {
				id: `roll_${older.id}`,
				cus_ent_id: plan.rowId,
				balance: older.balance,
				usage: 0,
				expires_at: older.expires_at,
				entities: {},
			});
		}
		for (const lot of plan.lots) {
			const epoch = (epochs.get(plan.rowId) as Map<string, number>).get(
				lot.invoice_id,
			) as number;
			grantedOf(lot.invoice_id).push({
				invoiceId: lot.invoice_id,
				rowId: plan.rowId,
				feature: spec.feature,
				units: lot.allowance,
				epoch,
				// The current refill's leftovers become the rollover the engine makes at the next reset (its own month
				// arithmetic); an older refill's already are one, expiring where the caller's lot expires. A retired row is
				// never reset: its lots' credits lapse where the lots do.
				rolloverExpiresAt: rolloverExpiresAtOf({
					lot,
					current: current.includes(lot) && !plan.retired,
					rollover: spec.rollover,
					boundary,
				}),
			});
		}
	}

	for (const { lot, addon, feature } of onceLots) {
		const gift = addon.gift === "sessions";
		const rowId = `ce_${gift ? "gift" : "once"}_${lot.invoice_id}_${addon.id}_${feature}`;
		if (!lapsed(lot, now)) {
			const row = rowOp({
				rowId,
				cpId: null,
				entitlementId: gift ? giftEntId(feature) : onceEntId(addon.id, feature),
				feature,
				customerId,
				balance: lot.balance,
				nextResetAt: null,
				expiresAt: lot.expires_at,
				t: lot.created_at,
			}).row as Record<string, unknown>;
			row.adjustment = lot.adjustment;
			row.additional_balance = lot.additional_balance;
			addRow("customerEntitlements", rowId, row);
			state.rows[rowId] = 1;
		}
		grantedOf(lot.invoice_id).push({
			invoiceId: lot.invoice_id,
			rowId,
			feature,
			units: lot.allowance,
			epoch: 1,
			rolloverExpiresAt: null,
		});
	}

	// An adjustment is no invoice: its row holds what is left of it, and no invoice record names it.
	for (const { lot, kind } of adjustLots) {
		const row = adjustRowOp({
			adjustmentId: lot.id,
			kind,
			feature: lot.feature_id,
			customerId,
			credits: lot.balance,
			at: lot.created_at,
		}).row as Record<string, unknown>;
		row.adjustment = lot.adjustment;
		row.additional_balance = lot.additional_balance;
		addRow("customerEntitlements", row.id as string, row);
		state.rows[row.id as string] = 1;
	}

	// Every invoice the lots name is a decided invoice: a replay finds its record and grants nothing. An invoice with any
	// lot taken back is taken back (a refund takes back a whole invoice; the lots still holding credits keep them).
	const lotsByInvoice = new Map<string, Lot[]>();
	for (const lot of lots) {
		if (adjustKindOfLabel(lot.source) !== null) continue;
		const same = lotsByInvoice.get(lot.invoice_id) ?? [];
		same.push(lot);
		lotsByInvoice.set(lot.invoice_id, same);
	}
	for (const [invoiceId, same] of [...lotsByInvoice].sort(([left], [right]) =>
		compareText(left, right),
	)) {
		const record: InvoiceRecord = {
			paidAt: Math.min(...same.map((l) => l.created_at)),
			granted: grantedOf(invoiceId),
			removed: same.some((l) => l.removed_at !== null),
		};
		state.invoices[invoiceId] = record;
	}
	return opened({
		state,
		engineRows,
		menu,
		now,
		env,
		policyVersion: input.policyVersion ?? "unknown",
		importId:
			input.importId ??
			deterministicUlid({
				timeMs: now,
				revision: 0,
				seed: JSON.stringify(["import", membership.school_id, membership.id]),
			}),
	});
};

/** The cycle's own lot of a row: the first of its newest refill (the raises after it last to the same end). */
const cycleLotOf = (plan: RowPlan): Lot =>
	(plan.refills[plan.refills.length - 1] as Lot[])[0] as Lot;

/**
 * The rows written by the engine itself: one `applyBillingPlan` from no subject that inserts every row, its mutation
 * booked as events, so a replay of the log from the import makes the same rows. The rows returned are the engine's state
 * after it (the columns it keeps), with the grants row beside them.
 */
const opened = ({
	state,
	engineRows,
	menu,
	now,
	env,
	policyVersion,
	importId,
}: {
	state: GrantsState;
	engineRows: readonly BillingRow[];
	menu: Menu;
	now: number;
	env: AtmEnv;
	policyVersion: number | string;
	importId: string;
}): CallerRowsImport => {
	const holder = state.identity as { orgId: string; customerId: string };
	const identity = {
		orgId: holder.orgId,
		env,
		customerId: holder.customerId,
		entityId: null,
	};
	// Not `<ULID>:<step>`, a handler's: the import is the caller's own command (a stored-inputs replay carries it, and the
	// holder's seed at its first input covers it).
	const commandId = `import:${importId}`;
	const command = {
		schemaVersion: 1,
		type: "applyBillingPlan",
		org: ORG,
		commandId,
		requestId: commandId,
		identity,
		occurredAt: now,
		entityIds: [],
		expiringPooledBalanceIds: [],
		ops: engineRows.map((row) => ({
			op: "insert",
			table: row.table,
			row: row.data,
		})),
	};
	const catalogRows = menuCatalogRows({ menu, school: holder.orgId, env });
	const catalog = toCatalog(catalogRows);
	const run = runOnState({ state: null, catalog, command });
	const { mutation } = run;
	if (
		!(mutation && run.state) ||
		(mutation.result as { status?: string } | undefined)?.status === "rejected"
	)
		throw new Error(
			`the engine would not make the imported rows of ${holder.customerId}: the catalog of this menu does not carry them`,
		);
	const input = {
		menu,
		menuVersion: state.menuVersion ?? "",
		eventId: importId,
	};
	const labels = {
		menu_version: input.menuVersion,
		policy_version: String(policyVersion),
		mapping: IMPORT_MAPPING,
	};
	const credits: AtmEvent[] = eventsOf({
		mutation,
		before: null,
		catalog,
		input,
		grants: state,
		labels,
		reason: IMPORT_REASON,
	});
	const events =
		credits.length > 0 ? credits : [planChangedOf({ mutation, input, labels })];
	return {
		state,
		rows: sortRows([...rowsFromState(run.state), grantsRow(state)]),
		events,
		revision: mutation.revision.after,
	};
};

/** The current refill's leftovers roll over at `boundary`; an older refill's already are a rollover, expiring where the lot does. */
const rolloverExpiresAtOf = ({
	lot,
	current,
	rollover,
	boundary,
}: {
	lot: Lot;
	current: boolean;
	rollover: RowSpec["rollover"];
	boundary: number;
}): number | null => {
	if (current) return rolloverExpiry(rollover, boundary);
	return rollover ? lot.expires_at : null;
};

const throwIfAny = (problems: readonly string[]): void => {
	if (problems.length === 0) return;
	throw new Error(
		`the caller's rows cannot be moved onto atm as they are: ${problems.join("; ")}`,
	);
};

/**
 * The end of the cycle a lot was granted for. A lot lasts to the cycle's end plus the grant's rollover months on the
 * school's calendar (no rollover: to the cycle's end), so the end is read back from the expiry: the membership's own
 * renewal date when that fits, else the expiry minus the months. Null when neither gives the expiry again.
 */
const cycleEndOf = ({
	lot,
	rollover,
	membershipEnd,
	zone,
}: {
	lot: Lot;
	rollover: RowSpec["rollover"];
	membershipEnd: number | null;
	zone: string;
}): number | null => {
	if (lot.expires_at === null) return null;
	if (!rollover) return lot.expires_at;
	const { months } = rollover;
	const candidates = [
		membershipEnd,
		addZonedMonths(lot.expires_at, -months, zone),
	];
	return (
		candidates.find(
			(candidate) =>
				candidate !== null &&
				addZonedMonths(candidate, months, zone) === lot.expires_at,
		) ?? null
	);
};

const membershipRecordOf = (
	membership: CallerMembershipRow,
	tier: MenuTier | undefined,
): MembershipRecord => {
	const periodEnd =
		membership.current_period_end === null
			? Number.NaN
			: membership.current_period_end * MS_PER_SECOND;
	const at =
		(membership.stripe_event_at ?? membership.updated_at) * MS_PER_SECOND;
	const shown = subscriptionStatus({
		source: {
			eventId: membership.id,
			mapping: "caller/school_memberships",
			stripeApiVersion: "",
		},
		id: membership.stripe_subscription_id,
		customerId: membership.stripe_customer_id,
		status: membership.status,
		items: [],
		currentPeriodStart: 0,
		currentPeriodEnd: periodEnd,
		cancelAtPeriodEnd: membership.cancel_at_period_end === 1,
		at,
		metadata: {},
	});
	return {
		subscriptionId: membership.stripe_subscription_id,
		status: shown.status,
		tierId: tier?.id ?? null,
		interval: membership.interval,
		quantity: membership.quantity,
		renewsAt: shown.renewsAt,
		cancelAtPeriodEnd: shown.cancelAtPeriodEnd,
		endsAt: shown.endsAt,
		at,
	};
};
