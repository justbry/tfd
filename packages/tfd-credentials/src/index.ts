/**
 * tfd-credentials: issue and verify Open Badges 3.0 credentials (W3C VC 2.0 + eddsa-jcs-2022 Data Integrity proofs)
 * with a Bitstring Status List, through injected ports. No I/O, clock or randomness of its own. See README.md.
 */

export { canonicalBytes, canonicalize, type JsonValue } from "./canonical.js";
export {
	ACHIEVEMENT_TEMPLATE,
	buildAchievementCredential,
	buildCredential,
	buildStandingCredential,
	type CredentialInput,
	type CredentialKind,
	type CredentialTemplate,
	credentialIdFromRandom,
	evidencePointer,
	type HolderInput,
	identityHash,
	issuerProfile,
	kindOf,
	type LevelDefinition,
	STANDING_TEMPLATE,
	sha256DigestMultibase,
} from "./credential.js";
export { formatDateTimeStamp, parseDateTimeStamp } from "./datetime.js";
export {
	buildDidWebDocument,
	composeDidResolver,
	controllerOf,
	type DidDocument,
	type DidResolver,
	type DidWebKey,
	didKeyFromPublicKey,
	didWebFor,
	didWebToUrl,
	findVerificationMethod,
	isAssertionMethod,
	type KeyRetrievalFailure,
	type MethodLookup,
	parseDidDocument,
	resolveDidKey,
	retrieveVerificationMethod,
	type VerificationMethod,
} from "./did.js";
export { CredentialsError, type CredentialsErrorCode } from "./errors.js";
export {
	type CredentialEvent,
	type CredentialEventType,
	credentialEvent,
} from "./events.js";
export {
	type Attribution,
	type Issued,
	type IssueInput,
	issue,
	reinstate,
	revoke,
	type StatusChange,
	type StatusChangeInput,
	suspend,
} from "./issue.js";
export {
	eddsaJcs2022,
	JCS_CRYPTOSUITE,
	JCS_SUITES,
} from "./jcs-suite.js";
export {
	memoryCredentialStore,
	memoryStatusListStore,
} from "./memory-store.js";
export {
	decodeEd25519Multikey,
	encodeEd25519Multikey,
} from "./multikey.js";
export {
	type ObjectStore,
	type ObjectStoreLayout,
	objectStoreCredentialStore,
	objectStoreStatusListStore,
} from "./object-store.js";
export type {
	CredentialFilter,
	CredentialPutOutcome,
	CredentialStore,
	StatusListRecord,
	StatusListStore,
	StoredCredential,
	Versioned,
	WriteOutcome,
} from "./ports.js";
export {
	addProof,
	addProofSet,
	checkProof,
	inspectProof,
	type ParsedProof,
	type ProofCheck,
	type ProofFailure,
	proofsOf,
	type Signer,
	verifySignature,
} from "./proof.js";
export { type PublicCredentialView, publicView } from "./public-view.js";
export {
	buildStatusListCredential,
	countSetBits,
	createBitstring,
	decodeBitstring,
	encodeBitstring,
	getBit,
	MAX_STATUS_LIST_BYTES,
	MIN_STATUS_LIST_ENTRIES,
	type RandomBytes,
	randomUnusedIndex,
	statusEntry,
	withBit,
} from "./status.js";
export {
	allocateStatusIndex,
	ensureStatusList,
	setStatusBit,
} from "./status-list.js";
export {
	type HashOutcome,
	type ProofSuite,
	type SuiteRegistry,
	suiteRegistry,
} from "./suite.js";
export {
	type Achievement,
	type AchievementSubject,
	type BitstringStatusList,
	type BitstringStatusListCredential,
	type BitstringStatusListEntry,
	type Criteria,
	type DataIntegrityProof,
	type Evidence,
	type IdentityObject,
	type Image,
	type IssuerProfile,
	OB3_CONTEXT,
	OPEN_BADGE_CONTEXT,
	type OpenBadgeCredential,
	STATUS_LIST_CONTEXT,
	type StatusPurpose,
	VC_CONTEXT_V2,
} from "./types.js";
export { URLU_ISSUER_NAME, type UrluLevel, urluLevels } from "./urlu.js";
export {
	type ContextOptions,
	type Validation,
	type ValidationCode,
	type ValidationIssue,
	validateOpenBadgeCredential,
	validateStatusListCredential,
} from "./validate.js";
export { verifyCredential } from "./verify.js";
export type {
	Check,
	IssuerKeyReason,
	ProofReport,
	SignatureReason,
	StatusCheck,
	StatusListResolver,
	StatusReason,
	StatusState,
	StructureReason,
	ValidityReason,
	VerificationResult,
	VerifyOptions,
} from "./verify-result.js";
