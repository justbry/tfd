import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { grantsOf, validateStream } from "tfd-notes";
import {
	migrateNote,
	RemoteNoteStore,
	SqliteNoteStore,
} from "../src/notes/do-store";
import { MemoryNoteStore } from "../src/notes/memory-store";
import { ShareAccess } from "../src/notes/share-access";
import type { NoteStore, ShareRecord } from "../src/notes/store";
import { durableState } from "./fakes";
import { BORROWER_EMAIL, noteNamespace, notesEnv, SECRET } from "./notes-fakes";
import { expectOk, VIEWER } from "./notes-org-fakes";
import {
	DAY,
	OTHER_RECIPIENT,
	RECIPIENT,
	shareWorld,
} from "./notes-share-fakes";
import { type TestSigning, testSigning } from "./notes-signers";

let signing: TestSigning;
beforeAll(async () => {
	signing = await testSigning();
});

/** The service-level world: a guest note, both parties, and a way to answer a step-up code. */
const setup = async () => {
	const w = shareWorld(signing);
	const note = await w.guestNote();
	const code = async (
		party: { session: never; email: string },
		action: string,
	) => {
		expectOk(await w.h.service.requestStepUp(party.session, action));
		return w.h.mailer.codeFor(party.email);
	};
	const access = new ShareAccess({
		store: w.h.store,
		clock: w.h.clock,
		ids: w.h.ids,
		secret: SECRET,
		keys: { get: async () => signing.keys },
	});
	return { w, ...note, code, access };
};

const person = (overrides: Record<string, unknown> = {}) => ({
	recipient_email: RECIPIENT,
	level: "summary",
	...overrides,
});

