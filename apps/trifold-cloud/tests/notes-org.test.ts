import { beforeAll, describe, expect, test } from "bun:test";
import {
	approvalStatus,
	pendingApprovals,
	statement,
	validateStream,
	verifyChain,
} from "tfd-notes";
import { satisfiedRequestIds } from "../src/notes/approvals-view";
import { emailHash, ORG_POLICY } from "../src/notes/org";
import type { MemoryOrgStore } from "../src/notes/org-memory-store";
import type { NoteView, Outcome } from "../src/notes/service";
import type { ActiveSession } from "../src/notes/sessions";
import {
	BORROWER_EMAIL,
	HOUR,
	harness,
	LENDER_EMAIL,
	SECRET,
} from "./notes-fakes";
import {
	BOARD,
	BOARD_TWO,
	EUR_TERMS,
	expectOk,
	ORG_ID,
	type OrgHarness,
	orgHarness,
	THREE_AGENTS,
	TREASURER,
	VIEWER,
} from "./notes-org-fakes";
import { type TestSigning, testSigning } from "./notes-signers";

let signing: TestSigning;
beforeAll(async () => {
	signing = await testSigning();
});

const PAYMENT = {
	type: "payment.recorded",
	kind: "payment",
	amount_minor: "100000",
	value_date: "2026-11-10",
	method: "transfer",
};

const eventsOf = async (h: OrgHarness, noteId: string) =>
	validateStream(
		(await h.store.readLog(noteId)).events.map((text): unknown =>
			JSON.parse(text),
		),
	);

const viewOf = async (
	h: OrgHarness,
	session: ActiveSession,
): Promise<NoteView> => expectOk(await h.service.view(session)).view;

const expectFailure = <T>(
	outcome: Outcome<T>,
	error: string,
	missing?: string,
): void => {
	expect(outcome).toMatchObject(
		missing === undefined
			? { ok: false, error }
			: { ok: false, error, missing },
	);
};

