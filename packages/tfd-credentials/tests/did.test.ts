import { describe, expect, test } from "bun:test";
import {
	buildDidWebDocument,
	composeDidResolver,
	decodeEd25519Multikey,
	didKeyFromPublicKey,
	didWebFor,
	didWebToUrl,
	encodeEd25519Multikey,
	resolveDidKey,
	retrieveVerificationMethod,
} from "../src/index.js";
import {
	base58btcDecode,
	base58btcEncode,
	base64urlDecode,
	base64urlEncode,
} from "../src/multibase.js";
import { createTestKey, seededRandomBytes } from "../src/testing.js";

describe("multibase", () => {
	const random = seededRandomBytes("multibase");

	test("base58btc and base64url round-trip, leading zeros included", () => {
		for (let length = 0; length < 70; length++) {
			const bytes = random(length);
			if (length > 2) bytes[0] = 0;
			if (length > 3) bytes[1] = 0;
			expect(base58btcDecode(base58btcEncode(bytes))).toEqual(bytes);
			expect(base64urlDecode(base64urlEncode(bytes))).toEqual(bytes);
		}
	});

	test("base58btc known values", () => {
		expect(base58btcEncode(new TextEncoder().encode("Hello World!"))).toBe(
			"2NEpo7TZRRrLZSi2U",
		);
		expect(base58btcEncode(new Uint8Array([0, 0, 1]))).toBe("112");
	});

	test("base64url is strict: no padding, no standard alphabet, no stray bits", () => {
		expect(base64urlEncode(new Uint8Array([0xfb, 0xff]))).toBe("-_8");
		expect(() => base64urlDecode("-_8=")).toThrow();
		expect(() => base64urlDecode("+/8")).toThrow();
		expect(() => base64urlDecode("-_9")).toThrow("trailing bits");
		expect(() => base64urlDecode("A")).toThrow("length");
		expect(() => base58btcDecode("0OIl")).toThrow();
	});
});

// did:key spec, "Create" example (a public value): https://w3c-ccg.github.io/did-key-spec/
const SPEC_DID_KEY = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK";

describe("multikey and did:key", () => {
	test("the spec's did:key expands to its documented verification method", () => {
		const document = resolveDidKey(SPEC_DID_KEY);
		const methodId = `${SPEC_DID_KEY}#${SPEC_DID_KEY.slice("did:key:".length)}`;
		expect(document.id).toBe(SPEC_DID_KEY);
		expect(document.verificationMethod).toEqual([
			{
				id: methodId,
				type: "Multikey",
				controller: SPEC_DID_KEY,
				publicKeyMultibase: SPEC_DID_KEY.slice("did:key:".length),
			},
		]);
		expect(document.assertionMethod).toEqual([methodId]);
		const key = decodeEd25519Multikey(SPEC_DID_KEY.slice("did:key:".length));
		expect(key).toHaveLength(32);
		expect(didKeyFromPublicKey(key)).toBe(SPEC_DID_KEY);
	});

	test("multikey refuses other codecs, lengths and headers", () => {
		const key = createTestKey("multikey").publicKey;
		expect(decodeEd25519Multikey(encodeEd25519Multikey(key))).toEqual(key);
		expect(() => encodeEd25519Multikey(key.subarray(1))).toThrow();
		const wrongCodec = new Uint8Array(34);
		wrongCodec.set([0xe7, 0x01]);
		expect(() =>
			decodeEd25519Multikey(`z${base58btcEncode(wrongCodec)}`),
		).toThrow("not an Ed25519");
		expect(() =>
			decodeEd25519Multikey(`u${base64urlEncode(wrongCodec)}`),
		).toThrow("not base58btc");
		expect(() => resolveDidKey("did:key:zQ3s")).toThrow();
		expect(() => resolveDidKey("did:web:example.com")).toThrow();
	});
});