describe("proposing a share", () => {
	test("the event holds an opaque reference and the server's own stamps, and the address stays in the store", async () => {
		const { w, noteId, lender } = await setup();
		const proposed = expectOk(
			await w.h.service.proposeShare(lender.session, person()),
		);
		expect(proposed.status).toBe("pending");
		expect(proposed.mailed).toBeNull();
		// Nothing goes to the recipient until the other party agrees.
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(0);
		const log = (await w.h.store.readLog(noteId)).events;
		const event = JSON.parse(log.at(-1) as string);
		expect(event).toMatchObject({
			type: "visibility.changed",
			change: "grant.proposed",
			entered_by: "lender",
			via: "email-link",
			level: "summary",
			grant_id: proposed.grantId,
			seq: 2,
		});
		expect(event.audience.kind).toBe("person");
		expect(event.audience.ref).toMatch(/^sp_/);
		expect(event.expires_at).toBe(
			new Date(Date.parse(w.h.clock.now()) + 30 * DAY).toISOString(),
		);
		for (const text of log) expect(text).not.toContain("@");
		const stored = await w.h.store.getShare(noteId, proposed.grantId);
		expect(stored).toMatchObject({
			kind: "person",
			recipientEmail: RECIPIENT,
			audienceRef: event.audience.ref,
			linkHash: null,
		});
	});

	test("the days are 1 to 365; anything else is refused and writes nothing", async () => {
		const { w, noteId, lender } = await setup();
		const before = (await w.h.store.readLog(noteId)).events.length;
		for (const days of [0, -1, 366, 1.5, "5", Number.NaN, 1e9]) {
			const refused = await w.h.service.proposeShare(
				lender.session,
				person({ days }),
			);
			expect({ days, ok: refused.ok }).toEqual({ days, ok: false });
		}
		expect((await w.h.store.readLog(noteId)).events).toHaveLength(before);
		const longest = expectOk(
			await w.h.service.proposeShare(lender.session, person({ days: 365 })),
		);
		const events = (await w.h.store.readLog(noteId)).events;
		const proposal = JSON.parse(events.at(-1) as string);
		expect(
			Date.parse(proposal.expires_at) - Date.parse(proposal.entered_at),
		).toBe(365 * DAY);
		// The library's own validator accepts it: one day more would be refused there too.
		expect(() =>
			validateStream(events.map((text) => JSON.parse(text))),
		).not.toThrow();
		expect(longest.grantId).toBe(proposal.grant_id);
	});

	test("bad addresses, levels and carve-outs are refused", async () => {
		const { w, lender } = await setup();
		const bad: Record<string, unknown>[] = [
			{ recipient_email: "not an address" },
			{ recipient_email: "a@b" },
			{ recipient_email: 5 },
			{ level: "verify" },
			{ level: "everything" },
			{ carve_out: { purpose: "gossip" } },
			{ carve_out: {} },
			{ carve_out: "yes" },
		];
		for (const override of bad) {
			const refused = await w.h.service.proposeShare(
				lender.session,
				person(override),
			);
			expect({ override, ok: refused.ok }).toEqual({ override, ok: false });
		}
		expect((await w.h.service.proposeShare(lender.session, "x")).ok).toBe(
			false,
		);
	});

	test("a carve-out is active on the proposer's consent alone, emails the recipient once, and is listed for both parties", async () => {
		const { w, noteId, lender, borrower } = await setup();
		const proposed = expectOk(
			await w.h.service.proposeShare(
				lender.session,
				person({ carve_out: { purpose: "accountant" } }),
			),
		);
		expect(proposed.status).toBe("active");
		expect(proposed.mailed).toBe(true);
		const mails = w.h.mailer.to(RECIPIENT);
		expect(mails).toHaveLength(1);
		expect(mails[0]?.subject).toBe("A loan record was shared with you");
		expect(mails[0]?.text).toContain("one of the parties");
		expect(mails[0]?.text).toContain(
			`/s/${noteId}/${proposed.grantId}/enter?t=`,
		);
		// No names, no amounts, no side.
		for (const word of [
			"Maria",
			"Ana",
			"lender",
			"borrower",
			"USD",
			"10,000",
			"10000",
		])
			expect(mails[0]?.text).not.toContain(word);
		const theirs = expectOk(await w.h.service.listShares(borrower.session));
		expect(theirs.sharing.disclosures).toEqual([
			expect.objectContaining({
				grantId: proposed.grantId,
				purpose: "accountant",
				proposedBy: "lender",
				status: "active",
				recipientMasked: "a*********@f***.example",
			}),
		]);
		const mine = expectOk(await w.h.service.listShares(lender.session));
		expect(mine.sharing.shares.map((row) => row.grantId)).toEqual(
			theirs.sharing.shares.map((row) => row.grantId),
		);
		const event = JSON.parse(
			(await w.h.store.readLog(noteId)).events.at(-1) as string,
		);
		expect(event).toMatchObject({ carve_out: true, purpose: "accountant" });
	});

	test("a borrower's carve-out is just as active, and the lender sees it as the other party's", async () => {
		const { w, lender, borrower } = await setup();
		expectOk(
			await w.h.service.proposeShare(
				borrower.session,
				person({
					recipient_email: OTHER_RECIPIENT,
					level: "statement",
					carve_out: { purpose: "lawyer" },
				}),
			),
		);
		const log = expectOk(await w.h.service.listShares(lender.session)).sharing
			.disclosures;
		expect(log).toHaveLength(1);
		expect(log[0]).toMatchObject({ proposedBy: "borrower", purpose: "lawyer" });
	});

	test("a mail failure on a carve-out leaves the share standing and reports it", async () => {
		const { w, lender } = await setup();
		w.h.mailer.failNext = true;
		const proposed = expectOk(
			await w.h.service.proposeShare(
				lender.session,
				person({ carve_out: { purpose: "lawyer" } }),
			),
		);
		expect(proposed).toMatchObject({ status: "active", mailed: false });
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(0);
	});

	test("proposals are limited to ten per note per day", async () => {
		const { w, noteId, lender } = await setup();
		for (let count = 0; count < 10; count += 1)
			expectOk(await w.h.service.proposeShare(lender.session, person()));
		const before = (await w.h.store.readLog(noteId)).events.length;
		const limited = await w.h.service.proposeShare(lender.session, person());
		expect(limited).toMatchObject({ ok: false, error: "rate_limited" });
		const link = await w.h.service.createVerifyLink(lender.session, {});
		expect(link).toMatchObject({ ok: false, error: "rate_limited" });
		expect((await w.h.store.readLog(noteId)).events).toHaveLength(before);
		w.h.clock.advance(DAY);
		expectOk(await w.h.service.proposeShare(lender.session, person()));
	});
});

