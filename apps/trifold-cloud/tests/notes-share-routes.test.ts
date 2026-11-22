import { beforeAll, describe, expect, test } from "bun:test";
import { REVOKE_NOTICE, sharedView, validateStream } from "tfd-notes";
import { formatAmount } from "../src/notes/pages";
import { notesRoute } from "../src/notes/routes";
import {
	VERIFY_NOT_CONFIGURED_TEXT,
	VERIFY_OK_TEXT,
	VERIFY_TOO_LARGE_TEXT,
} from "../src/notes/share-pages";
import { BORROWER_EMAIL, LEDGER, LENDER_EMAIL } from "./notes-fakes";
import { expectOk, ORG_ID, VIEWER } from "./notes-org-fakes";
import {
	cookieOf,
	DAY,
	OTHER_RECIPIENT,
	RECIPIENT,
	SHARE_COOKIE,
	shareWorld,
	textOf,
	type World,
} from "./notes-share-fakes";
import { type TestSigning, testSigning } from "./notes-signers";

let signing: TestSigning;
beforeAll(async () => {
	signing = await testSigning();
});

const BANNED_CLAIMS =
	/\b(proof|enforceable|binding|tamper-proof|legally|credit|interest-free)\b/i;
const BANNED_FOR_VIEWERS =
	/dispute|overdue|late|unanswered|notice|default|reason|annotation|agent|email|name/i;
const ENDED = "This share has ended.";

/** A note with one agreed payment: the lender recorded 1,000.00, which counts for both sides at once. */
const paidNote = async (w: World, idem = "share-1") => {
	const note = await w.guestNote(idem);
	expectOk(
		await w.h.service.append(note.lender.session, {
			type: "payment.recorded",
			kind: "payment",
			amount_minor: "100000",
			value_date: "2026-11-10",
		}),
	);
	return note;
};

/** Shares a note with `email` as a carve-out (active at once) and opens it as the recipient. */
const openCarveOut = async (
	w: World,
	note: Awaited<ReturnType<typeof paidNote>>,
	level: "summary" | "statement",
	email = RECIPIENT,
	days = 30,
) => {
	expectOk(
		await w.h.service.proposeShare(note.lender.session, {
			recipient_email: email,
			level,
			days,
			carve_out: { purpose: "accountant" },
		}),
	);
	return w.openShare(email);
};

describe("a person share over HTTP", () => {
	for (const level of ["summary", "statement"] as const) {
		test(`${level}: propose, consent with a code, the recipient opens the link once and reads the view`, async () => {
			const w = shareWorld(signing);
			const note = await paidNote(w);
			const proposed = await w.press(note.lender, "propose", {
				recipient_email: RECIPIENT,
				level,
				days: "30",
			});
			expect(proposed.status).toBe(303);
			expect(proposed.headers.get("Location")).toBe(
				`/n/${note.noteId}?m=share_proposed`,
			);
			expect(w.h.mailer.to(RECIPIENT)).toHaveLength(0);
			const grantId = await w.lastGrantId(note.noteId);

			// The other party sees it waiting, with the address masked, and agrees with a code.
			const waiting = await (
				await w.get(note.borrower.base, w.header(note.borrower))
			).text();
			expect(waiting).toContain("Waiting for your agreement");
			expect(waiting).toContain("a*********@f***.example");
			expect(waiting).not.toContain(RECIPIENT);
			const agreed = await w.consent(note.borrower, grantId);
			expect(agreed.status).toBe(303);
			expect(agreed.headers.get("Location")).toBe(
				`/n/${note.noteId}?m=share_consented`,
			);

			const mail = w.h.mailer.to(RECIPIENT);
			expect(mail).toHaveLength(1);
			expect(mail[0]?.subject).toBe("A loan record was shared with you");
			const token = w.h.mailer.linkTokenFor(RECIPIENT);

			// GET shows a button and redeems nothing, however often it is fetched (a mail scanner will).
			for (let attempt = 0; attempt < 3; attempt += 1) {
				const entry = await w.get(
					`/s/${note.noteId}/${grantId}/enter?t=${token}`,
				);
				expect(entry.status).toBe(200);
				expect(entry.headers.get("Set-Cookie")).toBeNull();
				const text = await entry.text();
				expect(text).toContain(`action="/s/${note.noteId}/${grantId}/enter"`);
				expect(text).toContain(`name="t" value="${token}"`);
			}
			expect(
				(await w.h.store.getShare(note.noteId, grantId))?.linkUsedAt,
			).toBeNull();
			const noCookie = await w.get(`/s/${note.noteId}/${grantId}`);
			expect(noCookie.status).toBe(401);

			const opened = await w.post(`/s/${note.noteId}/${grantId}/enter`, {
				t: token,
			});
			expect(opened.status).toBe(303);
			expect(opened.headers.get("Location")).toBe(
				`/s/${note.noteId}/${grantId}`,
			);
			expect(opened.headers.get("Location")).not.toContain(token);
			const cookie = opened.headers.get("Set-Cookie") ?? "";
			expect(cookie).toContain(`${SHARE_COOKIE}=`);
			for (const attribute of ["HttpOnly", "Secure", "SameSite=Lax"])
				expect(cookie).toContain(attribute);
			expect(cookie).toContain(`Path=/s/${note.noteId}/${grantId}`);
			expect(cookie).toContain("Max-Age=43200");
			// The link works once.
			const again = await w.post(`/s/${note.noteId}/${grantId}/enter`, {
				t: token,
			});
			expect(again.status).toBe(400);
			expect(again.headers.get("Set-Cookie")).toBeNull();

			const { header } = cookieOf(opened);
			const view = await w.get(`/s/${note.noteId}/${grantId}`, header);
			expect(view.status).toBe(200);
			expect(view.headers.get("Cache-Control")).toBe("no-store");
			expect(view.headers.get("Content-Security-Policy")).toContain(
				"default-src 'none'",
			);
			const text = await view.text();
			const events = (await w.h.store.readLog(note.noteId)).events.map((line) =>
				JSON.parse(line),
			);
			const shown = sharedView(events, level, "2026-11-22");
			if (shown.level === "verify") throw new Error("unexpected level");
			expect(text).toContain("Shared loan record");
			expect(text).toContain(`${formatAmount(shown.payoff_minor, 2)} USD`);
			expect(text).toContain(`${formatAmount(shown.principal_minor, 2)} USD`);
			expect(text).toContain(`${formatAmount(shown.interest_minor, 2)} USD`);
			expect(text).toContain(
				"Read-only. One of the parties chose to share this.",
			);
			expect(text).not.toMatch(BANNED_CLAIMS);
			if (level === "summary") {
				expect(text).not.toContain("<h2>Installments</h2>");
				expect(text).not.toContain("<h2>Payments</h2>");
				expect(text).not.toContain("1,000.00 USD");
			} else {
				expect(text).toContain("<h2>Installments</h2>");
				expect(text).toContain("<h2>Payments</h2>");
				expect(text).toContain("recorded and counted by both parties");
				expect(text).toContain("1,000.00 USD");
				expect(text).toContain("2026-11-10");
			}
		});
	}
});

