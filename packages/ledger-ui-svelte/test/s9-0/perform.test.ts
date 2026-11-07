import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { perform } from "../../src/app/context.ts";
import { Log, Toasts } from "../../src/effect/services.ts";
import { UiError } from "../../src/effect/ui-error.ts";
import { fixtureRuntime } from "../helpers.ts";

describe("perform", () => {
	test("a typed failure is returned and shown, not logged twice", async () => {
		const { runtime } = fixtureRuntime();
		const error = new UiError({
			kind: "forbidden",
			detail: {},
			reason: "no",
			retryable: false,
		});
		const outcome = await perform({ runtime }, Effect.fail(error));
		expect(outcome).toEqual({ ok: false, error, toastId: expect.any(String) });
		const titles = runtime.runSync(
			Toasts.useSync((toasts) =>
				toasts.current().visible.map((toast) => toast.title),
			),
		);
		expect(titles).toEqual(["Not allowed"]);
		expect(runtime.runSync(Log.useSync((log) => log.entries()))).toEqual([]);
	});
	test("a defect becomes unexpected, is logged and shown, and the promise resolves", async () => {
		const { runtime } = fixtureRuntime();
		const bug = new TypeError("reader.schools is not a function");
		const outcome = await perform({ runtime }, Effect.die(bug));
		expect(outcome.ok).toBe(false);
		if (outcome.ok) return;
		expect(outcome.error.kind).toBe("unexpected");
		expect(outcome.error.reason).toBe("reader.schools is not a function");
		expect(runtime.runSync(Log.useSync((log) => log.entries()))).toEqual([
			{
				level: "error",
				message: "reader.schools is not a function",
				cause: bug,
			},
		]);
		const toast = runtime.runSync(
			Toasts.useSync((toasts) => toasts.current().visible[0]),
		);
		expect(toast).toMatchObject({
			tone: "error",
			title: "Something went wrong",
		});
	});
	test("an interruption is reported too", async () => {
		const { runtime } = fixtureRuntime();
		const outcome = await perform({ runtime }, Effect.interrupt);
		expect(outcome.ok).toBe(false);
		if (!outcome.ok) expect(outcome.error.kind).toBe("unexpected");
	});
});