describe("consent", () => {
	test("the other party consents with the emailed code; only then is the recipient emailed", async () => {
		const { w, noteId, lender, borrower, code } = await setup();
		const { grantId } = expectOk(
			await w.h.service.proposeShare(lender.session, person()),
		);
		// The proposer already counts as consent: a second consent from that side is refused.
		expect(
			await w.h.service.consentShare(lender.session, grantId),
		).toMatchObject({
			ok: false,
		});
		const waiting = expectOk(await w.h.service.listShares(borrower.session));
		expect(waiting.sharing.shares[0]).toMatchObject({
			status: "pending",
			awaitingMe: true,
		});
		expect(
			expectOk(await w.h.service.listShares(lender.session)).sharing.shares[0],
		).toMatchObject({ awaitingMe: false });

		const noCode = await w.h.service.consentShare(borrower.session, grantId);
		expect(noCode).toMatchObject({ ok: false, error: "step_up_required" });
		const sent = await code(borrower as never, "grant.consented");
		const wrong = sent === "000000" ? "111111" : "000000";
		expect(
			await w.h.service.consentShare(borrower.session, grantId, {
				code: wrong,
			}),
		).toMatchObject({ ok: false, error: "step_up_invalid" });
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(0);
		const fresh = await code(borrower as never, "grant.consented");
		const done = expectOk(
			await w.h.service.consentShare(borrower.session, grantId, {
				code: fresh,
			}),
		);
		expect(done).toMatchObject({ status: "active", mailed: true });
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(1);
		// A code spent on one step opens nothing else, and a second consent finds nothing waiting.
		expect(
			await w.h.service.consentShare(borrower.session, grantId, {
				code: fresh,
			}),
		).toMatchObject({ ok: false });
		const events = (await w.h.store.readLog(noteId)).events.map((text) =>
			JSON.parse(text),
		);
		expect(grantsOf(events, w.h.clock.now())[0]?.consented_by).toEqual([
			"lender",
			"borrower",
		]);
	});

	test("a code asked for another action does not consent", async () => {
		const { w, borrower, lender, code } = await setup();
		const { grantId } = expectOk(
			await w.h.service.proposeShare(lender.session, person()),
		);
		const other = await code(borrower as never, "terms.accepted");
		expect(
			await w.h.service.consentShare(borrower.session, grantId, {
				code: other,
			}),
		).toMatchObject({ ok: false });
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(0);
	});

	test("an unknown or already ended share is not consented to", async () => {
		const { w, borrower, lender, code } = await setup();
		expect(
			await w.h.service.consentShare(borrower.session, "nope", { code: "1" }),
		).toMatchObject({ ok: false });
		expect(await w.h.service.consentShare(borrower.session, 5)).toMatchObject({
			ok: false,
			error: "bad_request",
		});
		const { grantId } = expectOk(
			await w.h.service.proposeShare(lender.session, person()),
		);
		expectOk(await w.h.service.revokeShare(borrower.session, grantId));
		const fresh = await code(borrower as never, "grant.consented");
		expect(
			await w.h.service.consentShare(borrower.session, grantId, {
				code: fresh,
			}),
		).toMatchObject({ ok: false, error: "rejected" });
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(0);
	});
});

describe("revoking and ending", () => {
	test("either party revokes at once, and the viewer's very next read finds nothing", async () => {
		for (const revoker of ["lender", "borrower"] as const) {
			const { w, noteId, lender, borrower, access } = await setup();
			const { grantId } = expectOk(
				await w.h.service.proposeShare(
					lender.session,
					person({ level: "statement", carve_out: { purpose: "accountant" } }),
				),
			);
			expect(await access.viewOf(noteId, grantId)).not.toBeNull();
			const party = revoker === "lender" ? lender : borrower;
			expectOk(await w.h.service.revokeShare(party.session, grantId));
			expect(await access.viewOf(noteId, grantId)).toBeNull();
			const again = await w.h.service.revokeShare(party.session, grantId);
			expect(again).toMatchObject({ ok: false, error: "rejected" });
			const listed = expectOk(await w.h.service.listShares(borrower.session));
			expect(listed.sharing.shares[0]).toMatchObject({
				status: "revoked",
				revokedBy: revoker,
			});
			// A revoked carve-out stays in the log.
			expect(listed.sharing.disclosures).toHaveLength(1);
			expect(listed.sharing.disclosures[0]?.status).toBe("revoked");
		}
	});

	test("an unknown share cannot be revoked", async () => {
		const { w, lender } = await setup();
		expect(await w.h.service.revokeShare(lender.session, "nope")).toMatchObject(
			{
				ok: false,
				error: "not_found",
			},
		);
		expect(
			await w.h.service.revokeShare(lender.session, undefined),
		).toMatchObject({ ok: false, error: "bad_request" });
	});

	test("a share ends at its expiry instant exactly", async () => {
		const { w, noteId, lender, access } = await setup();
		const { grantId } = expectOk(
			await w.h.service.proposeShare(
				lender.session,
				person({ days: 2, carve_out: { purpose: "accountant" } }),
			),
		);
		const events = (await w.h.store.readLog(noteId)).events.map((text) =>
			JSON.parse(text),
		);
		const end = Date.parse(events.at(-1).expires_at);
		w.h.clock.set(new Date(end - 1).toISOString());
		expect(await access.viewOf(noteId, grantId)).not.toBeNull();
		w.h.clock.set(new Date(end).toISOString());
		expect(await access.viewOf(noteId, grantId)).toBeNull();
		const listed = expectOk(await w.h.service.listShares(lender.session));
		expect(listed.sharing.shares[0]?.status).toBe("expired");
		// An expired share is over: revoking it is refused, and it stays in the log.
		expect(
			await w.h.service.revokeShare(lender.session, grantId),
		).toMatchObject({
			ok: false,
		});
		expect(listed.sharing.disclosures[0]?.status).toBe("expired");
	});
});