describe("a disclosure (carve-out)", () => {
	test("is active on the proposer's consent alone, and the other party's log lists it with a masked address", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		const proposed = await w.press(note.lender, "propose", {
			recipient_email: RECIPIENT,
			level: "statement",
			days: "10",
			carve_out: "1",
			purpose: "accountant",
		});
		expect(proposed.status).toBe(303);
		expect(proposed.headers.get("Location")).toBe(
			`/n/${note.noteId}?m=share_disclosed`,
		);
		const opened = await w.openShare();
		expect(opened.response.status).toBe(303);
		const view = await w.get(
			`/s/${opened.noteId}/${opened.grantId}`,
			opened.header,
		);
		expect(view.status).toBe(200);

		const theirs = await (
			await w.get(note.borrower.base, w.header(note.borrower))
		).text();
		const heading = theirs.indexOf("Disclosures the other party made");
		expect(heading).toBeGreaterThan(-1);
		const after = theirs.slice(heading);
		expect(after).toContain("my accountant or bookkeeper");
		expect(after).toContain("a*********@f***.example");
		expect(after).toContain("active");
		expect(theirs).not.toContain(RECIPIENT);
		expect(theirs).toContain(
			"A person (a*********@f***.example), disclosure for my accountant or bookkeeper",
		);
		expect(theirs).toContain("recorded a disclosure to a named person");
		const mine = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		const mineAfter = mine.slice(mine.indexOf("Disclosures you made"));
		expect(mineAfter).toContain("my accountant or bookkeeper");
		expect(mine).not.toContain(RECIPIENT);
		// Revoking a disclosure does not remove it from the log.
		const grantId = await w.lastGrantId(note.noteId);
		expect(
			(await w.press(note.borrower, "revoke", { grant_id: grantId })).status,
		).toBe(303);
		const log = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		expect(log.slice(log.indexOf("Disclosures you made"))).toContain("ended");
	});

	test("a share that is not a disclosure stays pending until the other party agrees: the viewer has no way in", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		expectOk(
			await w.h.service.proposeShare(note.lender.session, {
				recipient_email: RECIPIENT,
				level: "summary",
			}),
		);
		const grantId = await w.lastGrantId(note.noteId);
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(0);
		expect((await w.get(`/s/${note.noteId}/${grantId}`)).status).toBe(401);
		const guess = await w.post(`/s/${note.noteId}/${grantId}/enter`, {
			t: "guess",
		});
		expect(guess.status).toBe(400);
		const forged = await w.get(
			`/s/${note.noteId}/${grantId}`,
			`${SHARE_COOKIE}=forged`,
		);
		expect(forged.status).toBe(401);
		const lenderPage = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		expect(lenderPage).toContain("waiting for agreement");
		expect(lenderPage).not.toContain("Waiting for your agreement");
	});

	test("a code asked for the share does not unlock another page and consenting twice changes nothing", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		expectOk(
			await w.h.service.proposeShare(note.lender.session, {
				recipient_email: RECIPIENT,
				level: "summary",
			}),
		);
		const grantId = await w.lastGrantId(note.noteId);
		const wrong = await w.press(note.borrower, "consent", {
			grant_id: grantId,
			code: "123456",
		});
		expect(wrong.status).toBe(403);
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(0);
		expect((await w.consent(note.borrower, grantId)).status).toBe(303);
		const second = await w.press(note.borrower, "consent", {
			grant_id: grantId,
		});
		expect(second.status).toBe(422);
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(1);
	});
});

describe("revoking cuts the very next request", () => {
	for (const revoker of ["lender", "borrower"] as const) {
		test(`${revoker} revokes: the page next asked for says it has ended, with no detail`, async () => {
			const w = shareWorld(signing);
			const note = await paidNote(w);
			const opened = await openCarveOut(w, note, "statement");
			const url = `/s/${opened.noteId}/${opened.grantId}`;
			expect((await w.get(url, opened.header)).status).toBe(200);
			const party = note[revoker];
			const panel = await (await w.get(party.base, w.header(party))).text();
			expect(panel).toContain(REVOKE_NOTICE);
			expect(panel).toContain(`name="grant_id" value="${opened.grantId}"`);
			const revoked = await w.press(party, "revoke", {
				grant_id: opened.grantId,
			});
			expect(revoked.status).toBe(303);
			expect(revoked.headers.get("Location")).toBe(
				`/n/${note.noteId}?m=share_revoked`,
			);
			const cut = await w.get(url, opened.header);
			expect(cut.status).toBe(404);
			expect(cut.headers.get("Set-Cookie")).toContain("Max-Age=0");
			const text = textOf(await cut.text());
			expect(text).toContain(ENDED);
			expect(text).not.toContain("USD");
			expect(text).not.toMatch(/revoked|expired|lender|borrower/i);
			// The same page for a new request without the cookie asks to open the link, and shows nothing either.
			expect((await w.get(url)).status).toBe(401);
			// The link cannot be used again, and a new session cannot be had.
			const retry = await w.post(
				`/s/${opened.noteId}/${opened.grantId}/enter`,
				{
					t: opened.token,
				},
			);
			expect(retry.status).toBe(400);
		});
	}

	test("a revoked share has no revoke button, and the page names the grant that is still live", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		await openCarveOut(w, note, "summary");
		await openCarveOut(w, note, "summary", OTHER_RECIPIENT);
		const first = (await w.events(note.noteId)).find(
			(event) => event.type === "visibility.changed",
		);
		const firstId = (first as unknown as { grant_id: string }).grant_id;
		await w.press(note.lender, "revoke", { grant_id: firstId });
		const panel = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		expect(panel.match(/>Revoke<\/button>/g)).toHaveLength(1);
		const refused = await w.press(note.lender, "revoke", { grant_id: firstId });
		expect(refused.status).toBe(422);
	});
});

