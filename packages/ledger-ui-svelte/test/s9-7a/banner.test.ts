import { afterEach, describe, expect, test } from "bun:test";
import { flushSync } from "svelte";
import { ledgerTokenAnswer } from "../../../ledger-ui/test/s8e/recorded.ts";
import { click, query, queryAll, textOf, until } from "../app-harness.ts";
import {
	demoId,
	demoRow,
	noSchool,
	openHttp,
	restoreFetch,
	schoolId,
	signedIn,
	signedOut,
	webBase,
} from "./support.ts";

/** The HTTP build on a page with no B4 Uni session, as `test/s8/demo-when-signed-out.test.ts` of the Preact package
 * drives it: the ledger token answers 401, the Worker's `GET /v1/schools` is read with no bearer, and the visitor sees
 * its demo schools (S8-contract section 11 "Demo schools") under a large alert that says they are demo scenarios,
 * read-only, and links to sign in, never an empty page. An account with no school (404) sees them with its own words.
 * Where the Worker lists no demo school (production) a signed-out visitor gets the app's message; any other failure
 * is not hidden behind the demo. */
let unmount: (() => Promise<void>) | null = null;
afterEach(async () => {
	await unmount?.();
	unmount = null;
	restoreFetch();
	document.body.innerHTML = "";
	window.location.hash = "";
});
const open = async (...args: Parameters<typeof openHttp>) => {
	const page = await openHttp(...args);
	unmount = page.app.unmount;
	return page;
};
const alertText = () => textOf("[data-test=demo-banner]");

describe("signed out", () => {
	test("the Worker's demo schools, read with no bearer, under a large alert with Sign in", async () => {
		const { seen } = await open(signedOut());
		const alert = query("[data-test=demo-banner]");
		expect(alert?.getAttribute("role")).toBe("alert");
		expect(alert?.getAttribute("aria-label")).toBe("Demo data");
		expect(alertText()).toContain("Demo data");
		expect(alertText()).toContain(
			"You are not signed in, so these are demo scenarios: fictional schools, read-only. Sign in to B4 Uni to see your own school's books.",
		);
		expect(textOf("[data-test=demo-banner-not-saved]")).toBe(
			"Demo schools are read-only: nothing here can be changed.",
		);
		expect(query<HTMLAnchorElement>("[data-test=sign-in]")?.href).toBe(
			`${webBase}/signin`,
		);
		expect(
			seen.find(({ url }) => url.endsWith("/v1/schools"))?.bearer,
		).toBeNull();
		// The app behind the alert is on the demo school, on its Dashboard, not an empty page.
		expect(query("[data-test=pane]")).not.toBeNull();
		expect(textOf("[data-test=school-name]")).toBe("Demo · Monthly members");
		expect(window.location.hash).toStartWith(`#/${demoId}/dashboard`);
	});

	test("the token is asked once, and the demo reads do not wait for it", async () => {
		const { seen } = await open(signedOut());
		expect(
			seen.filter(({ url }) => url.endsWith("/school-admin/ledger-token")),
		).toHaveLength(1);
		const first = seen.findIndex(({ url }) => url.endsWith("/v1/schools"));
		expect(first).toBeGreaterThanOrEqual(0);
		expect(
			seen
				.filter(({ url }) => url.includes("/v1/"))
				.every(({ bearer }) => bearer === null),
		).toBe(true);
	});

	test("the alert has a Hide button, folds to a pill that says Sign in, and opens again", async () => {
		await open(signedOut());
		const hide = query<HTMLButtonElement>(
			"[data-test=demo-banner] button[aria-label='Fold the demo alert']",
		);
		expect(hide?.textContent?.trim()).toBe("Hide");
		hide?.click();
		flushSync();
		await until(
			() => query("[data-test=demo-banner-folded]") !== null,
			"the pill",
		);
		expect(query("[data-test=demo-banner]")).toBeNull();
		const pill = query<HTMLButtonElement>("[data-test=demo-banner-folded]");
		expect(pill?.textContent?.trim()).toBe("Demo data · Sign in");
		// Focus follows the fold: the pill has it, so a keyboard user is not left on a button that is gone.
		await until(() => document.activeElement === pill, "focus on the pill");
		pill?.click();
		flushSync();
		await until(
			() => query("[data-test=demo-banner]") !== null,
			"the alert again",
		);
		expect(query("[data-test=demo-banner-folded]")).toBeNull();
		await until(
			() => document.activeElement?.textContent?.trim() === "Hide",
			"focus on Hide",
		);
	});

	test("'I have signed in' forgets the 401 and loads the page again", async () => {
		const { root, reloads } = await open(signedOut());
		const button = queryAll("[data-test=demo-banner] button").find(
			(candidate) => candidate.textContent?.trim() === "I have signed in",
		);
		expect(button).toBeDefined();
		button?.click();
		flushSync();
		expect(reloads.count).toBe(1);
		expect(root.contains(button as HTMLElement)).toBe(true);
	});

	test("the switcher lists the demo schools in their own group", async () => {
		await open(signedOut());
		query("[data-test=school-switcher]")?.click();
		await until(
			() => query("[data-test=demo-schools]") !== null,
			"the Demo group",
		);
		const group = query("[data-test=demo-schools]");
		expect(group?.getAttribute("role")).toBe("group");
		expect(group?.getAttribute("aria-label")).toBe("Demo");
		expect(
			[...(group?.querySelectorAll("[data-test=school-option]") ?? [])].map(
				(option) => option.getAttribute("data-school"),
			),
		).toEqual([demoId]);
	});
});

