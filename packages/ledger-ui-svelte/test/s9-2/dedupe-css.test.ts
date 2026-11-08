import { describe, expect, test } from "bun:test";
import { dedupeCss, knownRules } from "../../build/dedupe-lazy-css.ts";

/** The stylesheet deduplication (build/dedupe-lazy-css.ts) on the cases that matter to the cascade; gate K compares
 * the whole app with the one-stylesheet build in a real browser. */
const known = (entry: string) => knownRules(entry);

describe("dedupeCss", () => {
	test("a rule app.css writes in a selector group is found, so the chosen row's classes keep Tailwind's order", () => {
		// The pane: .text-foreground then .text-primary (alphabetical, so the second wins on a chosen row).
		const entry =
			"@layer utilities{.text-foreground,.text-foreground\\/60{color:var(--foreground)}.text-primary{color:var(--primary)}}";
		const pane =
			"@layer utilities{.text-foreground{color:var(--foreground)}.text-primary{color:var(--primary)}}";
		// Both go: the pane keeps neither, so app.css's order stands. (Matching the group word for word kept
		// `.text-foreground` in the pane, after app.css's `.text-primary`, and the foreground colour won.)
		expect(dedupeCss(pane, known(entry))).toBe("");
	});
	test("a group loses only the selectors app.css has", () => {
		const entry = "@layer utilities{.a{color:red}}";
		const pane = "@layer utilities{.a,.b{color:red}}";
		expect(dedupeCss(pane, known(entry))).toBe(
			"@layer utilities{.b{color:red}}",
		);
	});
	test("a rule is compared inside its own at-rule", () => {
		const entry = "@layer utilities{@media (width<=640px){.a{color:red}}}";
		const pane =
			"@layer utilities{.a{color:red}@media (width<=640px){.a{color:red}}}";
		expect(dedupeCss(pane, known(entry))).toBe(
			"@layer utilities{.a{color:red}}",
		);
	});
	test("an escaped quote in a class selector does not open a string", () => {
		const entry =
			"@layer utilities{.\\[\\&_svg\\:not\\(\\[class\\*\\=\\'size-\\'\\]\\)\\]\\:size-4 svg{width:1rem}.x{color:red}}";
		const pane = "@layer utilities{.x{color:red}.y{color:blue}}";
		expect(dedupeCss(pane, known(entry))).toBe(
			"@layer utilities{.y{color:blue}}",
		);
	});
	test("a rule the pane has and app.css lacks stays", () => {
		expect(
			dedupeCss(
				"@layer utilities{.y{color:blue}}",
				known("@layer utilities{.x{color:red}}"),
			),
		).toBe("@layer utilities{.y{color:blue}}");
	});
});
