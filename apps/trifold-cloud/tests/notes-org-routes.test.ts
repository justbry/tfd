import { Database } from "bun:sqlite";
import { beforeAll, describe, expect, test } from "bun:test";
import {
	BOARD_CSV_HEADER,
	buildChain,
	NOTE_EVENT_SCHEMA,
	sha256Hex,
	validateStream,
} from "tfd-notes";
import { D1OrgStore } from "../src/notes/org-d1-store";
import { type NotesDeps, notesRoute } from "../src/notes/routes";
import { applyD1Migrations, sqliteD1 } from "./fakes";
import {
	API,
	API_KEY,
	BORROWER_EMAIL,
	HOUR,
	LEDGER,
	notesEnv,
	TERMS,
} from "./notes-fakes";
import {
	BOARD,
	BOARD_TWO,
	EUR_TERMS,
	ORG_ID,
	orgHarness,
	THREE_AGENTS,
	TREASURER,
	VIEWER,
} from "./notes-org-fakes";
import { type TestSigning, testSigning } from "./notes-signers";

const ORG_COOKIE = "__Secure-tf_org";
const NOTE_COOKIE = "__Secure-tf_note";
const CSRF_FIELD = /name="csrf" value="([^"]+)"/;
const CLAIM_WORDS =
	/\b(proof|enforceable|binding|tamper-proof|legally|credit)\b/i;

let signing: TestSigning;
beforeAll(async () => {
	signing = await testSigning();
});

const setup = (options: NotesDeps["options"] = { releaseCoolingMs: 0 }) => {
	const db = new Database(":memory:");
	applyD1Migrations(db);
	const orgs = new D1OrgStore(sqliteD1(db));
	const h = orgHarness({ orgs });
	const env = notesEnv();
	const deps: NotesDeps = {
		store: h.store,
		mailer: h.mailer,
		clock: h.clock,
		ids: h.ids,
		orgs,
		signers: signing.signers,
		...(options ? { options } : {}),
	};
	const call = async (url: string, init?: RequestInit): Promise<Response> => {
		const response = await notesRoute(new Request(url, init), env, deps);
		if (response === null) throw new Error(`not handled: ${url}`);
		return response;
	};
	const ledger = (path: string, init?: RequestInit) =>
		call(`https://${LEDGER}${path}`, init);
	const api = (path: string, init?: RequestInit) =>
		call(`https://${API}${path}`, init);
	const bearer = { Authorization: `Bearer ${API_KEY}` };
	const createNote = async (
		input: {
			idem?: string;
			orgId?: string;
			agents?: { email: string; role: string }[];
			terms?: unknown;
		} = {},
	) => {
		const response = await api("/v1/notes", {
			method: "POST",
			headers: bearer,
			body: JSON.stringify({
				terms: input.terms ?? TERMS,
				lender_org: {
					org_id: input.orgId ?? ORG_ID,
					agents: input.agents ?? THREE_AGENTS,
				},
				borrower_email: BORROWER_EMAIL,
				idem: input.idem ?? "route-1",
			}),
		});
		expect(response.status).toBe(201);
		return (await response.json()) as {
			note_id: string;
			agents: { agent_ref: string; role: string; active: boolean }[];
		};
	};
	const get = (path: string, cookie?: string) =>
		ledger(path, {
			headers: cookie ? { Cookie: `${ORG_COOKIE}=${cookie}` } : {},
		});
	const post = (
		path: string,
		fields: Record<string, string>,
		cookie?: string,
		headers: Record<string, string> = {},
	) =>
		ledger(path, {
			method: "POST",
			body: new URLSearchParams(fields),
			headers: {
				...(cookie ? { Cookie: `${ORG_COOKIE}=${cookie}` } : {}),
				...headers,
			},
		});
	/** Opens the newest link emailed to `email` as a browser does: GET the page, press the button. */
	const enter = async (email: string, orgId = ORG_ID, noteId?: string) => {
		const token = h.mailer.linkTokenFor(email);
		const suffix = noteId === undefined ? "" : `&n=${noteId}`;
		expect((await get(`/o/${orgId}/enter?t=${token}${suffix}`)).status).toBe(
			200,
		);
		const response = await post(`/o/${orgId}/enter`, {
			t: token,
			...(noteId === undefined ? {} : { n: noteId }),
		});
		expect(response.status).toBe(303);
		const cookie = new RegExp(`${ORG_COOKIE}=([^;]+)`).exec(
			response.headers.get("Set-Cookie") ?? "",
		)?.[1];
		if (!cookie) throw new Error("no cookie");
		return { cookie, token, response };
	};
	const csrfOf = async (path: string, cookie: string): Promise<string> => {
		const text = await (await get(path, cookie)).text();
		const token = CSRF_FIELD.exec(text)?.[1];
		if (!token) throw new Error(`no csrf token on ${path}`);
		return token;
	};
	/** Posts a form the way the page does: with the csrf token of that session. */
	const act = async (
		path: string,
		fields: Record<string, string>,
		cookie: string,
		pagePath: string,
	) => post(path, { csrf: await csrfOf(pagePath, cookie), ...fields }, cookie);
	return {
		h,
		db,
		env,
		deps,
		call,
		ledger,
		api,
		bearer,
		createNote,
		get,
		post,
		enter,
		csrfOf,
		act,
	};
};

type World = ReturnType<typeof setup>;

const notePath = (noteId: string, orgId = ORG_ID): string =>
	`/o/${orgId}/n/${noteId}`;

/** Three signed-in agents on one note. */
const signedIn = async (t: World) => {
	const created = await t.createNote();
	const noteId = created.note_id;
	const treasurer = (await t.enter(TREASURER)).cookie;
	const board = (await t.enter(BOARD)).cookie;
	const viewer = (await t.enter(VIEWER)).cookie;
	const refs = Object.fromEntries(
		created.agents.map((agent) => [agent.role, agent.agent_ref]),
	) as Record<string, string>;
	return { created, noteId, treasurer, board, viewer, refs };
};

