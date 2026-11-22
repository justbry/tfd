import {
	type GrantLevel,
	type GrantStatus,
	REVOKE_NOTICE,
	type Role,
	type SharedView,
} from "tfd-notes";
import {
	formatAmount,
	html,
	layout,
	type Notice,
	noticeBlock,
	type Safe,
} from "./pages";
import {
	DISCLOSURE_MAX_DAYS,
	type DisclosureRow,
	PURPOSE_LABELS,
	SHARE_DEFAULT_DAYS,
	SHARE_MAX_DAYS,
	SHARE_PURPOSES,
	type ShareRow,
	type SharingView,
} from "./share-core";

/**
 * The pages of sharing (build step 5): the panel the two parties see on their note page, and what a person or a verify
 * link opens. A viewer's pages (`sharedViewPage`, `verifyPage`) are built from `SharedView` alone (the verify page from
 * a token and a verdict). They hold no dispute, age, notice, annotation, agent, address or name, because nothing that carries
 * one is ever passed in.
 */

const STATUS_TEXT: Record<GrantStatus, string> = {
	pending: "waiting for agreement",
	active: "active",
	expired: "expired",
	revoked: "ended",
};

const LEVEL_TEXT: Record<GrantLevel, string> = {
	summary: "summary",
	statement: "statement",
	verify: "document check",
};

const sideText = (role: Role, mine: Role, lenderIsOrg: boolean): string => {
	const name =
		role === "lender" && lenderIsOrg
			? "the lender's team"
			: role === "lender"
				? "the lender"
				: "the borrower";
	return role === mine ? `${name} (your side)` : name;
};

const day = (instant: string): string => instant.slice(0, 10);

interface PanelContext {
	basePath: string;
	csrf: string;
	lenderIsOrg: boolean;
}

const postForm = (
	context: PanelContext,
	action: string,
	fields: Record<string, string>,
	body: Safe,
	inline = false,
): Safe =>
	html`<form method="post" action="${context.basePath}/share/${action}"${inline ? html` class="inline"` : html``}>
<input type="hidden" name="csrf" value="${context.csrf}">
${Object.entries(fields).map(
	([name, value]) =>
		html`<input type="hidden" name="${name}" value="${value}">`,
)}
${body}
</form>`;

const audienceText = (row: ShareRow): string => {
	if (row.kind === "link") return "A verify link";
	const person = `A person (${row.recipientMasked ?? "address not kept"})`;
	return row.purpose === null
		? person
		: `${person}, disclosure for ${PURPOSE_LABELS[row.purpose]}`;
};

const agreedText = (row: ShareRow, mine: Role, lenderIsOrg: boolean): string =>
	row.consentedBy
		.map((role) => sideText(role, mine, lenderIsOrg))
		.join(" and ");

const rowActions = (
	row: ShareRow,
	context: PanelContext,
	canAct: boolean,
): Safe => {
	if (!canAct) return html``;
	const live = row.status === "pending" || row.status === "active";
	return html`${
		row.awaitingMe
			? postForm(
					context,
					"consent",
					{ grant_id: row.grantId },
					html`<button type="submit">Agree to this share</button>`,
				)
			: html``
	}${
		row.canReveal
			? postForm(
					context,
					"reveal",
					{ grant_id: row.grantId },
					html`<button type="submit" class="secondary">Show the link once</button>`,
				)
			: html``
	}${
		row.canResend
			? postForm(
					context,
					"resend",
					{ grant_id: row.grantId },
					html`<button type="submit" class="secondary">Send the link again</button>`,
				)
			: html``
	}${
		live
			? postForm(
					context,
					"revoke",
					{ grant_id: row.grantId },
					html`<button type="submit" class="secondary">Revoke</button>
<span class="muted">${REVOKE_NOTICE}</span>`,
				)
			: html``
	}`;
};

const shareTableRow = (
	row: ShareRow,
	sharing: SharingView,
	context: PanelContext,
): Safe =>
	html`<tr>
<td>${audienceText(row)}</td>
<td>${LEVEL_TEXT[row.level]}</td>
<td>${STATUS_TEXT[row.status]}${row.revokedBy === null ? "" : `, by ${sideText(row.revokedBy, sharing.role, context.lenderIsOrg)}`}</td>
<td>Proposed by ${sideText(row.proposedBy, sharing.role, context.lenderIsOrg)} on ${day(row.proposedAt)}. Agreed by ${agreedText(row, sharing.role, context.lenderIsOrg)}.</td>
<td>${day(row.expiresAt)}</td>
<td>${rowActions(row, context, sharing.canAct)}</td>
</tr>`;