describe("expiry", () => {
	test("access ends at the expiry instant exactly, and a session never outlives its grant", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		expectOk(
			await w.h.service.proposeShare(note.lender.session, {
				recipient_email: RECIPIENT,
				level: "summary",
				days: 1,
				carve_out: { purpose: "accountant" },
			}),
		);
		const grantId = await w.lastGrantId(note.noteId);
		const proposal = (await w.events(note.noteId)).at(-1) as unknown as {
			expires_at: string;
		};
		const end = Date.parse(proposal.expires_at);
		expect(end - Date.parse(w.h.clock.now())).toBe(DAY);
		// One hour before the end: the session is capped at what is left of the grant, not twelve hours.
		w.h.clock.set(new Date(end - 3_600_000).toISOString());
		const opened = await w.openShare();
		expect(opened.response.headers.get("Set-Cookie")).toContain("Max-Age=3600");
		const url = `/s/${note.noteId}/${grantId}`;
		w.h.clock.set(new Date(end - 1).toISOString());
		expect((await w.get(url, opened.header)).status).toBe(200);
		w.h.clock.set(new Date(end).toISOString());
		const cut = await w.get(url, opened.header);
		expect(cut.status).not.toBe(200);
		expect(textOf(await cut.text())).not.toContain("USD");
		w.h.clock.set(new Date(end + 1).toISOString());
		expect((await w.get(url, opened.header)).status).not.toBe(200);
	});

	test("a grant that ends before the session does cuts access while the session lives", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		const opened = await openCarveOut(w, note, "summary", RECIPIENT, 1);
		const url = `/s/${opened.noteId}/${opened.grantId}`;
		// A 24 hour grant with a 12 hour session: the session ends first.
		expect(opened.response.headers.get("Set-Cookie")).toContain(
			"Max-Age=43200",
		);
		w.h.clock.advance(12 * 3_600_000 - 1);
		expect((await w.get(url, opened.header)).status).toBe(200);
		w.h.clock.advance(1);
		expect((await w.get(url, opened.header)).status).toBe(401);
	});

	test("365 days is the most a share lasts, and the form says so", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		const tooLong = await w.press(note.lender, "propose", {
			recipient_email: RECIPIENT,
			level: "summary",
			days: "366",
		});
		expect(tooLong.status).toBe(400);
		expect(await w.events(note.noteId)).toHaveLength(2);
		const ok = await w.press(note.lender, "propose", {
			recipient_email: RECIPIENT,
			level: "summary",
			days: "365",
		});
		expect(ok.status).toBe(303);
		const events = (await w.h.store.readLog(note.noteId)).events.map((line) =>
			JSON.parse(line),
		);
		expect(() => validateStream(events)).not.toThrow();
		for (const bad of ["0", "-3", "1e3", "abc", "7.5"]) {
			const refused = await w.press(note.lender, "propose", {
				recipient_email: RECIPIENT,
				level: "summary",
				days: bad,
			});
			expect({ bad, status: refused.status }).toEqual({ bad, status: 400 });
		}
		const panel = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		expect(panel).toContain('max="365"');
	});
});

describe("links and sessions", () => {
	test("a token opens its own grant of its own note, once", async () => {
		const w = shareWorld(signing);
		const first = await paidNote(w, "n-1");
		const second = await paidNote(w, "n-2");
		expectOk(
			await w.h.service.proposeShare(first.lender.session, {
				recipient_email: RECIPIENT,
				level: "summary",
				carve_out: { purpose: "accountant" },
			}),
		);
		const tokenA = w.h.mailer.linkTokenFor(RECIPIENT);
		const grantA = await w.lastGrantId(first.noteId);
		expectOk(
			await w.h.service.proposeShare(first.lender.session, {
				recipient_email: OTHER_RECIPIENT,
				level: "summary",
				carve_out: { purpose: "lawyer" },
			}),
		);
		const tokenB = w.h.mailer.linkTokenFor(OTHER_RECIPIENT);
		const grantB = await w.lastGrantId(first.noteId);
		expectOk(
			await w.h.service.proposeShare(second.lender.session, {
				recipient_email: "third@other.example",
				level: "summary",
				carve_out: { purpose: "other" },
			}),
		);
		const grantC = await w.lastGrantId(second.noteId);

		// A's token at B's address, and at another note's address, opens nothing and burns nothing.
		const wrongGrant = await w.post(`/s/${first.noteId}/${grantB}/enter`, {
			t: tokenA,
		});
		expect(wrongGrant.status).toBe(400);
		const wrongNote = await w.post(`/s/${second.noteId}/${grantA}/enter`, {
			t: tokenA,
		});
		expect(wrongNote.status).toBe(400);
		const wrongNoteRealGrant = await w.post(
			`/s/${second.noteId}/${grantC}/enter`,
			{
				t: tokenA,
			},
		);
		expect(wrongNoteRealGrant.status).toBe(400);
		expect(
			(await w.post(`/s/${first.noteId}/${grantA}/enter`, { t: "x" })).status,
		).toBe(400);
		expect(
			(await w.post(`/s/${first.noteId}/${grantA}/enter`, {})).status,
		).toBe(400);

		const openedA = await w.post(`/s/${first.noteId}/${grantA}/enter`, {
			t: tokenA,
		});
		expect(openedA.status).toBe(303);
		const openedB = await w.post(`/s/${first.noteId}/${grantB}/enter`, {
			t: tokenB,
		});
		expect(openedB.status).toBe(303);
		const cookieA = cookieOf(openedA).header;
		const cookieB = cookieOf(openedB).header;
		// A's session reads A's grant only, whatever path it is sent to.
		expect((await w.get(`/s/${first.noteId}/${grantA}`, cookieA)).status).toBe(
			200,
		);
		expect((await w.get(`/s/${first.noteId}/${grantB}`, cookieA)).status).toBe(
			401,
		);
		expect((await w.get(`/s/${second.noteId}/${grantC}`, cookieA)).status).toBe(
			401,
		);
		expect((await w.get(`/s/${first.noteId}/${grantB}`, cookieB)).status).toBe(
			200,
		);
		// A session of another note's storage never answers: the cookie names a hash this note does not hold.
		expect((await w.get(`/s/${second.noteId}/${grantA}`, cookieA)).status).toBe(
			401,
		);
	});

	test("a cross-site form post cannot redeem a link", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		await openCarveOut(w, note, "summary");
		const token = w.h.mailer.linkTokenFor(RECIPIENT);
		const grantId = await w.lastGrantId(note.noteId);
		const response = await w.ledger(`/s/${note.noteId}/${grantId}/enter`, {
			method: "POST",
			body: new URLSearchParams({ t: token }),
			headers: { Origin: "https://evil.example" },
		});
		expect(response.status).toBe(403);
	});
});

