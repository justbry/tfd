import { beforeAll, describe, expect, test } from "bun:test";
import { resetHealthCache } from "../src/health";
import worker from "../src/index";
import { type NotesDeps, notesRoute } from "../src/notes/routes";
import { fakeEnv, signingPem } from "./fakes";
import {
	API,
	API_KEY,
	BORROWER_EMAIL,
	HOUR,
	harness,
	LEDGER,
	LENDER_EMAIL,
	notesEnv,
	SECRET,
	TERMS,
} from "./notes-fakes";

const CLAIM_WORDS =
	/\b(proof|enforceable|binding|tamper-proof|legally|credit)\b/i;
const SIGNATURE_WORDS = /\b(signature|signed)\b/i;
const CSRF_FIELD = /name="csrf" value="([^"]+)"/;
const COOKIE_NAME = "__Secure-tf_note";

let pem = "";
beforeAll(async () => {
	pem = await signingPem();
});

const setup = (envOverrides: Parameters<typeof notesEnv>[0] = {}) => {
	const h = harness();
	const env = notesEnv(envOverrides);
	const deps: NotesDeps = {
		store: h.store,
		mailer: h.mailer,
		clock: h.clock,
		ids: h.ids,
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
	const createViaApi = async (idem = "idem-1"): Promise<string> => {
		const response = await api("/v1/notes", {
			method: "POST",
			headers: bearer,
			body: JSON.stringify({
				terms: TERMS,
				lender_email: LENDER_EMAIL,
				borrower_email: BORROWER_EMAIL,
				idem,
			}),
		});
		expect(response.status).toBe(201);
		return ((await response.json()) as { note_id: string }).note_id;
	};
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
				...(cookie ? { Cookie: `${COOKIE_NAME}=${cookie}` } : {}),
				...headers,
			},
		});
	const get = (path: string, cookie?: string) =>
		ledger(path, {
			headers: cookie ? { Cookie: `${COOKIE_NAME}=${cookie}` } : {},
		});
	/** Opens the newest emailed link the way a browser does: GET the page, press the button. */
	const enter = async (noteId: string, email: string) => {
		const token = h.mailer.linkTokenFor(email);
		expect((await get(`/n/${noteId}/enter?t=${token}`)).status).toBe(200);
		const response = await post(`/n/${noteId}/enter`, { t: token });
		expect(response.status).toBe(303);
		const cookie = new RegExp(`${COOKIE_NAME}=([^;]+)`).exec(
			response.headers.get("Set-Cookie") ?? "",
		)?.[1];
		if (!cookie) throw new Error("no cookie");
		return { cookie, token, response };
	};
	const csrfOf = async (noteId: string, cookie: string): Promise<string> => {
		const text = await (await get(`/n/${noteId}`, cookie)).text();
		const token = CSRF_FIELD.exec(text)?.[1];
		if (!token) throw new Error("no csrf token on the page");
		return token;
	};
	return {
		h,
		env,
		deps,
		call,
		ledger,
		api,
		bearer,
		createViaApi,
		post,
		get,
		enter,
		csrfOf,
	};
};

