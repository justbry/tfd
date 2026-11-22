import type { CurrencyTotals, PortfolioRow } from "tfd-notes";
import { ACTION_LABELS } from "./approvals-view";
import type { AgentRole } from "./org";
import type { OrgPortfolio } from "./org-service";
import {
	formatAmount,
	html,
	layout,
	type Notice,
	noticeBlock,
	type Safe,
} from "./pages";

/**
 * The organization's pages (build step 4): sign-in, and the portfolio with its approvals queue and board report links.
 * Same rules as `pages.ts`: every dynamic string is escaped by `html`, no script, no inline style, money from minor units.
 * A page shows note ids and counts, never an agent's address or ref.
 */

const orgLinkRequestForm = (orgId: string, heading: string): Safe =>
	html`<section>
<h2>${heading}</h2>
<p class="muted">Enter the email address your organization registered for you and we will send a new link, if it matches.</p>
<form method="post" action="/o/${orgId}/link">
<label>Email address <input type="email" name="email" autocomplete="email" required></label>
<button type="submit">Send a new link</button>
</form>
</section>`;

/** The page a team link opens. It shows a button and redeems nothing: mail scanners fetch links, a person presses. */
export const orgEnterPage = (
	orgId: string,
	token: string | null,
	noteId: string | null,
): string =>
	layout(
		"Open the loan records",
		html`<h1>Open the loan records</h1>
<p>Your organization lends through Trifold loan records and you are on its team. Press the button to open them. Your link works once.</p>
<form method="post" action="/o/${orgId}/enter">
<input type="hidden" name="t" value="${token ?? ""}">
<input type="hidden" name="n" value="${noteId ?? ""}">
<button type="submit">Open the records</button>
</form>
${orgLinkRequestForm(orgId, "Link not working or already used?")}`,
	);

export const orgInvalidLinkPage = (orgId: string): string =>
	layout(
		"Link not valid",
		html`<h1>This link did not work</h1>
<p>It may have been used already, may have expired, or your access may have ended.</p>
${orgLinkRequestForm(orgId, "Get a new link")}`,
	);

export const orgSignInRequiredPage = (orgId: string): string =>
	layout(
		"Sign in again",
		html`<h1>Sign in again</h1>
<p>Your session ended. Use the link from your email, or ask for a new one.</p>
${orgLinkRequestForm(orgId, "Get a new link")}`,
	);

/** The answer to a request for a new link: the same text whether or not the address matched. */
export const orgLinkRequestedPage = (): string =>
	layout(
		"Check your email",
		html`<h1>Check your email</h1>
<p>If that address is on the team, a new link is on its way.</p>`,
	);

const ROLE_WORDS: Record<AgentRole, string> = {
	treasurer: "a treasurer",
	board: "a board member",
	viewer: "a viewer",
};

const money = (minor: string, row: { exponent: number; currency: string }) =>
	`${formatAmount(minor, row.exponent)} ${row.currency}`;

const TERMS_TEXT: Record<PortfolioRow["terms"], string> = {
	proposed: "pending",
	accepted: "accepted",
	declined: "declined",
};

const totalsRow = (total: CurrencyTotals): Safe =>
	html`<tr>
<th scope="row">${total.currency}</th>
<td class="num">${total.notes}</td>
<td class="num">${money(total.outstanding_payoff_minor, total)}</td>
<td class="num">${money(total.overdue_minor, total)}</td>
<td class="num">${total.buckets.current}</td>
<td class="num">${total.buckets["1-30"]}</td>
<td class="num">${total.buckets["31-60"]}</td>
<td class="num">${total.buckets["61+"]}</td>
<td class="num">${total.awaiting_confirmation}</td>
<td class="num">${total.disputed}</td>
<td class="num">${total.terms_pending}</td>
<td class="num">${total.declined}</td>
</tr>`;

const totalsBlock = (totals: readonly CurrencyTotals[]): Safe => {
	if (totals.length === 0) return html`<p>No note could be read yet.</p>`;
	return html`<p class="muted">Each currency is counted alone: amounts are never added across currencies. A note whose borrower said it is not their loan is counted under Declined and in no other total.</p>
<table>
<thead><tr><th>Currency</th><th>Notes</th><th>Owed (open notes)</th><th>Overdue</th><th>Current</th><th>1-30 days</th><th>31-60 days</th><th>61+ days</th><th>Awaiting confirmation</th><th>Disputed</th><th>Terms pending</th><th>Declined</th></tr></thead>
<tbody>${totals.map(totalsRow)}</tbody>
</table>`;
};

