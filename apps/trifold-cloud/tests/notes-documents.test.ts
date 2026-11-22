import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import {
	buildChain,
	canonicalJson,
	chainSealBody,
	documentSha256,
	type NoteEvent,
	toBase64Url,
	utf8Bytes,
	validateStream,
} from "tfd-notes";
import { verifyNoteBundle, verifyNoteDocument } from "tfd-verify-notes";
import { durableSqlDatabase } from "../src/do-sql";
import {
	migrateNote,
	NOTE_MIGRATIONS,
	RemoteNoteStore,
	SqliteNoteStore,
} from "../src/notes/do-store";
import {
	DEFAULT_RELEASE_COOLING_MS,
	documentSignersFromEnv,
	NOTICES_PER_DAY,
} from "../src/notes/documents-service";
import { MemoryNoteStore } from "../src/notes/memory-store";
import {
	type ErrorCode,
	LENDER_ACTIONS,
	type Outcome,
	STEP_UP_ACTIONS,
} from "../src/notes/service";
import type { ActiveSession } from "../src/notes/sessions";
import type { NoteStore, StoredDocument } from "../src/notes/store";
import { durableState, fakeEnv, signingPem } from "./fakes";
import {
	BORROWER_EMAIL,
	type Harness,
	HOUR,
	harness,
	LENDER_EMAIL,
	notesEnv,
} from "./notes-fakes";
import {
	TEST_RECEIPT_KEY_ID,
	TEST_SEAL_KEY_ID,
	type TestSigning,
	testSigning,
} from "./notes-signers";

const BANNED =
	/\b(proof|enforceable|binding|tamper-proof|legally|credit|interest-free)\b/i;

let signing: TestSigning;
beforeAll(async () => {
	signing = await testSigning();
});

const expectOk = <T>(outcome: Outcome<T>): T & { ok: true } => {
	if (!outcome.ok) throw new Error(`${outcome.error}: ${outcome.message}`);
	return outcome;
};

const expectFailure = <T>(outcome: Outcome<T>, error: ErrorCode): void => {
	expect(outcome.ok).toBe(false);
	if (outcome.ok) return;
	expect(outcome.error).toBe(error);
};

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

const withSigning = (overrides: Parameters<typeof harness>[0] = {}): Harness =>
	harness({ signers: signing.signers, ...overrides });

/** A note where the borrower accepted the terms, recorded a payment and the lender confirmed it. */
const paidNote = async (h: Harness) => {
	const noteId = await h.create();
	const lender = (await h.enter(noteId, "lender")).session;
	const borrower = (await h.enter(noteId, "borrower")).session;
	expectOk(
		await h.service.append(
			borrower,
			{ type: "terms.accepted" },
			{ code: await codeFor(h, borrower, "terms.accepted") },
		),
	);
	const payment = expectOk(
		await h.service.append(borrower, {
			type: "payment.recorded",
			kind: "payment",
			amount_minor: "100000",
			value_date: "2026-11-10",
			method: "transfer",
		}),
	).event;
	expectOk(
		await h.service.append(lender, {
			type: "payment.confirmed",
			target: payment.id,
		}),
	);
	return { noteId, lender, borrower, paymentId: payment.id };
};

const storeKinds: [string, () => NoteStore][] = [
	["the in-memory store", () => new MemoryNoteStore()],
	["a real Durable Object", () => new RemoteNoteStore(notesEnv().NOTE)],
];

