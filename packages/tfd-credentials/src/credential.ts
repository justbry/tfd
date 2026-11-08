/**
 * Builders for unsigned OB3 credentials. One API, two templates:
 *
 * - `achievement`: the permanent certificate (no `validUntil` unless the caller sets one).
 * - `standing`: the short-lived annual listing, `validUntil` one calendar year after `validFrom`, its own Achievement
 *   (`<level achievement id>/standing`), so a verifier can never mistake a lapsed listing for a lost certificate.
 *
 * Privacy (README "Privacy"): no email anywhere; the subject's `id` is optional; a holder without one is named by a
 * salted hash of a caller-chosen opaque reference; a display name appears only when the caller passes it; the
 * credential id is a caller-supplied random URN, never derived from personal data.
 */
import { concatBytes, sha256Bytes, toHex, utf8 } from "./bytes.js";
import { formatDateTimeStamp, oneYearLater } from "./datetime.js";
import { CredentialsError } from "./errors.js";
import { multibaseBase64url } from "./multibase.js";
import type { RandomBytes } from "./status.js";
import {
	type Achievement,
	type AchievementSubject,
	type BitstringStatusListEntry,
	type Criteria,
	type Evidence,
	type IdentityObject,
	type Image,
	type IssuerProfile,
	OPEN_BADGE_CONTEXT,
	type OpenBadgeCredential,
} from "./types.js";

/** One certification level of a program, e.g. URLU's Participant, Coach and Mediator. */
export type LevelDefinition = {
	/** Short level label, carried in `achievement.humanCode`. */
	level: string;
	/** Stable URL of the permanent Achievement. */
	achievementId: string;
	name: string;
	description: string;
	criteria: Criteria;
	image?: Image;
	/** What the annual standing asks for; a default narrative is used when absent. */
	standingCriteria?: Criteria;
};

export type HolderInput = {
	/** A DID or other URI the holder controls. Optional: holders may be children with no key. */
	id?: string;
	/** An opaque reference the caller can re-derive (never an email); stored as a salted SHA-256 IdentityObject. */
	reference?: { value: string; salt: string };
	/** Display name, only with the holder's consent. Shown on a public page only with `includeName`. */
	name?: string;
};

export type CredentialInput = {
	/** A random `urn:uuid:` (see `credentialIdFromRandom`). */
	id: string;
	issuer: IssuerProfile;
	level: LevelDefinition;
	holder: HolderInput;
	/** The caller's clock in ms; `validFrom` and `awardedDate` default to it. */
	now: number;
	validFrom?: number;
	/** Overrides the template's default (none for an achievement, one year for standing). */
	validUntil?: number;
	credentialStatus?: BitstringStatusListEntry;
	evidence?: Evidence[];
};

export type CredentialKind = "achievement" | "standing";

export type CredentialTemplate = {
	kind: CredentialKind;
	achievement(level: LevelDefinition): Achievement;
	name(level: LevelDefinition, validUntil: number | null): string;
	defaultValidUntil(validFrom: number): number | null;
};

const datePart = (ms: number): string => formatDateTimeStamp(ms).slice(0, 10);

export const ACHIEVEMENT_TEMPLATE: CredentialTemplate = {
	kind: "achievement",
	achievement: (level) => {
		const achievement: Achievement = {
			id: level.achievementId,
			type: ["Achievement"],
			name: level.name,
			description: level.description,
			criteria: level.criteria,
			achievementType: "Certification",
			humanCode: level.level,
		};
		if (level.image !== undefined) achievement.image = level.image;
		return achievement;
	},
	name: (level) => level.name,
	defaultValidUntil: () => null,
};

export const STANDING_TEMPLATE: CredentialTemplate = {
	kind: "standing",
	achievement: (level) => {
		const achievement: Achievement = {
			id: `${level.achievementId}/standing`,
			type: ["Achievement"],
			name: `${level.name}, annual standing`,
			description: `Listed in good standing as ${level.name} for the validity period of this credential.`,
			criteria: level.standingCriteria ?? {
				narrative: `Holds the ${level.name} certification and meets the annual standing requirements.`,
			},
			achievementType: "Membership",
			humanCode: level.level,
		};
		if (level.image !== undefined) achievement.image = level.image;
		return achievement;
	},
	name: (level, validUntil) =>
		validUntil === null
			? `${level.name}, standing`
			: `${level.name}, standing until ${datePart(validUntil)}`,
	defaultValidUntil: oneYearLater,
};

const UUID_URN =
	/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const URI = /^[a-zA-Z][a-zA-Z0-9+.-]*:\S+$/;
