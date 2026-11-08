/**
 * Data Integrity proofs through pluggable suites (see suite.ts), signed with Ed25519 through the `Signer` port: this
 * module never sees a private key. Shared by every suite (EdDSA Cryptosuites v1.0 §3.2.6, §3.3.6): the 64-byte
 * Ed25519 (pure EdDSA, RFC 8032) signature of hashData, as base58btc multibase in `proofValue`.
 *
 * Proof sets (VC Data Integrity 1.0 §2.1.1, §4.3): every proof in a set is made over the document without `proof`,
 * independently of the others. Proof chains (`previousProof`) are not supported.
 */
import { ed25519 } from "@noble/curves/ed25519.js";
import { parseDateTimeStamp } from "./datetime.js";
import { CredentialsError } from "./errors.js";
import { eddsaJcs2022, JCS_SUITES, jcsHashData } from "./jcs-suite.js";
import { multibaseBase58btc } from "./multibase.js";
import {
	PROOF_PURPOSE,
	PROOF_TYPE,
	type ProofFailure,
	parseProofShape,
	SIGNATURE_LENGTH,
	withoutMember,
} from "./proof-shape.js";
import type { ProofSuite, SuiteRegistry } from "./suite.js";
import type { DataIntegrityProof } from "./types.js";

export type { ProofFailure } from "./proof-shape.js";

/** The signing port. `keyId` is the verification method id (`did:web:...#key-1`); `sign` returns 64 bytes. */
export type Signer = {
	keyId: string;
	sign(bytes: Uint8Array): Promise<Uint8Array>;
};

export type ParsedProof = {
	proof: DataIntegrityProof;
	/** The 64 signature bytes from `proofValue`. */
	signature: Uint8Array;
	/** proofConfigHash || documentHash, the bytes the signature covers. */
	hashData: Uint8Array;
	expiresAt: number | null;
};

export type ProofCheck =
	| ({ ok: true } & ParsedProof)
	| { ok: false; reason: ProofFailure; message: string };

/** The proofs of a document: none, one, or every member of a proof set. */
export const proofsOf = (document: { proof?: unknown }): unknown[] => {
	const { proof } = document;
	if (proof === undefined) return [];
	return Array.isArray(proof) ? proof : [proof];
};

const makeProof = async (
	unsecuredDocument: Record<string, unknown>,
	suite: ProofSuite,
	signer: Signer,
	created: string,
): Promise<DataIntegrityProof> => {
	const proofOptions = suite.proofOptions(
		{
			type: PROOF_TYPE,
			cryptosuite: suite.cryptosuite,
			created,
			verificationMethod: signer.keyId,
			proofPurpose: PROOF_PURPOSE,
		},
		unsecuredDocument,
	);
	const outcome = await suite.hashData(unsecuredDocument, proofOptions);
	if (!outcome.ok) {
		throw new CredentialsError(
			"proof_generation_failed",
			`${suite.cryptosuite}: ${outcome.reason}: ${outcome.message}`,
		);
	}
	const signature = await signer.sign(outcome.hashData);
	if (
		!(signature instanceof Uint8Array) ||
		signature.length !== SIGNATURE_LENGTH
	) {
		throw new CredentialsError(
			"signer_invalid",
			`the signer must return a ${SIGNATURE_LENGTH}-byte Ed25519 signature`,
		);
	}
	return {
		...proofOptions,
		proofValue: multibaseBase58btc(signature),
	} as DataIntegrityProof;
};

const checkUnsigned = (
	document: Record<string, unknown>,
	created: string,
): void => {
	if ("proof" in document) {
		throw new CredentialsError(
			"input_invalid",
			"the document already has a proof",
		);
	}
	if (parseDateTimeStamp(created) === null) {
		throw new CredentialsError(
			"datetime_invalid",
			"created is not a dateTimeStamp",
		);
	}
};

