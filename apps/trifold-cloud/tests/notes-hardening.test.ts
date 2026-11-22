import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { verifyNoteBundle } from "tfd-verify-notes";
import { maskEmail } from "../src/notes/masking";
import type { MemoryNoteStore } from "../src/notes/memory-store";
import { isValidNoteId, noteIdFor } from "../src/notes/note-ids";
import { MemoryOrgStore } from "../src/notes/org-memory-store";
import { DECLINED_NOTICE } from "../src/notes/pages";
import { notesRoute } from "../src/notes/routes";
import { NoteService } from "../src/notes/service";
import type { ActiveSession } from "../src/notes/sessions";
import { SHARING_READERS } from "../src/notes/share-pages";
import {
	API,
	API_KEY,
	BASE_URL,
	BORROWER_EMAIL,
	LEDGER,
	LENDER_EMAIL,
	notesEnv,
	SECRET,
} from "./notes-fakes";
import {
	BOARD,
	BOARD_TWO,
	expectOk,
	ORG_ID,
	TREASURER,
	VIEWER,
} from "./notes-org-fakes";
import {
	cookieOf,
	orgSessionCookieName,
	RECIPIENT,
	sessionCookieName,
	shareCookieName,
	shareWorld,
	type World,
} from "./notes-share-fakes";
import { type TestSigning, testSigning } from "./notes-signers";

let signing: TestSigning;
beforeAll(async () => {
	signing = await testSigning();
});

const CLAIM_WORDS =
	/\b(proof|enforceable|binding|tamper-proof|legally|credit|interest-free)\b/i;
const CSRF_FIELD = /name="csrf" value="([^"]+)"/;
const PAYMENT = {
	type: "payment.recorded",
	kind: "payment",
	amount_minor: "100000",
	value_date: "2026-11-10",
	method: "transfer",
};

/** A guest note where the lender recorded one payment. */
const paidNote = async (w: World) => {
	const note = await w.guestNote();
	const payment = expectOk(
		await w.h.service.append(note.borrower.session, PAYMENT),
	).event;
	expectOk(
		await w.h.service.append(note.lender.session, {
			type: "payment.confirmed",
			target: payment.id,
		}),
	);
	return { ...note, paymentId: payment.id };
};

const codeFor = async (
	w: World,
	party: { session: ActiveSession; email: string },
	action: string,
): Promise<string> => {
	expectOk(await w.h.service.requestStepUp(party.session, action));
	return w.h.mailer.codeFor(party.email);
};

describe("a receipt is not frozen", () => {
	test("a dispute after the first receipt issues a new one at the new chain head; the same status returns the same bytes", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		const first = expectOk(
			await w.h.service.issueReceipt(note.borrower.session, note.paymentId),
		);
		expect(first.created).toBe(true);
		const again = expectOk(
			await w.h.service.issueReceipt(note.lender.session, note.paymentId),
		);
		expect(again.created).toBe(false);
		expect(again.document.json).toBe(first.document.json);

		expectOk(
			await w.h.service.append(
				note.lender.session,
				{
					type: "payment.disputed",
					target: note.paymentId,
					counter_amount_minor: "50000",
					reason: "The transfer was for less.",
				},
				{ code: await codeFor(w, note.lender, "payment.disputed") },
			),
		);
		const second = expectOk(
			await w.h.service.issueReceipt(note.borrower.session, note.paymentId),
		);
		expect(second.created).toBe(true);
		expect(second.document.id).not.toBe(first.document.id);
		const before = JSON.parse(first.document.json) as {
			status: string;
			chain_head: { seq: number };
		};
		const after = JSON.parse(second.document.json) as typeof before;
		expect(after.status).not.toBe(before.status);
		expect(after.chain_head.seq).toBeGreaterThan(before.chain_head.seq);
		// Asking again with the dispute standing finds the new receipt, and the first one is still there.
		const third = expectOk(
			await w.h.service.issueReceipt(note.lender.session, note.paymentId),
		);
		expect(third.document.id).toBe(second.document.id);
		const receipts = (await w.h.store.listDocuments(note.noteId)).filter(
			(document) => document.type === "note.payment-receipt",
		);
		expect(receipts.map((document) => document.id)).toEqual([
			first.document.id,
			second.document.id,
		]);
		expect(receipts.map((document) => document.variant)).toEqual([
			before.status,
			after.status,
		]);
	});

	test("the receipt page says where in the chain it was issued and that later events are not in it", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		const response = await w.post(
			`${note.borrower.base}/receipt`,
			{ csrf: note.borrower.csrf, event: note.paymentId },
			w.header(note.borrower),
		);
		expect(response.status).toBe(303);
		const page = await (
			await w.get(
				response.headers.get("Location") ?? "",
				w.header(note.borrower),
			)
		).text();
		const events = (await w.events(note.noteId)).length;
		expect(page).toContain(
			`Issued at chain position ${events}. Events after that are not in it.`,
		);
		expect(page).not.toMatch(CLAIM_WORDS);
	});
});

