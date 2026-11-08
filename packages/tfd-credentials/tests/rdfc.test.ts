import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
	addProof,
	addProofSet,
	buildAchievementCredential,
	decodeEd25519Multikey,
	eddsaJcs2022,
	formatDateTimeStamp,
	inspectProof,
	JCS_SUITES,
	OB3_CONTEXT,
	type OpenBadgeCredential,
	proofsOf,
	suiteRegistry,
	VC_CONTEXT_V2,
	type VerifyOptions,
	verifyCredential,
	verifySignature,
} from "../src/index.js";
import {
	BUNDLED_CONTEXTS,
	createRdfcSuite,
	eddsaRdfc2022,
	RDFC_AND_JCS_PROOFS,
	RDFC_AND_JCS_SUITES,
	rdfcCanonicalize,
} from "../src/rdfc.js";
import { CREDENTIAL_IDS, DAY, LEVELS, NOW, setupIssuer } from "./fixtures.js";

const vector = (name: string): Promise<string> =>
	Bun.file(join(import.meta.dir, "vectors", name)).text();
const json = async (name: string): Promise<Record<string, unknown>> =>
	JSON.parse(await vector(name));

// EdDSA Cryptosuites v1.0 Appendix B.1 and B.2 (eddsa-rdfc-2022). Their contexts are test-only: the examples and
// citizenship contexts are not bundled with the library.
const SPEC_PUBLIC_KEY = "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2";
const EXAMPLES_CONTEXT = "https://www.w3.org/ns/credentials/examples/v2";
const CITIZENSHIP_CONTEXT = "https://w3id.org/citizenship/v4rc1";
let specSuite: ReturnType<typeof createRdfcSuite>;
let specContexts: Map<string, unknown>;

beforeAll(async () => {
	const extra = {
		[EXAMPLES_CONTEXT]: await json("contexts/credentials-examples-v2.json"),
		[CITIZENSHIP_CONTEXT]: await json("contexts/citizenship-v4rc1.json"),
	};
	specSuite = createRdfcSuite({ contexts: extra });
	specContexts = new Map([...BUNDLED_CONTEXTS, ...Object.entries(extra)]);
});

const alumniCredential = (): Record<string, unknown> => ({
	"@context": [VC_CONTEXT_V2, EXAMPLES_CONTEXT],
	id: "urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33",
	type: ["VerifiableCredential", "AlumniCredential"],
	name: "Alumni Credential",
	description: "A minimum viable example of an Alumni Credential.",
	issuer: "https://vc.example/issuers/5678",
	validFrom: "2023-01-01T00:00:00Z",
	credentialSubject: {
		id: "did:example:abcdefgh",
		alumniOf: "The School of Examples",
	},
});

const specProofOptions = (context: string[]) => ({
	type: "DataIntegrityProof",
	cryptosuite: "eddsa-rdfc-2022",
	created: "2023-02-24T23:36:38Z",
	verificationMethod: `did:key:${SPEC_PUBLIC_KEY}#${SPEC_PUBLIC_KEY}`,
	proofPurpose: "assertionMethod",
	"@context": context,
});

const verifiesWith = async (
	document: Record<string, unknown>,
	suite = specSuite,
): Promise<string> => {
	const { proof, ...unsecured } = document;
	const parsed = await inspectProof(unsecured, proof, suiteRegistry(suite));
	if (!parsed.ok) return parsed.reason;
	return verifySignature(
		parsed.hashData,
		parsed.signature,
		decodeEd25519Multikey(SPEC_PUBLIC_KEY),
	)
		? "verified"
		: "signature_invalid";
};

