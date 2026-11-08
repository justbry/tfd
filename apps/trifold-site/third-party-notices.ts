/**
 * Writes /licenses.txt into the client build: every npm package whose code the browser bundle ships (Svelte, tfd-verify,
 * @noble/ed25519, ...), with its version, license and license text, as their licenses ask of a redistribution
 * (Apache-2.0 section 4, MIT's notice, the fonts' OFL). The minifier drops their license comments, so this file carries
 * them. It lists the packages of the modules the client build actually bundled, so it can't drift from what ships, plus
 * the packages that reach the build only through the stylesheet (Tailwind, the fonts), which the module graph doesn't
 * see: `stylesheetPackages` names those, and the build fails if one isn't installed. The site itself is proprietary.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

export const NOTICES_FILE = "licenses.txt";

/** The last node_modules/<name>/ in a module id: the package that owns it (scoped names included). */
const PACKAGE_DIRECTORY = /^(.*\/node_modules\/((?:@[^/]+\/)?[^/]+))\//;
/** LICENSE, LICENSE.md, LICENSE-MIT, COPYING.txt, ...: a dual-licensed package may ship more than one. */
const LICENSE_FILE = /^(licen[cs]e|copying)([.-][\w.-]+)?$/i;
/** Apache-2.0 section 4(d): a redistribution carries the package's NOTICE file too. */
const NOTICE_FILE = /^notice(\.(md|txt))?$/i;
/** Rollup's prefix for virtual module ids. */
const VIRTUAL_PREFIX = /^\0/;

const byName = (a: { name: string }, b: { name: string }): number => {
	if (a.name < b.name) return -1;
	if (a.name > b.name) return 1;
	return 0;
};

type BundledPackage = {
	name: string;
	version: string;
	license: string;
	text: string;
};

const packageOf = (directory: string): BundledPackage => {
	const manifest = JSON.parse(
		readFileSync(join(directory, "package.json"), "utf8"),
	) as { name: string; version?: string; license?: unknown };
	const license =
		typeof manifest.license === "string" ? manifest.license : undefined;
	const files = readdirSync(directory).sort();
	const texts = [
		...files.filter((file) => LICENSE_FILE.test(file)),
		...files.filter((file) => NOTICE_FILE.test(file)),
	].map((file) => readFileSync(join(directory, file), "utf8").trim());
	return {
		name: manifest.name,
		version: manifest.version ?? "",
		license: license ?? "see its license text",
		text:
			texts.length > 0
				? texts.join("\n\n")
				: `No license file; package.json says ${license ?? "nothing"}.`,
	};
};

/** The text of licenses.txt for the packages in these package directories. */
const noticesFor = (directories: ReadonlySet<string>): string => {
	const packages = [...directories].map(packageOf).sort(byName);
	const sections = packages.map(
		(bundled) =>
			`${bundled.name} ${bundled.version} (${bundled.license})\n\n${bundled.text}`,
	);
	return `Third-party software in this site's browser code, with its licenses.

The Trifold website itself is proprietary, all rights reserved. It ships the
packages below, each under its own license. The in-browser receipt verifier is
tfd-verify (Apache-2.0).

${sections.join(`\n\n${"=".repeat(78)}\n\n`)}\n`;
};

export const thirdPartyNotices = ({
	stylesheetPackages,
}: {
	stylesheetPackages: readonly string[];
}): Plugin => ({
	name: "trifold:third-party-notices",
	apply: "build",
	generateBundle(_options, bundle) {
		if (this.environment.name !== "client") return;
		const directories = new Set<string>();
		for (const name of stylesheetPackages) {
			const directory = join(
				this.environment.config.root,
				"node_modules",
				name,
			);
			if (!existsSync(join(directory, "package.json")))
				throw new Error(`third-party notices: ${name} is not installed`);
			directories.add(directory);
		}
		for (const output of Object.values(bundle)) {
			if (output.type !== "chunk") continue;
			for (const id of output.moduleIds) {
				const directory = PACKAGE_DIRECTORY.exec(
					id.replace(VIRTUAL_PREFIX, ""),
				)?.[1];
				if (!directory || directories.has(directory)) continue;
				if (existsSync(join(directory, "package.json")))
					directories.add(directory);
			}
		}
		this.emitFile({
			type: "asset",
			fileName: NOTICES_FILE,
			source: noticesFor(directories),
		});
	},
});