describe("the bundle seals first", () => {
	test("after more payments than the last document covers, the bundle still verifies; without its seal, or with a stale one, it does not", async () => {
		const w = shareWorld(signing);
		const note = await paidNote(w);
		expectOk(await w.h.service.issuePayoff(note.lender.session, "2026-11-22"));
		const stale = expectOk(
			await w.h.service.bundle(note.lender.session),
		).bundle;
		// More events after the last document and the last seal.
		for (const amount of ["1000", "2000"])
			expectOk(
				await w.h.service.append(note.lender.session, {
					...PAYMENT,
					amount_minor: amount,
				}),
			);
		for (const bundle of [
			expectOk(await w.h.service.bundle(note.lender.session)).bundle,
			expectOk(await w.h.service.bundleOf(note.noteId)).bundle,
		]) {
			expect((bundle.seal as { head_seq: number }).head_seq).toBe(
				bundle.events.length,
			);
			const verdict = await verifyNoteBundle({
				events: bundle.events,
				links: bundle.links,
				documents: [...bundle.documents, bundle.seal],
				keys: signing.keys,
			});
			expect(verdict.ok).toBe(true);
			// Dropping the seal leaves the head unsealed: the check fails.
			const unsealed = await verifyNoteBundle({
				events: bundle.events,
				links: bundle.links,
				documents: bundle.documents,
				keys: signing.keys,
			});
			expect(unsealed).toMatchObject({ ok: false, code: "chain_unsealed" });
			// The earlier seal names an earlier head.
			const staleSeal = await verifyNoteBundle({
				events: bundle.events,
				links: bundle.links,
				documents: [...bundle.documents, stale.seal],
				keys: signing.keys,
			});
			expect(staleSeal).toMatchObject({ ok: false, code: "chain_seal_stale" });
		}
	});
});

describe("declined terms", () => {
	test("a decline pauses payoff statements and notices; payments and notes still go through; the lender's page says so and hides the forms", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		expectOk(
			await w.h.service.append(note.borrower.session, {
				type: "terms.declined",
			}),
		);
		expect(
			await w.h.service.issuePayoff(note.lender.session, "2026-11-22"),
		).toMatchObject({ ok: false, error: "terms_declined" });
		for (const kind of ["reminder", "default"] as const)
			expect(
				await w.h.service.sendNotice(
					note.lender.session,
					kind === "default" ? { kind, cure_days: 10 } : { kind },
				),
			).toMatchObject({ ok: false, error: "terms_declined" });
		expectOk(await w.h.service.append(note.lender.session, PAYMENT));
		expectOk(
			await w.h.service.append(note.lender.session, {
				type: "annotation.added",
				text: "Noted.",
			}),
		);
		const page = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		expect(page).toContain(DECLINED_NOTICE);
		expect(DECLINED_NOTICE).toBe(
			"The borrower said this is not their loan. Payments and notes can still be recorded; payoff statements and notices are paused.",
		);
		expect(page).not.toContain(`${note.lender.base}/payoff`);
		expect(page).not.toContain(`${note.lender.base}/notice`);
		// The route answers the same refusal if a form is posted anyway.
		const posted = await w.post(
			`${note.lender.base}/payoff`,
			{ csrf: note.lender.csrf, as_of: "2026-11-22" },
			w.header(note.lender),
		);
		expect(posted.status).toBe(409);
		expect(await posted.text()).toContain("not their loan");
		// Accepting the terms later lifts the pause.
		expectOk(
			await w.h.service.append(
				note.borrower.session,
				{ type: "terms.accepted" },
				{ code: await codeFor(w, note.borrower, "terms.accepted") },
			),
		);
		expectOk(await w.h.service.issuePayoff(note.lender.session, "2026-11-22"));
	});

	test("an organization lender: no default approval is started, a waiver still is, and the portfolio counts the note as declined only", async () => {
		const w = shareWorld(signing);
		const created = await w.h.createOrgNote();
		const treasurer = await w.openAgent(created.noteId, TREASURER);
		const borrower = await w.openGuest(
			created.noteId,
			"borrower",
			BORROWER_EMAIL,
		);
		expectOk(
			await w.h.service.append(borrower.session, { type: "terms.declined" }),
		);
		const start = (await w.h.store.readLog(created.noteId)).events[0] as string;
		const target = (JSON.parse(start) as { id: string }).id;
		expect(
			await w.h.service.requestApproval(treasurer.session, {
				action: "notice.default",
				target,
				cure_days: 30,
			}),
		).toMatchObject({ ok: false, error: "terms_declined" });
		expectOk(
			await w.h.service.requestApproval(treasurer.session, {
				action: "waiver",
				target,
			}),
		);
		const folio = expectOk(await w.h.org.portfolio(ORG_ID, "2026-11-22"));
		expect(folio.portfolio.rows[0]).toMatchObject({ declined: true });
		expect(folio.portfolio.totals[0]).toMatchObject({
			declined: 1,
			buckets: { current: 0, "1-30": 0, "31-60": 0, "61+": 0 },
			outstanding_payoff_minor: "0",
			overdue_minor: "0",
		});
		const page = await (
			await w.get(`/o/${ORG_ID}`, w.header(treasurer))
		).text();
		expect(page).toContain("<th>Declined</th>");
		const csv = await (
			await w.get(`/o/${ORG_ID}/board.csv`, w.header(treasurer))
		).text();
		expect(csv.split("\n")[0]).toContain("declined");
		// The lender page of an agent says it too.
		const notePage = await (
			await w.get(treasurer.base, w.header(treasurer))
		).text();
		expect(notePage).toContain(DECLINED_NOTICE);
		expect(notePage).not.toContain(`${treasurer.base}/payoff`);
	});
});

