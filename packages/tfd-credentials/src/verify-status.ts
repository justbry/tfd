/**
 * The status check: fetch each entry's list through the resolver, verify the list's own proof and issuer, its
 * validity and purpose, then read the bit (Bitstring Status List v1.0 §3.2 Validate Algorithm). Any failure on the way
 * is `unchecked` with a reason, never `valid`.
 */
import { CredentialsError } from "./errors.js";
import { JCS_SUITES } from "./jcs-suite.js";
import { decodeBitstring, getBit } from "./status.js";
import type { BitstringStatusListEntry } from "./types.js";
import { validateStatusListCredential } from "./validate.js";
import { validityOf, verifyEmbeddedProof } from "./verify-proof.js";
import type {
	StatusCheck,
	StatusReason,
	StatusState,
	VerifyOptions,
} from "./verify-result.js";

export const unchecked = (
	reason: StatusReason,
	message: string,
): StatusCheck => ({
	state: "unchecked",
	reason,
	message,
});

export const checkEntry = async (
	entry: BitstringStatusListEntry,
	credentialIssuer: string,
	options: VerifyOptions,
): Promise<StatusCheck> => {
	if (options.resolveStatusList === undefined) {
		return unchecked(
			"status_resolver_missing",
			"no status list resolver: offline",
		);
	}
	let raw: unknown;
	try {
		raw = await options.resolveStatusList(entry.statusListCredential);
	} catch (error) {
		return unchecked(
			"status_retrieval_failed",
			error instanceof Error ? error.message : "retrieval failed",
		);
	}
	const validation = validateStatusListCredential(raw);
	if (!validation.ok) {
		const first = validation.issues[0];
		return unchecked(
			"status_list_invalid",
			`${first?.path}: ${first?.message}`,
		);
	}
	const list = validation.value;
	if (list.id !== entry.statusListCredential) {
		return unchecked(
			"status_list_id_mismatch",
			`got ${list.id} for ${entry.statusListCredential}`,
		);
	}
	const proof = await verifyEmbeddedProof(
		raw as Record<string, unknown>,
		list.issuer,
		options.resolveDid,
		options.suites ?? JCS_SUITES,
	);
	if (
		proof.signature.outcome !== "passed" ||
		proof.issuerKey.outcome !== "passed"
	) {
		const detail =
			proof.signature.outcome === "failed" ? proof.signature : proof.issuerKey;
		return unchecked(
			"status_list_signature_invalid",
			detail.outcome === "failed"
				? `${detail.reason}: ${detail.message}`
				: "proof not checked",
		);
	}
	const sameIssuer = list.issuer === credentialIssuer;
	if (
		!sameIssuer &&
		!(options.acceptStatusIssuer?.(list.issuer, credentialIssuer) ?? false)
	) {
		return unchecked(
			"status_list_issuer_mismatch",
			`the list is signed by ${list.issuer}`,
		);
	}
	const window = validityOf(
		list.validFrom,
		list.validUntil,
		proof.expiresAt,
		options.now,
	);
	if (window.outcome === "failed") {
		return window.reason === "not_yet_valid"
			? unchecked("status_list_not_yet_valid", window.message)
			: unchecked("status_list_expired", window.message);
	}
	if (list.credentialSubject.statusPurpose !== entry.statusPurpose) {
		return unchecked(
			"status_purpose_mismatch",
			`the list is for ${list.credentialSubject.statusPurpose}`,
		);
	}
	let bits: Uint8Array;
	try {
		bits = await decodeBitstring(list.credentialSubject.encodedList);
	} catch (error) {
		const tooShort =
			error instanceof CredentialsError &&
			error.code === "status_list_too_short";
		return unchecked(
			tooShort ? "status_list_too_short" : "status_list_invalid",
			error instanceof Error ? error.message : "undecodable",
		);
	}
	const index = Number(entry.statusListIndex);
	if (!Number.isSafeInteger(index) || index >= bits.length * 8) {
		return unchecked(
			"status_index_out_of_range",
			`index ${entry.statusListIndex} is outside the list`,
		);
	}
	if (!getBit(bits, index))
		return { state: "valid", reason: null, message: null };
	return {
		state: entry.statusPurpose === "revocation" ? "revoked" : "suspended",
		reason: null,
		message: null,
	};
};

const STATE_RANK: Record<StatusState, number> = {
	revoked: 3,
	suspended: 2,
	unchecked: 1,
	valid: 0,
};

/** Revoked beats suspended beats unchecked beats valid: one unreadable list keeps the whole answer `unchecked`. */
export const combine = (checks: StatusCheck[]): StatusCheck => {
	let worst = checks[0] as StatusCheck;
	for (const check of checks) {
		if (STATE_RANK[check.state] > STATE_RANK[worst.state]) worst = check;
	}
	return worst;
};

export const entriesOf = (status: unknown): BitstringStatusListEntry[] => {
	if (status === undefined) return [];
	return (
		Array.isArray(status) ? status : [status]
	) as BitstringStatusListEntry[];
};

export const notChecked: StatusCheck = unchecked(
	"not_checked",
	"an earlier check failed",
);
