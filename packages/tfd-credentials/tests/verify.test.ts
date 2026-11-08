import { beforeAll, describe, expect, test } from "bun:test";
import {
	addProof,
	buildAchievementCredential,
	buildDidWebDocument,
	didKeyFromPublicKey,
	didWebToUrl,
	formatDateTimeStamp,
	OB3_CONTEXT,
	type OpenBadgeCredential,
	publicView,
	type StatusListResolver,
	VC_CONTEXT_V2,
	type VerificationResult,
	type VerifyOptions,
	verifyCredential,
} from "../src/index.js";
import { createTestKey } from "../src/testing.js";
import {
	CREDENTIAL_IDS,
	DAY,
	ISSUER_DID,
	KEY_ID,
	LEVELS,
	NOW,
	REVOCATION_LIST,
	setupIssuer,
} from "./fixtures.js";

type World = Awaited<ReturnType<typeof setupIssuer>>;
let world: World;
let credential: OpenBadgeCredential;
let options: VerifyOptions;

beforeAll(async () => {
	world = await setupIssuer("negative");
	credential = (await world.issueMediator(CREDENTIAL_IDS.first)).credential;
	options = {
		now: NOW + DAY,
		resolveDid: world.resolveDid,
		resolveStatusList: world.resolveStatusList,
	};
});

const copy = (): Record<string, unknown> =>
	structuredClone(credential) as unknown as Record<string, unknown>;
const proofOf = (document: Record<string, unknown>): Record<string, unknown> =>
	document.proof as Record<string, unknown>;
const failure = (result: VerificationResult): string => {
	for (const name of [
		"structure",
		"signature",
		"issuerKey",
		"validity",
	] as const) {
		const check = result.checks[name];
		if (check.outcome === "failed") return `${name}:${check.reason}`;
	}
	return "none";
};

/** Re-sign a modified unsigned credential with some signer, as a forger with their own key would. */
const resign = async (
	document: Record<string, unknown>,
	keyId: string,
	label: string,
): Promise<Record<string, unknown>> => {
	const { proof: _proof, ...unsigned } = document;
	return addProof(unsigned, {
		signer: createTestKey(label).signer(keyId),
		created: formatDateTimeStamp(NOW),
	});
};

describe("proof tricks fail with specific reasons", () => {
	test("unsupported proof type and cryptosuite", async () => {
		const otherType = copy();
		proofOf(otherType).type = "Ed25519Signature2020";
		expect(failure(await verifyCredential(otherType, options))).toBe(
			"signature:proof_type_unsupported",
		);
		const otherSuite = copy();
		proofOf(otherSuite).cryptosuite = "eddsa-rdfc-2022";
		expect(failure(await verifyCredential(otherSuite, options))).toBe(
			"signature:cryptosuite_unsupported",
		);
	});

	test("alg tricks: JWS members in a Data Integrity proof", async () => {
		for (const member of ["alg", "jws", "kid"]) {
			const document = copy();
			proofOf(document)[member] = member === "alg" ? "none" : "x";
			expect(failure(await verifyCredential(document, options))).toBe(
				"signature:proof_alg_forbidden",
			);
		}
	});

	test("a missing proof", async () => {
		const document = copy();
		delete document.proof;
		const result = await verifyCredential(document, options);
		expect(result.checks.signature).toMatchObject({ reason: "proof_missing" });
		expect(result.checks.issuerKey).toMatchObject({ reason: "proof_missing" });
		expect(result.status).toBe("unchecked");
	});
});

describe("contexts", () => {
	test("an extra context is refused even when re-signed by the real key", async () => {
		const document = copy();
		document["@context"] = [
			VC_CONTEXT_V2,
			OB3_CONTEXT,
			"https://evil.example/redefine-everything.json",
		];
		const forged = await resign(document, KEY_ID, "negative");
		const result = await verifyCredential(forged, options);
		expect(failure(result)).toBe("structure:context_invalid");
		expect(result.issues[0]?.path).toBe("@context[2]");
	});

	test("a swapped OB3 context and an inline context are refused", async () => {
		const swapped = copy();
		swapped["@context"] = [
			VC_CONTEXT_V2,
			"https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.9.json",
		];
		expect(failure(await verifyCredential(swapped, options))).toBe(
			"structure:context_invalid",
		);
		const inline = copy();
		inline["@context"] = [
			VC_CONTEXT_V2,
			OB3_CONTEXT,
			{ name: "https://schema.org/familyName" },
		];
		expect(failure(await verifyCredential(inline, options))).toBe(
			"structure:context_invalid",
		);
	});

	test("a proof @context that is not a prefix of the document's", async () => {
		const document = copy();
		proofOf(document)["@context"] = [OB3_CONTEXT];
		expect(failure(await verifyCredential(document, options))).toBe(
			"signature:proof_context_mismatch",
		);
	});
});