describe("the API host", () => {
	test("creating a note needs the bearer key, compared whole; the answer is the note id and nothing else", async () => {
		const { api, bearer, h } = setup();
		const body = JSON.stringify({
			terms: TERMS,
			lender_email: LENDER_EMAIL,
			borrower_email: BORROWER_EMAIL,
			idem: "k1",
		});
		const wrongKeys: Record<string, string>[] = [
			{},
			{ Authorization: "Bearer " },
			{ Authorization: "Bearer wrong" },
			{ Authorization: `Bearer ${API_KEY}x` },
			{ Authorization: API_KEY },
			{ Authorization: `Bearer ${API_KEY.slice(0, -1)}` },
		];
		for (const headers of wrongKeys) {
			const refused = await api("/v1/notes", { method: "POST", headers, body });
			expect(refused.status).toBe(401);
			expect(refused.headers.get("WWW-Authenticate")).toBe("Bearer");
		}
		expect(h.mailer.sent).toHaveLength(0);
		const created = await api("/v1/notes", {
			method: "POST",
			headers: bearer,
			body,
		});
		expect(created.status).toBe(201);
		const json = (await created.json()) as Record<string, unknown>;
		expect(Object.keys(json)).toEqual(["note_id"]);
		expect(h.mailer.sent).toHaveLength(2);
		expect(JSON.stringify(json)).not.toContain("t=");
		const again = await api("/v1/notes", {
			method: "POST",
			headers: bearer,
			body,
		});
		expect(again.status).toBe(200);
		expect(await again.json()).toEqual(json);
		expect(h.mailer.sent).toHaveLength(2);
	});

	test("bad bodies and engine refusals have their own statuses", async () => {
		const { api, bearer } = setup();
		const send = (body: unknown, raw = false) =>
			api("/v1/notes", {
				method: "POST",
				headers: bearer,
				body: raw ? (body as string) : JSON.stringify(body),
			});
		const good = {
			terms: TERMS,
			lender_email: LENDER_EMAIL,
			borrower_email: BORROWER_EMAIL,
			idem: "k",
		};
		expect((await send("{nope", true)).status).toBe(400);
		expect((await send([])).status).toBe(400);
		expect((await send({ ...good, idem: 5 })).status).toBe(400);
		expect(
			(await send({ ...good, terms: { ...TERMS, principal_minor: "0" } }))
				.status,
		).toBe(422);
		expect((await send({ ...good, borrower_email: LENDER_EMAIL })).status).toBe(
			400,
		);
		expect((await send(good)).status).toBe(201);
		expect(
			(await send({ ...good, terms: { ...TERMS, principal_minor: "7" } }))
				.status,
		).toBe(409);
	});

	test("the statement needs the key and returns the statement with the chain verdict", async () => {
		const { api, bearer, createViaApi } = setup();
		const noteId = await createViaApi();
		expect((await api(`/v1/notes/${noteId}/statement`)).status).toBe(401);
		const response = await api(
			`/v1/notes/${noteId}/statement?as_of=2026-12-05`,
			{ headers: bearer },
		);
		expect(response.status).toBe(200);
		const json = (await response.json()) as {
			note_id: string;
			statement: { as_of: string };
			chain: unknown;
		};
		expect(json.note_id).toBe(noteId);
		expect(json.statement.as_of).toBe("2026-12-05");
		expect(json.chain).toEqual({ ok: true });
		expect(
			(
				await api(`/v1/notes/${noteId}/statement?as_of=garbage`, {
					headers: bearer,
				})
			).status,
		).toBe(400);
		expect(
			(await api("/v1/notes/nt_nothing0000/statement", { headers: bearer }))
				.status,
		).toBe(404);
	});

	test("every answer is no-store, and the Worker's headers keep no-referrer", async () => {
		const { api, bearer, createViaApi } = setup();
		const noteId = await createViaApi();
		for (const response of [
			await api("/v1/notes", { method: "POST" }),
			await api(`/v1/notes/${noteId}/statement`, { headers: bearer }),
		]) {
			expect(response.headers.get("Cache-Control")).toBe("no-store");
			expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
		}
	});

	test("without NOTES_API_KEY nothing is accepted, and without NOTES_SESSION_SECRET the routes answer 503", async () => {
		const noKey = setup({ NOTES_API_KEY: undefined });
		expect(
			(
				await noKey.api("/v1/notes", {
					method: "POST",
					headers: { Authorization: "Bearer " },
					body: "{}",
				})
			).status,
		).toBe(401);
		expect(
			(
				await noKey.api("/v1/notes", {
					method: "POST",
					headers: { Authorization: "Bearer undefined" },
					body: "{}",
				})
			).status,
		).toBe(401);
		const noSecret = setup({ NOTES_SESSION_SECRET: undefined });
		expect(
			(
				await noSecret.api("/v1/notes", {
					method: "POST",
					headers: noSecret.bearer,
					body: "{}",
				})
			).status,
		).toBe(503);
		expect((await noSecret.ledger("/n/nt_whatever0000")).status).toBe(503);
	});

	test("with no email provider configured a create still writes the note and says the invitation was not sent", async () => {
		const env = notesEnv();
		const h = harness();
		const response = await notesRoute(
			new Request(`https://${API}/v1/notes`, {
				method: "POST",
				headers: { Authorization: `Bearer ${API_KEY}` },
				body: JSON.stringify({
					terms: TERMS,
					lender_email: LENDER_EMAIL,
					borrower_email: BORROWER_EMAIL,
					idem: "nomail",
				}),
			}),
			env,
			{ store: h.store, clock: h.clock, ids: h.ids },
		);
		expect(response?.status).toBe(502);
		expect(
			((await response?.json()) as { error: { code: string } }).error.code,
		).toBe("mail_failed");
	});
});