describe("a default notice and its approval", () => {
	const orgNote = async () => {
		const w = shareWorld(signing);
		const created = await w.h.createOrgNote({
			agents: [
				{ email: TREASURER, role: "treasurer" },
				{ email: BOARD, role: "board" },
				{ email: BOARD_TWO, role: "board" },
				{ email: VIEWER, role: "viewer" },
			],
		});
		const treasurer = await w.openAgent(created.noteId, TREASURER);
		const board = await w.openAgent(created.noteId, BOARD);
		const boardTwo = await w.openAgent(created.noteId, BOARD_TWO);
		const annotation = expectOk(
			await w.h.service.append(treasurer.session, {
				type: "annotation.added",
				text: "Text of the default notice.",
			}),
		).event;
		return { w, created, treasurer, board, boardTwo, annotation };
	};

	test("the request names the days to cure; the notice must use that approval and those days", async () => {
		const { w, treasurer, board, annotation } = await orgNote();
		const missing = await w.h.service.requestApproval(treasurer.session, {
			action: "notice.default",
			target: annotation.id,
		});
		expect(missing).toMatchObject({ ok: false, error: "bad_request" });
		expect(
			await w.h.service.requestApproval(treasurer.session, {
				action: "waiver",
				target: annotation.id,
				cure_days: 5,
			}),
		).toMatchObject({ ok: false, error: "bad_request" });
		const request = expectOk(
			await w.h.service.requestApproval(treasurer.session, {
				action: "notice.default",
				target: annotation.id,
				cure_days: 30,
			}),
		).event;
		expect(request).toMatchObject({ cure_days: 30 });
		expectOk(await w.h.service.grantApproval(board.session, request.id));
		// A different cure period is not what was approved.
		expect(
			await w.h.service.sendNotice(treasurer.session, {
				kind: "default",
				cure_days: 45,
			}),
		).toMatchObject({
			ok: false,
			error: "approval_required",
			missing: "request",
		});
		const code = await codeFor(w, treasurer, "notice.sent");
		const sent = expectOk(
			await w.h.service.sendNotice(
				treasurer.session,
				{ kind: "default", cure_days: 30 },
				{ code },
			),
		);
		expect(sent.event).toMatchObject({
			kind: "default",
			cure_days: 30,
			approval: request.id,
		});
	});

	test("an approval given by someone who has since left the team counts for nothing", async () => {
		const { w, created, treasurer, board, boardTwo, annotation } =
			await orgNote();
		const request = expectOk(
			await w.h.service.requestApproval(treasurer.session, {
				action: "notice.default",
				target: annotation.id,
				cure_days: 30,
			}),
		).event;
		expectOk(await w.h.service.grantApproval(board.session, request.id));
		expectOk(
			await w.h.org.deactivateAgent(created.noteId, {
				agentRef: board.session.agent?.agentRef as string,
			}),
		);
		expect(
			await w.h.service.sendNotice(treasurer.session, {
				kind: "default",
				cure_days: 30,
			}),
		).toMatchObject({
			ok: false,
			error: "approval_required",
			missing: "approval",
		});
		// Another board member can still approve it.
		expectOk(await w.h.service.grantApproval(boardTwo.session, request.id));
		const code = await codeFor(w, treasurer, "notice.sent");
		expectOk(
			await w.h.service.sendNotice(
				treasurer.session,
				{ kind: "default", cure_days: 30 },
				{ code },
			),
		);
	});

	test("the note page asks for the days to cure, and the borrower's page never mentions approvals", async () => {
		const { w, created, treasurer, board, annotation } = await orgNote();
		const form = await (
			await w.get(treasurer.base, w.header(treasurer))
		).text();
		expect(form).toContain('name="cure_days"');
		const request = expectOk(
			await w.h.service.requestApproval(treasurer.session, {
				action: "notice.default",
				target: annotation.id,
				cure_days: 30,
			}),
		).event;
		expectOk(await w.h.service.grantApproval(board.session, request.id));
		const asTreasurer = await (
			await w.get(treasurer.base, w.header(treasurer))
		).text();
		expect(asTreasurer).toContain("(30 days to cure)");
		const borrower = await w.openGuest(
			created.noteId,
			"borrower",
			BORROWER_EMAIL,
		);
		const asBorrower = await (
			await w.get(borrower.base, w.header(borrower))
		).text();
		expect(asBorrower).not.toMatch(/approv|second person/i);
	});
});

