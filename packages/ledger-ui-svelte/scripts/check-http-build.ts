/**
 * The staging check's three questions about a deployed bundle (packages/ledger-worker/scripts/staging-e2e.ts stage 1:
 * `bundle-api-host`, `bundle-http-build`), asked of a build here, before it is deployed. Usage, from
 * packages/ledger-ui-svelte:
 *   bun scripts/check-http-build.ts <http-build-dir> [<fixture-build-dir>]
 * The HTTP build (`VITE_LEDGER_SOURCE=http VITE_API_BASE=https://api-staging.b4uni.com`) must hold the staging API host
 * and the signed-out demo alert's words ("I have signed in", the check's marker), and none of the production API host
 * or the five fixture schools' names. The fixture build, when given, must hold neither the marker nor the host: it is
 * what the staging check refuses to find deployed. Exits 1, with the reasons, when any of it fails.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	findFixtureNames,
	fixtureSchoolNames,
	STAGING_API,
} from "../../ledger-worker/scripts/staging-e2e.ts";

/** staging-e2e.ts `HTTP_BUILD_MARKER` and `PROD_API_PATTERN` (not exported there; test/s9-7a compares). */
export const httpBuildMarker = "I have signed in";
export const productionApiPattern = /(?<![\w-])api\.b4uni\.com/;

const scripts = (directory: string): string[] =>
	readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
		entry.isDirectory()
			? scripts(join(directory, entry.name))
			: entry.name.endsWith(".js")
				? [join(directory, entry.name)]
				: [],
	);
const bundleOf = (directory: string): string =>
	scripts(directory)
		.map((file) => readFileSync(file, "utf8"))
		.join("\n");

export async function problemsOfHttpBuild(
	directory: string,
): Promise<string[]> {
	const bundle = bundleOf(directory);
	const host = new URL(STAGING_API).host;
	const problems: string[] = [];
	if (!bundle.includes(host))
		problems.push(`${directory} does not hold ${host}`);
	if (productionApiPattern.test(bundle))
		problems.push(
			`${directory} mentions the production API host api.b4uni.com`,
		);
	if (!bundle.includes(httpBuildMarker))
		problems.push(`${directory} does not hold "${httpBuildMarker}"`);
	const names = await fixtureSchoolNames();
	if (names.length !== 5)
		problems.push(`expected 5 fixture school names, found ${names.length}`);
	const hits = findFixtureNames(bundle, names);
	if (hits.length > 0)
		problems.push(
			`${directory} holds fixture school names: ${hits.join(", ")}`,
		);
	return problems;
}

export function problemsOfFixtureBuild(directory: string): string[] {
	const bundle = bundleOf(directory);
	return bundle.includes(httpBuildMarker)
		? [
				`${directory} holds "${httpBuildMarker}": a deployed fixture build would pass the staging check`,
			]
		: [];
}

if (import.meta.main) {
	const [httpDirectory, fixtureDirectory] = process.argv.slice(2);
	if (!httpDirectory)
		throw new Error(
			"usage: check-http-build.ts <http-build-dir> [<fixture-build-dir>]",
		);
	const problems = [
		...(await problemsOfHttpBuild(httpDirectory)),
		...(fixtureDirectory ? problemsOfFixtureBuild(fixtureDirectory) : []),
	];
	if (problems.length > 0) {
		process.stdout.write(`${problems.join("\n")}\n`);
		process.exit(1);
	}
	process.stdout.write(
		`HTTP build holds "${httpBuildMarker}" and ${new URL(STAGING_API).host}, no production API host or fixture school name${fixtureDirectory ? "; the fixture build holds no marker" : ""}\n`,
	);
}
