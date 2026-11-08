import { describe, expect, test } from "bun:test";
import {
	ACHIEVEMENT_TEMPLATE,
	buildAchievementCredential,
	buildStandingCredential,
	type CredentialInput,
	credentialIdFromRandom,
	evidencePointer,
	identityHash,
	issuerProfile,
	kindOf,
	OB3_CONTEXT,
	parseDateTimeStamp,
	STANDING_TEMPLATE,
	sha256DigestMultibase,
	statusEntry,
	URLU_ISSUER_NAME,
	urluLevels,
	VC_CONTEXT_V2,
	validateOpenBadgeCredential,
	validateStatusListCredential,
} from "../src/index.js";
import { seededRandomBytes } from "../src/testing.js";
import { CREDENTIAL_IDS, ISSUER_DID, LEVELS, NOW } from "./fixtures.js";

const issuer = issuerProfile({ id: ISSUER_DID, name: URLU_ISSUER_NAME });
const base: CredentialInput = {
	id: CREDENTIAL_IDS.first,
	issuer,
	level: LEVELS.Coach,
	holder: { reference: { value: "member-7", salt: "s1" } },
	now: NOW,
};

describe("builders", () => {
	test("the achievement credential is OB3 with VC 2.0 contexts and no validUntil", () => {
		const credential = buildAchievementCredential(base);
		expect(credential["@context"]).toEqual([VC_CONTEXT_V2, OB3_CONTEXT]);
		expect(OB3_CONTEXT).toBe(
			"https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json",
		);
		expect(credential.type).toEqual([
			"VerifiableCredential",
			"OpenBadgeCredential",
		]);
		expect(credential.validFrom).toBe("2026-11-07T12:00:00Z");
		expect(credential.validUntil).toBeUndefined();
		expect(credential.credentialSubject.id).toBeUndefined();
		expect(credential.credentialSubject.achievement.humanCode).toBe("Coach");
		expect(credential.credentialSubject.achievement.achievementType).toBe(
			"Certification",
		);
		expect(kindOf(credential)).toBe("achievement");
		expect(validateOpenBadgeCredential(credential).ok).toBe(true);
	});

	test("the standing credential: same API, own achievement, valid for one calendar year", () => {
		const credential = buildStandingCredential(base);
		expect(credential.validUntil).toBe("2027-11-07T12:00:00Z");
		expect(credential.credentialSubject.achievement.id).toBe(
			`${LEVELS.Coach.achievementId}/standing`,
		);
		expect(credential.credentialSubject.achievement.achievementType).toBe(
			"Membership",
		);
		expect(credential.name).toBe(
			"URLU Certified Coach, standing until 2027-11-07",
		);
		expect(kindOf(credential)).toBe("standing");
		expect(validateOpenBadgeCredential(credential).ok).toBe(true);
		const leap = buildStandingCredential({
			...base,
			now: Date.UTC(2028, 1, 29),
		});
		expect(leap.validUntil).toBe("2029-03-01T00:00:00Z");
	});

	test("holders: hashed opaque reference (OB3 IdentityHash), optional plain name, optional id", () => {
		const credential = buildAchievementCredential({
			...base,
			holder: {
				reference: { value: "member-7", salt: "s1" },
				name: "Ada Example",
				id: "did:example:ada",
			},
		});
		expect(credential.credentialSubject.id).toBe("did:example:ada");
		expect(credential.credentialSubject.identifier).toEqual([
			{
				type: "IdentityObject",
				identityType: "identifier",
				hashed: true,
				identityHash: identityHash("member-7", "s1"),
				salt: "s1",
			},
			{
				type: "IdentityObject",
				identityType: "name",
				hashed: false,
				identityHash: "Ada Example",
			},
		]);
		expect(identityHash("member-7", "s1")).toMatch(/^sha256\$[0-9a-f]{64}$/);
		expect(
			buildAchievementCredential({ ...base, holder: { id: "did:example:ada" } })
				.credentialSubject.identifier,
		).toBe(undefined);
	});

	test("privacy guards: no email, no name-only holder, ids must be random URNs", () => {
		const build = (overrides: Partial<CredentialInput>) => () =>
			buildAchievementCredential({ ...base, ...overrides });
		expect(
			build({ holder: { reference: { value: "ada@example.org", salt: "s" } } }),
		).toThrow("email");
		expect(
			build({
				holder: {
					name: "ada@example.org",
					reference: { value: "m", salt: "s" },
				},
			}),
		).toThrow("email");
		expect(build({ holder: { name: "Ada" } })).toThrow(
			"needs an id or a reference",
		);
		expect(
			build({ id: "https://urlu.example/credentials/ada-lovelace" }),
		).toThrow("urn:uuid");
		expect(build({ validUntil: NOW - 1 })).toThrow("before validFrom");
		const id = credentialIdFromRandom(seededRandomBytes("ids"));
		expect(id).toMatch(
			/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
		);
	});

	test("evidence is a pointer and a SHA-256 multihash digest, never the content", () => {
		const content = new TextEncoder().encode("signed attendance sheet");
		const evidence = evidencePointer({
			id: "https://urlu.example/evidence/abc",
			digestMultibase: sha256DigestMultibase(content),
		});
		// u + base64url(0x12 0x20 ...): "uEiB" is the multihash prefix for sha2-256, as in VC DM 2.0 Example 26.
		expect(evidence.digestMultibase.startsWith("uEiB")).toBe(true);
		const credential = buildAchievementCredential({
			...base,
			evidence: [evidence],
		});
		expect(JSON.stringify(credential)).not.toContain("attendance");
		expect(validateOpenBadgeCredential(credential).ok).toBe(true);
	});

	test("no default text says licensed", () => {
		const texts = JSON.stringify([
			urluLevels("https://urlu.example/a"),
			ACHIEVEMENT_TEMPLATE.achievement(LEVELS.Mediator),
			STANDING_TEMPLATE.achievement(LEVELS.Mediator),
			STANDING_TEMPLATE.name(LEVELS.Mediator, NOW),
			buildStandingCredential(base),
		]);
		expect(texts).not.toMatch(/licen[cs]/i);
		expect(texts).toContain("Certified by the URLU Institute");
	});
});

