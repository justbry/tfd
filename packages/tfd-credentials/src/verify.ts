/**
 * Verify an OpenBadgeCredential into an itemised result. Nothing here throws on bad input and nothing fetches: DIDs
 * and status lists come through the injected resolvers, the clock through `now`.
 *
 * Status is `valid` only after a status list was fetched, its own proof verified (by the credential's issuer unless
 * `acceptStatusIssuer` says otherwise), its validity checked and the bit read clear. Without a resolver, or on any
 * failure on the way, it is `unchecked`: offline means "valid when issued, status unchecked", never `valid`.
 */
import { JCS_SUITES } from "./jcs-suite.js";
import { validateOpenBadgeCredential } from "./validate.js";
import { validityOf, verifyEmbeddedProof } from "./verify-proof.js";
import {
	failed,
	PASSED,
	SKIPPED,
	type VerificationResult,
	type VerifyOptions,
} from "./verify-result.js";
import {
	checkEntry,
	combine,
	entriesOf,
	notChecked,
	unchecked,
} from "./verify-status.js";

export const verifyCredential = async (
	input: unknown,
	options: VerifyOptions,
): Promise<VerificationResult> => {
	const validation = validateOpenBadgeCredential(input, options);
	if (!validation.ok) {
		const reason = validation.issues.some((issue) => issue.code === "context")
			? "context_invalid"
			: "credential_malformed";
		return {
			verified: false,
			status: "unchecked",
			checks: {
				structure: failed(
					reason,
					`${validation.issues.length} structural issue(s)`,
				),
				signature: SKIPPED,
				issuerKey: SKIPPED,
				validity: SKIPPED,
				status: notChecked,
			},
			proofs: [],
			issues: validation.issues,
			credential: null,
		};
	}
	const credential = validation.value;
	const proof = await verifyEmbeddedProof(
		credential as unknown as Record<string, unknown>,
		credential.issuer.id,
		options.resolveDid,
		options.suites ?? JCS_SUITES,
	);
	const validity = validityOf(
		credential.validFrom,
		credential.validUntil,
		proof.expiresAt,
		options.now,
	);
	const authentic =
		proof.signature.outcome === "passed" &&
		proof.issuerKey.outcome === "passed";
	let status = notChecked;
	if (authentic) {
		const entries = entriesOf(credential.credentialStatus);
		status =
			entries.length === 0
				? unchecked("no_status_entry", "the credential carries no status entry")
				: combine(
						await Promise.all(
							entries.map((entry) =>
								checkEntry(entry, credential.issuer.id, options),
							),
						),
					);
	}
	return {
		verified: authentic && validity.outcome === "passed",
		status: status.state,
		checks: {
			structure: PASSED,
			signature: proof.signature,
			issuerKey: proof.issuerKey,
			validity,
			status,
		},
		proofs: proof.proofs,
		issues: [],
		credential,
	};
};
