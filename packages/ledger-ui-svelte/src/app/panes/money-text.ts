import { formatMoney } from "../money.ts";

/** Minor units in the school's currency, or "—" for a school that has none (no published menu and no Stripe account):
 * its money figures read "—", never `$0.00`. */
export const schoolMoney = (cents: number, currency: string | null): string =>
	currency === null ? "—" : formatMoney(cents, currency);