describe("did:web", () => {
	// The three mappings in the did:web spec, "Read (Resolve)" and "Create (Register)".
	test("spec examples map to URLs", () => {
		expect(didWebToUrl("did:web:w3c-ccg.github.io")).toBe(
			"https://w3c-ccg.github.io/.well-known/did.json",
		);
		expect(didWebToUrl("did:web:w3c-ccg.github.io:user:alice")).toBe(
			"https://w3c-ccg.github.io/user/alice/did.json",
		);
		expect(didWebToUrl("did:web:example.com%3A3000:user:alice")).toBe(
			"https://example.com:3000/user/alice/did.json",
		);
	});

	test("refuses IP addresses, bad ports, fragments and dot segments", () => {
		for (const did of [
			"did:web:127.0.0.1",
			"did:web:example.com%3Ahttp",
			"did:web:example.com#key",
			"did:web:example.com:..:x",
			"did:web:",
			"did:webx:example.com",
		]) {
			expect(() => didWebToUrl(did)).toThrow();
		}
	});

	test("didWebFor builds and round-trips", () => {
		expect(
			didWebFor("urlu.example", { port: 8443, path: ["issuers", "urlu"] }),
		).toBe("did:web:urlu.example%3A8443:issuers:urlu");
	});

	test("document builder: Multikey methods, assertionMethod subset, alsoKnownAs", () => {
		const current = createTestKey("current").publicKey;
		const retiring = createTestKey("retiring").publicKey;
		const did = didWebFor("urlu.example");
		const document = buildDidWebDocument({
			did,
			keys: [
				{ fragment: "key-2", publicKey: current },
				{ fragment: "key-1", publicKey: retiring },
			],
			assertionMethod: ["key-2"],
			alsoKnownAs: ["https://urlu.example"],
		});
		expect(document.alsoKnownAs).toEqual(["https://urlu.example"]);
		expect(document.assertionMethod).toEqual([`${did}#key-2`]);
		const authorised = retrieveVerificationMethod(document, `${did}#key-2`);
		expect(authorised.ok && authorised.publicKey).toEqual(current);
		const listedOnly = retrieveVerificationMethod(document, `${did}#key-1`);
		expect(!listedOnly.ok && listedOnly.reason).toBe(
			"verification_method_not_authorised",
		);
		const missing = retrieveVerificationMethod(document, `${did}#key-9`);
		expect(!missing.ok && missing.reason).toBe("verification_method_not_found");
		const elsewhere = retrieveVerificationMethod(
			document,
			"did:web:other.example#key-2",
		);
		expect(!elsewhere.ok && elsewhere.reason).toBe(
			"verification_method_invalid",
		);
		expect(() =>
			buildDidWebDocument({
				did,
				keys: [{ publicKey: current }],
				assertionMethod: ["nope"],
			}),
		).toThrow();
	});

	test("a method whose controller is another DID is refused (CID §3.3)", () => {
		const did = didWebFor("urlu.example");
		const document = buildDidWebDocument({
			did,
			keys: [{ fragment: "key-1", publicKey: createTestKey("x").publicKey }],
		});
		const method = document.verificationMethod?.[0];
		if (method === undefined) throw new Error("no method");
		method.controller = "did:web:attacker.example";
		const lookup = retrieveVerificationMethod(document, `${did}#key-1`);
		expect(!lookup.ok && lookup.reason).toBe(
			"verification_method_controller_mismatch",
		);
	});

	test("composeDidResolver: did:key in-process, did:web through fetch, id must match", async () => {
		const did = didWebFor("urlu.example");
		const document = buildDidWebDocument({
			did,
			keys: [{ publicKey: createTestKey("y").publicKey }],
		});
		const fetched: string[] = [];
		const resolve = composeDidResolver({
			fetchJson: async (url) => {
				fetched.push(url);
				return url.includes("urlu")
					? document
					: { ...document, id: "did:web:evil.example" };
			},
		});
		expect((await resolve(did)).id).toBe(did);
		expect((await resolve(SPEC_DID_KEY)).id).toBe(SPEC_DID_KEY);
		expect(fetched).toEqual(["https://urlu.example/.well-known/did.json"]);
		await expect(resolve("did:web:other.example")).rejects.toThrow(
			"is not did:web:other.example",
		);
		await expect(resolve("did:example:123")).rejects.toThrow("unsupported");
		await expect(composeDidResolver({})(did)).rejects.toThrow(
			"no did:web fetcher",
		);
	});
});
