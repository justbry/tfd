/**
 * The third-party notices (third-party-notices.ts): build/licenses.txt carries the license text of what the browser code
 * ships, the verifier first among them, and the legal page links to it. Needs a fresh build: without one each test fails
 * saying to run `bun run build` first.
 */
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { BUILD } from "../scripts/agent-files";
import { NOTICES_FILE } from "../third-party-notices";

/** A file of the last build, or an error saying to build first. */
const readBuild = (name: string): string => {
	const path = join(BUILD, name);
	if (!existsSync(path))
		throw new Error(
			`No build/${name}: run \`bun run build\` in apps/trifold-site first`,
		);
	return readFileSync(path, "utf8");
};

test("the verifier's packages are listed with their license texts", () => {
	const notices = readBuild(NOTICES_FILE);
	expect(notices).toContain("tfd-verify 0.1.0 (Apache-2.0)");
	expect(notices).toContain(
		"Apache License\n                           Version 2.0",
	);
	expect(notices).toMatch(/@noble\/ed25519 [\d.]+ \(MIT\)/);
	expect(notices).toContain("Permission is hereby granted, free of charge");
});

test("the framework and the fonts are listed", () => {
	const notices = readBuild(NOTICES_FILE);
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
	const legal = readBuild("legal.html");
	expect(legal).toContain(`href="/${NOTICES_FILE}"`);
});