describe("validators report precise paths", () => {
	const pathsOf = (value: unknown): string[] => {
		const result = validateOpenBadgeCredential(value);
		return result.ok
			? []
			: result.issues.map((issue) => `${issue.path}:${issue.code}`);
	};

	test("missing and malformed members", () => {
		const credential = buildAchievementCredential(base) as unknown as Record<
			string,
			unknown
		>;
		const subject = credential.credentialSubject as Record<string, unknown>;
		const broken = {
			...credential,
			validFrom: "2026-13-01T00:00:00Z",
			issuer: { id: ISSUER_DID, type: ["Organization"] },
			credentialSubject: {
				...subject,
				identifier: undefined,
				achievement: {
					...(subject.achievement as object),
					criteria: undefined,
					name: "",
				},
			},
			credentialStatus: [
				statusEntry("https://urlu.example/s", "revocation", 1),
			],
		};
		expect(pathsOf(broken).sort()).toEqual(
			[
				"credentialStatus:type",
				"credentialSubject:required",
				"credentialSubject.achievement.criteria:required",
				"credentialSubject.achievement.name:type",
				"issuer.type:value",
				"validFrom:format",
			].sort(),
		);
		expect(pathsOf("nope")).toEqual(["$:type"]);
	});

	test("contexts: VC v2 first, OB3 second, nothing else unless allowed, never inline", () => {
		const credential = buildAchievementCredential(base);
		expect(
			pathsOf({ ...credential, "@context": [OB3_CONTEXT, VC_CONTEXT_V2] }),
		).toEqual(["@context[0]:context", "@context[1]:context"]);
		const extra = {
			...credential,
			"@context": [VC_CONTEXT_V2, OB3_CONTEXT, "https://evil.example/ctx"],
		};
		expect(pathsOf(extra)).toEqual(["@context[2]:context"]);
		expect(
			validateOpenBadgeCredential(extra, {
				extraContexts: ["https://evil.example/ctx"],
			}).ok,
		).toBe(true);
		expect(
			pathsOf({
				...credential,
				"@context": [VC_CONTEXT_V2, OB3_CONTEXT, { name: "@id" }],
			}),
		).toEqual(["@context[2]:context"]);
		expect(
			pathsOf({
				...credential,
				"@context": [
					VC_CONTEXT_V2,
					"https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.2.json",
				],
			}),
		).toEqual(["@context[1]:context"]);
	});

	test("status entry rules (BSL §2.1)", () => {
		const credential = buildAchievementCredential(base);
		const entry = statusEntry("https://urlu.example/s", "revocation", 5);
		expect(
			pathsOf({
				...credential,
				credentialStatus: { ...entry, statusListIndex: "05" },
			}),
		).toEqual(["credentialStatus.statusListIndex:format"]);
		expect(
			pathsOf({
				...credential,
				credentialStatus: { ...entry, id: entry.statusListCredential },
			}),
		).toEqual(["credentialStatus.id:value"]);
		expect(
			pathsOf({
				...credential,
				credentialStatus: { ...entry, statusPurpose: "refresh" },
			}),
		).toEqual(["credentialStatus.statusPurpose:value"]);
	});

	test("status list credential validator", () => {
		const result = validateStatusListCredential({
			"@context": [VC_CONTEXT_V2],
			id: "https://urlu.example/s",
			type: ["VerifiableCredential"],
			issuer: { id: ISSUER_DID },
			credentialSubject: {
				type: "BitstringStatusList",
				statusPurpose: "revocation",
				encodedList: "zabc",
			},
		});
		expect(result.ok ? [] : result.issues.map((issue) => issue.path)).toEqual([
			"type",
			"issuer",
			"credentialSubject.encodedList",
		]);
	});

	test("dateTimeStamp parsing (XML Schema 1.1)", () => {
		expect(parseDateTimeStamp("2026-11-07T12:00:00Z")).toBe(NOW);
		expect(parseDateTimeStamp("2026-11-07T13:30:00+01:30")).toBe(NOW);
		expect(parseDateTimeStamp("2026-11-07T12:00:00.5Z")).toBe(NOW + 500);
		expect(parseDateTimeStamp("2026-11-06T24:00:00Z")).toBe(
			Date.UTC(2026, 10, 7),
		);
		for (const bad of [
			"2026-11-07T12:00:00",
			"2026-02-30T00:00:00Z",
			"2026-11-07 12:00:00Z",
			"2026-11-07T12:00:00+15:00",
		]) {
			expect(parseDateTimeStamp(bad)).toBeNull();
		}
	});
});
