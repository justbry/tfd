import {
	type DifferenceItem,
	type NoteEvent,
	type NoteTerms,
	PAYOFF_WORDING,
	RELEASE_WORDING,
	type Role,
	type ScheduleRow,
	statusLabel,
} from "tfd-notes";
import { ACTION_LABELS, type OrgNoteView } from "./approvals-view";
import { confirmedByWording } from "./masking";
import type { AgentRole } from "./org";
import type { NoteView, ViewDocument } from "./service";

/**
 * Server-rendered pages for the guest flow (docs/specs/promissory-notes.md build step 2). No framework, no script and
 * no inline style: the one stylesheet is served from this Worker (`/n/assets/notes.css`), so the CSP can say
 * `style-src 'self'` and `script-src` is absent (`default-src 'none'`). Every dynamic string goes through `escapeHtml`
 * (the `html` template does it for each interpolation), and money is formatted from minor units with the exponent,
 * never through a float. Wording follows AGENTS.md: a record, with no claim that it settles anything; "confirmed by the holder of <masked email>",
 * never "signed"; "installments".
 */

export const NOTES_CSP =
	"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'";

export const NOTES_STYLESHEET_PATH = "/n/assets/notes.css";

const ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

const ESCAPABLE = /[&<>"']/g;

/** Escapes text for HTML content and for a double- or single-quoted attribute value. */
export const escapeHtml = (text: string): string =>
	text.replace(ESCAPABLE, (char) => ESCAPES[char] ?? char);

/** Markup that is already safe: built by `html` from escaped parts, or written here as a literal. */
export class Safe {
	constructor(readonly value: string) {}
}

const renderPart = (part: unknown): string => {
	if (part instanceof Safe) return part.value;
	if (Array.isArray(part)) return part.map(renderPart).join("");
	if (part === null || part === undefined || part === false) return "";
	return escapeHtml(String(part));
};

/** Tagged template: every interpolated value is escaped unless it is `Safe` (another `html` result) or a list of them. */
export const html = (
	strings: TemplateStringsArray,
	...parts: unknown[]
): Safe => {
	let out = "";
	for (const [index, text] of strings.entries()) {
		out += text;
		if (index < parts.length) out += renderPart(parts[index]);
	}
	return new Safe(out);
};

const DIGITS = /^\d+$/;
const AMOUNT = /^\d{1,15}(?:\.\d+)?$/;
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;
const LEADING_ZEROS = /^0+(?=\d)/;
const TRAILING_ZEROS = /0+$/;
const PERCENT_DIGITS = 2;

/** `"35000"` with exponent 2 is `350.00`; `"-1250"` is `-12.50`. Digits only in, a string out: no float on the way. */
export const formatAmount = (minor: string, exponent: number): string => {
	const negative = minor.startsWith("-");
	const digits = negative ? minor.slice(1) : minor;
	if (!DIGITS.test(digits)) return "?";
	const padded = digits.padStart(exponent + 1, "0");
	const whole = padded.slice(0, padded.length - exponent);
	const fraction = padded.slice(padded.length - exponent);
	const grouped = whole.replace(LEADING_ZEROS, "").replace(THOUSANDS, ",");
	const text = exponent === 0 ? grouped : `${grouped}.${fraction}`;
	return negative ? `-${text}` : text;
};

/**
 * Reads what a person typed (`350`, `350.5`, `350.50`) into minor units for a note with `exponent` decimal places:
 * `"35000"` for exponent 2. Null when it is not a plain amount or has more decimals than the note allows.
 */
export const parseAmount = (text: string, exponent: number): string | null => {
	const trimmed = text.trim();
	if (!AMOUNT.test(trimmed)) return null;
	const [whole = "", fraction = ""] = trimmed.split(".");
	if (fraction.length > exponent) return null;
	const digits = `${whole}${fraction.padEnd(exponent, "0")}`.replace(
		LEADING_ZEROS,
		"",
	);
	return digits;
};

/** `"0.0525"` is `5.25%`; `"0"` is `0%`. String arithmetic only. */
export const ratePercent = (rate: string): string => {
	const [whole = "0", fraction = ""] = rate.split(".");
	const padded = fraction.padEnd(PERCENT_DIGITS, "0");
	const percentWhole = `${whole}${padded.slice(0, PERCENT_DIGITS)}`.replace(
		LEADING_ZEROS,
		"",
	);
	const percentFraction = padded
		.slice(PERCENT_DIGITS)
		.replace(TRAILING_ZEROS, "");
	return `${percentWhole}${percentFraction === "" ? "" : `.${percentFraction}`}%`;
};

const FOOTER = "A record, not legal or tax advice.";

export const layout = (title: string, body: Safe): string =>
	html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="stylesheet" href="${NOTES_STYLESHEET_PATH}">
</head>
<body>
<main>
${body}
</main>
<footer><p class="muted">${FOOTER}</p></footer>
</body>
</html>
`.value;

export type Notice = { kind: "ok" | "error"; text: string };

export const noticeBlock = (notice: Notice | undefined): Safe =>
	notice
		? html`<p class="notice ${notice.kind}" role="${notice.kind === "error" ? "alert" : "status"}">${notice.text}</p>`
		: html``;

/** The fixed messages `?m=` may show after a redirect: a key, never reflected text. */
export const FLASH_MESSAGES: Record<string, string> = {
	entered: "You are in. This page is the shared record of the loan.",
	recorded: "Saved. The record has a new entry.",
	release_drafted:
		"Saved. A release is drafted. It can be confirmed after the cooling-off.",
	release_confirmed:
		"Saved. The release is confirmed and its document is listed below.",
	notice_sent: "Saved. The notice is recorded and the borrower was emailed.",
	notice_unmailed:
		"Saved. The notice is recorded, but the email to the borrower could not be sent.",
	approval_requested:
		"Saved. The approval is asked for. A board member other than you must approve it.",
	approval_granted: "Saved. The approval is recorded.",
	share_proposed:
		"Saved. The share is waiting for the other party to agree. Nothing was sent to the recipient yet.",
	share_disclosed:
		"Saved. The disclosure is recorded and listed for the other party. The recipient was emailed a link.",
	share_unmailed:
		"Saved. The share is recorded, but the link could not be emailed. Use Send the link again.",
	share_consented:
		"Saved. You agreed to the share. If it names a person, they were emailed a link.",
	share_revoked: "Saved. The share has ended.",
	share_resent:
		"Saved. A new link was emailed. The earlier link no longer works.",
	share_link_proposed:
		"Saved. The verify link is waiting for the other party to agree. Its token is shown once, after that.",
};

/** The sign-in page a link opens. It shows a button and redeems nothing: mail scanners fetch links, a person presses. */
export const enterPage = (noteId: string, token: string | null): string =>
	layout(
		"Open the loan record",
		html`<h1>Open the loan record</h1>
<p>Someone started a loan record and named you in it. Press the button to open it. Your link works once.</p>
<form method="post" action="/n/${noteId}/enter">
<input type="hidden" name="t" value="${token ?? ""}">
<button type="submit">Open the record</button>
</form>
${linkRequestForm(noteId, "Link not working or already used?")}`,
	);

const linkRequestForm = (noteId: string, heading: string): Safe =>
	html`<section>
<h2>${heading}</h2>
<p class="muted">Enter the email address this record was sent to and we will send a new link, if it matches.</p>
<form method="post" action="/n/${noteId}/link">
<label>Email address <input type="email" name="email" autocomplete="email" required></label>
<button type="submit">Send a new link</button>
</form>
</section>`;

export const invalidLinkPage = (noteId: string): string =>
	layout(
		"Link not valid",
		html`<h1>This link did not work</h1>
<p>It may have been used already or may have expired.</p>
${linkRequestForm(noteId, "Get a new link")}`,
	);

/** The answer to a request for a new link: the same text whether or not the address matched. */
export const linkRequestedPage = (): string =>
	layout(
		"Check your email",
		html`<h1>Check your email</h1>
<p>If that address is on this record, a new link is on its way.</p>`,
	);

export const messagePage = (title: string, text: string): string =>
	layout(title, html`<h1>${title}</h1><p>${text}</p>`);

export const signInRequiredPage = (noteId: string): string =>
	layout(
		"Sign in again",
		html`<h1>Sign in again</h1>
<p>Your session ended. Use the link from your email, or ask for a new one.</p>
${linkRequestForm(noteId, "Get a new link")}`,
	);

/** What a person sees after ending their session. */
export const signedOutPage = (): string =>
	layout(
		"Signed out",
		html`<h1>You are signed out.</h1>
<p>Use the link from your email to come back, or ask for a new one on the sign-in page.</p>`,
	);

const roleName = (role: Role): string =>
	role === "lender" ? "Lender" : "Borrower";

export const hiddenFields = (fields: Record<string, string>): Safe =>
	html`${Object.entries(fields).map(
		([name, value]) =>
			html`<input type="hidden" name="${name}" value="${value}">`,
	)}`;

/** The step-up page: the code field, and the action's own fields carried along as hidden inputs. */
export const codePage = (input: {
	noteId: string;
	csrf: string;
	type: string;
	fields: Record<string, string>;
	notice?: Notice;
	/** The path under `/n/:id/` the code is posted to together with the carried fields. Default `act`. */
	submitTo?: string;
	/** The note's page path for an organization agent (`/o/:orgId/n/:id`); default `/n/:id`. */
	basePath?: string;
}): string =>
	layout(
		"Enter your code",
		html`<h1>Enter your code</h1>
${noticeBlock(input.notice)}
<p>This step needs a code. We emailed a 6-digit code to the address on this record. It works once, for ten minutes.</p>
<form method="post" action="${input.basePath ?? `/n/${input.noteId}`}/${input.submitTo ?? "act"}">
<input type="hidden" name="csrf" value="${input.csrf}">
<input type="hidden" name="type" value="${input.type}">
${hiddenFields(input.fields)}
<label>Code <input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required></label>
<button type="submit">Continue</button>
</form>
<form method="post" action="${input.basePath ?? `/n/${input.noteId}`}/code">
<input type="hidden" name="csrf" value="${input.csrf}">
<input type="hidden" name="type" value="${input.type}">
${hiddenFields(input.fields)}
<button type="submit" class="secondary">Send a new code</button>
</form>`,
	);

const money = (minor: string, view: NoteView): string =>
	`${formatAmount(minor, view.terms.exponent)} ${view.terms.currency}`;

const scheduleText = (terms: NoteTerms): string => {
	const { schedule } = terms;
	if (schedule.type === "none") return "No fixed schedule";
	if (schedule.type === "custom")
		return `${schedule.installments.length} installments on set dates`;
	return `${schedule.count} ${schedule.frequency} installments from ${schedule.first_due}`;
};

const termsStateText = (view: NoteView): string => {
	if (view.state.terms === "accepted")
		return `accepted, ${confirmedByWording(view.masked.borrower)}`;
	if (view.state.terms === "declined")
		return `declined, ${confirmedByWording(view.masked.borrower)}`;
	return "proposed, waiting for the borrower";
};

const balanceColumn = (view: NoteView, role: Role): Safe => {
	const balance = view.statement[role];
	const you = view.role === role;
	return html`<section class="balance ${you ? "you" : ""}" aria-label="${roleName(role)}'s count">
<h3>${roleName(role)}'s count${you ? " (you)" : ""}</h3>
<dl>
<dt>Owed now</dt><dd class="num">${money(balance.payoff_minor, view)}</dd>
<dt>Principal</dt><dd class="num">${money(balance.principal_minor, view)}</dd>
<dt>Interest</dt><dd class="num">${money(balance.interest_minor, view)}</dd>
<dt>Counted as paid</dt><dd class="num">${money(balance.paid_minor, view)}</dd>
</dl>
</section>`;
};

const differenceRow = (item: DifferenceItem, view: NoteView): Safe =>
	html`<tr>
<td>${item.value_date}</td>
<td>${statusLabel(item.status)}</td>
<td class="num">${money(item.lender_counts_minor, view)}</td>
<td class="num">${money(item.borrower_counts_minor, view)}</td>
<td class="num">${money(item.difference_minor, view)}</td>
<td>${item.unanswered_days === null ? "" : `unanswered ${item.unanswered_days} days`}${item.reason ? ` Reason: ${item.reason}` : ""}</td>
</tr>`;

const differenceBlock = (view: NoteView): Safe => {
	const { difference, payoff_gap_minor: gap } = view.statement;
	if (difference.length === 0) return html`<p>The two counts agree.</p>`;
	return html`<p>The two counts differ by <span class="num">${money(gap, view)}</span> in what is owed. These payments are counted differently:</p>
<table>
<thead><tr><th>Date</th><th>Status</th><th>Lender counts</th><th>Borrower counts</th><th>Difference</th><th>Note</th></tr></thead>
<tbody>${difference.map((item) => differenceRow(item, view))}</tbody>
</table>`;
};

const scheduleRow = (row: ScheduleRow, view: NoteView): Safe =>
	html`<tr><td>${row.n}</td><td>${row.due}</td><td class="num">${money(row.payment_minor, view)}</td><td class="num">${money(row.interest_minor, view)}</td><td class="num">${money(row.principal_minor, view)}</td><td class="num">${money(row.balance_after_minor, view)}</td></tr>`;

const scheduleBlock = (view: NoteView): Safe => {
	const { schedule } = view.statement;
	if (schedule.length === 0) return html`<p>${scheduleText(view.terms)}.</p>`;
	return html`<p>${scheduleText(view.terms)}.</p>
<table>
<thead><tr><th>#</th><th>Due</th><th>Installment</th><th>Interest</th><th>Principal</th><th>Balance after</th></tr></thead>
<tbody>${schedule.map((row) => scheduleRow(row, view))}</tbody>
</table>`;
};

/** Who entered an event, by side. An organization lender is "the lender's team": no agent is named or identified. */
const actorName = (view: NoteView, role: Role): string =>
	role === "lender" && view.lenderIsOrg ? "The lender's team" : roleName(role);

const confirmerOf = (view: NoteView, role: Role): string =>
	role === "lender" && view.lenderIsOrg
		? "entered by the lender's team"
		: confirmedByWording(view.masked[role]);

const visibilityLine = (
	event: Extract<NoteEvent, { type: "visibility.changed" }>,
	who: string,
): string => {
	if (event.change !== "grant.proposed")
		return event.change === "grant.consented"
			? `${who} agreed to a share.`
			: `${who} ended a share.`;
	const audience =
		event.audience.kind === "link" ? "a verify link" : "a named person";
	if (event.carve_out === true)
		return `${who} recorded a disclosure to ${audience}. It is listed in the disclosure log.`;
	return `${who} proposed sharing a ${event.level} view with ${audience}.`;
};

const eventLine = (event: NoteEvent, view: NoteView): string => {
	const who = actorName(view, event.entered_by);
	const confirmer = confirmerOf(view, event.entered_by);
	switch (event.type) {
		case "note.created":
			return "Loan record started by the lender.";
		case "terms.accepted":
			return `Terms accepted, ${confirmer}.`;
		case "terms.declined":
			return `Terms declined ("not my loan"), ${confirmer}.`;
		case "payment.recorded": {
			const detail = [event.method, event.reference]
				.filter((part) => part !== undefined)
				.join(", ");
			const label = event.kind === "reversal" ? "a reversal" : "a payment";
			return `${who} recorded ${label} of ${money(event.amount_minor, view)} dated ${event.value_date}${detail ? ` (${detail})` : ""}.`;
		}
		case "payment.confirmed":
			return `${who} confirmed a payment, ${confirmer}.`;
		case "payment.disputed":
			return `${who} disputed a payment and counts ${money(event.counter_amount_minor, view)}. Reason: ${event.reason}`;
		case "payment.resolved":
			return `${who} agreed an amount of ${money(event.agreed_amount_minor, view)} for a disputed payment, ${confirmer}.`;
		case "annotation.added":
			return `${who} added a note: ${event.text}`;
		case "payoff.issued":
			return `${who} issued a payoff statement as of ${event.as_of}.`;
		case "release.drafted":
			return `${who} drafted a release. A draft changes no balance.`;
		case "release.confirmed":
			return `${RELEASE_WORDING} Confirmed by the lender, ${confirmer}. A release changes no balance.`;
		case "notice.sent":
			return `${who} recorded ${event.kind === "default" ? `a default notice with ${event.cure_days} days to cure` : "a reminder"}. A notice changes no balance.`;
		case "approval.requested":
			return `${who} asked for a second person to approve ${ACTION_LABELS[event.action]}.`;
		case "approval.granted":
			return `${who} approved a request. A second person has agreed to it.`;
		case "visibility.changed":
			return visibilityLine(event, who);
		default:
			return `${who} entered ${event.type}.`;
	}
};

export const DOCUMENT_LABELS: Record<ViewDocument["type"], string> = {
	"note.payment-receipt": "Payment receipt",
	"note.payoff-statement": "Payoff statement",
	"note.release": "Release",
	"note.chain-seal": "Chain seal",
};

/** A payment's receipt: a link when one was issued, else a button that issues it (a GET never writes). */
const receiptControl = (
	view: NoteView,
	csrf: string,
	event: NoteEvent,
): Safe => {
	if (event.type !== "payment.recorded") return html``;
	const issued = view.documents.find(
		(document) =>
			document.type === "note.payment-receipt" && document.eventId === event.id,
	);
	if (issued)
		return html` <a href="${view.basePath}/docs/${issued.id}">Receipt</a>`;
	return html` <form class="inline" method="post" action="${view.basePath}/receipt">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="event" value="${event.id}">
<button type="submit" class="link">Receipt</button>
</form>`;
};

/**
 * What the borrower reads in the history: everything except the lender's internal approvals. Who asked a second person
 * to approve a step is the lender's own business, so those entries are left out of the borrower's page (they stay in the
 * chain and in the downloadable file, which a verifier needs whole).
 */
const shownEvents = (view: NoteView): NoteEvent[] =>
	view.role === "borrower"
		? view.events.filter((event) => !event.type.startsWith("approval."))
		: view.events;

const historyBlock = (view: NoteView, csrf: string): Safe =>
	html`<ol class="history">${shownEvents(view).map(
		(event) =>
			html`<li><span class="muted">${event.entered_at.slice(0, 10)}, by email link</span> ${eventLine(event, view)}${receiptControl(view, csrf, event)}</li>`,
	)}</ol>`;

const chainText = (view: NoteView): string => {
	if (view.chain.ok) {
		const count = view.events.length;
		return `Record check: ${count} ${count === 1 ? "entry" : "entries"}, each linked to the one before.`;
	}
	return `Record check failed (${view.chain.reason}${view.chain.seq === undefined ? "" : ` at entry ${view.chain.seq}`}). Do not rely on this page.`;
};

const actionForm = (
	view: NoteView,
	csrf: string,
	type: string,
	fields: Record<string, string>,
	body: Safe,
): Safe =>
	html`<form method="post" action="${view.basePath}/act">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="type" value="${type}">
${hiddenFields(fields)}
${body}
</form>`;

const paymentOf = (view: NoteView, eventId: string) =>
	view.events.find(
		(event) => event.id === eventId && event.type === "payment.recorded",
	);

const needsItem = (
	view: NoteView,
	csrf: string,
	item: NoteView["needsYou"][number],
): Safe => {
	if (item.kind === "accept_terms")
		return html`<li><p>Read the terms above. Do you accept them as written?</p>
${actionForm(view, csrf, "terms.accepted", {}, html`<button type="submit">Accept these terms</button> <span class="muted">We email you a code first.</span>`)}
${actionForm(view, csrf, "terms.declined", {}, html`<button type="submit" class="secondary">Not my loan</button>`)}</li>`;
	const payment = item.eventId ? paymentOf(view, item.eventId) : undefined;
	if (!(item.eventId && payment?.type === "payment.recorded")) return html``;
	const summary = `${roleName(payment.entered_by)} recorded ${money(payment.amount_minor, view)} dated ${payment.value_date}`;
	const target = { target: item.eventId };
	if (item.kind === "answer_payment")
		return html`<li><p>${summary}. Is that right?</p>
${actionForm(view, csrf, "payment.confirmed", target, html`<button type="submit">Confirm this payment</button>`)}
${actionForm(
	view,
	csrf,
	"payment.disputed",
	target,
	html`<fieldset><legend>Or dispute it (we email you a code first)</legend>
<label>Amount you say it was <input name="counter_amount" inputmode="decimal" required></label>
<label>Reason <input name="reason" maxlength="500" required></label>
<button type="submit" class="secondary">Dispute</button></fieldset>`,
)}</li>`;
	return html`<li><p>${summary} is disputed. Say what amount you agree on.</p>
${actionForm(
	view,
	csrf,
	"payment.resolved",
	target,
	html`<label>Agreed amount <input name="agreed_amount" inputmode="decimal" required></label>
<button type="submit">Agree this amount</button> <span class="muted">We email you a code first. It takes effect when both of you have entered the same amount.</span>`,
)}</li>`;
};

/** An organization viewer reads and never changes the record. Everyone else with a session may act. */
const canAct = (view: NoteView): boolean => view.org?.agentRole !== "viewer";

const VIEWER_NOTE =
	"Your role is viewer: you can read this record but not change it.";

const needsBlock = (view: NoteView, csrf: string): Safe => {
	if (view.needsYou.length === 0)
		return html`<p>Nothing is waiting for you.</p>`;
	if (!canAct(view)) return html`<p>${VIEWER_NOTE}</p>`;
	return html`<ul class="needs">${view.needsYou.map((item) => needsItem(view, csrf, item))}</ul>`;
};

const recordForms = (view: NoteView, csrf: string): Safe =>
	canAct(view)
		? recordFormsBody(view, csrf)
		: html`<h2>Record a payment</h2><p>${VIEWER_NOTE}</p>`;

const recordFormsBody = (view: NoteView, csrf: string): Safe =>
	html`<h2>Record a payment</h2>
${actionForm(
	view,
	csrf,
	"payment.recorded",
	{ kind: "payment" },
	html`<label>Amount (${view.terms.currency}, ${view.terms.exponent} decimal places) <input name="amount" inputmode="decimal" required></label>
<label>Date paid <input type="date" name="value_date" required></label>
<label>Method <input name="method" maxlength="100"></label>
<label>Reference <input name="reference" maxlength="200"></label>
<button type="submit">Record this payment</button>
<p class="muted">The other side sees it straight away and can confirm or dispute it. Until they confirm, it is shown as claimed.</p>`,
)}
<h2>Add a note</h2>
<p class="muted">Both of you can read notes. They change no number.</p>
${actionForm(
	view,
	csrf,
	"annotation.added",
	{},
	html`<label>Note <textarea name="text" maxlength="1000" rows="3" required></textarea></label>
<button type="submit" class="secondary">Add note</button>`,
)}`;

const draftedAt = (instant: string): string =>
	`${instant.slice(0, 16).replace("T", " ")} UTC`;

const releaseBanner = (view: NoteView): Safe => {
	const { release } = view;
	if (view.state.closed) {
		const lender = view.statement.lender.payoff_minor;
		return html`<p class="banner" role="status">${RELEASE_WORDING}</p>
<p>${lender === "0" ? "The lender's count shows nothing owed." : `The lender's count of what is owed is ${money(lender, view)} and the borrower's is ${money(view.statement.borrower.payoff_minor, view)}.`} A release changes no balance. Both counts stay below.</p>`;
	}
	if (release.reopened)
		return html`<p class="banner" role="status">A release was recorded earlier. A later reversal reopened this note, so it is not released now.</p>`;
	return html``;
};

const ROLE_WORDS: Record<AgentRole, string> = {
	treasurer: "a treasurer",
	board: "a board member",
	viewer: "a viewer",
};

const APPROVAL_WAITING =
	"Waiting for approval from a board member other than the person who asked.";

/** The request and approve controls for the release that is drafted. Only an organization lender has them. */
const releaseApprovalControls = (
	view: NoteView,
	csrf: string,
	draftId: string,
): Safe => {
	const approval = view.org?.releaseApproval;
	if (!approval) return html``;
	if (approval.status === "none")
		return html`<form method="post" action="${view.basePath}/request">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="action" value="release.confirm">
<input type="hidden" name="target" value="${draftId}">
<button type="submit" class="secondary">Ask for approval</button> <span class="muted">A second person, a board member, must approve before the release can be confirmed.</span>
</form>`;
	if (approval.status === "satisfied")
		return html`<p>Approved: a second person has agreed to this release.</p>`;
	return html`<p>${APPROVAL_WAITING}</p>${approveForm(view, csrf, approval)}`;
};

const approveForm = (
	view: NoteView,
	csrf: string,
	row: { requestId: string | null; mine: boolean; approvedByYou: boolean },
): Safe => {
	if (row.requestId === null) return html``;
	if (row.mine)
		return html`<p class="muted">You asked for this approval, so another board member must give it.</p>`;
	if (row.approvedByYou)
		return html`<p class="muted">You already approved this request.</p>`;
	if (view.org?.agentRole !== "board")
		return html`<p class="muted">Only a board member can approve.</p>`;
	return html`<form method="post" action="${view.basePath}/approve">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="request_id" value="${row.requestId}">
<button type="submit">Approve</button>
</form>`;
};

const releaseSection = (view: NoteView, csrf: string): Safe => {
	const { draft } = view.release;
	const intro = html`<p class="muted">A release is the lender's statement that the note is released. It does not change the balance. It is confirmed in two steps, with a cooling-off between them and a code we email.${view.org ? " Because the lender is an organization, a second person must also approve it." : ""}</p>`;
	if (draft !== null) {
		const when = html`<p>A release was drafted ${draftedAt(draft.enteredAt)}. It can be confirmed from ${draftedAt(draft.confirmableAt)}.</p>`;
		if (view.role !== "lender") return html`<h2>Release</h2>${when}`;
		if (!canAct(view))
			return html`<h2>Release</h2>${when}<p>${VIEWER_NOTE}</p>`;
		const approved = view.org?.releaseApproval?.status === "satisfied";
		const blocked = view.org !== null && !approved;
		return html`<h2>Release</h2>${intro}${when}
${releaseApprovalControls(view, csrf, draft.id)}
<form method="post" action="${view.basePath}/release">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="step" value="confirm">
<input type="hidden" name="target" value="${draft.id}">
<button type="submit" ${blocked ? "disabled" : ""}>Confirm the release</button> <span class="muted">${blocked ? "Disabled until a second person approves." : "We email you a code first."}</span>
</form>`;
	}
	if (view.role !== "lender" || view.state.closed) return html``;
	if (!canAct(view)) return html`<h2>Release</h2><p>${VIEWER_NOTE}</p>`;
	return html`<h2>Release</h2>${intro}
<form method="post" action="${view.basePath}/release">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="step" value="draft">
<button type="submit" class="secondary">Draft a release</button>
</form>`;
};

