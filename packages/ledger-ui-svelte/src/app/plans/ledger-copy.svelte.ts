import type { PlansDraftConfig } from "$worker-config/types.ts";
import { ConfigEditor } from "../config/config-editor.svelte.ts";
import type { AppContext } from "../context.ts";

export type { Conflict } from "../config/config-editor.svelte.ts";
export const objectName = "plans-draft" as const;

/** The Plans tab's copy in the ledger (S9-plan D18, D22): the `plans-draft` config object (draft copy, tier order, tier
 * audience; no prices), edited here and written through the Worker's config routes. The verify, save, conflict and
 * step-up flow is the config editor's, shared with the Settings tab (S9.5). */
export class LedgerCopy extends ConfigEditor<typeof objectName> {
	constructor(options: {
		app: AppContext;
		school: string;
		/** The copy of the draft menu, for a school with nothing stored yet. */
		seed: () => PlansDraftConfig;
	}) {
		super({
			app: options.app,
			school: options.school,
			name: objectName,
			seed: { value: options.seed },
			owner: `ledger-copy-${options.school}`,
		});
	}
}