describe("the link page and signing in", () => {
	test("GET shows a button and redeems nothing: a link can be fetched any number of times, then used once", async () => {
		const { h, createViaApi, get, post } = setup();
		const noteId = await createViaApi();
		const token = h.mailer.linkTokenFor(BORROWER_EMAIL);
		for (let fetches = 0; fetches < 3; fetches += 1) {
			const response = await get(`/n/${noteId}/enter?t=${token}`);
			expect(response.status).toBe(200);
			const text = await response.text();
			expect(text).toContain(
				`<form method="post" action="/n/${noteId}/enter">`,
			);
			expect(text).toContain("<button");
			expect(response.headers.get("Set-Cookie")).toBeNull();
		}
		expect((await post(`/n/${noteId}/enter`, { t: token })).status).toBe(303);
		const second = await post(`/n/${noteId}/enter`, { t: token });
		expect(second.status).toBe(400);
		expect(await second.text()).not.toContain(token);
	});

	test("redeeming sets one note-scoped HttpOnly Secure SameSite=Lax cookie and redirects to a target with no token", async () => {
		const { createViaApi, enter } = setup();
		const noteId = await createViaApi();
		const { cookie, token, response } = await enter(noteId, BORROWER_EMAIL);
		const setCookie = response.headers.get("Set-Cookie") ?? "";
		expect(setCookie).toStartWith(`${COOKIE_NAME}=`);
		for (const attribute of [
			"HttpOnly",
			"Secure",
			"SameSite=Lax",
			`Path=/n/${noteId}`,
			"Max-Age=43200",
		])
			expect(setCookie).toContain(attribute);
		expect(response.headers.get("Location")).toBe(`/n/${noteId}?m=entered`);
		expect(cookie).not.toBe(token);
		expect(response.headers.get("Location")).not.toContain(token);
		expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
	});

	test("no page after redemption carries the link token, the cookie value or an email address", async () => {
		const { h, createViaApi, enter, get, post, csrfOf } = setup();
		const noteId = await createViaApi();
		const { cookie, token } = await enter(noteId, BORROWER_EMAIL);
		const csrf = await csrfOf(noteId, cookie);
		const pages = [await (await get(`/n/${noteId}?m=entered`, cookie)).text()];
		pages.push(
			await (
				await post(`/n/${noteId}/act`, { csrf, type: "terms.accepted" }, cookie)
			).text(),
		);
		const code = h.mailer.codeFor(BORROWER_EMAIL);
		pages.push(
			await (
				await post(
					`/n/${noteId}/code`,
					{ csrf, type: "terms.accepted" },
					cookie,
				)
			).text(),
		);
		const newCode = h.mailer.codeFor(BORROWER_EMAIL);
		pages.push(
			await (await post(`/n/${noteId}/link`, { email: BORROWER_EMAIL })).text(),
		);
		pages.push(await (await post(`/n/${noteId}/enter`, { t: token })).text());
		for (const text of pages) {
			expect(text).not.toContain(token);
			expect(text).not.toContain(cookie);
			expect(text).not.toContain("example.com");
			expect(text).not.toContain(`>${code}<`);
			expect(text).not.toContain(newCode);
		}
	});

	test("a missing, altered or other-note cookie is sent to sign in again", async () => {
		const { createViaApi, enter, get } = setup();
		const other = await createViaApi("other");
		const noteId = await createViaApi("this");
		const { cookie } = await enter(noteId, BORROWER_EMAIL);
		expect((await get(`/n/${noteId}`)).status).toBe(401);
		expect((await get(`/n/${noteId}`, `${cookie}x`)).status).toBe(401);
		expect((await get(`/n/${noteId}`, cookie.replace(/.$/, "_"))).status).toBe(
			401,
		);
		expect((await get(`/n/${other}`, cookie)).status).toBe(401);
		expect((await get(`/n/${noteId}`, cookie)).status).toBe(200);
	});

	test("sessions end by idle time and by the absolute limit", async () => {
		const { h, createViaApi, enter, get } = setup();
		const noteId = await createViaApi();
		const { cookie } = await enter(noteId, BORROWER_EMAIL);
		h.clock.advance(2 * HOUR + 1);
		expect((await get(`/n/${noteId}`, cookie)).status).toBe(401);
		await createViaApi("two");
		const second = await setup();
		const secondId = await second.createViaApi();
		const { cookie: kept } = await second.enter(secondId, BORROWER_EMAIL);
		for (let step = 0; step < 11; step += 1) {
			second.h.clock.advance(HOUR);
			expect((await second.get(`/n/${secondId}`, kept)).status).toBe(200);
		}
		second.h.clock.advance(HOUR);
		expect((await second.get(`/n/${secondId}`, kept)).status).toBe(401);
	});

	test("a request for a new link answers the same text for a matching and a non-matching address, and a cross-site post is refused", async () => {
		const { h, createViaApi, post } = setup();
		const noteId = await createViaApi();
		const sent = h.mailer.sent.length;
		const matching = await post(`/n/${noteId}/link`, { email: BORROWER_EMAIL });
		const stranger = await post(`/n/${noteId}/link`, {
			email: "stranger@example.com",
		});
		const empty = await post(`/n/${noteId}/link`, {});
		expect(matching.status).toBe(200);
		const matchingText = await matching.text();
		expect(matchingText).toBe(await stranger.text());
		expect(stranger.status).toBe(empty.status);
		expect(h.mailer.sent.length - sent).toBe(1);
		expect(
			(
				await post(`/n/${noteId}/link`, { email: BORROWER_EMAIL }, undefined, {
					Origin: "https://evil.example",
				})
			).status,
		).toBe(403);
		expect(
			(
				await post(
					`/n/${noteId}/enter`,
					{ t: h.mailer.linkTokenFor(BORROWER_EMAIL) },
					undefined,
					{ Origin: "https://evil.example" },
				)
			).status,
		).toBe(403);
		// The same text goes out after the hourly limit too.
		for (let index = 0; index < 4; index += 1)
			await post(`/n/${noteId}/link`, { email: BORROWER_EMAIL });
		const limited = await post(`/n/${noteId}/link`, { email: BORROWER_EMAIL });
		expect(await limited.text()).toBe(matchingText);
		expect(h.mailer.sent.length - sent).toBe(3);
	});
});