describe("an organization lender: the registry", () => {
	test("a note with three agents: opaque refs, one link each, nobody learns another's address", async () => {
		const h = orgHarness();
		const created = await h.createOrgNote();
		expect(created.created).toBe(true);
		const refs = h.refsOf(created.agents);
		expect(Object.keys(refs).sort()).toEqual(["board", "treasurer", "viewer"]);
		for (const ref of Object.values(refs)) {
			expect(ref).toMatch(/^ar_/);
			// A ref is random, never derived from an address.
			for (const email of [TREASURER, BOARD, VIEWER])
				expect(ref).not.toContain(email.split("@")[0] as string);
		}
		expect(new Set(Object.values(refs)).size).toBe(3);
		expect(JSON.stringify(created)).not.toContain("@");

		// One mail per agent and one for the borrower; each link is its own.
		expect(h.mailer.sent).toHaveLength(4);
		const tokens = [TREASURER, BOARD, VIEWER].map((email) =>
			h.mailer.linkTokenFor(email),
		);
		expect(new Set(tokens).size).toBe(3);
		for (const email of [TREASURER, BOARD, VIEWER]) {
			const text = h.mailer.to(email)[0]?.text ?? "";
			expect(text).not.toContain(BORROWER_EMAIL);
			for (const other of [TREASURER, BOARD, VIEWER].filter(
				(candidate) => candidate !== email,
			))
				expect(text).not.toContain(other);
		}
		const borrowerText = h.mailer.to(BORROWER_EMAIL)[0]?.text ?? "";
		for (const email of [TREASURER, BOARD, VIEWER])
			expect(borrowerText).not.toContain(email);
		expect(borrowerText).toContain("/n/");
		expect(h.mailer.to(LENDER_EMAIL)).toHaveLength(0);

		// The log holds no address and no agent: the lender's side started it.
		const log = (await h.store.readLog(created.noteId)).events.join("\n");
		expect(log).not.toContain("@");
		expect(log).not.toContain("agent_ref");
		expect(await h.store.getOrg(created.noteId)).toBe(ORG_ID);
		expect(await h.orgs.listNotes(ORG_ID, 10)).toEqual([created.noteId]);
	});

	test("each agent's link opens once, for that agent, with their role", async () => {
		const h = orgHarness();
		const { noteId } = await h.createOrgNote();
		for (const [email, role] of [
			[TREASURER, "treasurer"],
			[BOARD, "board"],
			[VIEWER, "viewer"],
		] as const) {
			const token = h.mailer.linkTokenFor(email);
			const { orgSession, session } = await h.enterAgent(noteId, email);
			expect(orgSession.role).toBe(role);
			expect(session.agent?.role).toBe(role);
			expect(session.role).toBe("lender");
			expect(await h.org.sessions.redeem(ORG_ID, token)).toBeNull();
		}
		// A link of this organization opens nothing for another one.
		const fresh = orgHarness();
		await fresh.createOrgNote({ orgId: "other-org" });
		expect(
			await fresh.org.sessions.redeem(
				ORG_ID,
				fresh.mailer.linkTokenFor(TREASURER),
			),
		).toBeNull();
	});

	test("creation checks: org id, agents, roles, the borrower on the team, an organization that is not set up", async () => {
		const h = orgHarness();
		const base = {
			terms: EUR_TERMS,
			borrower: { email: BORROWER_EMAIL },
			idem: "x1",
		};
		const attempt = (
			lender: { org_id: string; agents: unknown },
			idem: string,
		) => h.service.createNote({ ...base, lender, idem });
		expectFailure(
			await attempt({ org_id: "has space", agents: THREE_AGENTS }, "a"),
			"bad_request",
		);
		expectFailure(
			await attempt({ org_id: "x".repeat(65), agents: THREE_AGENTS }, "b"),
			"bad_request",
		);
		expectFailure(
			await attempt({ org_id: ORG_ID, agents: [] }, "c"),
			"bad_request",
		);
		expectFailure(
			await attempt(
				{ org_id: ORG_ID, agents: [{ email: TREASURER, role: "owner" }] },
				"d",
			),
			"bad_request",
		);
		expectFailure(
			await attempt(
				{
					org_id: ORG_ID,
					agents: [
						{ email: TREASURER, role: "board" },
						{ email: TREASURER.toUpperCase(), role: "viewer" },
					],
				},
				"e",
			),
			"bad_request",
		);
		expectFailure(
			await attempt(
				{
					org_id: ORG_ID,
					agents: [{ email: BORROWER_EMAIL, role: "board" }],
				},
				"f",
			),
			"same_party",
		);
		expect(h.mailer.sent).toHaveLength(0);
		expect(h.store.size).toBe(0);
		const bare = harness();
		expectFailure(
			await bare.service.createNote({
				...base,
				lender: { org_id: ORG_ID, agents: THREE_AGENTS },
			}),
			"not_configured",
		);
	});

	test("a retried create is the same note with the same agents and sends nothing more", async () => {
		const h = orgHarness();
		const first = await h.createOrgNote();
		const sent = h.mailer.sent.length;
		const again = await h.createOrgNote();
		expect(again.created).toBe(false);
		expect(again.noteId).toBe(first.noteId);
		expect(h.refsOf(again.agents)).toEqual(h.refsOf(first.agents));
		expect(h.mailer.sent).toHaveLength(sent);
		expectFailure(
			await h.service.createNote({
				terms: EUR_TERMS,
				lender: { org_id: ORG_ID, agents: THREE_AGENTS },
				borrower: { email: BORROWER_EMAIL },
				idem: "org-idem-1",
			}),
			"idempotency_conflict",
		);
	});

	test("an address the organization already knows is one agent of the organization but has a fresh ref on every note", async () => {
		const h = orgHarness();
		const one = await h.createOrgNote({ idem: "n1" });
		const two = await h.createOrgNote({ idem: "n2" });
		const first = h.refsOf(one.agents);
		const second = h.refsOf(two.agents);
		// A borrower with two notes cannot tell that the same person acted on both.
		for (const role of ["treasurer", "board", "viewer"])
			expect(first[role]).not.toBe(second[role]);
		expect(
			new Set([...Object.values(first), ...Object.values(second)]).size,
		).toBe(6);
		expect(await h.orgs.listNotes(ORG_ID, 10)).toHaveLength(2);
		// One link and one session still open both notes: the organization knows it is one person.
		const { orgSession } = await h.enterAgent(one.noteId, TREASURER);
		const onTwo = await h.org.noteSession(orgSession, two.noteId);
		expect(onTwo?.agent?.agentRef).toBe(second.treasurer);
		expect(onTwo?.agent?.agentId).toBe(orgSession.agentId);
	});

	test("what each note's events carry for the same person differs, so a borrower with two notes cannot link them", async () => {
		const h = orgHarness();
		const one = await h.createOrgNote({
			idem: "n1",
			borrower: "ana@example.com",
		});
		const two = await h.createOrgNote({
			idem: "n2",
			borrower: "ana@example.com",
		});
		const signedIn = await h.enterAgent(one.noteId, TREASURER);
		const asOne = signedIn.session;
		const asTwo = await h.org.noteSession(signedIn.orgSession, two.noteId);
		expectOk(await h.service.append(asOne, PAYMENT));
		expectOk(await h.service.append(asTwo as ActiveSession, PAYMENT));
		const refsIn = async (noteId: string) =>
			new Set(
				(await eventsOf(h, noteId))
					.map((event) => event.agent_ref)
					.filter((ref): ref is string => ref !== undefined),
			);
		const inOne = await refsIn(one.noteId);
		const inTwo = await refsIn(two.noteId);
		expect(inOne.size).toBe(1);
		expect(inTwo.size).toBe(1);
		for (const ref of inOne) expect(inTwo.has(ref)).toBe(false);
		// Neither log carries the organization-wide id.
		const logs = [
			...(await h.store.readLog(one.noteId)).events,
			...(await h.store.readLog(two.noteId)).events,
		].join("\n");
		expect(logs).not.toContain("ag_");
	});

	test("the index keeps a salted hash of an address and never the address", async () => {
		const h = orgHarness();
		await h.createOrgNote();
		const dump = (h.orgs as MemoryOrgStore).dumpForTest();
		for (const email of [TREASURER, BOARD, VIEWER, BORROWER_EMAIL])
			expect(dump).not.toContain(email);
		expect(dump).not.toContain("@");
		const hash = await emailHash(SECRET, ORG_ID, TREASURER);
		expect(dump).toContain(hash);
		// Salted by the secret and by the organization.
		expect(hash).not.toBe(await emailHash("another-secret", ORG_ID, TREASURER));
		expect(hash).not.toBe(await emailHash(SECRET, "other-org", TREASURER));
	});
});

