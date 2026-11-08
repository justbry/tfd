/**
 * Interop spike: the verdict matrix (fixture x target) as Markdown, from each runner's summary.json.
 *
 *   bun summarize.ts <manifest.json> <results dir>
 *
 * Verdicts: ACCEPT / REJECT, plus the first problem each target gave. "1EdTech" accepts VALID and WARNING outcomes
 * (warnings only); openbadgeslib is shown with status checking on.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const [manifestPath, resultsDir] = process.argv.slice(2);
if (manifestPath === undefined || resultsDir === undefined) {
	console.error("usage: bun summarize.ts <manifest.json> <results dir>");
	process.exit(2);
}
const read = <Value>(path: string): Value =>
	JSON.parse(readFileSync(path, "utf8")) as Value;

type Expectation = { verdict: string; status?: string; note: string };
const manifest = read<{ fixtures: Record<string, Expectation> }>(manifestPath);
const oneEdTech = read<Record<string, { outcome: string; problems: string[] }>>(
	join(resultsDir, "1edtech/summary.json"),
);
const verifierCore = read<{
	results: Record<string, { verified: boolean | string; problems: string[] }>;
}>(join(resultsDir, "verifier-core/summary.json")).results;
const openBadgesLib = read<
	Record<string, { signature: string; status: string }>
>(join(resultsDir, "openbadgeslib/summary.json"));
const ours = read<
	Record<string, { verified: boolean; status: string; problems: string[] }>
>(join(resultsDir, "ours/summary.json"));

const cell = (accepted: boolean | null, detail: string | undefined): string => {
	const verdict =
		accepted === null ? "n/a" : accepted ? "ACCEPT" : "**REJECT**";
	const text = (detail ?? "")
		.replace(/\|/g, "/")
		.replace(/\s+/g, " ")
		.slice(0, 110);
	return text === "" ? verdict : `${verdict}: ${text}`;
};
const firstReal = (problems: string[]): string | undefined =>
	problems.find((problem) => !problem.includes("is not accessible"));

const rows: string[] = [
	"| fixture | expected | 1EdTech validator | DCC verifier-core | openbadgeslib (status on) | tfd-credentials |",
	"| --- | --- | --- | --- | --- | --- |",
];
for (const [name, expectation] of Object.entries(manifest.fixtures).sort()) {
	const edtech = oneEdTech[name];
	const core = verifierCore[name];
	const library = openBadgesLib[name];
	const own = ours[name];
	const expected = `${expectation.verdict}${expectation.status === undefined ? "" : ` (${expectation.status})`}`;
	const ourAccepted =
		own === undefined
			? null
			: own.verified && (own.status === "valid" || own.status === "unchecked");
	rows.push(
		[
			name,
			expected,
			edtech === undefined
				? "n/a"
				: cell(
						edtech.outcome === "VALID" || edtech.outcome === "WARNING",
						firstReal(edtech.problems),
					),
			core === undefined
				? "n/a"
				: cell(core.verified === true, core.problems[0]),
			library === undefined
				? "n/a"
				: cell(
						library.status === "accepted",
						library.status.replace(/^rejected: /, ""),
					),
			own === undefined
				? "n/a"
				: cell(
						ourAccepted,
						`verified=${own.verified} status=${own.status}${own.problems[0] === undefined ? "" : `; ${own.problems[0]}`}`,
					),
		]
			.map((value) => ` ${value} `)
			.join("|")
			.replace(/^/, "|")
			.replace(/$/, "|"),
	);
}
console.log(rows.join("\n"));
