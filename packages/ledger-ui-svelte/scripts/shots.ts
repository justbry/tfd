/**
 * Review screenshots of the Svelte shell (S9-plan section 2), the recipe of plans/ledger-ui/loop/tools/shoot.mjs: each
 * entry at 1100, 728 and 390 px in light and dark, the app by hash route plus the entry's clicks, the mockup by a
 * fresh page with the host tokens, an explicit theme and the entry's mockup steps; the viewport width is asserted and
 * a 4-character nonce is drawn into every shot (pixels only). Usage, from packages/ledger-ui-svelte, with the app
 * served (`bun run dev`, or `vite preview` after a build):
 *   bun scripts/shots.ts [--out shots] [--side app|mock|both] [--app http://localhost:5191] [--nonce K7QX]
 *     [--only dash-]
 * `--only` keeps the entries whose id starts with it (the Dashboard's start with `dash-`, Bookings' with `bk-`,
 * Members' with `mem-`, the Ledger's with `led-`, Reports' with `rep-`, the member portal's with `por-`, Settings' with `set-`).
 * Needs playwright-core in /tmp/ledger-shots and the cached Chromium headless shell, as shoot.mjs does.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

type Page = {
	goto(url: string): Promise<unknown>;
	waitForFunction<Argument>(
		check: (argument: Argument) => boolean,
		argument: Argument,
	): Promise<unknown>;
	waitForSelector(selector: string): Promise<unknown>;
	waitForTimeout(milliseconds: number): Promise<void>;
	addStyleTag(options: { content: string }): Promise<unknown>;
	click(selector: string): Promise<void>;
	evaluate<Result, Argument>(
		script: string | ((argument: Argument) => Result),
		argument?: Argument,
	): Promise<Result>;
	screenshot(options: { path: string }): Promise<unknown>;
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

const argument = (name: string, fallback: string): string => {
	const index = process.argv.indexOf(name);
	return (index > 0 ? process.argv[index + 1] : undefined) ?? fallback;
};
const packageRoot = join(import.meta.dir, "..");
const repositoryRoot = join(packageRoot, "..", "..");
const out = join(packageRoot, argument("--out", "shots"));
const side = argument("--side", "both");
const only = argument("--only", "");
const appOrigin = argument("--app", "http://localhost:5191");
const nonce = argument(
	"--nonce",
	Array.from(
		{ length: 4 },
		() => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)],
	).join(""),
);
const mockupUrl = pathToFileURL(
	join(repositoryRoot, "plans/ledger-ui/design/mockup.html"),
).href;
const hostCss = readFileSync(
	join(repositoryRoot, "plans/ledger-ui/design/mockup-host.css"),
	"utf8",
);
const executablePath = join(
	homedir(),
	"Library/Caches/ms-playwright/chromium_headless_shell-1248/chrome-headless-shell-mac-arm64/chrome-headless-shell",
);
const widths = [1100, 728, 390];
const dashboardTab = "document.querySelector('.tab[data-p=dash]').click()";
/** The mockup's Vibes of Light opens with the saved draft the fixtures have (Glow $65 to $70 a month): its Plans shots
 * first run the same change (the S3 golden file's `mockupSteps`). */
const glowDraft =
	"SC.vol.pl.draft.tiers.find(t=>t.id==='glow').month=70;render()";
const promosTab = "document.querySelector('.tab[data-p=cod]').click()";
const bookingsTab = "document.querySelector('.tab[data-p=bk]').click()";
const membersTab = "document.querySelector('.tab[data-p=mem]').click()";
const ledgerTab = "document.querySelector('.tab[data-p=led]').click()";
const reportsTab = "document.querySelector('.tab[data-p=rep]').click()";
const themes = ["light", "dark"] as const;
/** S9.5: the member portal of the b4u family (Dana W. s_21, Kai W. s_25, Lia W. s_26), as the S6 golden file's shots open it. */
const portalOf = (id: string): string =>
	`document.querySelector('#sw').click();document.querySelector('[data-sc=b4u]').click();document.querySelector('.tab[data-p=mem]').click();document.querySelector('#mb tr.row[data-id=${id}] [data-vm]').click()`;
