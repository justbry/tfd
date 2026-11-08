/**
 * Orchestration over the ports: issue a credential with a status entry, and revoke, suspend or reinstate it. The
 * caller injects the clock (`now`), the entropy (`randomBytes`), the signer and the stores, and persists the
 * returned event. Who may do any of this is the caller's decision; the event records `actor`.
 */
import {
	ACHIEVEMENT_TEMPLATE,
	buildCredential,
	type CredentialInput,
	type CredentialKind,
	STANDING_TEMPLATE,
} from "./credential.js";
import { formatDateTimeStamp } from "./datetime.js";
import { CredentialsError } from "./errors.js";
import { type CredentialEvent, credentialEvent } from "./events.js";
import { eddsaJcs2022 } from "./jcs-suite.js";
import type { CredentialStore, StatusListStore } from "./ports.js";
import { addProofSet, type Signer } from "./proof.js";
import { type RandomBytes, statusEntry } from "./status.js";
import {
	allocateStatusIndex,
	assertSignerFor,
	setStatusBit,
} from "./status-list.js";
import type { ProofSuite, SuiteRegistry } from "./suite.js";
import type {
	BitstringStatusListEntry,
	OpenBadgeCredential,
	StatusPurpose,
} from "./types.js";

export type Attribution = { actor: string; onBehalfOf?: string };

export type IssueInput = Attribution & {
	kind: CredentialKind;
	credential: Omit<CredentialInput, "credentialStatus" | "now">;
	now: number;
	signer: Signer;
	randomBytes: RandomBytes;
	statusList: {
		store: StatusListStore;
		/** The list credential URL; create it first with `ensureStatusList`. */
		id: string;
		/** Default: revocation for an achievement, suspension for a standing credential. */
		statusPurpose?: StatusPurpose;
	};
	credentials: CredentialStore;
	/**
	 * One proof per suite: one suite gives a single proof, several a proof set. Default `eddsa-jcs-2022`; for
	 * 1EdTech-certifiable badges give `eddsaRdfc2022` from `tfd-credentials/rdfc` (or use its `issueCertifiable`).
	 */
	proofSuites?: readonly ProofSuite[];
	/** The caller's opaque holder key for `CredentialStore.list({ holder })`. Never put in the credential. */
	holderKey?: string;
};

export type Issued = {
	credential: OpenBadgeCredential;
	event: CredentialEvent;
};

const DEFAULT_PURPOSE: Record<CredentialKind, StatusPurpose> = {
	achievement: "revocation",
	standing: "suspension",
};

/**
 * Reserve a random status index, build and sign the credential, store it. Throws `credential_conflict` when the
 * store already holds a different credential with this id.
 */
export const issue = async (input: IssueInput): Promise<Issued> => {
	assertSignerFor(input.signer, input.credential.issuer.id);
	const statusPurpose =
		input.statusList.statusPurpose ?? DEFAULT_PURPOSE[input.kind];
	const index = await allocateStatusIndex({
		store: input.statusList.store,
		id: input.statusList.id,
		statusPurpose,
		randomBytes: input.randomBytes,
	});
	const template =
		input.kind === "standing" ? STANDING_TEMPLATE : ACHIEVEMENT_TEMPLATE;
	const unsigned = buildCredential(template, {
		...input.credential,
		now: input.now,
		credentialStatus: statusEntry(input.statusList.id, statusPurpose, index),
	});
	const credential = await addProofSet(unsigned, {
		signer: input.signer,
		created: formatDateTimeStamp(input.now),
		suites: input.proofSuites ?? [eddsaJcs2022],
	});
	const outcome = await input.credentials.put({
		credential,
		holder: input.holderKey ?? null,
		level: credential.credentialSubject.achievement.humanCode ?? null,
	});
	if (outcome === "conflict") {
		throw new CredentialsError(
			"credential_conflict",
			`${credential.id} already holds another credential`,
		);
	}
	const event = credentialEvent({
		type: "credential.issued",
		credentialId: credential.id,
		at: formatDateTimeStamp(input.now),
		actor: input.actor,
		...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
		statusPurpose,
		statusListCredential: input.statusList.id,
		statusListIndex: String(index),
	});
	return { credential, event };
};

export type StatusChangeInput = Attribution & {
	credential: OpenBadgeCredential;
	now: number;
	signer: Signer;
	statusLists: StatusListStore;
	maxAttempts?: number;
	/** Suites available to re-sign the status list with (it keeps its own). Default `eddsa-jcs-2022`. */
	suites?: SuiteRegistry;
};

/** `changed` is false (and `event` null) when the credential already had that status. */
export type StatusChange = { changed: boolean; event: CredentialEvent | null };

const entryFor = (
	credential: OpenBadgeCredential,
	statusPurpose: StatusPurpose,
): BitstringStatusListEntry => {
	const entry = credential.credentialStatus;
	if (entry === undefined || entry.statusPurpose !== statusPurpose) {
		throw new CredentialsError(
			"status_entry_missing",
			`${credential.id} has no ${statusPurpose} status entry`,
		);
	}
	return entry;
};

const changeStatus = async (
	input: StatusChangeInput,
	statusPurpose: StatusPurpose,
	value: boolean,
	type: CredentialEvent["type"],
): Promise<StatusChange> => {
	const entry = entryFor(input.credential, statusPurpose);
	const changed = await setStatusBit({
		store: input.statusLists,
		id: entry.statusListCredential,
		statusPurpose,
		index: Number(entry.statusListIndex),
		value,
		signer: input.signer,
		now: input.now,
		...(input.maxAttempts === undefined
			? {}
			: { maxAttempts: input.maxAttempts }),
		...(input.suites === undefined ? {} : { suites: input.suites }),
	});
	if (!changed) return { changed, event: null };
	const event = credentialEvent({
		type,
		credentialId: input.credential.id,
		at: formatDateTimeStamp(input.now),
		actor: input.actor,
		...(input.onBehalfOf === undefined ? {} : { onBehalfOf: input.onBehalfOf }),
		statusPurpose,
		statusListCredential: entry.statusListCredential,
		statusListIndex: entry.statusListIndex,
	});
	return { changed, event };
};

/** Permanent. Needs a revocation entry. */
export const revoke = (input: StatusChangeInput): Promise<StatusChange> =>
	changeStatus(input, "revocation", true, "credential.revoked");

/** Reversible with `reinstate`. Needs a suspension entry. */
export const suspend = (input: StatusChangeInput): Promise<StatusChange> =>
	changeStatus(input, "suspension", true, "credential.suspended");

export const reinstate = (input: StatusChangeInput): Promise<StatusChange> =>
	changeStatus(input, "suspension", false, "credential.reinstated");
