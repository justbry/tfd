import { afterEach, expect, test } from "bun:test";
import { mountApp } from "../../src/app/mount.tsx";
import type { Reader } from "../../src/data/reader.ts";
import { createFixtureReader } from "../../src/fixtures/reader.ts";
import { createFixtureWriter } from "../../src/fixtures/writer.ts";
import { clock } from "../s5/helpers.ts";

/**
 * The HTTP build's first read is the schools list, minted from B4 Uni's session cookie. When it fails the app says why
 * and what to do (sign in, no school, try again), never a blank page: staging showed a blank page to a signed-out
 * visitor before.
 */
let unmount: (() => void) | null = null;
afterEach(() => {
	unmount?.();
	unmount = null;
	document.body.innerHTML = "";
});

const base = createFixtureReader({ clock });
const tick = (): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, 0));
const failing = (kind: string): Error & { kind: string } =>
	Object.assign(new Error(kind), { kind });

const mount = async (
	reader: Reader,
	signInUrl?: string,
): Promise<HTMLElement> => {
	const root = document.createElement("div");
	document.body.append(root);
	unmount = mountApp(root, {
		reader,
		writer: createFixtureWriter({ mode: "instant" }),
		clock,
		...(signInUrl ? { signInUrl } : {}),
	}).unmount;
	for (let attempt = 0; attempt < 10; attempt += 1) await tick();
	return root;
};

test("a signed-out visitor is asked to sign in, with a link to B4 Uni's sign-in page", async () => {
	const root = await mount(
		{ ...base, schools: () => Promise.reject(failing("unauthenticated")) },
		"https://staging.b4uni.com/signin",
	);
	const panel = root.querySelector("[data-test=signed-out]");
	expect(panel?.textContent).toContain("You are not signed in.");
	expect(
		root.querySelector<HTMLAnchorElement>("[data-test=sign-in]")?.href,
	).toBe("https://staging.b4uni.com/signin");
	expect(root.textContent?.trim()).not.toBe("");
});

test("an account with no school is told so", async () => {
	const root = await mount({
		...base,
		schools: () => Promise.reject(failing("not_found")),
	});
	expect(root.querySelector("[data-test=no-schools]")?.textContent).toContain(
		"not an owner or admin of any school",
	);
});

test("any other failure offers Try again, and Try again reads the schools again and opens the app", async () => {
	let calls = 0;
	const reader: Reader = {
		...base,
		schools: () => {
			calls += 1;
			return calls === 1
				? Promise.reject(failing("unavailable"))
				: base.schools();
		},
	};
	const root = await mount(reader);
	expect(root.textContent).toContain("Could not load your schools.");
	const retry = [...root.querySelectorAll("button")].find(
		(button) => button.textContent === "Try again",
	);
	retry?.click();
	for (let attempt = 0; attempt < 40; attempt += 1) await tick();
	expect(calls).toBe(2);
	expect(root.textContent).not.toContain("Could not load your schools.");
	expect(root.querySelector("[data-test=pane]")).not.toBeNull();
});
