import { beforeAll, describe, expect, test } from "bun:test";
import { verifyNoteBundle, verifyNoteDocument } from "tfd-verify-notes";
import { MemoryNoteStore } from "../src/notes/memory-store";
import { type NotesDeps, notesRoute } from "../src/notes/routes";
import type { StoredDocument } from "../src/notes/store";
import {
	API,
	API_KEY,
	BORROWER_EMAIL,
	HOUR,
	harness,
	LEDGER,
	LENDER_EMAIL,
	notesEnv,
	TERMS,
} from "./notes-fakes";
import { type TestSigning, testSigning } from "./notes-signers";

const BANNED =
	/\b(proof|enforceable|binding|tamper-proof|legally|credit|interest-free)\b/i;
const CSRF_FIELD = /name="csrf" value="([^"]+)"/;
const COOKIE_PREFIX = "__Host-tf_note_";
const NOTE_IN_PATH = /^\/n\/([^/?]+)/;

/** The one cookie name of the note a path belongs to. */
const cookieNameFor = (path: string): string => {
	const noteId = NOTE_IN_PATH.exec(path)?.[1];
	if (noteId === undefined) throw new Error(`no note in ${path}`);
	return `${COOKIE_PREFIX}${noteId}`;
};
const DOC_LINK = /href="\/n\/[^/"]+\/docs\/([A-Za-z0-9_-]+)"/;
const COOLING_MS = 2 * HOUR;

let signing: TestSigning;
beforeAll(async () => {
	signing = await testSigning();
});

const setup = (
	options: {
		signers?: NotesDeps["signers"];
		env?: Parameters<typeof notesEnv>[0];
	} = {},
) => {
	const store = new MemoryNoteStore();
	const h = harness({ store });
	const env = notesEnv(options.env ?? {});
	const deps: NotesDeps = {
		store,
		mailer: h.mailer,
		clock: h.clock,
		ids: h.ids,
		signers: options.signers === undefined ? signing.signers : options.signers,
		options: { releaseCoolingMs: COOLING_MS },
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
		return ((await response.json()) as { note_id: string }).note_id;
	};
	const post = (
		path: string,
		fields: Record<string, string>,
		cookie?: string,
	) =>
		ledger(path, {
			method: "POST",
			body: new URLSearchParams(fields),
			headers: cookie ? { Cookie: `${cookieNameFor(path)}=${cookie}` } : {},
		});
	const get = (path: string, cookie?: string) =>
		ledger(path, {
			headers: cookie ? { Cookie: `${cookieNameFor(path)}=${cookie}` } : {},
		});
	const enter = async (noteId: string, email: string): Promise<string> => {
		const token = h.mailer.linkTokenFor(email);
		const response = await post(`/n/${noteId}/enter`, { t: token });
		const cookie = new RegExp(`${cookieNameFor(`/n/${noteId}`)}=([^;]+)`).exec(
			response.headers.get("Set-Cookie") ?? "",
		)?.[1];
		if (!cookie) throw new Error("no cookie");
		return cookie;
	};
	const csrfOf = async (noteId: string, cookie: string): Promise<string> => {
		const text = await (await get(`/n/${noteId}`, cookie)).text();
		const token = CSRF_FIELD.exec(text)?.[1];
		if (!token) throw new Error("no csrf token on the page");
		return token;
	};
	/** A note both parties have entered, with one payment the lender confirmed. */
	const paidNote = async (idem = "idem-1") => {
		const noteId = await createViaApi(idem);
		const lender = await enter(noteId, LENDER_EMAIL);
		const borrower = await enter(noteId, BORROWER_EMAIL);
		const borrowerCsrf = await csrfOf(noteId, borrower);
		const lenderCsrf = await csrfOf(noteId, lender);
		await post(
			`/n/${noteId}/act`,
			{ csrf: borrowerCsrf, type: "terms.accepted" },
			borrower,
		);
		const accepted = await post(
			`/n/${noteId}/act`,
			{
				csrf: borrowerCsrf,
				type: "terms.accepted",
				code: h.mailer.codeFor(BORROWER_EMAIL),
			},
			borrower,
		);
		expect(accepted.status).toBe(303);
		await post(
			`/n/${noteId}/act`,
			{
				csrf: borrowerCsrf,
				type: "payment.recorded",
				kind: "payment",
				amount: "1000.00",
				value_date: "2026-11-10",
			},
			borrower,
		);
		const events = (await store.readLog(noteId)).events;
		const paymentId = (JSON.parse(events.at(-1) as string) as { id: string })
			.id;
		await post(
			`/n/${noteId}/act`,
			{ csrf: lenderCsrf, type: "payment.confirmed", target: paymentId },
			lender,
		);
		return { noteId, lender, borrower, lenderCsrf, borrowerCsrf, paymentId };
	};
	return {
		h,
		store,
		env,
		deps,
		ledger,
		api,
		bearer,
		post,
		get,
		paidNote,
		createViaApi,
		enter,
		csrfOf,
	};
};

