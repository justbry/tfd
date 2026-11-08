/**
 * Status list records over the `StatusListStore` port: create a list, hand out a random index, flip a bit. Every
 * change is read, recompute, put-if-match; a `conflict` re-reads and re-applies, so concurrent writers serialise.
 */

import { formatDateTimeStamp } from "./datetime.js";
import { controllerOf } from "./did.js";
import { CredentialsError } from "./errors.js";
import { JCS_SUITES } from "./jcs-suite.js";
import type { StatusListRecord, StatusListStore, Versioned } from "./ports.js";
import { addProofSet, proofsOf, type Signer } from "./proof.js";
import {
	buildStatusListCredential,
	createBitstring,
	decodeBitstring,
	encodeBitstring,
	getBit,
	MIN_STATUS_LIST_ENTRIES,
	type RandomBytes,
	randomUnusedIndex,
	withBit,
} from "./status.js";
import type { ProofSuite, SuiteRegistry } from "./suite.js";
import type { BitstringStatusListCredential, StatusPurpose } from "./types.js";

const DEFAULT_ATTEMPTS = 5;

/** Throws `signer_invalid` unless the signer's key belongs to `issuer` (else the issuer's own proofs fail). */
export const assertSignerFor = (signer: Signer, issuer: string): void => {
	if (controllerOf(signer.keyId) !== issuer) {
		throw new CredentialsError(
			"signer_invalid",
			`the signer's key ${signer.keyId} is not a key of ${issuer}`,
		);
	}
};

const signList = async (input: {
	id: string;
	issuer: string;
	statusPurpose: StatusPurpose;
	bits: Uint8Array;
	signer: Signer;
	now: number;
	suites: readonly ProofSuite[];
	ttl?: number;
}): Promise<BitstringStatusListCredential> => {
	const unsigned = buildStatusListCredential({
		id: input.id,
		issuer: input.issuer,
		statusPurpose: input.statusPurpose,
		encodedList: await encodeBitstring(input.bits),
		validFrom: formatDateTimeStamp(input.now),
		...(input.ttl === undefined ? {} : { ttl: input.ttl }),
	});
	return addProofSet(unsigned, {
		signer: input.signer,
		created: formatDateTimeStamp(input.now),
		suites: input.suites,
	});
};

/**
 * The suites to re-sign a list with: the ones its current proofs use, so a list published with rdfc stays
 * verifiable by rdfc-only verifiers. Throws `cryptosuite_unsupported` when `suites` lacks one of them.
 */
const suitesOfList = (
	list: BitstringStatusListCredential,
	suites: SuiteRegistry,
): ProofSuite[] => {
	const out: ProofSuite[] = [];
	for (const proof of proofsOf(list)) {
		const name = (proof as { cryptosuite?: unknown }).cryptosuite;
		const suite = typeof name === "string" ? suites.get(name) : undefined;
		if (suite === undefined) {
			throw new CredentialsError(
				"cryptosuite_unsupported",
				`${list.id} is signed with ${String(name)}; pass that suite to re-sign it`,
			);
		}
		out.push(suite);
	}
	return out;
};

/** The list, created (empty, signed) when absent. Throws `status_list_invalid` when it exists with another purpose. */
export const ensureStatusList = async (input: {
	store: StatusListStore;
	id: string;
	issuer: string;
	statusPurpose: StatusPurpose;
	signer: Signer;
	now: number;
	entries?: number;
	ttl?: number;
	/** The proofs the list is published with. Default `eddsa-jcs-2022`; give rdfc for 1EdTech-certifiable lists. */
	proofSuites?: readonly ProofSuite[];
}): Promise<Versioned<StatusListRecord>> => {
	assertSignerFor(input.signer, input.issuer);
	for (let attempt = 0; attempt < DEFAULT_ATTEMPTS; attempt++) {
		const existing = await input.store.get(input.id);
		if (existing !== null) {
			if (
				existing.value.credential.credentialSubject.statusPurpose !==
				input.statusPurpose
			) {
				throw new CredentialsError(
					"status_list_invalid",
					`${input.id} is not a ${input.statusPurpose} list`,
				);
			}
			return existing;
		}
		const bits = createBitstring(input.entries ?? MIN_STATUS_LIST_ENTRIES);
		const record: StatusListRecord = {
			credential: await signList({
				...input,
				bits,
				suites: input.proofSuites ?? [...JCS_SUITES.values()],
			}),
			allocations: await encodeBitstring(bits),
		};
		const outcome = await input.store.putIfAbsent(input.id, record);
		if (outcome.status === "written")
			return { value: record, etag: outcome.etag };
	}
	throw new CredentialsError(
		"status_list_contended",
		`${input.id} kept changing`,
	);
};

