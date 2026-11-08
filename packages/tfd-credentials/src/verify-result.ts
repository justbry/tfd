/** The itemised result of `verifyCredential`, and the options it takes. */
import type { DidResolver } from "./did.js";
import type { ProofFailure } from "./proof-shape.js";
import type { SuiteRegistry } from "./suite.js";
import type { OpenBadgeCredential } from "./types.js";
import type { ContextOptions, ValidationIssue } from "./validate.js";

/** The status list port: the list credential JSON at a URL (the caller's fetch and cache). */
export type StatusListResolver = (url: string) => Promise<unknown>;

export type VerifyOptions = ContextOptions & {
	now: number;
	resolveDid: DidResolver;
	resolveStatusList?: StatusListResolver;
	/** Trust a status list signed by `statusIssuer` for a credential by `credentialIssuer`. Default: same issuer only. */
	acceptStatusIssuer?: (
		statusIssuer: string,
		credentialIssuer: string,
	) => boolean;
	/** The proof suites this verifier accepts. Default: `eddsa-jcs-2022` only; `tfd-credentials/rdfc` adds rdfc. */
	suites?: SuiteRegistry;
};

export type StructureReason = "credential_malformed" | "context_invalid";
export type SignatureReason =
	| ProofFailure
	| "signature_invalid"
	| "verification_method_unresolved";
export type IssuerKeyReason =
	| "proof_missing"
	| "verification_method_invalid"
	| "verification_method_not_issuer"
	| "did_resolution_failed"
	| "verification_method_not_found"
	| "verification_method_controller_mismatch"
	| "verification_method_not_authorised"
	| "verification_method_unsupported";
export type ValidityReason = "not_yet_valid" | "expired" | "proof_expired";
export type StatusReason =
	| "not_checked"
	| "no_status_entry"
	| "status_resolver_missing"
	| "status_retrieval_failed"
	| "status_list_invalid"
	| "status_list_id_mismatch"
	| "status_list_signature_invalid"
	| "status_list_issuer_mismatch"
	| "status_list_not_yet_valid"
	| "status_list_expired"
	| "status_purpose_mismatch"
	| "status_list_too_short"
	| "status_index_out_of_range";

export type Check<Reason extends string> =
	| { outcome: "passed" }
	| { outcome: "failed"; reason: Reason; message: string }
	| { outcome: "skipped" };

/** One proof of the document, as the verifier saw it. */
export type ProofReport = {
	cryptosuite: string | null;
	verificationMethod: string | null;
	/** `unsupported`: another proof type or a cryptosuite missing from `suites`; skipped, not failed. */
	outcome: "verified" | "failed" | "unsupported";
	reason: SignatureReason | IssuerKeyReason | null;
	message: string | null;
};

export type StatusState = "valid" | "revoked" | "suspended" | "unchecked";

export type StatusCheck = {
	state: StatusState;
	/** Why the state is `unchecked`; null otherwise. */
	reason: StatusReason | null;
	message: string | null;
};

export type VerificationResult = {
	/** Structure, signature, issuer key and validity period all passed. Says nothing about status. */
	verified: boolean;
	status: StatusState;
	checks: {
		structure: Check<StructureReason>;
		signature: Check<SignatureReason>;
		issuerKey: Check<IssuerKeyReason>;
		validity: Check<ValidityReason>;
		status: StatusCheck;
	};
	/** Every proof of the credential (one, or each member of a proof set). */
	proofs: ProofReport[];
	/** Structural issues with their JSON paths, when `structure` failed. */
	issues: ValidationIssue[];
	/** The credential, typed, once its structure passed. */
	credential: OpenBadgeCredential | null;
};

export const PASSED = { outcome: "passed" } as const;
export const SKIPPED = { outcome: "skipped" } as const;

export const failed = <Reason extends string>(
	reason: Reason,
	message: string,
): Check<Reason> => ({
	outcome: "failed",
	reason,
	message,
});