const docIdFrom = (location: string | null): string => {
	const id = /\/docs\/([A-Za-z0-9_-]+)$/.exec(location ?? "")?.[1];
	if (!id) throw new Error(`no document in ${location}`);
	return id;
};

describe("documents over HTTP", () => {
	test("a payoff statement: the form, the readable page, the JSON file, and the file verifies offline", async () => {
		const t = setup();
		const { noteId, lender, lenderCsrf, borrower } = await t.paidNote();
		const lenderPage = await (await t.get(`/n/${noteId}`, lender)).text();
		expect(lenderPage).toContain("Payoff statement");
		expect(lenderPage).toContain(`action="/n/${noteId}/payoff"`);
		expect(lenderPage).toContain('name="as_of" value="2026-11-22"');
		const borrowerPage = await (await t.get(`/n/${noteId}`, borrower)).text();
		expect(borrowerPage).not.toContain(`/n/${noteId}/payoff`);
		expect(borrowerPage).not.toContain(`/n/${noteId}/notice`);

		const issued = await t.post(
			`/n/${noteId}/payoff`,
			{ csrf: lenderCsrf, as_of: "2026-11-22" },
			lender,
		);
		expect(issued.status).toBe(303);
		const docId = docIdFrom(issued.headers.get("Location"));

		const readable = await t.get(`/n/${noteId}/docs/${docId}`, borrower);
		expect(readable.status).toBe(200);
		expect(readable.headers.get("Cache-Control")).toBe("no-store");
		expect(readable.headers.get("Content-Security-Policy")).toContain(
			"default-src 'none'",
		);
		const text = await readable.text();
		expect(text).toContain("Payoff statement");
		expect(text).toContain("As of 2026-11-22.");
		expect(text).toContain("9,012.33 USD");
		expect(text).toContain(
			"Computed by tfd-notes from the recorded events. A record, not legal or tax advice.",
		);
		expect(text).toContain(`href="/n/${noteId}/docs/${docId}.json"`);
		expect(text).not.toMatch(BANNED);
		expect(text).not.toMatch(/<script|\sstyle="/i);

		const file = await t.get(`/n/${noteId}/docs/${docId}.json`, borrower);
		expect(file.status).toBe(200);
		expect(file.headers.get("Content-Type")).toBe("application/json");
		expect(file.headers.get("Content-Disposition")).toBe(
			`attachment; filename="note.payoff-statement-${docId}.json"`,
		);
		expect(file.headers.get("X-Content-Type-Options")).toBe("nosniff");
		expect(file.headers.get("Cache-Control")).toBe("no-store");
		const parsed: unknown = JSON.parse(await file.text());
		expect((await verifyNoteDocument(parsed, signing.keys)).ok).toBe(true);

		const notePage = await (await t.get(`/n/${noteId}`, borrower)).text();
		expect(notePage).toContain(`/n/${noteId}/docs/${docId}`);
		expect(notePage).toContain("Issued documents");
	});

	test("a payment row has a Receipt button that issues it once, then a link", async () => {
		const t = setup();
		const { noteId, borrower, borrowerCsrf, lender } = await t.paidNote();
		const before = await (await t.get(`/n/${noteId}`, borrower)).text();
		expect(before).toContain(`action="/n/${noteId}/receipt"`);
		const first = await t.post(
			`/n/${noteId}/receipt`,
			{ csrf: borrowerCsrf, event: (await paymentEvent(t, noteId)).id },
			borrower,
		);
		expect(first.status).toBe(303);
		const docId = docIdFrom(first.headers.get("Location"));
		const after = await (await t.get(`/n/${noteId}`, lender)).text();
		expect(after).not.toContain(`action="/n/${noteId}/receipt"`);
		expect(DOC_LINK.exec(after)?.[1]).toBe(docId);
		const page = await (
			await t.get(`/n/${noteId}/docs/${docId}`, lender)
		).text();
		expect(page).toContain("Payment receipt");
		expect(page).toContain("10,000.00 USD".replace("10,000", "1,000"));
		expect(page).toContain("confirmed by both parties");
		// The lender asks for the same payment: the same document.
		const second = await t.post(
			`/n/${noteId}/receipt`,
			{
				csrf: await t.csrfOf(noteId, lender),
				event: (await paymentEvent(t, noteId)).id,
			},
			lender,
		);
		expect(docIdFrom(second.headers.get("Location"))).toBe(docId);
		const bad = await t.post(
			`/n/${noteId}/receipt`,
			{ csrf: borrowerCsrf, event: "nope" },
			borrower,
		);
		expect(bad.status).toBe(400);
	});

	test("a document of another note is not served, and a document needs a session", async () => {
		const t = setup();
		const a = await t.paidNote("idem-a");
		const b = await t.paidNote("idem-b");
		const issued = await t.post(
			`/n/${a.noteId}/payoff`,
			{ csrf: a.lenderCsrf, as_of: "2026-11-22" },
			a.lender,
		);
		const docId = docIdFrom(issued.headers.get("Location"));
		expect((await t.get(`/n/${a.noteId}/docs/${docId}`, a.lender)).status).toBe(
			200,
		);
		for (const suffix of ["", ".json"]) {
			const other = await t.get(
				`/n/${b.noteId}/docs/${docId}${suffix}`,
				b.lender,
			);
			expect(other.status).toBe(404);
			// A's cookie does not open B's note at all.
			const crossed = await t.get(
				`/n/${b.noteId}/docs/${docId}${suffix}`,
				a.lender,
			);
			expect(crossed.status).toBe(401);
			const anonymous = await t.get(`/n/${a.noteId}/docs/${docId}${suffix}`);
			expect(anonymous.status).toBe(401);
			const missing = await t.get(
				`/n/${a.noteId}/docs/nope${suffix}`,
				a.lender,
			);
			expect(missing.status).toBe(404);
		}
		// Even a stored row that names another note is not served.
		await t.store.putDocumentOnce(b.noteId, {
			id: "foreign1",
			type: "note.payoff-statement",
			eventId: null,
			variant: "",
			sha256: "a".repeat(64),
			json: JSON.stringify({
				note_id: a.noteId,
				type: "note.payoff-statement",
			}),
			createdAt: "2026-11-22T09:00:00.000Z",
		});
		expect((await t.get(`/n/${b.noteId}/docs/foreign1`, b.lender)).status).toBe(
			404,
		);
	});

	test("the document page escapes everything it prints", async () => {
		const t = setup();
		const { noteId, lender } = await t.paidNote();
		const hostile = "<script>alert(1)</script><img src=x onerror=alert(2)>";
		const document: StoredDocument = {
			id: "hostile1",
			type: "note.payment-receipt",
			eventId: null,
			variant: "",
			sha256: "a".repeat(64),
			createdAt: "2026-11-22T09:00:00.000Z",
			json: JSON.stringify({
				note_id: noteId,
				type: "note.payment-receipt",
				kind: hostile,
				amount_minor: hostile,
				currency: hostile,
				exponent: 2,
				value_date: hostile,
				recorded_by: hostile,
				status: hostile,
				lender_payoff_minor: "-1250",
				borrower_payoff_minor: hostile,
				issued_at: hostile,
				signature: {
					key_id: hostile,
					purpose: hostile,
					alg: hostile,
					sig: "x",
				},
			}),
		};
		await t.store.putDocumentOnce(noteId, document);
		const response = await t.get(`/n/${noteId}/docs/hostile1`, lender);
		expect(response.status).toBe(200);
		const text = await response.text();
		expect(text).not.toMatch(/<script|<img/i);
		expect(text).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
		expect(text).toContain("-12.50");
		// An unknown type still renders, as a plain page.
		await t.store.putDocumentOnce(noteId, {
			...document,
			id: "odd1",
			json: JSON.stringify({ note_id: noteId, type: hostile }),
		});
		const odd = await (await t.get(`/n/${noteId}/docs/odd1`, lender)).text();
		expect(odd).not.toMatch(/<script|<img/i);
	});
});

const paymentEvent = async (
	t: ReturnType<typeof setup>,
	noteId: string,
): Promise<{ id: string }> => {
	for (const text of (await t.store.readLog(noteId)).events) {
		const event = JSON.parse(text) as { id: string; type: string };
		if (event.type === "payment.recorded") return event;
	}
	throw new Error("no payment");
};

describe("release over HTTP", () => {
	test("draft, a refusal inside the cooling-off, then the code and the banner on both pages", async () => {
		const t = setup();
		const { noteId, lender, borrower, lenderCsrf } = await t.paidNote();
		const drafted = await t.post(
			`/n/${noteId}/release`,
			{ csrf: lenderCsrf, step: "draft" },
			lender,
		);
		expect(drafted.status).toBe(303);
		expect(drafted.headers.get("Location")).toBe(
			`/n/${noteId}?m=release_drafted`,
		);
		const lenderPage = await (await t.get(`/n/${noteId}`, lender)).text();
		expect(lenderPage).toContain(
			"It can be confirmed from 2026-11-22 11:00 UTC.",
		);
		expect(lenderPage).toContain("Confirm the release");
		const borrowerPage = await (await t.get(`/n/${noteId}`, borrower)).text();
		expect(borrowerPage).toContain(
			"A release was drafted 2026-11-22 09:00 UTC.",
		);
		expect(borrowerPage).not.toContain("Confirm the release");
		expect(borrowerPage).not.toContain(
			"The lender states this note is released.",
		);

		const target = /name="target" value="([^"]+)"/.exec(lenderPage)?.[1] ?? "";
		expect(target).not.toBe("");
		const early = await t.post(
			`/n/${noteId}/release`,
			{ csrf: lenderCsrf, step: "confirm", target },
			lender,
		);
		expect(early.status).toBe(409);
		expect(await early.text()).toContain(
			"A release can be confirmed from 2026-11-22 11:00 UTC",
		);

		t.h.clock.advance(COOLING_MS);
		const askCode = await t.post(
			`/n/${noteId}/release`,
			{ csrf: lenderCsrf, step: "confirm", target },
			lender,
		);
		expect(askCode.status).toBe(200);
		const codeText = await askCode.text();
		expect(codeText).toContain("Enter your code");
		expect(codeText).toContain(`action="/n/${noteId}/release"`);
		expect(codeText).toContain(`name="target" value="${target}"`);
		const code = t.h.mailer.codeFor(LENDER_EMAIL);
		const wrong = code === "000000" ? "111111" : "000000";
		const refused = await t.post(
			`/n/${noteId}/release`,
			{ csrf: lenderCsrf, step: "confirm", target, code: wrong },
			lender,
		);
		expect(refused.status).toBe(403);
		const resend = await t.post(
			`/n/${noteId}/code`,
			{ csrf: lenderCsrf, type: "release.confirmed", step: "confirm", target },
			lender,
		);
		expect(resend.status).toBe(200);
		expect(await resend.text()).toContain(`action="/n/${noteId}/release"`);
		const fresh = t.h.mailer.codeFor(LENDER_EMAIL);
		const done = await t.post(
			`/n/${noteId}/release`,
			{ csrf: lenderCsrf, step: "confirm", target, code: fresh },
			lender,
		);
		expect(done.status).toBe(303);
		expect(done.headers.get("Location")).toBe(
			`/n/${noteId}?m=release_confirmed`,
		);

		for (const cookie of [lender, borrower]) {
			const page = await (await t.get(`/n/${noteId}`, cookie)).text();
			expect(page).toContain("The lender states this note is released.");
			expect(page).toContain("<h3>Lender's count");
			expect(page).toContain("<h3>Borrower's count");
			expect(page).toContain("Closed: yes");
			expect(page).not.toMatch(/paid in full/i);
			expect(page).toContain("A release changes no balance.");
			expect(page).toContain("Release</a>");
			expect(page).not.toMatch(BANNED);
		}
		const releaseLink =
			/href="\/n\/[^/"]+\/docs\/([A-Za-z0-9_-]+)">Release</.exec(
				await (await t.get(`/n/${noteId}`, borrower)).text(),
			)?.[1];
		expect(releaseLink).toBeDefined();
		const doc = await t.get(`/n/${noteId}/docs/${releaseLink}`, borrower);
		const text = await doc.text();
		expect(text).toContain("The lender states this note is released.");
		expect(text).toContain("while its own count was above zero");
	});

	test("a reversal after the release reopens the note and the page says so", async () => {
		const t = setup();
		const { noteId, lender, lenderCsrf, paymentId } = await t.paidNote();
		await t.post(
			`/n/${noteId}/release`,
			{ csrf: lenderCsrf, step: "draft" },
			lender,
		);
		const target =
			/name="target" value="([^"]+)"/.exec(
				await (await t.get(`/n/${noteId}`, lender)).text(),
			)?.[1] ?? "";
		t.h.clock.advance(COOLING_MS);
		await t.post(
			`/n/${noteId}/release`,
			{ csrf: lenderCsrf, step: "confirm", target },
			lender,
		);
		await t.post(
			`/n/${noteId}/release`,
			{
				csrf: lenderCsrf,
				step: "confirm",
				target,
				code: t.h.mailer.codeFor(LENDER_EMAIL),
			},
			lender,
		);
		expect(await (await t.get(`/n/${noteId}`, lender)).text()).toContain(
			"Closed: yes",
		);
		await t.post(
			`/n/${noteId}/act`,
			{
				csrf: lenderCsrf,
				type: "payment.recorded",
				kind: "reversal",
				amount: "1000.00",
				value_date: "2026-11-23",
				reverses: paymentId,
			},
			lender,
		);
		const page = await (await t.get(`/n/${noteId}`, lender)).text();
		expect(page).toContain("Closed: no");
		expect(page).toContain("A later reversal reopened this note");
		expect(page).not.toContain(
			"The lender states this note is released.</p>\n",
		);
	});
});

