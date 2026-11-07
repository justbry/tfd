/** `GET /v1/schools/:school/income-statement` and `.../members-income`: S8a's statement over the finance month objects, as the UI's `IncomeStatement`. */
import {
	type FinanceMonthObject,
	type IncomeStatementResult,
	incomeStatement,
	membersIncome,
	type StatementFigures,
} from "tfd/worker";
import type { SchoolSnapshot } from "../data/snapshot.js";
import { ApiError } from "../http.js";
import { addDays, dayNumber, daysInRange } from "../time.js";
import type {
	IncomeSeries,
	IncomeStatementWire,
	StatementAmounts,
} from "../wire.js";
import { financeMonthsForRange } from "./finance-months.js";
import { dayRange, oneOf } from "./query.js";

const LONGEST_DAILY_SERIES = 62;
const WEEK = 7;
const DAY_MS = 86_400_000;
const LONGEST_RANGE_DAYS = 1100;
const FUNDRAISING = "income:fundraising:";
const REFUNDS = "income:billing:refunds";

/** The statement's lines as the UI shows them. `income` is income less fundraising. */
export const amountsOf = (figures: StatementFigures): StatementAmounts => ({
	memberships: figures.memberships,
	bookings: figures.bookings,
	discounts: null,
	income: figures.income - figures.fundraising,
	refunds: figures.refunds,
	fees: figures.fees,
	net: figures.net,
	giftsSold: null,
	paidOut: figures.paidOut,
});

/** What a day brought in as income: every revenue account other than refunds and fundraising, as a positive amount. */
const dayIncome = (accounts: Record<string, number>): number => {
	let posted = 0;
	for (const [account, value] of Object.entries(accounts))
		if (
			account.startsWith("income:") &&
			account !== REFUNDS &&
			!account.startsWith(FUNDRAISING)
		)
			posted += value;
	return 0 - posted;
};

/** Daily points for up to 62 days, else weekly, from `from` to the earlier of `to` and `today`. */
export const incomeSeries = (
	months: readonly Pick<FinanceMonthObject, "days">[],
	from: string,
	to: string,
	today: string,
): IncomeSeries => {
	const through = to > today ? today : to;
	if (from > through)
		return { step: "day", points: [], through, totalCents: 0, peak: null };
	const days = daysInRange(from, through);
	const step = days > LONGEST_DAILY_SERIES ? WEEK : 1;
	const amounts: number[] = new Array(Math.ceil(days / step)).fill(0);
	for (const month of months)
		for (const [date, day] of Object.entries(month.days)) {
			if (date < from || date > through) continue;
			const slot = Math.floor(
				(dayNumber(date) - dayNumber(from)) / DAY_MS / step,
			);
			amounts[slot] = (amounts[slot] ?? 0) + dayIncome(day.accounts);
		}
	const points = amounts.map((amountCents, index) => ({
		start: addDays(from, index * step),
		amountCents,
	}));
	const peakAmount = Math.max(...amounts);
	return {
		step: step === 1 ? "day" : "week",
		points,
		through,
		totalCents: amounts.reduce((total, amount) => total + amount, 0),
		peak: points.find(({ amountCents }) => amountCents === peakAmount) ?? null,
	};
};

export const statementWire = (
	result: IncomeStatementResult,
	months: readonly Pick<FinanceMonthObject, "days">[],
	context: {
		school: string;
		today: string;
		currency: string | null;
		unit: IncomeStatementWire["unit"];
	},
): IncomeStatementWire => ({
	school: context.school,
	from: result.from,
	to: result.to,
	currency: context.currency,
	unit: context.unit,
	basis: { kind: "cash" },
	matchesStripe: null,
	counts: {
		payments: result.counts.payments,
		refunds: result.counts.refunds,
		payouts: result.counts.payouts,
	},
	amounts: amountsOf(result.figures),
	giftsOutstanding: null,
	income: incomeSeries(months, result.from, result.to, context.today),
	previous:
		result.previous === null
			? null
			: {
					from: result.previous.from,
					to: result.previous.to,
					amounts: amountsOf(result.previous.figures),
					changes: amountsOf(result.previous.changes),
					income: incomeSeries(
						months,
						result.previous.from,
						result.previous.to,
						context.today,
					),
				},
});

const checkLength = (from: string, to: string): void => {
	if (daysInRange(from, to) > LONGEST_RANGE_DAYS)
		throw new ApiError(
			"bad_request",
			`A range is at most ${LONGEST_RANGE_DAYS} days.`,
			{ field: "to" },
		);
};

/** A month that skipped money in another currency makes every USD figure of the books short: say so instead of a statement. */
const refuseSkippedMoney = (months: readonly FinanceMonthObject[]): void => {
	if (months.some((month) => month.skippedNonUsd > 0))
		throw new ApiError(
			"not_available",
			"Some of this school's money is in a currency the books do not carry.",
		);
};

export const incomeStatementRoute = async (
	snapshot: SchoolSnapshot,
	query: URLSearchParams,
	today: string,
): Promise<IncomeStatementWire> => {
	const { from, to } = dayRange(query);
	const compare = oneOf(query, "compare", ["0", "1"], false) === "1";
	checkLength(from, to);
	const months = await financeMonthsForRange(snapshot, from, to, compare);
	refuseSkippedMoney(months);
	const menu = await snapshot.menu();
	return statementWire(incomeStatement(months, { from, to, compare }), months, {
		school: snapshot.school,
		today,
		currency: menu?.currency ?? null,
		unit: menu?.unit ?? null,
	});
};

export const membersIncomeRoute = async (
	snapshot: SchoolSnapshot,
	query: URLSearchParams,
): Promise<{ cents: number }> => {
	const { from, to } = dayRange(query);
	checkLength(from, to);
	const months = await financeMonthsForRange(snapshot, from, to, false);
	refuseSkippedMoney(months);
	return { cents: membersIncome(months, from, to) };
};
