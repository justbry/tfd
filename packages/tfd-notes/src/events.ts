// SPDX-License-Identifier: Apache-2.0
/**
 * Hand-written, dependency-free validation of `tfd.note-event.v1` events and of a whole note stream
 * (docs/specs/promissory-notes.md R-1, R-2, R-3, R-6, R-7, R-10 to R-14, AC-3, AC-6).
 *
 * `parseNoteEvent` checks one event's shape. `validateStream` parses each event, orders by `seq`, and enforces the
 * rules that need other events: one `note.created` first, one `note_id`, no gap or repeat in `seq`, unique ids,
 * references to earlier events, and the two-party roles. Every error is a plain `Error` whose message names the event
 * type and the field.
 */

import { addDays, addMonthsAnchored } from "./date.js";
import {
	type AnnotationAddedEvent,
	type ApprovalAction,
	type ApprovalGrantedEvent,
	type ApprovalRequestedEvent,
	type EventVia,
	type GrantAnsweredEvent,
	type GrantAudience,
	type GrantAudienceKind,
	type GrantLevel,
	type GrantProposedEvent,
	type GrantPurpose,
	NOTE_EVENT_SCHEMA,
	type NoteCreatedEvent,
	type NoteEvent,
	type NoteTerms,
	type NoticeKind,
	type NoticeSentEvent,
	type PartyReboundEvent,
	type PaymentConfirmedEvent,
	type PaymentDisputedEvent,
	type PaymentRecordedEvent,
	type PaymentResolvedEvent,
	type PaymentSource,
	type PayoffIssuedEvent,
	type ReleaseConfirmedEvent,
	type ReleaseDraftedEvent,
	type Role,
	type ScheduleTerms,
	type TermsAcceptedEvent,
	type TermsDeclinedEvent,
	type VisibilityChangedEvent,
} from "./types.js";

type JsonRecord = Record<string, unknown>;
type BaseFields = Pick<
	NoteCreatedEvent,
	"schema" | "id" | "note_id" | "seq" | "entered_at" | "entered_by"
> & { via?: EventVia; agent_ref?: string };

const MONEY_PATTERN = /^(0|[1-9][0-9]*)$/;
const RATE_PATTERN = /^(0|0\.[0-9]{1,6})$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const INSTANT_PATTERN =
	/^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,9})?Z$/;

const MAX_EXPONENT = 4;
const MAX_AGENT_REF_LENGTH = 128;
const MAX_CURE_DAYS = 365;
/** The most installments an amortized schedule may have (R-8); the schedule generator refuses more. */
const MAX_INSTALLMENTS = 5200;
const WEEK_DAYS = 7;
const BIWEEK_DAYS = 14;
const FIRST_SEQ = 1;
const FEBRUARY = 2;
const LEAP_YEAR_CYCLE = 4;
const CENTURY = 100;
const LEAP_CENTURY_CYCLE = 400;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

const BASE_KEYS = [
	"schema",
	"id",
	"note_id",
	"seq",
	"entered_at",
	"entered_by",
	"type",
] as const;
/** Optional on every event: how the party reached the system, and who acted for the party. */
const BASE_OPTIONAL_KEYS = ["via", "agent_ref"] as const;
const VIAS = ["email-link", "account"] as const;
const ROLES = ["lender", "borrower"] as const;
const NOTICE_KINDS = ["reminder", "default"] as const;
const GRANT_CHANGES = [
	"grant.proposed",
	"grant.consented",
	"grant.revoked",
] as const;
const GRANT_AUDIENCE_KINDS = ["person", "org", "link"] as const;
const GRANT_LEVELS = ["summary", "statement", "verify"] as const;
const GRANT_PURPOSES = [
	"accountant",
	"lawyer",
	"court",
	"assignee",
	"other",
] as const;
/** The longest a grant may run past the event that proposed it. */
const MAX_GRANT_DAYS = 365;
const APPROVAL_ACTIONS = [
	"release.confirm",
	"notice.default",
	"waiver",
] as const;
const FREQUENCIES = ["weekly", "biweekly", "monthly"] as const;
const PAYMENT_KINDS = ["payment", "reversal"] as const;
// `both-agree` is derived from a confirmation and never typed (R-14), so the validator does not accept it.
const TYPED_SOURCES = ["lender-states", "borrower-states"] as const;
const EVENT_TYPES = [
	"note.created",
	"payment.recorded",
	"payment.confirmed",
	"payment.disputed",
	"payment.resolved",
	"annotation.added",
	"terms.accepted",
	"terms.declined",
	"payoff.issued",
	"release.drafted",
	"release.confirmed",
	"notice.sent",
	"party.rebound",
	"visibility.changed",
	"approval.requested",
	"approval.granted",
] as const;

const isRecord = (value: unknown): value is JsonRecord =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const show = (value: unknown): string => {
	if (typeof value === "string") return JSON.stringify(value);
	if (isRecord(value)) return "an object";
	if (Array.isArray(value)) return "an array";
	return String(value);
};

// A function declaration, not an arrow: only declarations with an explicit `never` type narrow the caller's flow.
function fail(label: string, message: string): never {
	throw new Error(`${label}: ${message}`);
}