describe.each(storeKinds)("documents end to end on %s", (_name, makeStore) => {
	test("payoff, release after the cooling-off, bundle: every document verifies offline", async () => {
		const h = withSigning({ store: makeStore() });
		const { noteId, lender, paymentId } = await paidNote(h);
		const before = expectOk(await h.service.view(lender)).view;

		const payoff = expectOk(await h.service.issuePayoff(lender, "2026-11-22"));
		const payoffDocument = JSON.parse(payoff.document.json) as {
			type: string;
			as_of: string;
			signature: { key_id: string; purpose: string };
		};
		expect(payoffDocument.type).toBe("note.payoff-statement");
		expect(payoffDocument.as_of).toBe("2026-11-22");
		expect(payoffDocument.signature).toMatchObject({
			key_id: TEST_RECEIPT_KEY_ID,
			purpose: "receipt",
		});
		const payoffVerdict = await verifyNoteDocument(
			payoffDocument,
			signing.keys,
		);
		expect(payoffVerdict.ok).toBe(true);
		// The event names the body's hash, and the stored row says the same.
		const { signature: _signature, ...payoffBody } = payoffDocument;
		expect(payoff.event).toMatchObject({
			type: "payoff.issued",
			as_of: "2026-11-22",
			entered_by: "lender",
			document_sha256: payoff.document.sha256,
		});
		expect(payoff.document.sha256).toBe(
			await documentSha256(payoffBody as never),
		);

		const draft = expectOk(await h.service.draftRelease(lender)).event;
		expect(draft.type).toBe("release.drafted");
		const refused = await h.service.confirmRelease(lender, draft.id);
		expectFailure(refused, "cooling_off");
		const until = new Date(
			Date.parse(draft.entered_at) + DEFAULT_RELEASE_COOLING_MS,
		).toISOString();
		if (!refused.ok) {
			expect(refused.until).toBe(until);
			expect(refused.message).toContain("2026-11-23 09:00 UTC");
		}
		// One minute short is still refused, and no code was spent on it.
		h.clock.advance(DEFAULT_RELEASE_COOLING_MS - 60_000);
		expectFailure(
			await h.service.confirmRelease(lender, draft.id),
			"cooling_off",
		);
		h.clock.advance(60_000);
		expectFailure(
			await h.service.confirmRelease(lender, draft.id),
			"step_up_required",
		);
		const code = await codeFor(h, lender, "release.confirmed");
		const released = expectOk(
			await h.service.confirmRelease(lender, draft.id, { code }),
		);
		expect(released.event).toMatchObject({
			type: "release.confirmed",
			target: draft.id,
		});
		const releaseDocument = JSON.parse(released.document.json) as {
			type: string;
			released_with_balance: boolean;
			balance_at_release_minor: string;
		};
		expect(releaseDocument.type).toBe("note.release");
		expect((await verifyNoteDocument(releaseDocument, signing.keys)).ok).toBe(
			true,
		);
		// A release changes no balance.
		const after = expectOk(await h.service.view(lender)).view;
		expect(after.state.closed).toBe(true);
		expect(after.statement.lender.payoff_minor).toBe(
			releaseDocument.balance_at_release_minor,
		);
		expect(before.statement.lender.principal_minor).toBe(
			after.statement.lender.principal_minor,
		);
		expect(releaseDocument.released_with_balance).toBe(true);

		// Confirming the same draft again returns the release, never a second one.
		const again = expectOk(
			await h.service.confirmRelease(lender, draft.id, { code: "000000" }),
		);
		expect(again.event.id).toBe(released.event.id);
		expect(again.document.json).toBe(released.document.json);

		expectOk(await h.service.issueReceipt(lender, paymentId));
		const bundle = expectOk(await h.service.bundle(lender)).bundle;
		expect(bundle.seal).not.toBeNull();
		const verdict = await verifyNoteBundle({
			events: bundle.events,
			links: bundle.links,
			documents: [...bundle.documents, bundle.seal],
			keys: signing.keys,
		});
		expect(verdict.ok).toBe(true);
		expect(verdict.chain.ok).toBe(true);
		expect(verdict.documents).toHaveLength(4);
		expect(verdict.documents.every((entry) => entry.ok)).toBe(true);
		// The seal names the current head.
		const sealed = bundle.seal as { head_seq: number };
		expect(sealed.head_seq).toBe(bundle.events.length);
		expect(JSON.parse(JSON.stringify(bundle))).toEqual(bundle);
		expect(noteId).toContain("nt_");
	});
});

describe("receipts", () => {
	test("either party gets one receipt per payment, the same bytes every time, at the head of the day it was first asked", async () => {
		const h = withSigning();
		const { noteId, lender, borrower, paymentId } = await paidNote(h);
		const first = expectOk(await h.service.issueReceipt(borrower, paymentId));
		expect(first.created).toBe(true);
		const body = JSON.parse(first.document.json) as {
			type: string;
			payment_event_id: string;
			chain_head: { seq: number };
			amount_minor: string;
			status: string;
		};
		expect(body).toMatchObject({
			type: "note.payment-receipt",
			payment_event_id: paymentId,
			amount_minor: "100000",
			status: "confirmed by both parties",
		});
		expect(body.chain_head.seq).toBe(
			(await h.store.readLog(noteId)).events.length,
		);
		expect((await verifyNoteDocument(body, signing.keys)).ok).toBe(true);
		// More events, a later clock, the other party: still the first receipt.
		expectOk(
			await h.service.append(lender, { type: "annotation.added", text: "hi" }),
		);
		h.clock.advance(HOUR);
		const second = expectOk(await h.service.issueReceipt(lender, paymentId));
		expect(second.created).toBe(false);
		expect(second.document.json).toBe(first.document.json);
		expect(second.document.id).toBe(first.document.id);
		const stored = await h.store.listDocuments(noteId);
		expect(
			stored.filter((d) => d.type === "note.payment-receipt"),
		).toHaveLength(1);
	});

	test("an event that is not a payment, or nothing, is refused", async () => {
		const h = withSigning();
		const { lender } = await paidNote(h);
		expectFailure(await h.service.issueReceipt(lender, "nope"), "bad_request");
		expectFailure(
			await h.service.issueReceipt(lender, undefined),
			"bad_request",
		);
		const log = await h.store.readLog((lender as { noteId: string }).noteId);
		const created = JSON.parse(log.events[0] as string) as { id: string };
		expectFailure(
			await h.service.issueReceipt(lender, created.id),
			"bad_request",
		);
	});

	test("two asks at once store one receipt", async () => {
		const h = withSigning();
		const { lender, borrower, paymentId } = await paidNote(h);
		const [one, two] = await Promise.all([
			h.service.issueReceipt(lender, paymentId),
			h.service.issueReceipt(borrower, paymentId),
		]);
		expect(expectOk(one).document.json).toBe(expectOk(two).document.json);
	});
});