describe("posts need the CSRF token", () => {
	test("a missing or wrong token, a token from another session or a cross-site Origin writes nothing", async () => {
		const { h, createViaApi, enter, post, csrfOf } = setup();
		const noteId = await createViaApi();
		const borrower = await enter(noteId, BORROWER_EMAIL);
		const lender = await enter(noteId, LENDER_EMAIL);
		const good = await csrfOf(noteId, borrower.cookie);
		const note = { type: "annotation.added", text: "hello" };
		for (const fields of [
			note,
			{ ...note, csrf: "" },
			{ ...note, csrf: "nope" },
			{ ...note, csrf: `${good}x` },
			{ ...note, csrf: await csrfOf(noteId, lender.cookie) },
		]) {
			expect(
				(await post(`/n/${noteId}/act`, fields, borrower.cookie)).status,
			).toBe(403);
		}
		const crossSite = await post(
			`/n/${noteId}/act`,
			{ ...note, csrf: good },
			borrower.cookie,
			{ Origin: "https://evil.example" },
		);
		expect(crossSite.status).toBe(403);
		expect((await h.store.readLog(noteId)).events).toHaveLength(1);
		expect(
			(
				await post(
					`/n/${noteId}/act`,
					{ ...note, csrf: good },
					borrower.cookie,
					{ Origin: `https://${LEDGER}` },
				)
			).status,
		).toBe(303);
		expect((await h.store.readLog(noteId)).events).toHaveLength(2);
		expect(
			(
				await post(
					`/n/${noteId}/code`,
					{ type: "terms.accepted" },
					borrower.cookie,
				)
			).status,
		).toBe(403);
		expect(
			(await post(`/n/${noteId}/act`, { ...note, csrf: good })).status,
		).toBe(401);
	});

	test("a different NOTES_SESSION_SECRET rejects a token made under the first", async () => {
		const first = setup();
		const noteId = await first.createViaApi();
		const { cookie } = await first.enter(noteId, BORROWER_EMAIL);
		const token = await first.csrfOf(noteId, cookie);
		const rotated = await notesRoute(
			new Request(`https://${LEDGER}/n/${noteId}/act`, {
				method: "POST",
				headers: { Cookie: `${COOKIE_NAME}=${cookie}` },
				body: new URLSearchParams({
					csrf: token,
					type: "annotation.added",
					text: "x",
				}),
			}),
			notesEnv({ NOTES_SESSION_SECRET: `${SECRET}-rotated` }),
			first.deps,
		);
		expect(rotated?.status).toBe(403);
	});
});

