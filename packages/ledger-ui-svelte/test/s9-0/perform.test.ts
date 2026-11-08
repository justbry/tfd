import { describe, expect, test } from "bun:test";
import { Effect, Layer, ManagedRuntime } from "effect";
import { AdapterError } from "$contract/http/errors.ts";
import { perform } from "../../src/app/context.ts";
import type { AppServices } from "../../src/effect/app-layer.ts";
import { manualClock } from "../../src/effect/clock.ts";
import { fixtureLayer } from "../../src/effect/layers.ts";
import { memoryLog } from "../../src/effect/log.ts";
import { withRetry } from "../../src/effect/retry.ts";
import { run } from "../../src/effect/run.ts";
import { Toasts } from "../../src/effect/services.ts";
import { toastsLayer } from "../../src/effect/toasts.ts";
import { UiError } from "../../src/effect/ui-error.ts";
import { until } from "../app-harness.ts";
import { calendar, fixtureRuntime, toastState } from "../helpers.ts";

describe("perform", () => {
	test("a typed failure is returned and shown, not logged twice", async () => {
		const { runtime, log, toasts } = fixtureRuntime();
		const error = new UiError({
			kind: "forbidden",
			detail: {},
			reason: "no",
			retryable: false,
		});
		const outcome = await perform({ runtime }, Effect.fail(error));
		expect(outcome).toEqual({
			ok: false,
			interrupted: false,
			error,
			toastId: expect.any(String),
		});
		const titles = toastState(toasts).visible.map((toast) => toast.title);
		expect(titles).toEqual(["Not allowed"]);
		expect(log.entries()).toEqual([]);
	});
	test("a defect becomes unexpected, is logged and shown, and the promise resolves", async () => {
		const { runtime, log, toasts } = fixtureRuntime();
		const bug = new TypeError("reader.schools is not a function");
		const outcome = await perform({ runtime }, Effect.die(bug));
		if (outcome.ok || outcome.interrupted)
			throw new Error("expected a failure");
		expect(outcome.error.kind).toBe("unexpected");
		expect(outcome.error.reason).toBe("reader.schools is not a function");
		expect(log.entries()).toEqual([
			{
				level: "error",
				message: "reader.schools is not a function",
				cause: bug,
			},
		]);
		const toast = toastState(toasts).visible[0];
		expect(toast).toMatchObject({
			tone: "error",
			title: "Something went wrong",
		});
	});
	test("an interruption alone is no failure: no toast, nothing logged", async () => {
		const { runtime, log, toasts } = fixtureRuntime();
		const outcome = await perform({ runtime }, Effect.interrupt);
		expect(outcome).toEqual({ ok: false, interrupted: true });
		expect(toastState(toasts).visible).toEqual([]);
		expect(log.entries()).toEqual([]);
	});
	test("aborting the signal interrupts the run, even one waiting on a call that never answers", async () => {
		const { runtime, log, toasts } = fixtureRuntime();
		const controller = new AbortController();
		const waiting = perform({ runtime }, Effect.never, {
			signal: controller.signal,
		});
		controller.abort();
		expect(await waiting).toEqual({ ok: false, interrupted: true });
		expect(toastState(toasts).visible).toEqual([]);
		expect(log.entries()).toEqual([]);
	});
});

/** The fixture runtime with its toasts broken as `breakToasts` says, over the real toasts layer. */
function brokenToastsRuntime(
	breakToasts: (toasts: Toasts["Service"]) => Partial<Toasts["Service"]>,
) {
	const log = memoryLog();
	const clock = manualClock();
	const broken = Layer.effect(
		Toasts,
		Toasts.useSync((toasts) =>
			Toasts.of({ ...toasts, ...breakToasts(toasts) }),
		),
	).pipe(Layer.provide(toastsLayer), Layer.provide(clock.layer));
	const runtime = ManagedRuntime.make<AppServices, never>(
		Layer.mergeAll(
			fixtureLayer({ calendar, clockLayer: clock.layer }),
			broken,
			log.layer,
		),
	);
	const toasts = runtime.runSync(Toasts.useSync((service) => service));
	return { runtime, log, toasts };
}