const portalTabStep = (tab: string): string =>
	`document.querySelector('#vm [data-vtab=${tab}]').click()`;
/** The settings drawer open, scrolled so that the section whose heading contains `heading` is at the top. */
const settingsAt = (heading: string): string =>
	`(()=>{const d=document.querySelector('#set');const h=[...d.querySelectorAll('h5')].find(x=>x.textContent.includes(${JSON.stringify(heading)}));d.scrollTop=h.offsetTop-d.offsetTop-14})()`;
const appSettingsAt = (section: string): string =>
	`document.querySelector('[data-test=settings-section][data-section=${section}]').scrollIntoView()`;

/** The shell's entries: the S0 golden file's three shots, then the stale banner, All schools, a toast and the
 * settings; then the Dashboard's (S9.1): each viewer state and grain, the PIN prompt and View as; then Bookings' (S9.2)
 * and Members' (S9.2): the lists, a dialog, the drawer, the menu and a modal. */
const entries: Array<{
	id: string;
	route: string;
	clicks: string[];
	mockupSteps: string;
	/** Run in the page after the steps, in the app and in the mockup (a drawer is scrolled to the section it shows). */
	appAfter?: string;
	/** What the app waits for before `appAfter` (the section is read from the ledger after the drawer opens). */
	appWait?: string;
	mockupAfter?: string;
}> = [
	{
		id: "shell-default",
		route: "#/vol/plans",
		clicks: [],
		mockupSteps: "",
	},
	{
		id: "switcher-open",
		route: "#/vol/plans",
		clicks: ["[data-test=school-switcher]"],
		mockupSteps: "document.querySelector('#sw').click()",
	},
	{
		id: "period-open",
		route: "#/vol/ledger",
		clicks: ["[data-test=period-button]"],
		mockupSteps:
			"document.querySelector('.tab[data-p=led]').click();document.querySelector('#pb').click()",
	},
	{
		id: "stale-school",
		route: "#/map/plans",
		clicks: [],
		mockupSteps: "setSchool('map')",
	},
	{
		id: "all-schools",
		route: "#/all/all",
		clicks: [],
		mockupSteps: "setSchool('all')",
	},
	{
		id: "help-toast",
		route: "#/vol/plans",
		clicks: ["[data-test=help-button]", "[data-test=help-link]"],
		mockupSteps:
			"document.querySelector('#hb').click();document.querySelector('#hp .it').click()",
	},
	{
		id: "settings-open",
		route: "#/vol/plans",
		clicks: ["[data-test=settings-button]"],
		mockupSteps: "document.querySelector('#gb').click()",
	},
	{
		id: "dash-finance-money",
		route: "#/b4u/dashboard",
		clicks: [],
		mockupSteps: `setSchool('b4u');${dashboardTab}`,
	},
	{
		id: "dash-owner-members",
		route: "#/vol/dashboard?view=members",
		clicks: [],
		mockupSteps: `${dashboardTab};dv='members';dashboard()`,
	},
	{
		id: "dash-governance-risk",
		route: "#/b4u/dashboard?preset=disputes&as=governance&view=risk",
		clicks: [],
		mockupSteps: `setSchool('b4u');${dashboardTab};setVa('governance');dsc='disputes';dv='risk';dashboard()`,
	},
	{
		id: "dash-public-year",
		route: "#/b4u/dashboard?as=public&month=2024-01-01..2024-12-31",
		clicks: [],
		mockupSteps: `setSchool('b4u');${dashboardTab};setVa('public')`,
	},
	{
		id: "dash-member-quarter",
		route: "#/har/dashboard",
		clicks: [],
		mockupSteps: `setSchool('har');${dashboardTab}`,
	},
	{
		id: "dash-pin-locked",
		route: "#/b4u/dashboard?as=governance&pin=locked",
		clicks: [],
		mockupSteps: `setSchool('b4u');${dashboardTab};setVa('governance');bkPin=true;render()`,
	},
	{
		id: "dash-view-as-open",
		route: "#/b4u/dashboard",
		clicks: ["[data-test=view-as]"],
		mockupSteps: `setSchool('b4u');${dashboardTab};document.querySelector('#kview').click()`,
	},
	{
		id: "bk-week",
		route: "#/vol/bookings",
		clicks: [],
		mockupSteps: bookingsTab,
	},
	{
		id: "bk-today-overdue",
		route: "#/vol/bookings?range=day",
		clicks: [],
		mockupSteps: `${bookingsTab};bPer={k:"day",off:0};bookings()`,
	},
	{
		id: "bk-filter-outcome",
		route: "#/vol/bookings?filter=outcome",
		clicks: [],
		mockupSteps: `${bookingsTab};bF="out";bookings()`,
	},
	{
		id: "bk-noshow-dialog",
		route: "#/vol/bookings",
		clicks: ["[data-test=booking-action][data-action=noshow]"],
		mockupSteps: `${bookingsTab};document.querySelector('[data-act=noshow]').click()`,
	},
	{
		id: "bk-period-open",
		route: "#/vol/bookings",
		clicks: ["[data-test=period-button]"],
		mockupSteps: `${bookingsTab};document.querySelector('#pb').click()`,
	},
	{
		id: "bk-lock-member",
		route: "#/vol/bookings?as=member",
		clicks: [],
		mockupSteps: `${bookingsTab};setVa('member')`,
	},
	{
		id: "mem-list",
		route: "#/vol/members",
		clicks: [],
		mockupSteps: membersTab,
	},
	{
		id: "mem-drawer",
		route: "#/vol/members?member=m_012",
		clicks: [],
		mockupSteps: `${membersTab};open('m_012')`,
	},
	{
		id: "mem-menu-open",
		route: "#/vol/members",
		clicks: [
			"[data-test=member-row][data-id=m_012] [data-test=member-menu-button]",
		],
		mockupSteps: `${membersTab};document.querySelector('[data-kmenu=m_012]').click()`,
	},
	{
		id: "mem-adjust-modal",
		route: "#/vol/members",
		clicks: [
			"[data-test=member-row][data-id=m_012] [data-test=member-menu-button]",
			"[data-test=member-menu-item][data-action=adjust]",
		],
		mockupSteps: `${membersTab};openAct('adjust','m_012')`,
	},
	{
		id: "mem-lock-public",
		route: "#/vol/members?as=public",
		clicks: [],
		mockupSteps: `${membersTab};setVa('public')`,
	},
	// S9.3: the Plans tab (Edit, Preview, Code, the editor and the review) and Promos.
	{
		id: "plans-edit",
		route: "#/vol/plans",
		clicks: [],
		mockupSteps: glowDraft,
	},
	{
		id: "plans-preview",
		route: "#/vol/plans?mode=preview",
		clicks: [],
		mockupSteps: `${glowDraft};document.querySelector('#pl [data-pmode=preview]').click()`,
	},
	{
		id: "plans-code",
		route: "#/vol/plans?mode=code",
		clicks: [],
		mockupSteps: `${glowDraft};document.querySelector('#pl [data-pmode=code]').click()`,
	},
	{
		id: "plans-drawer",
		route: "#/vol/plans",
		clicks: ["[data-test=plan-row][data-plan=glow] [data-test=plan-edit]"],
		mockupSteps: `${glowDraft};document.querySelector('[data-pe="tiers:glow"]').click()`,
	},
	{
		id: "plans-review",
		route: "#/vol/plans",
		clicks: ["[data-test=plan-review]"],
		mockupSteps: `${glowDraft};document.querySelector('#prev').click()`,
	},
	{
		id: "promos-list",
		route: "#/vol/promos",
		clicks: [],
		mockupSteps: promosTab,
	},
	{
		id: "promos-create",
		route: "#/vol/promos",
		clicks: ["[data-test=promo-new]"],
		mockupSteps: `${promosTab};document.querySelector('#newcode').click()`,
	},
	// S9.4: the Ledger and Reports tabs, each audience's view of them.
	{
		id: "led-default",
		route: "#/vol/ledger",
		clicks: [],
		mockupSteps: ledgerTab,
	},
	{
		id: "led-payments-details",
		route: "#/vol/ledger?type=payment",
		clicks: ["[data-test=ledger-row][data-event=vol-e5]"],
		mockupSteps: `${ledgerTab};document.querySelector('[data-t=payment]').click();document.querySelector('tr.row').click()`,
	},
	{
		id: "led-drill-refund",
		route: "#/vol/ledger?drill=refund",
		clicks: [],
		mockupSteps: `${ledgerTab};document.querySelector('.tab[data-p=rep]').click();document.querySelector('[data-dd=refund]').click()`,
	},
	{
		id: "led-lock-public",
		route: "#/b4u/ledger?as=public",
		clicks: [],
		mockupSteps: `setSchool('b4u');${ledgerTab};setVa('public')`,
	},
	{
		id: "led-pin-locked",
		route: "#/b4u/ledger?as=finance&pin=locked",
		clicks: [],
		mockupSteps: `setSchool('b4u');${ledgerTab};setVa('finance');bkPin=true;render()`,
	},
	{
		id: "rep-finance",
		route: "#/vol/reports",
		clicks: [],
		mockupSteps: reportsTab,
	},
	{
		id: "rep-compare",
		route: "#/vol/reports?compare=1",
		clicks: [],
		mockupSteps: `${reportsTab};cmp=true;render()`,
	},
	{
		id: "rep-governance",
		route: "#/b4u/reports?as=governance&month=2026-06",
		clicks: [],
		mockupSteps: `setSchool('b4u');${reportsTab};setVa('governance')`,
	},
	{
		id: "rep-public",
		route: "#/b4u/reports?as=public&month=2026-06",
		clicks: [],
		mockupSteps: `setSchool('b4u');${reportsTab};setVa('public')`,
	},
	// S9.5: the member portal (each tab, a child's, a site theme, the embed and the change-amount dialogs) and Settings
	// (the drawer, each section, the Stripe dialog, an admin's read-only view).
	{
		id: "por-overview",
		route: "#/b4u/members?portal=s_21",
		clicks: [],
		mockupSteps: portalOf("s_21"),
	},
	{
		id: "por-bookings",
		route: "#/b4u/members?portal=s_21&portalTab=bookings",
		clicks: [],
		mockupSteps: `${portalOf("s_21")};${portalTabStep("bk")}`,
	},
	{
		id: "por-billing",
		route: "#/b4u/members?portal=s_21&portalTab=billing",
		clicks: [],
		mockupSteps: `${portalOf("s_21")};${portalTabStep("bill")}`,
	},
	{
		id: "por-family",
		route: "#/b4u/members?portal=s_21&portalTab=family",
		clicks: [],
		mockupSteps: `${portalOf("s_21")};${portalTabStep("fam")}`,
	},
	{
		id: "por-child",
		route: "#/b4u/members?portal=s_26",
		clicks: [],
		mockupSteps: portalOf("s_26"),
	},
	{
		id: "por-theme-host",
		route: "#/b4u/members?portal=s_21&siteTheme=host",
		clicks: [],
		mockupSteps: `${portalOf("s_21")};var t=document.querySelector('#vth');t.value='host';t.dispatchEvent(new Event('change',{bubbles:true}))`,
	},
	{
		id: "por-embed",
		route: "#/b4u/members?portal=s_21&siteTheme=dark",
		clicks: ["[data-test=portal-embed]"],
		mockupSteps: `${portalOf("s_21")};var t=document.querySelector('#vth');t.value='dark';t.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('#vemb').click()`,
	},
	{
		id: "por-quantity-dialog",
		route: "#/b4u/members?portal=s_21",
		clicks: ["[data-test=portal-action][data-action=quantity]"],
		mockupSteps: `${portalOf("s_21")};document.querySelector('#vm [data-vact=qty]').click()`,
	},
	{
		id: "set-basis",
		route: "#/vol/plans",
		clicks: ["[data-test=settings-button]"],
		mockupSteps: "document.querySelector('#gb').click()",
	},
	{
		id: "set-books",
		route: "#/vol/plans",
		clicks: ["[data-test=settings-button]"],
		mockupSteps: "document.querySelector('#gb').click()",
		appWait: "[data-test=disclosure-row]",
		appAfter: appSettingsAt("books"),
		mockupAfter: settingsAt("School books"),
	},
	{
		id: "set-keys",
		route: "#/vol/plans",
		clicks: ["[data-test=settings-button]"],
		mockupSteps: "document.querySelector('#gb').click()",
		appWait: "[data-test=key-row]",
		appAfter: appSettingsAt("keys"),
		mockupAfter: settingsAt("Keys and access"),
	},
	{
		id: "set-stripe-dialog",
		route: "#/vol/plans",
		clicks: ["[data-test=settings-button]", "[data-test=stripe-connect]"],
		mockupSteps:
			"document.querySelector('#gb').click();document.querySelector('[data-skey]').click()",
	},
	{
		id: "set-admin-readonly",
		route: "#/b4u/plans",
		clicks: ["[data-test=settings-button]"],
		mockupSteps: "setSchool('b4u');document.querySelector('#gb').click()",
	},
].filter((entry) => entry.id.startsWith(only));

