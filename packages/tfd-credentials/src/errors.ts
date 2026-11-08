/** Every code a thrown `CredentialsError` can carry. Verification never throws these; it returns reasons instead. */
export type CredentialsErrorCode =
	| "canonical_invalid"
	| "multibase_invalid"
	| "multikey_invalid"
	| "did_invalid"
	| "datetime_invalid"
	| "input_invalid"
	| "signer_invalid"
	| "proof_generation_failed"
	| "cryptosuite_unsupported"
	| "status_list_invalid"
	| "status_list_too_short"
	| "status_list_full"
	| "status_index_out_of_range"
	| "status_entry_missing"
	| "status_list_missing"
	| "status_list_contended"
	| "revocation_irreversible"
	| "credential_conflict"
	| "gzip_failed";

export class CredentialsError extends Error {
	// Set explicitly: a minifier renames classes.
	override name = "CredentialsError";
	constructor(
		readonly code: CredentialsErrorCode,
		message: string,
	) {
		super(message);
	}
}
