import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { validateStream, verifyChain } from "tfd-notes";
import { migrateNote, SqliteNoteStore } from "../src/notes/do-store";
import { MemoryNoteStore } from "../src/notes/memory-store";
import {
	CODE_REQUESTS_PER_WINDOW,
	type NoteView,
	type Outcome,
} from "../src/notes/service";
import type { ActiveSession } from "../src/notes/sessions";
import type { AppendResult } from "../src/notes/store";
import { durableState } from "./fakes";
import {
	BORROWER_EMAIL,
	type Harness,
	HOUR,
	harness,
	LENDER_EMAIL,
	MINUTE,
	TERMS,
} from "./notes-fakes";

const PAYMENT = {
	type: "payment.recorded",
	kind: "payment",
	amount_minor: "100000",
	value_date: "2026-11-10",
	method: "transfer",
};

const viewOf = async (
	h: Harness,
	session: ActiveSession,
): Promise<NoteView> => {
	const outcome = await h.service.view(session);
	if (!outcome.ok) throw new Error(outcome.message);
	return outcome.view;
};

const expectOk = <T>(outcome: Outcome<T>): T & { ok: true } => {
	if (!outcome.ok) throw new Error(`${outcome.error}: ${outcome.message}`);
	return outcome;
};

/** Asks for a code and returns the digits emailed to the session's party. */
const codeFor = async (
	h: Harness,
	session: ActiveSession,
	action: string,
): Promise<string> => {
	expectOk(await h.service.requestStepUp(session, action));
	return h.mailer.codeFor(
		session.role === "lender" ? LENDER_EMAIL : BORROWER_EMAIL,
	);
};

const chainHolds = async (h: Harness, noteId: string): Promise<boolean> => {
	const { events, links } = await h.store.readLog(noteId);
	const verdict = await verifyChain(
		validateStream(events.map((text): unknown => JSON.parse(text))),
		links,
		noteId,
	);
	return verdict.ok;
};