describe("a share session is read-only", () => {
	test("posts to its page and every party route are refused, and its cookie opens no party page", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		const opened = await openCarveOut(w, note, "statement");
		const before = (await w.events(note.noteId)).length;
		const url = `/s/${opened.noteId}/${opened.grantId}`;
		for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
			const response = await w.ledger(url, {
				method,
				body: method === "DELETE" ? null : new URLSearchParams({ csrf: "x" }),
				headers: { Cookie: opened.header },
			});
			expect({ method, status: response.status }).toEqual({
				method,
				status: 403,
			});
		}
		const sessionCookie = { Cookie: opened.header };
		const refused: [string, RequestInit][] = [
			[`/n/${note.noteId}`, {}],
			[
				`/n/${note.noteId}/act`,
				{
					method: "POST",
					body: new URLSearchParams({ type: "payment.recorded" }),
				},
			],
			[
				`/n/${note.noteId}/share/revoke`,
				{
					method: "POST",
					body: new URLSearchParams({ grant_id: opened.grantId }),
				},
			],
			[
				`/n/${note.noteId}/share/propose`,
				{
					method: "POST",
					body: new URLSearchParams({
						recipient_email: "z@z.example",
						level: "summary",
					}),
				},
			],
			[`/n/${note.noteId}/bundle.json`, {}],
			[`/o/${ORG_ID}`, {}],
			[`/o/${ORG_ID}/n/${note.noteId}`, {}],
			[
				`/o/${ORG_ID}/n/${note.noteId}/share/revoke`,
				{
					method: "POST",
					body: new URLSearchParams({ grant_id: opened.grantId }),
				},
			],
		];
		for (const [path, init] of refused) {
			const response = await w.ledger(path, {
				...init,
				headers: sessionCookie,
			});
			expect({ path, status: response.status }).toEqual({ path, status: 403 });
			expect(await response.text()).not.toContain("1,000.00");
		}
		expect(await w.events(note.noteId)).toHaveLength(before);
		// And the grant is still live: nothing the viewer sent changed it.
		expect((await w.get(url, opened.header)).status).toBe(200);
	});
});

/** Applies one kind of event the shared view must not show. */
type Mutation = (
	w: World,
	note: Awaited<ReturnType<typeof paidNote>>,
) => Promise<void>;

const codeFor = async (
	w: World,
	party: { session: never; email: string },
	action: string,
) => {
	expectOk(await w.h.service.requestStepUp(party.session, action));
	return w.h.mailer.codeFor(party.email);
};

const MUTATIONS: Record<string, Mutation> = {
	"an unanswered claim of the borrower": async (w, note) => {
		expectOk(
			await w.h.service.append(note.borrower.session, {
				type: "payment.recorded",
				kind: "payment",
				amount_minor: "50000",
				value_date: "2026-11-15",
			}),
		);
	},
	"a disputed payment of the lender": async (w, note) => {
		const recorded = expectOk(
			await w.h.service.append(note.lender.session, {
				type: "payment.recorded",
				kind: "payment",
				amount_minor: "20000",
				value_date: "2026-11-12",
			}),
		);
		const code = await codeFor(w, note.borrower as never, "payment.disputed");
		expectOk(
			await w.h.service.append(
				note.borrower.session,
				{
					type: "payment.disputed",
					target: recorded.event.id,
					counter_amount_minor: "10000",
					reason: "I paid less",
				},
				{ code },
			),
		);
	},
	"a reminder notice": async (w, note) => {
		expectOk(
			await w.h.service.sendNotice(note.lender.session, { kind: "reminder" }),
		);
	},
	"a default notice": async (w, note) => {
		const code = await codeFor(w, note.lender as never, "notice.sent");
		expectOk(
			await w.h.service.sendNotice(
				note.lender.session,
				{ kind: "default", cure_days: 10 },
				{ code },
			),
		);
	},
	"an annotation": async (w, note) => {
		expectOk(
			await w.h.service.append(note.borrower.session, {
				type: "annotation.added",
				text: "We talked about this on the phone.",
			}),
		);
	},
	"a release draft": async (w, note) => {
		expectOk(await w.h.service.draftRelease(note.lender.session));
	},
};

/** The share pages of a fresh note after `mutate`, at both levels. */
const sharePages = async (w: World, idem: string, mutate?: Mutation) => {
	const note = await paidNote(w, idem);
	if (mutate) await mutate(w, note);
	const pages: Record<string, string> = {};
	for (const [level, email] of [
		["summary", RECIPIENT],
		["statement", OTHER_RECIPIENT],
	] as const) {
		const opened = await openCarveOut(w, note, level, email);
		const response = await w.get(
			`/s/${opened.noteId}/${opened.grantId}`,
			opened.header,
		);
		expect(response.status).toBe(200);
		pages[level] = await response.text();
	}
	return pages;
};

