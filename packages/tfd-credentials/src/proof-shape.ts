/**
 * The structural checks every Data Integrity proof gets before any suite runs (VC Data Integrity 1.0 §2.1 proof
 * members, §4.4 Verify Proof steps 3–4; EdDSA Cryptosuites v1.0 §2.2.1 DataIntegrityProof).
 */
import { parseDateTimeStamp } from "./datetime.js";
import { decodeMultibaseBase58btc } from "./multibase.js";
import type { DataIntegrityProof } from "./types.js";

export const PROOF_TYPE = "DataIntegrityProof";
export const PROOF_PURPOSE = "assertionMethod";
export const SIGNATURE_LENGTH = 64;

/** Proof members from VC Data Integrity §2.1. Anything else in a proof is refused, not silently signed over. */
const PROOF_MEMBERS = new Set([
	"@context",
	"id",
	"type",
	"cryptosuite",
	"created",
	"expires",
	"verificationMethod",
	"proofPurpose",
	"proofValue",
	"domain",
	"challenge",
	"nonce",
]);

/** Members of other proof formats (JWS, VC-JWT headers) that must never steer a Data Integrity verifier. */
const FOREIGN_MEMBERS = new Set([
	"alg",
	"jws",
	"kid",
	"jwk",
	"signatureValue",
	"crit",
]);

export type ProofFailure =
	| "proof_missing"
	| "proof_set_unsupported"
	| "proof_malformed"
	| "proof_alg_forbidden"
	| "proof_member_unexpected"
	| "proof_type_unsupported"
	| "cryptosuite_unsupported"
	| "proof_purpose_mismatch"
	| "proof_created_invalid"
	| "proof_expires_invalid"
	| "proof_value_malformed"
	| "proof_context_mismatch"
	| "document_not_canonical"
	| "context_unknown"
	| "term_undefined";

export type ProofShape =
	| {
			ok: true;
			proof: DataIntegrityProof;
			signature: Uint8Array;
			expiresAt: number | null;
	  }
	| { ok: false; reason: ProofFailure; message: string };

export const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

export const withoutMember = (
	record: Record<string, unknown>,
	member: string,
): Record<string, unknown> => {
	const copy: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (key !== member) copy[key] = value;
	}
	return copy;
};

const failure = (reason: ProofFailure, message: string): ProofShape => ({
	ok: false,
	reason,
	message,
});

/**
 * True when a proof is of a kind the verifier does not know at all (another proof type, or a cryptosuite missing from
 * the registry). In a proof set those are reported and skipped; every other defect fails the proof.
 */
export const isUnsupportedProof = (
	proof: unknown,
	cryptosuites: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): boolean =>
	isRecord(proof) &&
	(proof.type !== PROOF_TYPE ||
		typeof proof.cryptosuite !== "string" ||
		!cryptosuites.has(proof.cryptosuite));

/** Shape checks on one proof object; `cryptosuites` are the suites the caller can verify. */
export const parseProofShape = (
	proof: unknown,
	cryptosuites: ReadonlySet<string> | ReadonlyMap<string, unknown>,
): ProofShape => {
	if (!isRecord(proof))
		return failure("proof_malformed", "proof is not an object");
	for (const member of Object.keys(proof)) {
		if (FOREIGN_MEMBERS.has(member)) {
			return failure(
				"proof_alg_forbidden",
				`proof.${member} belongs to another proof format`,
			);
		}
		if (!PROOF_MEMBERS.has(member)) {
			return failure(
				"proof_member_unexpected",
				`proof.${member} is not a Data Integrity proof member`,
			);
		}
	}
	if (proof.type !== PROOF_TYPE) {
		return failure(
			"proof_type_unsupported",
			`proof.type must be ${PROOF_TYPE}`,
		);
	}
	if (
		typeof proof.cryptosuite !== "string" ||
		!cryptosuites.has(proof.cryptosuite)
	) {
		return failure(
			"cryptosuite_unsupported",
			`proof.cryptosuite must be one of ${[...cryptosuites.keys()].join(", ")}`,
		);
	}
	if (proof.proofPurpose !== PROOF_PURPOSE) {
		return failure(
			"proof_purpose_mismatch",
			`proof.proofPurpose must be ${PROOF_PURPOSE}`,
		);
	}
	if (
		typeof proof.verificationMethod !== "string" ||
		proof.verificationMethod === ""
	) {
		return failure(
			"proof_malformed",
			"proof.verificationMethod must be a string",
		);
	}
	if (
		proof.created !== undefined &&
		(typeof proof.created !== "string" ||
			parseDateTimeStamp(proof.created) === null)
	) {
		return failure(
			"proof_created_invalid",
			"proof.created is not a dateTimeStamp",
		);
	}
	let expiresAt: number | null = null;
	if (proof.expires !== undefined) {
		expiresAt =
			typeof proof.expires === "string"
				? parseDateTimeStamp(proof.expires)
				: null;
		if (expiresAt === null) {
			return failure(
				"proof_expires_invalid",
				"proof.expires is not a dateTimeStamp",
			);
		}
	}
	if (typeof proof.proofValue !== "string") {
		return failure(
			"proof_value_malformed",
			"proof.proofValue must be a string",
		);
	}
	let signature: Uint8Array;
	try {
		signature = decodeMultibaseBase58btc(proof.proofValue);
	} catch {
		return failure(
			"proof_value_malformed",
			"proof.proofValue is not base58btc multibase",
		);
	}
	if (signature.length !== SIGNATURE_LENGTH) {
		return failure(
			"proof_value_malformed",
			`proof.proofValue must hold ${SIGNATURE_LENGTH} bytes`,
		);
	}
	return {
		ok: true,
		proof: proof as DataIntegrityProof,
		signature,
		expiresAt,
	};
};