describe("eddsa-rdfc-2022 spec vectors", () => {
	test("B.1: canonical N-Quads of the credential and proof options equal Examples 9 and 12", async () => {
		expect(await rdfcCanonicalize(alumniCredential(), specContexts)).toBe(
			await vector("eddsa-rdfc-2022-b1-credential.nq"),
		);
		expect(
			await rdfcCanonicalize(
				specProofOptions([VC_CONTEXT_V2, EXAMPLES_CONTEXT]),
				specContexts,
			),
		).toBe(await vector("eddsa-rdfc-2022-b1-proof-options.nq"));
	});

	test("B.1: the signed credential (Example 17) verifies", async () => {
		const signed = {
			...alumniCredential(),
			proof: {
				...specProofOptions([]),
				"@context": undefined,
				proofValue:
					"z2YwC8z3ap7yx1nZYCg4L3j3ApHsF8kgPdSb5xoS1VR7vPG3F561B52hYnQF9iseabecm3ijx4K1FBTQsCZahKZme",
			},
		};
		expect(await verifiesWith(JSON.parse(JSON.stringify(signed)))).toBe(
			"verified",
		);
	});

	test("B.2: the Employment Authorization credential canonicalises to Examples 20 and 23 and verifies (Example 28)", async () => {
		const signed = await json("eddsa-rdfc-2022-b2-signed.json");
		const { proof: _proof, ...unsecured } = signed;
		expect(await rdfcCanonicalize(unsecured, specContexts)).toBe(
			await vector("eddsa-rdfc-2022-b2-credential.nq"),
		);
		expect(
			await rdfcCanonicalize(
				specProofOptions([VC_CONTEXT_V2, CITIZENSHIP_CONTEXT]),
				specContexts,
			),
		).toBe(await vector("eddsa-rdfc-2022-b2-proof-options.nq"));
		expect(await verifiesWith(signed)).toBe("verified");
		const tampered = structuredClone(signed);
		(tampered.credentialSubject as Record<string, unknown>).givenName = "JANE";
		expect(await verifiesWith(tampered)).toBe("signature_invalid");
	});

	test("contexts are offline: the vectors fail with the bundled contexts alone", async () => {
		expect(
			await verifiesWith(
				await json("eddsa-rdfc-2022-b2-signed.json"),
				eddsaRdfc2022,
			),
		).toBe("context_unknown");
		expect([...BUNDLED_CONTEXTS.keys()]).toEqual([
			VC_CONTEXT_V2,
			OB3_CONTEXT,
			"https://w3id.org/security/data-integrity/v2",
		]);
	});
});

type World = Awaited<ReturnType<typeof setupIssuer>>;
let world: World;
let options: VerifyOptions;

const signWith = async (
	suites: typeof RDFC_AND_JCS_PROOFS,
	id = CREDENTIAL_IDS.first,
): Promise<OpenBadgeCredential> => {
	const unsigned = buildAchievementCredential({
		id,
		issuer: world.issuer,
		level: LEVELS.Mediator,
		holder: {
			reference: { value: "member-1", salt: "salt" },
			name: "Ada Example",
		},
		now: NOW,
	});
	return addProofSet(unsigned, {
		signer: world.signer,
		created: formatDateTimeStamp(NOW),
		suites,
	}) as Promise<OpenBadgeCredential>;
};

beforeAll(async () => {
	world = await setupIssuer("rdfc");
	options = {
		now: NOW + DAY,
		resolveDid: world.resolveDid,
		suites: RDFC_AND_JCS_SUITES,
	};
});

const copyOf = (credential: OpenBadgeCredential): Record<string, unknown> =>
	structuredClone(credential) as unknown as Record<string, unknown>;

const signatureFailure = async (
	document: unknown,
	verifyOptions = options,
): Promise<string> => {
	const result = await verifyCredential(document, verifyOptions);
	if (result.checks.structure.outcome === "failed")
		return `structure:${result.checks.structure.reason}`;
	return result.checks.signature.outcome === "failed"
		? result.checks.signature.reason
		: result.checks.signature.outcome;
};

