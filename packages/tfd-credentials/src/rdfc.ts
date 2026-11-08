/**
 * tfd-credentials/rdfc: the `eddsa-rdfc-2022` proof suite, with JSON-LD (jsonld.js) and bundled contexts. A separate
 * entry so verify-only consumers that need only `eddsa-jcs-2022` never load JSON-LD. See README "Proof suites".
 */
import { type Issued, type IssueInput, issue } from "./issue.js";
import { eddsaJcs2022 } from "./jcs-suite.js";
import { eddsaRdfc2022 } from "./rdfc/suite.js";
import { type ProofSuite, suiteRegistry } from "./suite.js";

export { BUNDLED_CONTEXTS } from "./rdfc/contexts.js";
export {
	createRdfcSuite,
	eddsaRdfc2022,
	RDFC_CRYPTOSUITE,
	type RdfcOptions,
	rdfcCanonicalize,
} from "./rdfc/suite.js";

/** A verifier registry accepting both suites: pass as `suites` to `verifyCredential`, `revoke`, `setStatusBit`. */
export const RDFC_AND_JCS_SUITES = suiteRegistry(eddsaRdfc2022, eddsaJcs2022);

/** What 1EdTech's OB3 certification accepts of this library's suites (Certification Guide 1.5 §3.1.1). */
export const CERTIFIABLE_PROOF_SUITES: readonly ProofSuite[] = [eddsaRdfc2022];

/** rdfc first for OB3 conformance, then jcs for JSON-only verifiers: a proof set of two. */
export const RDFC_AND_JCS_PROOFS: readonly ProofSuite[] = [
	eddsaRdfc2022,
	eddsaJcs2022,
];

/** `issue` with `eddsa-rdfc-2022` as the default proof, the default for new OB3 credentials. */
export const issueCertifiable = (input: IssueInput): Promise<Issued> =>
	issue({
		...input,
		proofSuites: input.proofSuites ?? CERTIFIABLE_PROOF_SUITES,
	});