describe("notices and lender-only forms over HTTP", () => {
	test("a reminder mails the borrower; a default notice asks for a code first; the warning is on the form", async () => {
		const t = setup();
		const { noteId, lender, lenderCsrf } = await t.paidNote();
		const page = await (await t.get(`/n/${noteId}`, lender)).text();
		expect(page).toContain(
			"This records a notice. It does not change the balance.",
		);
		const reminder = await t.post(
			`/n/${noteId}/notice`,
			{ csrf: lenderCsrf, kind: "reminder", cure_days: "" },
			lender,
		);
		expect(reminder.status).toBe(303);
		expect(reminder.headers.get("Location")).toBe(`/n/${noteId}?m=notice_sent`);
		expect(t.h.mailer.to(BORROWER_EMAIL).at(-1)?.subject).toBe(
			"Your lender recorded a notice",
		);
		const ask = await t.post(
			`/n/${noteId}/notice`,
			{ csrf: lenderCsrf, kind: "default", cure_days: "14" },
			lender,
		);
		expect(ask.status).toBe(200);
		const askText = await ask.text();
		expect(askText).toContain("Enter your code");
		expect(askText).toContain(`action="/n/${noteId}/notice"`);
		expect(askText).toContain('name="cure_days" value="14"');
		const done = await t.post(
			`/n/${noteId}/notice`,
			{
				csrf: lenderCsrf,
				kind: "default",
				cure_days: "14",
				code: t.h.mailer.codeFor(LENDER_EMAIL),
			},
			lender,
		);
		expect(done.status).toBe(303);
		const after = await (await t.get(`/n/${noteId}`, lender)).text();
		expect(after).toContain("a default notice with 14 days to cure");
		expect(after).toContain("A notice changes no balance.");
		const bad = await t.post(
			`/n/${noteId}/notice`,
			{ csrf: lenderCsrf, kind: "default", cure_days: "9999" },
			lender,
		);
		expect(bad.status).toBe(400);
	});

	test("a borrower is refused on every lender form, and the generic act route still says a guest cannot enter them", async () => {
		const t = setup();
		const { noteId, borrower, borrowerCsrf } = await t.paidNote();
		const length = (await t.store.readLog(noteId)).events.length;
		for (const [path, fields] of [
			["payoff", { as_of: "2026-11-22" }],
			["release", { step: "draft" }],
			["release", { step: "confirm", target: "x" }],
			["notice", { kind: "reminder" }],
		] as const) {
			const response = await t.post(
				`/n/${noteId}/${path}`,
				{ csrf: borrowerCsrf, ...fields },
				borrower,
			);
			expect(response.status).toBe(403);
			expect(await response.text()).toContain("cannot enter");
		}
		const generic = await t.post(
			`/n/${noteId}/act`,
			{ csrf: borrowerCsrf, type: "payoff.issued" },
			borrower,
		);
		expect(generic.status).toBe(403);
		expect(await generic.text()).toContain(
			"A guest cannot enter payoff.issued.",
		);
		expect((await t.store.readLog(noteId)).events).toHaveLength(length);
	});

	test("the lender forms need a session and a CSRF token and refuse another site", async () => {
		const t = setup();
		const { noteId, lender, lenderCsrf } = await t.paidNote();
		for (const path of ["payoff", "release", "notice", "receipt"]) {
			expect(
				(await t.post(`/n/${noteId}/${path}`, { as_of: "2026-11-22" })).status,
			).toBe(401);
			expect(
				(await t.post(`/n/${noteId}/${path}`, { as_of: "2026-11-22" }, lender))
					.status,
			).toBe(403);
			const crossSite = await t.ledger(`/n/${noteId}/${path}`, {
				method: "POST",
				body: new URLSearchParams({ csrf: lenderCsrf, as_of: "2026-11-22" }),
				headers: {
					Cookie: `${cookieNameFor(`/n/${noteId}`)}=${lender}`,
					Origin: "https://evil.example",
				},
			});
			expect(crossSite.status).toBe(403);
		}
	});

	test("without signing keys a payoff answers 503 and writes nothing", async () => {
		const t = setup({ signers: null });
		const { noteId, lender, lenderCsrf } = await t.paidNote();
		const length = (await t.store.readLog(noteId)).events.length;
		const response = await t.post(
			`/n/${noteId}/payoff`,
			{ csrf: lenderCsrf, as_of: "2026-11-22" },
			lender,
		);
		expect(response.status).toBe(503);
		expect((await t.store.readLog(noteId)).events).toHaveLength(length);
	});
});

