/**
 * Hand-written structural validators (no ajv, no codegen: Workers refuse `new Function`). Each issue names the JSON
 * path it is about. They check what this library relies on, from OB3 B.1.x and the OB3 JSON schema (required
 * `@context`, `id`, `type`, `credentialSubject`, `issuer`, `validFrom`; one `credentialStatus`), VC DM 2.0 §4 and
 * Bitstring Status List §2. Extra members stay allowed (OB3: "This class can be extended").
 */

import {
	type BitstringStatusListCredential,
	OB3_CONTEXT,
	type OpenBadgeCredential,
	VC_CONTEXT_V2,
} from "./types.js";
import {
	BASE10_INDEX,
	Collector,
	type ContextOptions,
	IDENTITY_HASH,
	result,
	type Validation,
} from "./validation.js";

export type {
	ContextOptions,
	Validation,
	ValidationCode,
	ValidationIssue,
} from "./validation.js";

const checkIdentifier = (
	collector: Collector,
	value: unknown,
	path: string,
): void => {
	const identity = collector.record(value, path);
	if (identity === null) return;
	if (identity.type !== "IdentityObject")
		collector.add(`${path}.type`, "value", "must be IdentityObject");
	collector.string(identity.identityType, `${path}.identityType`);
	if (typeof identity.hashed !== "boolean")
		collector.add(`${path}.hashed`, "type", "must be a boolean");
	const hash = collector.string(identity.identityHash, `${path}.identityHash`);
	if (identity.hashed === true && hash !== null && !IDENTITY_HASH.test(hash)) {
		collector.add(
			`${path}.identityHash`,
			"format",
			"must be sha256$<hex> or md5$<hex>",
		);
	}
	collector.string(identity.salt, `${path}.salt`, { optional: true });
};

const checkAchievement = (
	collector: Collector,
	value: unknown,
	path: string,
): void => {
	const achievement = collector.record(value, path);
	if (achievement === null) return;
	collector.uri(achievement.id, `${path}.id`);
	collector.types(achievement.type, `${path}.type`, ["Achievement"]);
	collector.string(achievement.name, `${path}.name`);
	collector.string(achievement.description, `${path}.description`);
	const criteria = collector.record(achievement.criteria, `${path}.criteria`);
	if (criteria !== null) {
		collector.uri(criteria.id, `${path}.criteria.id`, { optional: true });
		collector.string(criteria.narrative, `${path}.criteria.narrative`, {
			optional: true,
		});
	}
	collector.string(achievement.achievementType, `${path}.achievementType`, {
		optional: true,
	});
	collector.string(achievement.humanCode, `${path}.humanCode`, {
		optional: true,
	});
};

const checkSubject = (collector: Collector, value: unknown): void => {
	const subject = collector.record(value, "credentialSubject");
	if (subject === null) return;
	collector.types(subject.type, "credentialSubject.type", [
		"AchievementSubject",
	]);
	collector.uri(subject.id, "credentialSubject.id", { optional: true });
	const identifiers = subject.identifier;
	if (identifiers !== undefined && !Array.isArray(identifiers)) {
		collector.add("credentialSubject.identifier", "type", "must be an array");
	}
	const list = Array.isArray(identifiers) ? identifiers : [];
	for (const [index, identity] of list.entries()) {
		checkIdentifier(
			collector,
			identity,
			`credentialSubject.identifier[${index}]`,
		);
	}
	// OB3 B.1.3: "Either id or at least one identifier MUST be supplied."
	if (subject.id === undefined && list.length === 0) {
		collector.add(
			"credentialSubject",
			"required",
			"needs an id or at least one identifier",
		);
	}
	checkAchievement(
		collector,
		subject.achievement,
		"credentialSubject.achievement",
	);
};

const checkStatusEntry = (collector: Collector, value: unknown): void => {
	if (Array.isArray(value)) {
		collector.add(
			"credentialStatus",
			"type",
			"OB3 allows a single credentialStatus object",
		);
		return;
	}
	const entry = collector.record(value, "credentialStatus");
	if (entry === null) return;
	if (entry.type !== "BitstringStatusListEntry") {
		collector.add(
			"credentialStatus.type",
			"value",
			"must be BitstringStatusListEntry",
		);
	}
	if (
		entry.statusPurpose !== "revocation" &&
		entry.statusPurpose !== "suspension"
	) {
		collector.add(
			"credentialStatus.statusPurpose",
			"value",
			"must be revocation or suspension",
		);
	}
	const index = collector.string(
		entry.statusListIndex,
		"credentialStatus.statusListIndex",
	);
	if (index !== null && !BASE10_INDEX.test(index)) {
		collector.add(
			"credentialStatus.statusListIndex",
			"format",
			"must be a base-10 integer string",
		);
	}
	collector.uri(
		entry.statusListCredential,
		"credentialStatus.statusListCredential",
	);
	collector.uri(entry.id, "credentialStatus.id", { optional: true });
	if (entry.id !== undefined && entry.id === entry.statusListCredential) {
		collector.add(
			"credentialStatus.id",
			"value",
			"must not be the status list URL",
		);
	}
};

