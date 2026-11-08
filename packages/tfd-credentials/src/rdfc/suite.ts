/**
 * `eddsa-rdfc-2022` (EdDSA Cryptosuites v1.0 §3.2, https://www.w3.org/TR/vc-di-eddsa/#eddsa-rdfc-2022), the suite
 * 1EdTech's OB3 certification accepts (Certification Guide 1.5 §3.1.1, §4.2.1):
 *
 * - transformation (§3.2.3): JSON-LD to RDF, then RDF Dataset Canonicalization (RDFC-1.0) as canonical N-Quads;
 * - proof configuration (§3.2.5): the proof options with `@context` set to the document's, canonicalised the same way;
 * - hashData (§3.2.4): SHA-256(canonical proof config) || SHA-256(canonical document).
 *
 * JSON-LD runs in safe mode (jsonld.js `safe: true`: any term or value the contexts do not define is an error, the
 * "JSON-LD safe mode" 1EdTech's certification requires) and with an offline loader over bundled contexts only.
 */
import jsonld from "jsonld";
import { concatBytes, sha256Bytes, utf8 } from "../bytes.js";
import type { ProofFailure } from "../proof-shape.js";
import { withoutMember } from "../proof-shape.js";
import type { HashOutcome, ProofSuite } from "../suite.js";
import { BUNDLED_CONTEXTS } from "./contexts.js";

export const RDFC_CRYPTOSUITE = "eddsa-rdfc-2022";

class ContextNotBundled extends Error {
	override name = "ContextNotBundled";
}

export type RdfcOptions = {
	/** More contexts by URL (tests, or a vetted extension context). They join the bundled ones; nothing is fetched. */
	contexts?: Readonly<Record<string, unknown>>;
};

/** True when `error`, or anything it wraps, is the loader refusing a context. */
const refusedContext = (error: unknown): boolean => {
	let current: unknown = error;
	for (
		let depth = 0;
		depth < 8 && typeof current === "object" && current !== null;
		depth++
	) {
		if (current instanceof ContextNotBundled) return true;
		const record = current as {
			cause?: unknown;
			details?: { cause?: unknown };
		};
		current = record.details?.cause ?? record.cause;
	}
	return false;
};

const failureOf = (
	error: unknown,
): { reason: ProofFailure; message: string } => {
	const message =
		error instanceof Error ? error.message : "JSON-LD processing failed";
	if (refusedContext(error)) return { reason: "context_unknown", message };
	// jsonld.js reports safe-mode violations (an undefined term, a dropped value) as jsonld.ValidationError.
	if (error instanceof Error && error.name === "jsonld.ValidationError") {
		return { reason: "term_undefined", message };
	}
	return { reason: "document_not_canonical", message };
};

/** Canonical N-Quads (RDFC-1.0) of a JSON-LD document, with only the given contexts available. */
export const rdfcCanonicalize = (
	document: unknown,
	contexts: ReadonlyMap<string, unknown>,
): Promise<string> =>
	jsonld.canonize(document, {
		algorithm: "RDFC-1.0",
		format: "application/n-quads",
		safe: true,
		base: null,
		documentLoader: async (url) => {
			const context = contexts.get(url);
			if (context === undefined)
				throw new ContextNotBundled(`context ${url} is not bundled`);
			// A copy, so nothing jsonld does to a loaded document can leak into the next canonicalisation.
			return {
				contextUrl: null,
				documentUrl: url,
				document: structuredClone(context),
			};
		},
	});

export const createRdfcSuite = (options: RdfcOptions = {}): ProofSuite => {
	const contexts = new Map<string, unknown>([
		...BUNDLED_CONTEXTS,
		...Object.entries(options.contexts ?? {}),
	]);
	return {
		cryptosuite: RDFC_CRYPTOSUITE,
		// §3.2.1: the published proof is the proof options as given; the @context lives only in the proof config.
		proofOptions: (common) => common,
		hashData: async (unsecuredDocument, proofOptions): Promise<HashOutcome> => {
			if (unsecuredDocument["@context"] === undefined) {
				return {
					ok: false,
					reason: "context_unknown",
					message: "the document has no @context",
				};
			}
			const proofConfig = {
				...withoutMember(proofOptions, "@context"),
				"@context": unsecuredDocument["@context"],
			};
			let canonicalConfig: string;
			let canonicalDocument: string;
			try {
				[canonicalConfig, canonicalDocument] = await Promise.all([
					rdfcCanonicalize(proofConfig, contexts),
					rdfcCanonicalize(unsecuredDocument, contexts),
				]);
			} catch (error) {
				return { ok: false, ...failureOf(error) };
			}
			// An empty dataset signs nothing the reader could rely on.
			if (canonicalDocument === "" || canonicalConfig === "") {
				return {
					ok: false,
					reason: "document_not_canonical",
					message: "the document has no RDF statements",
				};
			}
			return {
				ok: true,
				hashData: concatBytes(
					sha256Bytes(utf8(canonicalConfig)),
					sha256Bytes(utf8(canonicalDocument)),
				),
			};
		},
	};
};

/** `eddsa-rdfc-2022` over the bundled contexts (VC 2.0, Open Badges 3.0.3, Data Integrity v2). */
export const eddsaRdfc2022: ProofSuite = createRdfcSuite();
