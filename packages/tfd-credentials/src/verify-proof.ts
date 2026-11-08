/**
 * Proof checks shared by credentials and status lists, and the validity window against the injected clock.
 *
 * Proof-set rule (VC Data Integrity 1.0 §4.5 Verify Proof Sets: the set verifies only if every proof's result is
 * verified): every proof of a suite in the verifier's registry must pass signature and issuer-key checks; a proof of
 * another type or an unregistered cryptosuite is reported as `unsupported` and skipped; a document with no proof of a
 * registered suite fails. Each proof covers the document without `proof` (§2.1.1: a set has no order).
 */
import { parseDateTimeStamp } from "./datetime.js";
import {
	controllerOf,
	type DidDocument,
	type DidResolver,
	findVerificationMethod,
	isAssertionMethod,
	parseDidDocument,
} from "./did.js";
import { inspectProof, proofsOf, verifySignature } from "./proof.js";
import {
	isUnsupportedProof,
	parseProofShape,
	withoutMember,
} from "./proof-shape.js";
import type { SuiteRegistry } from "./suite.js";
import {
	type Check,
	failed,
	type IssuerKeyReason,
	PASSED,
	type ProofReport,
	type SignatureReason,
	SKIPPED,
	type ValidityReason,
} from "./verify-result.js";

export type ProofVerdict = {
	signature: Check<SignatureReason>;
	issuerKey: Check<IssuerKeyReason>;
	expiresAt: number | null;
	proofs: ProofReport[];
};

type OneProof = {
	signature: Check<SignatureReason>;
	issuerKey: Check<IssuerKeyReason>;
	expiresAt: number | null;
};

const stringOr = (value: unknown): string | null =>
	typeof value === "string" ? value : null;

const reportOf = (proof: unknown, verdict: OneProof): ProofReport => {
	const record =
		typeof proof === "object" && proof !== null
			? (proof as Record<string, unknown>)
			: {};
	const failure =
		verdict.signature.outcome === "failed"
			? verdict.signature
			: verdict.issuerKey.outcome === "failed"
				? verdict.issuerKey
				: null;
	return {
		cryptosuite: stringOr(record.cryptosuite),
		verificationMethod: stringOr(record.verificationMethod),
		outcome: failure === null ? "verified" : "failed",
		reason: failure?.reason ?? null,
		message: failure?.message ?? null,
	};
};

const verifyOne = async (
	unsecuredDocument: Record<string, unknown>,
	proof: unknown,
	issuerId: string,
	resolve: (did: string) => Promise<DidDocument>,
	suites: SuiteRegistry,
): Promise<OneProof> => {
	const parsed = await inspectProof(unsecuredDocument, proof, suites);
	if (!parsed.ok) {
		return {
			signature: failed(parsed.reason, parsed.message),
			issuerKey: SKIPPED,
			expiresAt: null,
		};
	}
	const methodId = parsed.proof.verificationMethod;
	const controller = controllerOf(methodId);
	const unresolved = failed<SignatureReason>(
		"verification_method_unresolved",
		`no key could be read for ${methodId}`,
	);
	if (controller === null) {
		return {
			signature: unresolved,
			issuerKey: failed(
				"verification_method_invalid",
				`${methodId} is not a DID URL with a fragment`,
			),
			expiresAt: parsed.expiresAt,
		};
	}
	let didDocument: DidDocument;
	try {
		didDocument = await resolve(controller);
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "resolution failed";
		return {
			signature: unresolved,
			issuerKey: failed("did_resolution_failed", `${controller}: ${message}`),
			expiresAt: parsed.expiresAt,
		};
	}
	const lookup = findVerificationMethod(didDocument, methodId);
	if (!lookup.ok) {
		return {
			signature: unresolved,
			issuerKey: failed(lookup.reason, lookup.message),
			expiresAt: parsed.expiresAt,
		};
	}
	const signature = verifySignature(
		parsed.hashData,
		parsed.signature,
		lookup.publicKey,
	)
		? PASSED
		: failed<SignatureReason>(
				"signature_invalid",
				"the signature does not match the document",
			);
	let issuerKey: Check<IssuerKeyReason> = PASSED;
	if (controller !== issuerId) {
		issuerKey = failed(
			"verification_method_not_issuer",
			`${methodId} belongs to ${controller}, not the issuer ${issuerId}`,
		);
	} else if (!isAssertionMethod(didDocument, methodId)) {
		issuerKey = failed(
			"verification_method_not_authorised",
			`${methodId} is not an assertionMethod of ${issuerId}`,
		);
	}
	return { signature, issuerKey, expiresAt: parsed.expiresAt };
};