/**
 * Add one proof (default suite `eddsa-jcs-2022`). `created` is the caller's clock as a dateTimeStamp. Throws
 * `input_invalid` when the document already has a proof, `signer_invalid` when the signer returns other than 64 bytes,
 * `proof_generation_failed` when the suite cannot transform the document (an unknown context, an undefined term).
 */
export const addProof = async <Document extends Record<string, unknown>>(
	document: Document,
	options: { signer: Signer; created: string; suite?: ProofSuite },
): Promise<Document & { proof: DataIntegrityProof }> => {
	checkUnsigned(document, options.created);
	const proof = await makeProof(
		document,
		options.suite ?? eddsaJcs2022,
		options.signer,
		options.created,
	);
	return { ...document, proof };
};

/** One proof per suite, each over the document without `proof`; a single suite gives a plain proof object. */
export const addProofSet = async <Document extends Record<string, unknown>>(
	document: Document,
	options: { signer: Signer; created: string; suites: readonly ProofSuite[] },
): Promise<Document & { proof: DataIntegrityProof | DataIntegrityProof[] }> => {
	checkUnsigned(document, options.created);
	if (options.suites.length === 0) {
		throw new CredentialsError(
			"input_invalid",
			"at least one proof suite is needed",
		);
	}
	const proofs: DataIntegrityProof[] = [];
	for (const suite of options.suites) {
		proofs.push(
			await makeProof(document, suite, options.signer, options.created),
		);
	}
	const [only] = proofs;
	return {
		...document,
		proof: proofs.length === 1 && only !== undefined ? only : proofs,
	};
};

/** Every check of one proof against the document without `proof`, through the suite its `cryptosuite` names. */
export const inspectProof = async (
	unsecuredDocument: Record<string, unknown>,
	proof: unknown,
	suites: SuiteRegistry,
): Promise<ProofCheck> => {
	const shape = parseProofShape(proof, suites);
	if (!shape.ok) return shape;
	const suite = suites.get(shape.proof.cryptosuite) as ProofSuite;
	const outcome = await suite.hashData(
		unsecuredDocument,
		withoutMember(
			shape.proof as unknown as Record<string, unknown>,
			"proofValue",
		),
	);
	if (!outcome.ok) return outcome;
	return {
		ok: true,
		proof: shape.proof,
		signature: shape.signature,
		hashData: outcome.hashData,
		expiresAt: shape.expiresAt,
	};
};

/**
 * Synchronous check of a document's single `eddsa-jcs-2022` proof: every structural check, then the bytes to verify.
 * No key and no clock needed. For other suites or proof sets use `inspectProof` (or `verifyCredential`).
 */
export const checkProof = (
	securedDocument: Record<string, unknown>,
): ProofCheck => {
	const proof = securedDocument.proof;
	if (proof === undefined) {
		return { ok: false, reason: "proof_missing", message: "no proof" };
	}
	if (Array.isArray(proof)) {
		return {
			ok: false,
			reason: "proof_set_unsupported",
			message: "checkProof reads one proof; use inspectProof for a proof set",
		};
	}
	const shape = parseProofShape(proof, JCS_SUITES);
	if (!shape.ok) return shape;
	const outcome = jcsHashData(
		withoutMember(securedDocument, "proof"),
		withoutMember(proof as Record<string, unknown>, "proofValue"),
	);
	if (!outcome.ok) return outcome;
	return {
		ok: true,
		proof: shape.proof,
		signature: shape.signature,
		hashData: outcome.hashData,
		expiresAt: shape.expiresAt,
	};
};

/** RFC 8032 strict Ed25519 (not ZIP-215): every consumer must accept exactly the same signatures. */
export const verifySignature = (
	hashData: Uint8Array,
	signature: Uint8Array,
	publicKey: Uint8Array,
): boolean => {
	try {
		return ed25519.verify(signature, hashData, publicKey, { zip215: false });
	} catch {
		return false;
	}
};
