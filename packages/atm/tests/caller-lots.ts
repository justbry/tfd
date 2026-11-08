/**
 * The B4 Uni family service's own credit rules, ported by hand from family-service `src/school-billing/grant.ts`,
 * `adjust.ts` and `time.ts`: the oracle the importer's tests compare atm with. A lot is one grant of one feature for one
 * invoice, with an `expires_at`; nothing refills it.
 */
import { createHash } from "node:crypto";
import type {
	CallerCreditLotRow,
	CallerMembershipRow,
	Menu,
} from "../src/types.js";

const offsetMs = (ms: number, timeZone: string): number => {
	const parts = new Intl.DateTimeFormat("en-US", {
		timeZone,
		hourCycle: "h23",
		year: "numeric",
		month: "numeric",
		day: "numeric",
		hour: "numeric",
		minute: "numeric",
		second: "numeric",
	}).formatToParts(new Date(ms));
	const number = (type: string) =>
		Number(parts.find((p) => p.type === type)?.value);
	const local = Date.UTC(
		number("year"),
		number("month") - 1,
		number("day"),
		number("hour"),
		number("minute"),
		number("second"),
	);
	return local - Math.floor(ms / 1000) * 1000;
};

export const addMonthsInZone = (
	ms: number,
	months: number,
	timeZone: string,
) => {
	const offset = offsetMs(ms, timeZone);
	const wall = new Date(ms + offset);
	const year = wall.getUTCFullYear();
	const month = wall.getUTCMonth() + months;
	const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	const local = Date.UTC(
		year,
		month,
		Math.min(wall.getUTCDate(), daysInMonth),
		wall.getUTCHours(),
		wall.getUTCMinutes(),
		wall.getUTCSeconds(),
		wall.getUTCMilliseconds(),
	);
	return local - offsetMs(local - offset, timeZone);
};

const YEAR_MS = 365 * 86_400_000;
const GRANTING_REASONS = ["subscription_create", "subscription_cycle"];

export type CallerInvoice = {
	id: string;
	reason: "subscription_create" | "subscription_cycle";
	periodStart: number;
	periodEnd: number;
	/** The event's time (ms): the lot's `created_at`. */
	atMs: number;
};

/** What `grantForInvoice` writes for one paid invoice: one lot per tier grant and per add-on grant, balance = the amount. */
export const callerGrant = ({
	membership,
	menu,
	invoice,
	existing,
}: {
	membership: CallerMembershipRow;
	menu: Menu;
	invoice: CallerInvoice;
	existing: readonly CallerCreditLotRow[];
}): CallerCreditLotRow[] => {
	if (!GRANTING_REASONS.includes(invoice.reason)) return [];
	const tierGrants = menu.tiers.find((t) => t.id === membership.tier_id)
		?.grants as Menu["tiers"][number]["grants"];
	const items = tierGrants.map((grant) => ({
		source: "tier",
		grant,
		every: grant.every as "month" | "year" | "once",
	}));
	for (const id of membership.addon_ids.split(",").filter(Boolean)) {
		const addon = menu.addons.find((a) => a.id === id);
		if (!addon) continue;
		if (
			addon.price.every === "once" &&
			invoice.reason !== "subscription_create"
		)
			continue;
		for (const grant of addon.grants)
			items.push({ source: `addon:${id}`, grant, every: addon.price.every });
	}
	const out: CallerCreditLotRow[] = [];
	for (const item of items) {
		const { grant } = item;
		const per = grant.amount * membership.quantity;
		let amount: number;
		if (item.source !== "tier")
			amount =
				grant.amount *
				(item.every === "month" && membership.interval === "year" ? 12 : 1);
		else if (grant.every === membership.interval) amount = per;
		else if (grant.every === "month" && membership.interval === "year")
			amount = per * 12;
		else if (invoice.reason === "subscription_create") amount = per;
		else
			amount = existing.some(
				(l) =>
					l.feature_id === grant.featureId &&
					l.created_at > invoice.atMs - YEAR_MS,
			)
				? 0
				: per;
		if (amount <= 0) continue;
		const months = grant.rollover?.months;
		const expiresAt =
			item.every === "once"
				? months === undefined
					? null
					: addMonthsInZone(invoice.atMs, months, menu.timeZone)
				: months === undefined
					? invoice.periodEnd
					: addMonthsInZone(invoice.periodEnd, months, menu.timeZone);
		const id = `lot_${createHash("sha256")
			.update(
				`${membership.id}|${grant.featureId}|${invoice.id}|${item.source}`,
			)
			.digest("hex")
			.slice(0, 24)}`;
		out.push({
			id,
			membership_id: membership.id,
			school_id: membership.school_id,
			feature_id: grant.featureId,
			invoice_id: invoice.id,
			source: item.source,
			every: item.every,
			allowance: amount,
			removed_at: null,
			balance: amount,
			adjustment: 0,
			additional_balance: 0,
			next_reset_at: null,
			expires_at: expiresAt,
			created_at: invoice.atMs,
		});
	}
	return out;
};