describe("disclosures", () => {
	test("a disclosure lasts at most 90 days, the purposes are the four named, and 'other' is refused", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		const base = { recipient_email: RECIPIENT, level: "summary" };
		const tooLong = await w.h.service.proposeShare(note.lender.session, {
			...base,
			days: 91,
			carve_out: { purpose: "lawyer" },
		});
		expect(tooLong).toMatchObject({ ok: false, error: "bad_request" });
		expect(!tooLong.ok && tooLong.message).toContain("at most 90 days");
		expect(
			await w.h.service.proposeShare(note.lender.session, {
				...base,
				days: 30,
				carve_out: { purpose: "other" },
			}),
		).toMatchObject({ ok: false, error: "bad_request" });
		expectOk(
			await w.h.service.proposeShare(note.lender.session, {
				...base,
				days: 90,
				carve_out: { purpose: "court" },
			}),
		);
		// An ordinary share may still run a year, because the other party agrees to it.
		expectOk(
			await w.h.service.proposeShare(note.lender.session, {
				...base,
				days: 365,
			}),
		);
		const page = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		for (const purpose of [
			"my accountant or bookkeeper",
			"legal advice",
			"enforcement or a court",
			"an assignment of the loan",
		])
			expect(page).toContain(purpose);
		expect(page).not.toContain("another need of my own");
		expect(page).not.toContain('<option value="other">');
	});

	test("the other party is emailed at once: a masked address, the purpose, the end date, a pointer to their page, and nothing else", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		expectOk(
			await w.h.service.proposeShare(note.lender.session, {
				recipient_email: RECIPIENT,
				level: "statement",
				days: 45,
				carve_out: { purpose: "lawyer" },
			}),
		);
		const mail = w.h.mailer.to(BORROWER_EMAIL).at(-1);
		expect(mail?.subject).toBe("A disclosure was recorded on your loan record");
		const text = mail?.text ?? "";
		expect(text).toContain(maskEmail(RECIPIENT));
		expect(text).toContain("Purpose: legal advice");
		expect(text).toContain("Ends: 2027-01-06");
		expect(text).toContain("Your note page lists it");
		expect(text).toContain(`${BASE_URL}/n/${note.noteId}`);
		for (const leak of [
			RECIPIENT,
			LENDER_EMAIL,
			BORROWER_EMAIL,
			"1,000",
			"10,000",
			"1000000",
			"maria",
			"ana",
			"USD",
		])
			expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
		expect(text).not.toMatch(CLAIM_WORDS);
		// The lender is not told about their own disclosure; the recipient gets their own link.
		expect(
			w.h.mailer.to(LENDER_EMAIL).some((m) => m.subject.includes("disclosure")),
		).toBe(false);
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(1);
	});

	test("a disclosure by the borrower of an organization's note reaches the team's treasurers and board, not a viewer", async () => {
		const w = shareWorld(signing);
		const created = await w.h.createOrgNote();
		const borrower = await w.openGuest(
			created.noteId,
			"borrower",
			BORROWER_EMAIL,
		);
		expectOk(
			await w.h.service.proposeShare(borrower.session, {
				recipient_email: RECIPIENT,
				level: "summary",
				carve_out: { purpose: "accountant" },
			}),
		);
		for (const address of [TREASURER, BOARD]) {
			const text = w.h.mailer
				.to(address)
				.find((mail) => mail.subject.includes("disclosure"))?.text;
			expect(text).toContain(`/o/${ORG_ID}/n/${created.noteId}`);
			expect(text).toContain(maskEmail(RECIPIENT));
		}
		expect(
			w.h.mailer.to(VIEWER).some((mail) => mail.subject.includes("disclosure")),
		).toBe(false);
	});

	test("a mail that cannot be sent to the other party leaves the disclosure standing", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		const send = w.h.mailer.send.bind(w.h.mailer);
		w.h.mailer.send = async (message) => {
			if (message.subject.includes("disclosure")) throw new Error("mail down");
			await send(message);
		};
		const proposed = expectOk(
			await w.h.service.proposeShare(note.lender.session, {
				recipient_email: RECIPIENT,
				level: "summary",
				carve_out: { purpose: "accountant" },
			}),
		);
		expect(proposed).toMatchObject({ status: "active", mailed: true });
		const page = await (
			await w.get(note.borrower.base, w.header(note.borrower))
		).text();
		expect(page).toContain("Disclosures the other party made");
		expect(page).toContain(maskEmail(RECIPIENT));
	});
});

describe("what the sharing panel says", () => {
	test("it lists everyone who can read the record, says the figures follow the record, and says what a shared view leaves out", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		const page = await (
			await w.get(note.lender.base, w.header(note.lender))
		).text();
		expect(SHARING_READERS).toBe(
			"These people can read this record: you, the other party, the lender's team when the lender is an organization, anyone either of you disclosed it to (listed below) and anyone you both agreed to share it with. Trifold stores the record to run the service.",
		);
		expect(page).toContain(
			"These people can read this record: you, the other party, the lender&#39;s team when the lender is an organization, anyone either of you disclosed it to (listed below) and anyone you both agreed to share it with. Trifold stores the record to run the service.",
		);
		expect(page).toContain(
			"A shared view shows the figures both parties agree on. If that changes, for example a payment is disputed, the shared figures change too.",
		);
		expect(page).toContain(
			"A shared view never includes disputes, notices or free-text notes.",
		);
		expect(page).not.toContain("Only the two of you");
		expect(page).not.toContain("never shown disputes");
		expect(page).not.toMatch(CLAIM_WORDS);
	});

	test("the old sentence is nowhere in the source", async () => {
		const directory = join(import.meta.dir, "..", "src", "notes");
		for await (const file of new Bun.Glob("*.ts").scan(directory)) {
			const text = await Bun.file(join(directory, file)).text();
			expect({
				file,
				old: text.includes("Only the two of you can read"),
			}).toEqual({ file, old: false });
			expect({ file, old: text.includes("never shown disputes") }).toEqual({
				file,
				old: false,
			});
		}
	});
});