describe("creating an organization note over the API", () => {
	test("needs the bearer key, takes lender_org or lender_email and not both, and returns agent refs but no address", async () => {
		const t = setup();
		const body = {
			terms: TERMS,
			lender_org: { org_id: ORG_ID, agents: THREE_AGENTS },
			borrower_email: BORROWER_EMAIL,
			idem: "k1",
		};
		const refused = await t.api("/v1/notes", {
			method: "POST",
			body: JSON.stringify(body),
		});
		expect(refused.status).toBe(401);
		const both = await t.api("/v1/notes", {
			method: "POST",
			headers: t.bearer,
			body: JSON.stringify({ ...body, lender_email: "maria@example.com" }),
		});
		expect(both.status).toBe(400);
		const neither = await t.api("/v1/notes", {
			method: "POST",
			headers: t.bearer,
			body: JSON.stringify({ ...body, lender_org: undefined }),
		});
		expect(neither.status).toBe(400);
		expect(t.h.mailer.sent).toHaveLength(0);
		const created = await t.api("/v1/notes", {
			method: "POST",
			headers: t.bearer,
			body: JSON.stringify(body),
		});
		expect(created.status).toBe(201);
		const text = await created.text();
		expect(text).not.toContain("@");
		const parsed = JSON.parse(text) as {
			note_id: string;
			agents: { agent_ref: string; role: string }[];
		};
		expect(parsed.agents.map((agent) => agent.role).sort()).toEqual([
			"board",
			"treasurer",
			"viewer",
		]);
		// The same request again is the same note.
		const again = await t.api("/v1/notes", {
			method: "POST",
			headers: t.bearer,
			body: JSON.stringify(body),
		});
		expect(again.status).toBe(200);
		expect(((await again.json()) as { note_id: string }).note_id).toBe(
			parsed.note_id,
		);
		const badOrg = await t.api("/v1/notes", {
			method: "POST",
			headers: t.bearer,
			body: JSON.stringify({
				...body,
				idem: "k2",
				lender_org: { org_id: "bad id", agents: THREE_AGENTS },
			}),
		});
		expect(badOrg.status).toBe(400);
	});
});

describe("signing in as an agent", () => {
	test("a GET never redeems; the POST does, once, and sets a cookie for this organization only", async () => {
		const t = setup();
		const created = await t.createNote();
		const token = t.h.mailer.linkTokenFor(TREASURER);
		for (let index = 0; index < 3; index += 1) {
			const shown = await t.get(`/o/${ORG_ID}/enter?t=${token}`);
			expect(shown.status).toBe(200);
			expect(shown.headers.get("Set-Cookie")).toBeNull();
			expect(await shown.text()).toContain('method="post"');
		}
		const opened = await t.post(`/o/${ORG_ID}/enter`, {
			t: token,
			n: created.note_id,
		});
		expect(opened.status).toBe(303);
		const location = opened.headers.get("Location") ?? "";
		expect(location).toBe(`${notePath(created.note_id)}?m=entered`);
		expect(location).not.toContain(token);
		const setCookie = opened.headers.get("Set-Cookie") ?? "";
		expect(setCookie).toContain(`${ORG_COOKIE}=`);
		for (const part of [
			"HttpOnly",
			"Secure",
			"SameSite=Lax",
			`Path=/o/${ORG_ID}`,
			"Max-Age=",
		])
			expect(setCookie).toContain(part);
		expect(opened.headers.get("Cache-Control")).toBe("no-store");
		expect(opened.headers.get("Referrer-Policy")).toBe("no-referrer");
		// The link is spent.
		const reused = await t.post(`/o/${ORG_ID}/enter`, { t: token });
		expect(reused.status).toBe(400);
		expect(reused.headers.get("Set-Cookie")).toBeNull();
		// No token, a made-up token, or a link of another organization.
		expect((await t.post(`/o/${ORG_ID}/enter`, {})).status).toBe(400);
		expect((await t.post(`/o/${ORG_ID}/enter`, { t: "nope" })).status).toBe(
			400,
		);
		// A bad `n` is ignored, never followed.
		await t.post(`/o/${ORG_ID}/link`, { email: BOARD });
		const second = await t.post(`/o/${ORG_ID}/enter`, {
			t: t.h.mailer.linkTokenFor(BOARD),
			n: "../../evil",
		});
		expect(second.headers.get("Location")).toBe(`/o/${ORG_ID}`);
	});

	test("a cross-site form post is refused, and a link page escapes what the URL carries", async () => {
		const t = setup();
		await t.createNote();
		const token = t.h.mailer.linkTokenFor(TREASURER);
		const foreign = await t.post(
			`/o/${ORG_ID}/enter`,
			{ t: token },
			undefined,
			{ Origin: "https://evil.example" },
		);
		expect(foreign.status).toBe(403);
		const link = await t.post(
			`/o/${ORG_ID}/link`,
			{ email: TREASURER },
			undefined,
			{ Origin: "https://evil.example" },
		);
		expect(link.status).toBe(403);
		const page = await (
			await t.get(
				`/o/${ORG_ID}/enter?t=${encodeURIComponent('"><script>x</script>')}`,
			)
		).text();
		expect(page).not.toContain("<script>");
		expect(page).toContain("&quot;&gt;&lt;script&gt;");
		// The link was not spent by any of this.
		expect((await t.enter(TREASURER)).cookie).toBeTruthy();
	});

	test("asking for a link: the same page for any address, mail only to a team member, limited per address and per organization", async () => {
		const t = setup();
		await t.createNote();
		const sent = t.h.mailer.sent.length;
		const known = await t.post(`/o/${ORG_ID}/link`, { email: TREASURER });
		const unknown = await t.post(`/o/${ORG_ID}/link`, {
			email: "stranger@elsewhere.test",
		});
		const garbage = await t.post(`/o/${ORG_ID}/link`, {});
		expect(known.status).toBe(200);
		const sameAnswer = await unknown.text();
		expect(await known.text()).toBe(sameAnswer);
		expect(unknown.status).toBe(garbage.status);
		expect(t.h.mailer.sent).toHaveLength(sent + 1);
		await t.post(`/o/${ORG_ID}/link`, { email: TREASURER });
		await t.post(`/o/${ORG_ID}/link`, { email: TREASURER });
		const blocked = await t.post(`/o/${ORG_ID}/link`, { email: TREASURER });
		expect(blocked.status).toBe(200);
		expect(await blocked.text()).toBe(sameAnswer);
		expect(t.h.mailer.to(TREASURER)).toHaveLength(1 + 3);
		for (let index = 0; index < 20; index += 1)
			await t.post(`/o/${ORG_ID}/link`, { email: `x${index}@elsewhere.test` });
		const before = t.h.mailer.sent.length;
		await t.post(`/o/${ORG_ID}/link`, { email: BOARD });
		expect(t.h.mailer.sent).toHaveLength(before);
	});
});