describe("chain seals", () => {
	test("a seal is signed with the seal key, is reused for the same head and moves on with the chain", async () => {
		const h = withSigning();
		const { noteId, lender, paymentId } = await paidNote(h);
		expectOk(await h.service.issueReceipt(lender, paymentId));
		const first = expectOk(await h.service.sealChain(noteId)).seal;
		const parsed = JSON.parse(first.json) as {
			type: string;
			signature: { key_id: string; purpose: string };
		};
		expect(parsed.type).toBe("note.chain-seal");
		expect(parsed.signature).toMatchObject({
			key_id: TEST_SEAL_KEY_ID,
			purpose: "seal",
		});
		expect((await verifyNoteDocument(parsed, signing.keys)).ok).toBe(true);
		h.clock.advance(HOUR);
		expect(expectOk(await h.service.sealChain(noteId)).seal.json).toBe(
			first.json,
		);
		expectOk(
			await h.service.append(lender, { type: "annotation.added", text: "x" }),
		);
		const later = expectOk(await h.service.sealChain(noteId)).seal;
		expect(later.headSeq).toBe(first.headSeq + 1);
		expect(later.json).not.toBe(first.json);
	});

	test("a seal signed with the receipt key does not verify", async () => {
		const h = withSigning();
		const { noteId } = await paidNote(h);
		const { links } = await h.store.readLog(noteId);
		const body = await chainSealBody(noteId, links, "2026-11-22T09:00:00.000Z");
		// The library itself refuses the wrong pairing ...
		let refused = "";
		try {
			const { signDocument } = await import("tfd-notes");
			await signDocument(body, signing.signers.receipt);
		} catch (error) {
			refused = error instanceof Error ? error.message : String(error);
		}
		expect(refused).toContain("seal key");
		// ... so sign by hand with the receipt key, claiming the seal purpose.
		const signature = await signing.signers.receipt.sign(
			utf8Bytes(canonicalJson(body)),
		);
		const forged = {
			...body,
			signature: {
				key_id: TEST_RECEIPT_KEY_ID,
				purpose: "seal",
				alg: "Ed25519",
				sig: toBase64Url(signature),
			},
		};
		const verdict = await verifyNoteDocument(forged, signing.keys);
		expect(verdict.ok).toBe(false);
		if (!verdict.ok) expect(verdict.code).toBe("key_wrong_purpose");
	});
});

