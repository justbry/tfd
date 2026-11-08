import { monthName } from "$contract/app/period.ts";
import type { ReportCell } from "$contract/data/ledger.ts";
import { suppressedText } from "../books/kpi-cells.ts";

/**
 * The Ledger and Reports tabs' wording and money, as the Preact package's money.ts, wording.ts, books-pane.ts and
 * report-figure.tsx write it (copies: the Preact modules sit beside its Preact UI; test/s9-4/consistency.test.ts runs
 * both over the same inputs and compares their source). Unlike app/money.ts, which a KPI document's symbol and a
 * school's known currency feed, these take a school's currency as the Reader gives it: null for a school that has none,
 * which reads "—", never `$0.00`.
 */

/** "gift" → "Gift". */
export const capitalise = (word: string): string =>
	`${word.slice(0, 1).toUpperCase()}${word.slice(1)}`;

/** `1 event`, `2 events`. */
export const plural = (count: number, noun: string): string =>
	`${count} ${noun}${count === 1 ? "" : "s"}`;

const formats = new Map<boolean, Intl.NumberFormat>();
const formatFor = (whole: boolean): Intl.NumberFormat => {
	const known = formats.get(whole);
	if (known) return known;
	const digits = whole ? 0 : 2;
	const made = new Intl.NumberFormat("en-US", {
		minimumFractionDigits: digits,
		maximumFractionDigits: digits,
	});
	formats.set(whole, made);
	return made;
};

/** The mockup's `K_CUR`: `$` for USD and `C$` for CAD, matched on the ISO code as the data writes it. Any other code
 * falls back to the symbol `Intl` knows. */
const knownSymbols: Record<string, string> = { USD: "$", CAD: "C$" };

/** What a money figure reads for a school with no currency: it has no money to show, so never `$0.00` and never a
 * currency made up. */
export const noCurrencyText = "—";

/** The currency column of a CSV: empty for a school with no currency, never a code made up. */
export const csvCurrency = (currency: string | null): string => currency ?? "";

/** The unit of an amount field and the prefix of every money figure: `$` or `C$`. */
export const currencySymbol = (currency: string | null): string =>
	!currency
		? noCurrencyText
		: (knownSymbols[currency] ??
			new Intl.NumberFormat("en-US", { style: "currency", currency })
				.formatToParts(0)
				.find(({ type }) => type === "currency")?.value ??
			currency.toUpperCase());

/** Minor units as the mockup's `money` writes them: `$1,234.50`, `−$50.00` (a real minus sign); `whole` drops the
 * cents, for money the cell rules round. No currency reads `noCurrencyText`. */
export function formatMoney(
	cents: number,
	currency: string | null,
	whole = false,
): string {
	if (!currency) return noCurrencyText;
	const sign = cents < 0 ? "−" : "";
	return `${sign}${currencySymbol(currency)}${formatFor(whole).format(Math.abs(cents) / 100)}`;
}

/** A signed whole number as the mockup's `sgn` writes it: `+22`, `−2`, and nothing for 0. */
export function signedCount(count: number): string {
	if (count === 0) return "";
	return count > 0 ? `+${count}` : `−${Math.abs(count)}`;
}

/** cell-rules `minContributors`: a count under this shows as `<10` (a figure from 1 to 4 is never shown as it is). */
export const smallCount = 5;

/** The lock panel heading of an identified surface (the Ledger, the full statement, the donors table). */
export const identitiesLockHeading = "Finance admins and the owner see this";

/** `7 Jan 2027`: the day a figure publishes. */
export const dayMonthYear = (isoDate: string): string =>
	`${Number(isoDate.slice(8))} ${monthName(isoDate)} ${isoDate.slice(0, 4)}`;

/** A figure of an audience's document as text, the one reading of its cases that the page and the CSV both use: its
 * `value` (empty when it is hidden), and the `hidden` reason (empty when it is shown). */
export function cellText(
	cell: ReportCell,
	money: boolean,
	currency: string | null,
	whole: boolean,
): { value: string; hidden: string } {
	if (typeof cell === "number")
		return {
			value: money ? formatMoney(cell, currency, whole) : String(cell),
			hidden: "",
		};
	if ("lt" in cell)
		return {
			value: money
				? `under ${formatMoney(cell.lt, currency, true)}`
				: `<${cell.lt}`,
			hidden: "",
		};
	if ("approx" in cell) return { value: String(cell.approx), hidden: "" };
	if ("until" in cell)
		return {
			value: "",
			hidden: `Published after ${dayMonthYear(cell.until)}`,
		};
	if ("who" in cell) return { value: "", hidden: `${cell.who} see this` };
	return {
		value: cell.hidden === "suppressed" ? suppressedText : "",
		hidden: cell.text,
	};
}