const isLeapYear = (year: number): boolean =>
	year % LEAP_YEAR_CYCLE === 0 &&
	(year % CENTURY !== 0 || year % LEAP_CENTURY_CYCLE === 0);

const isCalendarDate = (text: string): boolean => {
	const match = DATE_PATTERN.exec(text);
	if (match === null) return false;
	const year = Number.parseInt(match[1], 10);
	const month = Number.parseInt(match[2], 10);
	const day = Number.parseInt(match[3], 10);
	if (year < 1 || month < 1 || month > DAYS_IN_MONTH.length) return false;
	const daysInMonth =
		month === FEBRUARY && isLeapYear(year)
			? DAYS_IN_MONTH[month - 1] + 1
			: DAYS_IN_MONTH[month - 1];
	return day >= 1 && day <= daysInMonth;
};

const isOneOf = <Choice extends string>(
	choices: readonly Choice[],
	value: unknown,
): value is Choice => choices.some((choice) => choice === value);

/** Rejects a missing required key and any key outside the required and optional lists. */
const checkKeys = (
	record: JsonRecord,
	label: string,
	prefix: string,
	required: readonly string[],
	optional: readonly string[],
): void => {
	for (const key of required) {
		if (!(key in record)) fail(label, `${prefix}${key} is required`);
	}
	for (const key of Object.keys(record)) {
		if (!(required.includes(key) || optional.includes(key))) {
			fail(label, `${prefix}${key} is not allowed`);
		}
	}
};

const readString = (label: string, path: string, value: unknown): string => {
	if (typeof value !== "string" || value.length === 0) {
		return fail(
			label,
			`${path} must be a non-empty string, got ${show(value)}`,
		);
	}
	return value;
};

const readText = (label: string, path: string, value: unknown): string => {
	if (typeof value !== "string") {
		return fail(label, `${path} must be a string, got ${show(value)}`);
	}
	return value;
};

/** Money of at least one minor unit, for fields that must be positive (the principal). */
const readPositiveMoney = (
	label: string,
	path: string,
	value: unknown,
): string => {
	const money = readMoney(label, path, value);
	if (money === "0") {
		return fail(label, `${path} must be at least 1 minor unit, got "0"`);
	}
	return money;
};

const readMoney = (label: string, path: string, value: unknown): string => {
	if (typeof value !== "string" || !MONEY_PATTERN.test(value)) {
		return fail(
			label,
			`${path} must be a non-negative integer digit string of minor units, got ${show(value)}`,
		);
	}
	return value;
};

const readDate = (label: string, path: string, value: unknown): string => {
	if (typeof value !== "string" || !isCalendarDate(value)) {
		return fail(
			label,
			`${path} must be a calendar date YYYY-MM-DD, got ${show(value)}`,
		);
	}
	return value;
};

const readSha256 = (label: string, path: string, value: unknown): string => {
	if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
		return fail(
			label,
			`${path} must be 64 lowercase hex characters, got ${show(value)}`,
		);
	}
	return value;
};

const readInstant = (label: string, path: string, value: unknown): string => {
	const match = typeof value === "string" ? INSTANT_PATTERN.exec(value) : null;
	if (
		typeof value !== "string" ||
		match === null ||
		!isCalendarDate(match[1])
	) {
		return fail(
			label,
			`${path} must be an ISO 8601 UTC instant ending in Z, got ${show(value)}`,
		);
	}
	return value;
};

const readRole = (label: string, path: string, value: unknown): Role => {
	if (!isOneOf(ROLES, value)) {
		return fail(
			label,
			`${path} must be "lender" or "borrower", got ${show(value)}`,
		);
	}
	return value;
};

/** An integer from 1 to `maximum`, itself at most 2^53 - 1 (the schema's `maximum`), so it is exact in a `number`. */
const readPositiveInteger = (
	label: string,
	path: string,
	value: unknown,
	maximum = Number.MAX_SAFE_INTEGER,
): number => {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
		return fail(
			label,
			`${path} must be an integer of at least 1, got ${show(value)}`,
		);
	}
	if (value > maximum) {
		return fail(
			label,
			`${path} must be an integer from 1 to ${maximum}, got ${show(value)}`,
		);
	}
	return value;
};

const readVia = (label: string, value: unknown): EventVia => {
	if (!isOneOf(VIAS, value)) {
		return fail(
			label,
			`via must be "email-link" or "account", got ${show(value)}`,
		);
	}
	return value;
};

/** A non-empty reference of at most 128 characters (code points, as the schema's `maxLength` counts them). */
const readAgentReference = (label: string, value: unknown): string => {
	const reference = readString(label, "agent_ref", value);
	const length = Array.from(reference).length;
	if (length > MAX_AGENT_REF_LENGTH) {
		return fail(
			label,
			`agent_ref must be at most ${MAX_AGENT_REF_LENGTH} characters, got ${length}`,
		);
	}
	return reference;
};

const readBase = (record: JsonRecord, label: string): BaseFields => {
	if (record.schema !== NOTE_EVENT_SCHEMA) {
		fail(
			label,
			`schema must be "${NOTE_EVENT_SCHEMA}", got ${show(record.schema)}`,
		);
	}
	const base: BaseFields = {
		schema: NOTE_EVENT_SCHEMA,
		id: readString(label, "id", record.id),
		note_id: readString(label, "note_id", record.note_id),
		seq: readPositiveInteger(label, "seq", record.seq),
		entered_at: readInstant(label, "entered_at", record.entered_at),
		entered_by: readRole(label, "entered_by", record.entered_by),
	};
	if ("via" in record) base.via = readVia(label, record.via);
	if ("agent_ref" in record) {
		base.agent_ref = readAgentReference(label, record.agent_ref);
	}
	return base;
};