const checkEvidence = (collector: Collector, value: unknown): void => {
	if (value === undefined) return;
	if (!Array.isArray(value)) {
		collector.add("evidence", "type", "must be an array");
		return;
	}
	for (const [index, item] of value.entries()) {
		const path = `evidence[${index}]`;
		const evidence = collector.record(item, path);
		if (evidence === null) continue;
		collector.uri(evidence.id, `${path}.id`);
		collector.types(evidence.type, `${path}.type`, ["Evidence"]);
		const digest = collector.string(
			evidence.digestMultibase,
			`${path}.digestMultibase`,
		);
		if (digest !== null && !/^[uz]/.test(digest)) {
			collector.add(
				`${path}.digestMultibase`,
				"format",
				"must be multibase (u or z)",
			);
		}
	}
};

/** Structure of an OB3 OpenBadgeCredential as this library issues it. Does not look at `proof`. */
export const validateOpenBadgeCredential = (
	value: unknown,
	options: ContextOptions = {},
): Validation<OpenBadgeCredential> => {
	const collector = new Collector();
	const credential = collector.record(value, "$");
	if (credential === null) return result(collector, value);
	collector.context(
		credential["@context"],
		[VC_CONTEXT_V2, OB3_CONTEXT],
		options,
	);
	collector.uri(credential.id, "id");
	collector.types(
		credential.type,
		"type",
		["VerifiableCredential"],
		["OpenBadgeCredential", "AchievementCredential"],
	);
	collector.string(credential.name, "name", { optional: true });
	collector.string(credential.description, "description", { optional: true });
	const issuer = collector.record(credential.issuer, "issuer");
	if (issuer !== null) {
		collector.uri(issuer.id, "issuer.id");
		collector.types(issuer.type, "issuer.type", ["Profile"]);
		collector.string(issuer.name, "issuer.name", { optional: true });
	}
	const validFrom = collector.dateTime(credential.validFrom, "validFrom");
	const validUntil = collector.dateTime(credential.validUntil, "validUntil", {
		optional: true,
	});
	if (validFrom !== null && validUntil !== null && validUntil < validFrom) {
		collector.add("validUntil", "value", "must not be before validFrom");
	}
	collector.dateTime(credential.awardedDate, "awardedDate", { optional: true });
	checkSubject(collector, credential.credentialSubject);
	if (credential.credentialStatus !== undefined)
		checkStatusEntry(collector, credential.credentialStatus);
	checkEvidence(collector, credential.evidence);
	return result(collector, value);
};

/** Structure of a BitstringStatusListCredential (BSL §2.2). Does not look at `proof` or decode the list. */
export const validateStatusListCredential = (
	value: unknown,
	options: ContextOptions = {},
): Validation<BitstringStatusListCredential> => {
	const collector = new Collector();
	const credential = collector.record(value, "$");
	if (credential === null) return result(collector, value);
	collector.context(credential["@context"], [VC_CONTEXT_V2], options);
	collector.uri(credential.id, "id");
	collector.types(credential.type, "type", [
		"VerifiableCredential",
		"BitstringStatusListCredential",
	]);
	if (typeof credential.issuer !== "string") {
		collector.add(
			"issuer",
			credential.issuer === undefined ? "required" : "type",
			"must be a DID string",
		);
	}
	const validFrom = collector.dateTime(credential.validFrom, "validFrom", {
		optional: true,
	});
	const validUntil = collector.dateTime(credential.validUntil, "validUntil", {
		optional: true,
	});
	if (validFrom !== null && validUntil !== null && validUntil < validFrom) {
		collector.add("validUntil", "value", "must not be before validFrom");
	}
	const subject = collector.record(
		credential.credentialSubject,
		"credentialSubject",
	);
	if (subject !== null) {
		if (subject.type !== "BitstringStatusList") {
			collector.add(
				"credentialSubject.type",
				"value",
				"must be BitstringStatusList",
			);
		}
		if (
			subject.statusPurpose !== "revocation" &&
			subject.statusPurpose !== "suspension"
		) {
			collector.add(
				"credentialSubject.statusPurpose",
				"value",
				"must be revocation or suspension",
			);
		}
		const encoded = collector.string(
			subject.encodedList,
			"credentialSubject.encodedList",
		);
		if (encoded !== null && !encoded.startsWith("u")) {
			collector.add(
				"credentialSubject.encodedList",
				"format",
				"must be base64url multibase (u)",
			);
		}
		if (
			subject.ttl !== undefined &&
			(typeof subject.ttl !== "number" || subject.ttl < 0)
		) {
			collector.add(
				"credentialSubject.ttl",
				"type",
				"must be a non-negative number of ms",
			);
		}
	}
	return result(collector, value);
};