describe("the bundle", () => {
	test("the session file and the API route verify offline, and each needs its own auth", async () => {
		const t = setup();
		const { noteId, lender, lenderCsrf, borrower, borrowerCsrf, paymentId } =
			await t.paidNote();
		await t.post(
			`/n/${noteId}/payoff`,
			{ csrf: lenderCsrf, as_of: "2026-11-22" },
			lender,
		);
		await t.post(
			`/n/${noteId}/receipt`,
			{ csrf: borrowerCsrf, event: paymentId },
			borrower,
		);

		expect((await t.get(`/n/${noteId}/bundle.json`)).status).toBe(401);
		const file = await t.get(`/n/${noteId}/bundle.json`, borrower);
		expect(file.status).toBe(200);
		expect(file.headers.get("Content-Type")).toBe("application/json");
		expect(file.headers.get("Content-Disposition")).toContain("attachment");
		expect(file.headers.get("X-Content-Type-Options")).toBe("nosniff");
		const bundle = JSON.parse(await file.text()) as {
			events: unknown[];
			links: unknown[];
			documents: unknown[];
			seal: unknown;
		};
		expect(Object.keys(bundle).sort()).toEqual([
			"documents",
			"events",
			"links",
			"seal",
		]);
		expect(bundle.documents).toHaveLength(2);
		const fromFile = await verifyNoteBundle({
			events: bundle.events,
			links: bundle.links,
			documents: [...bundle.documents, bundle.seal],
			keys: signing.keys,
		});
		expect(fromFile.ok).toBe(true);

		expect((await t.api(`/v1/notes/${noteId}/bundle`)).status).toBe(401);
		expect(
			(
				await t.api(`/v1/notes/${noteId}/bundle`, {
					headers: { Authorization: "Bearer wrong" },
				})
			).status,
		).toBe(401);
		const viaApi = await t.api(`/v1/notes/${noteId}/bundle`, {
			headers: t.bearer,
		});
		expect(viaApi.status).toBe(200);
		expect(viaApi.headers.get("Content-Type")).toContain("application/json");
		const apiBundle = (await viaApi.json()) as typeof bundle;
		expect(apiBundle.events).toEqual(bundle.events);
		const fromApi = await verifyNoteBundle({
			events: apiBundle.events,
			links: apiBundle.links,
			documents: [...apiBundle.documents, apiBundle.seal],
			keys: signing.keys,
		});
		expect(fromApi.ok).toBe(true);
		expect(
			(
				await t.api("/v1/notes/nt_unknown_note_id/bundle", {
					headers: t.bearer,
				})
			).status,
		).toBe(404);
	});

	test("the seal route answers the signed seal for the current head", async () => {
		const t = setup();
		const { noteId, borrower } = await t.paidNote();
		expect((await t.get(`/n/${noteId}/seal.json`)).status).toBe(401);
		const viaSession = await t.get(`/n/${noteId}/seal.json`, borrower);
		expect(viaSession.status).toBe(200);
		const seal = (await viaSession.json()) as {
			type: string;
			head_seq: number;
			signature: { purpose: string };
		};
		expect(seal.type).toBe("note.chain-seal");
		expect(seal.signature.purpose).toBe("seal");
		expect((await verifyNoteDocument(seal, signing.keys)).ok).toBe(true);
		expect(seal.head_seq).toBe((await t.store.readLog(noteId)).events.length);
		const viaApi = await t.api(`/v1/notes/${noteId}/seal`, {
			headers: t.bearer,
		});
		expect(await viaApi.json()).toEqual(seal);
		expect((await t.api(`/v1/notes/${noteId}/seal`)).status).toBe(401);
	});

	test("outside staging none of the new routes exist", async () => {
		const t = setup({ env: { ENVIRONMENT: "production" } });
		for (const path of [
			"/n/nt_aaaaaaaaaaaaaaaa/docs/abc",
			"/n/nt_aaaaaaaaaaaaaaaa/docs/abc.json",
			"/n/nt_aaaaaaaaaaaaaaaa/bundle.json",
			"/n/nt_aaaaaaaaaaaaaaaa/seal.json",
		]) {
			expect((await t.get(path)).status).toBe(404);
		}
		expect(
			(
				await t.api("/v1/notes/nt_aaaaaaaaaaaaaaaa/bundle", {
					headers: t.bearer,
				})
			).status,
		).toBe(404);
	});
});

