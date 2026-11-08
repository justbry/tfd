/**
 * Interop spike: verify every fixture with DCC's @digitalcredentials/verifier-core (with its opt-in Open Badges
 * suite) and record each result.
 *
 *   NODE_EXTRA_CA_CERTS=<ca.pem> node run-verifier-core.mjs <verifier-core install dir> <credentials dir> <results dir>
 *
 * Run it with Node 24+ from a directory that is NOT the install dir; the package is imported by absolute path. The
 * built-in HTTP service refuses localhost by design (README "Network policy"), so this injects an `httpGetService`
 * (a documented option) that GETs over HTTPS with Node's fetch. Registries are skipped (`registries: []`).
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const [installDir, credentialsDir, resultsDir] = process.argv.slice(2);
if (!installDir || !credentialsDir || !resultsDir) {
	console.error(
		"usage: node run-verifier-core.mjs <install dir> <credentials dir> <results dir>",
	);
	process.exit(2);
}
const packageDir = join(
	installDir,
	"node_modules/@digitalcredentials/verifier-core/dist",
);
const { createVerifier } = await import(
	pathToFileURL(join(packageDir, "index.js")).href
);
const { openBadgesSuite } = await import(
	pathToFileURL(join(packageDir, "openbadges/schema/index.js")).href
);

const fetched = [];
const httpGetService = {
	get: async (url) => {
		if (!url.startsWith("https://")) throw new Error(`refusing ${url}`);
		fetched.push(url);
		const response = await fetch(url, { redirect: "follow" });
		const text = await response.text();
		let body = text;
		try {
			body = JSON.parse(text);
		} catch {}
		return { body, headers: response.headers, status: response.status };
	},
};
const verifier = createVerifier({ httpGetService });

mkdirSync(resultsDir, { recursive: true });
const summary = {};
for (const file of readdirSync(credentialsDir).filter((name) =>
	name.endsWith(".json"),
)) {
	const name = file.replace(/\.json$/, "");
	const credential = JSON.parse(
		readFileSync(join(credentialsDir, file), "utf8"),
	);
	let result;
	try {
		result = await verifier.verifyCredential({
			credential,
			registries: [],
			additionalSuites: [openBadgesSuite],
		});
	} catch (error) {
		summary[name] = { verified: "threw", problems: [String(error)] };
		console.log(`${name.padEnd(42)} THREW ${error}`);
		continue;
	}
	const { verifiableCredential: _credential, ...rest } = result;
	writeFileSync(
		join(resultsDir, `${name}.json`),
		`${JSON.stringify(rest, null, 2)}\n`,
	);
	const problems = result.results
		.filter((check) => check.outcome.status === "failure")
		.map(
			(check) =>
				`${check.id}${check.fatal === false ? " (advisory)" : ""}: ${check.outcome.problems
					.map((problem) => `${problem.title}: ${problem.detail}`)
					.join(" | ")
					.slice(0, 400)}`,
		);
	summary[name] = { verified: result.verified, problems };
	console.log(`${name.padEnd(42)} verified=${result.verified}`);
	for (const problem of problems) console.log(`    ${problem}`);
}
writeFileSync(
	join(resultsDir, "summary.json"),
	`${JSON.stringify({ fetched: [...new Set(fetched)], results: summary }, null, 2)}\n`,
);