describe("the flow in a browser's terms", () => {
	test("accept with a code, pay, confirm: both pages show equal counts, `Closed: no` and the confirmation wording", async () => {
		const { h, createViaApi, enter, get, post, csrfOf } = setup();
		const noteId = await createViaApi();
		const borrower = await enter(noteId, BORROWER_EMAIL);
		let csrf = await csrfOf(noteId, borrower.cookie);
		let page = await (await get(`/n/${noteId}`, borrower.cookie)).text();
		expect(page).toContain("Needs you");
		expect(page).toContain("Accept these terms");
		expect(page).toContain("Not my loan");
		expect(page).toContain("Closed: no");

		// A sensitive step first answers with the code page, and mails the code.
		const codePage = await post(
			`/n/${noteId}/act`,
			{ csrf, type: "terms.accepted" },
			borrower.cookie,
		);
		expect(codePage.status).toBe(200);
		expect(await codePage.text()).toContain("Enter your code");
		const code = h.mailer.codeFor(BORROWER_EMAIL);
		const wrong = code === "000000" ? "111111" : "000000";
		const refused = await post(
			`/n/${noteId}/act`,
			{ csrf, type: "terms.accepted", code: wrong },
			borrower.cookie,
		);
		expect(refused.status).toBe(403);
		expect(await refused.text()).toContain("That code is not right.");
		const accepted = await post(
			`/n/${noteId}/act`,
			{ csrf, type: "terms.accepted", code },
			borrower.cookie,
		);
		expect(accepted.status).toBe(303);
		expect(accepted.headers.get("Location")).toBe(`/n/${noteId}?m=recorded`);
		page = await (await get(`/n/${noteId}`, borrower.cookie)).text();
		expect(page).toContain(
			"accepted, confirmed by the holder of a**@e******.com",
		);

		const recorded = await post(
			`/n/${noteId}/act`,
			{
				csrf,
				type: "payment.recorded",
				kind: "payment",
				amount: "1000.00",
				value_date: "2026-11-10",
				method: "transfer",
				reference: "ref 1",
			},
			borrower.cookie,
		);
		expect(recorded.status).toBe(303);
		page = await (await get(`/n/${noteId}`, borrower.cookie)).text();
		expect(page).toContain("claimed by borrower");
		expect(page).toContain("1,000.00 USD");

		const lender = await enter(noteId, LENDER_EMAIL);
		csrf = await csrfOf(noteId, lender.cookie);
		const lenderPage = await (await get(`/n/${noteId}`, lender.cookie)).text();
		expect(lenderPage).toContain("Confirm this payment");
		const target = /name="target" value="([^"]+)"/.exec(lenderPage)?.[1] ?? "";
		const confirmed = await post(
			`/n/${noteId}/act`,
			{ csrf, type: "payment.confirmed", target },
			lender.cookie,
		);
		expect(confirmed.status).toBe(303);

		for (const cookie of [borrower.cookie, lender.cookie]) {
			const text = await (await get(`/n/${noteId}`, cookie)).text();
			expect(text).toContain("The two counts agree.");
			expect(text).toContain("Closed: no");
			expect(text).toContain("confirmed by the holder of m****@e******.com");
			expect(text).toContain("Nothing is waiting for you.");
		}
		const view = await h.service.statementFor(noteId);
		expect(view).toMatchObject({ ok: true, chain: { ok: true } });
	});

	test("a dispute with a counter-amount shows in both pages; the code page keeps the form's text safely", async () => {
		const { h, createViaApi, enter, get, post, csrfOf } = setup();
		const noteId = await createViaApi();
		const borrower = await enter(noteId, BORROWER_EMAIL);
		const borrowerCsrf = await csrfOf(noteId, borrower.cookie);
		await post(
			`/n/${noteId}/act`,
			{
				csrf: borrowerCsrf,
				type: "payment.recorded",
				kind: "payment",
				amount: "500",
				value_date: "2026-11-10",
			},
			borrower.cookie,
		);
		const lender = await enter(noteId, LENDER_EMAIL);
		const csrf = await csrfOf(noteId, lender.cookie);
		const target =
			/name="target" value="([^"]+)"/.exec(
				await (await get(`/n/${noteId}`, lender.cookie)).text(),
			)?.[1] ?? "";
		const reason = `"><script>alert(1)</script> & 'more'`;
		const form = {
			csrf,
			type: "payment.disputed",
			target,
			counter_amount: "450.00",
			reason,
		};
		const codePage = await post(`/n/${noteId}/act`, form, lender.cookie);
		const codeText = await codePage.text();
		expect(codeText).toContain("Enter your code");
		expect(codeText).not.toContain("<script>");
		expect(codeText).toContain(
			"&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt; &amp; &#39;more&#39;",
		);
		const done = await post(
			`/n/${noteId}/act`,
			{ ...form, code: h.mailer.codeFor(LENDER_EMAIL) },
			lender.cookie,
		);
		expect(done.status).toBe(303);
		for (const cookie of [borrower.cookie, lender.cookie]) {
			const text = await (await get(`/n/${noteId}`, cookie)).text();
			expect(text).toContain("<td>disputed</td>");
			expect(text).toContain("450.00 USD");
			expect(text).not.toContain("<script>");
			expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		}
		// The dispute needs the borrower, who recorded the payment: the page offers the agreed-amount form.
		const borrowerText = await (
			await get(`/n/${noteId}`, borrower.cookie)
		).text();
		expect(borrowerText).toContain("Agree this amount");
	});

	test("amounts with more decimals than the note allows, or not numbers, are refused with a message", async () => {
		const { createViaApi, enter, post, csrfOf } = setup();
		const noteId = await createViaApi();
		const { cookie } = await enter(noteId, BORROWER_EMAIL);
		const csrf = await csrfOf(noteId, cookie);
		for (const amount of ["10.005", "ten", "-5", "1e3", ""]) {
			const response = await post(
				`/n/${noteId}/act`,
				{
					csrf,
					type: "payment.recorded",
					kind: "payment",
					amount,
					value_date: "2026-11-10",
				},
				cookie,
			);
			expect(response.status).toBe(422);
			expect(await response.text()).toContain("Enter an amount like 350.00.");
		}
	});

	test("a borrower cannot post a lender-only event, and no form can set entered_by, seq, id, via or agent_ref", async () => {
		const { h, createViaApi, enter, post, csrfOf } = setup();
		const noteId = await createViaApi();
		const { cookie } = await enter(noteId, BORROWER_EMAIL);
		const csrf = await csrfOf(noteId, cookie);
		for (const type of [
			"release.confirmed",
			"payoff.issued",
			"notice.sent",
			"approval.granted",
		]) {
			const response = await post(`/n/${noteId}/act`, { csrf, type }, cookie);
			expect(response.status).toBe(403);
			expect(await response.text()).toContain(`A guest cannot enter ${type}.`);
		}
		for (const field of [
			"entered_by",
			"seq",
			"id",
			"via",
			"agent_ref",
			"note_id",
			"entered_at",
		]) {
			const response = await post(
				`/n/${noteId}/act`,
				{ csrf, type: "annotation.added", text: "x", [field]: "lender" },
				cookie,
			);
			expect(response.status).toBe(403);
			expect(await response.text()).toContain("is set by the server");
		}
		expect(
			(await post(`/n/${noteId}/act`, { csrf, type: "terms.accepted" }, cookie))
				.status,
		).toBe(200);
		const lender = await enter(noteId, LENDER_EMAIL);
		const lenderCsrf = await csrfOf(noteId, lender.cookie);
		expect(
			(
				await post(
					`/n/${noteId}/act`,
					{ csrf: lenderCsrf, type: "terms.declined" },
					lender.cookie,
				)
			).status,
		).toBe(403);
		expect((await h.store.readLog(noteId)).events).toHaveLength(1);
	});

	test("the code route sends a new code for step-up actions only", async () => {
		const { h, createViaApi, enter, post, csrfOf } = setup();
		const noteId = await createViaApi();
		const { cookie } = await enter(noteId, BORROWER_EMAIL);
		const csrf = await csrfOf(noteId, cookie);
		const sent = h.mailer.sent.length;
		const response = await post(
			`/n/${noteId}/code`,
			{ csrf, type: "terms.accepted" },
			cookie,
		);
		expect(response.status).toBe(200);
		expect(await response.text()).toContain("We emailed you a new code.");
		expect(h.mailer.sent.length).toBe(sent + 1);
		expect(
			(
				await post(
					`/n/${noteId}/code`,
					{ csrf, type: "payment.recorded" },
					cookie,
				)
			).status,
		).toBe(400);
		expect(h.mailer.sent.length).toBe(sent + 1);
		let last = 200;
		for (let index = 0; index < 5; index += 1)
			last = (
				await post(
					`/n/${noteId}/code`,
					{ csrf, type: "terms.accepted" },
					cookie,
				)
			).status;
		expect(last).toBe(429);
	});
});