describe("resending a person's link", () => {
	test("the proposer sends it again; the old link stops working; others cannot", async () => {
		const { w, noteId, lender, borrower, access } = await setup();
		const { grantId } = expectOk(
			await w.h.service.proposeShare(
				lender.session,
				person({ carve_out: { purpose: "accountant" } }),
			),
		);
		const firstToken = w.h.mailer.linkTokenFor(RECIPIENT);
		expect(
			await w.h.service.resendShare(borrower.session, grantId),
		).toMatchObject({ ok: false, error: "not_found" });
		expectOk(await w.h.service.resendShare(lender.session, grantId));
		const secondToken = w.h.mailer.linkTokenFor(RECIPIENT);
		expect(secondToken).not.toBe(firstToken);
		expect(await access.redeem(noteId, grantId, firstToken)).toBeNull();
		expect(await access.redeem(noteId, grantId, secondToken)).not.toBeNull();
		// A pending share has no link to send.
		const pending = expectOk(
			await w.h.service.proposeShare(lender.session, person()),
		);
		expect(
			await w.h.service.resendShare(lender.session, pending.grantId),
		).toMatchObject({ ok: false });
	});
});

describe("verify links", () => {
	test("pending until the other party agrees; then the proposer sees the token once", async () => {
		const { w, noteId, lender, borrower, code, access } = await setup();
		const made = expectOk(
			await w.h.service.createVerifyLink(lender.session, { days: 10 }),
		);
		expect(made.status).toBe("pending");
		const event = JSON.parse(
			(await w.h.store.readLog(noteId)).events.at(-1) as string,
		);
		expect(event).toMatchObject({ level: "verify" });
		expect(event.audience.kind).toBe("link");
		expect(event.audience.ref).toMatch(/^sl_/);
		// Pending: there is nothing to show yet.
		expect(
			await w.h.service.revealVerifyLink(lender.session, made.grantId),
		).toMatchObject({ ok: false });
		const fresh = await code(borrower as never, "grant.consented");
		const consented = expectOk(
			await w.h.service.consentShare(borrower.session, made.grantId, {
				code: fresh,
			}),
		);
		expect(consented.mailed).toBeNull();
		expect(w.h.mailer.sent.at(-1)?.to).not.toBe("");
		expect(
			expectOk(await w.h.service.listShares(lender.session)).sharing.shares[0],
		).toMatchObject({ canReveal: true });
		expect(
			expectOk(await w.h.service.listShares(borrower.session)).sharing
				.shares[0],
		).toMatchObject({ canReveal: false });
		// Only the proposer may reveal it.
		expect(
			await w.h.service.revealVerifyLink(borrower.session, made.grantId),
		).toMatchObject({ ok: false, error: "not_found" });
		const shown = expectOk(
			await w.h.service.revealVerifyLink(lender.session, made.grantId),
		);
		expect(shown.url).toBe(
			`https://staging-ledger.trifold.app/v/${shown.token}`,
		);
		expect(shown.token.startsWith(`${noteId}.`)).toBe(true);
		const again = await w.h.service.revealVerifyLink(
			lender.session,
			made.grantId,
		);
		expect(again).toMatchObject({ ok: false, error: "rejected" });
		expect(await access.verifyContext(shown.token)).toMatchObject({ noteId });
		// Only a hash of the token is kept.
		const stored = await w.h.store.getShare(noteId, made.grantId);
		expect(stored?.linkHash).toMatch(/^[0-9a-f]{64}$/);
		expect(JSON.stringify(stored)).not.toContain(
			shown.token.split(".")[1] ?? "?",
		);
		expect(
			expectOk(await w.h.service.listShares(lender.session)).sharing.shares[0],
		).toMatchObject({ canReveal: false });
	});

	test("a token fails for another note, another secret, a revoked link and past the expiry instant", async () => {
		const { w, noteId, lender, borrower, code, access } = await setup();
		const other = await w.guestNote("share-2");
		const make = async (
			party: typeof lender,
			otherParty: typeof borrower,
			days: number,
		) => {
			const made = expectOk(
				await w.h.service.createVerifyLink(party.session, { days }),
			);
			const fresh = await code(otherParty as never, "grant.consented");
			expectOk(
				await w.h.service.consentShare(otherParty.session, made.grantId, {
					code: fresh,
				}),
			);
			return expectOk(
				await w.h.service.revealVerifyLink(party.session, made.grantId),
			);
		};
		const first = await make(lender, borrower, 3);
		const second = await make(other.lender, other.borrower, 10);
		expect(await access.verifyContext(first.token)).not.toBeNull();
		const [, firstSecret = ""] = first.token.split(".");
		const [, secondSecret = ""] = second.token.split(".");
		expect(
			await access.verifyContext(`${other.noteId}.${firstSecret}`),
		).toBeNull();
		expect(await access.verifyContext(`${noteId}.${secondSecret}`)).toBeNull();
		expect(
			await access.verifyContext(`${noteId}.${"b".repeat(40)}`),
		).toBeNull();
		expect(await access.verifyContext("garbage")).toBeNull();
		expect(await access.verifyContext(firstSecret)).toBeNull();
		const events = await w.events(noteId);
		const proposal = events.find(
			(event) =>
				event.type === "visibility.changed" &&
				event.change === "grant.proposed",
		);
		const end = Date.parse(
			(proposal as unknown as { expires_at: string }).expires_at,
		);
		w.h.clock.set(new Date(end - 1).toISOString());
		expect(await access.verifyContext(first.token)).not.toBeNull();
		w.h.clock.set(new Date(end).toISOString());
		expect(await access.verifyContext(first.token)).toBeNull();
		expect(await access.verifyContext(second.token)).not.toBeNull();
	});

	test("either party revokes a verify link and the next check finds nothing", async () => {
		const { w, lender, borrower, code, access } = await setup();
		const made = expectOk(
			await w.h.service.createVerifyLink(lender.session, {}),
		);
		const fresh = await code(borrower as never, "grant.consented");
		expectOk(
			await w.h.service.consentShare(borrower.session, made.grantId, {
				code: fresh,
			}),
		);
		const shown = expectOk(
			await w.h.service.revealVerifyLink(lender.session, made.grantId),
		);
		expect(await access.verifyContext(shown.token)).not.toBeNull();
		expectOk(await w.h.service.revokeShare(borrower.session, made.grantId));
		expect(await access.verifyContext(shown.token)).toBeNull();
	});
});

