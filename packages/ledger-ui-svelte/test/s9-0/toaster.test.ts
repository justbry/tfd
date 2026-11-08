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

function renderToaster(options: { frame?: HTMLElement } = {}) {
	document.body.innerHTML = '<div id="target"></div>';
	if (options.frame) document.body.append(options.frame);
	const { runtime, toasts, clock } = toastRuntime();
	const store = new ToastStore(toasts);
	const component = mount(Toaster, {
		target: document.getElementById("target") as HTMLElement,
		props: { store, anchor: null, frame: options.frame ?? null },
	});
	// Runs the toaster's mount effects (its focus listeners) before the test moves focus.
	flushSync();
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
		expect(textOf("[data-test=toasts-polite]")).toBe("Saved.");
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
		expect(second?.textContent).toBe("No connection. 2 times.");
	});
	test("merged messages show their count", async () => {
		const { runtime, toasts } = renderToaster();
		for (let index = 0; index < 3; index += 1)
			await runtime.runPromise(
				toasts.show({ tone: "error", title: "No connection" }),
			);
		flushSync();
		const count = document.querySelector("[data-test=toast-count]");
		expect(count?.querySelector('[aria-hidden="true"]')?.textContent).toBe(
			"×3",
		);
		expect(count?.querySelector(".sr-only")?.textContent).toBe("3 times");
		expect(count?.hasAttribute("aria-label")).toBe(false);
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

describe("the toaster and focus", () => {
	test("a toast that leaves from its own button gives focus back to the control that had it", async () => {
		const { runtime, toasts } = renderToaster();
		const before = document.createElement("button");
		before.textContent = "Save";
		document.body.append(before);
		before.focus();
		await runtime.runPromise(
			toasts.show({ tone: "error", title: "Server failed" }),
		);
		flushSync();
		const dismiss = document.querySelector<HTMLButtonElement>(
			"[data-test=toast-dismiss]",
		);
		// Another control in between, so that happy-dom's own refocus (to whatever had focus last) is not `before`.
		const between = document.createElement("button");
		document.querySelector("[data-test=toasts]")?.append(between);
		between.focus();
		dismiss?.focus();
		expect(document.activeElement).toBe(dismiss);
		dismiss?.click();
		await until(
			() => queryAll("[data-test=toast]").length === 0,
			"the toast to leave",
		);
		expect(document.activeElement).toBe(before);
	});
	test("with nothing to go back to, focus goes to the next toast's Dismiss", async () => {
		const { runtime, toasts } = renderToaster();
		await runtime.runPromise(toasts.show({ tone: "error", title: "First" }));
		await runtime.runPromise(toasts.show({ tone: "error", title: "Second" }));
		flushSync();
		const [first, second] = queryAll("[data-test=toast-dismiss]");
		first?.focus();
		first?.click();
		await until(
			() => queryAll("[data-test=toast]").length === 1,
			"the first toast to leave",
		);
		expect(document.activeElement === second).toBe(true);
	});
	test("an action that keeps its toast leaves it on screen", async () => {
		const { runtime, toasts } = renderToaster();
		let runs = 0;
		await runtime.runPromise(
			toasts.show({
				tone: "error",
				title: "No connection",
				action: {
					label: "Retry",
					keep: true,
					run: () => {
						runs += 1;
					},
				},
			}),
		);
		flushSync();
		document
			.querySelector<HTMLButtonElement>("[data-test=toast-action]")
			?.click();
		await new Promise((resolve) => setTimeout(resolve, 10));
		flushSync();
		expect(runs).toBe(1);
		expect(queryAll("[data-test=toast]")).toHaveLength(1);
	});
});

describe("focus when a toast leaves without a click", () => {
	/** Focus on a toast's Dismiss after `before` had it, and after another toast's Dismiss had it in between: happy-dom
	 * gives a removed element's focus back to whatever had it last (that other Dismiss), where a browser drops it on
	 * the body, so the test passes only when the toaster itself sends focus to `before`. Returns the toast's id. */
	async function focusIntoToast(
		rendered: ReturnType<typeof renderToaster>,
		tone: "error" | "success",
		before?: HTMLElement,
	): Promise<string> {
		await rendered.runtime.runPromise(
			rendered.toasts.show({ tone: "error", title: "Other" }),
		);
		const id = await rendered.runtime.runPromise(
			rendered.toasts.show({
				tone,
				title: tone === "error" ? "Server failed" : "Saved",
			}),
		);
		flushSync();
		before?.focus();
		const [other, dismiss] = queryAll("[data-test=toast-dismiss]");
		other?.focus();
		dismiss?.focus();
		expect(document.activeElement === dismiss).toBe(true);
		return id;
	}
	const outsideButton = (): HTMLButtonElement => {
		const button = document.createElement("button");
		button.textContent = "Save";
		document.body.append(button);
		return button;
	};

	test("taken down by the read it reported (settle): focus goes back to the control that had it", async () => {
		const rendered = renderToaster();
		const before = outsideButton();
		const id = await focusIntoToast(rendered, "error", before);
		await rendered.runtime.runPromise(rendered.toasts.dismiss(id));
		flushSync();
		expect(document.activeElement).toBe(before);
	});
	test("taken down by its timer: focus goes back to the control that had it", async () => {
		const rendered = renderToaster();
		const before = outsideButton();
		await focusIntoToast(rendered, "success", before);
		await rendered.clock.advance(5000);
		flushSync();
		expect(queryAll("[data-test=toast]")).toHaveLength(1);
		expect(document.activeElement).toBe(before);
	});
	test("with nothing before and no other toast, focus goes to the stack's sentinel, never the frame", async () => {
		const frame = document.createElement("div");
		const rendered = renderToaster({ frame });
		const id = await rendered.runtime.runPromise(
			rendered.toasts.show({ tone: "error", title: "Server failed" }),
		);
		flushSync();
		document
			.querySelector<HTMLButtonElement>("[data-test=toast-dismiss]")
			?.focus();
		await rendered.runtime.runPromise(rendered.toasts.dismiss(id));
		flushSync();
		expect(document.activeElement).toBe(
			document.querySelector("[data-test=toasts-sentinel]"),
		);
		expect(frame.hasAttribute("tabindex")).toBe(false);
	});
	test("the body is never the control to come back to", async () => {
		const rendered = renderToaster();
		document.body.tabIndex = -1;
		document.body.focus();
		const id = await rendered.runtime.runPromise(
			rendered.toasts.show({ tone: "error", title: "Server failed" }),
		);
		flushSync();
		document
			.querySelector<HTMLButtonElement>("[data-test=toast-dismiss]")
			?.focus();
		await rendered.runtime.runPromise(rendered.toasts.dismiss(id));
		flushSync();
		document.body.removeAttribute("tabindex");
		expect(document.activeElement).toBe(
			document.querySelector("[data-test=toasts-sentinel]"),
		);
	});
	test("a control that cannot take focus back (disabled meanwhile) passes to the next toast's Dismiss", async () => {
		const rendered = renderToaster();
		const before = outsideButton();
		before.focus();
		await rendered.runtime.runPromise(
			rendered.toasts.show({ tone: "error", title: "Other" }),
		);
		const id = await rendered.runtime.runPromise(
			rendered.toasts.show({ tone: "error", title: "Server failed" }),
		);
		flushSync();
		before.disabled = true;
		// Another control in between, so that happy-dom's own refocus (to whatever had focus last) is not the answer.
		const between = document.createElement("button");
		document.querySelector("[data-test=toasts]")?.append(between);
		between.focus();
		const [other, dismiss] = queryAll("[data-test=toast-dismiss]");
		dismiss?.focus();
		await rendered.runtime.runPromise(rendered.toasts.dismiss(id));
		flushSync();
		expect(document.activeElement === other).toBe(true);
	});
});

describe("the stack's place while the frame or the sentinel holds focus", () => {
	const coveringFrame = (): HTMLElement => {
		const frame = document.createElement("div");
		frame.getBoundingClientRect = () =>
			({
				left: 0,
				top: 0,
				right: 1024,
				bottom: 768,
				width: 1024,
				height: 768,
			}) as DOMRect;
		return frame;
	};
	test("after focus falls back inside the stack, a new toast stays on its usual edge", async () => {
		const rendered = renderToaster({ frame: coveringFrame() });
		const id = await rendered.runtime.runPromise(
			rendered.toasts.show({ tone: "error", title: "Server failed" }),
		);
		flushSync();
		document
			.querySelector<HTMLButtonElement>("[data-test=toast-dismiss]")
			?.focus();
		await rendered.runtime.runPromise(rendered.toasts.dismiss(id));
		flushSync();
		await rendered.runtime.runPromise(
			rendered.toasts.show({ tone: "error", title: "Again" }),
		);
		flushSync();
		expect(
			document.querySelector("[data-test=toasts]")?.getAttribute("data-edge"),
		).toBe("usual");
	});
	test("the frame taking focus (a click on blank space) does not send the stack away", async () => {
		const frame = coveringFrame();
		const rendered = renderToaster({ frame });
		frame.tabIndex = -1;
		frame.focus();
		await rendered.runtime.runPromise(
			rendered.toasts.show({ tone: "error", title: "Server failed" }),
		);
		flushSync();
		expect(
			document.querySelector("[data-test=toasts]")?.getAttribute("data-edge"),
		).toBe("usual");
	});
});

describe("announcements", () => {
	test("progress is announced politely, step by step; the failure sentence only on appearance and on a merge", async () => {
		const rendered = renderToaster();
		const failure = {
			tone: "error",
			title: "No connection",
			detail: "The request got no answer.",
		} as const;
		const id = await rendered.runtime.runPromise(rendered.toasts.show(failure));
		flushSync();
		const assertive = () =>
			document.querySelector("[data-test=toasts-assertive] p");
		const polite = () => document.querySelector("[data-test=toasts-polite] p");
		const sentence = assertive();
		expect(sentence?.textContent).toBe(
			"No connection. The request got no answer.",
		);
		await rendered.runtime.runPromise(
			rendered.toasts.update(id, { progress: "Retrying (2 of 3)" }),
		);
		flushSync();
		expect(assertive()).toBe(sentence);
		expect(assertive()?.textContent).toBe(
			"No connection. The request got no answer.",
		);
		const firstStep = polite();
		expect(firstStep?.textContent).toBe("No connection. Retrying (2 of 3).");
		await rendered.runtime.runPromise(
			rendered.toasts.update(id, { progress: "Retrying (3 of 3)" }),
		);
		flushSync();
		expect(polite()).not.toBe(firstStep);
		expect(polite()?.textContent).toBe("No connection. Retrying (3 of 3).");
		expect(assertive()).toBe(sentence);
		await rendered.runtime.runPromise(
			rendered.toasts.update(id, { progress: "" }),
		);
		flushSync();
		expect(polite()).toBeNull();
		expect(assertive()).toBe(sentence);
		await rendered.runtime.runPromise(rendered.toasts.show(failure));
		flushSync();
		expect(assertive()).not.toBe(sentence);
		expect(assertive()?.textContent).toBe(
			"No connection. The request got no answer. 2 times.",
		);
	});
});

describe("a busy toast", () => {
	test("its action says so and does nothing until the run ends", async () => {
		const rendered = renderToaster();
		let runs = 0;
		const id = await rendered.runtime.runPromise(
			rendered.toasts.show({
				tone: "error",
				title: "No connection",
				action: {
					label: "Retry",
					keep: true,
					run: () => {
						runs += 1;
					},
				},
			}),
		);
		await rendered.runtime.runPromise(
			rendered.toasts.update(id, { busy: true }),
		);
		flushSync();
		const action = document.querySelector<HTMLButtonElement>(
			"[data-test=toast-action]",
		);
		expect(action?.getAttribute("aria-busy")).toBe("true");
		expect(action?.getAttribute("aria-disabled")).toBe("true");
		action?.click();
		expect(runs).toBe(0);
		await rendered.runtime.runPromise(
			rendered.toasts.update(id, { busy: false }),
		);
		flushSync();
		expect(action?.hasAttribute("aria-busy")).toBe(false);
		action?.click();
		expect(runs).toBe(1);
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
