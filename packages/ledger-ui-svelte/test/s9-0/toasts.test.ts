import { describe, expect, test } from "bun:test";
import {
	addToast,
	autoDismissMilliseconds,
	dismissToast,
	emptyToastState,
	maximumVisible,
	type ToastInput,
	type ToastState,
} from "../../src/effect/toast-model.ts";
import { toastRuntime, toastState } from "../helpers.ts";

const error = (title: string, detail?: string): ToastInput => ({
	tone: "error",
	title,
	...(detail ? { detail } : {}),
});
const success = (title: string): ToastInput => ({ tone: "success", title });
const fill = (inputs: ToastInput[]): ToastState =>
	inputs.reduce(
		(state, input) => addToast(state, input).state,
		emptyToastState,
	);

describe("the toast model", () => {
	test("identical messages merge into one with a count", () => {
		const state = fill([
			error("No connection", "The request got no answer."),
			error("No connection", "The request got no answer."),
			error("No connection", "The request got no answer."),
		]);
		expect(state.visible).toHaveLength(1);
		expect(state.visible[0]?.count).toBe(3);
	});
	test("the same title with another detail is another toast", () => {
		const state = fill([error("Not allowed", "a"), error("Not allowed", "b")]);
		expect(state.visible.map((toast) => toast.count)).toEqual([1, 1]);
	});
	test("at most four are on screen; the rest wait in order", () => {
		const state = fill(
			["a", "b", "c", "d", "e", "f"].map((title) => error(title)),
		);
		expect(maximumVisible).toBe(4);
		expect(state.visible.map((toast) => toast.title)).toEqual([
			"a",
			"b",
			"c",
			"d",
		]);
		expect(state.waiting.map((toast) => toast.title)).toEqual(["e", "f"]);
	});
	test("a waiting toast merges too", () => {
		const state = fill(
			["a", "b", "c", "d", "e", "e"].map((title) => error(title)),
		);
		expect(state.waiting).toHaveLength(1);
		expect(state.waiting[0]?.count).toBe(2);
	});
	test("dismissing one brings the oldest waiting one on screen", () => {
		const state = fill(
			["a", "b", "c", "d", "e", "f"].map((title) => error(title)),
		);
		const first = state.visible[0]?.id ?? "";
		const { state: next, promoted } = dismissToast(state, first);
		expect(next.visible.map((toast) => toast.title)).toEqual([
			"b",
			"c",
			"d",
			"e",
		]);
		expect(promoted.map((toast) => toast.title)).toEqual(["e"]);
		expect(next.waiting.map((toast) => toast.title)).toEqual(["f"]);
	});
});

describe("the Toasts service", () => {
	test("success and info leave after 5 s", async () => {
		const { clock, runtime, toasts } = toastRuntime();
		await runtime.runPromise(toasts.show(success("Saved")));
		await runtime.runPromise(toasts.show({ tone: "info", title: "Copied" }));
		await clock.advance(autoDismissMilliseconds - 1);
		expect(toastState(toasts).visible).toHaveLength(2);
		await clock.advance(1);
		expect(toastState(toasts).visible).toEqual([]);
	});
	test("errors and warnings stay until dismissed", async () => {
		const { clock, runtime, toasts } = toastRuntime();
		const id = await runtime.runPromise(toasts.show(error("Server failed")));
		await runtime.runPromise(
			toasts.show({ tone: "warning", title: "No data yet" }),
		);
		await clock.advance(60_000);
		expect(toastState(toasts).visible.map((toast) => toast.tone)).toEqual([
			"error",
			"warning",
		]);
		await runtime.runPromise(toasts.dismiss(id));
		expect(toastState(toasts).visible.map((toast) => toast.tone)).toEqual([
			"warning",
		]);
	});
	test("a sticky info toast stays", async () => {
		const { clock, runtime, toasts } = toastRuntime();
		await runtime.runPromise(
			toasts.show({ tone: "info", title: "Retrying", sticky: true }),
		);
		await clock.advance(60_000);
		expect(toastState(toasts).visible).toHaveLength(1);
	});
	test("a merged success starts its 5 s again", async () => {
		const { clock, runtime, toasts } = toastRuntime();
		await runtime.runPromise(toasts.show(success("Saved")));
		await clock.advance(4000);
		await runtime.runPromise(toasts.show(success("Saved")));
		await clock.advance(4000);
		expect(toastState(toasts).visible[0]?.count).toBe(2);
		await clock.advance(1000);
		expect(toastState(toasts).visible).toEqual([]);
	});
	test("a waiting success does not count down until it is on screen", async () => {
		const { clock, runtime, toasts } = toastRuntime();
		const errors: string[] = [];
		for (const title of ["a", "b", "c", "d"])
			errors.push(await runtime.runPromise(toasts.show(error(title))));
		await runtime.runPromise(toasts.show(success("Saved")));
		expect(toastState(toasts).waiting.map((toast) => toast.title)).toEqual([
			"Saved",
		]);
		await clock.advance(10_000);
		expect(toastState(toasts).waiting).toHaveLength(1);
		await runtime.runPromise(toasts.dismiss(errors[0] ?? ""));
		expect(toastState(toasts).visible.map((toast) => toast.title)).toContain(
			"Saved",
		);
		await clock.advance(autoDismissMilliseconds);
		expect(toastState(toasts).visible.map((toast) => toast.title)).toEqual([
			"b",
			"c",
			"d",
		]);
	});
	test("subscribers see every change, and stop when they unsubscribe", async () => {
		const { runtime, toasts } = toastRuntime();
		const seen: number[] = [];
		const stop = toasts.subscribe((state) => seen.push(state.visible.length));
		await runtime.runPromise(toasts.show(error("a")));
		stop();
		await runtime.runPromise(toasts.show(error("b")));
		expect(seen).toEqual([0, 1]);
	});
});

describe("toast owners", () => {
	test("identical messages merge only within one owner", () => {
		const first = {
			tone: "error",
			title: "No connection",
			owner: "read-a",
		} as const;
		const second = { ...first, owner: "read-b" };
		const state = fill([
			first,
			second,
			first,
			{ tone: "error", title: "No connection" },
		]);
		expect(state.visible.map((toast) => [toast.owner, toast.count])).toEqual([
			["read-a", 2],
			["read-b", 1],
			[undefined, 1],
		]);
	});
});