describe("keys the issuer did not authorise", () => {
	test("a did:key forger: signature fine, key not the issuer's", async () => {
		const forger = createTestKey("forger");
		const did = didKeyFromPublicKey(forger.publicKey);
		const forged = await resign(
			copy(),
			`${did}#${did.slice("did:key:".length)}`,
			"forger",
		);
		const result = await verifyCredential(forged, options);
		expect(result.checks.signature.outcome).toBe("passed");
		expect(result.checks.issuerKey).toMatchObject({
			outcome: "failed",
			reason: "verification_method_not_issuer",
		});
		expect(result.verified).toBe(false);
		expect(result.status).toBe("unchecked");
		expect(publicView(result)).toBeNull();
	});

	test("a key in the issuer's document but not under assertionMethod", async () => {
		const retired = createTestKey("retired");
		world.documents.set(
			didWebToUrl(ISSUER_DID),
			buildDidWebDocument({
				did: ISSUER_DID,
				keys: [
					{ fragment: "key-1", publicKey: world.key.publicKey },
					{ fragment: "key-0", publicKey: retired.publicKey },
				],
				assertionMethod: ["key-1"],
			}),
		);
		const forged = await resign(copy(), `${ISSUER_DID}#key-0`, "retired");
		const result = await verifyCredential(forged, options);
		expect(result.checks.signature.outcome).toBe("passed");
		expect(result.checks.issuerKey).toMatchObject({
			reason: "verification_method_not_authorised",
		});
	});

	test("a key id the issuer's document does not have, and an unresolvable DID", async () => {
		const unknown = await resign(copy(), `${ISSUER_DID}#key-9`, "negative");
		expect(failure(await verifyCredential(unknown, options))).toBe(
			"signature:verification_method_unresolved",
		);
		expect(
			(await verifyCredential(unknown, options)).checks.issuerKey,
		).toMatchObject({
			reason: "verification_method_not_found",
		});
		const offlineDid = await verifyCredential(credential, {
			...options,
			resolveDid: async () => {
				throw new Error("network down");
			},
		});
		expect(offlineDid.checks.issuerKey).toMatchObject({
			reason: "did_resolution_failed",
		});
		expect(offlineDid.verified).toBe(false);
	});

	test("an issuer swapped to another DID keeps the original proof: not the issuer's key", async () => {
		const document = copy();
		(document.issuer as Record<string, unknown>).id = "did:web:other.example";
		const result = await verifyCredential(document, options);
		expect(result.checks.issuerKey).toMatchObject({
			reason: "verification_method_not_issuer",
		});
		expect(result.checks.signature).toMatchObject({
			reason: "signature_invalid",
		});
	});
});

/** Every leaf path in a JSON value. */
const leaves = (
	value: unknown,
	path: (string | number)[] = [],
): (string | number)[][] => {
	if (Array.isArray(value))
		return value.flatMap((item, index) => leaves(item, [...path, index]));
	if (typeof value === "object" && value !== null) {
		return Object.entries(value).flatMap(([key, item]) =>
			leaves(item, [...path, key]),
		);
	}
	return [path];
};

const mutateAt = (
	document: Record<string, unknown>,
	path: (string | number)[],
): void => {
	let parent = document as Record<string | number, unknown>;
	for (const step of path.slice(0, -1))
		parent = parent[step] as Record<string | number, unknown>;
	const last = path.at(-1) as string | number;
	const current = parent[last];
	if (typeof current === "string") parent[last] = `${current}x`;
	else if (typeof current === "number") parent[last] = current + 1;
	else if (typeof current === "boolean") parent[last] = !current;
	else parent[last] = "tampered";
};

describe("tampering", () => {
	test("changing any signed field fails verification", async () => {
		const paths = leaves(copy()).filter(
			(path) => path.join(".") !== "proof.proofValue",
		);
		expect(paths.length).toBeGreaterThan(30);
		for (const path of paths) {
			const document = copy();
			mutateAt(document, path);
			const result = await verifyCredential(document, options);
			if (result.verified)
				throw new Error(`tampering ${path.join(".")} still verified`);
		}
	});

	test("adding a member, or removing an optional one, fails", async () => {
		const added = copy();
		added.description = "Now also a judge";
		expect(failure(await verifyCredential(added, options))).toBe(
			"signature:signature_invalid",
		);
		const removed = copy();
		delete removed.awardedDate;
		expect(failure(await verifyCredential(removed, options))).toBe(
			"signature:signature_invalid",
		);
		const flipped = copy();
		proofOf(flipped).proofValue =
			`z${"1".repeat(10)}${(proofOf(flipped).proofValue as string).slice(11)}`;
		expect((await verifyCredential(flipped, options)).verified).toBe(false);
	});
});