describe("the ceiling: what a share viewer can never see", () => {
	test("the page is byte-identical with and without each kind of negative event", async () => {
		const w = shareWorld(signing);
		const baseline = await sharePages(w, "baseline");
		expect(baseline.statement).toContain("1,000.00 USD");
		let index = 0;
		for (const [name, mutate] of Object.entries(MUTATIONS)) {
			index += 1;
			const pages = await sharePages(w, `mutated-${index}`, mutate);
			expect({
				name,
				level: "summary",
				same: pages.summary === baseline.summary,
			}).toEqual({
				name,
				level: "summary",
				same: true,
			});
			expect({
				name,
				level: "statement",
				same: pages.statement === baseline.statement,
			}).toEqual({
				name,
				level: "statement",
				same: true,
			});
		}
	});

	test("control: a payment both parties count does reach the page, so the comparison can fail", async () => {
		const w = shareWorld(signing);
		const baseline = await sharePages(w, "baseline");
		const pages = await sharePages(w, "counted", async (world, note) => {
			expectOk(
				await world.h.service.append(note.lender.session, {
					type: "payment.recorded",
					kind: "payment",
					amount_minor: "20000",
					value_date: "2026-11-12",
				}),
			);
		});
		expect(pages.summary).not.toBe(baseline.summary);
		expect(pages.statement).not.toBe(baseline.statement);
		expect(pages.statement).toContain("200.00 USD");
	});

	test("all of them together change nothing, and none of their words or amounts reach the page", async () => {
		const w = shareWorld(signing);
		const baseline = await sharePages(w, "baseline");
		const everything: Mutation = async (world, note) => {
			for (const mutate of Object.values(MUTATIONS)) await mutate(world, note);
		};
		const pages = await sharePages(w, "everything", everything);
		expect(pages.summary).toBe(baseline.summary);
		expect(pages.statement).toBe(baseline.statement);
		for (const html of Object.values(pages)) {
			for (const leaked of [
				"I paid less",
				"phone",
				"500.00",
				"200.00",
				"100.00 USD",
				"unanswered",
				"cure",
			])
				expect({ leaked, found: html.includes(leaked) }).toEqual({
					leaked,
					found: false,
				});
		}
	});

	test("a confirmed release changes the status and nothing else", async () => {
		const w = shareWorld(signing);
		const baselineNote = await paidNote(w, "baseline");
		const releasedNote = await paidNote(w, "released");
		const draft = expectOk(
			await w.h.service.draftRelease(releasedNote.lender.session),
		);
		w.h.clock.advance(DAY);
		const code = await codeFor(
			w,
			releasedNote.lender as never,
			"release.confirmed",
		);
		expectOk(
			await w.h.service.confirmRelease(
				releasedNote.lender.session,
				draft.event.id,
				{ code },
			),
		);
		const read = async (
			note: typeof baselineNote,
			level: "summary" | "statement",
			email: string,
		) => {
			const opened = await openCarveOut(w, note, level, email);
			return (
				await w.get(`/s/${opened.noteId}/${opened.grantId}`, opened.header)
			).text();
		};
		for (const [level, email] of [
			["summary", RECIPIENT],
			["statement", OTHER_RECIPIENT],
		] as const) {
			const plain = await read(baselineNote, level, email);
			const released = await read(releasedNote, level, email);
			expect(plain).toContain("<dd>open</dd>");
			expect(released).toContain("<dd>closed</dd>");
			expect(released.replace("<dd>closed</dd>", "<dd>open</dd>")).toBe(plain);
		}
	});

	test("the banned-words walk: no share page speaks of disputes, ages, notices, notes, agents, addresses or names", async () => {
		const w = shareWorld(signing);
		const everything: Mutation = async (world, note) => {
			for (const mutate of Object.values(MUTATIONS)) await mutate(world, note);
		};
		const pages = await sharePages(w, "walk", everything);
		const note = await paidNote(w, "walk-2");
		const opened = await openCarveOut(w, note, "statement", "walker@x.example");
		const entry = await w.get(
			`/s/${opened.noteId}/${opened.grantId}/enter?t=${opened.token}`,
		);
		const signIn = await w.get(`/s/${opened.noteId}/${opened.grantId}`);
		await w.press(note.lender, "revoke", { grant_id: opened.grantId });
		const ended = await w.get(
			`/s/${opened.noteId}/${opened.grantId}`,
			opened.header,
		);
		const invalid = await w.post(
			`/s/${opened.noteId}/${opened.grantId}/enter`,
			{ t: "x" },
		);
		const texts = [
			pages.summary,
			pages.statement,
			await entry.text(),
			await signIn.text(),
			await ended.text(),
			await invalid.text(),
		].map(textOf);
		for (const text of texts) {
			expect({ hit: BANNED_FOR_VIEWERS.exec(text)?.[0] ?? null, text }).toEqual(
				{
					hit: null,
					text,
				},
			);
			expect(text).not.toMatch(BANNED_CLAIMS);
			expect(text).not.toMatch(/maria|ana@|@example|firm\.example/i);
		}
	});

	test("the shared view carries nothing the viewer functions do not take: ids, event ids and masked or full addresses stay out", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		const opened = await openCarveOut(w, note, "statement");
		const html = await (
			await w.get(`/s/${opened.noteId}/${opened.grantId}`, opened.header)
		).text();
		const events = await w.events(note.noteId);
		for (const event of events) expect(html).not.toContain(event.id);
		expect(html).not.toContain(note.noteId);
		expect(html).not.toContain(opened.grantId);
		expect(html).not.toContain("a*********@");
		expect(html).not.toContain(RECIPIENT);
	});
});

describe("recipient addresses", () => {
	test("never appear in an event, a bundle or a page of either party, in full", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		await openCarveOut(w, note, "statement");
		expectOk(
			await w.h.service.proposeShare(note.borrower.session, {
				recipient_email: OTHER_RECIPIENT,
				level: "summary",
			}),
		);
		const log = (await w.h.store.readLog(note.noteId)).events.join("\n");
		for (const address of [
			RECIPIENT,
			OTHER_RECIPIENT,
			"firm.example",
			"counsel.example",
		])
			expect(log).not.toContain(address);
		const pages = [
			await (await w.get(note.lender.base, w.header(note.lender))).text(),
			await (await w.get(note.borrower.base, w.header(note.borrower))).text(),
			await (
				await w.get(`${note.lender.base}/bundle.json`, w.header(note.lender))
			).text(),
			await (
				await w.get(
					`${note.borrower.base}/bundle.json`,
					w.header(note.borrower),
				)
			).text(),
		];
		for (const text of pages)
			for (const address of [RECIPIENT, OTHER_RECIPIENT])
				expect(text).not.toContain(address);
		// Both sides see the same masked list.
		const rows = (text: string) =>
			[...text.matchAll(/<td>A person \(([^)]+)\)/g)].map((match) => match[1]);
		expect(rows(pages[0] as string)).toEqual(rows(pages[1] as string));
		expect(rows(pages[0] as string)).toEqual([
			"a*********@f***.example",
			"l*****@c******.example",
		]);
		for (const text of pages) {
			expect(text).not.toContain(LENDER_EMAIL);
			expect(text).not.toContain(BORROWER_EMAIL);
		}
	});

	test("what is shown is escaped", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		expectOk(
			await w.h.service.proposeShare(note.lender.session, {
				recipient_email: "&hack@example.com",
				level: "summary",
			}),
		);
		const page = await (
			await w.get(note.borrower.base, w.header(note.borrower))
		).text();
		expect(page).toContain("&amp;****@e******.com");
		expect(page).not.toContain("(&****");
		expect(page).not.toMatch(/<script|<img|\sstyle="|<[^>]*\son[a-z]+=/i);
	});
});

