/**
 * DID documents, `did:key` (pure expansion), `did:web` (pure id-to-URL mapping and a document builder), and the
 * resolver port. Fetching is the caller's: `composeDidResolver` takes the fetch as a function.
 *
 * - did:key: https://w3c-ccg.github.io/did-key-spec/ (Document Creation Algorithm; Multikey public key format).
 * - did:web: https://w3c-ccg.github.io/did-method-web/ (Read (Resolve): ":" to "/", `%3A` to ":", https://,
 *   `/.well-known` when there is no path, then `/did.json`; the resolved document's id must equal the DID).
 * - Verification method retrieval: Controlled Identifiers v1.0 §3.3, https://www.w3.org/TR/cid-1.0/#retrieve-verification-method.
 */

import { CredentialsError } from "./errors.js";
import { base64urlDecode } from "./multibase.js";
import { decodeEd25519Multikey, encodeEd25519Multikey } from "./multikey.js";

export const DID_CONTEXT_V1 = "https://www.w3.org/ns/did/v1";
export const MULTIKEY_CONTEXT_V1 = "https://w3id.org/security/multikey/v1";

export type VerificationMethod = {
	id: string;
	type: string;
	controller: string;
	publicKeyMultibase?: string;
	publicKeyJwk?: { kty: string; crv?: string; x?: string };
};

export type DidDocument = {
	"@context"?: string | string[];
	id: string;
	alsoKnownAs?: string[];
	verificationMethod?: VerificationMethod[];
	assertionMethod?: (string | VerificationMethod)[];
	authentication?: (string | VerificationMethod)[];
	capabilityInvocation?: (string | VerificationMethod)[];
	capabilityDelegation?: (string | VerificationMethod)[];
};

/** The resolver port. Consumers implement it (usually with `composeDidResolver` and their own fetch). */
export type DidResolver = (did: string) => Promise<DidDocument>;

const DID_KEY_PREFIX = "did:key:";
const DID_WEB_PREFIX = "did:web:";

/** Expand an Ed25519 `did:key` into its document. Throws `did_invalid` for anything else. */
export const resolveDidKey = (did: string): DidDocument => {
	if (!did.startsWith(DID_KEY_PREFIX) || did.includes("#")) {
		throw new CredentialsError("did_invalid", `${did} is not a did:key`);
	}
	const multibaseValue = did.slice(DID_KEY_PREFIX.length);
	if (multibaseValue.includes(":")) {
		throw new CredentialsError(
			"did_invalid",
			"versioned did:key values are not supported",
		);
	}
	try {
		decodeEd25519Multikey(multibaseValue);
	} catch {
		throw new CredentialsError(
			"did_invalid",
			`${did} is not an Ed25519 did:key`,
		);
	}
	const methodId = `${did}#${multibaseValue}`;
	return {
		"@context": [DID_CONTEXT_V1, MULTIKEY_CONTEXT_V1],
		id: did,
		verificationMethod: [
			{
				id: methodId,
				type: "Multikey",
				controller: did,
				publicKeyMultibase: multibaseValue,
			},
		],
		authentication: [methodId],
		assertionMethod: [methodId],
		capabilityInvocation: [methodId],
		capabilityDelegation: [methodId],
	};
};

export const didKeyFromPublicKey = (publicKey: Uint8Array): string =>
	`${DID_KEY_PREFIX}${encodeEd25519Multikey(publicKey)}`;

const HOST =
	/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const PORT = /^\d{1,5}$/;
