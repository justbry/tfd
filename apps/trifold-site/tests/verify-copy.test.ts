/**
 * tfd-verify is a `file:` dependency, which bun copies into node_modules at install time: a change to
 * packages/verify/src reaches the site (and its tests) only after `bun install` here. This fails when the copy is stale.
 */
import { expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = join(import.meta.dir, "../../../packages/verify/src");
const INSTALLED = join(import.meta.dir, "../node_modules/tfd-verify/src");

const filesOf = (directory: string): Record<string, string> =>
	Object.fromEntries(
		readdirSync(directory, { recursive: true, withFileTypes: true })
			.filter((entry) => entry.isFile())
			.map((entry) => {
				const path = join(entry.parentPath, entry.name);
				return [path.slice(directory.length + 1), readFileSync(path, "utf8")];
			})
			.sort(([a], [b]) => (a < b ? -1 : 1)),
	);

test("node_modules/tfd-verify/src is packages/verify/src", () => {
	if (!existsSync(INSTALLED))
		throw new Error(
			"node_modules/tfd-verify is missing: run bun install in apps/trifold-site",
		);
	const installed = filesOf(INSTALLED);
	const source = filesOf(SOURCE);
	const stale = [
		...new Set([...Object.keys(installed), ...Object.keys(source)]),
	].filter((name) => installed[name] !== source[name]);
	if (stale.length > 0)
		throw new Error(
			`node_modules/tfd-verify is stale (${stale.join(", ")}): run bun install in apps/trifold-site`,
		);
	expect(installed).toEqual(source);
});
