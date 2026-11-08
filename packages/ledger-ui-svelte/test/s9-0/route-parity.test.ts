import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
	allSchools,
	formatRoute,
	parseRoute,
	schoolTabs,
	themeOf,
	withQuery,
} from "$contract/app/route.ts";
import { opensOnTabs } from "../../src/app/shell-model.ts";

/** Route parity (S9-plan D20): the Svelte app imports the Preact package's route module rather than copying it, so
 * the two parse and write every hash alike; these tests prove the import and pin the semantics the shell relies on. */
const sourceRoot = join(import.meta.dir, "../../src");
const filesUnder = (directory: string): string[] =>
	readdirSync(directory).flatMap((name) => {
		const path = join(directory, name);
		return statSync(path).isDirectory() ? filesUnder(path) : [path];
	});
const sources = filesUnder(sourceRoot).filter((file) =>
	/\.(ts|svelte)$/.test(file),
);

describe("route parity with packages/ledger-ui", () => {
	test("the app reads and writes routes only through the contract's route.ts", () => {
		const users = sources.filter((file) =>
			readFileSync(file, "utf8").includes('from "$contract/app/route.ts"'),
		);
		expect(users.length).toBeGreaterThan(0);
		const ownParsers = sources.filter((file) =>
			/function\s+(parseRoute|formatRoute)\b/.test(readFileSync(file, "utf8")),
		);
		expect(ownParsers.map((file) => relative(sourceRoot, file))).toEqual([]);
	});
	test("the seven tabs, in the mockup's order", () => {
		expect([...schoolTabs]).toEqual([
			"plans",
			"dashboard",
			"members",
			"bookings",
			"promos",
			"ledger",
			"reports",
		]);
	});
	test("an unknown school opens the first, an unknown tab opens Plans, All schools has one tab", () => {
		const ids = ["vol", "b4u"];
		expect(formatRoute(parseRoute("#/zzz/ledger", ids))).toBe("#/vol/ledger");
		expect(formatRoute(parseRoute("#/b4u/nope", ids))).toBe("#/b4u/plans");
		expect(formatRoute(parseRoute("#/all/plans?theme=dark", ids))).toBe(
			`#/${allSchools}/${allSchools}?theme=dark`,
		);
		expect(formatRoute(parseRoute("", ids))).toBe("#/vol/plans");
	});
	test("the query passes through untouched", () => {
		const route = parseRoute("#/vol/ledger?month=2026-09&compare=1", ["vol"]);
		expect(formatRoute(withQuery(route, "theme", "dark"))).toBe(
			"#/vol/ledger?month=2026-09&compare=1&theme=dark",
		);
		expect(formatRoute(withQuery(route, "month", null))).toBe(
			"#/vol/ledger?compare=1",
		);
	});
	test("theme=light|dark, anything else is system", () => {
		expect(themeOf(new URLSearchParams("theme=dark"))).toBe("dark");
		expect(themeOf(new URLSearchParams("theme=sepia"))).toBe("system");
	});
	test("the tabs that open on dashboardOpensOn equal the Preact shell's", () => {
		const viewing = readFileSync(
			join(import.meta.dir, "../../../ledger-ui/src/app/viewing.ts"),
			"utf8",
		);
		const declared =
			/opensOnTabs[^=]*=\s*new Set\(\[([^\]]*)\]/.exec(viewing)?.[1] ?? "";
		const preact = [...declared.matchAll(/"([a-z]+)"/g)].map(
			(match) => match[1] ?? "",
		);
		expect(preact.length).toBeGreaterThan(0);
		expect([...opensOnTabs]).toEqual(preact);
	});
});