describe("an organization lender: who may act", () => {
	test("a treasurer enters events stamped with their ref and email-link; a client can never set agent_ref", async () => {
		const h = orgHarness();
		const created = await h.createOrgNote();
		const refs = h.refsOf(created.agents);
		const { session } = await h.enterAgent(created.noteId, TREASURER);
		const recorded = expectOk(await h.service.append(session, PAYMENT));
		expect(recorded.event).toMatchObject({
			entered_by: "lender",
			via: "email-link",
			agent_ref: refs.treasurer,
		});
		expectFailure(
			await h.service.append(session, { ...PAYMENT, agent_ref: refs.board }),
			"forbidden_field",
		);
		expectFailure(
			await h.service.append(session, { ...PAYMENT, via: "account" }),
			"forbidden_field",
		);
		expect((await h.store.readLog(created.noteId)).events).toHaveLength(2);
	});

	test("a viewer reads and can never change anything", async () => {
		const h = orgHarness({ signers: signing.signers });
		const { noteId } = await h.createOrgNote();
		const { session } = await h.enterAgent(noteId, VIEWER);
		const view = await viewOf(h, session);
		expect(view.org?.agentRole).toBe("viewer");
		const before = (await h.store.readLog(noteId)).events.length;
		expectFailure(await h.service.append(session, PAYMENT), "wrong_role");
		expectFailure(await h.service.draftRelease(session), "wrong_role");
		expectFailure(
			await h.service.issuePayoff(session, "2026-11-22"),
			"wrong_role",
		);
		expectFailure(
			await h.service.sendNotice(session, { kind: "reminder" }),
			"wrong_role",
		);
		expectFailure(
			await h.service.requestApproval(session, {
				action: "waiver",
				target: view.events[0]?.id,
			}),
			"wrong_role",
		);
		expectFailure(await h.service.grantApproval(session, "id1"), "wrong_role");
		expectFailure(
			await h.service.requestStepUp(session, "release.confirmed"),
			"wrong_role",
		);
		expectFailure(await h.service.issueReceipt(session, "id1"), "wrong_role");
		expect((await h.store.readLog(noteId)).events).toHaveLength(before);
		// The viewer sent no code mail.
		expect(h.mailer.to(VIEWER)).toHaveLength(1);
	});

	test("a treasurer cannot approve; only a board member can", async () => {
		const h = orgHarness();
		const { noteId } = await h.createOrgNote();
		const treasurer = (await h.enterAgent(noteId, TREASURER)).session;
		const board = (await h.enterAgent(noteId, BOARD)).session;
		const annotation = expectOk(
			await h.service.append(treasurer, {
				type: "annotation.added",
				text: "Draft default notice text.",
			}),
		).event;
		const request = expectOk(
			await h.service.requestApproval(board, {
				action: "notice.default",
				target: annotation.id,
				cure_days: 30,
			}),
		).event;
		expectFailure(
			await h.service.grantApproval(treasurer, request.id),
			"wrong_role",
		);
	});
});