describe("the verify link", () => {
	/** A link proposed by the lender, agreed by the borrower, shown once; plus two issued documents. */
	const linkWorld = async (publicKeys?: Parameters<typeof shareWorld>[1]) => {
		const w = shareWorld(signing, publicKeys);
		const note = await paidNote(w);
		const payoff = expectOk(
			await w.h.service.issuePayoff(note.lender.session, "2026-11-22"),
		);
		const made = await w.press(note.lender, "verify-link", { days: "30" });
		expect(made.status).toBe(303);
		expect(made.headers.get("Location")).toBe(
			`/n/${note.noteId}?m=share_link_proposed`,
		);
		const grantId = await w.lastGrantId(note.noteId);
		return { w, note, payoff, grantId };
	};

	test("the token is shown once, after the other party agrees, in a page the browser must not keep", async () => {
		const { w, note, grantId } = await linkWorld();
		// Pending: nothing to show yet.
		const early = await w.press(note.lender, "reveal", { grant_id: grantId });
		expect(early.status).toBe(404);
		expect((await w.consent(note.borrower, grantId)).status).toBe(303);
		const panel = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		expect(panel).toContain("Show the link once");
		expect(
			await (await w.get(note.borrower.base, w.header(note.borrower))).text(),
		).not.toContain("Show the link once");
		const other = await w.press(note.borrower, "reveal", { grant_id: grantId });
		expect(other.status).toBe(404);
		const shown = await w.press(note.lender, "reveal", { grant_id: grantId });
		expect(shown.status).toBe(200);
		expect(shown.headers.get("Cache-Control")).toBe("no-store");
		expect(shown.headers.get("Referrer-Policy")).toBe("no-referrer");
		const text = await shown.text();
		const url = /(https:\/\/[^\s<]+\/v\/[A-Za-z0-9_.-]+)/.exec(text)?.[1] ?? "";
		expect(url).toContain(`/v/${note.noteId}.`);
		expect(text).toContain("This is the only time it is shown.");
		const twice = await w.press(note.lender, "reveal", { grant_id: grantId });
		expect(twice.status).toBe(422);
		expect(await twice.text()).not.toContain(url);
		const gone = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		expect(gone).not.toContain("Show the link once");
		expect(gone).not.toContain(url);
		expect(
			await (await w.get(`${note.lender.base}`, w.header(note.lender))).text(),
		).not.toContain(url.split("/v/")[1] as string);
	});

	test("GET /v/:token shows the record id and the issued documents and no money, party or balance", async () => {
		const { w, note, payoff, grantId } = await linkWorld();
		await w.consent(note.borrower, grantId);
		const text = await (
			await w.press(note.lender, "reveal", { grant_id: grantId })
		).text();
		const path = new URL(
			/(https:\/\/[^\s<]+\/v\/[A-Za-z0-9_.-]+)/.exec(text)?.[1] ?? "",
		).pathname;
		const response = await w.get(path);
		expect(response.status).toBe(200);
		expect(response.headers.get("Set-Cookie")).toBeNull();
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		const page = await response.text();
		expect(page).toContain(note.noteId);
		expect(page).toContain(payoff.document.sha256);
		expect(page).toContain("note-test-1");
		expect(page).toContain("Payoff statement");
		expect(page).toContain("The check runs on our server");
		expect(page).toContain("tfd-verify-notes");
		const visible = textOf(page);
		for (const leak of [
			"USD",
			"9,012",
			"Owed",
			"Principal",
			"Interest",
			"lender",
			"borrower",
			"maria",
			"ana@",
		])
			expect({
				leak,
				found: visible.toLowerCase().includes(leak.toLowerCase()),
			}).toEqual({ leak, found: false });
		expect(visible).not.toMatch(/\d,\d{3}/);
		expect(visible).not.toMatch(BANNED_CLAIMS);
		// A verify link opens no note: the same token at a share or party address does nothing.
		expect((await w.get(`/s/${note.noteId}/${grantId}`)).status).toBe(401);
	});

	const checkWith = async (
		w: World,
		path: string,
		body: string,
		headers: Record<string, string> = {
			"Content-Type": "application/x-www-form-urlencoded",
		},
	) => w.ledger(path, { method: "POST", body, headers });

	test("a good pasted document verifies; an edited one, another note's and a non-document fail; nothing is kept", async () => {
		const { w, note, payoff, grantId } = await linkWorld();
		await w.consent(note.borrower, grantId);
		const path = new URL(
			/(https:\/\/[^\s<]+\/v\/[A-Za-z0-9_.-]+)/.exec(
				await (
					await w.press(note.lender, "reveal", { grant_id: grantId })
				).text(),
			)?.[1] ?? "",
		).pathname;
		const form = (document: string) =>
			new URLSearchParams({ document }).toString();

		const good = await checkWith(w, path, form(payoff.document.json));
		expect(good.status).toBe(200);
		const goodText = await good.text();
		expect(goodText).toContain(VERIFY_OK_TEXT);
		expect(goodText).toContain("note.payoff-statement");
		expect(textOf(goodText)).not.toMatch(/USD|\d,\d{3}/);

		// Sent as JSON, the whole body is the document.
		const asJson = await checkWith(w, path, payoff.document.json, {
			"Content-Type": "application/json",
		});
		expect(await asJson.text()).toContain(VERIFY_OK_TEXT);

		const body = JSON.parse(payoff.document.json) as {
			lender: { payoff_minor: string };
		};
		body.lender.payoff_minor = "1";
		const tampered = await checkWith(w, path, form(JSON.stringify(body)));
		const tamperedText = await tampered.text();
		expect(tamperedText).not.toContain(VERIFY_OK_TEXT);
		expect(tamperedText).toMatch(
			/The check failed: (bad_signature|not_canonical)/,
		);

		const garbage = await checkWith(w, path, form("not json at all"));
		expect(await garbage.text()).toContain("The check failed: not_json");
		const empty = await checkWith(w, path, form(""));
		expect(await empty.text()).toContain("The check failed: not_json");
		const array = await checkWith(w, path, form("[]"));
		expect(await array.text()).toMatch(/The check failed: /);

		// A signed document of another note verifies as a signature but is refused for this record.
		const other = await w.guestNote("other-note");
		const foreign = expectOk(
			await w.h.service.issuePayoff(other.lender.session, "2026-11-22"),
		);
		const foreignResult = await (
			await checkWith(w, path, form(foreign.document.json))
		).text();
		expect(foreignResult).toContain("The check failed: other_record");
		expect(foreignResult).not.toContain(VERIFY_OK_TEXT);

		// Nothing is stored: the store holds the same documents and the same events as before the checks.
		expect(await w.h.store.listDocuments(note.noteId)).toHaveLength(1);
	});

	test("a body over 64 KB is refused whole, and an oversize document in the field is too", async () => {
		const { w, note, grantId } = await linkWorld();
		await w.consent(note.borrower, grantId);
		const path = new URL(
			/(https:\/\/[^\s<]+\/v\/[A-Za-z0-9_.-]+)/.exec(
				await (
					await w.press(note.lender, "reveal", { grant_id: grantId })
				).text(),
			)?.[1] ?? "",
		).pathname;
		const big = `document=${"a".repeat(70 * 1024)}`;
		const declared = await checkWith(w, path, big, {
			"Content-Type": "application/x-www-form-urlencoded",
			"Content-Length": String(big.length),
		});
		expect(declared.status).toBe(413);
		expect(await declared.text()).toContain(VERIFY_TOO_LARGE_TEXT);
		// No Content-Length (chunked): the read itself stops at the limit.
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				const chunk = new TextEncoder().encode(
					`document=${"b".repeat(16 * 1024)}`,
				);
				for (let count = 0; count < 6; count += 1) controller.enqueue(chunk);
				controller.close();
			},
		});
		const chunked = await w.ledger(path, {
			method: "POST",
			body: stream,
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			// @ts-expect-error Bun needs duplex for a streamed request body
			duplex: "half",
		});
		expect(chunked.status).toBe(413);
		const exact = `document=${"c".repeat(60 * 1024)}`;
		const within = await checkWith(w, path, exact);
		expect(within.status).toBe(200);
		expect(await within.text()).toContain("The check failed: not_json");
	});

	test("the page says so when the published keys are not configured", async () => {
		const { w, note, payoff, grantId } = await linkWorld({
			publicKeys: { get: async () => null },
		});
		await w.consent(note.borrower, grantId);
		const path = new URL(
			/(https:\/\/[^\s<]+\/v\/[A-Za-z0-9_.-]+)/.exec(
				await (
					await w.press(note.lender, "reveal", { grant_id: grantId })
				).text(),
			)?.[1] ?? "",
		).pathname;
		const result = await checkWith(
			w,
			path,
			new URLSearchParams({ document: payoff.document.json }).toString(),
		);
		expect(await result.text()).toContain(VERIFY_NOT_CONFIGURED_TEXT);
	});

	test("the keys come from NOTES_PUBLIC_KEYS_JSON in the Worker, and a bad value counts as not configured", async () => {
		const keysJson = JSON.stringify(signing.keys);
		for (const [value, expected] of [
			[keysJson, VERIFY_OK_TEXT],
			[undefined, VERIFY_NOT_CONFIGURED_TEXT],
			["", VERIFY_NOT_CONFIGURED_TEXT],
			["{nope", VERIFY_NOT_CONFIGURED_TEXT],
			["[]", VERIFY_NOT_CONFIGURED_TEXT],
		] as const) {
			const { w, note, payoff, grantId } = await linkWorld({
				publicKeys: undefined,
			});
			await w.consent(note.borrower, grantId);
			const path = new URL(
				/(https:\/\/[^\s<]+\/v\/[A-Za-z0-9_.-]+)/.exec(
					await (
						await w.press(note.lender, "reveal", { grant_id: grantId })
					).text(),
				)?.[1] ?? "",
			).pathname;
			// Rebuild the world's deps with the real adapter reading the env var.
			const { publicKeysFromEnv } = await import("../src/notes/share-access");
			const reading = shareWorld(
				signing,
				{},
				{
					...(value === undefined ? {} : { NOTES_PUBLIC_KEYS_JSON: value }),
				},
			);
			reading.deps.store = w.h.store;
			reading.deps.mailer = w.h.mailer;
			reading.deps.clock = w.h.clock;
			reading.deps.ids = w.h.ids;
			reading.deps.orgs = w.h.orgs;
			reading.deps.publicKeys = publicKeysFromEnv(reading.env);
			const result = await reading.ledger(path, {
				method: "POST",
				body: new URLSearchParams({ document: payoff.document.json }),
			});
			expect({ value, text: (await result.text()).includes(expected) }).toEqual(
				{ value, text: true },
			);
		}
	});

	test("the link ends when either party revokes it, at its expiry instant, and for a wrong token", async () => {
		const { w, note, grantId } = await linkWorld();
		await w.consent(note.borrower, grantId);
		const url =
			/(https:\/\/[^\s<]+\/v\/[A-Za-z0-9_.-]+)/.exec(
				await (
					await w.press(note.lender, "reveal", { grant_id: grantId })
				).text(),
			)?.[1] ?? "";
		const path = new URL(url).pathname;
		expect((await w.get(path)).status).toBe(200);
		const [, secret = ""] = path.split("/v/")[1]?.split(".") ?? [];
		for (const wrong of [
			`/v/${note.noteId}.${"z".repeat(secret.length)}`,
			`/v/${note.noteId}`,
			`/v/${secret}`,
			`/v/other-note-id.${secret}`,
		]) {
			const response = await w.get(wrong);
			expect({ wrong, status: response.status }).toEqual({
				wrong,
				status: 404,
			});
			expect(textOf(await response.text())).toContain(ENDED);
		}
		const proposal = (await w.events(note.noteId)).find(
			(event) => event.type === "visibility.changed",
		) as unknown as { expires_at: string };
		const end = Date.parse(proposal.expires_at);
		w.h.clock.set(new Date(end - 1).toISOString());
		expect((await w.get(path)).status).toBe(200);
		w.h.clock.set(new Date(end).toISOString());
		expect((await w.get(path)).status).toBe(404);
		w.h.clock.set("2026-11-22T09:00:00.000Z");
		expect((await w.get(path)).status).toBe(200);
		expect(
			(await w.press(note.borrower, "revoke", { grant_id: grantId })).status,
		).toBe(303);
		expect((await w.get(path)).status).toBe(404);
		const post = await checkWith(w, path, "document=x");
		expect(post.status).toBe(404);
	});

	test("a verify link cannot widen: it never reads a note page, a share page or a bundle", async () => {
		const { w, note, grantId } = await linkWorld();
		await w.consent(note.borrower, grantId);
		const token =
			/\/v\/([A-Za-z0-9_.-]+)/.exec(
				await (
					await w.press(note.lender, "reveal", { grant_id: grantId })
				).text(),
			)?.[1] ?? "";
		for (const path of [
			`/n/${note.noteId}`,
			`/n/${note.noteId}/bundle.json`,
			`/s/${note.noteId}/${grantId}`,
			`/s/${note.noteId}/${grantId}/enter?t=${token}`,
		]) {
			const response = await w.get(path, `${SHARE_COOKIE}=${token}`);
			expect({
				path,
				ok:
					response.status === 200 &&
					(await response.clone().text()).includes("USD"),
			}).toEqual({ path, ok: false });
		}
		const viaEnter = await w.post(`/s/${note.noteId}/${grantId}/enter`, {
			t: token,
		});
		expect(viaEnter.status).toBe(400);
	});
});

