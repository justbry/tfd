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
		props: { store },
	});
	cleanup = () => {
		unmount(component);
		store.close();
	};
	return { runtime, toasts, store, clock };
}

describe("the toaster", () => {
	test("is a labelled region above dialogs", () => {
		renderToaster();
		const region = document.querySelector("[data-test=toasts]");
		expect(region?.getAttribute("aria-label")).toBe("Notifications");
		expect(region?.className).toContain("z-(--layer-toast)");
	});
	test("an error is an alert; the rest are status", async () => {
		const { runtime, toasts } = renderToaster();
		await runtime.runPromise(
			toasts.show({ tone: "error", title: "Server failed" }),
		);
		await runtime.runPromise(toasts.show({ tone: "success", title: "Saved" }));
		flushSync();
		const roles = queryAll("[data-test=toast]").map((toast) => [
			toast.dataset.tone,
			toast.getAttribute("role"),
			toast.getAttribute("aria-live"),
		]);
		expect(roles).toEqual([
			["error", "alert", "assertive"],
			["success", "status", "polite"],
		]);
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