const readList = async (
	store: StatusListStore,
	id: string,
): Promise<Versioned<StatusListRecord>> => {
	const found = await store.get(id);
	if (found === null)
		throw new CredentialsError("status_list_missing", `${id} does not exist`);
	return found;
};

/** Reserve a random unused index in the list (only the private allocation map changes; nothing is re-signed). */
export const allocateStatusIndex = async (input: {
	store: StatusListStore;
	id: string;
	statusPurpose: StatusPurpose;
	randomBytes: RandomBytes;
	maxAttempts?: number;
}): Promise<number> => {
	const attempts = input.maxAttempts ?? DEFAULT_ATTEMPTS;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const current = await readList(input.store, input.id);
		if (
			current.value.credential.credentialSubject.statusPurpose !==
			input.statusPurpose
		) {
			throw new CredentialsError(
				"status_list_invalid",
				`${input.id} is not a ${input.statusPurpose} list`,
			);
		}
		const allocations = await decodeBitstring(current.value.allocations);
		const index = randomUnusedIndex(allocations, input.randomBytes);
		const record: StatusListRecord = {
			credential: current.value.credential,
			allocations: await encodeBitstring(withBit(allocations, index, true)),
		};
		const outcome = await input.store.putIfMatch(
			input.id,
			record,
			current.etag,
		);
		if (outcome.status === "written") return index;
	}
	throw new CredentialsError(
		"status_list_contended",
		`${input.id} kept changing`,
	);
};

/**
 * Set or clear one status bit and re-sign the list. Returns false when the bit already had that value (nothing is
 * written). Clearing a revocation bit throws `revocation_irreversible` (BSL §2.1: revocation "is not reversible").
 */
export const setStatusBit = async (input: {
	store: StatusListStore;
	id: string;
	statusPurpose: StatusPurpose;
	index: number;
	value: boolean;
	signer: Signer;
	now: number;
	maxAttempts?: number;
	/** Suites available to re-sign with; the list keeps the suites it already has. Default `eddsa-jcs-2022`. */
	suites?: SuiteRegistry;
}): Promise<boolean> => {
	if (input.statusPurpose === "revocation" && !input.value) {
		throw new CredentialsError(
			"revocation_irreversible",
			"a revocation cannot be undone",
		);
	}
	const attempts = input.maxAttempts ?? DEFAULT_ATTEMPTS;
	for (let attempt = 0; attempt < attempts; attempt++) {
		const current = await readList(input.store, input.id);
		const list = current.value.credential;
		if (list.credentialSubject.statusPurpose !== input.statusPurpose) {
			throw new CredentialsError(
				"status_list_invalid",
				`${input.id} is not a ${input.statusPurpose} list`,
			);
		}
		assertSignerFor(input.signer, list.issuer);
		const bits = await decodeBitstring(list.credentialSubject.encodedList);
		if (getBit(bits, input.index) === input.value) return false;
		const record: StatusListRecord = {
			credential: await signList({
				id: list.id,
				issuer: list.issuer,
				statusPurpose: input.statusPurpose,
				bits: withBit(bits, input.index, input.value),
				signer: input.signer,
				now: input.now,
				suites: suitesOfList(list, input.suites ?? JCS_SUITES),
				...(list.credentialSubject.ttl === undefined
					? {}
					: { ttl: list.credentialSubject.ttl }),
			}),
			allocations: current.value.allocations,
		};
		const outcome = await input.store.putIfMatch(
			input.id,
			record,
			current.etag,
		);
		if (outcome.status === "written") return true;
	}
	throw new CredentialsError(
		"status_list_contended",
		`${input.id} kept changing`,
	);
};
