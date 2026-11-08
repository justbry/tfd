import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { perform } from "../../src/app/context.ts";
import { UiError } from "../../src/effect/ui-error.ts";
import { fixtureRuntime, toastState } from "../helpers.ts";

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
