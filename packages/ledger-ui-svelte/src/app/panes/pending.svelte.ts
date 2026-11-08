import type { AppContext } from "../context.ts";
import type { Change, PortalChange } from "../members/members-model.ts";

/** What the panes keep for the life of the mount, by school (the Preact shell's `pendingBookings`, `rosterChanges`
 * and `membershipChanges`): the bookings with a write on their way (Bookings and Members both show them), what the
 * roster wrote, and the cancels, resumes and plan changes of the roster and, from S9.5, of the member portal. The
 * tab never re-reads after a write: these are what the ledger has not shipped yet (within 5 minutes). */
export class PanePending {
	#bookings = $state<Record<string, ReadonlySet<string>>>({});
	#roster = $state<Record<string, Change[]>>({});
	#membership = $state<Record<string, Record<string, PortalChange>>>({});

	bookings(school: string): ReadonlySet<string> {
		return this.#bookings[school] ?? emptySet;
	}
	addBookings(school: string, ids: readonly string[]): void {
		this.#bookings[school] = new Set([...this.bookings(school), ...ids]);
	}
	removeBookings(school: string, ids: readonly string[]): void {
		this.#bookings[school] = new Set(
			[...this.bookings(school)].filter((id) => !ids.includes(id)),
		);
	}
	roster(school: string): Change[] {
		return this.#roster[school] ?? [];
	}
	addRoster(school: string, changes: readonly Change[]): void {
		this.#roster[school] = [...this.roster(school), ...changes];
	}
	membership(school: string): Record<string, PortalChange> {
		return this.#membership[school] ?? {};
	}
	mergeMembership(
		school: string,
		personId: string,
		change: PortalChange,
	): void {
		const kept = this.membership(school);
		this.#membership[school] = {
			...kept,
			[personId]: { ...kept[personId], ...change },
		};
	}
}
const emptySet: ReadonlySet<string> = new Set();

const stores = new WeakMap<AppContext, PanePending>();

/** The mount's store: one per app context, made the first time a pane asks. */
export function pendingOf(context: AppContext): PanePending {
	const kept = stores.get(context);
	if (kept) return kept;
	const made = new PanePending();
	stores.set(context, made);
	return made;
}
