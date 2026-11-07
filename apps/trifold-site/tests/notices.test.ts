/**
 * The third-party notices (third-party-notices.ts): build/licenses.txt carries the license text of what the browser code
 * ships, the verifier first among them, and the legal page links to it. Needs a fresh build; run `bun run build` first.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD } from "../scripts/agent-files";
import { NOTICES_FILE } from "../third-party-notices";

const path = join(BUILD, NOTICES_FILE);
if (!existsSync(path))
	throw new Error(`No build/${NOTICES_FILE}: run \`bun run build\` first`);
const notices = readFileSync(path, "utf8");

test("the verifier's packages are listed with their license texts", () => {
	expect(notices).toContain("tfd-verify 0.1.0 (Apache-2.0)");
	expect(notices).toContain(
		"Apache License\n                           Version 2.0",
	);
	expect(notices).toMatch(/@noble\/ed25519 [\d.]+ \(MIT\)/);
	expect(notices).toContain("Permission is hereby granted, free of charge");
});

test("the framework and the fonts are listed", () => {
	for (const name of [
		"svelte",
		"@sveltejs/kit",
		"tailwindcss",
		"@fontsource-variable/inter",
	])
		expect(notices).toContain(`\n${name} `);
	expect(notices).toContain("SIL Open Font License");
});

test("the legal page links to the notices", () => {
	const legal = readFileSync(join(BUILD, "legal.html"), "utf8");
	expect(legal).toContain(`href="/${NOTICES_FILE}"`);
});
