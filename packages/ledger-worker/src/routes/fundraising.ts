/** `GET /v1/schools/:school/fundraising`: what each Zeffy campaign received in a range, and what Zeffy paid out. */
import type { AtmEvent } from "tfd";
import type { SchoolSnapshot } from "../data/snapshot.js";
import { ApiError } from "../http.js";
import { daysInRange } from "../time.js";
import { dayRange } from "./query.js";

const FUNDRAISING_INCOME = "income:fundraising:";
const ZEFFY_PAYOUTS = "assets:clearing:zeffy-payouts";
const MAX_RANGE_DAYS = 3660;
const CENTS_PER_UNIT = 100;

export type FundraisingWire = {
	campaigns: Array<{ campaign: string; receivedCents: number; count: number }>;
	paidOutCents: number;
};

/** A decimal USD amount (`-12.50`) as whole cents, without a float. */
const centsOf = (amount: string): number => {
	const negative = amount.startsWith("-");
	const [whole = "0", fraction = ""] = amount.replace("-", "").split(".");
	const cents =
		Number(whole) * CENTS_PER_UNIT + Number(`${fraction}00`.slice(0, 2));
	return negative ? 0 - cents : cents;
};

export const fundraisingOf = (
	events: readonly AtmEvent[],
	from: string,
	to: string,
): FundraisingWire => {
	const byCampaign = new Map<
		string,
		{ receivedCents: number; count: number }
	>();
	let paidOutCents = 0;
	for (const event of events) {
		if (event.date < from || event.date > to) continue;
		if (event.event_type === "fundraise.received") {
			for (const posting of event.postings) {
				if (!posting.account.startsWith(FUNDRAISING_INCOME)) continue;
				const campaign = posting.account.slice(FUNDRAISING_INCOME.length);
				const found = byCampaign.get(campaign) ?? {
					receivedCents: 0,
					count: 0,
				};
				found.receivedCents += 0 - centsOf(posting.amount);
				found.count += 1;
				byCampaign.set(campaign, found);
			}
		} else if (event.event_type === "fundraise.paid_out") {
			for (const posting of event.postings)
				if (posting.account === ZEFFY_PAYOUTS)
					paidOutCents += centsOf(posting.amount);
		}
	}
	return {
		campaigns: [...byCampaign]
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([campaign, found]) => ({ campaign, ...found })),
		paidOutCents,
	};
};

export const fundraisingRoute = async (
	snapshot: SchoolSnapshot,
	query: URLSearchParams,
): Promise<FundraisingWire> => {
	const { from, to } = dayRange(query);
	if (daysInRange(from, to) > MAX_RANGE_DAYS)
		throw new ApiError("bad_request", "That range is too long.", {
			field: "to",
		});
	return fundraisingOf(await snapshot.events(), from, to);
};