describe("an organization lender over HTTP", () => {
	const orgWorld = async () => {
		const w = shareWorld(signing);
		const created = await w.h.createOrgNote();
		const noteId = created.noteId;
		const treasurer = await w.openAgent(noteId, "tess@coop.test");
		const board = await w.openAgent(noteId, "bo@coop.test");
		const viewer = await w.openAgent(noteId, VIEWER);
		const borrower = await w.openGuest(noteId, "borrower", BORROWER_EMAIL);
		return { w, noteId, treasurer, board, viewer, borrower };
	};

	test("a viewer cannot propose; a treasurer can; the borrower agrees; the panel shows the lender's team, not an agent", async () => {
		const { w, noteId, treasurer, viewer, borrower, board } = await orgWorld();
		const refused = await w.press(viewer, "propose", {
			recipient_email: RECIPIENT,
			level: "summary",
		});
		expect(refused.status).toBe(403);
		expect(await w.events(noteId)).toHaveLength(1);
		const proposed = await w.press(treasurer, "propose", {
			recipient_email: RECIPIENT,
			level: "statement",
			days: "20",
		});
		expect(proposed.status).toBe(303);
		expect(proposed.headers.get("Location")).toBe(
			`${treasurer.base}?m=share_proposed`,
		);
		const grantId = await w.lastGrantId(noteId);
		// The same side cannot answer for the other.
		const same = await w.press(board, "consent", { grant_id: grantId });
		expect(same.status).not.toBe(303);
		expect((await w.consent(borrower, grantId)).status).toBe(303);
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(1);
		const opened = await w.openShare();
		expect(
			(await w.get(`/s/${opened.noteId}/${opened.grantId}`, opened.header))
				.status,
		).toBe(200);

		const boardPage = await (await w.get(board.base, w.header(board))).text();
		expect(boardPage).toContain("<h2>Sharing</h2>");
		expect(boardPage).toContain("the lender&#39;s team");
		expect(boardPage).toContain(`action="${board.base}/share/revoke"`);
		const viewerPage = await (
			await w.get(viewer.base, w.header(viewer))
		).text();
		expect(viewerPage).toContain("<h2>Sharing</h2>");
		expect(viewerPage).toContain(
			"A viewer can read this list but not change it.",
		);
		expect(viewerPage).not.toContain("/share/");
		const borrowerPage = await (
			await w.get(borrower.base, w.header(borrower))
		).text();
		expect(borrowerPage).toContain("Proposed by the lender&#39;s team");
		for (const text of [boardPage, viewerPage, borrowerPage]) {
			expect(text).not.toContain(RECIPIENT);
			expect(text).not.toContain("tess@coop.test");
		}
		const stamped = (await w.events(noteId)).find(
			(event) =>
				event.type === "visibility.changed" &&
				event.change === "grant.proposed",
		);
		expect(stamped?.agent_ref).toBeDefined();
		// Revocation by a board member reaches the viewer's very next request.
		const revoked = await w.press(board, "revoke", { grant_id: grantId });
		expect(revoked.status).toBe(303);
		expect(
			(await w.get(`/s/${opened.noteId}/${opened.grantId}`, opened.header))
				.status,
		).toBe(404);
		const viewerRevoke = await w.press(viewer, "revoke", { grant_id: grantId });
		expect(viewerRevoke.status).toBe(403);
	});

	test("the borrower's proposal waits for the lender's team; a treasurer agrees with a code mailed to them", async () => {
		const { w, noteId, treasurer, viewer, borrower } = await orgWorld();
		expect(
			(
				await w.press(borrower, "propose", {
					recipient_email: RECIPIENT,
					level: "summary",
				})
			).status,
		).toBe(303);
		const grantId = await w.lastGrantId(noteId);
		const panel = await (
			await w.get(treasurer.base, w.header(treasurer))
		).text();
		expect(panel).toContain("Waiting for your agreement");
		const viewerTry = await w.press(viewer, "consent", { grant_id: grantId });
		expect(viewerTry.status).toBe(403);
		const done = await w.consent(treasurer, grantId);
		expect(done.status).toBe(303);
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(1);
	});
});

