import { describe, expect, test } from "bun:test";
import {
	addProof,
	canonicalize,
	checkProof,
	decodeEd25519Multikey,
	type Signer,
	verifySignature,
} from "../src/index.js";
import { createTestKey } from "../src/testing.js";

// Data Integrity EdDSA Cryptosuites v1.0, Appendix B.3 (eddsa-jcs-2022), Examples 29–39. Public values only: the
// verification key and the published signed credential. The spec's secret key is not needed to check its signature.
const SPEC_PUBLIC_KEY = "z6MkrJVnaZkeFzdQyMZu1cgjg7k1pZZ6pvBQ7XJPt4swbTQ2";
const SPEC_CONTEXT = [
	"https://www.w3.org/ns/credentials/v2",
	"https://www.w3.org/ns/credentials/examples/v2",
];
const specSignedCredential = (): Record<string, unknown> => ({
	"@context": [...SPEC_CONTEXT],
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
	proof: {
		type: "DataIntegrityProof",
		cryptosuite: "eddsa-jcs-2022",
		created: "2023-02-24T23:36:38Z",
		verificationMethod: `did:key:${SPEC_PUBLIC_KEY}#${SPEC_PUBLIC_KEY}`,
		proofPurpose: "assertionMethod",
		"@context": [...SPEC_CONTEXT],
		proofValue:
			"z2HnFSSPPBzR36zdDgK8PbEHeXbR56YF24jwMpt3R1eHXQzJDMWS93FCzpvJpwTWd3GAVFuUfjoJdcnTMuVor51aX",
	},
});

// Examples 31 and 34: the canonical credential and canonical proof options.
const SPEC_CANONICAL_CREDENTIAL =
	'{"@context":["https://www.w3.org/ns/credentials/v2","https://www.w3.org/ns/credentials/examples/v2"],"credentialSubject":{"alumniOf":"The School of Examples","id":"did:example:abcdefgh"},"description":"A minimum viable example of an Alumni Credential.","id":"urn:uuid:58172aac-d8ba-11ed-83dd-0b3aef56cc33","issuer":"https://vc.example/issuers/5678","name":"Alumni Credential","type":["VerifiableCredential","AlumniCredential"],"validFrom":"2023-01-01T00:00:00Z"}';
const SPEC_CANONICAL_PROOF_OPTIONS = `{"@context":["https://www.w3.org/ns/credentials/v2","https://www.w3.org/ns/credentials/examples/v2"],"created":"2023-02-24T23:36:38Z","cryptosuite":"eddsa-jcs-2022","proofPurpose":"assertionMethod","type":"DataIntegrityProof","verificationMethod":"did:key:${SPEC_PUBLIC_KEY}#${SPEC_PUBLIC_KEY}"}`;

const verifyWith = (
	document: Record<string, unknown>,
	publicKey: Uint8Array,
): boolean => {
	const parsed = checkProof(document);
	return (
		parsed.ok && verifySignature(parsed.hashData, parsed.signature, publicKey)
	);
};

describe("eddsa-jcs-2022 spec vector (Appendix B.3)", () => {
	const publicKey = decodeEd25519Multikey(SPEC_PUBLIC_KEY);

	test("JCS of the credential and of the proof options equal Examples 31 and 34", () => {
		const { proof, ...credential } = specSignedCredential();
		const { proofValue: _proofValue, ...options } = proof as Record<
			string,
			unknown
		>;
		expect(canonicalize(credential)).toBe(SPEC_CANONICAL_CREDENTIAL);
		expect(canonicalize(options)).toBe(SPEC_CANONICAL_PROOF_OPTIONS);
	});

	test("the published signed credential (Example 39) verifies", () => {
		expect(verifyWith(specSignedCredential(), publicKey)).toBe(true);
	});

	test("changing one character of it fails", () => {
		const tampered = specSignedCredential();
		tampered.name = "Alumni Credentials";
		expect(verifyWith(tampered, publicKey)).toBe(false);
		const otherProof = specSignedCredential();
		(otherProof.proof as Record<string, unknown>).created =
			"2023-02-24T23:36:39Z";
		expect(verifyWith(otherProof, publicKey)).toBe(false);
	});
});

describe("addProof and checkProof", () => {
	const key = createTestKey("proof");
	const signer = key.signer("did:web:urlu.example#key-1");
	const document = {
		"@context": [...SPEC_CONTEXT],
		id: "urn:uuid:1",
		name: "x",
	};

	test("round trip, with the document @context copied into the proof (§3.3.1 step 2)", async () => {
		const secured = await addProof(document, {
			signer,
			created: "2026-11-07T12:00:00Z",
		});
		expect(secured.proof["@context"]).toEqual(SPEC_CONTEXT);
		expect(secured.proof.proofValue.startsWith("z")).toBe(true);
		expect(verifyWith(secured, key.publicKey)).toBe(true);
		expect(verifyWith(secured, createTestKey("other").publicKey)).toBe(false);
	});

	test("refuses a second proof, a bad created and a signer returning the wrong length", async () => {
		const secured = await addProof(document, {
			signer,
			created: "2026-11-07T12:00:00Z",
		});
		await expect(
			addProof(secured, { signer, created: "2026-11-07T12:00:00Z" }),
		).rejects.toThrow("already has a proof");
		await expect(
			addProof(document, { signer, created: "2026-11-07" }),
		).rejects.toThrow("dateTimeStamp");
		const short: Signer = {
			keyId: signer.keyId,
			sign: async () => new Uint8Array(63),
		};
		await expect(
			addProof(document, { signer: short, created: "2026-11-07T12:00:00Z" }),
		).rejects.toThrow("64-byte");
	});

	/** The reason checkProof gives after setting `member` of a fresh proof to `value` (undefined deletes it). */
	const reasonFor = async (member: string, value: unknown): Promise<string> => {
		const secured = (await addProof(document, {
			signer,
			created: "2026-11-07T12:00:00Z",
		})) as Record<string, unknown>;
		const proof = secured.proof as Record<string, unknown>;
		if (value === undefined) delete proof[member];
		else proof[member] = value;
		const parsed = checkProof(secured);
		return parsed.ok ? "ok" : parsed.reason;
	};

	const MALFORMED: [string, unknown, string][] = [
		["type", "Ed25519Signature2020", "proof_type_unsupported"],
		["cryptosuite", "eddsa-rdfc-2022", "cryptosuite_unsupported"],
		["cryptosuite", "ecdsa-jcs-2019", "cryptosuite_unsupported"],
		["proofPurpose", "authentication", "proof_purpose_mismatch"],
		["alg", "none", "proof_alg_forbidden"],
		["jws", "e30..x", "proof_alg_forbidden"],
		["previousProof", "urn:x", "proof_member_unexpected"],
		["created", "yesterday", "proof_created_invalid"],
		["expires", "soon", "proof_expires_invalid"],
		["proofValue", "uAAAA", "proof_value_malformed"],
		["proofValue", "z1111", "proof_value_malformed"],
		["@context", ["https://evil.example/v1"], "proof_context_mismatch"],
		["verificationMethod", undefined, "proof_malformed"],
	];

	test("each malformed proof has its own reason", async () => {
		for (const [member, value, reason] of MALFORMED) {
			expect({ member, reason: await reasonFor(member, value) }).toEqual({
				member,
				reason,
			});
		}
		expect(checkProof({ ...document }).ok).toBe(false);
		const set = checkProof({ ...document, proof: [{}, {}] });
		expect(!set.ok && set.reason).toBe("proof_set_unsupported");
	});
});