describe("the organization's pages", () => {
	test("the portfolio needs a session; it shows the notes and totals and no address or agent ref", async () => {
		const t = setup();
		const w = await signedIn(t);
		const anonymous = await t.get(`/o/${ORG_ID}`);
		expect(anonymous.status).toBe(401);
		expect(anonymous.headers.get("Set-Cookie")).toContain("Max-Age=0");
		expect((await t.get(`/o/${ORG_ID}`, "made-up-cookie")).status).toBe(401);
		const response = await t.get(`/o/${ORG_ID}`, w.treasurer);
		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Security-Policy")).toContain(
			"default-src 'none'",
		);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		const text = await response.text();
		expect(text).toContain(w.noteId);
		expect(text).toContain("You are on the team as a treasurer");
		expect(text).toContain("USD");
		expect(text).toContain("Totals");
		expect(text).not.toContain("@");
		for (const ref of Object.values(w.refs)) expect(text).not.toContain(ref);
		expect(text).not.toMatch(CLAIM_WORDS);
		expect(text).not.toMatch(/\b(signature|signed)\b/i);
	});

	test("the approvals queue: a treasurer sees the request, a board member sees Approve on other people's requests only", async () => {
		const t = setup();
		const w = await signedIn(t);
		await t.act(
			`${notePath(w.noteId)}/release`,
			{ step: "draft" },
			w.treasurer,
			notePath(w.noteId),
		);
		const drafted = validateStream(
			(await t.h.store.readLog(w.noteId)).events.map((text): unknown =>
				JSON.parse(text),
			),
		).find((event) => event.type === "release.drafted");
		const asked = await t.act(
			`${notePath(w.noteId)}/request`,
			{ action: "release.confirm", target: drafted?.id as string },
			w.treasurer,
			notePath(w.noteId),
		);
		expect(asked.status).toBe(303);
		const treasurerPage = await (
			await t.get(`/o/${ORG_ID}`, w.treasurer)
		).text();
		expect(treasurerPage).toContain("confirming a release");
		expect(treasurerPage).toContain(
			"You asked for this; another board member must approve.",
		);
		expect(treasurerPage).not.toContain(">Approve<");
		const boardPage = await (await t.get(`/o/${ORG_ID}`, w.board)).text();
		expect(boardPage).toContain(">Approve<");
		const viewerPage = await (await t.get(`/o/${ORG_ID}`, w.viewer)).text();
		expect(viewerPage).not.toContain(">Approve<");
		expect(viewerPage).toContain("treasurers and board members");
		// A board member who asks sees no Approve on their own request.
		await t.act(
			`${notePath(w.noteId)}/request`,
			{ action: "waiver", target: drafted?.id as string },
			w.board,
			notePath(w.noteId),
		);
		const after = await (await t.get(`/o/${ORG_ID}`, w.board)).text();
		expect(after.match(/>Approve</g)).toHaveLength(1);
		expect(after).toContain(
			"You asked for this; another board member must approve.",
		);
	});

	test("Approve on the portfolio posts to the note, and the release then unlocks", async () => {
		const t = setup();
		const w = await signedIn(t);
		const page = notePath(w.noteId);
		await t.act(`${page}/release`, { step: "draft" }, w.treasurer, page);
		const drafted = validateStream(
			(await t.h.store.readLog(w.noteId)).events.map((text): unknown =>
				JSON.parse(text),
			),
		).find((event) => event.type === "release.drafted");
		const target = drafted?.id as string;

		// Before anything: the confirm button is disabled with the reason, and a direct post is refused.
		let treasurerNote = await (await t.get(page, w.treasurer)).text();
		expect(treasurerNote).toContain("Ask for approval");
		expect(treasurerNote).toMatch(
			/<button type="submit" disabled>Confirm the release<\/button>/,
		);
		expect(treasurerNote).toContain("Disabled until a second person approves.");
		const early = await t.act(
			`${page}/release`,
			{ step: "confirm", target },
			w.board,
			page,
		);
		expect(early.status).toBe(409);
		expect(await early.text()).toContain("needs two people");

		await t.act(
			`${page}/request`,
			{ action: "release.confirm", target },
			w.treasurer,
			page,
		);
		treasurerNote = await (await t.get(page, w.treasurer)).text();
		expect(treasurerNote).toContain(
			"Waiting for approval from a board member other than the person who asked.",
		);
		expect(treasurerNote).toContain(
			"You asked for this approval, so another board member must give it.",
		);
		const waiting = await t.act(
			`${page}/release`,
			{ step: "confirm", target },
			w.board,
			page,
		);
		expect(waiting.status).toBe(409);
		expect(await waiting.text()).toContain("waiting for approval");

		// The treasurer cannot approve (not a board member), a board member can, from the portfolio.
		const requestId = /name="request_id" value="([^"]+)"/.exec(
			await (await t.get(`/o/${ORG_ID}`, w.board)).text(),
		)?.[1] as string;
		const byTreasurer = await t.post(
			`${page}/approve`,
			{
				csrf: await t.csrfOf(notePath(w.noteId), w.treasurer),
				request_id: requestId,
			},
			w.treasurer,
		);
		expect(byTreasurer.status).toBe(403);
		const approved = await t.post(
			`${page}/approve`,
			{
				csrf: await t.csrfOf(notePath(w.noteId), w.board),
				request_id: requestId,
			},
			w.board,
		);
		expect(approved.status).toBe(303);
		expect(approved.headers.get("Location")).toBe(`${page}?m=approval_granted`);

		const boardNote = await (await t.get(page, w.board)).text();
		expect(boardNote).toContain(
			"Approved: a second person has agreed to this release.",
		);
		expect(boardNote).not.toMatch(/disabled>Confirm the release/);

		// The confirmation still needs the code, emailed to the person confirming.
		const noCode = await t.act(
			`${page}/release`,
			{ step: "confirm", target },
			w.board,
			page,
		);
		expect(noCode.status).toBe(200);
		const codePage = await noCode.text();
		expect(codePage).toContain("Enter your code");
		expect(codePage).toContain(`action="${page}/release"`);
		expect(codePage).toContain(`action="${page}/code"`);
		const code = t.h.mailer.codeFor(BOARD);
		const confirmed = await t.post(
			`${page}/release`,
			{
				csrf: await t.csrfOf(page, w.board),
				step: "confirm",
				target,
				code,
			},
			w.board,
		);
		expect(confirmed.status).toBe(303);
		expect(confirmed.headers.get("Location")).toBe(
			`${page}?m=release_confirmed`,
		);
		const closed = await (await t.get(page, w.board)).text();
		expect(closed).toContain("Closed: yes");
		expect(closed).toContain("Release");
	});

	test("a default notice stays disabled until approved, and its code goes to the agent who sends it", async () => {
		const t = setup();
		const w = await signedIn(t);
		const page = notePage(w.noteId);
		const before = await (await t.get(page, w.treasurer)).text();
		expect(before).toMatch(
			/<button type="submit" class="secondary" disabled>Record a default notice<\/button>/,
		);
		await t.act(
			`${page}/act`,
			{ type: "annotation.added", text: "Text of the default notice" },
			w.treasurer,
			page,
		);
		const form = await (await t.get(page, w.treasurer)).text();
		const target =
			/<option value="([^"]+)">Note: Text of the default notice<\/option>/.exec(
				form,
			)?.[1] as string;
		expect(target).toBeTruthy();
		await t.act(
			`${page}/request`,
			{ action: "notice.default", target },
			w.treasurer,
			page,
		);
		const requestId = /name="request_id" value="([^"]+)"/.exec(
			await (await t.get(page, w.board)).text(),
		)?.[1] as string;
		await t.post(
			`${page}/approve`,
			{ csrf: await t.csrfOf(page, w.board), request_id: requestId },
			w.board,
		);
		const ready = await (await t.get(page, w.treasurer)).text();
		expect(ready).toContain(
			"One approval is ready. Each approval covers one default notice.",
		);
		expect(ready).not.toMatch(/disabled>Record a default notice/);
		const asked = await t.act(
			`${page}/notice`,
			{ kind: "default", cure_days: "30" },
			w.treasurer,
			page,
		);
		expect(asked.status).toBe(200);
		expect(await asked.text()).toContain("Enter your code");
		const code = t.h.mailer.codeFor(TREASURER);
		const sent = await t.post(
			`${page}/notice`,
			{
				csrf: await t.csrfOf(page, w.treasurer),
				kind: "default",
				cure_days: "30",
				code,
			},
			w.treasurer,
		);
		expect(sent.status).toBe(303);
		expect(sent.headers.get("Location")).toBe(`${page}?m=notice_sent`);
		// The borrower was told a notice was recorded, and nothing about the team.
		const mail = t.h.mailer.to(BORROWER_EMAIL).at(-1)?.text ?? "";
		expect(mail).toContain("recorded a notice");
		const spent = await (await t.get(page, w.treasurer)).text();
		expect(spent).toMatch(/disabled>Record a default notice/);
	});

	test("the note page: the acting role, no ids of people, a viewer sees no form", async () => {
		const t = setup();
		const w = await signedIn(t);
		const page = notePath(w.noteId);
		const asTreasurer = await (await t.get(page, w.treasurer)).text();
		expect(asTreasurer).toContain(
			"You are on the lender&#39;s team as a treasurer.",
		);
		expect(asTreasurer).toContain("Record a payment");
		expect(asTreasurer).toContain("Approvals");
		expect(asTreasurer).toContain(`href="/o/${ORG_ID}"`);
		expect(asTreasurer).toContain(`action="${page}/act"`);
		expect(asTreasurer).not.toContain('action="/n/');
		const asBoard = await (await t.get(page, w.board)).text();
		expect(asBoard).toContain(
			"You are on the lender&#39;s team as a board member.",
		);
		const asViewer = await (await t.get(page, w.viewer)).text();
		expect(asViewer).toContain("You are on the lender&#39;s team as a viewer.");
		expect(asViewer).toContain(
			"Your role is viewer: you can read this record but not change it.",
		);
		expect(asViewer).not.toContain('method="post"');
		for (const text of [asTreasurer, asBoard, asViewer]) {
			expect(text).not.toContain("@");
			for (const ref of Object.values(w.refs)) expect(text).not.toContain(ref);
			expect(text).not.toContain("agent_ref");
			expect(text).not.toMatch(CLAIM_WORDS);
		}
	});

	test("a viewer's post is refused, and so is a post without the session's own token", async () => {
		const t = setup();
		const w = await signedIn(t);
		const page = notePath(w.noteId);
		const before = (await t.h.store.readLog(w.noteId)).events.length;
		const payment = {
			type: "payment.recorded",
			kind: "payment",
			amount: "100.00",
			value_date: "2026-11-10",
		};
		// A viewer's page has no form and so no token; this is the token their session would have.
		const viewerToken = await t.h.org.sessions.csrfToken({
			orgId: ORG_ID,
			hash: await sha256Hex(w.viewer),
		});
		const asViewer = await t.post(
			`${page}/act`,
			{ csrf: viewerToken, ...payment },
			w.viewer,
		);
		expect(asViewer.status).toBe(403);
		expect(await asViewer.text()).toContain("A viewer can read this record");
		// Another agent's token is not this agent's token.
		const wrong = await t.post(
			`${page}/act`,
			{ csrf: viewerToken, ...payment },
			w.treasurer,
		);
		expect(wrong.status).toBe(403);
		expect(await wrong.text()).toContain("expired");
		const none = await t.post(`${page}/act`, payment, w.treasurer);
		expect(none.status).toBe(403);
		const foreign = await t.post(
			`${page}/act`,
			{ csrf: await t.csrfOf(page, w.treasurer), ...payment },
			w.treasurer,
			{ Origin: "https://evil.example" },
		);
		expect(foreign.status).toBe(403);
		expect((await t.h.store.readLog(w.noteId)).events).toHaveLength(before);
		// And the treasurer can.
		const ok = await t.act(`${page}/act`, payment, w.treasurer, page);
		expect(ok.status).toBe(303);
		expect(ok.headers.get("Location")).toBe(`${page}?m=recorded`);
		expect((await t.h.store.readLog(w.noteId)).events).toHaveLength(before + 1);
	});

	test("what the borrower sees: the lender's team, no agent ref, no agent address", async () => {
		const t = setup();
		const w = await signedIn(t);
		const page = notePath(w.noteId);
		await t.act(
			`${page}/act`,
			{
				type: "payment.recorded",
				kind: "payment",
				amount: "50.00",
				value_date: "2026-11-10",
			},
			w.treasurer,
			page,
		);
		const drafted = await t.act(
			`${page}/release`,
			{ step: "draft" },
			w.treasurer,
			page,
		);
		expect(drafted.status).toBe(303);
		const events = validateStream(
			(await t.h.store.readLog(w.noteId)).events.map((text): unknown =>
				JSON.parse(text),
			),
		);
		const draftId = events.find((event) => event.type === "release.drafted")
			?.id as string;
		await t.act(
			`${page}/request`,
			{ action: "release.confirm", target: draftId },
			w.treasurer,
			page,
		);
		const requestId = events.length; // the request is the next event
		expect(requestId).toBeGreaterThan(0);
		const request = validateStream(
			(await t.h.store.readLog(w.noteId)).events.map((text): unknown =>
				JSON.parse(text),
			),
		).find((event) => event.type === "approval.requested");
		await t.post(
			`${page}/approve`,
			{
				csrf: await t.csrfOf(page, w.board),
				request_id: request?.id as string,
			},
			w.board,
		);

		const link = /\/n\/([A-Za-z0-9_-]+)\/enter\?t=([A-Za-z0-9_-]+)/.exec(
			t.h.mailer.to(BORROWER_EMAIL)[0]?.text ?? "",
		);
		const entered = await t.ledger(`/n/${link?.[1]}/enter`, {
			method: "POST",
			body: new URLSearchParams({ t: link?.[2] as string }),
		});
		const borrowerCookie = /__Secure-tf_note=([^;]+)/.exec(
			entered.headers.get("Set-Cookie") ?? "",
		)?.[1] as string;
		const borrowerPage = await (
			await t.ledger(`/n/${w.noteId}`, {
				headers: { Cookie: `${NOTE_COOKIE}=${borrowerCookie}` },
			})
		).text();
		expect(borrowerPage).toContain("The lender is an organization.");
		expect(borrowerPage).toContain("The lender&#39;s team recorded a payment");
		expect(borrowerPage).toContain(
			"The lender&#39;s team asked for a second person to approve confirming a release.",
		);
		expect(borrowerPage).toContain("The lender&#39;s team approved a request.");
		expect(borrowerPage).not.toContain("agent_ref");
		for (const ref of Object.values(w.refs))
			expect(borrowerPage).not.toContain(ref);
		for (const email of [TREASURER, BOARD, VIEWER])
			expect(borrowerPage).not.toContain(email);
		// The borrower's page offers no approval steps and no team controls.
		expect(borrowerPage).not.toContain("/request");
		expect(borrowerPage).not.toContain("/approve");
		// A guest cookie opens nothing under the organization's paths.
		const crossing = await t.ledger(`${page}`, {
			headers: {
				Cookie: `${NOTE_COOKIE}=${borrowerCookie}; ${ORG_COOKIE}=${borrowerCookie}`,
			},
		});
		expect(crossing.status).toBe(401);
	});

	test("agent-typed text is escaped on every new page", async () => {
		const t = setup();
		const w = await signedIn(t);
		const page = notePath(w.noteId);
		const hostile = '<script>alert(1)</script> "quoted" & more';
		await t.act(
			`${page}/act`,
			{ type: "annotation.added", text: hostile },
			w.treasurer,
			page,
		);
		const html = await (await t.get(page, w.board)).text();
		expect(html).not.toContain("<script>alert(1)");
		expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		const target = /<option value="([^"]+)">Note: &lt;script&gt;/.exec(
			html,
		)?.[1] as string;
		expect(target).toBeTruthy();
		await t.act(
			`${page}/request`,
			{ action: "waiver", target },
			w.treasurer,
			page,
		);
		const withRequest = await (await t.get(page, w.board)).text();
		expect(withRequest).not.toContain("<script>alert(1)");
		expect(withRequest).toContain("a waiver for the note &quot;&lt;script&gt;");
		const portfolio = await (await t.get(`/o/${ORG_ID}`, w.board)).text();
		expect(portfolio).not.toContain("<script>");
		// An unreadable note's reason is escaped too.
		t.h.store.tamperEventForTest(
			w.noteId,
			1,
			'{"type":"<img src=x onerror=alert(1)>"}',
		);
		const broken = await (await t.get(`/o/${ORG_ID}`, w.board)).text();
		expect(broken).toContain("Could not be read");
		expect(broken).not.toContain("<img src=x");
	});
});