const sharesTable = (sharing: SharingView, context: PanelContext): Safe => {
	if (sharing.shares.length === 0)
		return html`<p>No share has been made yet.</p>`;
	return html`<table>
<thead><tr><th>Shared with</th><th>What they see</th><th>Status</th><th>Who agreed</th><th>Ends</th><th></th></tr></thead>
<tbody>${sharing.shares.map((row) => shareTableRow(row, sharing, context))}</tbody>
</table>`;
};

const waitingBlock = (sharing: SharingView, context: PanelContext): Safe => {
	const waiting = sharing.shares.filter((row) => row.awaitingMe);
	if (waiting.length === 0) return html``;
	return html`<h3>Waiting for your agreement</h3>
<ul>${waiting.map(
		(row) =>
			html`<li>${audienceText(row)}, ${LEVEL_TEXT[row.level]}, proposed by ${sideText(row.proposedBy, sharing.role, context.lenderIsOrg)} on ${day(row.proposedAt)}. ${postForm(context, "consent", { grant_id: row.grantId }, html`<button type="submit">Agree to this share</button>`)}</li>`,
	)}</ul>`;
};

const purposeOptions = SHARE_PURPOSES.map(
	(purpose) =>
		html`<option value="${purpose}">${PURPOSE_LABELS[purpose]}</option>`,
);

const proposeForm = (sharing: SharingView, context: PanelContext): Safe => {
	if (!sharing.canAct)
		return html`<p class="muted">A viewer can read this list but not change it.</p>`;
	return html`<h3>Share with a named person</h3>
<p class="muted">They get a read-only view that ends on the day you choose, at most ${SHARE_MAX_DAYS} days out. The other party must agree before anything is sent, unless this is a disclosure (the box below). A shared view never includes disputes, notices or free-text notes.</p>
<p class="muted">A shared view shows the figures both parties agree on. If that changes, for example a payment is disputed, the shared figures change too.</p>
${postForm(
	context,
	"propose",
	{},
	html`<label>Their email address <input type="email" name="recipient_email" autocomplete="off" required></label>
<label>What they see
<select name="level"><option value="summary">A summary: the balance both of you count and the next due date</option><option value="statement">A statement: the schedule and the payments both of you count</option></select></label>
<label>Days it lasts <input type="number" name="days" min="1" max="${SHARE_MAX_DAYS}" value="${SHARE_DEFAULT_DAYS}" required></label>
<label><input type="checkbox" name="carve_out" value="1"> This is a disclosure for my own books, legal advice, enforcement or assignment</label>
<label>If so, what for <select name="purpose">${purposeOptions}</select></label>
<p class="muted">A disclosure is active as soon as you send it and lasts at most ${DISCLOSURE_MAX_DAYS} days. The other party is emailed that it was made, and it is listed for them in the disclosure log below, with no way to hide it.</p>
<button type="submit">Share</button>`,
)}
<h3>Make a verify link</h3>
<p class="muted">A verify link lets someone check that one document issued for this record is unchanged. It shows no figures, no names and no balances. The other party must agree, and the link is shown to you once after that.</p>
${postForm(
	context,
	"verify-link",
	{},
	html`<label>Days it lasts <input type="number" name="days" min="1" max="${SHARE_MAX_DAYS}" value="${SHARE_DEFAULT_DAYS}" required></label>
<button type="submit" class="secondary">Make a verify link</button>`,
)}`;
};

const disclosureTable = (rows: DisclosureRow[], empty: string): Safe =>
	rows.length === 0
		? html`<p>${empty}</p>`
		: html`<table>
<thead><tr><th>For</th><th>Recipient</th><th>Made on</th><th>Ends</th><th>Status</th></tr></thead>
<tbody>${rows.map(
				(row) =>
					html`<tr><td>${PURPOSE_LABELS[row.purpose]}</td><td>${row.recipientMasked ?? "address not kept"}</td><td>${day(row.proposedAt)}</td><td>${day(row.expiresAt)}</td><td>${STATUS_TEXT[row.status]}</td></tr>`,
			)}</tbody>
</table>`;

const disclosureLogBlock = (sharing: SharingView): Safe => {
	const mine = sharing.disclosures.filter(
		(row) => row.proposedBy === sharing.role,
	);
	const theirs = sharing.disclosures.filter(
		(row) => row.proposedBy !== sharing.role,
	);
	return html`<h3>Disclosure log</h3>
<p class="muted">Each disclosure to a person who needs the record for their own books, legal advice, enforcement or assignment is listed here for both of you, whatever its status. Addresses are shown with most characters hidden.</p>
<h4>Disclosures you made</h4>
${disclosureTable(mine, "None.")}
<h4>Disclosures the other party made</h4>
${disclosureTable(theirs, "None.")}`;
};