describe("two-person approval", () => {
	const draft = async (h: OrgHarness, session: ActiveSession) =>
		expectOk(await h.service.draftRelease(session)).event;

	test("release: refused before a request, refused before the approval, then accepted with the cooling-off and the code", async () => {
		const h = orgHarness({ signers: signing.signers });
		const created = await h.createOrgNote();
		const { noteId } = created;
		const refs = h.refsOf(created.agents);
		const treasurer = (await h.enterAgent(noteId, TREASURER)).session;
		const drafted = await draft(h, treasurer);

		// 1. No request yet. The sessions end while the clock runs past the cooling-off: sign in again through a fresh link.
		h.clock.advance(25 * HOUR);
		expect(await h.service.view(treasurer)).toMatchObject({ ok: true });
		await h.org.requestLink(ORG_ID, TREASURER);
		await h.org.requestLink(ORG_ID, BOARD);
		const treasurerNow = (await h.enterAgent(noteId, TREASURER)).session;
		const boardNow = (await h.enterAgent(noteId, BOARD)).session;
		const refusedBare = await h.service.confirmRelease(boardNow, drafted.id);
		expectFailure(refusedBare, "approval_required", "request");

		// 2. Requested, not approved.
		const request = expectOk(
			await h.service.requestApproval(treasurerNow, {
				action: "release.confirm",
				target: drafted.id,
			}),
		).event;
		expect(request).toMatchObject({
			type: "approval.requested",
			agent_ref: refs.treasurer,
			via: "email-link",
		});
		expectFailure(
			await h.service.confirmRelease(boardNow, drafted.id),
			"approval_required",
			"approval",
		);
		// The request alone does not let the requester through either.
		expectFailure(
			await h.service.confirmRelease(treasurerNow, drafted.id),
			"approval_required",
			"approval",
		);

		// 3. Approved by a board member who did not ask.
		const granted = expectOk(
			await h.service.grantApproval(boardNow, request.id),
		).event;
		expect(granted).toMatchObject({
			type: "approval.granted",
			request: request.id,
			agent_ref: refs.board,
		});
		const events = await eventsOf(h, noteId);
		expect(
			approvalStatus(events, { action: "release.confirm", target: drafted.id })
				.satisfied,
		).toBe(true);

		// 4. The code is still needed from the person who confirms.
		const noCode = await h.service.confirmRelease(boardNow, drafted.id);
		expectFailure(noCode, "step_up_required");
		const code = await h.codeFor(boardNow, "release.confirmed", BOARD);
		// The code went to the agent's own address, not to anyone else on the team.
		expect(h.mailer.to(TREASURER).at(-1)?.text).not.toContain(code);
		const confirmed = expectOk(
			await h.service.confirmRelease(boardNow, drafted.id, { code }),
		);
		expect(confirmed.event).toMatchObject({
			type: "release.confirmed",
			agent_ref: refs.board,
			via: "email-link",
		});
		expect(confirmed.document.type).toBe("note.release");
		const after = await eventsOf(h, noteId);
		const links = (await h.store.readLog(noteId)).links;
		expect((await verifyChain(after, links, noteId)).ok).toBe(true);
		expect(statement(after, "2026-12-30").state.closed).toBe(true);
	});

	test("the cooling-off still applies after the approval", async () => {
		const h = orgHarness({ signers: signing.signers });
		const { noteId } = await h.createOrgNote();
		const treasurer = (await h.enterAgent(noteId, TREASURER)).session;
		const board = (await h.enterAgent(noteId, BOARD)).session;
		const drafted = await draft(h, treasurer);
		const request = expectOk(
			await h.service.requestApproval(treasurer, {
				action: "release.confirm",
				target: drafted.id,
			}),
		).event;
		expectOk(await h.service.grantApproval(board, request.id));
		const refused = await h.service.confirmRelease(board, drafted.id);
		expectFailure(refused, "cooling_off");
		expect(refused.ok === false && refused.until).toBeTruthy();
	});

	test("the requester cannot approve their own request, and one agent approves a request once", async () => {
		const h = orgHarness();
		const { noteId } = await h.createOrgNote({
			agents: [
				{ email: TREASURER, role: "treasurer" },
				{ email: BOARD, role: "board" },
				{ email: BOARD_TWO, role: "board" },
			],
		});
		const board = (await h.enterAgent(noteId, BOARD)).session;
		const boardTwo = (await h.enterAgent(noteId, BOARD_TWO)).session;
		const drafted = await draft(h, board);
		const request = expectOk(
			await h.service.requestApproval(board, {
				action: "release.confirm",
				target: drafted.id,
			}),
		).event;
		const own = await h.service.grantApproval(board, request.id);
		expectFailure(own, "rejected");
		expect(own.ok === false && own.message).toContain("own request");
		expect(
			approvalStatus(await eventsOf(h, noteId), {
				action: "release.confirm",
				target: drafted.id,
			}).granted_by,
		).toEqual([]);
		expectOk(await h.service.grantApproval(boardTwo, request.id));
		const twice = await h.service.grantApproval(boardTwo, request.id);
		expectFailure(twice, "rejected");
		expect(twice.ok === false && twice.message).toContain("already approved");
		expectFailure(
			await h.service.grantApproval(boardTwo, "no-such-request"),
			"bad_request",
		);
	});

	test("requests are checked: a draft that exists, asked once, and a target that is an earlier entry", async () => {
		const h = orgHarness();
		const { noteId } = await h.createOrgNote();
		const treasurer = (await h.enterAgent(noteId, TREASURER)).session;
		const first = (await eventsOf(h, noteId))[0]?.id as string;
		expectFailure(
			await h.service.requestApproval(treasurer, {
				action: "release.confirm",
				target: first,
			}),
			"bad_request",
		);
		expectFailure(
			await h.service.requestApproval(treasurer, {
				action: "unlock",
				target: first,
			}),
			"bad_request",
		);
		expectFailure(
			await h.service.requestApproval(treasurer, {
				action: "waiver",
				target: "nothing",
			}),
			"bad_request",
		);
		const drafted = await draft(h, treasurer);
		expectOk(
			await h.service.requestApproval(treasurer, {
				action: "release.confirm",
				target: drafted.id,
			}),
		);
		expectFailure(
			await h.service.requestApproval(treasurer, {
				action: "release.confirm",
				target: drafted.id,
			}),
			"rejected",
		);
		expectOk(
			await h.service.requestApproval(treasurer, {
				action: "waiver",
				target: first,
			}),
		);
		expectFailure(
			await h.service.requestApproval(treasurer, {
				action: "waiver",
				target: first,
			}),
			"rejected",
		);
	});

	test("each approval allows exactly one default notice; a reminder needs none", async () => {
		const h = orgHarness();
		const created = await h.createOrgNote();
		const { noteId } = created;
		const refs = h.refsOf(created.agents);
		const treasurer = (await h.enterAgent(noteId, TREASURER)).session;
		const board = (await h.enterAgent(noteId, BOARD)).session;
		const annotation = expectOk(
			await h.service.append(treasurer, {
				type: "annotation.added",
				text: "Draft text of the default notice.",
			}),
		).event;
		const defaultNotice = { kind: "default", cure_days: 30 };

		expectOk(await h.service.sendNotice(treasurer, { kind: "reminder" }));
		expectFailure(
			await h.service.sendNotice(treasurer, defaultNotice),
			"approval_required",
			"request",
		);
		const ask = async () =>
			expectOk(
				await h.service.requestApproval(treasurer, {
					action: "notice.default",
					target: annotation.id,
					cure_days: 30,
				}),
			).event;
		const approve = async (requestId: string) =>
			expectOk(await h.service.grantApproval(board, requestId));
		const send = async () => {
			const code = await h.codeFor(treasurer, "notice.sent", TREASURER);
			return h.service.sendNotice(treasurer, defaultNotice, { code });
		};

		const first = await ask();
		expectFailure(
			await h.service.sendNotice(treasurer, defaultNotice),
			"approval_required",
			"approval",
		);
		await approve(first.id);
		// Approved and still needs the code.
		expectFailure(
			await h.service.sendNotice(treasurer, defaultNotice),
			"step_up_required",
		);
		const sent = expectOk(await send());
		// The notice names the request it uses, with the same days to cure.
		expect(sent.event).toMatchObject({
			type: "notice.sent",
			kind: "default",
			cure_days: 30,
			approval: first.id,
			agent_ref: refs.treasurer,
		});
		expect(sent.mailed).toBe(true);
		// The approval is used up: the next default notice needs its own request.
		expectFailure(
			await h.service.sendNotice(treasurer, defaultNotice),
			"approval_required",
			"request",
		);
		const second = await ask();
		await approve(second.id);
		expectOk(await send());
		expectFailure(
			await h.service.sendNotice(treasurer, defaultNotice),
			"approval_required",
			"request",
		);
		const events = await eventsOf(h, noteId);
		expect(
			events.filter(
				(event) => event.type === "notice.sent" && event.kind === "default",
			),
		).toHaveLength(2);
	});

	test("a waiver is requested, approved and annotated, and nothing in the record changes a balance", async () => {
		const h = orgHarness();
		const { noteId } = await h.createOrgNote();
		const treasurer = (await h.enterAgent(noteId, TREASURER)).session;
		const board = (await h.enterAgent(noteId, BOARD)).session;
		const annotation = expectOk(
			await h.service.append(treasurer, {
				type: "annotation.added",
				text: "Waive the late month.",
			}),
		).event;
		const before = statement(await eventsOf(h, noteId), "2026-12-20");
		const request = expectOk(
			await h.service.requestApproval(treasurer, {
				action: "waiver",
				target: annotation.id,
			}),
		).event;
		const granted = expectOk(await h.service.grantApproval(board, request.id));
		expect(granted.annotation).toMatchObject({
			type: "annotation.added",
			target: request.id,
		});
		expect(
			granted.annotation?.type === "annotation.added" &&
				granted.annotation.text,
		).toContain("changes no balance");
		const events = await eventsOf(h, noteId);
		const after = statement(events, "2026-12-20");
		expect(after.lender).toEqual(before.lender);
		expect(after.borrower).toEqual(before.borrower);
		expect(
			approvalStatus(events, { action: "waiver", target: annotation.id })
				.satisfied,
		).toBe(true);
	});

	test("the queue rule here matches the library's: pending means no distinct approver", async () => {
		const h = orgHarness();
		const { noteId } = await h.createOrgNote();
		const treasurer = (await h.enterAgent(noteId, TREASURER)).session;
		const board = (await h.enterAgent(noteId, BOARD)).session;
		const first = (await eventsOf(h, noteId))[0]?.id as string;
		const one = expectOk(
			await h.service.requestApproval(treasurer, {
				action: "waiver",
				target: first,
			}),
		).event;
		const drafted = await draft(h, treasurer);
		expectOk(
			await h.service.requestApproval(treasurer, {
				action: "release.confirm",
				target: drafted.id,
			}),
		);
		expectOk(await h.service.grantApproval(board, one.id));
		const events = await eventsOf(h, noteId);
		const pending = pendingApprovals(events, ORG_POLICY);
		expect(pending.map((item) => item.action)).toEqual(["release.confirm"]);
		const satisfied = satisfiedRequestIds(events);
		const requests = events.filter(
			(event) => event.type === "approval.requested",
		);
		expect(
			requests
				.filter((event) => !satisfied.has(event.id))
				.map((event) =>
					event.type === "approval.requested" ? event.action : "",
				),
		).toEqual(pending.map((item) => item.action));
	});

	test("a person lender keeps the empty policy: no request, no approval, confirm and notice go straight through", async () => {
		const h = harness({ signers: signing.signers });
		const noteId = await h.create();
		const lender = (await h.enter(noteId, "lender")).session;
		expectOk(await h.service.draftRelease(lender));
		expectOk(await h.service.sendNotice(lender, { kind: "reminder" }));
		expect((await h.store.getOrg(noteId)) === null).toBe(true);
		expect(await h.store.listAgents(noteId)).toEqual([]);
		const view = expectOk(await h.service.view(lender)).view;
		expect(view.org).toBeNull();
		expect(view.lenderIsOrg).toBe(false);
		expect(view.basePath).toBe(`/n/${noteId}`);
		// A guest can neither ask for nor give an approval.
		expectFailure(
			await h.service.requestApproval(lender, {
				action: "waiver",
				target: "x",
			}),
			"wrong_role",
		);
		expectFailure(await h.service.grantApproval(lender, "x"), "wrong_role");
	});
});

