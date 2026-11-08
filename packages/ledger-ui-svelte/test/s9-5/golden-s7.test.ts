import { defineGolden, readGolden } from "./golden-runner.ts";

/** Golden file S7 on the Svelte Settings drawer: the entries of the drawer (Appearance, the school's settings, the School
 * books table and its override editor, keys, connections, the dialogs and the gate of the School books section). The View
 * as menu, the period control, the preview banner and the gated Dashboard and Plans surfaces of the same file are the
 * shell's and the other tabs' (S9.0, S9.1, S9.3). See golden-runner.ts for the class map and the intentional differences. */
const settingsEntry = (id: string): boolean =>
	/^(settings-|basis-|key-|stripe-|zeffy-|disclosure-|gate-settings-books-)/.test(
		id,
	) || id === "preview-writes-off";
defineGolden(readGolden("S7.json"), {
	title: "Settings",
	keep: ({ id }) => settingsEntry(id),
	sources: ["settings", "panes", "config"],
	files: ["SettingsSheet.svelte"],
	otherHooks: (hook) =>
		/^(view-as|preview-banner|preview-exit|period-)/.test(hook) ||
		hook === "toast" ||
		hook === "dialog" ||
		hook === "dialog-title",
	matrix: (axis, values) =>
		axis === "surface"
			? values.filter((value) => value === "settings-books")
			: values,
	minimumEntries: 40,
});