describe("an organization lender", () => {
	const orgSetup = async () => {
		const w = shareWorld(signing);
		const created = await w.h.createOrgNote();
		const refs = w.h.refsOf(created.agents);
		const treasurer = await w.openAgent(created.noteId, "tess@coop.test");
		const board = await w.openAgent(created.noteId, "bo@coop.test");
		const viewer = await w.openAgent(created.noteId, VIEWER);
		const borrower = await w.openGuest(
			created.noteId,
			"borrower",
			BORROWER_EMAIL,
		);
		return {
			w,
			noteId: created.noteId,
			refs,
			treasurer,
			board,
			viewer,
			borrower,
		};
	};

	test("a viewer cannot propose, a treasurer can, and the borrower side consents", async () => {
		const { w, noteId, refs, treasurer, viewer, borrower, board } =
			await orgSetup();
		const before = (await w.h.store.readLog(noteId)).events.length;
		expect(
			await w.h.service.proposeShare(viewer.session, person()),
		).toMatchObject({
			ok: false,
			error: "wrong_role",
		});
		expect(
			await w.h.service.createVerifyLink(viewer.session, {}),
		).toMatchObject({
			ok: false,
			error: "wrong_role",
		});
		expect((await w.h.store.readLog(noteId)).events).toHaveLength(before);
		const proposed = expectOk(
			await w.h.service.proposeShare(treasurer.session, person()),
		);
		const event = JSON.parse(
			(await w.h.store.readLog(noteId)).events.at(-1) as string,
		);
		expect(event).toMatchObject({
			entered_by: "lender",
			agent_ref: refs.treasurer,
		});
		// A board member of the lender's team is the same side as the proposer: they cannot consent for the other side.
		expect(
			await w.h.service.consentShare(board.session, proposed.grantId),
		).toMatchObject({ ok: false });
		expectOk(
			await w.h.service.requestStepUp(borrower.session, "grant.consented"),
		);
		const done = expectOk(
			await w.h.service.consentShare(borrower.session, proposed.grantId, {
				code: w.h.mailer.codeFor(BORROWER_EMAIL),
			}),
		);
		expect(done.status).toBe("active");
		expect(w.h.mailer.to(RECIPIENT)).toHaveLength(1);
		// Viewer reads the list and can press nothing.
		const read = expectOk(await w.h.service.listShares(viewer.session));
		expect(read.sharing.canAct).toBe(false);
		expect(read.sharing.shares[0]).toMatchObject({
			status: "active",
			awaitingMe: false,
			canResend: false,
		});
		expect(
			await w.h.service.revokeShare(viewer.session, proposed.grantId),
		).toMatchObject({ ok: false, error: "wrong_role" });
		expectOk(await w.h.service.revokeShare(board.session, proposed.grantId));
	});

	test("when the borrower proposes, a treasurer or board member of the lender consents with their own code; a viewer cannot", async () => {
		const { w, noteId, treasurer, viewer, borrower } = await orgSetup();
		const proposed = expectOk(
			await w.h.service.proposeShare(borrower.session, person()),
		);
		expect(
			await w.h.service.consentShare(viewer.session, proposed.grantId),
		).toMatchObject({ ok: false, error: "wrong_role" });
		expectOk(
			await w.h.service.requestStepUp(treasurer.session, "grant.consented"),
		);
		const code = w.h.mailer.codeFor("tess@coop.test");
		const done = expectOk(
			await w.h.service.consentShare(treasurer.session, proposed.grantId, {
				code,
			}),
		);
		expect(done.status).toBe("active");
		const event = JSON.parse(
			(await w.h.store.readLog(noteId)).events.at(-1) as string,
		);
		expect(event).toMatchObject({
			change: "grant.consented",
			entered_by: "lender",
		});
	});

	test("only the agent who proposed a verify link may reveal it", async () => {
		const { w, treasurer, board, borrower } = await orgSetup();
		const made = expectOk(
			await w.h.service.createVerifyLink(treasurer.session, {}),
		);
		expectOk(
			await w.h.service.requestStepUp(borrower.session, "grant.consented"),
		);
		expectOk(
			await w.h.service.consentShare(borrower.session, made.grantId, {
				code: w.h.mailer.codeFor(BORROWER_EMAIL),
			}),
		);
		expect(
			await w.h.service.revealVerifyLink(board.session, made.grantId),
		).toMatchObject({ ok: false, error: "not_found" });
		expectOk(
			await w.h.service.revealVerifyLink(treasurer.session, made.grantId),
		);
	});
});