const noticeForms = (view: NoteView, csrf: string): Safe => {
	if (view.org === null)
		return html`<form method="post" action="${view.basePath}/notice">
<input type="hidden" name="csrf" value="${csrf}">
<label>Kind <select name="kind"><option value="reminder">Reminder</option><option value="default">Default notice</option></select></label>
<label>Days to cure (default notice only, 0 to 365) <input type="number" name="cure_days" min="0" max="365" step="1"></label>
<button type="submit" class="secondary">Record the notice</button>
</form>`;
	const ready = view.org.approvedNotices;
	const approved = ready.length > 0;
	const readyText = ready
		.map((notice) => `${notice.cureDays} days to cure`)
		.join(", ");
	return html`<form method="post" action="${view.basePath}/notice">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="kind" value="reminder">
<button type="submit" class="secondary">Record a reminder</button>
</form>
<form method="post" action="${view.basePath}/notice">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="kind" value="default">
<label>Days to cure (0 to 365) <input type="number" name="cure_days" min="0" max="365" step="1" required></label>
<button type="submit" class="secondary" ${approved ? "" : "disabled"}>Record a default notice</button> <span class="muted">${approved ? `Approved and ready: ${readyText}. Each approval covers one default notice, with the days to cure it was asked for.` : "Disabled until a second person approves it: ask for approval under Approvals below."}</span>
</form>`;
};

