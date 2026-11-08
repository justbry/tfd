import type { Route } from "$contract/app/route.ts";
import type { School } from "$contract/data/types.ts";
import type { Viewing } from "./viewing.ts";

/** What the shell hands a school's tab pane: the route, the school and what the route views, and the ways back out. A
 * pane takes the ones it uses. */
export type PaneProps = {
	route: Route;
	school: School;
	viewing: Viewing;
	navigate: (route: Route) => void;
	/** Says the route's data, or its message, is on screen. */
	onRendered: (hash: string) => void;
	/** Get started's Connect Stripe: the settings drawer. */
	onOpenSettings: () => void;
	/** Says whether the school's Plans draft differs from its live menu (the tabs row's draft badge). */
	onDraftChange: (school: string, changed: boolean) => void;
};
