/**
 * The credential data model this library issues and reads.
 *
 * - VC DM 2.0 (W3C Recommendation 15 May 2025): https://www.w3.org/TR/vc-data-model-2.0/
 * - Open Badges 3.0 (1EdTech, Final Release, document 1.4.5, 29 June 2026): https://www.imsglobal.org/spec/ob/v3p0/
 *   B.1.1 Achievement, B.1.2 AchievementCredential, B.1.3 AchievementSubject, B.1.9 Evidence, B.1.12 IdentityObject,
 *   B.1.14 Profile. OB3's schema allows ONE `credentialStatus` object (multiplicity [0..1]), so a credential carries
 *   one status entry: revocation or suspension.
 * - Bitstring Status List v1.0 (W3C Recommendation 15 May 2025): https://www.w3.org/TR/vc-bitstring-status-list/
 */

export const VC_CONTEXT_V2 = "https://www.w3.org/ns/credentials/v2";
/** The OB3 context the spec's examples and schema name today (`context-3.0.3.json`). */
export const OB3_CONTEXT =
	"https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json";

export const OPEN_BADGE_CONTEXT = [VC_CONTEXT_V2, OB3_CONTEXT] as const;
export const STATUS_LIST_CONTEXT = [VC_CONTEXT_V2] as const;

export type Image = { id: string; type: "Image"; caption?: string };

/** OB3 Profile, as the issuer. No email: Trifold's issuers are organisations reached through their url. */
export type IssuerProfile = {
	id: string;
	type: string[];
	name?: string;
	url?: string;
	description?: string;
	image?: Image;
};

export type Criteria = { id?: string; narrative?: string };

export type Achievement = {
	id: string;
	type: string[];
	name: string;
	description: string;
	criteria: Criteria;
	achievementType?: string;
	/** Carries the certification level (OB3 has no level property; see README "Levels"). */
	humanCode?: string;
	image?: Image;
	version?: string;
	tag?: string[];
};

/** OB3 IdentityObject. `identityHash` is `sha256$<hex>` when hashed, else the plain value. */
export type IdentityObject = {
	type: "IdentityObject";
	identityType: string;
	hashed: boolean;
	identityHash: string;
	salt?: string;
};

/** OB3 AchievementSubject: `id` is optional (a holder may be a child with no DID); then `identifier` is required. */
export type AchievementSubject = {
	id?: string;
	type: string[];
	achievement: Achievement;
	identifier?: IdentityObject[];
};

/** VC DM 2.0 §5.6 evidence, as a pointer and a digest only (`digestMultibase`, VC Data Integrity §2.3). */
export type Evidence = {
	id: string;
	type: string[];
	name?: string;
	digestMultibase: string;
};

export type StatusPurpose = "revocation" | "suspension";

export type BitstringStatusListEntry = {
	id: string;
	type: "BitstringStatusListEntry";
	statusPurpose: StatusPurpose;
	/** A base-10 integer as a string (BSL §2.1). */
	statusListIndex: string;
	statusListCredential: string;
};

export type DataIntegrityProof = {
	type: "DataIntegrityProof";
	cryptosuite: "eddsa-jcs-2022" | "eddsa-rdfc-2022";
	created: string;
	verificationMethod: string;
	proofPurpose: "assertionMethod";
	proofValue: string;
	"@context"?: string[];
	expires?: string;
};

export type OpenBadgeCredential = {
	"@context": string[];
	id: string;
	type: string[];
	name?: string;
	description?: string;
	issuer: IssuerProfile;
	validFrom: string;
	validUntil?: string;
	awardedDate?: string;
	credentialSubject: AchievementSubject;
	credentialStatus?: BitstringStatusListEntry;
	evidence?: Evidence[];
	/** One proof, or a proof set (VC Data Integrity §2.1.1). */
	proof?: DataIntegrityProof | DataIntegrityProof[];
};

export type BitstringStatusList = {
	id: string;
	type: "BitstringStatusList";
	statusPurpose: StatusPurpose;
	encodedList: string;
	/** Milliseconds a verifier may cache the list (BSL §2.2); never overrides the validity period. */
	ttl?: number;
};

export type BitstringStatusListCredential = {
	"@context": string[];
	id: string;
	type: string[];
	issuer: string;
	validFrom: string;
	validUntil?: string;
	credentialSubject: BitstringStatusList;
	/** One proof, or a proof set (VC Data Integrity §2.1.1). */
	proof?: DataIntegrityProof | DataIntegrityProof[];
};