/** What the caller would hold available at `asOfMs`: every lot not past its expiry. */
export const callerAvail = (
	lots: readonly CallerCreditLotRow[],
	asOfMs: number,
	feature = "visit",
) =>
	lots
		.filter(
			(l) =>
				l.feature_id === feature &&
				(l.expires_at === null || l.expires_at > asOfMs),
		)
		.reduce((sum, l) => sum + l.balance, 0);

/**
 * The caller's `raiseLots` (family-service src/school-billing/grant.ts), ported: a quantity raise mid-cycle grants the
 * extra units prorated over what is left of the cycle, rounded up, on a lot of the tier that lasts to the same end as the
 * cycle's own lot.
 */
export const callerRaise = ({
	membership,
	menu,
	invoiceId,
	atMs,
	from,
	to,
	cycleStart,
	cycleEnd,
}: {
	membership: CallerMembershipRow;
	menu: Menu;
	invoiceId: string;
	atMs: number;
	from: number;
	to: number;
	cycleStart: number;
	cycleEnd: number;
}): CallerCreditLotRow[] => {
	const span = cycleEnd - cycleStart;
	const left = Math.min(Math.max(cycleEnd - atMs, 0), span);
	const tierGrants = menu.tiers.find((t) => t.id === membership.tier_id)
		?.grants as Menu["tiers"][number]["grants"];
	return tierGrants.flatMap((grant) => {
		const perUnit =
			grant.every === membership.interval
				? grant.amount
				: grant.every === "month" && membership.interval === "year"
					? grant.amount * 12
					: 0;
		const amount = Math.floor((perUnit * (to - from) * left + span - 1) / span);
		if (perUnit <= 0 || amount <= 0) return [];
		const expiresAt = grant.rollover
			? addMonthsInZone(cycleEnd, grant.rollover.months, menu.timeZone)
			: cycleEnd;
		return [
			{
				id: `lot_raise_${invoiceId}_${grant.featureId}`,
				membership_id: membership.id,
				school_id: membership.school_id,
				feature_id: grant.featureId,
				invoice_id: invoiceId,
				source: "tier",
				every: grant.every,
				allowance: amount,
				removed_at: null,
				balance: amount,
				adjustment: 0,
				additional_balance: 0,
				next_reset_at: null,
				expires_at: expiresAt,
				created_at: atMs,
			},
		];
	});
};

/** The caller's `adjustCredits` for a positive amount: a lot of its own, `adjust:<kind>`, that never expires. */
export const callerAdjust = ({
	membership,
	key,
	kind,
	feature = "visit",
	amount,
	atMs,
}: {
	membership: CallerMembershipRow;
	key: string;
	kind: string;
	feature?: string;
	amount: number;
	atMs: number;
}): CallerCreditLotRow => ({
	id: `lot_adjust_${key}_${feature}`,
	membership_id: membership.id,
	school_id: membership.school_id,
	feature_id: feature,
	invoice_id: `adjust:${key}`,
	source: `adjust:${kind}`,
	every: "once",
	allowance: amount,
	removed_at: null,
	balance: amount,
	adjustment: 0,
	additional_balance: 0,
	next_reset_at: null,
	expires_at: null,
	created_at: atMs,
});