describe("what the pages say", () => {
	test("an annotation with markup is shown inert, and no page carries script, inline style or a claim word", async () => {
		const { h, createViaApi, enter, get, post, csrfOf } = setup();
		const noteId = await createViaApi();
		const borrower = await enter(noteId, BORROWER_EMAIL);
		const csrf = await csrfOf(noteId, borrower.cookie);
		const attack = `<img src=x onerror=alert(1)> <a href="javascript:alert(2)">x</a>`;
		expect(
			(
				await post(
					`/n/${noteId}/act`,
					{ csrf, type: "annotation.added", text: attack },
					borrower.cookie,
				)
			).status,
		).toBe(303);
		const lender = await enter(noteId, LENDER_EMAIL);
		const pages = [
			await (await get(`/n/${noteId}`, borrower.cookie)).text(),
			await (await get(`/n/${noteId}`, lender.cookie)).text(),
			await (await get(`/n/${noteId}/enter?t=abc`)).text(),
			await (await get(`/n/${noteId}`)).text(),
			await (await post(`/n/${noteId}/enter`, { t: "bad" })).text(),
			await (
				await post(`/n/${noteId}/link`, { email: "x@example.com" })
			).text(),
			await (
				await post(
					`/n/${noteId}/act`,
					{ csrf, type: "terms.accepted" },
					borrower.cookie,
				)
			).text(),
		];
		expect(pages[0]).toContain("&lt;img src=x onerror=alert(1)&gt;");
		expect(pages[0]).not.toContain("<img");
		expect(pages[0]).toContain(
			"&lt;a href=&quot;javascript:alert(2)&quot;&gt;",
		);
		expect(pages[1]).toContain("&lt;img src=x onerror=alert(1)&gt;");
		for (const text of pages) {
			expect(text).not.toMatch(/<script|<img|\sstyle="|<[^>]*\son[a-z]+=/i);
			expect(text).not.toMatch(CLAIM_WORDS);
			expect(text).not.toMatch(SIGNATURE_WORDS);
			expect(text).toContain("A record, not legal or tax advice.");
			expect(text).toContain('<meta name="referrer" content="no-referrer">');
		}
		expect(pages[0]).toContain("installments");
		expect(h.mailer.sent.length).toBeGreaterThan(0);
	});

	test("every page response carries the CSP, no-store and no-referrer; the stylesheet is served from this host", async () => {
		const { createViaApi, get, ledger } = setup();
		const noteId = await createViaApi();
		for (const response of [
			await get(`/n/${noteId}`),
			await get(`/n/${noteId}/enter?t=x`),
			await ledger("/n/assets/notes.css"),
		]) {
			expect(response.headers.get("Cache-Control")).toBe("no-store");
		}
		const pageResponse = await get(`/n/${noteId}/enter?t=x`);
		expect(pageResponse.headers.get("Content-Security-Policy")).toBe(
			"default-src 'none'; style-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
		);
		expect(pageResponse.headers.get("Referrer-Policy")).toBe("no-referrer");
		const css = await ledger("/n/assets/notes.css");
		expect(css.status).toBe(200);
		expect(css.headers.get("Content-Type")).toContain("text/css");
		expect(await (await get(`/n/${noteId}/enter?t=x`)).text()).toContain(
			'href="/n/assets/notes.css"',
		);
	});

	test("the note page shows both counts side by side, the schedule, the difference and the record check", async () => {
		const { createViaApi, enter, get } = setup();
		const noteId = await createViaApi();
		const { cookie } = await enter(noteId, BORROWER_EMAIL);
		const text = await (await get(`/n/${noteId}`, cookie)).text();
		for (const expected of [
			"Lender's count",
			"Borrower's count (you)",
			"10,000.00 USD",
			"5%",
			"4 monthly installments from 2026-12-01",
			"Record check: 1 entry",
			"proposed, waiting for the borrower",
			"Closed: no",
		]) {
			expect(text).toContain(expected);
		}
		expect(text).toContain('<section class="balance you"');
	});
});

describe("staging only", () => {
	const production = (): ReturnType<typeof notesEnv> =>
		notesEnv({ ENVIRONMENT: "production" });

	test("outside staging every notes path is a 404", async () => {
		const env = production();
		const h = harness();
		const deps = {
			store: h.store,
			mailer: h.mailer,
			clock: h.clock,
			ids: h.ids,
		};
		const asks: [string, RequestInit?][] = [
			[`https://${LEDGER}/n/nt_abcdefgh0000`],
			[`https://${LEDGER}/n/nt_abcdefgh0000/enter?t=x`],
			[`https://${LEDGER}/n/assets/notes.css`],
			[
				`https://${API}/v1/notes`,
				{
					method: "POST",
					headers: { Authorization: `Bearer ${API_KEY}` },
					body: "{}",
				},
			],
			[
				`https://${API}/v1/notes/nt_abcdefgh0000/statement`,
				{ headers: { Authorization: `Bearer ${API_KEY}` } },
			],
		];
		for (const [url, init] of asks) {
			expect(
				(await notesRoute(new Request(url, init), env, deps))?.status,
			).toBe(404);
			expect((await worker.fetch(new Request(url, init), env)).status).toBe(
				404,
			);
		}
	});

	test("paths it does not own fall through, and so do other methods and the wrong host", async () => {
		const env = notesEnv();
		const own = (url: string, init?: RequestInit) =>
			notesRoute(new Request(url, init), env);
		expect(await own(`https://${LEDGER}/healthz`)).toBeNull();
		expect(await own(`https://${LEDGER}/billing/plans`)).toBeNull();
		expect(await own(`https://${LEDGER}/n/short`)).toBeNull();
		expect(await own(`https://${API}/n/nt_abcdefgh0000`)).toBeNull();
		expect(
			await own(`https://${LEDGER}/v1/notes`, { method: "POST" }),
		).toBeNull();
		expect(await own(`https://${API}/v1/notes`)).toBeNull();
		expect(await own("https://evil.example/n/nt_abcdefgh0000")).toBeNull();
		expect(await own(`https://${LEDGER}/n/nt_abcdefgh0000/link`)).toBeNull();
		expect(
			await own(`https://${LEDGER}/n/assets/notes.css`, { method: "POST" }),
		).toBeNull();
	});

	test("through the Worker the notes routes work on staging, with the no-referrer policy intact", async () => {
		resetHealthCache();
		const env = { ...notesEnv(), ...fakeEnv({}, pem) };
		const withNotes = {
			...env,
			NOTES_SESSION_SECRET: SECRET,
			NOTES_API_KEY: API_KEY,
			NOTE: notesEnv().NOTE,
		};
		const css = await worker.fetch(
			new Request(`https://${LEDGER}/n/assets/notes.css`),
			withNotes,
		);
		expect(css.status).toBe(200);
		const page = await worker.fetch(
			new Request(`https://${LEDGER}/n/nt_abcdefgh0000/enter?t=x`),
			withNotes,
		);
		expect(page.status).toBe(200);
		expect(page.headers.get("Referrer-Policy")).toBe("no-referrer");
		expect(page.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(page.headers.get("Strict-Transport-Security")).toBe(
			"max-age=63072000; includeSubDomains",
		);
		const other = await worker.fetch(
			new Request(`https://${LEDGER}/nope`),
			withNotes,
		);
		expect(other.headers.get("Referrer-Policy")).toBe(
			"strict-origin-when-cross-origin",
		);
	});
});

describe("through the Durable Object store", () => {
	test("create, sign in, accept, pay and read back with every call going to a NoteDO", async () => {
		const h = harness();
		const env = notesEnv();
		const deps: NotesDeps = { mailer: h.mailer, clock: h.clock, ids: h.ids };
		const call = async (url: string, init?: RequestInit) => {
			const response = await notesRoute(new Request(url, init), env, deps);
			if (!response) throw new Error("not handled");
			return response;
		};
		const created = await call(`https://${API}/v1/notes`, {
			method: "POST",
			headers: { Authorization: `Bearer ${API_KEY}` },
			body: JSON.stringify({
				terms: TERMS,
				lender_email: LENDER_EMAIL,
				borrower_email: BORROWER_EMAIL,
				idem: "do-1",
			}),
		});
		expect(created.status).toBe(201);
		const { note_id: noteId } = (await created.json()) as { note_id: string };
		const token = h.mailer.linkTokenFor(BORROWER_EMAIL);
		const entered = await call(`https://${LEDGER}/n/${noteId}/enter`, {
			method: "POST",
			body: new URLSearchParams({ t: token }),
		});
		expect(entered.status).toBe(303);
		const cookie =
			/__Secure-tf_note=([^;]+)/.exec(
				entered.headers.get("Set-Cookie") ?? "",
			)?.[1] ?? "";
		const headers = { Cookie: `${COOKIE_NAME}=${cookie}` };
		const page = await (
			await call(`https://${LEDGER}/n/${noteId}`, { headers })
		).text();
		const csrf = CSRF_FIELD.exec(page)?.[1] ?? "";
		const posted = await call(`https://${LEDGER}/n/${noteId}/act`, {
			method: "POST",
			headers,
			body: new URLSearchParams({
				csrf,
				type: "payment.recorded",
				kind: "payment",
				amount: "250.00",
				value_date: "2026-11-10",
			}),
		});
		expect(posted.status).toBe(303);
		const statement = await call(
			`https://${API}/v1/notes/${noteId}/statement`,
			{ headers: { Authorization: `Bearer ${API_KEY}` } },
		);
		const json = (await statement.json()) as {
			statement: { borrower: { paid_minor: string } };
			chain: unknown;
		};
		expect(json.statement.borrower.paid_minor).toBe("25000");
		expect(json.chain).toEqual({ ok: true });
		// A second use of the link fails in the Durable Object too.
		const again = await call(`https://${LEDGER}/n/${noteId}/enter`, {
			method: "POST",
			body: new URLSearchParams({ t: token }),
		});
		expect(again.status).toBe(400);
	});
});
