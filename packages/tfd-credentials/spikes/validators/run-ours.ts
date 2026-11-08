/**
 * Interop spike: verify credentials with tfd-credentials' own `verifyCredential` (both suites registered), resolving
 * did:web and status lists over real HTTPS.
 *
 *   bun run-ours.ts <credentials dir> <results dir> <ca.pem>
 *
 * Works for our fixtures and for other ecosystems' samples alike. `now` is the real clock, as for the other targets.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { composeDidResolver, verifyCredential } from "../../src/index.js";
import { RDFC_AND_JCS_SUITES } from "../../src/rdfc.js";

const [credentialsDir, resultsDir, caPath] = process.argv.slice(2);
if (
	credentialsDir === undefined ||
	resultsDir === undefined ||
	caPath === undefined
) {
	console.error(
		"usage: bun run-ours.ts <credentials dir> <results dir> <ca.pem>",
	);
	process.exit(2);
}
const ca = readFileSync(caPath, "utf8");
const fetchJson = async (url: string): Promise<unknown> => {
	// The local CA only for the local fixture site; anything else (other ecosystems' samples) uses the system store.
	const local = url.startsWith("https://localhost:");
	const response = await fetch(url, local ? { tls: { ca } } : {});
	if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
	return response.json();
};

mkdirSync(resultsDir, { recursive: true });
const summary: Record<string, unknown> = {};
for (const file of readdirSync(credentialsDir).filter((name) =>
	name.endsWith(".json"),
)) {
	const name = file.replace(/\.json$/, "");
	const credential: unknown = JSON.parse(
		readFileSync(join(credentialsDir, file), "utf8"),
	);
	const result = await verifyCredential(credential, {
		now: Date.now(),
		resolveDid: composeDidResolver({ fetchJson }),
		resolveStatusList: fetchJson,
		suites: RDFC_AND_JCS_SUITES,
	});
	const { credential: _credential, ...rest } = result;
	writeFileSync(
		join(resultsDir, `${name}.json`),
		`${JSON.stringify(rest, null, 2)}\n`,
	);
	const failures = Object.entries(result.checks)
		.filter(([, check]) => check.outcome === "failed")
		.map(
			([key, check]) =>
				`${key}: ${"reason" in check ? check.reason : ""}: ${"message" in check ? String(check.message).slice(0, 200) : ""}`,
		);
	const issues = result.issues.map(
		(issue) => `issue ${issue.code} ${issue.path}: ${issue.message}`,
	);
	const proofs = result.proofs.map(
		(proof) =>
			`proof ${proof.cryptosuite}: ${proof.outcome}${proof.reason === null ? "" : ` (${proof.reason})`}`,
	);
	summary[name] = {
		verified: result.verified,
		status: result.status,
		problems: [...failures, ...issues],
		proofs,
	};
	console.log(
		`${name.padEnd(42)} verified=${result.verified} status=${result.status} ${proofs.join("; ")}`,
	);
	for (const problem of [...failures, ...issues]) console.log(`    ${problem}`);
}
writeFileSync(
	join(resultsDir, "summary.json"),
	`${JSON.stringify(summary, null, 2)}\n`,
);
