import { afterEach, expect, test } from "bun:test";
import { render } from "preact";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { createFixtureWriter } from "../../src/fixtures/writer.ts";
import { mountHttpApp } from "../../src/http/browser.ts";
import { clock } from "../s5/helpers.ts";

/**
 * The HTTP build on a page with no B4 Uni session: the ledger token answers 401, and the visitor sees the demo schools
 * (the fixtures) under a large alert that says so and links to sign in, never an empty page. An account with no school
 * (404) sees the demo with its own words; any other failure is not hidden behind the demo.
 */
const browserFetch = globalThis.fetch;
let root: HTMLElement | null = null;
afterEach(() => {
	globalThis.fetch = browserFetch;
	if (root) render(null, root);
	document.body.innerHTML = "";
	root = null;
});

const tick = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));
const settle = async (): Promise<void> => {
	for (let attempt = 0; attempt < 60; attempt += 1) await tick();
};

const mountAnswering = async (
	status: number,
	code: string,
): Promise<HTMLElement> => {
	globalThis.fetch = (async () =>
		new Response(JSON.stringify({ error: { code, message: code } }), {
			status,
			headers: { "content-type": "application/json" },
		})) as unknown as typeof fetch;
	root = document.createElement("div");
	document.body.append(root);
	mountHttpApp(root, {
		apiBase: "https://api-staging.b4uni.com",
		workerBase: "https://ledger-staging.b4uni.com/v1",
		webBase: "https://staging.b4uni.com",
		demo: () => ({
			reader: createFixtureReader({ clock }),
			writer: createFixtureWriter({ mode: "instant" }),
			clock,
		}),
	});
	await settle();
	return root;
};

test("signed out: the demo schools under a large alert with Sign in", async () => {
	const page = await mountAnswering(401, "unauthenticated");
	const alert = page.querySelector("[data-test=demo-banner]");
	expect(alert?.textContent).toContain("Demo data");
	expect(alert?.textContent).toContain("You are not signed in");
	expect(alert?.textContent).toContain("Changes here are not saved.");
	expect(
		page.querySelector<HTMLAnchorElement>("[data-test=sign-in]")?.href,
	).toBe("https://staging.b4uni.com/signin");
	// The app behind the alert is the fixtures' app: its pane is on screen, not an empty page.
	expect(page.querySelector("[data-test=pane]")).not.toBeNull();
});

test("the alert folds to a pill and opens again", async () => {
	const page = await mountAnswering(401, "unauthenticated");
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

test("an account with no school sees the demo with its own words and no Sign in", async () => {
	const page = await mountAnswering(404, "not_found");
	const alert = page.querySelector("[data-test=demo-banner]");
	expect(alert?.textContent).toContain("not an owner or admin of any school");
	expect(page.querySelector("[data-test=sign-in]")).toBeNull();
});

test("any other failure is not hidden behind the demo: the app offers Try again", async () => {
	const page = await mountAnswering(500, "internal");
	expect(page.querySelector("[data-test=demo-banner]")).toBeNull();
	expect(page.textContent).toContain("Could not load your schools.");
});
