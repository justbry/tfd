import { describe, expect, test } from "bun:test";
import { Effect, ManagedRuntime } from "effect";
import { AdapterError } from "$contract/http/errors.ts";
import { memoryStorage } from "$contract/http/pending.ts";
import { httpLayer } from "../../src/effect/layers.ts";
import { memoryLogLayer } from "../../src/effect/log.ts";
import { read, run } from "../../src/effect/run.ts";
import { Log } from "../../src/effect/services.ts";
import {
	fieldProblems,
	toUiError,
	UiError,
} from "../../src/effect/ui-error.ts";
import { fixtureRuntime } from "../helpers.ts";

const logRuntime = () => ManagedRuntime.make(memoryLogLayer);

describe("run", () => {
	test("an AdapterError keeps its kind and detail, and its retryability", async () => {
		const runtime = logRuntime();
		const failed = await runtime.runPromise(
			Effect.flip(
				run(() =>
					Promise.reject(
						new AdapterError("unavailable", "views_unavailable", {
							status: 503,
							code: "views_unavailable",
						}),
					),
				),
			),
		);
		expect(failed).toBeInstanceOf(UiError);
		expect(failed._tag).toBe("UiError");
		expect(failed.kind).toBe("unavailable");
		expect(failed.detail).toEqual({ status: 503, code: "views_unavailable" });
		expect(failed.retryable).toBe(true);
		const entries = await runtime.runPromise(
			Log.useSync((log) => log.entries()),
		);
		expect(entries).toEqual([]);
	});
	test("a forbidden answer is not retryable", () => {
		expect(toUiError(new AdapterError("forbidden", "no")).retryable).toBe(
			false,
		);
	});
	test("anything else is unexpected, and is written to the log", async () => {
		const runtime = logRuntime();
		const thrown = new TypeError("x is not a function");
		const failed = await runtime.runPromise(
			Effect.flip(run(() => Promise.reject(thrown))),
		);
		expect(failed.kind).toBe("unexpected");
		expect(failed.reason).toBe("x is not a function");
		expect(failed.retryable).toBe(false);
		const entries = await runtime.runPromise(
			Log.useSync((log) => log.entries()),
		);
		expect(entries).toEqual([
			{ level: "error", message: "x is not a function", cause: thrown },
		]);
	});
	test("a call that throws before it returns a promise fails the same way", async () => {
		const runtime = logRuntime();
		const failed = await runtime.runPromise(
			Effect.flip(
				run((): Promise<number> => {
					throw new AdapterError("network", "offline");
				}),
			),
		);
		expect(failed.kind).toBe("network");
	});
	test("a success passes through", async () => {
		const value = await logRuntime().runPromise(run(() => Promise.resolve(7)));
		expect(value).toBe(7);
	});
	test("a field problem comes from problems[] or from field", () => {
		const one = toUiError(
			new AdapterError("bad_request", "Pick a date", { field: "from" }),
		);
		expect(fieldProblems(one)).toEqual([
			{ path: "from", message: "Pick a date" },
		]);
		expect(
			fieldProblems(toUiError(new AdapterError("server", "boom"))),
		).toEqual([]);
	});
});

describe("the layers", () => {
	test("the fixture layer reads the fixture schools", async () => {
		const { runtime } = fixtureRuntime();
		const schools = await runtime.runPromise(
			read((reader) => reader.schools()),
		);
		expect(schools.map((school) => school.id)).toEqual([
			"vol",
			"b4u",
			"map",
			"nw",
			"har",
		]);
	});
	test("the HTTP layer's refusals arrive as UiError with the adapter's kind", async () => {
		const layer = httpLayer({
			fetch: () =>
				Promise.resolve(
					new Response(JSON.stringify({ error: "unauthenticated" }), {
						status: 401,
					}),
				),
			apiBase: "https://api.test",
			workerBase: "https://worker.test/v1",
			storage: memoryStorage(),
			newKey: () => "key-1",
			files: { save: () => Promise.resolve() },
		});
		const failed = await ManagedRuntime.make(layer).runPromise(
			Effect.flip(read((reader) => reader.schools())),
		);
		expect(failed).toMatchObject({
			kind: "unauthenticated",
			retryable: false,
		});
		expect(failed.detail.status).toBe(401);
	});
});