describe("the whole guest flow, in memory", () => {
	test("create, invites, accept with a code, pay, confirm: equal balances, Closed: no, chain verifies each step", async () => {
		const h = harness();
		const noteId = await h.create();
		expect(h.mailer.sent).toHaveLength(2);
		expect(h.mailer.to(LENDER_EMAIL)).toHaveLength(1);
		expect(h.mailer.to(BORROWER_EMAIL)).toHaveLength(1);
		expect(h.mailer.linkTokenFor(LENDER_EMAIL)).not.toBe(
			h.mailer.linkTokenFor(BORROWER_EMAIL),
		);
		expect(await chainHolds(h, noteId)).toBe(true);

		const borrower = (await h.enter(noteId, "borrower")).session;
		const lender = (await h.enter(noteId, "lender")).session;
		expect(borrower.role).toBe("borrower");
		expect(lender.role).toBe("lender");

		let view = await viewOf(h, borrower);
		expect(view.state).toEqual({ terms: "proposed", closed: false });
		expect(view.needsYou).toEqual([{ kind: "accept_terms" }]);
		expect((await viewOf(h, lender)).needsYou).toEqual([]);

		// Accepting needs a code: without one nothing is written.
		const refused = await h.service.append(borrower, {
			type: "terms.accepted",
		});
		expect(refused).toMatchObject({ ok: false, error: "step_up_required" });
		expect((await h.store.readLog(noteId)).events).toHaveLength(1);
		const code = await codeFor(h, borrower, "terms.accepted");
		const accepted = expectOk(
			await h.service.append(borrower, { type: "terms.accepted" }, { code }),
		);
		expect(accepted.event).toMatchObject({
			entered_by: "borrower",
			via: "email-link",
			seq: 2,
		});
		expect(await chainHolds(h, noteId)).toBe(true);
		view = await viewOf(h, borrower);
		expect(view.state.terms).toBe("accepted");
		expect(view.needsYou).toEqual([]);

		// The borrower records a payment: the borrower's count moves at once, the lender's does not.
		const payment = expectOk(await h.service.append(borrower, PAYMENT)).event;
		expect(await chainHolds(h, noteId)).toBe(true);
		view = await viewOf(h, lender);
		expect(view.statement.borrower.paid_minor).toBe("100000");
		expect(view.statement.lender.paid_minor).toBe("0");
		expect(view.statement.difference.map((item) => item.status)).toEqual([
			"claimed-by-borrower",
		]);
		expect(view.needsYou).toEqual([
			{ kind: "answer_payment", eventId: payment.id },
		]);

		// The lender confirms: no code needed, the counts meet.
		expect(
			expectOk(
				await h.service.append(lender, {
					type: "payment.confirmed",
					target: payment.id,
				}),
			).event,
		).toMatchObject({
			entered_by: "lender",
			via: "email-link",
		});
		expect(await chainHolds(h, noteId)).toBe(true);
		view = await viewOf(h, borrower);
		expect(view.statement.lender).toEqual(view.statement.borrower);
		expect(view.statement.difference).toEqual([]);
		expect(view.statement.payoff_gap_minor).toBe("0");
		expect(view.state.closed).toBe(false);
		expect(view.chain).toEqual({ ok: true });
		expect(view.needsYou).toEqual([]);
	});

	test("a dispute with a counter-amount shows in both views", async () => {
		const h = harness();
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		const lender = (await h.enter(noteId, "lender")).session;
		const payment = expectOk(await h.service.append(borrower, PAYMENT)).event;

		const disputeInput = {
			type: "payment.disputed",
			target: payment.id,
			counter_amount_minor: "90000",
			reason: "I only got 900",
		};
		expect(await h.service.append(lender, disputeInput)).toMatchObject({
			error: "step_up_required",
		});
		const code = await codeFor(h, lender, "payment.disputed");
		expectOk(await h.service.append(lender, disputeInput, { code }));
		expect(await chainHolds(h, noteId)).toBe(true);

		for (const session of [lender, borrower]) {
			const view = await viewOf(h, session);
			expect(view.statement.difference).toHaveLength(1);
			expect(view.statement.difference[0]).toMatchObject({
				event_id: payment.id,
				status: "disputed",
				reason: "I only got 900",
			});
		}
		// The recorder, not the disputer, is asked to answer.
		expect((await viewOf(h, borrower)).needsYou).toContainEqual({
			kind: "answer_dispute",
			eventId: payment.id,
		});
		expect((await viewOf(h, lender)).needsYou).toEqual([]);

		// Both enter the same agreed amount (each with a code) and the dispute resolves.
		const resolve = {
			type: "payment.resolved",
			target: payment.id,
			agreed_amount_minor: "95000",
		};
		for (const session of [borrower, lender]) {
			const resolveCode = await codeFor(h, session, "payment.resolved");
			expectOk(await h.service.append(session, resolve, { code: resolveCode }));
		}
		const view = await viewOf(h, lender);
		expect(view.statement.lender).toEqual(view.statement.borrower);
		expect(await chainHolds(h, noteId)).toBe(true);
	});

	test("declining the terms is a borrower step without a code, and annotations are visible to both parties", async () => {
		const h = harness();
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		const lender = (await h.enter(noteId, "lender")).session;
		expectOk(await h.service.append(borrower, { type: "terms.declined" }));
		expect((await viewOf(h, lender)).state.terms).toBe("declined");
		expectOk(
			await h.service.append(borrower, {
				type: "annotation.added",
				text: "Wrong amount, please check.",
			}),
		);
		for (const session of [lender, borrower]) {
			const texts = (await viewOf(h, session)).events.flatMap((event) =>
				event.type === "annotation.added" ? [event.text] : [],
			);
			expect(texts).toEqual(["Wrong amount, please check."]);
		}
	});

	test("the statement is as of the UTC date of the clock, never before the issue date", async () => {
		const h = harness();
		const noteId = await h.create();
		const lender = (await h.enter(noteId, "lender")).session;
		expect((await viewOf(h, lender)).asOf).toBe("2026-11-22");
		h.clock.set("2026-10-01T23:59:59.000Z");
		expect((await viewOf(h, lender)).asOf).toBe("2026-11-01");
		h.clock.set("2026-12-05T00:00:00.000Z");
		const view = await viewOf(h, lender);
		expect(view.asOf).toBe("2026-12-05");
		expect(view.statement.expected.due_to_date_minor).not.toBe("0");
	});

	test("the view carries masked addresses and no raw email anywhere", async () => {
		const h = harness();
		const noteId = await h.create();
		const lender = (await h.enter(noteId, "lender")).session;
		const view = await viewOf(h, lender);
		expect(view.masked).toEqual({
			lender: "m****@e******.com",
			borrower: "a**@e******.com",
		});
		const text = JSON.stringify(view);
		expect(text).not.toContain(LENDER_EMAIL);
		expect(text).not.toContain(BORROWER_EMAIL);
		const { events } = await h.store.readLog(noteId);
		expect(events.join("")).not.toContain("example.com");
	});
});