describe("who may do what", () => {
	test("a borrower cannot issue a payoff, draft or confirm a release, or send a notice; nothing is written", async () => {
		const h = withSigning();
		const { noteId, lender, borrower } = await paidNote(h);
		const draft = expectOk(await h.service.draftRelease(lender)).event;
		const length = (await h.store.readLog(noteId)).events.length;
		expectFailure(
			await h.service.issuePayoff(borrower, "2026-11-22"),
			"wrong_role",
		);
		expectFailure(await h.service.draftRelease(borrower), "wrong_role");
		expectFailure(
			await h.service.confirmRelease(borrower, draft.id),
			"wrong_role",
		);
		expectFailure(
			await h.service.sendNotice(borrower, { kind: "reminder" }),
			"wrong_role",
		);
		expect((await h.store.readLog(noteId)).events).toHaveLength(length);
		expect(h.mailer.to(BORROWER_EMAIL).at(-1)?.subject).not.toContain("notice");
	});

	test("the generic append still refuses the four lender events, whoever sends them", async () => {
		const h = withSigning();
		const { lender } = await paidNote(h);
		for (const type of [
			"payoff.issued",
			"release.drafted",
			"release.confirmed",
			"notice.sent",
		]) {
			expectFailure(
				await h.service.append(lender, { type }),
				"forbidden_event",
			);
		}
	});

	test("the permission table: four lender-only actions, step-up on the release confirmation and the notice", () => {
		expect(
			Object.entries(LENDER_ACTIONS).map(([type, rule]) => [
				type,
				rule.roles.join(),
				rule.stepUp,
			]),
		).toEqual([
			["payoff.issued", "lender", false],
			["release.drafted", "lender", false],
			["release.confirmed", "lender", true],
			["notice.sent", "lender", true],
		]);
		expect([...STEP_UP_ACTIONS].sort()).toEqual([
			"notice.sent",
			"payment.disputed",
			"payment.resolved",
			"release.confirmed",
			"terms.accepted",
		]);
	});

	test("step-up codes can be asked for release confirmation and notices, not for a payoff or a draft", async () => {
		const h = withSigning();
		const { lender } = await paidNote(h);
		expect(
			(await h.service.requestStepUp(lender, "release.confirmed")).ok,
		).toBe(true);
		expect((await h.service.requestStepUp(lender, "notice.sent")).ok).toBe(
			true,
		);
		expectFailure(
			await h.service.requestStepUp(lender, "payoff.issued"),
			"bad_request",
		);
		expectFailure(
			await h.service.requestStepUp(lender, "release.drafted"),
			"bad_request",
		);
	});

	test("without signing keys every document step answers not_configured and writes nothing", async () => {
		const h = harness();
		const { noteId, lender, paymentId } = await paidNote(h);
		const length = (await h.store.readLog(noteId)).events.length;
		expectFailure(
			await h.service.issuePayoff(lender, "2026-11-22"),
			"not_configured",
		);
		expectFailure(
			await h.service.issueReceipt(lender, paymentId),
			"not_configured",
		);
		expectFailure(await h.service.sealChain(noteId), "not_configured");
		const draft = expectOk(await h.service.draftRelease(lender)).event;
		h.clock.advance(DEFAULT_RELEASE_COOLING_MS);
		expectFailure(
			await h.service.confirmRelease(lender, draft.id, { code: "123456" }),
			"not_configured",
		);
		expect((await h.store.readLog(noteId)).events).toHaveLength(length + 1);
		// The bundle still comes, with no seal.
		const bundle = expectOk(await h.service.bundle(lender)).bundle;
		expect(bundle.seal).toBeNull();
	});
});

describe("payoff statements", () => {
	test("the client sends a date only; a bad date, a date before the loan or far ahead is refused", async () => {
		const h = withSigning();
		const { noteId, lender } = await paidNote(h);
		const length = (await h.store.readLog(noteId)).events.length;
		for (const asOf of [
			"",
			"2026-13-01",
			"11/22/2026",
			"2026-11-22T00:00",
			5,
		]) {
			expectFailure(await h.service.issuePayoff(lender, asOf), "bad_request");
		}
		expectFailure(
			await h.service.issuePayoff(lender, "2026-10-01"),
			"bad_request",
		);
		expectFailure(
			await h.service.issuePayoff(lender, "2030-01-01"),
			"bad_request",
		);
		expect((await h.store.readLog(noteId)).events).toHaveLength(length);
	});

	test("each statement is a new event and its own document", async () => {
		const h = withSigning();
		const { noteId, lender } = await paidNote(h);
		const one = expectOk(await h.service.issuePayoff(lender, "2026-11-22"));
		const two = expectOk(await h.service.issuePayoff(lender, "2026-12-01"));
		expect(one.document.id).not.toBe(two.document.id);
		const stored = await h.store.listDocuments(noteId);
		expect(
			stored.filter((d) => d.type === "note.payoff-statement"),
		).toHaveLength(2);
		expect((await h.service.sealChain(noteId)).ok).toBe(true);
	});
});

