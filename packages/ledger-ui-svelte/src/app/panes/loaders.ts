/** Where the Bookings, Members and member portal panes come from, one hop behind the shell: the shell imports this small module on
 * demand, and it imports the panes. The shell's first page load then names one chunk for both tabs (a chunk's name and
 * the names of what it shares are part of what the first page load downloads), not two chunks and what they share. */
export const loaders = {
	bookings: () => import("../bookings/Bookings.svelte"),
	members: () => import("../members/Members.svelte"),
	portal: () => import("../portal/Portal.svelte"),
	ledger: () => import("../ledger/Ledger.svelte"),
	reports: () => import("../reports/Reports.svelte"),
	plans: () => import("../plans/Plans.svelte"),
	promos: () => import("../promos/Promos.svelte"),
};
