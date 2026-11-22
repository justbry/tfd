// SPDX-License-Identifier: Apache-2.0
/**
 * Package entry (package.json `exports` points here), so it is the one barrel file this package keeps. Names are
 * re-exported explicitly so the public surface is the list below.
 */

export type { CountedPayment } from "./accrual.js";

export { daysOverdue, expectedDueToDate, replayBalance } from "./accrual.js";
export type {
	ApprovalPolicy,
	ApprovalRequestKey,
	ApprovalStatus,
	PendingApproval,
} from "./approvals.js";
export { approvalStatus, checkAppend, pendingApprovals } from "./approvals.js";
export {
	canonicalJson,
	fromBase64Url,
	sha256Hex,
	toBase64Url,
	toHex,
	utf8Bytes,
} from "./canonical.js";
export type {
	ChainFailure,
	ChainHead,
	ChainLink,
	ChainVerdict,
} from "./chain.js";
export {
	buildChain,
	CHAIN_GENESIS_PREFIX,
	chainHead,
	eventHash,
	extendChain,
	genesisHash,
	linkHash,
	verifyChain,
} from "./chain.js";
export type { CivilParts } from "./date.js";
export {
	addDays,
	addMonthsAnchored,
	compareDates,
	daysBetween,
	isValidCivilDate,
	parseCivilDate,
} from "./date.js";
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
} from "./documents.js";
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
} from "./documents.js";
export { parseNoteEvent, parseNoteTerms, validateStream } from "./events.js";
export type { DisclosureEntry, Grant, GrantStatus } from "./grants.js";
export {
	activeGrants,
	disclosureLog,
	grantsOf,
	REVOKE_NOTICE,
} from "./grants.js";
export type { Rational } from "./money.js";
export {
	ceilDiv,
	formatMinor,
	maxBigint,
	minBigint,
	parseMinor,
	parseRate,
	roundHalfUp,
} from "./money.js";
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
} from "./portfolio.js";
export {
	AGING_BUCKETS,
	agingBucket,
	BOARD_CSV_HEADER,
	boardReport,
	boardReportCsv,
	portfolio,
} from "./portfolio.js";
export { generateSchedule } from "./schedule.js";
export type { AgreedPayment, AgreedView } from "./statement.js";
export { agreedView, statement, statusLabel } from "./statement.js";
export * from "./types.js";
export type {
	SharedPayment,
	SharedView,
	StatementView,
	SummaryView,
	VerifyView,
} from "./visibility.js";
export {
	AGREED_PAYMENTS_LABEL,
	agreedBalance,
	sharedView,
	viewFor,
} from "./visibility.js";