describe("agents come and go", () => {
	test("deactivating an agent ends their sessions and links at once, and history keeps their ref", async () => {
		const h = orgHarness();
		const created = await h.createOrgNote();
		const { noteId } = created;
		const refs = h.refsOf(created.agents);
		const { orgSession, session } = await h.enterAgent(noteId, TREASURER);
		const payment = expectOk(await h.service.append(session, PAYMENT)).event;
		// A pending link: a new one was asked for and not yet used.
		await h.org.requestLink(ORG_ID, TREASURER);
		const pendingToken = h.mailer.linkTokenFor(TREASURER);

		const done = expectOk(
			await h.org.deactivateAgent(noteId, {
				agentRef: refs.treasurer as string,
			}),
		);
		expect(done.agentRef).toBe(refs.treasurer);
		expect(
			await h.orgs.touchSession(ORG_ID, orgSession.hash, h.clock.now(), HOUR),
		).toBeNull();
		expect(await h.org.sessions.redeem(ORG_ID, pendingToken)).toBeNull();
		// A stale session object is refused at the service too.
		expectFailure(await h.service.append(session, PAYMENT), "wrong_role");
		expect(
			(await h.store.getAgent(noteId, refs.treasurer as string))?.active,
		).toBe(false);
		// History still names the agent by ref.
		const events = await eventsOf(h, noteId);
		expect(events.find((event) => event.id === payment.id)?.agent_ref).toBe(
			refs.treasurer,
		);
		// A deactivated address gets no new link.
		const sent = h.mailer.sent.length;
		await h.org.requestLink(ORG_ID, TREASURER);
		expect(h.mailer.sent).toHaveLength(sent);
		// The others carry on.
		const board = (await h.enterAgent(noteId, BOARD)).session;
		expectOk(await h.service.append(board, { ...PAYMENT, amount_minor: "5" }));
	});

	test("deactivating by address works, an unknown agent is not found, and the agent is off on every note of the organization", async () => {
		const h = orgHarness();
		const one = await h.createOrgNote({ idem: "n1" });
		const two = await h.createOrgNote({ idem: "n2" });
		const refs = h.refsOf(one.agents);
		const refsTwo = h.refsOf(two.agents);
		expectOk(
			await h.org.deactivateAgent(one.noteId, { email: BOARD.toUpperCase() }),
		);
		expect(
			(await h.store.getAgent(two.noteId, refsTwo.board as string))?.active,
		).toBe(false);
		expect(
			await h.org.roleOnNote(ORG_ID, one.noteId, refs.board as string),
		).toBeNull();
		expect(
			await h.org.roleOnNote(ORG_ID, two.noteId, refsTwo.board as string),
		).toBeNull();
		expectFailure(
			await h.org.deactivateAgent(one.noteId, { agentRef: "ag_nobody" }),
			"not_found",
		);
		expectFailure(
			await h.org.deactivateAgent("nt_unknown", { agentRef: "x" }),
			"not_found",
		);
	});

	test("adding an agent brings them in with their own link; an agent can be brought back", async () => {
		const h = orgHarness();
		const created = await h.createOrgNote();
		const { noteId } = created;
		const refs = h.refsOf(created.agents);
		const sent = h.mailer.sent.length;
		const added = expectOk(
			await h.org.addAgent(noteId, { email: BOARD_TWO, role: "board" }),
		);
		expect(added.agentRef).toMatch(/^ar_/);
		expect(h.mailer.sent).toHaveLength(sent + 1);
		expect(h.mailer.to(BOARD_TWO)).toHaveLength(1);
		expect(h.mailer.to(BOARD_TWO)[0]?.text).not.toContain(BORROWER_EMAIL);
		const board = (await h.enterAgent(noteId, BOARD_TWO)).session;
		expect(board.agent?.role).toBe("board");
		// Brought back with a new role after being deactivated.
		expectOk(
			await h.org.deactivateAgent(noteId, { agentRef: refs.viewer as string }),
		);
		const back = expectOk(
			await h.org.addAgent(noteId, { email: VIEWER, role: "treasurer" }),
		);
		expect(back.agentRef).toBe(refs.viewer);
		const again = (await h.enterAgent(noteId, VIEWER)).session;
		expect(again.agent?.role).toBe("treasurer");
		// The borrower cannot join the team; bad input and unknown notes are refused.
		expectFailure(
			await h.org.addAgent(noteId, { email: BORROWER_EMAIL, role: "viewer" }),
			"same_party",
		);
		expectFailure(
			await h.org.addAgent(noteId, { email: "nobody", role: "viewer" }),
			"bad_request",
		);
		expectFailure(
			await h.org.addAgent(noteId, { email: "x@coop.test", role: "owner" }),
			"bad_request",
		);
		expectFailure(
			await h.org.addAgent("nt_unknown", {
				email: "x@coop.test",
				role: "viewer",
			}),
			"not_found",
		);
		// A person-lender note is not an organization note.
		const person = harness();
		const personNote = await person.create();
		expectFailure(
			await h.org.addAgent(personNote, {
				email: "x@coop.test",
				role: "viewer",
			}),
			"not_found",
		);
	});

	test("a role change shows at once on every note", async () => {
		const h = orgHarness();
		const created = await h.createOrgNote();
		const { noteId } = created;
		const { session } = await h.enterAgent(noteId, TREASURER);
		expectOk(await h.service.append(session, PAYMENT));
		expectOk(
			await h.org.addAgent(noteId, { email: TREASURER, role: "viewer" }),
		);
		expectFailure(await h.service.append(session, PAYMENT), "wrong_role");
	});
});