/** Checks the keys common to every event plus the type's own, required and optional. */
const checkEventKeys = (
	record: JsonRecord,
	label: string,
	required: readonly string[],
	optional: readonly string[] = [],
): void => {
	checkKeys(
		record,
		label,
		"",
		[...BASE_KEYS, ...required],
		[...BASE_OPTIONAL_KEYS, ...optional],
	);
};

/** The event's `entered_by` must be `role`; returns the base narrowed to that role. */
const requireRole = <Required extends Role>(
	label: string,
	base: BaseFields,
	role: Required,
): BaseFields & { entered_by: Required } => {
	if (base.entered_by !== role) {
		return fail(
			label,
			`entered_by must be "${role}", got ${show(base.entered_by)}`,
		);
	}
	return { ...base, entered_by: role };
};

/** Orders two validated instants, comparing fractional seconds as numbers (`.5Z` is after `Z` and before `.51Z`). */
const compareInstants = (left: string, right: string): number => {
	const [leftSeconds, leftFraction = ""] = left.slice(0, -1).split(".");
	const [rightSeconds, rightFraction = ""] = right.slice(0, -1).split(".");
	if (leftSeconds !== rightSeconds) {
		return leftSeconds < rightSeconds ? -1 : 1;
	}
	const width = Math.max(leftFraction.length, rightFraction.length);
	const paddedLeft = leftFraction.padEnd(width, "0");
	const paddedRight = rightFraction.padEnd(width, "0");
	if (paddedLeft === paddedRight) return 0;
	return paddedLeft < paddedRight ? -1 : 1;
};

/** The due date of installment `index` (from 0) counted from `firstDue`, the same way the schedule generator does. */
const dueDateAt = (
	firstDue: string,
	frequency: (typeof FREQUENCIES)[number],
	index: number,
): string => {
	if (frequency === "weekly") return addDays(firstDue, WEEK_DAYS * index);
	if (frequency === "biweekly") return addDays(firstDue, BIWEEK_DAYS * index);
	return addMonthsAnchored(firstDue, index);
};

const readAmortized = (
	label: string,
	issueDate: string,
	value: JsonRecord,
	frequency: (typeof FREQUENCIES)[number],
): ScheduleTerms => {
	const count = readPositiveInteger(
		label,
		"terms.schedule.count",
		value.count,
		MAX_INSTALLMENTS,
	);
	const firstDue = readDate(label, "terms.schedule.first_due", value.first_due);
	if (firstDue <= issueDate) {
		fail(
			label,
			`terms.schedule.first_due ${firstDue} must be after issue_date ${issueDate}`,
		);
	}
	try {
		dueDateAt(firstDue, frequency, count - 1);
	} catch {
		fail(
			label,
			`terms.schedule.count ${count} puts the last due date beyond year 9999`,
		);
	}
	return { type: "amortized", frequency, count, first_due: firstDue };
};

const readSchedule = (
	label: string,
	issueDate: string,
	value: unknown,
): ScheduleTerms => {
	if (!isRecord(value)) {
		return fail(label, `terms.schedule must be an object, got ${show(value)}`);
	}
	const path = "terms.schedule.";
	if (value.type === "none") {
		checkKeys(value, label, path, ["type"], []);
		return { type: "none" };
	}
	if (value.type === "amortized") {
		checkKeys(
			value,
			label,
			path,
			["type", "frequency", "count", "first_due"],
			[],
		);
		if (!isOneOf(FREQUENCIES, value.frequency)) {
			return fail(
				label,
				`terms.schedule.frequency must be "weekly", "biweekly" or "monthly", got ${show(value.frequency)}`,
			);
		}
		return readAmortized(label, issueDate, value, value.frequency);
	}
	if (value.type === "custom") {
		checkKeys(value, label, path, ["type", "installments"], []);
		return {
			type: "custom",
			installments: readInstallments(label, issueDate, value.installments),
		};
	}
	return fail(
		label,
		`terms.schedule.type must be "amortized", "custom" or "none", got ${show(value.type)}`,
	);
};

const readInstallments = (
	label: string,
	issueDate: string,
	value: unknown,
): { due: string; amount_minor: string }[] => {
	if (!Array.isArray(value) || value.length === 0) {
		return fail(label, "terms.schedule.installments must be a non-empty array");
	}
	const installments: { due: string; amount_minor: string }[] = [];
	let previousDue = issueDate;
	let previousName = "issue_date";
	for (const [index, item] of value.entries()) {
		const path = `terms.schedule.installments[${index}]`;
		if (!isRecord(item)) {
			return fail(label, `${path} must be an object, got ${show(item)}`);
		}
		checkKeys(item, label, `${path}.`, ["due", "amount_minor"], []);
		const due = readDate(label, `${path}.due`, item.due);
		if (due <= previousDue) {
			fail(
				label,
				`${path}.due ${due} must be after ${previousName} ${previousDue}`,
			);
		}
		installments.push({
			due,
			amount_minor: readMoney(label, `${path}.amount_minor`, item.amount_minor),
		});
		previousDue = due;
		previousName = `installments[${index}].due`;
	}
	return installments;
};