describe("who may enter what", () => {
	test("the permission table: allowed types per role, everything else is forbidden_event", async () => {
		const h = harness();
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		const lender = (await h.enter(noteId, "lender")).session;
		for (const type of [
			"payoff.issued",
			"release.drafted",
			"release.confirmed",
			"notice.sent",
			"party.rebound",
			"visibility.changed",
			"approval.requested",
			"approval.granted",
			"note.created",
			"schedule.proposed",
		]) {
			for (const session of [borrower, lender]) {
				expect(await h.service.append(session, { type })).toMatchObject({
					ok: false,
					error: "forbidden_event",
				});
			}
		}
		// Terms steps are the borrower's only.
		expect(
			await h.service.append(lender, { type: "terms.accepted" }),
		).toMatchObject({ error: "wrong_role" });
		expect(
			await h.service.append(lender, { type: "terms.declined" }),
		).toMatchObject({ error: "wrong_role" });
		expect(await h.service.append(borrower, "payment.recorded")).toMatchObject({
			error: "bad_request",
		});
		expect(await h.service.append(borrower, { amount: 1 })).toMatchObject({
			error: "bad_request",
		});
		expect((await h.store.readLog(noteId)).events).toHaveLength(1);
	});

	test("the client cannot choose id, note_id, seq, entered_at, entered_by, via, schema or agent_ref", async () => {
		const h = harness();
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		const forged: Record<string, unknown> = {
			id: "forged-id",
			note_id: "other-note",
			seq: 99,
			entered_at: "2001-01-01T00:00:00.000Z",
			entered_by: "lender",
			via: "account",
			schema: "tfd.note-event.v0",
			agent_ref: "agent-1",
		};
		for (const [field, value] of Object.entries(forged)) {
			const outcome = await h.service.append(borrower, {
				...PAYMENT,
				[field]: value,
			});
			expect({ field, outcome }).toMatchObject({
				outcome: { ok: false, error: "forbidden_field" },
			});
		}
		expect((await h.store.readLog(noteId)).events).toHaveLength(1);
		const written = expectOk(await h.service.append(borrower, PAYMENT)).event;
		expect(written).toMatchObject({
			note_id: noteId,
			seq: 2,
			entered_by: "borrower",
			via: "email-link",
			entered_at: "2026-11-22T09:00:00.000Z",
		});
		expect(written.id).not.toBe("forged-id");
		expect("agent_ref" in written).toBe(false);
	});

	test("a field the event type does not have is refused, and the engine's own rules still apply", async () => {
		const h = harness();
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		const lender = (await h.enter(noteId, "lender")).session;
		expect(
			await h.service.append(borrower, { ...PAYMENT, bonus: "x" }),
		).toMatchObject({ error: "bad_event" });
		expect(
			await h.service.append(borrower, {
				...PAYMENT,
				value_date: "2020-01-01",
			}),
		).toMatchObject({ error: "rejected" });
		const payment = expectOk(await h.service.append(borrower, PAYMENT)).event;
		// The recorder cannot confirm their own payment, and a dispute without a reason is not allowed.
		expect(
			await h.service.append(borrower, {
				type: "payment.confirmed",
				target: payment.id,
			}),
		).toMatchObject({ error: "rejected" });
		expect(
			await h.service.append(
				lender,
				{
					type: "payment.disputed",
					target: payment.id,
					counter_amount_minor: "1",
				},
				{ code: "000000" },
			),
		).toMatchObject({ error: "rejected" });
		expect(
			await h.service.append(lender, {
				type: "payment.confirmed",
				target: "nope",
			}),
		).toMatchObject({ error: "rejected" });
		// Text that is too long or not valid is refused before it reaches the chain.
		expect(
			await h.service.append(lender, {
				type: "annotation.added",
				text: "x".repeat(2001),
			}),
		).toMatchObject({ error: "bad_event" });
		expect(
			await h.service.append(lender, {
				type: "annotation.added",
				text: "bad \ud800 text",
			}),
		).toMatchObject({ error: "bad_event" });
		expect(await chainHolds(h, noteId)).toBe(true);
	});

	test("text is stored as NFC so the chain accepts it", async () => {
		const h = harness();
		const noteId = await h.create();
		const lender = (await h.enter(noteId, "lender")).session;
		const decomposed = "José";
		const written = expectOk(
			await h.service.append(lender, {
				type: "annotation.added",
				text: decomposed,
			}),
		).event;
		expect(written.type === "annotation.added" && written.text).toBe("José");
		expect(await chainHolds(h, noteId)).toBe(true);
	});
});