/** Who can read a record, said whole: the parties, the lender's team, anyone disclosed to, anyone both agreed to. */
export const SHARING_READERS =
	"These people can read this record: you, the other party, the lender's team when the lender is an organization, anyone either of you disclosed it to (listed below) and anyone you both agreed to share it with. Trifold stores the record to run the service.";

/** The Sharing section of a note page, the same list and log for both parties. */
export const sharingPanel = (
	sharing: SharingView,
	context: PanelContext,
): Safe =>
	html`<section>
<h2>Sharing</h2>
<p class="muted">${SHARING_READERS}</p>
<p class="muted">Either of you can end a share at any time.</p>
${waitingBlock(sharing, context)}
${sharesTable(sharing, context)}
${proposeForm(sharing, context)}
${disclosureLogBlock(sharing)}
</section>`;

/** The page that shows a verify link's token, once. The route sends it with `no-store`. */
export const verifyLinkRevealPage = (
	url: string,
	expiresAt: string,
	backPath: string,
): string =>
	layout(
		"Your verify link",
		html`<h1>Your verify link</h1>
<p>This is the only time it is shown. Copy it now. If you lose it, end this link and make a new one.</p>
<p class="hash">${url}</p>
<p class="muted">It works until ${day(expiresAt)}, or until either of you ends it. Anyone who has it can check documents of this record, and sees no figures.</p>
<p><a href="${backPath}">Back to the record</a></p>`,
	);

// ---- what a recipient opens ----

const SHARE_NOTE = "Read-only. One of the parties chose to share this.";

/** The page a person's emailed link opens. It shows a button and redeems nothing: mail scanners fetch links. */
export const shareEnterPage = (
	noteId: string,
	grantId: string,
	token: string | null,
): string =>
	layout(
		"Open the shared loan record",
		html`<h1>A loan record was shared with you</h1>
<p>Press the button to open it. Your link works once.</p>
<form method="post" action="/s/${noteId}/${grantId}/enter">
<input type="hidden" name="t" value="${token ?? ""}">
<button type="submit">Open the record</button>
</form>`,
	);

export const shareInvalidLinkPage = (): string =>
	layout(
		"Link not valid",
		html`<h1>This link did not work</h1>
<p>It may have been used already or may have ended.</p>`,
	);

/** What a person without a live session sees at the share's address. */
export const shareSignInPage = (): string =>
	layout(
		"Open your link",
		html`<h1>Open your link</h1>
<p>Use the link you were sent. It works once; after that this page opens on the same device for a few hours.</p>`,
	);

/** The only answer for a share that is revoked, expired or unknown. No detail. */
export const shareEndedPage = (): string =>
	layout("Share ended", html`<h1>This share has ended.</h1>`);

const money = (minor: string, view: { exponent: number; currency: string }) =>
	`${formatAmount(minor, view.exponent)} ${view.currency}`;

type Figures = Exclude<SharedView, { level: "verify" }>;

const figuresBlock = (view: Figures): Safe =>
	html`<section>
<h2>${view.level === "statement" ? "Statement" : "Summary"}</h2>
<dl>
<dt>Status</dt><dd>${view.status}</dd>
<dt>Principal outstanding</dt><dd class="num">${money(view.principal_minor, view)}</dd>
<dt>Interest accrued</dt><dd class="num">${money(view.interest_minor, view)}</dd>
<dt>To pay off</dt><dd class="num">${money(view.payoff_minor, view)}</dd>
<dt>Installments in the schedule</dt><dd class="num">${view.schedule_length}</dd>
<dt>Next installment due</dt><dd>${view.next_installment_due ?? "none left"}</dd>
</dl>
</section>`;

const statementBlock = (
	view: Extract<SharedView, { level: "statement" }>,
): Safe =>
	html`<section>
<h2>Installments</h2>
${
	view.schedule.length === 0
		? html`<p>No fixed schedule.</p>`
		: html`<table>
<thead><tr><th>#</th><th>Due</th><th>Installment</th><th>Interest</th><th>Principal</th><th>Balance after</th></tr></thead>
<tbody>${view.schedule.map(
				(row) =>
					html`<tr><td>${row.n}</td><td>${row.due}</td><td class="num">${money(row.payment_minor, view)}</td><td class="num">${money(row.interest_minor, view)}</td><td class="num">${money(row.principal_minor, view)}</td><td class="num">${money(row.balance_after_minor, view)}</td></tr>`,
			)}</tbody>
