import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AdapterError, type AdapterErrorKind } from "$contract/http/errors.ts";
import type { AppContext } from "../../src/app/context.ts";
import { retryingRead } from "../../src/app/retrying-read.ts";
import { ToastStore } from "../../src/app/toast-store.svelte.ts";
import { run } from "../../src/effect/run.ts";
import { Toasts as ToastsService } from "../../src/effect/services.ts";
import { until } from "../app-harness.ts";
import { calendar, fixtureRuntime, toastState } from "../helpers.ts";

/** Longer than the read retry's whole backoff (two waits of about 400 and 800 ms, each up to a fifth longer). */
const pastTheBackoff = 1600;
const wait = (milliseconds: number) =>
	new Promise((resolve) => setTimeout(resolve, milliseconds));

function readContext() {
	const { runtime, toasts, log } = fixtureRuntime();
	const context: AppContext = {
		root: document.createElement("div"),
		runtime,
		toasts: new ToastStore(toasts),
		calendar,
	};
	const shown = () => toastState(toasts).visible;
	return { context, toasts, log, shown };
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
	test("a reader that interrupts itself, with no cancel, ends as a failure the screen can retry, and is logged", async () => {
		const { context, log, shown } = readContext();
		const failures: string[] = [];
		const busy: boolean[] = [];
		const reading = retryingRead(context, () => Effect.interrupt, {
			value: () => undefined,
			failure: (error) => failures.push(error.kind),
			busy: (value) => busy.push(value),
		});
		await reading.run();
		await wait(10);
		expect(failures).toEqual(["unexpected"]);
		expect(busy).toEqual([true, false]);
		expect(shown()).toEqual([]);
		expect(log.entries()).toEqual([
			{
				level: "warning",
				message: "The read was interrupted before it finished.",
			},
		]);
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
			() => shown()[0]?.progress === "Retrying (2 of 3)",
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
			progress: "",
			count: 2,
			busy: false,
		});
	});
	test("a run started from a failure toast dismissed by hand shows its own retry toast", async () => {
		const { context, shown } = readContext();
		const { load } = scriptedLoad([...offline, ...offline]);
		const reading = retryingRead(context, load, { value: () => undefined });
		await reading.run();
		context.toasts.dismiss(shown()[0]?.id ?? "missing");
		await until(() => shown().length === 0, "the dismissal");
		const retrying = reading.run();
		await until(
			() =>
				shown().some(
					(toast) =>
						toast.tone === "info" && toast.detail === "Retrying (2 of 3)",
				),
			"a retry toast of its own",
		);
		reading.cancel();
		await retrying;
	});
	test("a run started while the failure toast waits behind four shows its own retry toast", async () => {
		const { context, toasts } = readContext();
		for (const title of ["a", "b", "c", "d"])
			await context.runtime.runPromise(
				ToastsService.use((service) => service.show({ tone: "error", title })),
			);
		const { load } = scriptedLoad([...offline, ...offline]);
		const reading = retryingRead(context, load, { value: () => undefined });
		await reading.run();
		const queued = () => [
			...toastState(toasts).visible,
			...toastState(toasts).waiting,
		];
		const failure = toastState(toasts).waiting[0];
		expect(failure?.title).toBe("No connection");
		const retrying = reading.run();
		await until(
			() =>
				queued().some(
					(toast) =>
						toast.tone === "info" && toast.detail === "Retrying (2 of 3)",
				),
			"a retry toast of its own",
		);
		expect(
			queued().find((toast) => toast.id === failure?.id)?.progress ?? "",
		).toBe("");
		reading.cancel();
		await retrying;
	});
	test("a Retry run that succeeds never puts the failure sentence back before its toast leaves", async () => {
		const { context, toasts, shown } = readContext();
		const { load } = scriptedLoad([...offline, "network"]);
		const reading = retryingRead(context, load, { value: () => undefined });
		await reading.run();
		const failureId = shown()[0]?.id;
		let progressSeen = false;
		let sentenceBack = false;
		const stop = toasts.subscribe((state) => {
			const failure = state.visible.find((toast) => toast.id === failureId);
			if (failure?.progress) progressSeen = true;
			else if (failure && progressSeen) sentenceBack = true;
		});
		await reading.run();
		stop();
		expect(progressSeen).toBe(true);
		expect(sentenceBack).toBe(false);
		expect(shown()).toEqual([]);
	});
	test("while a Retry run is on its way the failure toast is busy; cancelling it mid-progress leaves nothing", async () => {
		const { context, shown } = readContext();
		const { counter, load } = scriptedLoad([...offline, ...offline]);
		const busy: boolean[] = [];
		const reading = retryingRead(context, load, {
			value: () => undefined,
			busy: (value) => busy.push(value),
		});
		await reading.run();
		const retrying = reading.run();
		await until(
			() => shown()[0]?.progress === "Retrying (2 of 3)",
			"the progress",
		);
		expect(shown()[0]?.busy).toBe(true);
		const callsAtCancel = counter.calls;
		reading.cancel();
		await retrying;
		// The cancelled run is silent: no late busy(false) to clear a newer read's busy(true).
		expect(busy).toEqual([true, false, true]);
		expect(shown()).toEqual([]);
		await wait(pastTheBackoff);
		expect(counter.calls).toBe(callsAtCancel);
		expect(shown()).toEqual([]);
	});
});