const readTerms = (label: string, value: unknown): NoteTerms => {
	if (!isRecord(value)) {
		return fail(label, `terms must be an object, got ${show(value)}`);
	}
	checkKeys(
		value,
		label,
		"terms.",
		[
			"currency",
			"exponent",
			"principal_minor",
			"issue_date",
			"annual_rate",
			"day_count",
			"rounding",
			"timezone",
			"schedule",
		],
		["document_sha256"],
	);
	if (
		typeof value.currency !== "string" ||
		!CURRENCY_PATTERN.test(value.currency)
	) {
		fail(
			label,
			`terms.currency must be three capital letters, got ${show(value.currency)}`,
		);
	}
	const exponent = value.exponent;
	if (
		typeof exponent !== "number" ||
		!Number.isInteger(exponent) ||
		exponent < 0 ||
		exponent > MAX_EXPONENT
	) {
		fail(
			label,
			`terms.exponent must be an integer from 0 to ${MAX_EXPONENT}, got ${show(exponent)}`,
		);
	}
	if (
		typeof value.annual_rate !== "string" ||
		!RATE_PATTERN.test(value.annual_rate)
	) {
		fail(
			label,
			`terms.annual_rate must be a decimal string below 1 with at most 6 places, got ${show(value.annual_rate)}`,
		);
	}
	if (value.day_count !== "actual/365") {
		fail(
			label,
			`terms.day_count must be "actual/365", got ${show(value.day_count)}`,
		);
	}
	if (value.rounding !== "half-up") {
		fail(
			label,
			`terms.rounding must be "half-up", got ${show(value.rounding)}`,
		);
	}
	const issueDate = readDate(label, "terms.issue_date", value.issue_date);
	const terms: NoteTerms = {
		currency: value.currency,
		exponent,
		principal_minor: readPositiveMoney(
			label,
			"terms.principal_minor",
			value.principal_minor,
		),
		issue_date: issueDate,
		annual_rate: value.annual_rate,
		day_count: "actual/365",
		rounding: "half-up",
		timezone: readString(label, "terms.timezone", value.timezone),
		schedule: readSchedule(label, issueDate, value.schedule),
	};
	if ("document_sha256" in value) {
		terms.document_sha256 = readSha256(
			label,
			"terms.document_sha256",
			value.document_sha256,
		);
	}
	return terms;
};

const parseNoteCreated = (record: JsonRecord): NoteCreatedEvent => {
	const label = "note.created";
	checkEventKeys(record, label, ["terms"]);
	const base = readBase(record, label);
	return {
		...base,
		type: "note.created",
		terms: readTerms(label, record.terms),
	};
};

const parsePaymentRecorded = (record: JsonRecord): PaymentRecordedEvent => {
	const label = "payment.recorded";
	checkEventKeys(
		record,
		label,
		["kind", "amount_minor", "value_date"],
		["method", "reference", "reverses", "source"],
	);
	const base = readBase(record, label);
	if (!isOneOf(PAYMENT_KINDS, record.kind)) {
		return fail(
			label,
			`kind must be "payment" or "reversal", got ${show(record.kind)}`,
		);
	}
	const kind = record.kind;
	const event: PaymentRecordedEvent = {
		...base,
		type: "payment.recorded",
		kind,
		amount_minor: readMoney(label, "amount_minor", record.amount_minor),
		value_date: readDate(label, "value_date", record.value_date),
	};
	if (kind === "reversal" && !("reverses" in record)) {
		fail(label, "reverses is required when kind is reversal");
	}
	if (kind === "payment" && "reverses" in record) {
		fail(label, "reverses is only allowed when kind is reversal");
	}
	if ("reverses" in record) {
		event.reverses = readString(label, "reverses", record.reverses);
	}
	if ("method" in record) {
		event.method = readText(label, "method", record.method);
	}
	if ("reference" in record) {
		event.reference = readText(label, "reference", record.reference);
	}
	if ("source" in record) {
		event.source = readSource(label, record.source);
	}
	return event;
};

const readSource = (label: string, value: unknown): PaymentSource => {
	if (value === "both-agree") {
		return fail(
			label,
			'source "both-agree" is derived from a confirmation and cannot be recorded',
		);
	}
	if (!isOneOf(TYPED_SOURCES, value)) {
		return fail(
			label,
			`source must be "lender-states" or "borrower-states", got ${show(value)}`,
		);
	}
	return value;
};

const parsePaymentConfirmed = (record: JsonRecord): PaymentConfirmedEvent => {
	const label = "payment.confirmed";
	checkEventKeys(record, label, ["target"]);
	const base = readBase(record, label);
	return {
		...base,
		type: "payment.confirmed",
		target: readString(label, "target", record.target),
	};
};

const parsePaymentDisputed = (record: JsonRecord): PaymentDisputedEvent => {
	const label = "payment.disputed";
	checkEventKeys(record, label, ["target", "counter_amount_minor", "reason"]);
	const base = readBase(record, label);
	return {
		...base,
		type: "payment.disputed",
		target: readString(label, "target", record.target),
		counter_amount_minor: readMoney(
			label,
			"counter_amount_minor",
			record.counter_amount_minor,
		),
		reason: readString(label, "reason", record.reason),
	};
};