describe("staging only and the existing gates", () => {
	test("every new path answers 404 outside staging, and a note's share routes need a session", async () => {
		const w = shareWorld(signing, {}, { ENVIRONMENT: "production" });
		for (const [method, path] of [
			["GET", "/s/nt_abcdefgh/g1"],
			["GET", "/s/nt_abcdefgh/g1/enter?t=x"],
			["POST", "/s/nt_abcdefgh/g1/enter"],
			["GET", "/v/nt_abcdefgh.abcdefghijklmnopqr"],
			["POST", "/v/nt_abcdefgh.abcdefghijklmnopqr"],
			["POST", "/n/nt_abcdefgh/share/propose"],
			["POST", "/n/nt_abcdefgh/share/consent"],
			["POST", `/o/${ORG_ID}/n/nt_abcdefgh/share/revoke`],
		] as const) {
			const response = await w.ledger(path, { method });
			expect({ path, status: response.status }).toEqual({ path, status: 404 });
		}
	});

	test("the party routes refuse a post without a session or a form token", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		for (const step of [
			"propose",
			"consent",
			"revoke",
			"verify-link",
			"reveal",
			"resend",
		]) {
			const anonymous = await w.post(`/n/${note.noteId}/share/${step}`, {
				grant_id: "x",
			});
			expect({ step, status: anonymous.status }).toEqual({ step, status: 401 });
			const noToken = await w.post(
				`/n/${note.noteId}/share/${step}`,
				{ grant_id: "x" },
				w.header(note.lender),
			);
			expect({ step, status: noToken.status }).toEqual({ step, status: 403 });
			const wrongOrigin = await w.ledger(`/n/${note.noteId}/share/${step}`, {
				method: "POST",
				body: new URLSearchParams({ csrf: note.lender.csrf, grant_id: "x" }),
				headers: {
					Cookie: w.header(note.lender),
					Origin: "https://evil.example",
				},
			});
			expect({ step, status: wrongOrigin.status }).toEqual({
				step,
				status: 403,
			});
		}
		expect(await w.events(note.noteId)).toHaveLength(2);
		// A GET on a step is not a route: the router carries on to its 404, as it does for `/act`.
		const getStep = await notesRoute(
			new Request(`https://${LEDGER}/n/${note.noteId}/share/propose`, {
				headers: { Cookie: w.header(note.lender) },
			}),
			w.env,
			w.deps,
		);
		expect(getStep).toBeNull();
	});

	test("the page history names a share without naming the person", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		await openCarveOut(w, note, "summary");
		const page = await (
			await w.get(note.borrower.base, w.header(note.borrower))
		).text();
		expect(page).toContain("Lender recorded a disclosure to a named person.");
		expect(page).not.toContain("visibility.changed");
	});
});