describe("release", () => {
	test("the cooling-off can be set per service, a second draft waits for the first, a draft needs an open note", async () => {
		const h = withSigning({ options: { releaseCoolingMs: HOUR } });
		const { lender } = await paidNote(h);
		const draft = expectOk(await h.service.draftRelease(lender)).event;
		expectFailure(await h.service.draftRelease(lender), "rejected");
		const early = await h.service.confirmRelease(lender, draft.id);
		expectFailure(early, "cooling_off");
		if (!early.ok) expect(early.until).toBe("2026-11-22T10:00:00.000Z");
		expectFailure(
			await h.service.confirmRelease(lender, "nope"),
			"bad_request",
		);
		h.clock.advance(HOUR);
		const code = await codeFor(h, lender, "release.confirmed");
		expectOk(await h.service.confirmRelease(lender, draft.id, { code }));
		expectFailure(await h.service.draftRelease(lender), "rejected");
	});

	test("a wrong code does not release, and the code works once", async () => {
		const h = withSigning({ options: { releaseCoolingMs: 0 } });
		const { noteId, lender } = await paidNote(h);
		const draft = expectOk(await h.service.draftRelease(lender)).event;
		const code = await codeFor(h, lender, "release.confirmed");
		const wrong = code === "000000" ? "111111" : "000000";
		expectFailure(
			await h.service.confirmRelease(lender, draft.id, { code: wrong }),
			"step_up_invalid",
		);
		const length = (await h.store.readLog(noteId)).events.length;
		expectOk(await h.service.confirmRelease(lender, draft.id, { code }));
		expect((await h.store.readLog(noteId)).events).toHaveLength(length + 1);
	});

	test("a reversal after the release reopens the note, and a new release can follow", async () => {
		const h = withSigning({ options: { releaseCoolingMs: HOUR } });
		const { lender, borrower, paymentId } = await paidNote(h);
		const draft = expectOk(await h.service.draftRelease(lender)).event;
		h.clock.advance(HOUR);
		expectOk(
			await h.service.confirmRelease(lender, draft.id, {
				code: await codeFor(h, lender, "release.confirmed"),
			}),
		);
		let view = expectOk(await h.service.view(borrower)).view;
		expect(view.state.closed).toBe(true);
		expect(view.release.confirmed?.documentId).not.toBeNull();
		expect(view.release.reopened).toBe(false);
		expectOk(
			await h.service.append(lender, {
				type: "payment.recorded",
				kind: "reversal",
				amount_minor: "100000",
				value_date: "2026-11-23",
				reverses: paymentId,
			}),
		);
		view = expectOk(await h.service.view(borrower)).view;
		expect(view.state.closed).toBe(false);
		expect(view.release.reopened).toBe(true);
		expectOk(await h.service.draftRelease(lender));
	});

	test("the borrower sees the draft and the release in the view", async () => {
		const h = withSigning({ options: { releaseCoolingMs: HOUR } });
		const { lender, borrower } = await paidNote(h);
		const draft = expectOk(await h.service.draftRelease(lender)).event;
		const seen = expectOk(await h.service.view(borrower)).view;
		expect(seen.release.draft?.id).toBe(draft.id);
		expect(seen.release.draft?.confirmableAt).toBe("2026-11-22T10:00:00.000Z");
		expect(seen.release.confirmed).toBeNull();
	});
});

describe("notices", () => {
	test("a reminder records an event and mails the borrower a plain notice: no amount, no claim, no token", async () => {
		const h = withSigning();
		const { noteId, lender } = await paidNote(h);
		const sent = expectOk(
			await h.service.sendNotice(lender, { kind: "reminder" }),
		);
		expect(sent.mailed).toBe(true);
		expect(sent.event).toMatchObject({ type: "notice.sent", kind: "reminder" });
		const mail = h.mailer.to(BORROWER_EMAIL).at(-1);
		expect(mail?.subject).toBe("Your lender recorded a notice");
		const text = `${mail?.subject}\n${mail?.text}`;
		expect(text).toContain("open your note");
		expect(text).toContain(`/n/${noteId}`);
		expect(text).not.toMatch(/\d[\d,]*\.\d\d|USD|\$/);
		expect(text).not.toMatch(BANNED);
		expect(text).not.toMatch(
			/\b(default|owe|owed|overdue|debt|balance|late)\b/i,
		);
		expect(text).not.toContain("?t=");
		expect(h.mailer.to(LENDER_EMAIL).at(-1)?.subject).not.toBe(mail?.subject);
	});

	test("a default notice needs cure days from 0 to 365 and the emailed code; a reminder takes neither", async () => {
		const h = withSigning();
		const { noteId, lender } = await paidNote(h);
		const length = (await h.store.readLog(noteId)).events.length;
		for (const cureDays of [undefined, -1, 366, 1.5, "7", Number.NaN]) {
			expectFailure(
				await h.service.sendNotice(lender, {
					kind: "default",
					cure_days: cureDays,
				}),
				"bad_request",
			);
		}
		expectFailure(
			await h.service.sendNotice(lender, { kind: "reminder", cure_days: 5 }),
			"bad_request",
		);
		expectFailure(
			await h.service.sendNotice(lender, { kind: "other" }),
			"bad_request",
		);
		expectFailure(
			await h.service.sendNotice(lender, { kind: "default", cure_days: 10 }),
			"step_up_required",
		);
		expect((await h.store.readLog(noteId)).events).toHaveLength(length);
		const code = await codeFor(h, lender, "notice.sent");
		const sent = expectOk(
			await h.service.sendNotice(
				lender,
				{ kind: "default", cure_days: 0 },
				{ code },
			),
		);
		expect(sent.event).toMatchObject({ kind: "default", cure_days: 0 });
		expectFailure(
			await h.service.sendNotice(
				lender,
				{ kind: "default", cure_days: 10 },
				{ code },
			),
			"step_up_required",
		);
	});

	test("the notice is recorded even when the email cannot be sent, and a day allows a few", async () => {
		const h = withSigning();
		const { noteId, lender } = await paidNote(h);
		h.mailer.failNext = true;
		const sent = expectOk(
			await h.service.sendNotice(lender, { kind: "reminder" }),
		);
		expect(sent.mailed).toBe(false);
		expect((await h.store.readLog(noteId)).events.at(-1)).toContain(
			"notice.sent",
		);
		for (let count = 1; count < NOTICES_PER_DAY; count += 1)
			expectOk(await h.service.sendNotice(lender, { kind: "reminder" }));
		expectFailure(
			await h.service.sendNotice(lender, { kind: "reminder" }),
			"rate_limited",
		);
		h.clock.advance(25 * HOUR);
		expectOk(await h.service.sendNotice(lender, { kind: "reminder" }));
	});
});