const parsePaymentResolved = (record: JsonRecord): PaymentResolvedEvent => {
	const label = "payment.resolved";
	checkEventKeys(record, label, ["target", "agreed_amount_minor"]);
	const base = readBase(record, label);
	return {
		...base,
		type: "payment.resolved",
		target: readString(label, "target", record.target),
		agreed_amount_minor: readMoney(
			label,
			"agreed_amount_minor",
			record.agreed_amount_minor,
		),
	};
};

const parseAnnotationAdded = (record: JsonRecord): AnnotationAddedEvent => {
	const label = "annotation.added";
	checkEventKeys(record, label, ["text"], ["attachment_sha256", "target"]);
	const base = readBase(record, label);
	const event: AnnotationAddedEvent = {
		...base,
		type: "annotation.added",
		text: readString(label, "text", record.text),
	};
	if ("attachment_sha256" in record) {
		event.attachment_sha256 = readSha256(
			label,
			"attachment_sha256",
			record.attachment_sha256,
		);
	}
	if ("target" in record) {
		event.target = readString(label, "target", record.target);
	}
	return event;
};

const parseTermsAccepted = (record: JsonRecord): TermsAcceptedEvent => {
	const label = "terms.accepted";
	checkEventKeys(record, label, []);
	const base = requireRole(label, readBase(record, label), "borrower");
	return { ...base, type: "terms.accepted" };
};

const parseTermsDeclined = (record: JsonRecord): TermsDeclinedEvent => {
	const label = "terms.declined";
	checkEventKeys(record, label, []);
	const base = requireRole(label, readBase(record, label), "borrower");
	return { ...base, type: "terms.declined" };
};

const parsePayoffIssued = (record: JsonRecord): PayoffIssuedEvent => {
	const label = "payoff.issued";
	checkEventKeys(record, label, ["as_of", "document_sha256"]);
	const base = requireRole(label, readBase(record, label), "lender");
	return {
		...base,
		type: "payoff.issued",
		as_of: readDate(label, "as_of", record.as_of),
		document_sha256: readSha256(
			label,
			"document_sha256",
			record.document_sha256,
		),
	};
};

const parseReleaseDrafted = (record: JsonRecord): ReleaseDraftedEvent => {
	const label = "release.drafted";
	checkEventKeys(record, label, []);
	const base = requireRole(label, readBase(record, label), "lender");
	return { ...base, type: "release.drafted" };
};

const parseReleaseConfirmed = (record: JsonRecord): ReleaseConfirmedEvent => {
	const label = "release.confirmed";
	checkEventKeys(record, label, ["target"]);
	const base = requireRole(label, readBase(record, label), "lender");
	return {
		...base,
		type: "release.confirmed",
		target: readString(label, "target", record.target),
	};
};

const readCureDays = (label: string, value: unknown): number => {
	if (
		typeof value !== "number" ||
		!Number.isInteger(value) ||
		value < 0 ||
		value > MAX_CURE_DAYS
	) {
		return fail(
			label,
			`cure_days must be an integer from 0 to ${MAX_CURE_DAYS}, got ${show(value)}`,
		);
	}
	return value;
};

const parseNoticeSent = (record: JsonRecord): NoticeSentEvent => {
	const label = "notice.sent";
	checkEventKeys(record, label, ["kind"], ["cure_days"]);
	const base = requireRole(label, readBase(record, label), "lender");
	if (!isOneOf(NOTICE_KINDS, record.kind)) {
		return fail(
			label,
			`kind must be "reminder" or "default", got ${show(record.kind)}`,
		);
	}
	const kind: NoticeKind = record.kind;
	if (kind === "default" && !("cure_days" in record)) {
		fail(label, "cure_days is required when kind is default");
	}
	if (kind === "reminder" && "cure_days" in record) {
		fail(label, "cure_days is not allowed when kind is reminder");
	}
	const event: NoticeSentEvent = { ...base, type: "notice.sent", kind };
	if ("cure_days" in record) {
		event.cure_days = readCureDays(label, record.cure_days);
	}
	return event;
};

const otherRole = (role: Role): Role =>
	role === "lender" ? "borrower" : "lender";

const parsePartyRebound = (record: JsonRecord): PartyReboundEvent => {
	const label = "party.rebound";
	checkEventKeys(record, label, ["role", "contact_commitment"]);
	const base = readBase(record, label);
	const role = readRole(label, "role", record.role);
	const confirmer = otherRole(role);
	if (base.entered_by !== confirmer) {
		fail(
			label,
			`entered_by must be "${confirmer}" (the other party) when role is "${role}", got ${show(base.entered_by)}`,
		);
	}
	return {
		...base,
		type: "party.rebound",
		role,
		contact_commitment: readSha256(
			label,
			"contact_commitment",
			record.contact_commitment,
		),
	};
};

const readGrantAudience = (label: string, value: unknown): GrantAudience => {
	if (!isRecord(value)) {
		return fail(label, `audience must be an object, got ${show(value)}`);
	}
	checkKeys(value, label, "audience.", ["kind", "ref"], []);
	if (!isOneOf(GRANT_AUDIENCE_KINDS, value.kind)) {
		return fail(
			label,
			`audience.kind must be "person", "org" or "link", got ${show(value.kind)}`,
		);
	}
	const kind: GrantAudienceKind = value.kind;
	return { kind, ref: readString(label, "audience.ref", value.ref) };
};