describe("link requests", () => {
	test("an agent asks for a link by address; the answer is the same for any address, and limits count per organization and per address", async () => {
		const h = orgHarness();
		await h.createOrgNote();
		const base = h.mailer.sent.length;
		await h.org.requestLink(ORG_ID, "stranger@elsewhere.test");
		await h.org.requestLink(ORG_ID, BORROWER_EMAIL);
		await h.org.requestLink(ORG_ID, "not an address");
		expect(h.mailer.sent).toHaveLength(base);
		await h.org.requestLink(ORG_ID, ` ${TREASURER.toUpperCase()} `);
		expect(h.mailer.sent).toHaveLength(base + 1);
		expect(h.mailer.to(TREASURER).at(-1)?.text).toContain(
			`/o/${ORG_ID}/enter?t=`,
		);
		// Per address: three an hour.
		await h.org.requestLink(ORG_ID, TREASURER);
		await h.org.requestLink(ORG_ID, TREASURER);
		await h.org.requestLink(ORG_ID, TREASURER);
		expect(h.mailer.to(TREASURER)).toHaveLength(1 + 3);
		h.clock.advance(HOUR);
		await h.org.requestLink(ORG_ID, TREASURER);
		expect(h.mailer.to(TREASURER)).toHaveLength(1 + 3 + 1);
	});

	test("junk addresses do not use up an agent's allowance, but one client address is limited", async () => {
		const h = orgHarness();
		await h.createOrgNote();
		for (let index = 0; index < 50; index += 1)
			await h.org.requestLink(ORG_ID, `nobody${index}@elsewhere.test`);
		const sent = h.mailer.sent.length;
		await h.org.requestLink(ORG_ID, BOARD);
		expect(h.mailer.sent).toHaveLength(sent + 1);
		// A client that has asked twenty times in the hour is held, whichever address it types.
		for (let index = 0; index < 20; index += 1)
			await h.org.requestLink(
				ORG_ID,
				`junk${index}@elsewhere.test`,
				"198.51.100.7",
			);
		await h.org.requestLink(ORG_ID, TREASURER, "198.51.100.7");
		expect(h.mailer.to(TREASURER)).toHaveLength(1);
		await h.org.requestLink(ORG_ID, TREASURER, "198.51.100.8");
		expect(h.mailer.to(TREASURER)).toHaveLength(2);
	});

	test("a new link request revokes the agent's older links that nobody opened; nothing is counted for an unknown organization", async () => {
		const h = orgHarness();
		await h.createOrgNote();
		const first = h.mailer.linkTokenFor(TREASURER);
		await h.org.requestLink(ORG_ID, TREASURER);
		const second = h.mailer.linkTokenFor(TREASURER);
		expect(await h.org.sessions.redeem(ORG_ID, first)).toBeNull();
		expect(await h.org.sessions.redeem(ORG_ID, second)).not.toBeNull();
		await h.org.requestLink("no-such-org", TREASURER);
		expect((h.orgs as MemoryOrgStore).countersForTest("no-such-org")).toEqual(
			[],
		);
	});

	test("a link request on a note page never reaches an organization's lender side", async () => {
		const h = orgHarness();
		const { noteId } = await h.createOrgNote();
		const sent = h.mailer.sent.length;
		await h.service.requestLink(noteId, "");
		await h.service.requestLink(noteId, TREASURER);
		expect(h.mailer.sent).toHaveLength(sent);
		await h.service.requestLink(noteId, BORROWER_EMAIL);
		expect(h.mailer.sent).toHaveLength(sent + 1);
	});
});

