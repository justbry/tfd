import { afterEach, describe, expect, test } from "bun:test";
import { flushSync, mount, unmount } from "svelte";
import { ToastStore } from "../../src/app/toast-store.svelte.ts";
import InlineError from "../../src/app/toasts/InlineError.svelte";
import Toaster from "../../src/app/toasts/Toaster.svelte";
import { queryAll, textOf, until } from "../app-harness.ts";
import { toastRuntime } from "../helpers.ts";

let cleanup: (() => void) | undefined;
afterEach(() => {
	cleanup?.();
	cleanup = undefined;
});

function renderToaster() {
	document.body.innerHTML = '<div id="target"></div>';
	const { runtime, toasts, clock } = toastRuntime();
	const store = new ToastStore(toasts);
	const component = mount(Toaster, {
		target: document.getElementById("target") as HTMLElement,
		props: { store, anchor: null },
	});
	cleanup = () => {
		unmount(component);
		store.close();
	};
	return { runtime, toasts, store, clock };
}

describe("the toaster", () => {
	test("is a labelled region above dialogs, on its usual edge", () => {
		renderToaster();
		const region = document.querySelector("[data-test=toasts]");
		expect(region?.getAttribute("aria-label")).toBe("Notifications");
		expect(region?.className).toContain("z-(--layer-toast)");
		expect(region?.getAttribute("data-edge")).toBe("usual");
	});
	test("it moves off the focused control only while a toast covers it", async () => {
		const { runtime, toasts } = renderToaster();
		const control = document.createElement("button");
		control.getBoundingClientRect = () =>
			({
				left: 900,
				right: 1000,
				top: 0,
				bottom: 100,
				width: 100,
				height: 100,
			}) as DOMRect;
		document.body.append(control);
		control.focus();
		flushSync();
		const region = document.querySelector("[data-test=toasts]");
		expect(region?.getAttribute("data-edge")).toBe("usual");
		const id = await runtime.runPromise(
			toasts.show({ tone: "error", title: "Server failed" }),
		);
		flushSync();
		expect(region?.getAttribute("data-edge")).toBe("other");
		await runtime.runPromise(toasts.dismiss(id));
		flushSync();
		expect(region?.getAttribute("data-edge")).toBe("usual");
		await runtime.runPromise(toasts.show({ tone: "error", title: "Again" }));
		control.blur();
		flushSync();
		expect(region?.getAttribute("data-edge")).toBe("usual");
	});
	test("two live regions exist at mount: an alert for errors, a status for the rest", async () => {
		const { runtime, toasts } = renderToaster();
		const assertive = document.querySelector("[data-test=toasts-assertive]");
		const polite = document.querySelector("[data-test=toasts-polite]");
		expect(assertive?.getAttribute("role")).toBe("alert");
		expect(polite?.getAttribute("role")).toBe("status");
		await runtime.runPromise(
			toasts.show({
				tone: "error",
				title: "Server failed",
				detail: "Something went wrong on our side.",
			}),
		);
		await runtime.runPromise(toasts.show({ tone: "success", title: "Saved" }));
		flushSync();
		expect(document.querySelector("[data-test=toasts-assertive]")).toBe(
			assertive,
		);
		expect(textOf("[data-test=toasts-assertive]")).toBe(
			"Server failed. Something went wrong on our side.",
		);
		expect(textOf("[data-test=toasts-polite]")).toBe("Saved");
		const visibleRoles = queryAll("[data-test=toast]").map((toast) =>
			toast.getAttribute("role"),
		);
		expect(visibleRoles).toEqual([null, null]);
	});
	test("a merge is announced again with its count", async () => {
		const { runtime, toasts } = renderToaster();
		await runtime.runPromise(
			toasts.show({ tone: "error", title: "No connection" }),
		);
		flushSync();
		const first = document.querySelector("[data-test=toasts-assertive] p");
		await runtime.runPromise(
			toasts.show({ tone: "error", title: "No connection" }),
		);
		flushSync();
		const second = document.querySelector("[data-test=toasts-assertive] p");
		expect(second).not.toBe(first);
		expect(second?.textContent).toBe("No connection. 2 times");
	});
	test("merged messages show their count", async () => {
		const { runtime, toasts } = renderToaster();
		for (let index = 0; index < 3; index += 1)
			await runtime.runPromise(
				toasts.show({ tone: "error", title: "No connection" }),
			);
		flushSync();
		expect(textOf("[data-test=toast-count]")).toBe("×3");
		expect(
			document
				.querySelector("[data-test=toast-count]")
				?.getAttribute("aria-label"),
		).toBe("3 times");
	});
	test("the action runs and the toast leaves; Dismiss is a named button", async () => {
		const { runtime, toasts } = renderToaster();
		let retried = 0;
		await runtime.runPromise(
			toasts.show({
				tone: "error",
				title: "The ledger is catching up",
				action: {
					label: "Retry",
					run: () => {
						retried += 1;
					},
				},
			}),
		);
		await runtime.runPromise(
			toasts.show({ tone: "warning", title: "No data yet" }),
		);
		flushSync();
		const action = document.querySelector<HTMLButtonElement>(
			"[data-test=toast-action]",
		);
		expect(action?.tagName).toBe("BUTTON");
		action?.click();
		await until(
			() => queryAll("[data-test=toast]").length === 1,
			"the toast to leave",
		);
		expect(retried).toBe(1);
		const dismiss = document.querySelector<HTMLButtonElement>(
			"[data-test=toast-dismiss]",
		);
		expect(dismiss?.getAttribute("aria-label")).toBe("Dismiss: No data yet");
		dismiss?.click();
		await until(
			() => queryAll("[data-test=toast]").length === 0,
			"the dismissal",
		);
	});
	test("a fifth message waits, and says so", async () => {
		const { runtime, toasts } = renderToaster();
		for (const title of ["a", "b", "c", "d", "e"])
			await runtime.runPromise(toasts.show({ tone: "error", title }));
		flushSync();
		expect(queryAll("[data-test=toast]")).toHaveLength(4);
		expect(textOf("[data-test=toasts-waiting]")).toBe("1 more waiting");
	});
	test("a success leaves after 5 s on the toast clock", async () => {
		const { runtime, toasts, clock } = renderToaster();
		await runtime.runPromise(toasts.show({ tone: "success", title: "Saved" }));
		flushSync();
		expect(queryAll("[data-test=toast]")).toHaveLength(1);
		await clock.advance(5000);
		flushSync();
		expect(queryAll("[data-test=toast]")).toHaveLength(0);
	});
});

describe("the inline error", () => {
	test("shows each field problem with its hint, and nothing when there is none", () => {
		document.body.innerHTML = '<div id="target"></div>';
		const target = document.getElementById("target") as HTMLElement;
		const shown = mount(InlineError, {
			target,
			props: {
				id: "email-problem",
				problems: [
					{
						path: "contact.email",
						message: "Not an email address.",
						hint: "Like name@school.org.",
					},
				],
			},
		});
		flushSync();
		expect(textOf("#email-problem")).toBe(
			"Not an email address. Like name@school.org.",
		);
		expect(
			document.getElementById("email-problem")?.getAttribute("aria-live"),
		).toBe("polite");
		unmount(shown);
		const empty = mount(InlineError, {
			target,
			props: { id: "none", problems: null },
		});
		flushSync();
		expect(textOf("#none")).toBe("");
		unmount(empty);
	});
});
