/**
 * Audit events. The library only builds them; the caller persists them (atm's journal, a DO table, …). They carry no
 * personal data: ids, the actor's opaque id, and where the status bit lives.
 */
import type { StatusPurpose } from "./types.js";

export type CredentialEventType =
	| "credential.issued"
	| "credential.revoked"
	| "credential.suspended"
	| "credential.reinstated";

export type CredentialEvent = {
	type: CredentialEventType;
	credentialId: string;
	/** dateTimeStamp of the caller's `now`. */
	at: string;
	/** Who did it: an opaque account or service id. Who MAY do it is the caller's decision. */
	actor: string;
	/** The org or person the actor acted for, when not themselves. */
	onBehalfOf?: string;
	statusPurpose?: StatusPurpose;
	statusListCredential?: string;
	statusListIndex?: string;
};

export const credentialEvent = (input: CredentialEvent): CredentialEvent => {
	const event: CredentialEvent = {
		type: input.type,
		credentialId: input.credentialId,
		at: input.at,
		actor: input.actor,
	};
	if (input.onBehalfOf !== undefined) event.onBehalfOf = input.onBehalfOf;
	if (input.statusPurpose !== undefined)
		event.statusPurpose = input.statusPurpose;
	if (input.statusListCredential !== undefined)
		event.statusListCredential = input.statusListCredential;
	if (input.statusListIndex !== undefined)
		event.statusListIndex = input.statusListIndex;
	return event;
};