describe("separate organizations", () => {
	test("a session of one organization opens nothing of another", async () => {
		const h = orgHarness();
		const a = await h.createOrgNote({ orgId: "org-a", idem: "a" });
		const b = await h.createOrgNote({
			orgId: "org-b",
			idem: "b",
			agents: [
				{ email: "bob@other.test", role: "board" },
				{ email: "tim@other.test", role: "treasurer" },
			],
		});
		const asA = await h.enterAgent(a.noteId, TREASURER, "org-a");
		// A's cookie is not a session of B.
		expect(
			await h.orgs.touchSession(
				"org-b",
				asA.orgSession.hash,
				h.clock.now(),
				HOUR,
			),
		).toBeNull();
		// A's agent has no standing on B's note, even through a hand-built session.
		expect(await h.org.noteSession(asA.orgSession, b.noteId)).toBeNull();
		const forged: ActiveSession = {
			...asA.session,
			noteId: b.noteId,
		};
		expectFailure(await h.service.view(forged), "not_found");
		expectFailure(await h.service.append(forged, PAYMENT), "wrong_role");
		expectFailure(
			await h.service.requestApproval(forged, {
				action: "waiver",
				target: "x",
			}),
			"wrong_role",
		);
		const asB = await h.enterAgent(b.noteId, "bob@other.test", "org-b");
		// A's agent means nothing in B: neither its id nor its ref on A's note.
		expect(
			await h.org.roleOnNote("org-b", b.noteId, asA.orgSession.agentId),
		).toBeNull();
		expect(
			await h.org.roleOnNote(
				"org-b",
				b.noteId,
				asA.session.agent?.agentRef as string,
			),
		).toBeNull();
		// Portfolios hold only their own notes.
		const folioA = expectOk(await h.org.portfolio("org-a", "2026-11-22"));
		const folioB = expectOk(await h.org.portfolio("org-b", "2026-11-22"));
		expect(folioA.portfolio.rows.map((row) => row.note_id)).toEqual([a.noteId]);
		expect(folioB.portfolio.rows.map((row) => row.note_id)).toEqual([b.noteId]);
		expect(asB.orgSession.orgId).toBe("org-b");
		// An organization with nothing registered does not exist.
		expect(await h.org.exists("org-c")).toBe(false);
		expect(await h.org.exists("org-a")).toBe(true);
	});
});

