/**
 * The proof suite port. A Data Integrity cryptosuite here is the part that differs between `eddsa-jcs-2022` and
 * `eddsa-rdfc-2022`: how the proof options and the document become bytes. Both then hash each with SHA-256, join
 * proofConfigHash || documentHash and sign with Ed25519 (EdDSA Cryptosuites v1.0 §3.2.4, §3.3.4), which the library
 * does once for every suite.
 */
import type { ProofFailure } from "./proof-shape.js";

export type HashOutcome =
	| { ok: true; hashData: Uint8Array }
	| { ok: false; reason: ProofFailure; message: string };

export type ProofSuite = {
	readonly cryptosuite: string;
	/**
	 * The proof options as they are signed and published, from the common ones. JCS copies the document's @context
	 * into the proof (§3.3.1 step 2); RDFC does not.
	 */
	proofOptions(
		common: Record<string, unknown>,
		unsecuredDocument: Record<string, unknown>,
	): Record<string, unknown>;
	/** proofConfigHash || transformedDocumentHash, or why the document or options cannot be transformed. */
	hashData(
		unsecuredDocument: Record<string, unknown>,
		proofOptions: Record<string, unknown>,
	): Promise<HashOutcome>;
};

/** The suites a verifier accepts, by `cryptosuite`. A proof of any other suite is reported as unsupported. */
export type SuiteRegistry = ReadonlyMap<string, ProofSuite>;

export const suiteRegistry = (...suites: ProofSuite[]): SuiteRegistry =>
	new Map(suites.map((suite) => [suite.cryptosuite, suite]));
