/**
 * Review screenshots of the Svelte shell (S9-plan section 2), the recipe of plans/ledger-ui/loop/tools/shoot.mjs: each
 * entry at 1100, 728 and 390 px in light and dark, the app by hash route plus the entry's clicks, the mockup by a
 * fresh page with the host tokens, an explicit theme and the entry's mockup steps; the viewport width is asserted and
 * a 4-character nonce is drawn into every shot (pixels only). Usage, from packages/ledger-ui-svelte, with the app
 * served (`bun run dev`, or `vite preview` after a build):
 *   bun scripts/shots.ts [--out shots] [--side app|mock|both] [--app http://localhost:5191] [--nonce K7QX]
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
const themes = ["light", "dark"] as const;

/** The shell's entries: the S0 golden file's three shots, then the stale banner, All schools, a toast and the
 * settings. */
const entries: Array<{
	id: string;
	route: string;
	clicks: string[];
	mockupSteps: string;
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
];

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
					const route = `${entry.route}?theme=${theme}`;
					await page.goto(`${appOrigin}/${route}`);
					await page.waitForFunction(
						(hash) => document.getElementById("app")?.dataset.route === hash,
						route,
					);
					for (const click of entry.clicks) await page.click(click);
				} else {
					await page.goto(mockupUrl);
					await page.waitForSelector(".tab");
					await page.addStyleTag({ content: hostCss });
					await page.evaluate(
						`theme=${JSON.stringify(theme)};applyTheme();${entry.mockupSteps}`,
					);
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
