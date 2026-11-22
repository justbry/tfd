// SPDX-License-Identifier: Apache-2.0
/**
 * Package entry (package.json `exports` points here), so it is the one barrel file this package keeps. Names are
 * re-exported explicitly so the public surface is the list below.
 */

export type { CountedPayment } from "./accrual";

export { daysOverdue, expectedDueToDate, replayBalance } from "./accrual";
export type {
	ApprovalAgents,
	ApprovalPolicy,
	ApprovalRequestKey,
	ApprovalStatus,
	PendingApproval,
} from "./approvals";
export {
	APPROVAL_MAX_AGE_DAYS,
	approvalStatus,
	checkAppend,
	pendingApprovals,
} from "./approvals";
export {
	canonicalJson,
	fromBase64Url,
	sha256Hex,
	toBase64Url,
	toHex,
	utf8Bytes,
} from "./canonical";
export type {
	ChainFailure,
	ChainHead,
	ChainLink,
	ChainVerdict,
} from "./chain";
export {
	buildChain,
	CHAIN_GENESIS_PREFIX,
	chainHead,
	eventHash,
	extendChain,
	genesisHash,
	linkHash,
	verifyChain,
} from "./chain";
export {
	addDays,
	compareDates,
	daysBetween,
	isValidCivilDate,
} from "./date";
export type {
	ChainSealBody,
	DocumentParties,
	DocumentSignature,
	DocumentSigner,
	NoteDocumentBody,
	PaymentReceiptBody,
	PayoffStatementBody,
	ReleaseBody,
	SignedDocument,
	SigningPurpose,
	ViewBalance,
} from "./documents";
export {
	chainSealBody,
	documentBody,
	documentSha256,
	documentSigningBytes,
	NOTE_DOCUMENT_SCHEMA,
	PAYOFF_WORDING,
	paymentReceiptBody,
	payoffStatementBody,
	RELEASE_WORDING,
	releaseBody,
	signDocument,
} from "./documents";
export {
	MAX_CARVE_OUT_DAYS,
	MAX_GRANT_DAYS,
	parseNoteEvent,
	parseNoteTerms,
	validateStream,
} from "./events";
export type { DisclosureEntry, Grant, GrantStatus } from "./grants";
export {
	activeGrants,
	disclosureLog,
	grantsOf,
	REVOKE_NOTICE,
} from "./grants";
export type { Rational } from "./money";
export { formatMinor, parseMinor, parseRate, roundHalfUp } from "./money";
export type {
	AgingBucket,
	BoardReport,
	BoardRow,
	BucketCounts,
	CurrencyTotals,
	InvalidNote,
	Portfolio,
	PortfolioNote,
	PortfolioRow,
} from "./portfolio";
export {
	agingBucket,
	BOARD_CSV_HEADER,
	boardReport,
	boardReportCsv,
	portfolio,
} from "./portfolio";
export { generateSchedule } from "./schedule";
export type { AgreedPayment, AgreedView } from "./statement";
export { agreedView, statement, statusLabel } from "./statement";
export * from "./types";
export type {
	SharedPayment,
	SharedView,
	StatementView,
	SummaryView,
	VerifyView,
} from "./visibility";
export {
	AGREED_PAYMENTS_LABEL,
	agreedBalance,
	sharedView,
	viewFor,
} from "./visibility";
