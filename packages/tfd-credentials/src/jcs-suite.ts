/**
 * `eddsa-jcs-2022` (EdDSA Cryptosuites v1.0 §3.3, https://www.w3.org/TR/vc-di-eddsa/#eddsa-jcs-2022): the proof
 * options carry the document's @context (§3.3.1 step 2); on verification the document's @context must start with the
 * proof's (§3.3.2 step 4); hashData = SHA-256(JCS(proof options)) || SHA-256(JCS(document without proof)) (§3.3.4).
 * No JSON-LD processing: JCS signs the JSON as written.
 */
import { concatBytes, sha256Bytes } from "./bytes.js";
import { canonicalBytes } from "./canonical.js";
import type { HashOutcome, ProofSuite } from "./suite.js";
import { suiteRegistry } from "./suite.js";

export const JCS_CRYPTOSUITE = "eddsa-jcs-2022";

const contextStartsWith = (
	documentContext: unknown,
	proofContext: unknown[],
): boolean =>
	Array.isArray(documentContext) &&
	proofContext.every((entry, index) => documentContext[index] === entry);

/** Synchronous, so `checkProof` can stay synchronous for JCS. */
export const jcsHashData = (
	unsecuredDocument: Record<string, unknown>,
	proofOptions: Record<string, unknown>,
): HashOutcome => {
	let document = unsecuredDocument;
	const proofContext = proofOptions["@context"];
	if (proofContext !== undefined) {
		if (
			!Array.isArray(proofContext) ||
			!contextStartsWith(unsecuredDocument["@context"], proofContext)
		) {
			return {
				ok: false,
				reason: "proof_context_mismatch",
				message: "the document @context does not start with proof.@context",
			};
		}
		document = { ...unsecuredDocument, "@context": proofContext };
	}
	try {
		return {
			ok: true,
			hashData: concatBytes(
				sha256Bytes(canonicalBytes(proofOptions)),
				sha256Bytes(canonicalBytes(document)),
			),
		};
	} catch (error) {
		return {
			ok: false,
			reason: "document_not_canonical",
			message: error instanceof Error ? error.message : "not JSON",
		};
	}
};

export const eddsaJcs2022: ProofSuite = {
	cryptosuite: JCS_CRYPTOSUITE,
	proofOptions: (common, unsecuredDocument) => {
		const context = unsecuredDocument["@context"];
		return context === undefined ? common : { ...common, "@context": context };
	},
	hashData: async (unsecuredDocument, proofOptions) =>
		jcsHashData(unsecuredDocument, proofOptions),
};

/** The default registry of the main entry: JCS only. `tfd-credentials/rdfc` adds `eddsa-rdfc-2022`. */
export const JCS_SUITES = suiteRegistry(eddsaJcs2022);
