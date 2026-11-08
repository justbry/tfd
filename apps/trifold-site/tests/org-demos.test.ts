/**
 * The demo orgs' KPI dashboards (static/demo/orgs/): byte-identical copies of plans/ledger-ui/design/mart/orgs/, the
 * site's preset hashes found in their pages, and how the built site frames, links and leaves them out of the agent
 * files. The build checks need a fresh build; run `bun run build` first.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD, mirrorOf } from "../scripts/agent-files";
import {
	ORG_DEMOS_SOURCE,
	ORG_DEMOS_TARGET,
	orgDemoFiles,
} from "../scripts/sync-org-demos";
import { SITE_ORIGIN } from "../src/lib/config";
import { DASHBOARDS_GALLERY, VERTICALS } from "../src/lib/verticals";

const KPIS_HASH = /"kpisHash":"([0-9a-f]{64})"/g;
const SHORT_HASH = /^([0-9a-f]{8})…([0-9a-f]{4})$/;
/** "/demo/orgs/school" → school.html, "/demo/orgs/" → index.html: the site links the clean URLs Pages serves. */
const staticPage = (url: string) =>
	readFileSync(
		join(ORG_DEMOS_TARGET, `${url.replace("/demo/orgs/", "") || "index"}.html`),
		"utf8",
	);

describe("source", () => {
	test("static/demo/orgs/ holds exactly the generated pages, byte for byte (run `bun run org-demos:sync`)", async () => {
		const files = await orgDemoFiles();
		expect(files).toContain("index.html");
		expect(
			readdirSync(ORG_DEMOS_TARGET)
				.filter((file) => file.endsWith(".html"))
				.sort(),
		).toEqual(files);
		for (const file of files) {
			const same = readFileSync(join(ORG_DEMOS_SOURCE, file)).equals(
				readFileSync(join(ORG_DEMOS_TARGET, file)),
			);
			expect({ file, same }).toEqual({ file, same: true });
		}
	});

	test("every vertical's dashboard exists and says it is a demo on synthetic data", () => {
		for (const url of [
			...VERTICALS.map((vertical) => vertical.dashboard),
			DASHBOARDS_GALLERY,
		])
			expect({
				url,
				synthetic: /synthetic data/i.test(staticPage(url)),
			}).toEqual({
				url,
				synthetic: true,
			});
	});

	test("each preset's KPI hash in verticals.ts is one its org's dashboard embeds", () => {
		for (const vertical of VERTICALS) {
			const hashes = [
				...staticPage(vertical.dashboard).matchAll(KPIS_HASH),
			].map(([, hash = ""]) => hash);
			for (const preset of vertical.presets) {
				const [, head = "", tail = ""] = SHORT_HASH.exec(preset.hash) ?? [];
				const found = hashes.some(
					(hash) => hash.startsWith(head) && hash.endsWith(tail),
				);
				expect({ preset: preset.name, hash: preset.hash, found }).toEqual({
					preset: preset.name,
					hash: preset.hash,
					found: true,
				});
			}
		}
	});

	test("the church's dashboard calls its income Giving, and recurring giving only its MRR", () => {
		const page = staticPage(
			VERTICALS.find((vertical) => vertical.slug === "churches")?.dashboard ??
				"",
		);
		expect(page).toContain('"revenue_by_kind:membership":"Giving"');
		expect(page).toContain('"mrr":"Recurring giving"');
		expect(page.match(/recurring giving/gi)?.length).toBe(1);
	});
});

describe("build output", () => {
	if (!existsSync(join(BUILD, "llms.txt")))
		throw new Error("No build/llms.txt: run `bun run build` before `bun test`");
	const read = (file: string) => readFileSync(join(BUILD, file), "utf8");

	test("the pages ship as they are, framable only by this origin", () => {
		for (const file of readdirSync(ORG_DEMOS_TARGET))
			expect(read(`demo/orgs/${file}`)).toBe(
				readFileSync(join(ORG_DEMOS_TARGET, file), "utf8"),
			);
		const headers = read("_headers");
		const rule = headers.slice(headers.indexOf("\n/demo/orgs/*\n"));
		const block = rule.slice(0, rule.indexOf("\n\n"));
		for (const line of [
			"! Content-Security-Policy",
			"! X-Frame-Options",
			"X-Frame-Options: SAMEORIGIN",
			"frame-ancestors 'self'",
			"default-src 'none'",
		])
			expect(block).toContain(line);
	});

	test("each audience page frames its org's dashboard after mount, and links it in the static HTML and the mirror", () => {
		const embedded: [string, string][] = [
			["/for/schools", "schools"],
			["/for/studios", "studios"],
			["/for/churches", "churches"],
			["/for/saas", "saas"],
			["/for/creators", "creators"],
		];
		const linked: [string, string][] = [
			...embedded,
			["/for/nonprofits", "churches"],
		];
		for (const [path, slug] of linked) {
			const dashboard =
				VERTICALS.find((vertical) => vertical.slug === slug)?.dashboard ?? "";
			const html = read(`${path.slice(1)}.html`);
			const mirror = read(mirrorOf(path));
			expect({
				path,
				iframe: html.includes("<iframe"),
				html: html.includes(`href="${dashboard}"`),
				mirror: mirror.includes(`(${SITE_ORIGIN}${dashboard})`),
			}).toEqual({ path, iframe: false, html: true, mirror: true });
		}
		for (const [path] of embedded)
			expect({
				path,
				gallery: read(mirrorOf(path)).includes(
					`(${SITE_ORIGIN}${DASHBOARDS_GALLERY})`,
				),
			}).toEqual({ path, gallery: true });
	});

	test("no mirror and no sitemap entry for a demo page; llms.txt links each one", () => {
		expect(existsSync(join(BUILD, "demo"))).toBe(true);
		const mirrors = readdirSync(join(BUILD, "demo"), { recursive: true })
			.map(String)
			.filter((file) => file.endsWith(".md"));
		expect(mirrors).toEqual([]);
		expect(read("sitemap.xml")).not.toContain("/demo/");
		const llms = read("llms.txt");
		for (const url of [
			DASHBOARDS_GALLERY,
			...VERTICALS.map((vertical) => vertical.dashboard),
		])
			expect({ url, listed: llms.includes(`${SITE_ORIGIN}${url}`) }).toEqual({
				url,
				listed: true,
			});
		expect(read("llms-full.txt")).not.toContain("tfd-data");
	});
});