describe("separate organizations over HTTP", () => {
	test("a session of one organization reads nothing of another, and a missing organization is a 404", async () => {
		const t = setup();
		const a = await t.createNote({ orgId: "org-a", idem: "a" });
		const b = await t.createNote({
			orgId: "org-b",
			idem: "b",
			agents: [
				{ email: "bob@other.test", role: "board" },
				{ email: "tim@other.test", role: "treasurer" },
			],
		});
		const asA = (await t.enter(TREASURER, "org-a")).cookie;
		const asB = (await t.enter("bob@other.test", "org-b")).cookie;

		// A's own page and note work.
		expect((await t.get("/o/org-a", asA)).status).toBe(200);
		expect((await t.get(notePath(a.note_id, "org-a"), asA)).status).toBe(200);

		// A's cookie on B's paths: no session there.
		for (const path of [
			"/o/org-b",
			"/o/org-b/board.csv",
			"/o/org-b/board.json",
			notePath(b.note_id, "org-b"),
		]) {
			const response = await t.get(path, asA);
			expect(response.status).toBe(401);
			expect(await response.text()).not.toContain(b.note_id);
		}
		// B's note under A's organization: a plain 404, for every kind of request.
		const foreign = notePath(b.note_id, "org-a");
		expect((await t.get(foreign, asA)).status).toBe(404);
		expect((await t.get(`${foreign}/bundle.json`, asA)).status).toBe(404);
		expect((await t.get(`${foreign}/docs/abc`, asA)).status).toBe(404);
		for (const step of [
			"act",
			"release",
			"notice",
			"payoff",
			"receipt",
			"request",
			"approve",
			"code",
		]) {
			const response = await t.post(
				`${foreign}/${step}`,
				{
					csrf: await t.csrfOf(notePath(a.note_id, "org-a"), asA),
					type: "annotation.added",
					text: "x",
				},
				asA,
			);
			expect(response.status).toBe(404);
		}
		expect((await t.h.store.readLog(b.note_id)).events).toHaveLength(1);
		// The portfolios hold only their own notes.
		const pageA = await (await t.get("/o/org-a", asA)).text();
		expect(pageA).toContain(a.note_id);
		expect(pageA).not.toContain(b.note_id);
		const pageB = await (await t.get("/o/org-b", asB)).text();
		expect(pageB).not.toContain(a.note_id);

		// Nothing is registered under these ids.
		for (const path of [
			"/o/ghost",
			"/o/ghost/enter",
			"/o/ghost/board.csv",
			notePath(a.note_id, "ghost"),
		]) {
			expect((await t.get(path, asA)).status).toBe(404);
		}
		expect((await t.post("/o/ghost/link", { email: TREASURER })).status).toBe(
			404,
		);
	});

	test("every organization route answers 404 outside staging and 503 without the secret", async () => {
		const t = setup();
		await t.createNote();
		const production = { ...t.env, ENVIRONMENT: "production" as const };
		const unset = { ...t.env, NOTES_SESSION_SECRET: undefined };
		for (const path of [
			`/o/${ORG_ID}`,
			`/o/${ORG_ID}/enter`,
			`${notePath("nt_abcdefgh")}`,
		]) {
			const gated = await notesRoute(
				new Request(`https://${LEDGER}${path}`),
				production,
				t.deps,
			);
			expect(gated?.status).toBe(404);
			const closed = await notesRoute(
				new Request(`https://${LEDGER}${path}`),
				unset,
				t.deps,
			);
			expect(closed?.status).toBe(503);
		}
		for (const path of ["/v1/orgs/coop-1/portfolio"]) {
			const gated = await notesRoute(
				new Request(`https://${API}${path}`, { headers: t.bearer }),
				production,
				t.deps,
			);
			expect(gated?.status).toBe(404);
		}
	});
});