const readGrantLevel = (label: string, value: unknown): GrantLevel => {
	if (!isOneOf(GRANT_LEVELS, value)) {
		return fail(
			label,
			`level must be "summary", "statement" or "verify", got ${show(value)}`,
		);
	}
	return value;
};

const readGrantPurpose = (label: string, value: unknown): GrantPurpose => {
	if (!isOneOf(GRANT_PURPOSES, value)) {
		return fail(
			label,
			`purpose must be "accountant", "lawyer", "court", "assignee" or "other", got ${show(value)}`,
		);
	}
	return value;
};

const readCarveOut = (label: string, value: unknown): boolean => {
	if (typeof value !== "boolean") {
		return fail(label, `carve_out must be true or false, got ${show(value)}`);
	}
	return value;
};

/** A grant ends at most `MAX_GRANT_DAYS` days after the event that proposed it (the same time of day on that date). */
const checkGrantExpiry = (
	label: string,
	enteredAt: string,
	expiresAt: string,
): void => {
	const [enteredDate = "", enteredTime = ""] = enteredAt.split("T");
	const latest = `${addDays(enteredDate, MAX_GRANT_DAYS)}T${enteredTime}`;
	if (compareInstants(expiresAt, enteredAt) <= 0) {
		fail(
			label,
			`expires_at ${expiresAt} must be after entered_at ${enteredAt}`,
		);
	}
	if (compareInstants(expiresAt, latest) > 0) {
		fail(
			label,
			`expires_at ${expiresAt} is more than ${MAX_GRANT_DAYS} days after entered_at ${enteredAt}`,
		);
	}
};

/** The carve-out disclosure reaches one person, at most at statement level, for a stated purpose. */
const checkCarveOut = (
	label: string,
	record: JsonRecord,
	audience: GrantAudience,
	level: GrantLevel,
): void => {
	if (audience.kind !== "person") {
		fail(
			label,
			`a carve_out may only name a person audience, got "${audience.kind}"`,
		);
	}
	if (level === "verify") {
		fail(label, 'a carve_out level must be "summary" or "statement"');
	}
	if (!("purpose" in record)) {
		fail(label, "purpose is required when carve_out is true");
	}
};

const parseVisibilityChanged = (record: JsonRecord): VisibilityChangedEvent => {
	const label = "visibility.changed";
	if (!isOneOf(GRANT_CHANGES, record.change)) {
		return fail(
			label,
			`change must be "grant.proposed", "grant.consented" or "grant.revoked", got ${show(record.change)}`,
		);
	}
	const change = record.change;
	if (change !== "grant.proposed") {
		checkEventKeys(record, label, ["change", "grant_id"]);
		const answered: GrantAnsweredEvent = {
			...readBase(record, label),
			type: "visibility.changed",
			change,
			grant_id: readString(label, "grant_id", record.grant_id),
		};
		return answered;
	}
	checkEventKeys(
		record,
		label,
		["change", "grant_id", "audience", "level", "expires_at"],
		["purpose", "carve_out"],
	);
	const base = readBase(record, label);
	const audience = readGrantAudience(label, record.audience);
	const level = readGrantLevel(label, record.level);
	const expiresAt = readInstant(label, "expires_at", record.expires_at);
	checkGrantExpiry(label, base.entered_at, expiresAt);
	const carveOut =
		"carve_out" in record ? readCarveOut(label, record.carve_out) : undefined;
	if (audience.kind === "link" && level !== "verify") {
		fail(label, `a link audience may only have level "verify", got "${level}"`);
	}
	if (carveOut === true) {
		checkCarveOut(label, record, audience, level);
	}
	const proposed: GrantProposedEvent = {
		...base,
		type: "visibility.changed",
		change,
		grant_id: readString(label, "grant_id", record.grant_id),
		audience,
		level,
		expires_at: expiresAt,
	};
	if ("purpose" in record) {
		proposed.purpose = readGrantPurpose(label, record.purpose);
	}
	if (carveOut !== undefined) {
		proposed.carve_out = carveOut;
	}
	return proposed;
};

const parseApprovalRequested = (record: JsonRecord): ApprovalRequestedEvent => {
	const label = "approval.requested";
	checkEventKeys(record, label, ["action", "target"]);
	const base = readBase(record, label);
	if (!isOneOf(APPROVAL_ACTIONS, record.action)) {
		return fail(
			label,
			`action must be "release.confirm", "notice.default" or "waiver", got ${show(record.action)}`,
		);
	}
	const action: ApprovalAction = record.action;
	return {
		...base,
		type: "approval.requested",
		action,
		target: readString(label, "target", record.target),
	};
};

const parseApprovalGranted = (record: JsonRecord): ApprovalGrantedEvent => {
	const label = "approval.granted";
	checkEventKeys(record, label, ["request"]);
	const base = readBase(record, label);
	return {
		...base,
		type: "approval.granted",
		request: readString(label, "request", record.request),
	};
};