const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/** A version 4 UUID URN from 16 injected random bytes (RFC 9562 §5.4). */
export const credentialIdFromRandom = (randomBytes: RandomBytes): string => {
	const bytes = randomBytes(16).slice();
	if (bytes.length !== 16) {
		throw new CredentialsError(
			"input_invalid",
			"randomBytes must return the length asked for",
		);
	}
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = toHex(bytes);
	return `urn:uuid:${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

/** OB3 IdentityHash: `sha256$` + hex SHA-256 of the identifier with the salt appended, both UTF-8 (OB3 IdentityHash). */
export const identityHash = (value: string, salt: string): string =>
	`sha256$${toHex(sha256Bytes(utf8(value + salt)))}`;

const MULTIHASH_SHA256 = [0x12, 0x20] as const;

/** `digestMultibase` of some bytes: base64url multibase of the SHA-256 multihash (VC Data Integrity §2.3). */
export const sha256DigestMultibase = (content: Uint8Array): string =>
	multibaseBase64url(
		concatBytes(new Uint8Array(MULTIHASH_SHA256), sha256Bytes(content)),
	);

/** Evidence as a pointer plus digest. The content itself never enters the credential. */
export const evidencePointer = (input: {
	id: string;
	digestMultibase: string;
	name?: string;
}): Evidence => {
	if (!URI.test(input.id))
		throw new CredentialsError("input_invalid", "evidence id must be a URI");
	const evidence: Evidence = {
		id: input.id,
		type: ["Evidence"],
		digestMultibase: input.digestMultibase,
	};
	if (input.name !== undefined) evidence.name = input.name;
	return evidence;
};

export const issuerProfile = (input: {
	id: string;
	name?: string;
	url?: string;
	description?: string;
	image?: Image;
}): IssuerProfile => {
	const profile: IssuerProfile = { id: input.id, type: ["Profile"] };
	if (input.name !== undefined) profile.name = input.name;
	if (input.url !== undefined) profile.url = input.url;
	if (input.description !== undefined) profile.description = input.description;
	if (input.image !== undefined) profile.image = input.image;
	return profile;
};

const subjectOf = (
	holder: HolderInput,
	achievement: Achievement,
): AchievementSubject => {
	const subject: AchievementSubject = {
		type: ["AchievementSubject"],
		achievement,
	};
	if (holder.id !== undefined) {
		if (!URI.test(holder.id))
			throw new CredentialsError("input_invalid", "holder.id must be a URI");
		subject.id = holder.id;
	}
	const identifiers: IdentityObject[] = [];
	if (holder.reference !== undefined) {
		if (EMAIL_LIKE.test(holder.reference.value)) {
			throw new CredentialsError(
				"input_invalid",
				"holder.reference must not be an email address",
			);
		}
		if (holder.reference.salt === "") {
			throw new CredentialsError(
				"input_invalid",
				"holder.reference needs a salt",
			);
		}
		identifiers.push({
			type: "IdentityObject",
			identityType: "identifier",
			hashed: true,
			identityHash: identityHash(holder.reference.value, holder.reference.salt),
			salt: holder.reference.salt,
		});
	}
	if (holder.name !== undefined) {
		if (EMAIL_LIKE.test(holder.name)) {
			throw new CredentialsError(
				"input_invalid",
				"holder.name must not be an email address",
			);
		}
		identifiers.push({
			type: "IdentityObject",
			identityType: "name",
			hashed: false,
			identityHash: holder.name,
		});
	}
	// OB3 B.1.3: "Either id or at least one identifier MUST be supplied."; a name alone is not an identity.
	if (subject.id === undefined && holder.reference === undefined) {
		throw new CredentialsError(
			"input_invalid",
			"the holder needs an id or a reference",
		);
	}
	if (identifiers.length > 0) subject.identifier = identifiers;
	return subject;
};

/** An unsigned OpenBadgeCredential from a template. Sign it with `addProof` (or use `issue`). */
export const buildCredential = (
	template: CredentialTemplate,
	input: CredentialInput,
): OpenBadgeCredential => {
	if (!UUID_URN.test(input.id)) {
		throw new CredentialsError(
			"input_invalid",
			"the credential id must be a random urn:uuid",
		);
	}
	const validFrom = input.validFrom ?? input.now;
	const validUntil = input.validUntil ?? template.defaultValidUntil(validFrom);
	if (validUntil !== null && validUntil < validFrom) {
		throw new CredentialsError(
			"input_invalid",
			"validUntil is before validFrom",
		);
	}
	const achievement = template.achievement(input.level);
	const credential: OpenBadgeCredential = {
		"@context": [...OPEN_BADGE_CONTEXT],
		id: input.id,
		type: ["VerifiableCredential", "OpenBadgeCredential"],
		name: template.name(input.level, validUntil),
		issuer: input.issuer,
		validFrom: formatDateTimeStamp(validFrom),
		awardedDate: formatDateTimeStamp(validFrom),
		credentialSubject: subjectOf(input.holder, achievement),
	};
	if (validUntil !== null)
		credential.validUntil = formatDateTimeStamp(validUntil);
	if (input.credentialStatus !== undefined)
		credential.credentialStatus = input.credentialStatus;
	if (input.evidence !== undefined && input.evidence.length > 0)
		credential.evidence = input.evidence;
	return credential;
};

export const buildAchievementCredential = (
	input: CredentialInput,
): OpenBadgeCredential => buildCredential(ACHIEVEMENT_TEMPLATE, input);

export const buildStandingCredential = (
	input: CredentialInput,
): OpenBadgeCredential => buildCredential(STANDING_TEMPLATE, input);

/** Which template made a credential: standing achievements end in `/standing`. */
export const kindOf = (credential: OpenBadgeCredential): CredentialKind =>
	credential.credentialSubject.achievement.id.endsWith("/standing")
		? "standing"
		: "achievement";