describe("note ids carry a keyed MAC", () => {
	test("an id is the hash of the pair and a MAC under the secret; only that id is valid, under that secret", async () => {
		const id = await noteIdFor(SECRET, "api", "k1");
		expect(id).toMatch(/^nt_[0-9a-f]{32}\.[0-9a-f]{16}$/);
		expect(await noteIdFor(SECRET, "api", "k1")).toBe(id);
		expect(await noteIdFor(SECRET, "api", "k2")).not.toBe(id);
		expect(await isValidNoteId(SECRET, id)).toBe(true);
		expect(await isValidNoteId(`${SECRET}x`, id)).toBe(false);
		const forged = `${id.slice(0, -1)}${id.endsWith("0") ? "1" : "0"}`;
		for (const bad of [
			forged,
			id.split(".")[0] as string,
			`${id}.`,
			"",
			"nt_short",
			id.toUpperCase(),
		])
			expect({ bad, valid: await isValidNoteId(SECRET, bad) }).toEqual({
				bad,
				valid: false,
			});
	});

	test("a made-up id never touches a Durable Object or a store, and malformed and forged ids get the same 404 on every route", async () => {
		const touched: string[] = [];
		const base = notesEnv();
		const env = {
			...base,
			NOTE: {
				idFromName: (name: string) => {
					touched.push(name);
					return base.NOTE.idFromName(name);
				},
				get: base.NOTE.get,
			},
		};
		const real = await noteIdFor(SECRET, "api", "real");
		const forged = `${real.slice(0, -1)}${real.endsWith("0") ? "1" : "0"}`;
		const bearer = { Authorization: `Bearer ${API_KEY}` };
		const call = (host: string, path: string, init: RequestInit = {}) =>
			notesRoute(new Request(`https://${host}${path}`, init), env, {
				orgs: new MemoryOrgStore(),
				signers: signing.signers,
			});
		const form = (fields: Record<string, string>): RequestInit => ({
			method: "POST",
			body: new URLSearchParams(fields),
		});
		const paths = (id: string): [string, string, RequestInit][] => [
			[LEDGER, `/n/${id}`, {}],
			[LEDGER, `/n/${id}/enter?t=x`, {}],
			[LEDGER, `/n/${id}/enter`, form({ t: "x" })],
			[LEDGER, `/n/${id}/link`, form({ email: BORROWER_EMAIL })],
			[LEDGER, `/n/${id}/act`, form({ csrf: "x" })],
			[LEDGER, `/n/${id}/bundle.json`, {}],
			[LEDGER, `/n/${id}/docs/abc`, {}],
			[LEDGER, `/o/${ORG_ID}/n/${id}`, {}],
			[LEDGER, `/o/${ORG_ID}/n/${id}/docs/abc`, {}],
			[API, `/v1/notes/${id}/statement`, { headers: bearer }],
			[API, `/v1/notes/${id}/bundle`, { headers: bearer }],
			[
				API,
				`/v1/notes/${id}/agents`,
				{
					method: "POST",
					headers: bearer,
					body: JSON.stringify({
						action: "add",
						email: "a@b.co",
						role: "board",
					}),
				},
			],
			[LEDGER, `/s/${id}/grant1`, {}],
			[LEDGER, `/s/${id}/grant1/enter?t=x`, {}],
			[LEDGER, `/s/${id}/grant1/enter`, form({ t: "x" })],
			[LEDGER, `/v/${id}.${"a".repeat(24)}`, {}],
		];
		const answers = async (id: string) => {
			const seen: { status: number; body: string }[] = [];
			for (const [host, path, init] of paths(id)) {
				const response = await call(host, path, init);
				seen.push({
					status: response?.status ?? 0,
					body: (await response?.text())?.replaceAll(id, "ID") ?? "",
				});
			}
			return seen;
		};
		const forgedAnswers = await answers(forged);
		const malformedAnswers = await answers("not-an-id");
		expect(touched).toEqual([]);
		for (const [index, answer] of forgedAnswers.entries()) {
			expect({ index, status: answer.status }).toEqual({
				index,
				status: 404,
			});
			expect(answer).toEqual(malformedAnswers[index] as typeof answer);
		}
		// The probe works: an id this Worker made does reach a Durable Object.
		await call(LEDGER, `/n/${real}/enter`, form({ t: "x" }));
		expect(touched.length).toBeGreaterThan(0);
	});

	test("with the in-memory store a forged id adds no note", async () => {
		const w = shareWorld(signing);
		const store = w.h.store as MemoryNoteStore;
		const forged = `${await noteIdFor(SECRET, "api", "ghost")}0`;
		const before = store.size;
		for (const path of [
			`/n/${forged}`,
			`/n/${forged}/link`,
			`/s/${forged}/g`,
			`/o/${ORG_ID}/n/${forged}`,
		]) {
			const response = await w
				.ledger(path, { method: "GET" })
				.catch(() => null);
			expect(response?.status).toBe(404);
		}
		expect(store.size).toBe(before);
	});
});

