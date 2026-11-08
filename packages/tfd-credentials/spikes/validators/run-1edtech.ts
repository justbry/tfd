/**
 * Interop spike: post every fixture to a LOCAL 1EdTech digital-credentials-public-validator (OB30Inspector) and
 * record its report.
 *
 *   bun run-1edtech.ts <credentials dir> <results dir> [validator base URL=http://localhost:18080]
 *
 * Writes `<results>/<fixture>.json` (the raw report) and `<results>/summary.json`. Never point this at a hosted
 * validator: the brief allows local runs only.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [credentialsDir, resultsDir, base = "http://localhost:18080"] =
	process.argv.slice(2);
if (credentialsDir === undefined || resultsDir === undefined) {
	console.error(
		"usage: bun run-1edtech.ts <credentials dir> <results dir> [base]",
	);
	process.exit(2);
}
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) {
	console.error("refusing a non-local validator URL");
	process.exit(2);
}
mkdirSync(resultsDir, { recursive: true });

type Item = { generator: string; message: string };
type Report = {
	summary: { outcome: string };
	fatals: Item[];
	errors: Item[];
	warnings: Item[];
	exceptions: Item[];
};

const summary: Record<string, { outcome: string; problems: string[] }> = {};
for (const file of readdirSync(credentialsDir).filter((name) =>
	name.endsWith(".json"),
)) {
	const name = file.replace(/\.json$/, "");
	const form = new FormData();
	form.append(
		"file",
		new Blob([readFileSync(join(credentialsDir, file))], {
			type: "application/json",
		}),
		file,
	);
	const response = await fetch(
		`${base}/api/validate?validatorId=OB30Inspector`,
		{ method: "POST", body: form },
	);
	const text = await response.text();
	writeFileSync(join(resultsDir, `${name}.json`), text);
	let report: Report;
	try {
		report = JSON.parse(text) as Report;
	} catch {
		summary[name] = {
			outcome: `HTTP ${response.status}`,
			problems: [text.slice(0, 300)],
		};
		continue;
	}
	const problems = (
		["fatals", "errors", "exceptions", "warnings"] as const
	).flatMap((kind) =>
		report[kind].map(
			(item) => `${kind}: ${item.generator}: ${item.message.slice(0, 400)}`,
		),
	);
	summary[name] = { outcome: report.summary.outcome, problems };
	console.log(`${name.padEnd(42)} ${report.summary.outcome}`);
	for (const problem of problems) console.log(`    ${problem}`);
}
writeFileSync(
	join(resultsDir, "summary.json"),
	`${JSON.stringify(summary, null, 2)}\n`,
);