/** Validates one event's shape and returns it typed. Throws an `Error` naming the event type and the field. */
export const parseNoteEvent = (value: unknown): NoteEvent => {
	if (!isRecord(value)) {
		return fail("event", `must be an object, got ${show(value)}`);
	}
	switch (value.type) {
		case "note.created":
			return parseNoteCreated(value);
		case "payment.recorded":
			return parsePaymentRecorded(value);
		case "payment.confirmed":
			return parsePaymentConfirmed(value);
		case "payment.disputed":
			return parsePaymentDisputed(value);
		case "payment.resolved":
			return parsePaymentResolved(value);
		case "annotation.added":
			return parseAnnotationAdded(value);
		case "terms.accepted":
			return parseTermsAccepted(value);
		case "terms.declined":
			return parseTermsDeclined(value);
		case "payoff.issued":
			return parsePayoffIssued(value);
		case "release.drafted":
			return parseReleaseDrafted(value);
		case "release.confirmed":
			return parseReleaseConfirmed(value);
		case "notice.sent":
			return parseNoticeSent(value);
		case "party.rebound":
			return parsePartyRebound(value);
		case "visibility.changed":
			return parseVisibilityChanged(value);
		case "approval.requested":
			return parseApprovalRequested(value);
		case "approval.granted":
			return parseApprovalGranted(value);
		default:
			return fail(
				"event",
				`type must be one of ${EVENT_TYPES.join(", ")}, got ${show(value.type)}`,
			);
	}
};

interface StreamState {
	issueDate: string;
	noteId: string;
	/** Every event id seen so far, with the type and seq that owns it. */
	seen: Map<string, NoteEvent>;
	recorded: Map<string, PaymentRecordedEvent>;
	disputed: Set<string>;
	/** Each reversed payment's id, with the reversal that undoes it (R-9a: at most once). */
	reversedBy: Map<string, PaymentRecordedEvent>;
	drafts: Map<string, ReleaseDraftedEvent>;
	/** Each proposed grant by its `grant_id`. */
	grants: Map<string, GrantProposedEvent>;
	approvalRequests: Map<string, ApprovalRequestedEvent>;
}

function streamFail(event: NoteEvent, message: string): never {
	return fail(event.type, `seq ${event.seq}: ${message}`);
}

/** Resolves `target` to an earlier payment.recorded event, or throws. */
const findRecorded = (
	state: StreamState,
	event: NoteEvent,
	field: string,
	target: string,
): PaymentRecordedEvent => {
	const recorded = state.recorded.get(target);
	if (recorded !== undefined) return recorded;
	const other = state.seen.get(target);
	if (other !== undefined) {
		return streamFail(
			event,
			`${field} ${show(target)} has type ${other.type}, not payment.recorded`,
		);
	}
	return streamFail(
		event,
		`${field} ${show(target)} does not match an earlier payment.recorded event`,
	);
};

/** Resolves `target` to an earlier event of one type, named `typeName`, or throws with what it found instead. */
const findEarlier = <Found extends NoteEvent>(
	state: StreamState,
	event: NoteEvent,
	field: string,
	target: string,
	found: Found | undefined,
	typeName: string,
): Found => {
	if (found !== undefined) return found;
	const other = state.seen.get(target);
	if (other !== undefined) {
		return streamFail(
			event,
			`${field} ${show(target)} has type ${other.type}, not ${typeName}`,
		);
	}
	return streamFail(
		event,
		`${field} ${show(target)} does not match an earlier ${typeName} event`,
	);
};

const checkReleaseConfirmed = (
	state: StreamState,
	event: ReleaseConfirmedEvent,
): void => {
	const draft = findEarlier(
		state,
		event,
		"target",
		event.target,
		state.drafts.get(event.target),
		"release.drafted",
	);
	if (compareInstants(event.entered_at, draft.entered_at) < 0) {
		streamFail(
			event,
			`entered_at ${event.entered_at} is before the ${draft.entered_at} of the draft ${show(draft.id)}`,
		);
	}
};

const checkVisibilityChanged = (
	state: StreamState,
	event: VisibilityChangedEvent,
): void => {
	if (event.change === "grant.proposed") {
		const earlier = state.grants.get(event.grant_id);
		if (earlier !== undefined) {
			streamFail(
				event,
				`grant_id ${show(event.grant_id)} is already proposed by seq ${earlier.seq}`,
			);
		}
		return;
	}
	if (!state.grants.has(event.grant_id)) {
		streamFail(
			event,
			`grant_id ${show(event.grant_id)} does not match an earlier grant.proposed event`,
		);
	}
};

const checkResponder = (
	state: StreamState,
	event: PaymentConfirmedEvent | PaymentDisputedEvent,
	verb: string,
): void => {
	const recorded = findRecorded(state, event, "target", event.target);
	if (recorded.entered_by === event.entered_by) {
		streamFail(
			event,
			`${event.entered_by} cannot ${verb} a payment the ${event.entered_by} recorded (${show(event.target)})`,
		);
	}
};