</table>`
}
</section>
<section>
<h2>Payments</h2>
<p class="muted">${view.payments.label}</p>
${
	view.payments.items.length === 0
		? html`<p>No payment is listed yet.</p>`
		: html`<table>
<thead><tr><th>#</th><th>Date</th><th>Kind</th><th>Amount</th></tr></thead>
<tbody>${view.payments.items.map(
				(item) =>
					html`<tr><td>${item.index}</td><td>${item.value_date}</td><td>${item.kind}</td><td class="num">${money(item.amount_minor, view)}</td></tr>`,
			)}</tbody>
</table>`
}
</section>`;

/** The sign-out button of a shared view: a post to the grant's own logout route with its CSRF token. */
const logoutForm = (
	logout: { action: string; csrf: string } | undefined,
): Safe =>
	logout
		? html`<form method="post" action="${logout.action}">
<input type="hidden" name="csrf" value="${logout.csrf}">
<button type="submit" class="secondary">Sign out</button>
</form>`
		: html``;

/** What a person sees after ending their shared session. */
export const signedOutSharePage = (): string =>
	layout(
		"Signed out",
		html`<h1>You are signed out.</h1>
<p>Your link works once, so ask whoever shared this record to send it again if you need to open it later.</p>`,
	);

/**
 * The shared view at its grant's level. Built from `SharedView` alone, so nothing else can reach the page.
 */
export const sharedViewPage = (
	view: SharedView,
	logout?: { action: string; csrf: string },
): string => {
	if (view.level === "verify")
		return layout(
			"Shared loan record",
			html`<h1>Shared loan record</h1>
<p class="muted">${SHARE_NOTE}</p>
<p>This share checks documents only. It shows no figures.</p>
${logoutForm(logout)}`,
		);
	return layout(
		"Shared loan record",
		html`<h1>Shared loan record</h1>
<p class="muted">${SHARE_NOTE} As of ${view.as_of}.</p>
${figuresBlock(view)}
${view.level === "statement" ? statementBlock(view) : html``}
<p class="muted">The figures count only what both parties recorded and counted. Nothing else about the record is shown here.</p>
${logoutForm(logout)}`,
	);
};

// ---- the verify link ----

export type VerifyResult =
	| { kind: "ok"; type: string; keyId: string; signedAt: string }
	| { kind: "failed"; code: string }
	| { kind: "not_configured" }
	| { kind: "too_large" };

export const VERIFY_OK_TEXT =
	"The signature verifies for this key and the document is unchanged since it was signed.";
export const VERIFY_NOT_CONFIGURED_TEXT =
	"The check is not configured here yet. Use tfd-verify-notes with the published keys instead.";
export const VERIFY_TOO_LARGE_TEXT =
	"That document is too large to check here. A signed document is much smaller.";

const resultBlock = (result: VerifyResult | undefined): Safe => {
	if (result === undefined) return html``;
	switch (result.kind) {
		case "ok":
			return html`<p class="notice ok" role="status">${VERIFY_OK_TEXT}</p>
<p class="muted">Document type ${result.type}, key ${result.keyId}, signed ${result.signedAt}.</p>`;
		case "failed":
			return html`<p class="notice error" role="alert">The check failed: ${result.code}</p>`;
		case "not_configured":
			return html`<p class="notice error" role="alert">${VERIFY_NOT_CONFIGURED_TEXT}</p>`;
		case "too_large":
			return html`<p class="notice error" role="alert">${VERIFY_TOO_LARGE_TEXT}</p>`;
		default:
			return html``;
	}
};

/**
 * The verify link's page: a form to paste one signed document and the one-line explanation. It lists nothing about the
 * record (not its documents, not their number, not its id), so a link holder learns only whether a pasted file verifies.
 */
export const verifyPage = (input: {
	token: string;
	result?: VerifyResult;
	notice?: Notice;
}): string =>
	layout(
		"Check a signed document",
		html`<h1>Check a signed document</h1>
${noticeBlock(input.notice)}
<section>
<p>Paste the JSON of one signed document. It is checked and not kept.</p>
<form method="post" action="/v/${input.token}">
<label>Document <textarea name="document" rows="12" cols="60" required></textarea></label>
<button type="submit">Check it</button>
</form>
${resultBlock(input.result)}
<p class="muted">The check runs on our server, so it only tells you what our server sees. For an independent check, use tfd-verify-notes with the published keys.</p>
</section>`,
	);