describe("the board report", () => {
	const rowKeys = new Set(BOARD_CSV_HEADER);
	const totalKeys = new Set([
		"currency",
		"exponent",
		"notes",
		"outstanding_payoff_minor",
		"overdue_minor",
		"buckets",
		"awaiting_confirmation",
		"disputed",
		"terms_pending",
	]);

	/** Every key of every object in `value`, with its path. */
	const walkKeys = (value: unknown, path = "$"): string[] => {
		if (Array.isArray(value))
			return value.flatMap((item, index) =>
				walkKeys(item, `${path}[${index}]`),
			);
		if (typeof value !== "object" || value === null) return [];
		return Object.entries(value).flatMap(([key, inner]) => [
			`${path}.${key}`,
			...walkKeys(inner, `${path}.${key}`),
		]);
	};

	test("CSV and JSON for a treasurer or board member: attachment, nosniff, no-store, only the planned fields, none of the free text, refs or ids", async () => {
		const t = setup();
		const w = await signedIn(t);
		const page = notePath(w.noteId);
		const hiddenText = "private reason text 5521";
		await t.act(
			`${page}/act`,
			{ type: "annotation.added", text: hiddenText },
			w.treasurer,
			page,
		);
		await t.act(`${page}/release`, { step: "draft" }, w.treasurer, page);
		const events = validateStream(
			(await t.h.store.readLog(w.noteId)).events.map((text): unknown =>
				JSON.parse(text),
			),
		);
		await t.act(
			`${page}/request`,
			{
				action: "release.confirm",
				target: events.find((e) => e.type === "release.drafted")?.id as string,
			},
			w.treasurer,
			page,
		);
		// A second note in euros, so the report has two currencies.
		await t.createNote({ idem: "eur", terms: EUR_TERMS });
		const all = validateStream(
			(await t.h.store.readLog(w.noteId)).events.map((text): unknown =>
				JSON.parse(text),
			),
		);

		for (const cookie of [w.treasurer, w.board]) {
			const csv = await t.get(
				`/o/${ORG_ID}/board.csv?as_of=2026-12-20`,
				cookie,
			);
			expect(csv.status).toBe(200);
			expect(csv.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
			expect(csv.headers.get("Content-Disposition")).toBe(
				'attachment; filename="board-report-2026-12-20.csv"',
			);
			expect(csv.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(csv.headers.get("Cache-Control")).toBe("no-store");
			const csvText = await csv.text();
			expect(csvText.split("\n")[0]).toBe(BOARD_CSV_HEADER.join(","));
			expect(csvText.endsWith("\n")).toBe(true);
			expect(csvText.trim().split("\n")).toHaveLength(3);

			const report = await t.get(
				`/o/${ORG_ID}/board.json?as_of=2026-12-20`,
				cookie,
			);
			expect(report.status).toBe(200);
			expect(report.headers.get("Content-Disposition")).toContain("attachment");
			expect(report.headers.get("X-Content-Type-Options")).toBe("nosniff");
			expect(report.headers.get("Cache-Control")).toBe("no-store");
			const jsonText = await report.text();
			const parsed = JSON.parse(jsonText) as {
				generated_for: string;
				totals: Record<string, unknown>[];
				rows: Record<string, unknown>[];
				not_computed: number;
			};
			expect(Object.keys(parsed).sort()).toEqual([
				"generated_for",
				"not_computed",
				"rows",
				"totals",
			]);
			expect(parsed.generated_for).toBe("2026-12-20");
			expect(parsed.not_computed).toBe(0);
			for (const row of parsed.rows)
				expect(Object.keys(row).every((key) => rowKeys.has(key))).toBe(true);
			for (const total of parsed.totals)
				expect(Object.keys(total).every((key) => totalKeys.has(key))).toBe(
					true,
				);
			expect(parsed.totals.map((total) => total.currency)).toEqual([
				"EUR",
				"USD",
			]);
			// Walk every key: nothing named like free text, a person, an id or an address.
			const banned =
				/(^|\.)(agent_ref|agent|id|event_id|text|reason|email|target|request|requested_by|entered_by|via|reference|method|annotation|events?)$/;
			for (const key of walkKeys(parsed)) expect(banned.test(key)).toBe(false);
			// And walk the values: no free text, agent ref, event id or address.
			for (const text of [csvText, jsonText]) {
				expect(text).not.toContain(hiddenText);
				expect(text).not.toContain("@");
				for (const ref of Object.values(w.refs))
					expect(text).not.toContain(ref);
				for (const event of all) expect(text).not.toContain(event.id);
			}
		}
	});

	test("a viewer, a session-less caller and a bad date are refused; as_of defaults to today", async () => {
		const t = setup();
		const w = await signedIn(t);
		expect((await t.get(`/o/${ORG_ID}/board.csv`)).status).toBe(401);
		const viewer = await t.get(`/o/${ORG_ID}/board.csv`, w.viewer);
		expect(viewer.status).toBe(403);
		expect((await t.get(`/o/${ORG_ID}/board.json`, w.viewer)).status).toBe(403);
		expect(await viewer.text()).not.toContain("note_id");
		const bad = await t.get(`/o/${ORG_ID}/board.csv?as_of=2026-02-31`, w.board);
		expect(bad.status).toBe(400);
		const today = await t.get(`/o/${ORG_ID}/board.json`, w.board);
		expect(
			((await today.json()) as { generated_for: string }).generated_for,
		).toBe("2026-11-22");
		// Not a GET.
		const posted = await notesRoute(
			new Request(`https://${LEDGER}/o/${ORG_ID}/board.csv`, {
				method: "POST",
				headers: { Cookie: `${ORG_COOKIE}=${w.board}` },
			}),
			t.env,
			t.deps,
		);
		expect(posted).toBeNull();
	});

	test("a spreadsheet cannot run a note id: a cell that starts with = gets a quote in front", async () => {
		const t = setup();
		const w = await signedIn(t);
		// A note whose id is a formula, in the store and the index, as a corrupt or hostile id would be.
		const id = "=cmd";
		const created = {
			schema: NOTE_EVENT_SCHEMA,
			id: "evt-formula",
			note_id: id,
			seq: 1,
			entered_at: "2026-11-22T09:00:00.000Z",
			entered_by: "lender",
			type: "note.created",
			terms: TERMS,
		};
		const [event] = validateStream([created]);
		const [link] = await buildChain([event as NonNullable<typeof event>]);
		await t.h.store.putOrg(id, ORG_ID);
		await t.h.store.append(id, 0, {
			eventJson: JSON.stringify(event),
			link: link as NonNullable<typeof link>,
		});
		await t.h.orgs.registerNote(
			ORG_ID,
			id,
			"lender",
			"2026-11-22T09:00:00.000Z",
		);
		const csv = await (
			await t.get(`/o/${ORG_ID}/board.csv?as_of=2026-12-20`, w.board)
		).text();
		const lines = csv.trim().split("\n");
		expect(lines.some((line) => line.startsWith("'=cmd,USD,"))).toBe(true);
		expect(lines.some((line) => line.startsWith("=cmd"))).toBe(false);
		// The portfolio page shows it as text.
		const pageHtml = await (await t.get(`/o/${ORG_ID}`, w.board)).text();
		expect(pageHtml).toContain(">=cmd</a>");
	});
});

describe("the API twin and the agent registry over HTTP", () => {
	test("the portfolio needs the bearer key, 404s for an unknown organization, and carries no agent ref or event id", async () => {
		const t = setup();
		const w = await signedIn(t);
		const page = notePath(w.noteId);
		await t.act(`${page}/release`, { step: "draft" }, w.treasurer, page);
		const draft = validateStream(
			(await t.h.store.readLog(w.noteId)).events.map((text): unknown =>
				JSON.parse(text),
			),
		).find((event) => event.type === "release.drafted");
		await t.act(
			`${page}/request`,
			{ action: "release.confirm", target: draft?.id as string },
			w.treasurer,
			page,
		);
		const url = `/v1/orgs/${ORG_ID}/portfolio?as_of=2026-12-20`;
		expect((await t.api(url)).status).toBe(401);
		expect(
			(await t.api(url, { headers: { Authorization: "Bearer nope" } })).status,
		).toBe(401);
		const response = await t.api(url, { headers: t.bearer });
		expect(response.status).toBe(200);
		const text = await response.text();
		const body = JSON.parse(text) as {
			org_id: string;
			as_of: string;
			portfolio: {
				rows: { note_id: string }[];
				totals: unknown[];
				invalid: unknown[];
			};
			approvals: Record<string, unknown>[];
		};
		expect(body.org_id).toBe(ORG_ID);
		expect(body.as_of).toBe("2026-12-20");
		expect(body.portfolio.rows.map((row) => row.note_id)).toEqual([w.noteId]);
		expect(body.approvals).toEqual([
			expect.objectContaining({ note_id: w.noteId, action: "release.confirm" }),
		]);
		expect(Object.keys(body.approvals[0] ?? {}).sort()).toEqual([
			"action",
			"note_id",
			"requested_at",
		]);
		for (const ref of Object.values(w.refs)) expect(text).not.toContain(ref);
		expect(text).not.toContain(draft?.id as string);
		expect(
			(await t.api("/v1/orgs/ghost/portfolio", { headers: t.bearer })).status,
		).toBe(404);
		expect(
			(
				await t.api(`/v1/orgs/${ORG_ID}/portfolio?as_of=nope`, {
					headers: t.bearer,
				})
			).status,
		).toBe(400);
	});

	test("adding and deactivating an agent: bearer only, immediate effect on cookies and links", async () => {
		const t = setup();
		const w = await signedIn(t);
		const url = `/v1/notes/${w.noteId}/agents`;
		const send = (body: unknown, headers: HeadersInit = t.bearer) =>
			t.api(url, { method: "POST", headers, body: JSON.stringify(body) });
		expect(
			(await send({ action: "add", email: BOARD_TWO, role: "board" }, {}))
				.status,
		).toBe(401);
		expect((await send("nope")).status).toBe(400);
		expect((await send({ action: "promote" })).status).toBe(400);
		expect((await send({ action: "add", email: BOARD_TWO })).status).toBe(400);
		expect((await send({ action: "deactivate" })).status).toBe(400);
		const added = await send({
			action: "add",
			email: BOARD_TWO,
			role: "board",
		});
		expect(added.status).toBe(200);
		const addedBody = (await added.json()) as {
			agent_ref: string;
			role: string;
			active: boolean;
		};
		expect(addedBody).toMatchObject({ role: "board", active: true });
		expect(JSON.stringify(addedBody)).not.toContain("@");
		expect((await t.enter(BOARD_TWO)).cookie).toBeTruthy();
		expect(
			(await send({ action: "add", email: BORROWER_EMAIL, role: "viewer" }))
				.status,
		).toBe(400);
		const unknown = await t.api(`/v1/notes/nt_abcdefgh1/agents`, {
			method: "POST",
			headers: t.bearer,
			body: JSON.stringify({
				action: "add",
				email: "x@coop.test",
				role: "viewer",
			}),
		});
		expect(unknown.status).toBe(404);

		// Deactivate the board member who is signed in, with a link waiting.
		await t.post(`/o/${ORG_ID}/link`, { email: BOARD });
		const waiting = t.h.mailer.linkTokenFor(BOARD);
		expect((await t.get(`/o/${ORG_ID}`, w.board)).status).toBe(200);
		const done = await send({ action: "deactivate", agent_ref: w.refs.board });
		expect(done.status).toBe(200);
		expect(await done.json()).toEqual({
			agent_ref: w.refs.board,
			active: false,
		});
		const gone = await t.get(`/o/${ORG_ID}`, w.board);
		expect(gone.status).toBe(401);
		expect((await t.get(notePath(w.noteId), w.board)).status).toBe(401);
		expect((await t.post(`/o/${ORG_ID}/enter`, { t: waiting })).status).toBe(
			400,
		);
		const sent = t.h.mailer.sent.length;
		await t.post(`/o/${ORG_ID}/link`, { email: BOARD });
		expect(t.h.mailer.sent).toHaveLength(sent);
		// By address, and not found.
		expect((await send({ action: "deactivate", email: VIEWER })).status).toBe(
			200,
		);
		expect(
			(await send({ action: "deactivate", agent_ref: "ag_none" })).status,
		).toBe(404);
		// The treasurer is unaffected.
		expect((await t.get(`/o/${ORG_ID}`, w.treasurer)).status).toBe(200);
		expect((await t.get(`/o/${ORG_ID}`, w.viewer)).status).toBe(401);
	});
});

describe("time", () => {
	test("an organization session ends when idle for two hours", async () => {
		const t = setup();
		const w = await signedIn(t);
		expect((await t.get(`/o/${ORG_ID}`, w.treasurer)).status).toBe(200);
		t.h.clock.advance(3 * HOUR);
		expect((await t.get(`/o/${ORG_ID}`, w.treasurer)).status).toBe(401);
	});
});

const notePage = notePath;
