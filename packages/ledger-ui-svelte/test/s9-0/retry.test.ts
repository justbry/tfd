import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { AdapterError, type AdapterErrorKind } from "$contract/http/errors.ts";
import {
	type Attempted,
	maximumTries,
	mayRetry,
	retryingText,
	withRetry,
} from "../../src/effect/retry.ts";
import { run } from "../../src/effect/run.ts";
import { toUiError } from "../../src/effect/ui-error.ts";
import { toastRuntime, toastState } from "../helpers.ts";

const read: Attempted = { kind: "read" };
const fast = { baseMilliseconds: 1 };

/** A call that fails with `kinds` in turn, then answers "done"; `calls` counts the tries. */
function flaky(kinds: AdapterErrorKind[]) {
	const counter = { calls: 0 };
	const effect = run(() => {
		counter.calls += 1;
		const kind = kinds[counter.calls - 1];
		return kind
			? Promise.reject(new AdapterError(kind, kind))
			: Promise.resolve("done");
	});
	return { counter, effect };
}

describe("the retry rules", () => {
	test("only retryable kinds, and a write only with its Idempotency-Key", () => {
		const unavailable = toUiError(new AdapterError("unavailable", "503"));
		const forbidden = toUiError(new AdapterError("forbidden", "403"));
		expect(mayRetry(unavailable, read)).toBe(true);
		expect(mayRetry(forbidden, read)).toBe(false);
		expect(mayRetry(unavailable, { kind: "write", idempotencyKey: null })).toBe(
			false,
		);
		expect(
			mayRetry(unavailable, { kind: "write", idempotencyKey: "k-1" }),
		).toBe(true);
		for (const kind of ["network", "rate_limited", "server"] as const)
			expect(mayRetry(toUiError(new AdapterError(kind, kind)), read)).toBe(
				true,
			);
		expect(mayRetry(toUiError(new TypeError("x")), read)).toBe(false);
	});
	test("the toast text", () => {
		expect(maximumTries).toBe(3);
		expect(retryingText(2)).toBe("Retrying (2 of 3)");
	});
});

describe("withRetry", () => {
	test("a retryable read is tried at most three times, then fails with the last error", async () => {
		const { runtime, toasts } = toastRuntime();
		const { counter, effect } = flaky([
			"unavailable",
			"network",
			"server",
			"server",
		]);
		const seen: string[] = [];
		toasts.subscribe((state) => {
			for (const toast of state.visible)
				if (toast.detail) seen.push(toast.detail);
		});
		const failed = await runtime.runPromise(
			Effect.flip(withRetry(effect, read, fast)),
		);
		expect(counter.calls).toBe(3);
		expect(failed.kind).toBe("server");
		expect([...new Set(seen)]).toEqual([
			"Retrying (2 of 3)",
			"Retrying (3 of 3)",
		]);
		expect(toastState(toasts).visible).toEqual([]);
	});
	test("a read that recovers succeeds and its retry toast leaves", async () => {
		const { runtime, toasts } = toastRuntime();
		const { counter, effect } = flaky(["unavailable"]);
		const value = await runtime.runPromise(withRetry(effect, read, fast));
		expect(value).toBe("done");
		expect(counter.calls).toBe(2);
		expect(toastState(toasts).visible).toEqual([]);
	});
	test("a kind that is not retryable is tried once", async () => {
		const { runtime, toasts } = toastRuntime();
		const { counter, effect } = flaky(["forbidden"]);
		const failed = await runtime.runPromise(
			Effect.flip(withRetry(effect, read, fast)),
		);
		expect(failed.kind).toBe("forbidden");
		expect(counter.calls).toBe(1);
		expect(toastState(toasts).visible).toEqual([]);
	});
	test("a write without an Idempotency-Key is never retried", async () => {
		const { runtime } = toastRuntime();
		const { counter, effect } = flaky(["unavailable", "unavailable"]);
		await runtime.runPromise(
			Effect.flip(
				withRetry(effect, { kind: "write", idempotencyKey: null }, fast),
			),
		);
		expect(counter.calls).toBe(1);
	});
	test("a write with its Idempotency-Key is retried", async () => {
		const { runtime } = toastRuntime();
		const { counter, effect } = flaky(["unavailable"]);
		const value = await runtime.runPromise(
			withRetry(effect, { kind: "write", idempotencyKey: "k-1" }, fast),
		);
		expect(value).toBe("done");
		expect(counter.calls).toBe(2);
	});
});