const writeNonce = (value: string): void => {
	const element = document.createElement("div");
	element.textContent = value;
	element.style.cssText =
		"position:fixed;right:6px;bottom:6px;z-index:2147483647;font:bold 14px ui-monospace,monospace;background:#ff0;color:#000;padding:2px 6px;border:1px solid #000";
	document.body.appendChild(element);
};

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath });
const files: string[] = [];
const sides = side === "both" ? ["app", "mock"] : [side];
for (const shotSide of sides)
	for (const entry of entries)
		for (const width of widths)
			for (const theme of themes) {
				const page = await browser.newPage({
					viewport: { width, height: 900 },
				});
				if (shotSide === "app") {
					const route = `${entry.route}${entry.route.includes("?") ? "&" : "?"}theme=${theme}`;
					await page.goto(`${appOrigin}/${route}`);
					await page.waitForFunction(
						(hash) => document.getElementById("app")?.dataset.route === hash,
						route,
					);
					for (const click of entry.clicks) await page.click(click);
					if (entry.appWait) await page.waitForSelector(entry.appWait);
					if (entry.appAfter) await page.evaluate(entry.appAfter);
				} else {
					await page.goto(mockupUrl);
					await page.waitForSelector(".tab");
					await page.addStyleTag({ content: hostCss });
					await page.evaluate(
						`theme=${JSON.stringify(theme)};applyTheme();${entry.mockupSteps}`,
					);
					if (entry.mockupAfter) await page.evaluate(entry.mockupAfter);
				}
				await page.waitForTimeout(250);
				if ((await page.evaluate(() => innerWidth)) !== width)
					throw new Error(`viewport is not ${width}`);
				await page.evaluate(writeNonce, nonce);
				const name = `${shotSide}-${entry.id}-${width}-${theme}.png`;
				await page.screenshot({ path: join(out, name) });
				files.push(name);
				await page.close();
			}
await browser.close();
writeFileSync(
	join(out, "manifest.json"),
	`${JSON.stringify({ sides, nonce, files }, null, "\t")}\n`,
);
process.stdout.write(`${files.length} shots in ${out} (nonce ${nonce})\n`);