describe("links", () => {
	test("a link works once", async () => {
		const h = harness();
		const noteId = await h.create();
		const token = h.mailer.linkTokenFor(BORROWER_EMAIL);
		expect(await h.service.sessions.redeem(noteId, token)).not.toBeNull();
		expect(await h.service.sessions.redeem(noteId, token)).toBeNull();
	});

	test("a link expires after seven days and works just before", async () => {
		const h = harness();
		const noteId = await h.create();
		const token = h.mailer.linkTokenFor(BORROWER_EMAIL);
		h.clock.advance(7 * 24 * HOUR);
		expect(await h.service.sessions.redeem(noteId, token)).toBeNull();
		const fresh = harness();
		const freshId = await fresh.create();
		fresh.clock.advance(7 * 24 * HOUR - 1);
		expect(
			await fresh.service.sessions.redeem(
				freshId,
				fresh.mailer.linkTokenFor(BORROWER_EMAIL),
			),
		).not.toBeNull();
	});

	test("a link for one note does not open another", async () => {
		const h = harness();
		const first = await h.create("idem-a");
		const second = await h.create("idem-b");
		expect(first).not.toBe(second);
		expect(
			await h.service.sessions.redeem(
				second,
				h.mailer.linkTokenFor(BORROWER_EMAIL),
			),
		).not.toBeNull();
		const tokenForFirst =
			h.mailer.to(BORROWER_EMAIL)[0]?.text.match(/t=([A-Za-z0-9_-]+)/)?.[1] ??
			"";
		expect(await h.service.sessions.redeem(second, tokenForFirst)).toBeNull();
		expect(
			await h.service.sessions.redeem(first, tokenForFirst),
		).not.toBeNull();
	});

	test("a new link goes to the matching address only, whatever the case, and the answer is the same either way", async () => {
		const h = harness();
		const noteId = await h.create();
		const before = h.mailer.sent.length;
		expect(
			await h.service.requestLink(noteId, "stranger@example.com"),
		).toBeUndefined();
		expect(h.mailer.sent).toHaveLength(before);
		expect(
			await h.service.requestLink(noteId, "  ANA@Example.com "),
		).toBeUndefined();
		expect(h.mailer.sent).toHaveLength(before + 1);
		expect(h.mailer.sent.at(-1)?.to).toBe(BORROWER_EMAIL);
		expect(
			await h.service.sessions.redeem(
				noteId,
				h.mailer.linkTokenFor(BORROWER_EMAIL),
			),
		).not.toBeNull();
		// A note that does not exist answers the same and sends nothing.
		expect(
			await h.service.requestLink("nt_unknown0000", BORROWER_EMAIL),
		).toBeUndefined();
		expect(h.mailer.sent).toHaveLength(before + 1);
	});

	test("new links are limited per address (3 an hour) and per note (10 an hour), silently", async () => {
		const h = harness();
		const noteId = await h.create();
		const before = h.mailer.sent.length;
		for (let index = 0; index < 5; index += 1)
			await h.service.requestLink(noteId, BORROWER_EMAIL);
		expect(h.mailer.sent.length - before).toBe(3);
		h.clock.advance(HOUR);
		await h.service.requestLink(noteId, BORROWER_EMAIL);
		expect(h.mailer.sent.length - before).toBe(4);

		const other = harness();
		const otherId = await other.create();
		const start = other.mailer.sent.length;
		for (let index = 0; index < 10; index += 1)
			await other.service.requestLink(otherId, `guess${index}@example.com`);
		await other.service.requestLink(otherId, LENDER_EMAIL);
		expect(other.mailer.sent.length - start).toBe(0);
	});
});

