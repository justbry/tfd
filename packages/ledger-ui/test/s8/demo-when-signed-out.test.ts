import { afterEach, expect, test } from "bun:test";
import { render } from "preact";
import { mountHttpApp } from "../../src/http/browser.ts";

/**
 * The HTTP build on a page with no B4 Uni session: the ledger token answers 401, the Worker's `GET /v1/schools` is read
 * with no bearer, and the visitor sees its demo schools (S8-contract section 11 "Demo schools") under a large alert that
 * says they are demo scenarios, read-only, and links to sign in, never an empty page. An account with no school (404)
 * sees them with its own words. Where the Worker lists no demo school (production: 401 without a token), a signed-out
 * visitor is asked to sign in; any other failure is not hidden behind the demo. The real Worker's side is
 * `test/worker-e2e/demo-schools.test.ts`.
 */
const browserFetch = globalThis.fetch;
let root: HTMLElement | null = null;
afterEach(() => {
	globalThis.fetch = browserFetch;
	if (root) render(null, root);
	document.body.innerHTML = "";
	window.location.hash = "";
	root = null;
});

const tick = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
	for (let attempt = 0; attempt < 60; attempt += 1) await tick();
};

const workerBase = "https://ledger-staging.b4uni.com/v1";
const answer = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
const demoRow = {
	id: "demo-monthly-members",
	asOf: "2026-11-05T12:00:00Z",
	lagMinutes: 3,
	stale: false,
	demo: true,
	name: "Demo · Monthly members",
	timeZone: "America/Denver",
	currency: "USD",
	creditUnit: { one: "class", other: "classes" },
};

/** buzz-school answers every route `tokenStatus`; the Worker lists `demoRows` to a request with no bearer. */
const mountAnswering = async (
	tokenStatus: number,
	code: string,
	demoRows: unknown[] | null = [demoRow],
): Promise<{ page: HTMLElement; bearers: (string | null)[] }> => {
	const bearers: (string | null)[] = [];
	globalThis.fetch = (async (url: string, init: RequestInit = {}) => {
		if (!String(url).startsWith(workerBase))
			return answer({ error: code }, tokenStatus);
		const bearer =
			(init.headers as Record<string, string> | undefined)?.authorization ??
			null;
		bearers.push(bearer);
		if (String(url) === `${workerBase}/schools` && demoRows !== null)
			return answer({
				asOf: null,
				lagMinutes: null,
				data: { schools: demoRows },
			});
		return answer(
			{
				error: {
					code: "token_missing",
					message: "A bearer token is required.",
				},
			},
			401,
		);
	}) as unknown as typeof fetch;
	root = document.createElement("div");
	document.body.append(root);
	mountHttpApp(root, {
		apiBase: "https://api-staging.b4uni.com",
		workerBase,
		webBase: "https://staging.b4uni.com",
	});
	await settle();
	return { page: root, bearers };
};

test("signed out: the Worker's demo schools, read with no bearer, under a large alert with Sign in", async () => {
	const { page, bearers } = await mountAnswering(401, "unauthenticated");
	const alert = page.querySelector("[data-test=demo-banner]");
	expect(alert?.textContent).toContain("Demo data");
	expect(alert?.textContent).toContain("You are not signed in");
	expect(alert?.textContent).toContain("demo scenarios");
	expect(alert?.textContent).toContain("read-only");
	expect(
		page.querySelector<HTMLAnchorElement>("[data-test=sign-in]")?.href,
	).toBe("https://staging.b4uni.com/signin");
	expect(bearers[0]).toBeNull();
	// The app behind the alert is on the demo school, not an empty page.
	expect(page.querySelector("[data-test=pane]")).not.toBeNull();
	expect(page.textContent).toContain("Demo · Monthly members");
});

test("the alert folds to a pill and opens again", async () => {
	const { page } = await mountAnswering(401, "unauthenticated");
	[...page.querySelectorAll("button")]
		.find((button) => button.textContent === "Hide")
		?.click();
	await settle();
	expect(page.querySelector("[data-test=demo-banner]")).toBeNull();
	const pill = page.querySelector<HTMLButtonElement>(
		"[data-test=demo-banner-folded]",
	);
	expect(pill?.textContent).toBe("Demo data · Sign in");
	pill?.click();
	await settle();
	expect(page.querySelector("[data-test=demo-banner]")).not.toBeNull();
});

test("an account with no school sees the demo schools with its own words and no Sign in", async () => {
	const { page } = await mountAnswering(404, "not_found");
	const alert = page.querySelector("[data-test=demo-banner]");
	expect(alert?.textContent).toContain("not an owner or admin of any school");
	expect(alert?.textContent).toContain("demo scenarios");
	expect(page.querySelector("[data-test=sign-in]")).toBeNull();
});

test("signed out where the Worker lists no demo school: the sign-in prompt, no alert", async () => {
	const { page } = await mountAnswering(401, "unauthenticated", null);
	expect(page.querySelector("[data-test=demo-banner]")).toBeNull();
	expect(page.querySelector("[data-test=signed-out]")).not.toBeNull();
});

test("any other failure is not hidden behind the demo: the app offers Try again", async () => {
	const { page } = await mountAnswering(500, "internal");
	expect(page.querySelector("[data-test=demo-banner]")).toBeNull();
	expect(page.textContent).toContain("Could not load your schools.");
});

test("signed out: the demo schools and the demo school's disclosure are read while the token's 401 is on its way, and the token is asked once", async () => {
	const events: string[] = [];
	let answerToken: () => void = () => undefined;
	globalThis.fetch = (async (url: string) => {
		const path = String(url).replace(workerBase, "/v1");
		events.push(`start ${path}`);
		if (!String(url).startsWith(workerBase)) {
			await new Promise<void>((resolve) => {
				answerToken = resolve;
			});
			events.push("token answered");
			return answer({ error: "unauthenticated" }, 401);
		}
		if (path === "/v1/schools")
			return answer({
				asOf: null,
				lagMinutes: null,
				data: { schools: [demoRow] },
			});
		return answer({ error: { code: "no_data", message: "none" } }, 404);
	}) as unknown as typeof fetch;
	window.location.hash = "#/demo-monthly-members/dashboard";
	root = document.createElement("div");
	document.body.append(root);
	mountHttpApp(root, {
		apiBase: "https://api-staging.b4uni.com",
		workerBase,
		webBase: "https://staging.b4uni.com",
	});
	await settle();
	// The token has not answered yet, and both Worker reads have started.
	expect(events).toContain("start /v1/schools");
	expect(events).toContain("start /v1/schools/demo-monthly-members/disclosure");
	expect(events).not.toContain("token answered");
	answerToken();
	await settle();
	expect(
		events.filter((event) => event.endsWith("/school-admin/ledger-token")),
	).toHaveLength(1);
	expect(root.querySelector("[data-test=demo-banner]")).not.toBeNull();
});
