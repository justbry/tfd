import type { AppContext } from "../context.ts";
import type { AudienceMove, PlansSession } from "./plans-menu.ts";

/** What the Plans tab keeps for the life of the mount (the Preact Shell's `sessions` and `audienceMoves`): each school's
 * session (the live menu, the draft all three views show, the facts around them), so a draft survives leaving the tab,
 * and the tiers a publish gave another audience, for the member portal (S9.5) to read. */
export class PlansStore {
	sessions: Record<string, PlansSession> = $state.raw({});
	moves: Record<string, Record<string, AudienceMove>> = $state.raw({});

	/** The session after `next`, which is a session or a function of the one there is (a save that settles late). */
	set(
		school: string,
		next: PlansSession | ((before: PlansSession) => PlansSession),
	): void {
		const before = this.sessions[school];
		if (typeof next === "function") {
			if (before) this.sessions = { ...this.sessions, [school]: next(before) };
			return;
		}
		this.sessions = { ...this.sessions, [school]: next };
	}

	/** Records tiers whose audience a publish changed; a tier moved again replaces its earlier move. */
	move(school: string, moves: Record<string, AudienceMove>): void {
		this.moves = {
			...this.moves,
			[school]: { ...this.moves[school], ...moves },
		};
	}
}

const stores = new WeakMap<AppContext["runtime"], PlansStore>();

/** The mount's store: one per Effect runtime, so that a test's next mount starts empty. */
export function plansStoreOf(app: Pick<AppContext, "runtime">): PlansStore {
	let store = stores.get(app.runtime);
	if (!store) {
		store = new PlansStore();
		stores.set(app.runtime, store);
	}
	return store;
}