/** Shown to the lender's side in place of the payoff and notice forms while the borrower's decline stands. */
export const DECLINED_NOTICE =
	"The borrower said this is not their loan. Payments and notes can still be recorded; payoff statements and notices are paused.";

const lenderForms = (view: NoteView, csrf: string): Safe => {
	if (view.role !== "lender") return html``;
	if (!canAct(view)) return html``;
	if (view.state.terms === "declined")
		return html`<h2>Payoff statement and notices</h2>
<p class="notice" role="status">${DECLINED_NOTICE}</p>`;
	return html`<h2>Payoff statement</h2>
<p class="muted">A statement of both counts on a date, issued as a file you can keep. It changes no balance.</p>
<form method="post" action="${view.basePath}/payoff">
<input type="hidden" name="csrf" value="${csrf}">
<label>As of <input type="date" name="as_of" value="${view.asOf}" required></label>
<button type="submit" class="secondary">Issue a payoff statement</button>
</form>
<h2>Notice</h2>
<p class="muted">This records a notice. It does not change the balance. The borrower is emailed that a notice was recorded. A default notice needs a code we email you.</p>
${noticeForms(view, csrf)}`;
};

const approvalRowText = (row: OrgNoteView["requests"][number]): string => {
	const state = row.satisfied ? "approved" : "waiting for approval";
	const cure = row.cureDays === null ? "" : ` (${row.cureDays} days to cure)`;
	return `${ACTION_LABELS[row.action]}${cure} for ${row.label}, asked ${row.requestedAt.slice(0, 10)}: ${state}.`;
};