describe("sessions", () => {
	test("idle for more than two hours ends the session; activity keeps it alive", async () => {
		const h = harness();
		const noteId = await h.create();
		const { cookie } = await h.enter(noteId, "borrower");
		h.clock.advance(HOUR + 30 * MINUTE);
		expect(await h.service.sessions.resolve(noteId, cookie)).not.toBeNull();
		h.clock.advance(HOUR + 30 * MINUTE);
		expect(await h.service.sessions.resolve(noteId, cookie)).not.toBeNull();
		h.clock.advance(2 * HOUR + 1);
		expect(await h.service.sessions.resolve(noteId, cookie)).toBeNull();
	});

	test("twelve hours ends it however active it was", async () => {
		const h = harness();
		const noteId = await h.create();
		const { cookie } = await h.enter(noteId, "borrower");
		for (let step = 0; step < 11; step += 1) {
			h.clock.advance(HOUR);
			expect(await h.service.sessions.resolve(noteId, cookie)).not.toBeNull();
		}
		h.clock.advance(HOUR);
		expect(await h.service.sessions.resolve(noteId, cookie)).toBeNull();
	});

	test("a made-up or altered cookie value, or a cookie from another note, is no session", async () => {
		const h = harness();
		const other = await h.create("b");
		const noteId = await h.create("a");
		const { cookie } = await h.enter(noteId, "borrower");
		expect(await h.service.sessions.resolve(noteId, `${cookie}x`)).toBeNull();
		expect(
			await h.service.sessions.resolve(noteId, cookie.slice(0, -1)),
		).toBeNull();
		expect(await h.service.sessions.resolve(noteId, null)).toBeNull();
		expect(await h.service.sessions.resolve(other, cookie)).toBeNull();
	});

	test("CSRF tokens belong to one session and one secret", async () => {
		const h = harness();
		const noteId = await h.create();
		const first = (await h.enter(noteId, "borrower")).session;
		const second = (await h.enter(noteId, "lender")).session;
		const token = await h.service.sessions.csrfToken(first);
		expect(await h.service.sessions.checkCsrf(first, token)).toBe(true);
		expect(await h.service.sessions.checkCsrf(second, token)).toBe(false);
		expect(await h.service.sessions.checkCsrf(first, `${token}x`)).toBe(false);
		expect(await h.service.sessions.checkCsrf(first, null)).toBe(false);
		const elsewhere = harness({ secret: "another-secret" });
		expect(await elsewhere.service.sessions.csrfToken(first)).not.toBe(token);
	});
});