describe("a record that no longer matches its chain", () => {
	const changeAmount = (text: string): string =>
		text.replace('"amount_minor":"100000"', '"amount_minor":"1"');

	test("the view reports a failed chain verdict instead of crashing, and nothing is issued over it", async () => {
		const store = new MemoryNoteStore();
		const h = withSigning({ store });
		const { noteId, lender, paymentId } = await paidNote(h);
		const receipt = expectOk(await h.service.issueReceipt(lender, paymentId));
		const { events } = await store.readLog(noteId);
		const index = events.findIndex((text) => text.includes(paymentId));
		store.tamperEventForTest(
			noteId,
			index + 1,
			changeAmount(events[index] as string),
		);
		const view = expectOk(await h.service.view(lender)).view;
		expect(view.chain.ok).toBe(false);
		const length = (await store.readLog(noteId)).events.length;
		const documents = (await store.listDocuments(noteId)).length;
		expectFailure(
			await h.service.issuePayoff(lender, "2026-11-22"),
			"chain_invalid",
		);
		expectFailure(
			await h.service.issueReceipt(lender, paymentId),
			"chain_invalid",
		);
		expectFailure(await h.service.draftRelease(lender), "chain_invalid");
		expectFailure(
			await h.service.sendNotice(lender, { kind: "reminder" }),
			"chain_invalid",
		);
		expectFailure(await h.service.sealChain(noteId), "chain_invalid");
		expect((await store.readLog(noteId)).events).toHaveLength(length);
		expect(await store.listDocuments(noteId)).toHaveLength(documents);
		// The bundle still comes, and the offline verifier says what is wrong.
		const bundle = expectOk(await h.service.bundle(lender)).bundle;
		const verdict = await verifyNoteBundle({
			events: bundle.events,
			links: bundle.links,
			documents: [...bundle.documents, bundle.seal],
			keys: signing.keys,
		});
		expect(verdict.ok).toBe(false);
		expect(verdict.chain.ok).toBe(false);
		expect(JSON.parse(receipt.document.json)).toBeTruthy();
	});

	test("an edit that makes the log unreadable answers chain_invalid from the view", async () => {
		const store = new MemoryNoteStore();
		const h = withSigning({ store });
		const { noteId, lender } = await paidNote(h);
		store.tamperEventForTest(noteId, 3, '{"type":"nonsense"}');
		expectFailure(await h.service.view(lender), "chain_invalid");
		expectFailure(
			await h.service.issuePayoff(lender, "2026-11-22"),
			"chain_invalid",
		);
	});
});