describe("an account with no school", () => {
	test("sees the demo schools with its own words, no Sign in, and a Reload button", async () => {
		const { reloads } = await open(noSchool());
		expect(alertText()).toContain(
			"This account is not an owner or admin of any school, so these are demo scenarios: fictional schools, read-only.",
		);
		expect(alertText()).not.toContain("You are not signed in");
		expect(query("[data-test=sign-in]")).toBeNull();
		const button = queryAll("[data-test=demo-banner] button").find(
			(candidate) => candidate.textContent?.trim() === "Reload",
		);
		button?.click();
		flushSync();
		expect(reloads.count).toBe(1);
		expect(alertText()).not.toContain("I have signed in");
	});
});

describe("not the demo", () => {
	test("signed in: no alert, and the person's own school is listed", async () => {
		await open(signedIn(), `#/${schoolId}/plans`);
		expect(query("[data-test=demo-banner]")).toBeNull();
		expect(query("[data-test=demo-banner-folded]")).toBeNull();
		expect(window.location.hash).toStartWith(`#/${schoolId}/`);
	});

	test("signed out where the Worker lists no demo school: no alert, the app's message with Retry", async () => {
		await open(signedOut(null), "", "failure");
		expect(query("[data-test=demo-banner]")).toBeNull();
		expect(query("[data-test=load-failed]")?.getAttribute("data-kind")).toBe(
			"unauthenticated",
		);
		expect(query("[data-test=load-retry]")).not.toBeNull();
	});

	test("any other failure is not hidden behind the demo: a toast with Retry, and the message stays", async () => {
		const page = await open(
			{
				token: { status: 500, body: { error: "internal" } },
				demoRows: [],
			},
			"",
			"failure",
		);
		expect(query("[data-test=demo-banner]")).toBeNull();
		expect(query("[data-test=load-failed]")?.getAttribute("data-kind")).toBe(
			"server",
		);
		const errors = page.app.toasts.state.visible.filter(
			(toast) => toast.tone === "error",
		);
		expect(errors).toHaveLength(1);
		expect(errors[0]?.action?.label).toBe("Retry");
	});
});

test("Try again after a failure asks the token again, and the alert follows what the retry finds", async () => {
	const backends = {
		token: { status: 500, body: { error: "internal" } },
		demoRows: [demoRow],
	};
	const page = await open(backends, "", "failure");
	expect(query("[data-test=demo-banner]")).toBeNull();
	// The person signs out meanwhile, or the 500 clears: the retry finds a 401, and the demo schools come with their alert.
	backends.token = { status: 401, body: { error: "unauthenticated" } };
	click("[data-test=load-retry]");
	await until(() => query("[data-test=demo-banner]") !== null, "the alert");
	await until(() => page.root.dataset.route !== undefined, "the route");
	expect(textOf("[data-test=school-name]")).toBe("Demo · Monthly members");
	// The failure's toast left with the retry that fixed it (the stub's "no data yet" for the Plans read is another).
	expect(
		page.app.toasts.state.visible.filter((toast) => toast.tone === "error"),
	).toEqual([]);
});

test("a token answer the page cannot read is the app's message, not the demo", async () => {
	const page = await open(
		{
			token: { status: 200, body: { ...ledgerTokenAnswer(), schools: "x" } },
			demoRows: [],
		},
		"",
		"failure",
	);
	expect(query("[data-test=demo-banner]")).toBeNull();
	expect(query("[data-test=load-failed]")?.getAttribute("data-kind")).toBe(
		"schema_mismatch",
	);
	void page;
});
