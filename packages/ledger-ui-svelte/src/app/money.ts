import { figureText } from "./books/kpi-cells.ts";

/** Money outside a KPI document (the Preact package's money.ts, which sits beside its Preact UI): the mockup's
 * `K_CUR` symbols, `$` for USD and `C$` for CAD, any other code the symbol `Intl` knows. */
const knownSymbols: Record<string, string> = { USD: "$", CAD: "C$" };

export const currencySymbol = (currency: string): string =>
	knownSymbols[currency.toUpperCase()] ??
	new Intl.NumberFormat("en-US", { style: "currency", currency })
		.formatToParts(0)
		.find(({ type }) => type === "currency")?.value ??
	currency.toUpperCase();

/** Minor units as the mockup's `money` writes them: `$1,234.50`, `−$50.00` (a real minus sign). */
export const formatMoney = (cents: number, currency: string): string =>
	figureText(cents, "money", currencySymbol(currency));
