/**
 * A copy of buzz-school's `LEDGER_ROUTES` (`packages/family-service/src/ledger/origins.ts` at buzz-school `origin/main`
 * 0af6e42cd0b1c6c6755414a8d37a443101761d31): the only paths that give the ledger origin credentialed CORS. Every path
 * the S8e adapters call on `api.b4uni.com` must match one; a path that does not is a gap to report, not a call to
 * make. Update this copy, and its sha, when buzz-school changes the list.
 */
export const ledgerRoutesSourceCommit =
	"0af6e42cd0b1c6c6755414a8d37a443101761d31";

const SCHOOL = "^/school-admin/schools/[0-9a-fA-F-]{36}";

export const LEDGER_ROUTES: readonly RegExp[] = [
	/^\/school-admin\/ledger-token$/,
	new RegExp(`${SCHOOL}/finance-grants(/remove)?$`),
	new RegExp(`${SCHOOL}/ledger/[a-z-]+$`),
	new RegExp(`${SCHOOL}/billing/members-list$`),
	new RegExp(`${SCHOOL}/billing/menu/versions(/[0-9]{1,9})?$`),
	new RegExp(`${SCHOOL}/bookings(/[0-9a-fA-F-]{36}/(outcome|cancel))?$`),
	new RegExp(
		`${SCHOOL}/billing(/members|/menu|/menu/publish|/stripe-key|/stripe-key/remove)?$`,
	),
	/^\/school-admin\/key-(create|revoke)$/,
	new RegExp(`${SCHOOL}/billing/(refunds|credits/adjust|invoices)$`),
	/^\/family\/pin\/verify$/,
	/^\/family\/step-up$/,
];

export const isLedgerRoute = (pathname: string): boolean =>
	LEDGER_ROUTES.some((route) => route.test(pathname));
