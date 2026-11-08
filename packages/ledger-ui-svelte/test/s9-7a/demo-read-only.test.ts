import { afterEach, expect, test } from "bun:test";
import type { Reader } from "$contract/data/reader.ts";
import { AdapterError } from "$contract/http/errors.ts";
import { memoryStorage } from "$contract/http/pending.ts";
import { ledgerTokenAnswer } from "../../../ledger-ui/test/s8e/recorded.ts";
import { createHttpServices } from "../../src/effect/http-layer.ts";
import { messageFor } from "../../src/effect/messages.ts";
import { toUiError } from "../../src/effect/ui-error.ts";
import {
	click,
	openApp,
	query,
	queryAll,
	textOf,
	until,
} from "../app-harness.ts";
import { apiBase, workerBase } from "./support.ts";

/** The Svelte package's port of `test/s8/demo-read-only.test.ts` and the demo cases of `demo-polish.test.ts` and
 * `demo-bookings-week.test.ts` (Preact package). A demo school refuses every write (`demo_read_only`), so it shows no
 * control that would write: no Confirm attended or No-show on Bookings; no Edit, Add, pencils or Review and publish on
 * Plans; none of the member drawer's money buttons or the menu's writes on Members; and the pane says so
 * ("Demo school: read-only") where the controls would be. A real school still has every one of them. The member's view
 * and the school settings are S9.5's: the sheet says read-only now, and S9.5's own tests port the rest. */
let close: (() => Promise<void>) | null = null;
afterEach(async () => {
	await close?.();
	close = null;
	document.body.innerHTML = "";
});

const open = async (
	hash: string,
	reader?: (fixture: Reader) => Reader,
): Promise<void> => {
	await close?.();
	const page = await openApp(hash, reader ? { reader } : {});
	close = page.app.unmount;
};

/** The fixtures with `id` as a demo school. */
const demoReader =
	(id: string, changes: Record<string, unknown> = {}) =>
	(base: Reader): Reader => ({
		...base,
		schools: async () =>
			(await base.schools()).map((school) =>
				school.id === id ? { ...school, demo: true, ...changes } : school,
			),
	});

const count = (selector: string): number => queryAll(selector).length;

/** How many of each selector the page shows, on the real school and then on the same school as a demo school. */
const countBoth = async (
	hash: string,
	selectors: string[],
	school: string,
	then?: () => Promise<void> | void,
): Promise<{ real: number[]; demo: number[]; notes: number }> => {
	const counts = () => selectors.map((selector) => count(selector));
	await open(hash);
	await then?.();
	const real = counts();
	await open(hash, demoReader(school));
	await then?.();
	return { real, demo: counts(), notes: count("[data-test=demo-read-only]") };
};
const none = (selectors: string[]): number[] => selectors.map(() => 0);

test("Bookings: no Confirm attended, No-show or other row write, no Confirm all, on a demo school", async () => {
	const selectors = [
		"[data-test=booking-action][data-action=confirm]",
		"[data-test=booking-action][data-action=noshow]",
		"[data-test=booking-action]",
		"[data-test=booking-bulk]",
	];
	const { real, demo, notes } = await countBoth(
		"#/vol/bookings?range=day",
		selectors,
		"vol",
	);
	for (const shown of real.slice(0, 3)) expect(shown).toBeGreaterThan(0);
	expect(demo).toEqual(none(selectors));
	expect(notes).toBe(1);
	// The rows are still listed.
	expect(count("[data-test=booking-row]")).toBeGreaterThan(0);
});

test("Plans: no Edit, Add membership, Add pack, pencils or Review and publish on a demo school", async () => {
	const selectors = [
		"[data-test=plan-mode][data-mode=edit]",
		"[data-test=plan-add][data-kind=tiers]",
		"[data-test=plan-add][data-kind=addons]",
		"[data-test=plan-edit]",
		"[data-test=plan-review]",
		"[data-test=plan-mode]",
		"[data-test=plan-ledger-copy]",
	];
	const { real, demo, notes } = await countBoth(
		"#/vol/plans",
		selectors,
		"vol",
	);
	for (const shown of real) expect(shown).toBeGreaterThan(0);
	expect(demo).toEqual(none(selectors));
	expect(notes).toBe(1);
	expect(count("[data-test=plan-setup], [data-test=plan-discard]")).toBe(0);
	// The plans are still listed, and a row opens nothing.
	expect(count("[data-test=plan-row]")).toBeGreaterThan(0);
	click("[data-test=plan-row]");
	await new Promise((resolve) => setTimeout(resolve, 20));
	expect(count("[data-test=plan-drawer]")).toBe(0);
});

test("Plans: ?mode=code on a demo school stays on the tables", async () => {
	await open("#/vol/plans?mode=code", demoReader("vol"));
	expect(count("[data-test=plan-row]")).toBeGreaterThan(0);
	expect(count("[data-test=plan-code]")).toBe(0);
});