describe("the link request does not wait for the mail", () => {
	test("the answer takes the same time whether or not the address matched, and the mail still goes", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		const sleepMs = 400;
		const sent: string[] = [];
		w.h.mailer.send = async (message) => {
			await new Promise((resolve) => setTimeout(resolve, sleepMs));
			sent.push(message.to);
		};
		const timed = async (email: string): Promise<number> => {
			const started = performance.now();
			const response = await notesRoute(
				new Request(`https://${LEDGER}/n/${note.noteId}/link`, {
					method: "POST",
					body: new URLSearchParams({ email }),
				}),
				w.env,
				w.deps,
			);
			const elapsed = performance.now() - started;
			expect(response?.status).toBe(200);
			return elapsed;
		};
		const stranger = await timed("stranger@example.com");
		const matching = await timed(BORROWER_EMAIL);
		expect(matching).toBeLessThan(sleepMs / 2);
		expect(Math.abs(matching - stranger)).toBeLessThan(sleepMs / 2);
		expect(sent).toEqual([]);
		await w.h.flush();
		expect(sent).toEqual([BORROWER_EMAIL]);
	});

	test("so does a team member's request on the organization's page", async () => {
		const w = shareWorld(signing);
		await w.h.createOrgNote();
		const sleepMs = 400;
		const sent: string[] = [];
		w.h.mailer.send = async (message) => {
			await new Promise((resolve) => setTimeout(resolve, sleepMs));
			sent.push(message.to);
		};
		const started = performance.now();
		const response = await notesRoute(
			new Request(`https://${LEDGER}/o/${ORG_ID}/link`, {
				method: "POST",
				body: new URLSearchParams({ email: TREASURER }),
			}),
			w.env,
			w.deps,
		);
		expect(response?.status).toBe(200);
		expect(performance.now() - started).toBeLessThan(sleepMs / 2);
		await w.h.flush();
		expect(sent).toEqual([TREASURER]);
	});

	test("in the Worker the deferred mail goes to waitUntil", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		const waited: Promise<unknown>[] = [];
		const response = await notesRoute(
			new Request(`https://${LEDGER}/n/${note.noteId}/link`, {
				method: "POST",
				body: new URLSearchParams({ email: BORROWER_EMAIL }),
			}),
			w.env,
			{ ...w.deps, defer: (work) => waited.push(work) },
		);
		expect(response?.status).toBe(200);
		expect(waited).toHaveLength(1);
		const before = w.h.mailer.to(BORROWER_EMAIL).length;
		await Promise.all(waited);
		expect(w.h.mailer.to(BORROWER_EMAIL)).toHaveLength(before + 1);
	});
});

describe("the body limit is enforced while streaming", () => {
	const CHUNK = 1024;
	const LIMIT = 64 * 1024;
	/** A body with no Content-Length that offers `chunks` kilobytes and reports how many were taken. */
	const stream = (chunks: number) => {
		const state = { pulled: 0 };
		const body = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (state.pulled >= chunks) {
					controller.close();
					return;
				}
				state.pulled += 1;
				controller.enqueue(new TextEncoder().encode("a".repeat(CHUNK)));
			},
		});
		return { state, body };
	};
	const post = (
		url: string,
		body: ReadableStream<Uint8Array>,
		type: string,
		extra: HeadersInit = {},
	) =>
		new Request(url, {
			method: "POST",
			body,
			headers: { "Content-Type": type, ...extra },
			duplex: "half",
		} as RequestInit);

	test("a form, a pasted document and the API's JSON are each refused with a 413 at the limit, without reading the rest", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		const offered = 2000;
		const forms = stream(offered);
		const refusedForm = await notesRoute(
			post(
				`https://${LEDGER}/n/${note.noteId}/link`,
				forms.body,
				"application/x-www-form-urlencoded",
			),
			w.env,
			w.deps,
		);
		expect(refusedForm?.status).toBe(413);
		expect(forms.state.pulled).toBeLessThan(LIMIT / CHUNK + 8);

		const api = stream(offered);
		const refusedApi = await notesRoute(
			post(`https://${API}/v1/notes`, api.body, "application/json", {
				Authorization: `Bearer ${API_KEY}`,
			}),
			w.env,
			w.deps,
		);
		expect(refusedApi?.status).toBe(413);
		expect(
			((await refusedApi?.json()) as { error: { code: string } }).error.code,
		).toBe("too_large");
		expect(api.state.pulled).toBeLessThan(LIMIT / CHUNK + 8);

		// A small streamed form is read whole.
		const small = stream(1);
		const fine = await notesRoute(
			post(
				`https://${LEDGER}/n/${note.noteId}/link`,
				small.body,
				"application/x-www-form-urlencoded",
			),
			w.env,
			w.deps,
		);
		expect(fine?.status).toBe(200);
	});

	test("a form that declares itself too large is refused before it is read", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		const response = await notesRoute(
			new Request(`https://${LEDGER}/n/${note.noteId}/link`, {
				method: "POST",
				body: `email=${"a".repeat(70 * 1024)}`,
				headers: { "Content-Type": "application/x-www-form-urlencoded" },
			}),
			w.env,
			w.deps,
		);
		expect(response?.status).toBe(413);
	});
});

