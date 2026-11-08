import { describe, expect, test } from "bun:test";
import { AdapterError, type AdapterErrorKind } from "$contract/http/errors.ts";
import type { AppContext } from "../../src/app/context.ts";
import { retryingRead } from "../../src/app/retrying-read.ts";
import { ToastStore } from "../../src/app/toast-store.svelte.ts";
import { run } from "../../src/effect/run.ts";
import { until } from "../app-harness.ts";
import { calendar, fixtureRuntime, toastState } from "../helpers.ts";

/** Longer than the read retry's whole backoff (two waits of about 400 and 800 ms, each up to a fifth longer). */
const pastTheBackoff = 1600;
const wait = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

function readContext() {
	const { runtime, toasts } = fixtureRuntime();
	const context: AppContext = {
		root: document.createElement("div"),
		runtime,
		toasts: new ToastStore(toasts),
		calendar,
	};
	const shown = () => toastState(toasts).visible;
	return { context, toasts, shown };
}

/** A load that fails with `kinds` in turn, then answers "done" (or never answers, with `hang`); `calls` counts. */
function scriptedLoad(
	kinds: AdapterErrorKind[],
	options: { hang?: boolean } = {},
) {
	const counter = { calls: 0 };
	const load = () =>
		run(() => {
			counter.calls += 1;
			const kind = kinds[counter.calls - 1];
			if (kind) return Promise.reject(new AdapterError(kind, kind));
			return options.hang
				? new Promise<string>(() => undefined)
				: Promise.resolve("done");
		});
	return { counter, load };
}

const offline: AdapterErrorKind[] = ["network", "network", "network"];

describe("retryingRead: cancel interrupts the run", () => {
	test("cancelled during the backoff: the retry toast leaves at once and the reader is not called again", async () => {
		const { context, shown } = readContext();
		const { counter, load } = scriptedLoad([...offline, ...offline]);
		const reading = retryingRead(context, load, { value: () => undefined });
		const running = reading.run();
		await until(
			() => shown().some((toast) => toast.detail === "Retrying (2 of 3)"),
			"the retry toast",
		);
		const callsAtCancel = counter.calls;
		reading.cancel();
		await running;
		expect(shown()).toEqual([]);
		await wait(pastTheBackoff);
		expect(counter.calls).toBe(callsAtCancel);
		expect(shown()).toEqual([]);
	});
	test("cancelled while a try hangs: the run ends, nothing is shown, nothing is called again", async () => {
		const { context, shown } = readContext();
		const { counter, load } = scriptedLoad([], { hang: true });
		const reading = retryingRead(context, load, { value: () => undefined });
		const running = reading.run();
		await until(() => counter.calls === 1, "the hung call");
		reading.cancel();
		await running;
		await wait(50);
		expect(counter.calls).toBe(1);
		expect(shown()).toEqual([]);
	});
	test("an old read cancelled leaves the new read's identical retry toast alone", async () => {
		const { context, shown } = readContext();
		const old = retryingRead(
			context,
			scriptedLoad([...offline, ...offline]).load,
			{
				value: () => undefined,
			},
		);
		const fresh = retryingRead(
			context,
			scriptedLoad([...offline, ...offline]).load,
			{
				value: () => undefined,
			},
		);
		const oldRun = old.run();
		const freshRun = fresh.run();
		await until(
			() =>
				shown().filter((toast) => toast.detail === "Retrying (2 of 3)")
					.length === 2,
			"both retry toasts",
		);
		old.cancel();
		await oldRun;
		expect(shown().map((toast) => toast.detail)).toEqual(["Retrying (2 of 3)"]);
		fresh.cancel();
		await freshRun;
	});
	test("a cancel that lands just as the failure is reported still takes that toast down", async () => {
		const { context, toasts, shown } = readContext();
		const { load } = scriptedLoad(["not_found"]);
		const reading = retryingRead(context, load, { value: () => undefined });
		const stop = toasts.subscribe((state) => {
			if (state.visible.length > 0) reading.cancel();
		});
		await reading.run();
		stop();
		await wait(10);
		expect(shown()).toEqual([]);
	});
	test("a Retry from a cancelled read's toast does nothing", async () => {
		const { context } = readContext();
		const { counter, load } = scriptedLoad(["not_found", "not_found"]);
		const reading = retryingRead(context, load, { value: () => undefined });
		await reading.run();
		reading.cancel();
		await reading.run();
		expect(counter.calls).toBe(1);
	});
});

describe("retryingRead: owners", () => {
	test("two reads failing the same way keep two toasts; the first to recover takes down only its own", async () => {
		const { context, shown } = readContext();
		const first = scriptedLoad(["not_found"]);
		const second = scriptedLoad(["not_found", "not_found"]);
		const firstRead = retryingRead(context, first.load, {
			value: () => undefined,
		});
		const secondRead = retryingRead(context, second.load, {
			value: () => undefined,
		});
		await firstRead.run();
		await secondRead.run();
		expect(shown().map((toast) => toast.title)).toEqual([
			"Not found",
			"Not found",
		]);
		const secondToast = shown()[1]?.id ?? "missing";
		await firstRead.run();
		await wait(10);
		expect(shown().map((toast) => toast.id)).toEqual([secondToast]);
	});
});

describe("retryingRead: one failure, one toast", () => {
	test("a Retry shows its progress in the failure toast, and a repeat failure merges back into it", async () => {
		const { context, shown } = readContext();
		const { load } = scriptedLoad([...offline, ...offline]);
		const reading = retryingRead(context, load, { value: () => undefined });
		await reading.run();
		expect(shown()).toHaveLength(1);
		const failure = shown()[0];
		const failureDetail = "The request got no answer.";
		expect(failure?.detail).toBe(failureDetail);
		const retrying = reading.run();
		await until(
			() => shown()[0]?.detail === "Retrying (2 of 3)",
			"the progress in the failure toast",
		);
		expect(shown()).toHaveLength(1);
		expect(shown()[0]?.id).toBe(failure?.id);
		await retrying;
		await wait(10);
		expect(shown()).toHaveLength(1);
		expect(shown()[0]).toMatchObject({
			id: failure?.id,
			detail: failureDetail,
			count: 2,
		});
	});
});
