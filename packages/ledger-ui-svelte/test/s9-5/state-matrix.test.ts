import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { flushSync } from "svelte";
import type { MountedApp } from "../../src/app/mount.ts";
import { fixtureObjects } from "../s9-3/config-support.ts";
import { fixtureConfigFor, openPane, until } from "../s9-3/harness.ts";

/**
 * The member portal's and Settings' state matrix: every school's people and every audience a person may preview, against
 * what the contract says about a missing or hidden value (never a 0, never `NaN`, `null` or `undefined` on screen), about
 * who may write (owners; nobody while previewing another audience) and about a control that cannot act (disabled with its
 * reason as the title, or aria-disabled with the reason on the page). One mount per combination; the Preact golden files
 * (golden-s6.test.ts, golden-s7.test.ts) say what each combination shows, this says what none may show.
 */
let mounted: MountedApp | undefined;
/** The first mount of a process compiles the whole app: it is not the first combination's to wait for. */
beforeAll(async () => {
	const warm = await openPane("#/vol/plans?theme=light");
	await pause(20);
	await warm.app.unmount();
	document.body.innerHTML = "";
});
afterEach(async () => {
	await mounted?.unmount();
	mounted = undefined;
	document.body.innerHTML = "";
});
const one = (selector: string): HTMLElement | null =>
	document.querySelector<HTMLElement>(selector);
const all = (selector: string): HTMLElement[] => [
	...document.querySelectorAll<HTMLElement>(selector),
];
const forbidden =
	/\bNaN\b|\bundefined\b|\bnull\b|\[object Object\]|\bInfinity\b/;
const pause = async (turns: number): Promise<void> => {
	for (let turn = 0; turn < turns; turn += 1) {
		flushSync();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
};
const asValues = [
	"",
	"public",
	"member",
	"governance",
	"finance",
	"owner",
	"admin",
] as const;
const queryOf = (as: string): string => (as === "" ? "" : `&as=${as}`);

/** The reason a control that cannot act gives: its title, or the text it is described by. */
const reasonOf = (control: HTMLElement): string => {
	const described = (control.getAttribute("aria-describedby") ?? "")
		.split(" ")
		.map((id) => document.getElementById(id)?.textContent ?? "")
		.join(" ");
	return `${control.title} ${described}`.trim();
};
const off = (control: HTMLElement): boolean =>
	(control as HTMLButtonElement).disabled ||
	control.getAttribute("aria-disabled") === "true";

const portals: Array<[string, string, string]> = [
	["b4u", "s_21", "an adult with a family"],
	["b4u", "s_25", "a teen"],
	["b4u", "s_26", "a child"],
	["b4u", "s_22", "no family"],
	["b4u", "s_27", "a governance audience"],
	["vol", "m_051", "a membership that ended"],
	["vol", "m_204", "an owner's own portal"],
];
describe("the member portal: every person against every audience", () => {
	for (const [school, person, label] of portals)
		for (const as of asValues)
			test(`${school}/${person} (${label}) as ${as || "myself"}`, async () => {
				const opened = await openPane(
					`#/${school}/members?portal=${person}${queryOf(as)}&theme=light`,
				);
				mounted = opened.app;
				await pause(40);
				await until(
					() =>
						one("[data-test=portal]") !== null ||
						one("[data-test=lock-panel]") !== null ||
						one("[data-test=member-row]") !== null,
					"the portal, its lock panel or the roster",
					1200,
				);
				await pause(20);
				expect(document.body.textContent ?? "").not.toMatch(forbidden);
				const portal = one("[data-test=portal]");
				if (!portal) return;
				// The preview's rule: every write is off with its title; Open school books only says it opens.
				const previewing =
					as !== "" && one("[data-test=preview-banner]") !== null;
				for (const action of all("[data-test=portal-action]")) {
					const writes = action.dataset.action !== "books";
					if (previewing && writes) {
						expect((action as HTMLButtonElement).disabled).toBe(true);
						expect(action.title).toBe("Exit preview to act");
					}
					if (off(action)) expect(reasonOf(action)).not.toBe("");
				}
				// A figure the viewer may not see says why; a count is a number.
				for (const available of all("[data-test=portal-available]"))
					expect(available.textContent).toMatch(/^\s*\d+\s*$/);
				expect(opened.writer.calls).toEqual([]);
			});
});

const schools: Array<[string, string]> = [
	["vol", "the owner of Vibes of Light"],
	["b4u", "an admin of B4 Uni"],
	["har", "an admin of Harbor Arts Academy"],
	["map", "the owner of Maple Pilates"],
	["nw", "the owner of Lotus Lane Yoga"],
];
const writeControls = [
	"basis-option",
	"basis-from",
	"basis-save",
	"rules-field",
	"rules-save",
	"key-create",
	"key-revoke",
	"stripe-connect",
	"stripe-remove",
	"zeffy-connect",
	"zeffy-remove",
];
describe("Settings: every school against every audience, nothing stored and everything stored", () => {
	for (const [school, label] of schools)
		for (const as of asValues)
			for (const stored of [false, true]) {
				if (stored && as !== "") continue;
				test(`${school} (${label}) as ${as || "myself"}${stored ? ", stored" : ""}`, async () => {
					const store = fixtureConfigFor();
					if (stored) {
						const objects = await fixtureObjects(school, school);
						for (const name of [
							"settings",
							"booking-rules",
							"disclosure",
						] as const)
							await store.writeBehind(school, name, objects[name]);
					}
					const opened = await openPane(
						`#/${school}/plans?theme=light${queryOf(as)}`,
						{ config: store },
					);
					mounted = opened.app;
					await pause(40);
					(one("[data-test=settings-button]") as HTMLElement).click();
					flushSync();
					await until(
						() =>
							one("[data-test=key-row]") !== null ||
							one("[data-test=keys-empty]") !== null,
						"the settings",
						1500,
					);
					await pause(20);
					expect(document.body.textContent ?? "").not.toMatch(forbidden);
					const previewing = one("[data-test=preview-banner]") !== null;
					const owner = one("[data-test=settings-readonly]") === null;
					for (const name of writeControls)
						for (const control of all(`[data-test=${name}]`)) {
							if (!owner || previewing) {
								expect(off(control)).toBe(true);
								expect(reasonOf(control)).not.toBe("");
							}
						}
					if (!owner || previewing)
						expect(
							store.calls.filter(({ method }) =>
								["verify", "put"].includes(method),
							),
						).toEqual([]);
					// Never a made-up value: a school with no keys says so; every key row names its kind and its use.
					for (const row of all("[data-test=key-row]"))
						expect(row.textContent).toMatch(/Publishable|Secret|Ledger read/);
					expect(opened.writer.calls).toEqual([]);
					// The School books section is the table or its lock panel, never an empty box.
					expect(
						all("[data-test=disclosure-row]").length === 6 ||
							one("[data-test=lock-panel][data-surface=settings-books]") !==
								null,
					).toBe(true);
				});
			}
});