const stores: [string, () => NoteStore][] = [
	["memory", () => new MemoryNoteStore()],
	[
		"sqlite Durable Object storage",
		() => {
			const state = durableState(new Database(":memory:"));
			migrateNote(state);
			return new SqliteNoteStore(state);
		},
	],
	[
		"remote (Worker to NoteDO)",
		() => new RemoteNoteStore(noteNamespace(notesEnv())),
	],
];

const share = (
	grantId: string,
	overrides: Partial<ShareRecord> = {},
): ShareRecord => ({
	grantId,
	kind: "person",
	audienceRef: `sp_${grantId}`,
	recipientEmail: "x@y.example",
	linkHash: null,
	linkUsedAt: null,
	createdAt: "2026-11-22T09:00:00.000Z",
	...overrides,
});

for (const [name, make] of stores) {
	describe(`NoteStore contract, shares: ${name}`, () => {
		test("a share is kept once per grant, listed in order, and a note's shares are apart", async () => {
			const store = make();
			await store.putShare("n1", share("g1"));
			await store.putShare(
				"n1",
				share("g2", { kind: "link", recipientEmail: null }),
			);
			await store.putShare(
				"n1",
				share("g1", { recipientEmail: "other@y.example" }),
			);
			expect((await store.listShares("n1")).map((row) => row.grantId)).toEqual([
				"g1",
				"g2",
			]);
			expect(await store.getShare("n1", "g1")).toMatchObject({
				recipientEmail: "x@y.example",
			});
			expect(await store.getShare("n1", "g2")).toMatchObject({
				kind: "link",
				recipientEmail: null,
			});
			expect(await store.getShare("n1", "nope")).toBeNull();
		});

		test("a link hash is written once unless replaced, and a claim works for one caller with the right hash", async () => {
			const store = make();
			await store.putShare("n1", share("g1"));
			expect(await store.issueShareLink("n1", "g1", "h1", false)).toBe(true);
			expect(await store.issueShareLink("n1", "g1", "h2", false)).toBe(false);
			expect(await store.claimShareLink("n1", "g1", "wrong", "t")).toBe(false);
			expect(await store.claimShareLink("n1", "g1", "h1", "t1")).toBe(true);
			expect(await store.claimShareLink("n1", "g1", "h1", "t2")).toBe(false);
			expect((await store.getShare("n1", "g1"))?.linkUsedAt).toBe("t1");
			// Replacing makes a fresh, unused link and retires the old hash.
			expect(await store.issueShareLink("n1", "g1", "h3", true)).toBe(true);
			expect(await store.claimShareLink("n1", "g1", "h1", "t3")).toBe(false);
			expect(await store.claimShareLink("n1", "g1", "h3", "t4")).toBe(true);
			expect(await store.issueShareLink("n1", "missing", "h", true)).toBe(
				false,
			);
		});

		test("a share session ends at its absolute time, exactly", async () => {
			const store = make();
			await store.putShareSession("n1", {
				hash: "s1",
				grantId: "g1",
				createdAt: "2026-11-22T09:00:00.000Z",
				absoluteExpiresAt: "2026-11-22T21:00:00.000Z",
			});
			expect(
				await store.getShareSession("n1", "s1", "2026-11-22T20:59:59.999Z"),
			).toMatchObject({ grantId: "g1" });
			expect(
				await store.getShareSession("n1", "s1", "2026-11-22T21:00:00.000Z"),
			).toBeNull();
			expect(
				await store.getShareSession("n1", "s1", "2026-11-22T09:00:00.000Z"),
			).toBeNull();
			expect(
				await store.getShareSession("n1", "none", "2026-11-22T09:00:00.000Z"),
			).toBeNull();
		});
	});
}