describe("a record that no longer matches its chain, in a browser", () => {
	test("an edited payment shows a failed record check and refuses to issue; an unreadable log is a 409 page", async () => {
		const t = setup();
		const { noteId, lender, lenderCsrf, paymentId } = await t.paidNote();
		const { events } = await t.store.readLog(noteId);
		const index = events.findIndex((text) => text.includes(paymentId));
		t.store.tamperEventForTest(
			noteId,
			index + 1,
			(events[index] as string).replace(
				'"amount_minor":"100000"',
				'"amount_minor":"1"',
			),
		);
		const page = await t.get(`/n/${noteId}`, lender);
		expect(page.status).toBe(200);
		expect(await page.text()).toContain(
			"Record check failed (event_hash_mismatch",
		);
		const refused = await t.post(
			`/n/${noteId}/payoff`,
			{ csrf: lenderCsrf, as_of: "2026-11-22" },
			lender,
		);
		expect(refused.status).toBe(409);
		expect(await refused.text()).toContain("Nothing was signed.");
		expect(await t.store.listDocuments(noteId)).toHaveLength(0);

		t.store.tamperEventForTest(noteId, 2, '{"type":"nonsense"}');
		const broken = await t.get(`/n/${noteId}`, lender);
		expect(broken.status).toBe(409);
		expect(await broken.text()).toContain("Record check failed");
	});
});