describe("the secret must be long enough", () => {
	test("under 32 characters or missing, every notes route answers 503 with no fallback", async () => {
		const real = await noteIdFor(SECRET, "api", "x");
		const targets: [string, string, RequestInit][] = [
			[LEDGER, `/n/${real}`, {}],
			[LEDGER, `/n/${real}/enter?t=x`, {}],
			[LEDGER, `/o/${ORG_ID}`, {}],
			[LEDGER, `/o/${ORG_ID}/enter`, {}],
			[LEDGER, `/s/${real}/g`, {}],
			[LEDGER, `/v/${real}.${"a".repeat(24)}`, {}],
			[
				API,
				"/v1/notes",
				{
					method: "POST",
					headers: { Authorization: `Bearer ${API_KEY}` },
					body: "{}",
				},
			],
			[
				API,
				`/v1/orgs/${ORG_ID}/portfolio`,
				{ headers: { Authorization: `Bearer ${API_KEY}` } },
			],
		];
		for (const secret of [undefined, "", "short", "x".repeat(31)]) {
			const env = notesEnv({ NOTES_SESSION_SECRET: secret });
			for (const [host, path, init] of targets) {
				const response = await notesRoute(
					new Request(`https://${host}${path}`, init),
					env,
				);
				expect({ secret, path, status: response?.status }).toEqual({
					secret,
					path,
					status: 503,
				});
			}
		}
		// Exactly 32 is enough.
		const ok = await notesRoute(
			new Request(`https://${LEDGER}/o/${ORG_ID}/enter`),
			notesEnv({ NOTES_SESSION_SECRET: "x".repeat(32) }),
		);
		expect(ok?.status).toBe(200);
	});
});

describe("cookies", () => {
	test("each scope has a cookie name of its own, and a cookie of one family opens nothing in another", async () => {
		const w = shareWorld(signing);
		const created = await w.h.createOrgNote();
		const agent = await w.openAgent(created.noteId, TREASURER);
		const guest = await w.guestNote("cookies");
		// Names: __Host- plus the scope.
		expect(agent.cookieName).toBe(`__Host-tf_org_${ORG_ID}`);
		expect(guest.lender.cookieName).toBe(`__Host-tf_note_${guest.noteId}`);
		const payment = expectOk(
			await w.h.service.append(guest.lender.session, PAYMENT),
		).event;
		expect(payment.type).toBe("payment.recorded");
		expectOk(
			await w.h.service.proposeShare(guest.lender.session, {
				recipient_email: RECIPIENT,
				level: "summary",
				carve_out: { purpose: "accountant" },
			}),
		);
		const share = await w.openShare();
		expect(share.name).toBe(shareCookieName(share.noteId, share.grantId));
		expect(share.name).toStartWith("__Host-tf_share_");
		const setCookie = share.response.headers.get("Set-Cookie") ?? "";
		for (const part of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/"])
			expect(setCookie).toContain(part);
		expect(setCookie).not.toContain("Domain");

		const status = async (path: string, name: string, value: string) =>
			(await w.get(path, `${name}=${value}`)).status;
		const grantPath = `/s/${share.noteId}/${share.grantId}`;
		// The right name opens the page; the same value under another family's name does not.
		expect(
			await status(
				guest.lender.base,
				guest.lender.cookieName,
				guest.lender.cookie,
			),
		).toBe(200);
		expect(
			await status(
				guest.lender.base,
				orgSessionCookieName(ORG_ID),
				guest.lender.cookie,
			),
		).toBe(401);
		expect(
			await status(
				guest.lender.base,
				shareCookieName(share.noteId, share.grantId),
				guest.lender.cookie,
			),
		).toBe(401);
		expect(await status(agent.base, agent.cookieName, agent.cookie)).toBe(200);
		expect(
			await status(agent.base, sessionCookieName(created.noteId), agent.cookie),
		).toBe(401);
		expect(
			await status(
				`/o/${ORG_ID}`,
				sessionCookieName(created.noteId),
				agent.cookie,
			),
		).toBe(401);
		expect(
			await status(grantPath, share.name as string, share.cookie as string),
		).toBe(200);
		expect(
			await status(
				grantPath,
				sessionCookieName(share.noteId),
				share.cookie as string,
			),
		).toBe(401);
		expect(
			await status(grantPath, guest.lender.cookieName, guest.lender.cookie),
		).toBe(401);
		expect(
			await status(
				guest.lender.base,
				share.name as string,
				share.cookie as string,
			),
		).toBe(401);
		// A note's cookie is not another note's.
		const other = await w.guestNote("cookies-two");
		expect(
			await status(
				other.lender.base,
				guest.lender.cookieName,
				guest.lender.cookie,
			),
		).toBe(401);
		expect(cookieOf(share.response).name).toBe(share.name);
	});
});

describe("logging out", () => {
	const csrfOn = async (w: World, path: string, cookie: string) => {
		const text = await (await w.get(path, cookie)).text();
		const token = CSRF_FIELD.exec(text)?.[1];
		if (!token) throw new Error(`no csrf token on ${path}`);
		return token;
	};

	test("a party's logout ends the session on the server: the cookie opens nothing afterwards; it needs the form token and this site", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		const path = `${note.lender.base}/logout`;
		const header = w.header(note.lender);
		expect((await w.post(path, {}, header)).status).toBe(403);
		expect((await w.post(path, { csrf: "wrong" }, header)).status).toBe(403);
		expect((await w.post(path, { csrf: note.lender.csrf })).status).toBe(401);
		const crossSite = await w.ledger(path, {
			method: "POST",
			body: new URLSearchParams({ csrf: note.lender.csrf }),
			headers: { Cookie: header, Origin: "https://evil.example" },
		});
		expect(crossSite.status).toBe(403);
		expect((await w.get(note.lender.base, header)).status).toBe(200);
		const done = await w.post(path, { csrf: note.lender.csrf }, header);
		expect(done.status).toBe(200);
		expect(done.headers.get("Set-Cookie")).toContain("Max-Age=0");
		expect(await done.text()).toContain("You are signed out.");
		expect((await w.get(note.lender.base, header)).status).toBe(401);
		// The other party's session is theirs alone.
		expect(
			(await w.get(note.borrower.base, w.header(note.borrower))).status,
		).toBe(200);
		// The page offers the button.
		const page = await (
			await w.get(note.borrower.base, w.header(note.borrower))
		).text();
		expect(page).toContain(`action="${note.borrower.base}/logout"`);
	});

	test("an agent's logout ends the organization session on the server", async () => {
		const w = shareWorld(signing);
		const created = await w.h.createOrgNote();
		const agent = await w.openAgent(created.noteId, TREASURER);
		const header = w.header(agent);
		const csrf = await csrfOn(w, `/o/${ORG_ID}`, header);
		expect((await w.post(`/o/${ORG_ID}/logout`, {}, header)).status).toBe(403);
		expect(
			(await w.post(`/o/${ORG_ID}/logout`, { csrf: "wrong" }, header)).status,
		).toBe(403);
		const done = await w.post(`/o/${ORG_ID}/logout`, { csrf }, header);
		expect(done.status).toBe(200);
		expect(done.headers.get("Set-Cookie")).toContain("Max-Age=0");
		expect((await w.get(`/o/${ORG_ID}`, header)).status).toBe(401);
		expect((await w.get(agent.base, header)).status).toBe(401);
		// A visitor with no session is shown the sign-in page.
		expect((await w.post(`/o/${ORG_ID}/logout`, { csrf })).status).toBe(401);
	});

	test("a shared view's logout ends that share session on the server", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		expectOk(
			await w.h.service.proposeShare(note.lender.session, {
				recipient_email: RECIPIENT,
				level: "summary",
				carve_out: { purpose: "accountant" },
			}),
		);
		const share = await w.openShare();
		const path = `/s/${share.noteId}/${share.grantId}`;
		const page = await (await w.get(path, share.header)).text();
		const csrf = CSRF_FIELD.exec(page)?.[1] as string;
		expect(csrf).toBeTruthy();
		expect(page).toContain(`action="${path}/logout"`);
		expect((await w.post(`${path}/logout`, {}, share.header)).status).toBe(403);
		expect(
			(await w.post(`${path}/logout`, { csrf: "wrong" }, share.header)).status,
		).toBe(403);
		const done = await w.post(`${path}/logout`, { csrf }, share.header);
		expect(done.status).toBe(200);
		expect(done.headers.get("Set-Cookie")).toContain("Max-Age=0");
		expect((await w.get(path, share.header)).status).toBe(401);
		// The link was single use: signing out does not make it work again.
		expect((await w.post(`${path}/enter`, { t: share.token })).status).toBe(
			400,
		);
	});
});