const requestForm = (view: NoteView, csrf: string, org: OrgNoteView): Safe => {
	if (org.agentRole === "viewer") return html`<p>${VIEWER_NOTE}</p>`;
	return html`<form method="post" action="${view.basePath}/request">
<input type="hidden" name="csrf" value="${csrf}">
<label>For <select name="action"><option value="notice.default">A default notice</option><option value="waiver">A waiver</option></select></label>
<label>About <select name="target">${org.targets.map((target) => html`<option value="${target.id}">${target.label}</option>`)}</select></label>
<label>Days to cure (for a default notice, 0 to 365) <input type="number" name="cure_days" min="0" max="365" step="1"></label>
<button type="submit" class="secondary">Ask for approval</button>
<p class="muted">Name the note that drafts the text, or the start of the record. A default notice is approved for the days to cure you enter here, and that is the only notice the approval covers. A release is asked for in its own section.</p>
</form>`;
};

/** The approvals panel of an organization agent: what is asked and approved, the Approve buttons, and the request form. */
const approvalsSection = (view: NoteView, csrf: string): Safe => {
	const { org } = view;
	if (org === null) return html``;
	return html`<h2>Approvals</h2>
<p class="muted">Confirming a release, sending a default notice and a waiver each need a request from one person on the team and an approval from a different board member. A waiver records the approval only: this record has no step that forgives money, and it changes no balance.</p>
${
	org.requests.length === 0
		? html`<p>Nothing has been asked for yet.</p>`
		: html`<ul>${org.requests.map(
				(row) =>
					html`<li>${approvalRowText(row)}${row.satisfied ? html`` : approveForm(view, csrf, row)}</li>`,
			)}</ul>`
}
${requestForm(view, csrf, org)}`;
};