const PATH_SEGMENT = /^[A-Za-z0-9._~!$&'()*+,;=@%-]+$/;

/** `did:web:example.com%3A3000:user:alice` → `https://example.com:3000/user/alice/did.json`. Pure; throws `did_invalid`. */
export const didWebToUrl = (did: string): string => {
	if (
		!did.startsWith(DID_WEB_PREFIX) ||
		did.includes("#") ||
		did.includes("?")
	) {
		throw new CredentialsError("did_invalid", `${did} is not a did:web`);
	}
	const [encodedDomain = "", ...path] = did
		.slice(DID_WEB_PREFIX.length)
		.split(":");
	const [host = "", port, ...extra] = encodedDomain
		.replace(/%3A/gi, ":")
		.split(":");
	if (!HOST.test(host) || IPV4.test(host) || extra.length > 0) {
		throw new CredentialsError(
			"did_invalid",
			`${did}: the domain must be a host name (no IP address)`,
		);
	}
	if (port !== undefined && !PORT.test(port)) {
		throw new CredentialsError("did_invalid", `${did}: bad port`);
	}
	for (const segment of path) {
		if (!PATH_SEGMENT.test(segment) || segment === "." || segment === "..") {
			throw new CredentialsError("did_invalid", `${did}: bad path segment`);
		}
	}
	const authority =
		port === undefined ? host.toLowerCase() : `${host.toLowerCase()}:${port}`;
	const location = path.length === 0 ? "/.well-known" : `/${path.join("/")}`;
	return `https://${authority}${location}/did.json`;
};

/** The `did:web` for a host, an optional port and optional path segments. */
export const didWebFor = (
	host: string,
	options: { port?: number; path?: string[] } = {},
): string => {
	const domain =
		options.port === undefined ? host : `${host}%3A${options.port}`;
	const did = [DID_WEB_PREFIX + domain, ...(options.path ?? [])].join(":");
	didWebToUrl(did);
	return did;
};

export type DidWebKey = {
	/** The fragment after `#`; default the key's own multibase value, as did:key does. */
	fragment?: string;
	publicKey: Uint8Array;
};

/**
 * A `did:web` document with Ed25519 Multikey verification methods. Every key is an `assertionMethod` unless
 * `assertionMethod` names the fragments that are (a key being rotated out can stay listed but not authorised).
 */
export const buildDidWebDocument = (input: {
	did: string;
	keys: DidWebKey[];
	assertionMethod?: string[];
	alsoKnownAs?: string[];
}): DidDocument => {
	didWebToUrl(input.did);
	if (input.keys.length === 0) {
		throw new CredentialsError("input_invalid", "a DID document needs a key");
	}
	const methods: VerificationMethod[] = [];
	for (const key of input.keys) {
		const publicKeyMultibase = encodeEd25519Multikey(key.publicKey);
		methods.push({
			id: `${input.did}#${key.fragment ?? publicKeyMultibase}`,
			type: "Multikey",
			controller: input.did,
			publicKeyMultibase,
		});
	}
	const authorised = input.assertionMethod?.map(
		(fragment) => `${input.did}#${fragment}`,
	);
	for (const id of authorised ?? []) {
		if (!methods.some((method) => method.id === id)) {
			throw new CredentialsError(
				"input_invalid",
				`assertionMethod ${id} is not one of the keys`,
			);
		}
	}
	const document: DidDocument = {
		"@context": [DID_CONTEXT_V1, MULTIKEY_CONTEXT_V1],
		id: input.did,
		verificationMethod: methods,
		assertionMethod: authorised ?? methods.map((method) => method.id),
	};
	if (input.alsoKnownAs !== undefined) document.alsoKnownAs = input.alsoKnownAs;
	return document;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isVerificationMethod = (value: unknown): value is VerificationMethod =>
	isRecord(value) &&
	typeof value.id === "string" &&
	typeof value.type === "string" &&
	typeof value.controller === "string";

/** A resolver's output is untrusted: check the shape this library reads, and that its id is the DID asked for. */
export const parseDidDocument = (
	value: unknown,
	expectedDid: string,
): DidDocument => {
	if (!isRecord(value) || typeof value.id !== "string") {
		throw new CredentialsError("did_invalid", "not a DID document");
	}
	if (value.id !== expectedDid) {
		throw new CredentialsError(
			"did_invalid",
			`the document's id ${value.id} is not ${expectedDid}`,
		);
	}
	const methods = value.verificationMethod;
	if (
		methods !== undefined &&
		!(Array.isArray(methods) && methods.every(isVerificationMethod))
	) {
		throw new CredentialsError("did_invalid", "malformed verificationMethod");
	}
	const assertion = value.assertionMethod;
	if (
		assertion !== undefined &&
		!(
			Array.isArray(assertion) &&
			assertion.every(
				(entry) => typeof entry === "string" || isVerificationMethod(entry),
			)
		)
	) {
		throw new CredentialsError("did_invalid", "malformed assertionMethod");
	}
	return value as DidDocument;
};

/** did:key in-process; did:web through `fetchJson` (the caller's fetch, cache and timeouts). */
export const composeDidResolver = (options: {
	fetchJson?: (url: string) => Promise<unknown>;
}): DidResolver => {
	return async (did: string): Promise<DidDocument> => {
		if (did.startsWith(DID_KEY_PREFIX)) return resolveDidKey(did);
		if (did.startsWith(DID_WEB_PREFIX)) {
			if (options.fetchJson === undefined) {
				throw new CredentialsError("did_invalid", "no did:web fetcher");
			}
			return parseDidDocument(await options.fetchJson(didWebToUrl(did)), did);
		}
		throw new CredentialsError("did_invalid", `unsupported DID method: ${did}`);
	};
};

export type KeyRetrievalFailure =
	| "verification_method_invalid"
	| "verification_method_not_found"
	| "verification_method_controller_mismatch"
	| "verification_method_not_authorised"
	| "verification_method_unsupported";

const absolute = (documentId: string, reference: string): string =>
	reference.startsWith("#") ? `${documentId}${reference}` : reference;

/** The DID (controller document URL) of a verification method id: everything before `#`. */
export const controllerOf = (methodId: string): string | null => {
	const hash = methodId.indexOf("#");
	if (hash <= 0 || hash === methodId.length - 1) return null;
	return methodId.slice(0, hash);
};

const publicKeyOf = (method: VerificationMethod): Uint8Array | null => {
	if (
		(method.type === "Multikey" ||
			method.type === "Ed25519VerificationKey2020") &&
		typeof method.publicKeyMultibase === "string"
	) {
		try {
			return decodeEd25519Multikey(method.publicKeyMultibase);
		} catch {
			return null;
		}
	}
	const jwk = method.publicKeyJwk;
	if (
		(method.type === "JsonWebKey" || method.type === "JsonWebKey2020") &&
		jwk?.kty === "OKP" &&
		jwk.crv === "Ed25519" &&
		typeof jwk.x === "string"
	) {
		try {
			const key = base64urlDecode(jwk.x);
			return key.length === 32 ? key : null;
		} catch {
			return null;
		}
	}
	return null;
};

export type MethodLookup =
	| { ok: true; method: VerificationMethod; publicKey: Uint8Array }
	| { ok: false; reason: KeyRetrievalFailure; message: string };

/**
 * Find a verification method and its Ed25519 key in an already-resolved document by absolute id, and check that its
 * controller is the document (CID v1.0 §3.3 steps on id and controller). Says nothing about authorisation.
 */
export const findVerificationMethod = (
	document: DidDocument,
	methodId: string,
): MethodLookup => {
	const controller = controllerOf(methodId);
	if (controller === null || controller !== document.id) {
		return {
			ok: false,
			reason: "verification_method_invalid",
			message: `${methodId} is not a method of ${document.id}`,
		};
	}
	const embedded: VerificationMethod[] = [];
	for (const entry of document.assertionMethod ?? []) {
		if (typeof entry !== "string") embedded.push(entry);
	}
	const candidates = [...(document.verificationMethod ?? []), ...embedded];
	const method = candidates.find(
		(candidate) => absolute(document.id, candidate.id) === methodId,
	);
	if (method === undefined) {
		return {
			ok: false,
			reason: "verification_method_not_found",
			message: `${methodId} is not in the DID document`,
		};
	}
	if (absolute(document.id, method.controller) !== document.id) {
		return {
			ok: false,
			reason: "verification_method_controller_mismatch",
			message: `${methodId} is controlled by ${method.controller}, not ${document.id}`,
		};
	}
	const publicKey = publicKeyOf(method);
	if (publicKey === null) {
		return {
			ok: false,
			reason: "verification_method_unsupported",
			message: `${methodId} is not an Ed25519 key this library reads`,
		};
	}
	return { ok: true, method, publicKey };
};

/** True when `methodId` is listed, by reference or by value, under the document's `assertionMethod`. */
export const isAssertionMethod = (
	document: DidDocument,
	methodId: string,
): boolean =>
	(document.assertionMethod ?? []).some((entry) =>
		typeof entry === "string"
			? absolute(document.id, entry) === methodId
			: absolute(document.id, entry.id) === methodId,
	);

/** CID v1.0 §3.3 Retrieve Verification Method for `assertionMethod`, against an already-resolved document. */
export const retrieveVerificationMethod = (
	document: DidDocument,
	methodId: string,
): MethodLookup => {
	const lookup = findVerificationMethod(document, methodId);
	if (!lookup.ok) return lookup;
	if (!isAssertionMethod(document, methodId)) {
		return {
			ok: false,
			reason: "verification_method_not_authorised",
			message: `${methodId} is not listed under assertionMethod`,
		};
	}
	return lookup;
};