describe("the stores", () => {
	const sample = (id: string, eventId: string | null): StoredDocument => ({
		id,
		type: "note.payment-receipt",
		eventId,
		variant: "",
		sha256: "a".repeat(64),
		json: `{"id":"${id}"}`,
		createdAt: "2026-11-22T09:00:00.000Z",
	});

	const sqlStore = (): NoteStore => {
		const state = durableState(new Database(":memory:"));
		migrateNote(state);
		return new SqliteNoteStore(state);
	};

	const both: [string, () => NoteStore][] = [
		["memory", () => new MemoryNoteStore()],
		["sqlite", sqlStore],
	];

	test.each(both)(
		"%s: one document per (type, event), listed in order, and not found under another note",
		async (_name, make) => {
			const store = make();
			const first = await store.putDocumentOnce("nt_a", sample("d1", "e1"));
			const again = await store.putDocumentOnce("nt_a", sample("d2", "e1"));
			expect(again.id).toBe(first.id);
			await store.putDocumentOnce("nt_a", sample("d3", null));
			await store.putDocumentOnce("nt_a", sample("d4", null));
			expect((await store.listDocuments("nt_a")).map((d) => d.id)).toEqual([
				"d1",
				"d3",
				"d4",
			]);
			expect((await store.getDocument("nt_a", "d3"))?.json).toBe('{"id":"d3"}');
			expect(await store.getDocument("nt_b", "d3")).toBeNull();
			expect(await store.getDocument("nt_a", "missing")).toBeNull();
		},
	);

	test.each(both)(
		"%s: a document is one per (type, event, variant): the same event with another variant is a new document",
		async (_name, make) => {
			const store = make();
			const confirmed = { ...sample("d1", "e1"), variant: "confirmed" };
			const disputed = { ...sample("d2", "e1"), variant: "disputed" };
			expect((await store.putDocumentOnce("nt_a", confirmed)).id).toBe("d1");
			expect((await store.putDocumentOnce("nt_a", disputed)).id).toBe("d2");
			expect(
				(
					await store.putDocumentOnce("nt_a", {
						...sample("d3", "e1"),
						variant: "disputed",
					})
				).id,
			).toBe("d2");
			expect(
				(await store.listDocuments("nt_a")).map((d) => [d.id, d.variant]),
			).toEqual([
				["d1", "confirmed"],
				["d2", "disputed"],
			]);
		},
	);

	test.each(both)(
		"%s: a party's unopened links can be deleted, and a share session can be ended",
		async (_name, make) => {
			const store = make();
			const later = "2026-11-23T09:00:00.000Z";
			const now = "2026-11-22T09:00:00.000Z";
			await store.putInvite("nt_a", {
				hash: "h1",
				role: "borrower",
				expiresAt: later,
			});
			await store.putInvite("nt_a", {
				hash: "h2",
				role: "borrower",
				expiresAt: later,
			});
			await store.putInvite("nt_a", {
				hash: "h3",
				role: "lender",
				expiresAt: later,
			});
			expect(await store.redeemInvite("nt_a", "h1", now)).toBe("borrower");
			await store.deleteInvites("nt_a", "borrower");
			expect(await store.redeemInvite("nt_a", "h2", now)).toBeNull();
			expect(await store.redeemInvite("nt_a", "h3", now)).toBe("lender");
			await store.putShareSession("nt_a", {
				hash: "s1",
				grantId: "g1",
				createdAt: now,
				absoluteExpiresAt: later,
			});
			expect((await store.getShareSession("nt_a", "s1", now))?.grantId).toBe(
				"g1",
			);
			await store.deleteShareSession("nt_a", "s1");
			expect(await store.getShareSession("nt_a", "s1", now)).toBeNull();
		},
	);

	test.each(both)(
		"%s: an older seal never replaces a newer one",
		async (_name, make) => {
			const store = make();
			expect(await store.getSeal("nt_a")).toBeNull();
			await store.putSeal("nt_a", {
				headSeq: 3,
				sealedAt: "t3",
				json: "three",
			});
			await store.putSeal("nt_a", { headSeq: 2, sealedAt: "t2", json: "two" });
			expect((await store.getSeal("nt_a"))?.json).toBe("three");
			await store.putSeal("nt_a", { headSeq: 4, sealedAt: "t4", json: "four" });
			expect((await store.getSeal("nt_a"))?.json).toBe("four");
		},
	);

	test("the DDL migration adds the document and seal tables as a new numbered step, and rerunning is harmless", () => {
		expect(NOTE_MIGRATIONS.length).toBeGreaterThanOrEqual(2);
		const state = durableState(new Database(":memory:"));
		expect(migrateNote(state)).toBe(NOTE_MIGRATIONS.length);
		expect(migrateNote(state)).toBe(NOTE_MIGRATIONS.length);
		const tables = state.storage.sql
			.exec("SELECT name FROM sqlite_master WHERE type = 'table'")
			.toArray()
			.map((row) => String(row.name));
		expect(tables).toContain("note_documents");
		expect(tables).toContain("note_seal");
	});

	test("a Durable Object made before step 6 keeps its documents (variant empty) and then takes one receipt per status", async () => {
		const state = durableState(new Database(":memory:"));
		const { sql } = state.storage;
		// The schema as released before the variant column: steps 1 to 5 only.
		sql.exec("CREATE TABLE schema_version (version INTEGER NOT NULL)");
		sql.exec("INSERT INTO schema_version (version) VALUES (5)");
		const db = durableSqlDatabase(state.storage);
		for (const step of NOTE_MIGRATIONS.slice(0, 5)) db.exec(step);
		sql.exec(
			"INSERT INTO note_documents (doc_id, note_id, doc_type, event_id, sha256, body, created_at) VALUES ('old', 'nt_a', 'note.payment-receipt', 'e1', 'x', '{}', 't')",
		);
		expect(migrateNote(state)).toBe(NOTE_MIGRATIONS.length);
		const store = new SqliteNoteStore(state);
		const [old] = await store.listDocuments("nt_a");
		expect(old).toMatchObject({ id: "old", variant: "" });
		const next = await store.putDocumentOnce("nt_a", {
			...sample("new", "e1"),
			variant: "disputed",
		});
		expect(next.id).toBe("new");
	});

	test.each(both)(
		"%s: an event and its document are written together or not at all",
		async (_name, make) => {
			const store = make();
			const [first] = validateStream([
				{
					schema: "tfd.note-event.v1",
					id: "ev1",
					note_id: "nt_x",
					seq: 1,
					entered_at: "2026-11-22T09:00:00.000Z",
					entered_by: "lender",
					type: "note.created",
					terms: {
						currency: "USD",
						exponent: 2,
						principal_minor: "1000",
						issue_date: "2026-11-01",
						annual_rate: "0",
						day_count: "actual/365",
						rounding: "half-up",
						timezone: "UTC",
						schedule: { type: "none" },
					},
				},
			]) as [NoteEvent];
			const [link] = await buildChain([first]);
			const entry = {
				eventJson: JSON.stringify(first),
				link: link as never,
				document: sample("dx", "ev1"),
			};
			expect((await store.append("nt_x", 0, entry)).ok).toBe(true);
			expect(await store.listDocuments("nt_x")).toHaveLength(1);
			// A writer that lost the race leaves neither its event nor its document.
			const lost = await store.append("nt_x", 0, {
				...entry,
				document: sample("dy", "ev1"),
			});
			expect(lost.ok).toBe(false);
			expect((await store.listDocuments("nt_x")).map((d) => d.id)).toEqual([
				"dx",
			]);
		},
	);
});