describe("step-up codes", () => {
	const setup = async () => {
		const h = harness();
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		return { h, noteId, borrower };
	};

	test("a code is six digits and goes to the session's own party only", async () => {
		const { h, borrower } = await setup();
		const code = await codeFor(h, borrower, "terms.accepted");
		expect(code).toMatch(/^\d{6}$/);
		expect(h.mailer.sent.at(-1)?.to).toBe(BORROWER_EMAIL);
	});

	test("a code works once: replaying it asks for a new one", async () => {
		const { h, borrower } = await setup();
		const code = await codeFor(h, borrower, "terms.accepted");
		expectOk(
			await h.service.append(borrower, { type: "terms.accepted" }, { code }),
		);
		expect(
			await h.service.append(borrower, { type: "terms.accepted" }, { code }),
		).toMatchObject({ error: "step_up_required" });
	});

	test("a code is good for ten minutes, not eleven", async () => {
		const { h, borrower } = await setup();
		const code = await codeFor(h, borrower, "terms.accepted");
		h.clock.advance(10 * MINUTE);
		expect(
			await h.service.append(borrower, { type: "terms.accepted" }, { code }),
		).toMatchObject({ error: "step_up_invalid" });
		const later = await codeFor(h, borrower, "terms.accepted");
		h.clock.advance(10 * MINUTE - 1);
		expectOk(
			await h.service.append(
				borrower,
				{ type: "terms.accepted" },
				{ code: later },
			),
		);
	});

	test("five wrong tries lock the code, even for the right digits afterwards", async () => {
		const { h, borrower } = await setup();
		const code = await codeFor(h, borrower, "terms.accepted");
		const wrong = code === "000000" ? "111111" : "000000";
		for (let attempt = 0; attempt < 5; attempt += 1)
			expect(
				await h.service.append(
					borrower,
					{ type: "terms.accepted" },
					{ code: wrong },
				),
			).toMatchObject({ error: "step_up_invalid" });
		expect(
			await h.service.append(borrower, { type: "terms.accepted" }, { code }),
		).toMatchObject({
			error: "step_up_invalid",
			message: expect.stringContaining("Too many"),
		});
		const fresh = await codeFor(h, borrower, "terms.accepted");
		expectOk(
			await h.service.append(
				borrower,
				{ type: "terms.accepted" },
				{ code: fresh },
			),
		);
	});

	test("a code for one kind of action does not open another, and a new code replaces the old", async () => {
		const { h, borrower } = await setup();
		const code = await codeFor(h, borrower, "payment.disputed");
		expect(
			await h.service.append(borrower, { type: "terms.accepted" }, { code }),
		).toMatchObject({ error: "step_up_invalid" });
		const first = await codeFor(h, borrower, "terms.accepted");
		h.clock.advance(1);
		const second = await codeFor(h, borrower, "terms.accepted");
		if (first !== second)
			expect(
				await h.service.append(
					borrower,
					{ type: "terms.accepted" },
					{ code: first },
				),
			).toMatchObject({ error: "step_up_invalid" });
	});

	test("a code does not carry over to another session", async () => {
		const { h, noteId, borrower } = await setup();
		const code = await codeFor(h, borrower, "terms.accepted");
		const opened = await h.service.sessions.redeem(
			noteId,
			await h.service.sessions.issueInvite(noteId, "borrower"),
		);
		const other = await h.service.sessions.resolve(
			noteId,
			opened?.cookieValue ?? null,
		);
		if (other === null) throw new Error("no second session");
		expect(
			await h.service.append(other, { type: "terms.accepted" }, { code }),
		).toMatchObject({ error: "step_up_required" });
	});

	test("an action that is refused for other reasons does not spend the code", async () => {
		const { h, borrower } = await setup();
		const code = await codeFor(h, borrower, "payment.disputed");
		expect(
			await h.service.append(
				borrower,
				{
					type: "payment.disputed",
					target: "nope",
					counter_amount_minor: "1",
					reason: "x",
				},
				{ code },
			),
		).toMatchObject({ error: "rejected" });
		const payment = expectOk(await h.service.append(borrower, PAYMENT)).event;
		expect(payment.type).toBe("payment.recorded");
	});

	test("asking for codes is limited, and only a step-up action can ask", async () => {
		const { h, borrower } = await setup();
		for (let index = 0; index < CODE_REQUESTS_PER_WINDOW; index += 1)
			expectOk(await h.service.requestStepUp(borrower, "terms.accepted"));
		expect(
			await h.service.requestStepUp(borrower, "terms.accepted"),
		).toMatchObject({ error: "rate_limited" });
		expect(
			await h.service.requestStepUp(borrower, "payment.recorded"),
		).toMatchObject({ error: "bad_request" });
		h.clock.advance(10 * MINUTE);
		expectOk(await h.service.requestStepUp(borrower, "terms.accepted"));
	});

	test("a mail failure while sending a code is reported", async () => {
		const { h, borrower } = await setup();
		h.mailer.failNext = true;
		expect(
			await h.service.requestStepUp(borrower, "terms.accepted"),
		).toMatchObject({ error: "mail_failed" });
	});
});