const checkPaymentRecorded = (
	state: StreamState,
	event: PaymentRecordedEvent,
): void => {
	if (event.value_date < state.issueDate) {
		streamFail(
			event,
			`value_date ${event.value_date} is before issue_date ${state.issueDate}`,
		);
	}
	if (event.reverses === undefined) return;
	const target = findRecorded(state, event, "reverses", event.reverses);
	if (target.kind !== "payment") {
		streamFail(
			event,
			`reverses ${show(event.reverses)} must be a payment, not a ${target.kind}`,
		);
	}
	if (event.amount_minor !== target.amount_minor) {
		streamFail(
			event,
			`a reversal undoes one whole payment: amount_minor ${event.amount_minor} differs from the ${target.amount_minor} of ${show(event.reverses)}`,
		);
	}
	if (event.value_date < target.value_date) {
		streamFail(
			event,
			`value_date ${event.value_date} is before the ${target.value_date} of the payment ${show(event.reverses)} it reverses`,
		);
	}
	const earlier = state.reversedBy.get(target.id);
	if (earlier !== undefined) {
		streamFail(
			event,
			`payment ${show(target.id)} is already reversed by ${show(earlier.id)} (seq ${earlier.seq}); ${show(event.id)} cannot reverse it again`,
		);
	}
};

const checkEventAgainstStream = (
	state: StreamState,
	event: NoteEvent,
): void => {
	switch (event.type) {
		case "note.created":
			return;
		case "payment.recorded":
			checkPaymentRecorded(state, event);
			return;
		case "payment.confirmed":
			checkResponder(state, event, "confirm");
			return;
		case "payment.disputed":
			checkResponder(state, event, "dispute");
			return;
		case "payment.resolved":
			findRecorded(state, event, "target", event.target);
			if (!state.disputed.has(event.target)) {
				streamFail(
					event,
					`target ${show(event.target)} has no earlier payment.disputed event`,
				);
			}
			return;
		case "annotation.added":
			if (event.target !== undefined && !state.seen.has(event.target)) {
				streamFail(
					event,
					`target ${show(event.target)} does not match an earlier event`,
				);
			}
			return;
		case "release.confirmed":
			checkReleaseConfirmed(state, event);
			return;
		case "visibility.changed":
			checkVisibilityChanged(state, event);
			return;
		case "approval.requested":
			if (!state.seen.has(event.target)) {
				streamFail(
					event,
					`target ${show(event.target)} does not match an earlier event`,
				);
			}
			return;
		case "approval.granted":
			findEarlier(
				state,
				event,
				"request",
				event.request,
				state.approvalRequests.get(event.request),
				"approval.requested",
			);
			return;
		default:
			return;
	}
};

const recordInState = (state: StreamState, event: NoteEvent): void => {
	state.seen.set(event.id, event);
	if (event.type === "payment.recorded") {
		state.recorded.set(event.id, event);
		if (event.reverses !== undefined)
			state.reversedBy.set(event.reverses, event);
	}
	if (event.type === "payment.disputed") state.disputed.add(event.target);
	if (event.type === "release.drafted") state.drafts.set(event.id, event);
	if (
		event.type === "visibility.changed" &&
		event.change === "grant.proposed"
	) {
		state.grants.set(event.grant_id, event);
	}
	if (event.type === "approval.requested") {
		state.approvalRequests.set(event.id, event);
	}
};

const orderBySeq = (events: NoteEvent[]): NoteEvent[] => {
	const ordered = [...events].sort((left, right) => left.seq - right.seq);
	for (const [index, event] of ordered.entries()) {
		const previous = ordered[index - 1];
		if (previous !== undefined && previous.seq === event.seq) {
			fail("stream", `seq ${event.seq} is repeated`);
		}
		if (event.seq !== index + FIRST_SEQ) {
			fail(
				"stream",
				`seq has a gap: expected ${index + FIRST_SEQ}, found ${event.seq}`,
			);
		}
	}
	return ordered;
};

/**
 * Parses every event, orders them by `seq`, and enforces the stream rules. Returns the events in `seq` order, so the
 * same events in any input order give the same result (AC-3). Throws an `Error` on the first violation.
 */
export const validateStream = (events: unknown[]): NoteEvent[] => {
	if (events.length === 0) fail("stream", "must contain at least one event");
	const parsed: NoteEvent[] = [];
	for (const [index, value] of events.entries()) {
		try {
			parsed.push(parseNoteEvent(value));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(`events[${index}]: ${message}`);
		}
	}
	const ordered = orderBySeq(parsed);
	const [first] = ordered;
	if (first === undefined || first.type !== "note.created") {
		return fail("stream", "the first event (seq 1) must be note.created");
	}
	const state: StreamState = {
		issueDate: first.terms.issue_date,
		noteId: first.note_id,
		seen: new Map(),
		recorded: new Map(),
		disputed: new Set(),
		reversedBy: new Map(),
		drafts: new Map(),
		grants: new Map(),
		approvalRequests: new Map(),
	};
	for (const event of ordered) {
		if (event.note_id !== state.noteId) {
			streamFail(
				event,
				`note_id ${show(event.note_id)} differs from ${show(state.noteId)}`,
			);
		}
		if (event !== first && event.type === "note.created") {
			streamFail(event, "note.created is only allowed as the first event");
		}
		const owner = state.seen.get(event.id);
		if (owner !== undefined) {
			streamFail(
				event,
				`id ${show(event.id)} is already used by seq ${owner.seq}`,
			);
		}
		checkEventAgainstStream(state, event);
		recordInState(state, event);
	}
	return ordered;
};
