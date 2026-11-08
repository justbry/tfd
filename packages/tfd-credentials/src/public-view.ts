/**
 * What a public verify page may show. Only level, achievement name, issue date, validUntil, status and issuer name;
 * the holder's name only with `includeName`. Never the subject id, identifiers, evidence or status list position.
 *
 * A certificate proves the issuer issued it, not who is holding it: the page should say so.
 */
import type { StatusState, VerificationResult } from "./verify-result.js";

export type PublicCredentialView = {
	level: string | null;
	achievementName: string;
	issuedOn: string;
	validUntil: string | null;
	status: StatusState;
	issuerName: string | null;
	/** Present only with `includeName` and when the credential carries a plain name. */
	name?: string;
};

/**
 * The page view, or null unless the credential is authentic (structure, signature and issuer key passed). An expired
 * credential still gets a view: its `validUntil` shows the lapse.
 */
export const publicView = (
	result: VerificationResult,
	options: { includeName?: boolean } = {},
): PublicCredentialView | null => {
	const { credential, checks } = result;
	if (credential === null) return null;
	if (
		checks.signature.outcome !== "passed" ||
		checks.issuerKey.outcome !== "passed"
	)
		return null;
	const { achievement } = credential.credentialSubject;
	const view: PublicCredentialView = {
		level: achievement.humanCode ?? null,
		achievementName: achievement.name,
		issuedOn: credential.awardedDate ?? credential.validFrom,
		validUntil: credential.validUntil ?? null,
		status: result.status,
		issuerName: credential.issuer.name ?? null,
	};
	if (options.includeName === true) {
		const name = credential.credentialSubject.identifier?.find(
			(identity) => identity.identityType === "name" && !identity.hashed,
		);
		if (name !== undefined) view.name = name.identityHash;
	}
	return view;
};