describe("the production signers", () => {
	test("unset key ids mean no signing; with ids, the Secrets Store keys sign and the key is read only on use", async () => {
		const env = fakeEnv();
		expect(documentSignersFromEnv(env)).toBeNull();
		expect(
			documentSignersFromEnv({
				...env,
				NOTES_RECEIPT_KEY_ID: "trifold-2026-11",
			}),
		).toBeNull();
		let reads = 0;
		const pem = await signingPem();
		const counted = {
			get: async () => {
				reads += 1;
				return pem;
			},
		};
		const signers = documentSignersFromEnv({
			...env,
			NOTES_RECEIPT_KEY_ID: "trifold-2026-11",
			NOTES_SEAL_KEY_ID: "trifold-2026-11-seal",
			SIGNING_RECEIPT: counted,
			SIGNING_SEAL: counted,
			SIGNING_DIRECTORY: counted,
		});
		expect(signers?.receipt).toMatchObject({
			keyId: "trifold-2026-11",
			purpose: "receipt",
		});
		expect(signers?.seal).toMatchObject({
			keyId: "trifold-2026-11-seal",
			purpose: "seal",
		});
		expect(reads).toBe(0);
		const signature = await signers?.receipt.sign(utf8Bytes("hello"));
		expect(signature?.length).toBe(64);
		expect(reads).toBe(3);
	});
});

describe("the source of src/notes", () => {
	test("no banned claim word (interest-free included), no console.log, no Math.random", async () => {
		const directory = join(import.meta.dir, "..", "src", "notes");
		const files = (await readdir(directory)).filter((name) =>
			name.endsWith(".ts"),
		);
		expect(files).toContain("documents-service.ts");
		for (const file of files) {
			const text = await Bun.file(join(directory, file)).text();
			expect({ file, hit: BANNED.exec(text)?.[0] ?? null }).toEqual({
				file,
				hit: null,
			});
			expect({ file, hit: /console\.log|Math\.random/.test(text) }).toEqual({
				file,
				hit: false,
			});
		}
	});
});