const firstFailed = <Reason extends string>(
	checks: Check<Reason>[],
): Check<Reason> | undefined =>
	checks.find((check) => check.outcome === "failed");

/** The proof checks shared by credentials and status lists: shape, suite, key lookup, signature, issuer key. */
export const verifyEmbeddedProof = async (
	document: Record<string, unknown>,
	issuerId: string,
	resolveDid: DidResolver,
	suites: SuiteRegistry,
): Promise<ProofVerdict> => {
	const proofs = proofsOf(document);
	if (proofs.length === 0) {
		return {
			signature: failed("proof_missing", "no proof"),
			issuerKey: failed("proof_missing", "no proof"),
			expiresAt: null,
			proofs: [],
		};
	}
	// One resolution per DID per verification, however many proofs name it.
	const resolved = new Map<string, Promise<DidDocument>>();
	const resolve = (did: string): Promise<DidDocument> => {
		let pending = resolved.get(did);
		if (pending === undefined) {
			pending = resolveDid(did).then((value) => parseDidDocument(value, did));
			resolved.set(did, pending);
		}
		return pending;
	};
	const unsecuredDocument = withoutMember(document, "proof");
	const reports: ProofReport[] = [];
	const verdicts: OneProof[] = [];
	let unsupported: Check<SignatureReason> | undefined;
	for (const proof of proofs) {
		if (isUnsupportedProof(proof, suites)) {
			const shape = parseProofShape(proof, suites);
			const reason = shape.ok ? "cryptosuite_unsupported" : shape.reason;
			const message = shape.ok ? "unsupported" : shape.message;
			unsupported ??= failed<SignatureReason>(reason, message);
			reports.push({
				cryptosuite: stringOr((proof as Record<string, unknown>).cryptosuite),
				verificationMethod: stringOr(
					(proof as Record<string, unknown>).verificationMethod,
				),
				outcome: "unsupported",
				reason,
				message,
			});
			continue;
		}
		const verdict = await verifyOne(
			unsecuredDocument,
			proof,
			issuerId,
			resolve,
			suites,
		);
		verdicts.push(verdict);
		reports.push(reportOf(proof, verdict));
	}
	if (verdicts.length === 0) {
		return {
			signature:
				unsupported ??
				failed("cryptosuite_unsupported", "no proof of a supported suite"),
			issuerKey: SKIPPED,
			expiresAt: null,
			proofs: reports,
		};
	}
	const issuerKeys = verdicts.map((verdict) => verdict.issuerKey);
	const issuerKey =
		firstFailed(issuerKeys) ??
		(issuerKeys.every((check) => check.outcome === "passed")
			? PASSED
			: SKIPPED);
	const expiries = verdicts
		.map((verdict) => verdict.expiresAt)
		.filter((expiresAt): expiresAt is number => expiresAt !== null);
	return {
		signature:
			firstFailed(verdicts.map((verdict) => verdict.signature)) ?? PASSED,
		issuerKey,
		expiresAt: expiries.length === 0 ? null : Math.min(...expiries),
		proofs: reports,
	};
};

export const validityOf = (
	validFrom: string | undefined,
	validUntil: string | undefined,
	expiresAt: number | null,
	now: number,
): Check<ValidityReason> => {
	const from = validFrom === undefined ? null : parseDateTimeStamp(validFrom);
	const until =
		validUntil === undefined ? null : parseDateTimeStamp(validUntil);
	if (from !== null && now < from)
		return failed("not_yet_valid", `valid from ${validFrom}`);
	if (until !== null && now > until)
		return failed("expired", `valid until ${validUntil}`);
	if (expiresAt !== null && now > expiresAt)
		return failed("proof_expired", "the proof has expired");
	return PASSED;
};