describe("perform: nothing fails silently past its handler", () => {
	test("the report itself dying is logged, and the run still ends as a failure", async () => {
		const showBroke = new Error("toasts are broken");
		const { runtime, log } = brokenToastsRuntime(() => ({
			show: () => Effect.die(showBroke),
		}));
		const error = new UiError({
			kind: "forbidden",
			detail: {},
			reason: "no",
			retryable: false,
		});
		const outcome = await perform({ runtime }, Effect.fail(error));
		expect(outcome).toMatchObject({
			ok: false,
			interrupted: false,
			toastId: null,
		});
		expect(log.entries().map((entry) => entry.cause)).toContain(showBroke);
	});
	test("a defect arriving with the abort is logged, and no toast is shown for the aborted run", async () => {
		const { runtime, log, toasts } = fixtureRuntime();
		const bug = new TypeError("cleanup failed");
		const controller = new AbortController();
		const waiting = perform(
			{ runtime },
			Effect.never.pipe(Effect.onInterrupt(() => Effect.die(bug))),
			{ signal: controller.signal },
		);
		await new Promise((resolve) => setTimeout(resolve, 5));
		controller.abort();
		const outcome = await waiting;
		expect(outcome).toMatchObject({ ok: false, interrupted: false });
		expect(log.entries().map((entry) => entry.cause)).toContain(bug);
		expect(toastState(toasts).visible).toEqual([]);
	});
	test("an abort whose retry toast cannot be taken down is logged, with no toast of its own", async () => {
		const dismissBroke = new Error("dismiss is broken");
		const { runtime, log, toasts } = brokenToastsRuntime(() => ({
			dismiss: () => Effect.die(dismissBroke),
		}));
		const controller = new AbortController();
		const waiting = perform(
			{ runtime },
			withRetry(
				run(() => Promise.reject(new AdapterError("network", "offline"))),
				{ kind: "read" },
			),
			{ signal: controller.signal },
		);
		await until(
			() =>
				toastState(toasts).visible.some(
					(toast) => toast.detail === "Retrying (2 of 3)",
				),
			"the retry toast",
		);
		controller.abort();
		const outcome = await waiting;
		expect(outcome).toMatchObject({ ok: false, interrupted: false });
		expect(log.entries().map((entry) => entry.cause)).toContain(dismissBroke);
		expect(
			toastState(toasts).visible.map((toast) => toast.title),
		).not.toContain("Something went wrong");
	});
	test("a defect the handler already logged is logged once when the report then dies", async () => {
		const showBroke = new Error("toasts are broken");
		const { runtime, log } = brokenToastsRuntime(() => ({
			show: () => Effect.die(showBroke),
		}));
		const bug = new TypeError("reader.schools is not a function");
		await perform({ runtime }, Effect.die(bug));
		const causes = log.entries().map((entry) => entry.cause);
		expect(causes.filter((cause) => cause === bug)).toHaveLength(1);
	});
});

describe("withRetry: an abort as its retry toast shows", () => {
	test("never strands that toast", async () => {
		const { runtime, toasts } = fixtureRuntime();
		const controller = new AbortController();
		const stop = toasts.subscribe((state) => {
			if (state.visible.some((toast) => toast.detail === "Retrying (2 of 3)"))
				controller.abort();
		});
		const outcome = await perform(
			{ runtime },
			withRetry(
				run(() => Promise.reject(new AdapterError("network", "offline"))),
				{ kind: "read" },
			),
			{ signal: controller.signal },
		);
		stop();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(outcome).toEqual({ ok: false, interrupted: true });
		expect(toastState(toasts).visible).toEqual([]);
	});
});