const documentsSection = (view: NoteView): Safe =>
	html`<h2>Issued documents</h2>
${
	view.documents.length === 0
		? html`<p>No document has been issued yet.</p>`
		: html`<ul>${view.documents.map(
				(document) =>
					html`<li><a href="${view.basePath}/docs/${document.id}">${DOCUMENT_LABELS[document.type]}</a> <span class="muted">issued ${document.createdAt.slice(0, 10)}</span></li>`,
			)}</ul>`
}
<p class="muted"><a href="${view.basePath}/bundle.json">Download the whole record</a> (events, links, documents and the latest seal) to check it offline with tfd-verify-notes and the published public keys.</p>`;

const youText = (view: NoteView): string =>
	view.org
		? `You are on the lender's team as ${ROLE_WORDS[view.org.agentRole]}.`
		: `You are the ${view.role}.`;

/** The sign-out button: ends this session on the server (an agent's is the organization session, so it posts there). */
const logoutForm = (view: NoteView, csrf: string): Safe =>
	html`<form class="inline" method="post" action="${view.org ? `/o/${view.org.orgId}/logout` : `${view.basePath}/logout`}">
<input type="hidden" name="csrf" value="${csrf}">
<button type="submit" class="link">Sign out</button>
</form>`;

/** The shared record: both counts side by side, the itemised difference, the schedule, and what needs this party. */
export const notePage = (
	view: NoteView,
	csrf: string,
	notice?: Notice,
	/** The sharing panel (`share-pages.ts`), passed in so this file does not import it. */
	sharing: Safe = html``,
): string => {
	const { terms } = view;
	return layout(
		"Loan record",
		html`<h1>Loan record</h1>
${noticeBlock(notice)}
<p class="muted">${youText(view)} As of ${view.asOf}.</p>
${logoutForm(view, csrf)}
${view.org ? html`<p class="muted"><a href="/o/${view.org.orgId}">All of the organization's notes</a></p>` : html``}
${view.lenderIsOrg && !view.org ? html`<p class="muted">The lender is an organization. Its team acts through people it registered; their addresses are not shown here.</p>` : html``}
${releaseBanner(view)}
<section>
<h2>Terms</h2>
<ul>
<li>Amount lent: <span class="num">${money(terms.principal_minor, view)}</span> on ${terms.issue_date}</li>
<li>Yearly rate: ${ratePercent(terms.annual_rate)}, simple interest</li>
<li>Terms: ${termsStateText(view)}</li>
<li>Closed: ${view.state.closed ? "yes" : "no"}</li>
</ul>
</section>
<section>
<h2>Needs you</h2>
${needsBlock(view, csrf)}
</section>
<section>
<h2>Where each side stands</h2>
<div class="balances">${balanceColumn(view, "lender")}${balanceColumn(view, "borrower")}</div>
${differenceBlock(view)}
</section>
<section>
<h2>Installments</h2>
${scheduleBlock(view)}
</section>
<section>
${recordForms(view, csrf)}
</section>
<section>
${releaseSection(view, csrf)}
${lenderForms(view, csrf)}
</section>
${view.org ? html`<section>${approvalsSection(view, csrf)}</section>` : html``}
<section>
${documentsSection(view)}
</section>
${sharing}
<section>
<h2>History</h2>
${historyBlock(view, csrf)}
<p class="muted">${chainText(view)}</p>
</section>`,
	);
};

const textOf = (document: Record<string, unknown>, name: string): string => {
	const value = document[name];
	if (typeof value === "string") return value;
	return typeof value === "number" ? String(value) : "";
};

const nestedOf = (
	document: Record<string, unknown>,
	name: string,
): Record<string, unknown> => {
	const value = document[name];
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: {};
};

const documentMoney = (
	document: Record<string, unknown>,
	minor: string,
): string => {
	const exponent = document.exponent;
	const places =
		typeof exponent === "number" && Number.isInteger(exponent) && exponent >= 0
			? exponent
			: 0;
	return `${formatAmount(minor, places)} ${textOf(document, "currency")}`;
};

const receiptBody = (document: Record<string, unknown>): Safe => {
	const amount = documentMoney(document, textOf(document, "amount_minor"));
	return html`<dl>
<dt>What was recorded</dt><dd>${textOf(document, "kind") === "reversal" ? "A reversal" : "A payment"}</dd>
<dt>Amount</dt><dd class="num">${amount}</dd>
<dt>Date</dt><dd>${textOf(document, "value_date")}</dd>
<dt>Recorded by</dt><dd>${textOf(document, "recorded_by")}</dd>
<dt>Status when issued</dt><dd>${textOf(document, "status")}</dd>
<dt>Lender's count of what is owed that day</dt><dd class="num">${documentMoney(document, textOf(document, "lender_payoff_minor"))}</dd>
<dt>Borrower's count of what is owed that day</dt><dd class="num">${documentMoney(document, textOf(document, "borrower_payoff_minor"))}</dd>
</dl>
<p class="muted">Issued at chain position ${textOf(nestedOf(document, "chain_head"), "seq")}. Events after that are not in it.</p>
<p class="muted">A receipt records what was entered and how far the two sides agree on it. It does not say the money moved.</p>`;
};

const payoffBody = (document: Record<string, unknown>): Safe => {
	const row = (label: string, side: Record<string, unknown>): Safe =>
		html`<tr><th scope="row">${label}</th><td class="num">${documentMoney(document, textOf(side, "principal_minor"))}</td><td class="num">${documentMoney(document, textOf(side, "interest_minor"))}</td><td class="num">${documentMoney(document, textOf(side, "payoff_minor"))}</td></tr>`;
	return html`<p>As of ${textOf(document, "as_of")}.</p>
<table>
<thead><tr><th></th><th>Principal</th><th>Interest</th><th>Owed</th></tr></thead>
<tbody>${row("Lender's count", nestedOf(document, "lender"))}${row("Borrower's count", nestedOf(document, "borrower"))}</tbody>
</table>
<p>The two counts differ by <span class="num">${documentMoney(document, textOf(document, "payoff_gap_minor"))}</span>.</p>
<p class="muted">${textOf(document, "wording") || PAYOFF_WORDING}</p>`;
};

const releaseBodyText = (document: Record<string, unknown>): Safe => {
	const balance = documentMoney(
		document,
		textOf(document, "balance_at_release_minor"),
	);
	return html`<p class="banner">${textOf(document, "wording") || RELEASE_WORDING}</p>
<dl>
<dt>Date of the release</dt><dd>${textOf(document, "as_of")}</dd>
<dt>Lender's count of what is owed that day</dt><dd class="num">${balance}</dd>
</dl>
<p>${document.released_with_balance === true ? "The lender released the note while its own count was above zero." : "The lender's count was zero that day."} A release changes no balance.</p>`;
};

const sealBody = (document: Record<string, unknown>): Safe =>
	html`<dl>
<dt>Entries sealed</dt><dd class="num">${textOf(document, "head_seq")}</dd>
<dt>Sealed at</dt><dd>${textOf(document, "sealed_at")}</dd>
<dt>Head hash</dt><dd class="hash">${textOf(document, "head_hash")}</dd>
</dl>`;

const DOCUMENT_BODIES: Record<
	string,
	(document: Record<string, unknown>) => Safe
> = {
	"note.payment-receipt": receiptBody,
	"note.payoff-statement": payoffBody,
	"note.release": releaseBodyText,
	"note.chain-seal": sealBody,
};

/**
 * A signed document as a readable page, with a link to the JSON file. Wording comes from the document itself and the
 * library's constants; amounts are formatted from minor units with the document's own exponent, never through a float.
 */
export const documentPage = (
	noteId: string,
	docId: string,
	document: Record<string, unknown>,
	basePath = `/n/${noteId}`,
): string => {
	const type = textOf(document, "type");
	const label = DOCUMENT_LABELS[type as ViewDocument["type"]] ?? "Document";
	const render = DOCUMENT_BODIES[type];
	const signature = nestedOf(document, "signature");
	return layout(
		label,
		html`<h1>${label}</h1>
<p class="muted"><a href="${basePath}">Back to the loan record</a></p>
${render ? render(document) : html`<p>This document type is not shown here. Download the file.</p>`}
<h2>Signature</h2>
<dl>
<dt>Issued</dt><dd>${textOf(document, "issued_at") || textOf(document, "sealed_at")}</dd>
<dt>Key</dt><dd>${textOf(signature, "key_id")} (${textOf(signature, "purpose")})</dd>
<dt>Algorithm</dt><dd>${textOf(signature, "alg")}</dd>
</dl>
<p class="muted">The signature is Trifold's, made with the key above; it is not a signature of either party. It covers the document as issued. Anyone with the file and the published public key can check it offline with tfd-verify-notes. A passing check says the file is unchanged since it was signed. It does not say the facts in it are true.</p>
<p><a href="${basePath}/docs/${docId}.json">Download the signed file (JSON)</a></p>`,
	);
};

/** The one stylesheet. System fonts only: the Worker serves no font files. */
export const NOTES_CSS = `
:root { --bg:#f7f5f0; --fg:#1d1d1f; --muted:#5f6368; --line:#d9d4c7; --accent:#1f4d3a; --alert:#9c2f1f; --you:#e8f0ea; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:17px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 920px; margin: 0 auto; padding: 32px 20px 24px; }
footer { max-width: 920px; margin: 0 auto; padding: 0 20px 48px; }
h1 { font-size: 32px; line-height: 1.15; margin: 0 0 12px; }
h2 { font-size: 22px; margin: 32px 0 8px; }
h3 { font-size: 17px; margin: 0 0 8px; }
.muted { color: var(--muted); font-size: 15px; }
.num { font-variant-numeric: tabular-nums; }
.balances { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin: 12px 0; }
.balance { border: 1px solid var(--line); border-radius: 10px; padding: 14px 16px; background: #fff; }
.balance.you { background: var(--you); border-color: var(--accent); }
dl { margin: 0; display: grid; grid-template-columns: 1fr auto; gap: 4px 12px; }
dd { margin: 0; text-align: right; }
table { border-collapse: collapse; width: 100%; font-size: 15px; display: block; overflow-x: auto; }
th, td { border-bottom: 1px solid var(--line); padding: 6px 10px; text-align: left; }
form { margin: 10px 0; }
label { display: block; margin: 8px 0; }
input, textarea { display: block; width: 100%; max-width: 420px; font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
fieldset { border: 1px solid var(--line); border-radius: 10px; padding: 8px 14px; }
button { font: 600 16px system-ui, sans-serif; background: var(--accent); color: #fff; border: 0; border-radius: 10px; padding: 10px 16px; cursor: pointer; }
button.secondary { background: #fff; color: var(--accent); border: 1px solid var(--accent); }
.notice { border-radius: 8px; padding: 10px 14px; border: 1px solid var(--line); background: #fff; }
.notice.error { border-color: var(--alert); color: var(--alert); }
.needs { padding-left: 20px; }
.history { padding-left: 20px; }
a { color: var(--accent); }
.hash { font-family: ui-monospace, monospace; font-size: 13px; word-break: break-all; }
.banner { border: 1px solid var(--accent); background: var(--you); border-radius: 8px; padding: 10px 14px; font-weight: 600; }
form.inline { display: inline; margin: 0; }
button.link { background: none; color: var(--accent); border: 0; padding: 0; font: inherit; text-decoration: underline; }
select { display: block; font: inherit; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
`;
