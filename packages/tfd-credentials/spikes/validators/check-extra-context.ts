/**
 * Interop spike: does a third-party OB3 credential that carries an extra context (1EdTech's `extensions.json`) verify
 * once the caller opts in through the documented options (`extraContexts` plus `createRdfcSuite({ contexts })`)?
 *
 *   bun check-extra-context.ts <credential.json> <context url> <context file>
 *
 * The context file is a local copy (e.g. from the 1EdTech validator's bundled resources); nothing is fetched.
 */
import { readFileSync } from "node:fs";
import {
	resolveDidKey,
	suiteRegistry,
	verifyCredential,
} from "../../src/index.js";
import { createRdfcSuite } from "../../src/rdfc.js";

const [credentialPath, contextUrl, contextPath] = process.argv.slice(2);
if (
	credentialPath === undefined ||
	contextUrl === undefined ||
	contextPath === undefined
) {
	console.error(
		"usage: bun check-extra-context.ts <credential.json> <context url> <context file>",
	);
	process.exit(2);
}
const credential: unknown = JSON.parse(readFileSync(credentialPath, "utf8"));
const result = await verifyCredential(credential, {
	now: Date.now(),
	resolveDid: async (did) => resolveDidKey(did),
	extraContexts: [contextUrl],
	suites: suiteRegistry(
		createRdfcSuite({
			contexts: { [contextUrl]: JSON.parse(readFileSync(contextPath, "utf8")) },
		}),
	),
});
const { credential: _credential, ...rest } = result;
console.log(JSON.stringify(rest, null, 2));