describe("agent refs are per note and the engine counts people", () => {
	test("two addresses of one mailbox are two people to the engine: neither can approve the other's request", async () => {
		const w = shareWorld(signing);
		const created = await w.h.createOrgNote({
			agents: [
				{ email: "alice@coop.test", role: "board" },
				{ email: "alice+b@coop.test", role: "board" },
				{ email: TREASURER, role: "treasurer" },
			],
		});
		const refs = (created.agents ?? []).map((agent) => agent.agentRef);
		expect(refs).toHaveLength(3);
		expect(new Set(refs).size).toBe(3);
		const first = await w.openAgent(created.noteId, "alice@coop.test");
		const second = await w.openAgent(created.noteId, "alice+b@coop.test");
		const target = (
			JSON.parse(
				(await w.h.store.readLog(created.noteId)).events[0] as string,
			) as { id: string }
		).id;
		const request = expectOk(
			await w.h.service.requestApproval(first.session, {
				action: "waiver",
				target,
			}),
		).event;
		// A second address is a second agent: it can approve what the first one asked for.
		expectOk(await w.h.service.grantApproval(second.session, request.id));
		expect(
			await w.h.service.grantApproval(first.session, request.id),
		).toMatchObject({ ok: false });
	});
});

describe("the service stands alone", () => {
	test("a NoteService built without a defer still sends a matching link", async () => {
		const w = shareWorld(signing);
		const note = await w.guestNote();
		const service = new NoteService({
			store: w.h.store,
			mailer: w.h.mailer,
			clock: w.h.clock,
			ids: w.h.ids,
			secret: SECRET,
			baseUrl: BASE_URL,
		});
		const before = w.h.mailer.to(BORROWER_EMAIL).length;
		await service.requestLink(note.noteId, BORROWER_EMAIL);
		await new Promise((resolve) => setTimeout(resolve, 20));
		expect(w.h.mailer.to(BORROWER_EMAIL)).toHaveLength(before + 1);
	});
});