test("Members: the drawer has no money buttons and no booking writes on a demo school", async () => {
	const selectors = [
		"[data-test=drawer-action][data-action=invoice]",
		"[data-test=drawer-action][data-action=adjust]",
		"[data-test=drawer-action][data-action=refund]",
	];
	const { real, demo, notes } = await countBoth(
		"#/vol/members?member=m_012",
		selectors,
		"vol",
		() => until(() => count("[data-test=member-drawer]") > 0, "the drawer"),
	);
	for (const shown of real) expect(shown).toBeGreaterThan(0);
	expect(demo).toEqual(none(selectors));
	expect(count("[data-test=drawer-booking] [data-test=booking-action]")).toBe(
		0,
	);
	expect(count("[data-test=drawer-action][data-action=view-as-member]")).toBe(
		1,
	);
	expect(notes).toBe(1);
});

test("Members: a demo school's ⋯ menu lists only what reads", async () => {
	const actions = (): string[] =>
		queryAll("[data-test=member-menu-item]").map(
			(item) => item.dataset.action ?? "",
		);
	const openMenu = async (): Promise<void> => {
		click("[data-test=member-menu-button]");
		await until(() => actions().length > 0, "the menu");
	};
	await open("#/vol/members");
	await openMenu();
	const real = actions();
	await open("#/vol/members", demoReader("vol"));
	await openMenu();
	const demo = actions();
	expect(real).toContain("refund");
	expect(real.length).toBeGreaterThan(demo.length);
	for (const action of demo)
		expect(["view-as-member", "csv", "stripe"]).toContain(action);
	expect(demo).toContain("view-as-member");
	// No separator at either end or two in a row.
	const menu = query("[role=menu]");
	expect(menu?.firstElementChild?.getAttribute("role")).not.toBe("separator");
	expect(menu?.lastElementChild?.getAttribute("role")).not.toBe("separator");
	expect(
		menu?.querySelectorAll("hr + hr, [role=separator] + [role=separator]")
			.length,
	).toBe(0);
});

test("the settings sheet says a demo school is read-only", async () => {
	await open("#/vol/plans");
	click("[data-test=settings-button]");
	await until(() => count("[data-test=settings]") > 0, "the sheet");
	expect(count("[data-test=settings-demo]")).toBe(0);
	await open("#/vol/plans", demoReader("vol"));
	click("[data-test=settings-button]");
	await until(() => count("[data-test=settings]") > 0, "the sheet");
	expect(textOf("[data-test=settings-demo]")).toBe("Demo school: read-only");
});

test("Promos shows the demo note on a demo school, and Plans, Members and Bookings their panes", async () => {
	await open("#/vol/promos", demoReader("vol"));
	expect(textOf("[data-test=demo-tab-note]")).toBe(
		"Not available for demo schools: the demo scenarios hold no promo or gift events.",
	);
	expect(count("[data-test=promo-row], [data-test=promo-new]")).toBe(0);
	for (const tab of ["plans", "members", "bookings"]) {
		await open(`#/vol/${tab}`, demoReader("vol"));
		expect({ tab, notes: count("[data-test=demo-tab-note]") }).toEqual({
			tab,
			notes: 0,
		});
	}
	await open("#/vol/promos");
	expect(count("[data-test=demo-tab-note]")).toBe(0);
});

test("a demo school's Reports has no Edit in school settings; a real school's admin has it", async () => {
	await open("#/vol/reports", demoReader("vol"));
	expect(count("[data-test=report-rules]")).toBe(1);
	expect(count("[data-test=report-rules-edit]")).toBe(0);
	await open("#/vol/reports");
	expect(textOf("[data-test=report-rules-edit]")).toBe(
		"Edit in school settings",
	);
});

test("a demo school opens on its Dashboard, a real one on Plans", async () => {
	await open("#/vol", demoReader("vol"));
	expect(window.location.hash).toStartWith("#/vol/dashboard");
	await open("#/vol");
	expect(window.location.hash).toStartWith("#/vol/plans");
});

test("a demo school whose bookings ended in June opens its Bookings on that week", async () => {
	await open(
		"#/vol/bookings",
		demoReader("vol", { bookingsOpenOn: "2026-06-10" }),
	);
	expect(textOf("[data-test=booking-range-label]")).toBe("Week of Jun 8");
});

/** The HTTP Writer refuses a write on a demo school before any request, with the S9.0 message table's own words. */
test("a write on a demo school is refused before a request, and the message says why", async () => {
	const sent: string[] = [];
	const services = createHttpServices({
		fetch: async (url) => {
			sent.push(url);
			return new Response(JSON.stringify(ledgerTokenAnswer()), { status: 200 });
		},
		apiBase,
		workerBase,
		storage: memoryStorage(),
		newKey: () => "key-1",
		files: { save: () => Promise.resolve() },
	});
	const refused = await services.writer
		.remindHost({ school: "demo-monthly-members", bookingId: "bk_1" })
		.then(
			() => null,
			(error: unknown) => error,
		);
	expect(refused).toBeInstanceOf(AdapterError);
	expect(refused).toMatchObject({
		kind: "read_only",
		detail: { code: "demo_read_only" },
	});
	expect(sent).toEqual([]);
	const message = messageFor(toUiError(refused));
	expect(message.title).toBe("Demo school");
	expect(message.what).toBe("Demo schools are read-only.");
	expect(message.doThis).toBe("Open one of your own schools to make changes.");
});