describe("creating a note", () => {
	test("the same idempotency key and request is the same note and sends no second email", async () => {
		const h = harness();
		const first = await h.create("same-key");
		const sent = h.mailer.sent.length;
		const again = await h.service.createNote({
			terms: TERMS,
			lender: { email: LENDER_EMAIL },
			borrower: { email: BORROWER_EMAIL },
			idem: "same-key",
		});
		expect(again).toEqual({ ok: true, noteId: first, created: false });
		expect(h.mailer.sent).toHaveLength(sent);
		expect((await h.store.readLog(first)).events).toHaveLength(1);
		expect(await h.create("other-key")).not.toBe(first);
	});

	test("the same key with another request is refused", async () => {
		const h = harness();
		await h.create("k");
		expect(
			await h.service.createNote({
				terms: { ...TERMS, principal_minor: "5" },
				lender: { email: LENDER_EMAIL },
				borrower: { email: BORROWER_EMAIL },
				idem: "k",
			}),
		).toMatchObject({ ok: false, error: "idempotency_conflict" });
		expect(
			await h.service.createNote({
				terms: TERMS,
				lender: { email: LENDER_EMAIL },
				borrower: { email: "someone-else@example.com" },
				idem: "k",
			}),
		).toMatchObject({ ok: false, error: "idempotency_conflict" });
	});

	test("bad terms, bad or equal addresses and a bad key are refused and write nothing", async () => {
		const store = new MemoryNoteStore();
		const h = harness({ store });
		const base = {
			lender: { email: LENDER_EMAIL },
			borrower: { email: BORROWER_EMAIL },
			idem: "k",
		};
		expect(
			await h.service.createNote({
				...base,
				terms: { ...TERMS, principal_minor: "0" },
			}),
		).toMatchObject({ error: "invalid_terms" });
		expect(
			await h.service.createNote({
				...base,
				terms: { ...TERMS, exponent: 1.5 },
			}),
		).toMatchObject({ error: "invalid_terms" });
		expect(
			await h.service.createNote({ ...base, terms: "nope" }),
		).toMatchObject({ error: "invalid_terms" });
		expect(
			await h.service.createNote({
				...base,
				terms: TERMS,
				lender: { email: "nope" },
			}),
		).toMatchObject({ error: "bad_request" });
		expect(
			await h.service.createNote({
				...base,
				terms: TERMS,
				borrower: { email: LENDER_EMAIL.toUpperCase() },
			}),
		).toMatchObject({ error: "same_party" });
		expect(
			await h.service.createNote({ ...base, terms: TERMS, idem: "" }),
		).toMatchObject({ error: "bad_request" });
		expect(
			await h.service.createNote({
				...base,
				terms: TERMS,
				idem: "x".repeat(201),
			}),
		).toMatchObject({ error: "bad_request" });
		expect(h.mailer.sent).toHaveLength(0);
	});

	test("the first event is the lender's note.created, set by the server, with no personal data", async () => {
		const h = harness();
		const noteId = await h.create();
		const [first] = (await h.store.readLog(noteId)).events;
		expect(JSON.parse(first as string)).toMatchObject({
			type: "note.created",
			seq: 1,
			entered_by: "lender",
			note_id: noteId,
			entered_at: "2026-11-22T09:00:00.000Z",
		});
	});

	test("when the mailer fails the note exists, the error says so, and a fresh link can be requested", async () => {
		const h = harness();
		h.mailer.failNext = true;
		const result = await h.service.createNote({
			terms: TERMS,
			lender: { email: LENDER_EMAIL },
			borrower: { email: BORROWER_EMAIL },
			idem: "mailfail",
		});
		expect(result).toMatchObject({ ok: false, error: "mail_failed" });
		const noteId =
			(result as { message: string }).message.match(/nt_[0-9a-f]+/)?.[0] ?? "";
		expect((await h.store.readLog(noteId)).events).toHaveLength(1);
		await h.service.requestLink(noteId, BORROWER_EMAIL);
		expect(
			await h.service.sessions.redeem(
				noteId,
				h.mailer.linkTokenFor(BORROWER_EMAIL),
			),
		).not.toBeNull();
	});
});