describe("validity period against the injected clock", () => {
	test("not yet valid, and expired", async () => {
		const early = await verifyCredential(credential, {
			...options,
			now: NOW - 1,
		});
		expect(failure(early)).toBe("validity:not_yet_valid");
		const unsigned = buildAchievementCredential({
			id: CREDENTIAL_IDS.second,
			issuer: world.issuer,
			level: LEVELS.Coach,
			holder: { id: "did:example:x" },
			now: NOW,
			validUntil: NOW + DAY,
		});
		const short = await addProof(unsigned, {
			signer: world.signer,
			created: formatDateTimeStamp(NOW),
		});
		expect(
			failure(
				await verifyCredential(short, { ...options, now: NOW + 2 * DAY }),
			),
		).toBe("validity:expired");
		const withExpiry = copy();
		proofOf(withExpiry).expires = formatDateTimeStamp(NOW);
		// Adding expires changes the signed proof options, so the signature fails first.
		expect(failure(await verifyCredential(withExpiry, options))).toBe(
			"signature:signature_invalid",
		);
	});

	test("no status entry is unchecked, never valid", async () => {
		const unsigned = buildAchievementCredential({
			id: CREDENTIAL_IDS.third,
			issuer: world.issuer,
			level: LEVELS.Participant,
			holder: { id: "did:example:x" },
			now: NOW,
		});
		const signed = await addProof(unsigned, {
			signer: world.signer,
			created: formatDateTimeStamp(NOW),
		});
		const result = await verifyCredential(signed, options);
		expect(result.verified).toBe(true);
		expect(result.checks.status).toMatchObject({
			state: "unchecked",
			reason: "no_status_entry",
		});
	});
});

describe("status lists that cannot be trusted stay unchecked", () => {
	const listOf = async (): Promise<Record<string, unknown>> =>
		structuredClone(
			(await world.statusLists.get(REVOCATION_LIST))?.value.credential,
		) as unknown as Record<string, unknown>;

	const statusWith = async (resolveStatusList: StatusListResolver) =>
		(await verifyCredential(credential, { ...options, resolveStatusList }))
			.checks.status;

	test("retrieval failure", async () => {
		expect(
			await statusWith(async () => {
				throw new Error("timeout");
			}),
		).toMatchObject({ state: "unchecked", reason: "status_retrieval_failed" });
	});

	test("a list with a tampered bitstring (all-clear replay) fails its own signature", async () => {
		const list = await listOf();
		(list.credentialSubject as Record<string, unknown>).encodedList =
			"uH4sIAAAAAAAAA-3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAIC3AYbSVKsAQAAA";
		expect(await statusWith(async () => list)).toMatchObject({
			reason: "status_list_signature_invalid",
		});
	});

	test("a list signed by someone else, served for this issuer", async () => {
		const attacker = createTestKey("list-attacker");
		const did = didKeyFromPublicKey(attacker.publicKey);
		const { proof: _proof, ...unsigned } = await listOf();
		const forged = await addProof(
			{ ...unsigned, issuer: did },
			{
				signer: attacker.signer(`${did}#${did.slice("did:key:".length)}`),
				created: formatDateTimeStamp(NOW),
			},
		);
		expect(await statusWith(async () => forged)).toMatchObject({
			reason: "status_list_issuer_mismatch",
		});
		const accepted = await verifyCredential(credential, {
			...options,
			resolveStatusList: async () => forged,
			acceptStatusIssuer: (statusIssuer) => statusIssuer === did,
		});
		expect(accepted.status).toBe("valid");
	});

	test("the wrong list, a wrong purpose, an expired list", async () => {
		const list = await listOf();
		expect(
			await statusWith(async () => ({
				...list,
				id: "https://urlu.example/status/other",
			})),
		).toMatchObject({
			reason: "status_list_id_mismatch",
		});
		const { proof: _proof, ...unsigned } = list;
		const suspension = await addProof(
			{
				...unsigned,
				credentialSubject: {
					...(unsigned.credentialSubject as object),
					statusPurpose: "suspension",
				},
			},
			{ signer: world.signer, created: formatDateTimeStamp(NOW) },
		);
		expect(await statusWith(async () => suspension)).toMatchObject({
			reason: "status_purpose_mismatch",
		});
		const expiring = await addProof(
			{ ...unsigned, validUntil: formatDateTimeStamp(NOW + 1000) },
			{ signer: world.signer, created: formatDateTimeStamp(NOW) },
		);
		expect(await statusWith(async () => expiring)).toMatchObject({
			reason: "status_list_expired",
		});
		expect(await statusWith(async () => ({ not: "a list" }))).toMatchObject({
			reason: "status_list_invalid",
		});
	});
});
