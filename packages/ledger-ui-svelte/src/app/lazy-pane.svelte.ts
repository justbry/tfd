import type { Route } from "$contract/app/route.ts";
import type { School } from "$contract/data/types.ts";
import { toUiError, type UiError } from "../effect/ui-error.ts";
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

/** A pane loaded the first time it is shown, so that the first page load carries none of it (each tab is its own
 * chunk). A chunk that fails to load is the pane's message, with Retry loading it again. */
export function lazyPane<Module>(load: () => Promise<Module>) {
	const state: { module: Promise<Module> | null; error: UiError | null } =
		$state({ module: null, error: null });
	/** Starts the load (or loads again after a failure). */
	const start = (): void => {
		const loading = load();
		state.error = null;
		state.module = loading;
		loading.catch((failure: unknown) => {
			if (state.module === loading) state.error = toUiError(failure);
		});
	};
	return { state, start };
}