describe("two writers at once", () => {
	class RacingStore extends MemoryNoteStore {
		before: (() => Promise<void>)[] = [];
		private inHook = false;
		override async append(
			...args: Parameters<MemoryNoteStore["append"]>
		): Promise<AppendResult> {
			const hook = this.inHook ? undefined : this.before.shift();
			if (hook) {
				this.inHook = true;
				try {
					await hook();
				} finally {
					this.inHook = false;
				}
			}
			return super.append(...args);
		}
	}

	test("a conflict is retried once against the new log and the event lands after the other writer's", async () => {
		const store = new RacingStore();
		const h = harness({ store });
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		const lender = (await h.enter(noteId, "lender")).session;
		store.before = [
			async () =>
				void expectOk(
					await h.service.append(lender, {
						type: "annotation.added",
						text: "first in",
					}),
				),
		];
		const written = expectOk(await h.service.append(borrower, PAYMENT)).event;
		expect(written.seq).toBe(3);
		const { events } = await store.readLog(noteId);
		expect(
			events.map((text) => (JSON.parse(text) as { type: string }).type),
		).toEqual(["note.created", "annotation.added", "payment.recorded"]);
		expect(await chainHolds(h, noteId)).toBe(true);
	});

	test("a second conflict gives up with `conflict` and writes nothing", async () => {
		const store = new RacingStore();
		const h = harness({ store });
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		const lender = (await h.enter(noteId, "lender")).session;
		const intrude = (text: string) => async () =>
			void expectOk(
				await h.service.append(lender, { type: "annotation.added", text }),
			);
		store.before = [intrude("one"), intrude("two")];
		expect(await h.service.append(borrower, PAYMENT)).toMatchObject({
			ok: false,
			error: "conflict",
		});
		expect((await store.readLog(noteId)).events).toHaveLength(3);
		expect(await chainHolds(h, noteId)).toBe(true);
	});

	test("a retry that is no longer valid is refused by the engine, not appended", async () => {
		const store = new RacingStore();
		const h = harness({ store });
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		const lender = (await h.enter(noteId, "lender")).session;
		const payment = expectOk(await h.service.append(borrower, PAYMENT)).event;
		const reversal = {
			type: "payment.recorded",
			kind: "reversal",
			reverses: payment.id,
			amount_minor: "100000",
			value_date: "2026-11-11",
		};
		// The lender's reversal lands first; a payment can be reversed once, so the borrower's retry is refused.
		store.before = [
			async () => void expectOk(await h.service.append(lender, reversal)),
		];
		expect(await h.service.append(borrower, reversal)).toMatchObject({
			ok: false,
			error: "rejected",
		});
		expect((await store.readLog(noteId)).events).toHaveLength(3);
	});

	test("two sessions saving at the same time both land, with distinct seqs and a valid chain", async () => {
		const h = harness();
		const noteId = await h.create();
		const borrower = (await h.enter(noteId, "borrower")).session;
		const lender = (await h.enter(noteId, "lender")).session;
		const results = await Promise.all([
			h.service.append(borrower, {
				type: "annotation.added",
				text: "from borrower",
			}),
			h.service.append(lender, {
				type: "annotation.added",
				text: "from lender",
			}),
		]);
		expect(results.every((result) => result.ok)).toBe(true);
		const { events } = await h.store.readLog(noteId);
		expect(
			events.map((text) => (JSON.parse(text) as { seq: number }).seq),
		).toEqual([1, 2, 3]);
		expect(await chainHolds(h, noteId)).toBe(true);
	});
});

describe("what is stored", () => {
	test("links, sessions and codes are kept as hashes; an address is kept only in the contact record", async () => {
		const db = new Database(":memory:");
		const state = durableState(db);
		migrateNote(state);
		const h = harness({ store: new SqliteNoteStore(state) });
		const noteId = await h.create();
		const linkToken = h.mailer.linkTokenFor(BORROWER_EMAIL);
		const { session, cookie } = await h.enter(noteId, "borrower");
		const code = await codeFor(h, session, "terms.accepted");
		expectOk(
			await h.service.append(session, { type: "terms.accepted" }, { code }),
		);
		await h.service.requestLink(noteId, "guess@example.com");

		const dump = (table: string) =>
			JSON.stringify(db.query(`SELECT * FROM ${table}`).all());
		for (const table of [
			"note_invites",
			"note_sessions",
			"note_codes",
			"note_counters",
			"note_idempotency",
			"note_events",
		]) {
			const text = dump(table);
			expect({
				table,
				leaks: [linkToken, cookie, code, session.hash === cookie].filter(
					(secret) => typeof secret === "string" && text.includes(secret),
				),
			}).toEqual({ table, leaks: [] });
			expect({ table, hasEmail: text.includes("example.com") }).toEqual({
				table,
				hasEmail: false,
			});
		}
		expect(dump("note_contacts")).toContain(BORROWER_EMAIL);
	});
});

describe("the statement for the API", () => {
	test("returns the statement and the chain verdict, and refuses a bad or early date", async () => {
		const h = harness();
		const noteId = await h.create();
		const result = expectOk(await h.service.statementFor(noteId, "2026-12-05"));
		expect(result.statement.as_of).toBe("2026-12-05");
		expect(result.chain).toEqual({ ok: true });
		expect(await h.service.statementFor(noteId, "05/12/2026")).toMatchObject({
			error: "bad_request",
		});
		expect(await h.service.statementFor(noteId, "2026-10-01")).toMatchObject({
			error: "bad_request",
		});
		expect(
			await h.service.statementFor("nt_missing00", undefined),
		).toMatchObject({ error: "not_found" });
		expect(expectOk(await h.service.statementFor(noteId)).statement.as_of).toBe(
			"2026-11-22",
		);
	});
});