const noteRow = (orgId: string, row: PortfolioRow): Safe =>
	html`<tr>
<th scope="row"><a href="/o/${orgId}/n/${row.note_id}">${row.note_id}</a></th>
<td>${row.currency}</td>
<td class="num">${money(row.payoff_minor, row)}</td>
<td class="num">${money(row.overdue_minor, row)}</td>
<td class="num">${row.days_overdue}</td>
<td>${row.aging}</td>
<td class="num">${row.awaiting_confirmation}</td>
<td class="num">${row.disputed}</td>
<td>${TERMS_TEXT[row.terms]}</td>
<td>${row.closed ? "yes" : "no"}</td>
<td>${row.next_due ?? ""}</td>
</tr>`;

const notesBlock = (orgId: string, rows: readonly PortfolioRow[]): Safe => {
	if (rows.length === 0) return html`<p>No notes yet.</p>`;
	return html`<table>
<thead><tr><th>Note</th><th>Currency</th><th>Owed</th><th>Overdue</th><th>Days overdue</th><th>Aging</th><th>Awaiting confirmation</th><th>Disputed</th><th>Terms</th><th>Closed</th><th>Next due</th></tr></thead>
<tbody>${rows.map((row) => noteRow(orgId, row))}</tbody>
</table>`;
};

const queueBlock = (input: {
	orgId: string;
	role: AgentRole;
	csrf: string;
	data: OrgPortfolio;
}): Safe => {
	const { orgId, role, csrf, data } = input;
	if (data.queue.length === 0) return html`<p>No approval is waiting.</p>`;
	return html`<table>
<thead><tr><th>Note</th><th>For</th><th>Asked</th><th></th></tr></thead>
<tbody>${data.queue.map((item) => {
		const { mine } = item;
		let control: Safe = html`<span class="muted">Waiting for a board member.</span>`;
		if (mine)
			control = html`<span class="muted">You asked for this; another board member must approve.</span>`;
		else if (role === "board")
			control = html`<form class="inline" method="post" action="/o/${orgId}/n/${item.noteId}/approve">
<input type="hidden" name="csrf" value="${csrf}">
<input type="hidden" name="request_id" value="${item.requestId}">
<button type="submit">Approve</button>
</form>`;
		return html`<tr>
<th scope="row"><a href="/o/${orgId}/n/${item.noteId}">${item.noteId}</a></th>
<td>${ACTION_LABELS[item.action]}</td>
<td>${item.requestedAt.slice(0, 10)}</td>
<td>${control}</td>
</tr>`;
	})}</tbody>
</table>`;
};

const reportBlock = (orgId: string, role: AgentRole, asOf: string): Safe => {
	if (role === "viewer")
		return html`<p>The board report is for treasurers and board members.</p>`;
	return html`<p class="muted">The board report has counts, amounts and dates only: no names, notes, reasons or agent identities.</p>
<form method="get" action="/o/${orgId}/board.csv">
<label>As of <input type="date" name="as_of" value="${asOf}" required></label>
<button type="submit" class="secondary">Download the board report (CSV)</button>
</form>
<form method="get" action="/o/${orgId}/board.json">
<label>As of <input type="date" name="as_of" value="${asOf}" required></label>
<button type="submit" class="secondary">Download the board report (JSON)</button>
</form>`;
};

export const portfolioPage = (input: {
	orgId: string;
	role: AgentRole;
	csrf: string;
	asOf: string;
	data: OrgPortfolio;
	notice?: Notice;
}): string => {
	const { orgId, role, asOf, data } = input;
	const { portfolio } = data;
	return layout(
		"Loan portfolio",
		html`<h1>Loan portfolio</h1>
${noticeBlock(input.notice)}
<p class="muted">You are on the team as ${ROLE_WORDS[role]}. As of ${asOf}.</p>
<form class="inline" method="post" action="/o/${orgId}/logout">
<input type="hidden" name="csrf" value="${input.csrf}">
<button type="submit" class="link">Sign out</button>
</form>
<section>
<h2>Totals</h2>
${totalsBlock(portfolio.totals)}
</section>
<section>
<h2>Notes</h2>
${notesBlock(orgId, portfolio.rows)}
${
	portfolio.invalid.length === 0
		? html``
		: html`<h3>Could not be read</h3>
<ul>${portfolio.invalid.map((entry) => html`<li>${entry.note_id}: ${entry.error}</li>`)}</ul>
<p class="muted">These notes are left out of the totals. Do not rely on their figures.</p>`
}
</section>
<section>
<h2>Approvals waiting</h2>
${queueBlock({ orgId, role, csrf: input.csrf, data })}
</section>
<section>
<h2>Board report</h2>
${reportBlock(orgId, role, asOf)}
</section>`,
	);
};