describe("the portfolio", () => {
	const firstInstallment = async (
		h: OrgHarness,
		session: ActiveSession,
	): Promise<string> =>
		(await viewOf(h, session)).statement.schedule[0]?.payment_minor as string;

	test("three notes in two currencies: aging, totals per currency, awaiting confirmation, and notes that cannot be read", async () => {
		const h = orgHarness();
		const a = await h.createOrgNote({ idem: "a" });
		const b = await h.createOrgNote({ idem: "b" });
		const c = await h.createOrgNote({ idem: "c", terms: EUR_TERMS });
		// One sign-in covers every note of the organization; the agent's role is the same on each.
		const signedIn = await h.enterAgent(b.noteId, TREASURER);
		const treasurerB = signedIn.session;

		// B: the lender records the first installment, so it counts in both views.
		const installment = await firstInstallment(h, treasurerB);
		expectOk(
			await h.service.append(treasurerB, {
				...PAYMENT,
				amount_minor: installment,
				value_date: "2026-11-30",
			}),
		);
		// C: the borrower says they paid; the lender has not confirmed.
		const toBorrowerC = h.mailer
			.to(BORROWER_EMAIL)
			.map((mail) => /\/n\/([^/]+)\/enter\?t=([A-Za-z0-9_-]+)/.exec(mail.text))
			.find((found) => found?.[1] === c.noteId);
		const opened = await h.service.sessions.redeem(
			c.noteId,
			toBorrowerC?.[2] as string,
		);
		const borrowerSession = await h.service.sessions.resolve(
			c.noteId,
			opened?.cookieValue ?? null,
		);
		expect(borrowerSession).not.toBeNull();
		expectOk(
			await h.service.append(borrowerSession as ActiveSession, {
				...PAYMENT,
				amount_minor: installment,
				value_date: "2026-11-30",
			}),
		);
		// A request waiting for a board member, on note A.
		const treasurerA = (await h.org.noteSession(
			signedIn.orgSession,
			a.noteId,
		)) as ActiveSession;
		const drafted = expectOk(await h.service.draftRelease(treasurerA)).event;
		const request = expectOk(
			await h.service.requestApproval(treasurerA, {
				action: "release.confirm",
				target: drafted.id,
			}),
		).event;

		// D and E cannot be read: one is edited after it was chained, one is not an event at all.
		const d = await h.createOrgNote({ idem: "d" });
		const e = await h.createOrgNote({ idem: "e" });
		const stored = (await h.store.readLog(d.noteId)).events[0] as string;
		h.store.tamperEventForTest(
			d.noteId,
			1,
			stored.replace('"principal_minor":"1000000"', '"principal_minor":"9"'),
		);
		h.store.tamperEventForTest(e.noteId, 1, '{"bad":true}');

		const result = expectOk(await h.org.portfolio(ORG_ID, "2026-12-20"));
		const { portfolio } = result;
		expect(portfolio.as_of).toBe("2026-12-20");
		const byId = new Map(portfolio.rows.map((row) => [row.note_id, row]));
		expect([...byId.keys()].sort()).toEqual(
			[a.noteId, b.noteId, c.noteId].sort(),
		);
		// A: nothing paid, the first installment fell due on 2026-12-01.
		expect(byId.get(a.noteId)).toMatchObject({
			aging: "1-30",
			days_overdue: 19,
			currency: "USD",
			role: "lender",
			closed: false,
			terms: "proposed",
		});
		// B: the installment is paid and counts for the lender.
		expect(byId.get(b.noteId)).toMatchObject({
			aging: "current",
			days_overdue: 0,
			overdue_minor: "0",
			awaiting_confirmation: 0,
		});
		// C: claimed by the borrower, so the lender's view still shows it overdue and waiting.
		expect(byId.get(c.noteId)).toMatchObject({
			currency: "EUR",
			awaiting_confirmation: 1,
			aging: "1-30",
		});
		const usd = portfolio.totals.find((total) => total.currency === "USD");
		const eur = portfolio.totals.find((total) => total.currency === "EUR");
		expect(portfolio.totals.map((total) => total.currency)).toEqual([
			"EUR",
			"USD",
		]);
		expect(usd).toMatchObject({
			notes: 2,
			terms_pending: 2,
			awaiting_confirmation: 0,
			disputed: 0,
			buckets: { current: 1, "1-30": 1, "31-60": 0, "61+": 0 },
		});
		expect(eur).toMatchObject({
			notes: 1,
			awaiting_confirmation: 1,
			buckets: { current: 0, "1-30": 1, "31-60": 0, "61+": 0 },
		});
		// No amount crosses a currency: USD owed is the two USD notes' payoffs only.
		const usdOwed = portfolio.rows
			.filter((row) => row.currency === "USD")
			.reduce((sum, row) => sum + BigInt(row.payoff_minor), 0n);
		expect(usd?.outstanding_payoff_minor).toBe(usdOwed.toString());
		// The unreadable notes are listed and do not stop the rest.
		expect(portfolio.invalid.map((entry) => entry.note_id).sort()).toEqual(
			[d.noteId, e.noteId].sort(),
		);
		// The approvals queue: one request, waiting, with the id a board member would approve.
		expect(result.queue).toHaveLength(1);
		expect(result.queue[0]).toMatchObject({
			noteId: a.noteId,
			requestId: request.id,
			action: "release.confirm",
		});
		// Bad dates and the page's default date.
		expectFailure(await h.org.portfolio(ORG_ID, "2026-13-40"), "bad_request");
		expect(expectOk(await h.org.portfolio(ORG_ID)).asOf).toBe("2026-11-22");
	});

	test("a note issued after the date is listed as unreadable, not as a failure of the page", async () => {
		const h = orgHarness();
		await h.createOrgNote({ idem: "early" });
		const result = expectOk(await h.org.portfolio(ORG_ID, "2026-10-01"));
		expect(result.portfolio.rows).toEqual([]);
		expect(result.portfolio.invalid).toHaveLength(1);
	});
});
