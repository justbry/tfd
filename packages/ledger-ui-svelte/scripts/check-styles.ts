/**
 * Gate K: computed-style checks in a real browser (happy-dom has no cascade, so the unit tests cannot see a rule that
 * a later stylesheet overrides). Usage, from packages/ledger-ui-svelte, with the built app served
 * (`bun run build && bunx vite preview --port 5399`, as gates/run.ts does):
 *   bun scripts/check-styles.ts --app http://localhost:5399
 * Needs playwright-core in /tmp/ledger-shots and the cached Chromium headless shell, as scripts/shots.ts does.
 *
 * 1. The tabs row, every tab, light and dark, at 1100, 728 and 390 px, after every pane's stylesheet is loaded: the
 *    active tab has a 2px solid underline in the primary colour, the inactive tabs a 2px transparent one (so that the
 *    row does not move).
 * 2. Cascade audit: a pane's stylesheet loads after app.css, so a plain utility in it can override a rule the first
 *    page load styled the shell with. For the top bar, the tabs row, the stale and preview banners and the toast stack
 *    (with a focused dismiss button, `:focus-visible`), every computed property of every element is read on a fresh
 *    page and again after the Dashboard, Bookings, Members, All schools and the settings sheet have loaded their CSS;
 *    any difference fails.
 * 3. The chosen row of each period popover (the shell's, and the Bookings pane's) is in the primary colour once the
 *    panes' CSS is loaded.
 * 4. Differential (with `--reference <origin>`, a build made with LEDGER_NO_DEDUPE=1, which keeps every rule in every
 *    pane stylesheet): for each pane view and the popover, menu, drawer and dialog states the shots cover, the computed
 *    style of every element outside the shell's chrome is the same in both builds. The deduplicated stylesheets may
 *    not change how a pane looks.
 */

import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