describe("source scan: sharing", () => {
	const directory = join(import.meta.dir, "..", "src", "notes");
	const files = readdirSync(directory).filter((file) => file.endsWith(".ts"));
	const BANNED =
		/\b(proof|enforceable|binding|tamper-proof|legally|credit|interest-free)\b/i;

	test("the new files exist and carry no banned claim word, no console.log and no Math.random", async () => {
		for (const name of [
			"share-core.ts",
			"share-access.ts",
			"share-pages.ts",
			"share-routes.ts",
		])
			expect(files).toContain(name);
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

	test("the viewer's pages import nothing that carries a dispute, an age, a notice or an annotation", async () => {
		const text = await Bun.file(join(directory, "share-pages.ts")).text();
		const imported = [...text.matchAll(/from "([^"]+)"/g)].map(
			(match) => match[1],
		);
		expect(imported.sort()).toEqual(["./pages", "./share-core", "tfd-notes"]);
		// The viewer pages take SharedView (and a sign-out token); the verify page takes a token and a verdict, and lists
		// nothing about the record.
		expect(text).toContain(
			"export const sharedViewPage = (\n\tview: SharedView,",
		);
		expect(text).not.toContain("VerifyDocumentRow");
		expect(text).not.toContain("issued documents");
		for (const forbidden of [
			"statement(",
			"difference",
			"unanswered",
			"agent_ref",
			"reason",
		])
			expect({ forbidden, found: text.includes(forbidden) }).toEqual({
				forbidden,
				found: false,
			});
	});
});