describe("rdfc on URLU credentials", () => {
	test("a URLU credential is JSON-LD safe-mode clean and verifies under rdfc", async () => {
		const credential = await signWith([eddsaRdfc2022]);
		expect(proofsOf(credential)).toMatchObject([
			{ cryptosuite: "eddsa-rdfc-2022" },
		]);
		expect(
			(proofsOf(credential)[0] as Record<string, unknown>)["@context"],
		).toBeUndefined();
		const result = await verifyCredential(credential, options);
		expect(result.verified).toBe(true);
		expect(result.proofs).toEqual([
			{
				cryptosuite: "eddsa-rdfc-2022",
				verificationMethod: world.signer.keyId,
				outcome: "verified",
				reason: null,
				message: null,
			},
		]);
	});

	test("tampering: a context URL, an unmapped term, a signed field", async () => {
		const credential = await signWith([eddsaRdfc2022]);
		const swapped = copyOf(credential);
		swapped["@context"] = [
			VC_CONTEXT_V2,
			"https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.2.json",
		];
		expect(await signatureFailure(swapped)).toBe("structure:context_invalid");
		// Past the structural allowlist (a verifier that allows the extra context), rdfc itself refuses it offline.
		const extra = copyOf(credential);
		extra["@context"] = [
			VC_CONTEXT_V2,
			OB3_CONTEXT,
			"https://evil.example/terms.json",
		];
		expect(
			await signatureFailure(extra, {
				...options,
				extraContexts: ["https://evil.example/terms.json"],
			}),
		).toBe("context_unknown");
		const unmapped = copyOf(credential);
		unmapped.addedAfterSigning = "an undefined term";
		expect(await signatureFailure(unmapped)).toBe("term_undefined");
		const changed = copyOf(credential);
		changed.name = "URLU Certified Judge";
		expect(await signatureFailure(changed)).toBe("signature_invalid");
	});

	test("reordering: key order and set-valued arrays are the same RDF graph, so rdfc still verifies", async () => {
		const credential = await signWith([eddsaRdfc2022]);
		const reordered: Record<string, unknown> = {};
		for (const key of Object.keys(credential).reverse())
			reordered[key] = copyOf(credential)[key];
		(reordered.type as string[]).reverse();
		expect(await signatureFailure(reordered)).toBe("passed");
		// JCS signs the JSON as written: the same reorder of an array breaks it.
		const jcs = copyOf(await signWith([eddsaJcs2022]));
		(jcs.type as string[]).reverse();
		expect(await signatureFailure(jcs)).toBe("signature_invalid");
	});

	test("cross-check: one credential with both proofs verifies under each suite and fails after any edit", async () => {
		const credential = await signWith(RDFC_AND_JCS_PROOFS);
		const registries = {
			both: RDFC_AND_JCS_SUITES,
			rdfcOnly: suiteRegistry(eddsaRdfc2022),
			jcsOnly: JCS_SUITES,
		};
		for (const suites of Object.values(registries)) {
			expect(
				(await verifyCredential(credential, { ...options, suites })).verified,
			).toBe(true);
		}
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
		const paths = leaves(copyOf(credential)).filter(
			(path) => path[0] !== "proof",
		);
		expect(paths.length).toBeGreaterThan(25);
		for (const path of paths) {
			const document = copyOf(credential);
			let parent = document as Record<string | number, unknown>;
			for (const step of path.slice(0, -1))
				parent = parent[step] as Record<string | number, unknown>;
			const last = path.at(-1) as string | number;
			const current = parent[last];
			parent[last] =
				typeof current === "boolean" ? !current : `${String(current)}x`;
			for (const [name, suites] of Object.entries(registries)) {
				const result = await verifyCredential(document, { ...options, suites });
				if (result.verified)
					throw new Error(
						`editing ${path.join(".")} still verified under ${name}`,
					);
			}
		}
	});
});

describe("proof-set rule", () => {
	test("unsupported proofs are reported and skipped; supported ones must all verify", async () => {
		const credential = await signWith(RDFC_AND_JCS_PROOFS);
		const jcsOnly = await verifyCredential(credential, {
			...options,
			suites: JCS_SUITES,
		});
		expect(
			jcsOnly.proofs.map((proof) => [proof.cryptosuite, proof.outcome]),
		).toEqual([
			["eddsa-rdfc-2022", "unsupported"],
			["eddsa-jcs-2022", "verified"],
		]);
		const withForeign = copyOf(credential);
		(withForeign.proof as unknown[]).push({
			type: "Ed25519Signature2020",
			proofValue: "zabc",
		});
		const foreign = await verifyCredential(withForeign, options);
		expect(foreign.verified).toBe(true);
		expect(foreign.proofs.at(-1)).toMatchObject({
			outcome: "unsupported",
			reason: "proof_type_unsupported",
		});
	});

	test("one failing supported proof fails the set, even when another verifies", async () => {
		const credential = copyOf(await signWith(RDFC_AND_JCS_PROOFS));
		const [rdfc] = credential.proof as Record<string, unknown>[];
		if (rdfc === undefined) throw new Error("no proof");
		rdfc.created = "2026-11-07T12:00:01Z";
		const result = await verifyCredential(credential, options);
		expect(result.verified).toBe(false);
		expect(result.checks.signature).toMatchObject({
			reason: "signature_invalid",
		});
		expect(result.proofs.map((proof) => proof.outcome)).toEqual([
			"failed",
			"verified",
		]);
	});

	test("no proof of a supported suite fails", async () => {
		const credential = await signWith([eddsaRdfc2022]);
		const result = await verifyCredential(credential, {
			...options,
			suites: JCS_SUITES,
		});
		expect(result.verified).toBe(false);
		expect(result.checks.signature).toMatchObject({
			reason: "cryptosuite_unsupported",
		});
		expect(result.proofs).toMatchObject([{ outcome: "unsupported" }]);
	});

	test("rdfc refuses to sign a document with an undefined term", async () => {
		const unsigned = buildAchievementCredential({
			id: CREDENTIAL_IDS.second,
			issuer: world.issuer,
			level: LEVELS.Coach,
			holder: { id: "did:example:x" },
			now: NOW,
		});
		await expect(
			addProof(
				{ ...unsigned, notInAnyContext: true },
				{
					signer: world.signer,
					created: formatDateTimeStamp(NOW),
					suite: eddsaRdfc2022,
				},
			),
		).rejects.toMatchObject({ code: "proof_generation_failed" });
	});
});