type Page = {
	goto(url: string): Promise<unknown>;
	waitForFunction<Argument>(
		check: (argument: Argument) => boolean,
		argument: Argument,
	): Promise<unknown>;
	waitForSelector(selector: string): Promise<unknown>;
	waitForTimeout(milliseconds: number): Promise<void>;
	click(selector: string): Promise<void>;
	keyboard: { press(key: string): Promise<void> };
	mouse: { move(x: number, y: number): Promise<unknown> };
	evaluate<Result, Argument>(
		script: (argument: Argument) => Result,
		argument?: Argument,
	): Promise<Result>;
	close(): Promise<void>;
};
type Browser = {
	newPage(options: {
		viewport: { width: number; height: number };
	}): Promise<Page>;
	close(): Promise<void>;
};
const require = createRequire("/tmp/ledger-shots/package.json");
const { chromium } = require("playwright-core") as {
	chromium: { launch(options: { executablePath: string }): Promise<Browser> };
};
const argumentOf = (name: string, fallback: string): string => {
	const index = process.argv.indexOf(name);
	return (index > 0 ? process.argv[index + 1] : undefined) ?? fallback;
};
const origin = argumentOf("--app", "http://localhost:5399");
const reference = argumentOf("--reference", "");
const executablePath = join(
	homedir(),
	"Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const widths = [1100, 728, 390];
const themes = ["light", "dark"] as const;
const tabs = [
	"plans",
	"dashboard",
	"members",
	"bookings",
	"promos",
	"ledger",
	"reports",
];
/** The routes that load each lazy stylesheet: the Dashboard, Bookings, Members, All schools; the settings sheet is opened. */
const lazyRoutes = [
	"#/vol/dashboard",
	"#/vol/bookings",
	"#/vol/members",
	"#/all/all",
];
const audited = [
	"[data-test=top-bar]",
	"[data-test=tabs]",
	"[data-test=stale-banner]",
	"[data-test=preview-banner]",
	"[data-test=toasts]",
	"[data-test=period-panel]",
];

const problems: string[] = [];
const browser = await chromium.launch({ executablePath });
const open = async (width: number): Promise<Page> =>
	browser.newPage({ viewport: { width, height: 900 } });
const go = async (page: Page, route: string): Promise<void> => {
	await page.evaluate((hash: string) => {
		window.location.hash = hash;
	}, route);
	await page.waitForFunction(
		(hash: string) => document.getElementById("app")?.dataset.route === hash,
		route,
	);
	await page.waitForTimeout(150);
};
/** Loads the app at `route`, then (when `lazy`) visits every pane that brings a stylesheet and comes back. */
const start = async (
	width: number,
	route: string,
	lazy: boolean,
): Promise<Page> => {
	const page = await open(width);
	await page.goto(`${origin}/${route}`);
	await page.waitForFunction(
		(hash: string) => document.getElementById("app")?.dataset.route === hash,
		route,
	);
	if (lazy) {
		const theme = route.includes("theme=dark") ? "dark" : "light";
		for (const visit of lazyRoutes) await go(page, `${visit}?theme=${theme}`);
		await page.click("[data-test=settings-button]");
		await page.waitForSelector("[data-test=settings]");
		await page.keyboard.press("Escape");
		await page.waitForTimeout(250);
		await go(page, route);
		// Focus returned to the settings button and the pointer rests on it: their styles are not the audit's business.
		await page.mouse.move(1, 899);
		await page.evaluate(() =>
			(document.activeElement as HTMLElement | null)?.blur(),
		);
	}
	return page;
};
const sheetCount = (page: Page): Promise<number> =>
	page.evaluate(() => document.styleSheets.length);

// 1. The tabs row.
for (const theme of themes)
	for (const width of widths) {
		const page = await start(width, `#/vol/plans?theme=${theme}`, true);
		for (const tab of tabs) {
			await go(page, `#/vol/${tab}?theme=${theme}`);
			// The tabs fade their border colour (a transition): read it once it has settled.
			await page.waitForTimeout(400);
			const rows = await page.evaluate(() => {
				const probe = document.createElement("i");
				probe.style.color = "var(--primary)";
				document.body.appendChild(probe);
				const primary = getComputedStyle(probe).color;
				probe.remove();
				return [
					...document.querySelectorAll<HTMLElement>("[data-test=tab]"),
				].map((element) => {
					const style = getComputedStyle(element);
					return {
						tab: element.dataset.tab ?? "",
						active: element.dataset.state === "active",
						width: style.borderBottomWidth,
						style: style.borderBottomStyle,
						color: style.borderBottomColor,
						primary,
					};
				});
			});
			for (const row of rows) {
				const where = `${theme} ${width}px, on ${tab}, tab ${row.tab}`;
				if (row.active !== (row.tab === tab))
					problems.push(`${where}: wrong tab active`);
				if (row.width !== "2px")
					problems.push(`${where}: underline width ${row.width}, not 2px`);
				if (row.active && (row.color !== row.primary || row.style !== "solid"))
					problems.push(
						`${where}: active underline is ${row.style} ${row.color}, not solid ${row.primary}`,
					);
				if (!row.active && row.color !== "rgba(0, 0, 0, 0)")
					problems.push(
						`${where}: inactive underline is ${row.color}, not transparent`,
					);
			}
		}
		await page.close();
	}

// 2. Cascade audit.
type Snapshot = Record<string, Record<string, string>>;
const snapshot = (page: Page, selectors: string[]): Promise<Snapshot> =>
	page.evaluate((list: string[]) => {
		// Transitions would leave a colour half way: the audit compares the settled styles.
		const still = document.createElement("style");
		still.textContent = "*,*::before,*::after{transition:none!important}";
		document.head.appendChild(still);
		const out: Snapshot = {};
		for (const selector of list)
			for (const [index, element] of [
				...document.querySelectorAll(`${selector}, ${selector} *`),
			].entries()) {
				const style = getComputedStyle(element);
				const properties: Record<string, string> = {};
				for (const property of style)
					properties[property] = style.getPropertyValue(property);
				out[`${selector} #${index} <${element.tagName.toLowerCase()}>`] =
					properties;
			}
		still.remove();
		return out;
	}, selectors);
const scenarios: Array<{
	name: string;
	route: string;
	act?: (page: Page) => Promise<void>;
}> = [
	{ name: "shell", route: "#/vol/plans" },
	{
		name: "period popover, chosen row",
		route: "#/vol/plans",
		act: async (page) => {
			await page.click("[data-test=period-button]");
			await page.waitForSelector(
				"[data-test=period-option][aria-current=true]",
			);
			await page.waitForTimeout(250);
		},
	},
	{ name: "stale banner", route: "#/map/plans" },
	{ name: "preview banner", route: "#/vol/plans?as=admin" },
	{
		name: "toast, dismiss focused (:focus-visible)",
		route: "#/vol/plans",
		act: async (page) => {
			await page.click("[data-test=help-button]");
			await page.click("[data-test=help-link]");
			await page.waitForSelector("[data-test=toast-dismiss]");
			await page.keyboard.press("Shift");
			await page.evaluate(() =>
				(
					document.querySelector("[data-test=toast-dismiss]") as HTMLElement
				).focus(),
			);
			await page.waitForTimeout(250);
		},
	},
];
for (const theme of themes)
	for (const width of [1100, 390])
		for (const scenario of scenarios) {
			const route = `${scenario.route}${scenario.route.includes("?") ? "&" : "?"}theme=${theme}`;
			const fresh = await start(width, route, false);
			await scenario.act?.(fresh);
			await fresh.mouse.move(1, 899);
			const before = await snapshot(fresh, audited);
			const freshSheets = await sheetCount(fresh);
			await fresh.close();
			const loaded = await start(width, route, true);
			await scenario.act?.(loaded);
			await loaded.mouse.move(1, 899);
			const after = await snapshot(loaded, audited);
			if ((await sheetCount(loaded)) <= freshSheets)
				problems.push(
					`${scenario.name}: no pane stylesheet was added, the audit proves nothing`,
				);
			await loaded.close();
			const where = `${scenario.name}, ${theme} ${width}px`;
			if (Object.keys(before).length < 5)
				problems.push(
					`${where}: only ${Object.keys(before).length} elements audited`,
				);
			for (const key of Object.keys(before)) {
				const changed = Object.keys(before[key] ?? {}).filter(
					(property) => before[key]?.[property] !== after[key]?.[property],
				);
				if (changed.length > 0)
					problems.push(
						`${where}: ${key} changes once the panes' CSS is loaded: ${changed
							.slice(0, 4)
							.map(
								(property) =>
									`${property} ${before[key]?.[property]} -> ${after[key]?.[property]}`,
							)
							.join("; ")}`,
					);
			}
		}
// 3. The chosen row of each period popover.
const colorOf = (page: Page, selector: string): Promise<string> =>
	page.evaluate((target: string) => {
		const element = document.querySelector(target);
		return element ? getComputedStyle(element).color : "no element";
	}, selector);
for (const theme of themes) {
	const page = await start(1100, `#/vol/plans?theme=${theme}`, true);
	for (const [route, label] of [
		[`#/vol/plans?theme=${theme}`, "the shell's period popover"],
		[`#/vol/bookings?theme=${theme}`, "the Bookings period popover"],
	] as const) {
		await go(page, route);
		await page.click("[data-test=period-button]");
		await page.waitForSelector("[data-test=period-option][aria-current=true]");
		await page.waitForTimeout(300);
		const primary = await page.evaluate(() => {
			const probe = document.createElement("i");
			probe.style.color = "var(--primary)";
			document.body.appendChild(probe);
			const color = getComputedStyle(probe).color;
			probe.remove();
			return color;
		});
		const chosen = await colorOf(
			page,
			"[data-test=period-option][aria-current=true]",
		);
		if (chosen !== primary)
			problems.push(
				`${theme}: the chosen row of ${label} is ${chosen}, not ${primary}`,
			);
		await page.keyboard.press("Escape");
		await page.waitForTimeout(150);
	}
	await page.close();
}

// 4. Differential against the build that keeps every rule in every pane stylesheet.
const clicked =
	(...selectors: string[]) =>
	async (page: Page): Promise<void> => {
		for (const selector of selectors) {
			await page.waitForSelector(selector);
			await page.click(selector);
		}
	};
const rowMenu =
	"[data-test=member-row][data-id=m_012] [data-test=member-menu-button]";
const paneStates: Array<{
	name: string;
	route: string;
	act?: (page: Page) => Promise<void>;
}> = [
	{ name: "bookings, this week", route: "#/vol/bookings" },
	{
		name: "bookings, today with the overdue group",
		route: "#/vol/bookings?range=day",
	},
	{ name: "bookings, filtered", route: "#/vol/bookings?filter=outcome" },
	{
		name: "bookings, no-show dialog",
		route: "#/vol/bookings",
		act: clicked("[data-test=booking-action][data-action=noshow]"),
	},
	{
		name: "bookings, release dialog",
		route: "#/vol/bookings",
		act: clicked(
			"[data-test=booking-action][data-action=release][data-booking=bk_5kd]",
		),
	},
	{
		name: "bookings, period popover",
		route: "#/vol/bookings",
		act: clicked("[data-test=period-button]"),
	},
	{ name: "bookings, lock panel", route: "#/vol/bookings?as=member" },
	{ name: "members, list", route: "#/vol/members" },
	{ name: "members, filtered", route: "#/vol/members?show=attention" },
	{ name: "members, drawer", route: "#/vol/members?member=m_012" },
	{ name: "members, row menu", route: "#/vol/members", act: clicked(rowMenu) },
	{
		name: "members, adjust modal",
		route: "#/vol/members",
		act: clicked(rowMenu, "[data-test=member-menu-item][data-action=adjust]"),
	},
	{
		name: "members, refund modal",
		route: "#/vol/members",
		act: clicked(rowMenu, "[data-test=member-menu-item][data-action=refund]"),
	},
	{
		name: "members, role modal",
		route: "#/vol/members",
		act: clicked(
			"[data-test=member-row][data-id=m_093] [data-test=member-menu-button]",
			"[data-test=member-menu-item][data-action=remove-admin]",
		),
	},
	{ name: "members, lock panel", route: "#/vol/members?as=public" },
	{ name: "dashboard, owner members", route: "#/vol/dashboard?view=members" },
	{ name: "dashboard, finance money", route: "#/b4u/dashboard" },
	{
		name: "dashboard, PIN locked",
		route: "#/b4u/dashboard?as=governance&pin=locked",
	},
	{ name: "all schools", route: "#/all/all" },
	{
		name: "settings sheet",
		route: "#/vol/plans",
		act: clicked("[data-test=settings-button]"),
	},
];
/** Every element inside a pane or outside the app's frame (dialogs, menus, sheets, popovers; the Bookings period control
 * is the pane's), with its computed style, once animations and transitions are off. The frame's own elements are the
 * audit's (their layout also differs in the reference build, where a pane's repeated rule hits the shell), so the sizes
 * and offsets that follow from them are left out: what is compared is every other property. */
const paneSnapshot = (page: Page): Promise<Snapshot> =>
	page.evaluate(() => {
		const still = document.createElement("style");
		still.textContent =
			"*,*::before,*::after{transition:none!important;animation:none!important}";
		document.head.appendChild(still);
		const out: Record<string, Record<string, string>> = {};
		let index = 0;
		for (const element of document.body.querySelectorAll("*")) {
			if (["SCRIPT", "STYLE", "LINK"].includes(element.tagName)) continue;
			const chrome = element.closest(
				"[data-test=top-bar],[data-test=tabs],[data-test=stale-banner],[data-test=preview-banner],[data-test=toasts]",
			);
			if (chrome && !element.closest("[data-test=period-slot]")) continue;
			const inside =
				element.closest(
					"[data-pane],[data-test=pane],[data-test=period-slot]",
				) !== null || element.closest("#app") === null;
			// The Bookings period button carries the shell's Button classes: in the reference build its 640px sizes lose to
			// a repeated rule, which is the very thing the deduplication cures.
			if (
				!inside ||
				element.matches("[data-test=pane]") ||
				element.closest("[data-test=period-button]")
			)
				continue;
			const style = getComputedStyle(element);
			const properties: Record<string, string> = {};
			for (const property of style)
				if (
					!/^(--|width|height|inline-size|block-size|min-|max-|perspective-origin|transform-origin|top|left|right|bottom|inset)/.test(
						property,
					)
				)
					properties[property] = style.getPropertyValue(property);
			out[
				`#${index} <${element.tagName.toLowerCase()}${element.getAttribute("data-test") ? ` ${element.getAttribute("data-test")}` : ""}>`
			] = properties;
			index += 1;
		}
		still.remove();
		return out;
	});
const stateOf = async (
	base: string,
	width: number,
	route: string,
	act?: (page: Page) => Promise<void>,
): Promise<Snapshot> => {
	const page = await open(width);
	await page.goto(`${base}/${route}`);
	await page.waitForFunction(
		(hash: string) => document.getElementById("app")?.dataset.route === hash,
		route,
	);
	await page.waitForTimeout(300);
	await act?.(page);
	await page.waitForTimeout(400);
	await page.mouse.move(1, 899);
	await page.evaluate(() =>
		(document.activeElement as HTMLElement | null)?.blur(),
	);
	const snap = await paneSnapshot(page);
	await page.close();
	return snap;
};
if (reference)
	for (const theme of themes)
		for (const width of [1100, 390])
			for (const state of paneStates) {
				const route = `${state.route}${state.route.includes("?") ? "&" : "?"}theme=${theme}`;
				const deduped = await stateOf(origin, width, route, state.act);
				const whole = await stateOf(reference, width, route, state.act);
				const where = `${state.name}, ${theme} ${width}px`;
				const keys = Object.keys(whole);
				if (keys.length !== Object.keys(deduped).length) {
					problems.push(
						`${where}: ${Object.keys(deduped).length} elements, ${keys.length} in the reference build`,
					);
					continue;
				}
				if (keys.length < 5)
					problems.push(`${where}: only ${keys.length} elements compared`);
				let reported = 0;
				for (const key of keys) {
					const changed = Object.keys(whole[key] ?? {}).filter(
						(property) => whole[key]?.[property] !== deduped[key]?.[property],
					);
					if (changed.length > 0 && reported < 3) {
						reported += 1;
						problems.push(
							`${where}: ${key} differs from the reference build: ${changed
								.slice(0, 4)
								.map(
									(property) =>
										`${property} ${whole[key]?.[property]} (reference) -> ${deduped[key]?.[property]}`,
								)
								.join("; ")}`,
						);
					}
				}
			}
await browser.close();
if (problems.length > 0) {
	process.stdout.write(
		`${problems.length} style problems:\n${problems.slice(0, 40).join("\n")}\n`,
	);
	process.exit(1);
}
process.stdout.write(
	`computed styles hold: tabs (every tab, light and dark, 3 widths), the shell after the panes' CSS loads, the chosen period rows${reference ? ", and every pane state against the reference build" : ""}\n`,
);
