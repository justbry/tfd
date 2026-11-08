import { defineGolden, readGolden } from "./golden-runner.ts";

/** Golden file S6 (the member portal) on the Svelte portal: every entry (see golden-runner.ts for the class map and the
 * intentional differences). The hooks of the shared dialog and the toast are the shell's and the other panes'. */
defineGolden(readGolden("S6.json"), {
	title: "member portal",
	keep: () => true,
	sources: ["portal", "panes"],
	otherHooks: (hook) => hook === "toast" || hook === "lock-panel",
	minimumEntries: 60,
});
