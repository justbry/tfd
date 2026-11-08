import { Layer, ManagedRuntime } from "effect";
import type { ConfigApi } from "../src/effect/config-client.ts";
import type { AppServices } from "../src/effect/app-layer.ts";
import { manualClock } from "../src/effect/clock.ts";
import { fixtureLayer } from "../src/effect/layers.ts";
import { memoryLog } from "../src/effect/log.ts";
import { Toasts } from "../src/effect/services.ts";
import { emptyToastState, type ToastState } from "../src/effect/toast-model.ts";
import { toastsLayer } from "../src/effect/toasts.ts";

/** A config client the test never calls: any call fails the test. */
export const noConfig = new Proxy(
	{},
	{
		get: (_target, name) => () => {
			throw new Error(`the test did not expect config.${String(name)}`);
		},
	},
) as ConfigApi;

export const calendar = { today: "2026-11-05", now: "2026-11-05T12:00" };

/** The queue's state now, read through `subscribe` as the rune store reads it. */
export function toastState(toasts: Toasts["Service"]): ToastState {
	let state = emptyToastState;
	toasts.subscribe((next) => {
		state = next;
	})();
	return state;
}

/** The toasts and a readable log over a clock moved by hand. */
export function toastRuntime() {
	const clock = manualClock();
	const log = memoryLog();
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(toastsLayer, log.layer).pipe(
			Layer.provideMerge(clock.layer),
		),
	);
	const toasts = runtime.runSync(Toasts.useSync((service) => service));
	return { clock, runtime, toasts, log };
}

/** The fixture layer over a clock moved by hand, its log replaced by one the test can read. */
export function fixtureRuntime() {
	const clock = manualClock();
	const log = memoryLog();
	const runtime = ManagedRuntime.make<AppServices, never>(
		Layer.mergeAll(
			fixtureLayer({ calendar, clockLayer: clock.layer }),
			log.layer,
		),
	);
	const toasts = runtime.runSync(Toasts.useSync((service) => service));
	return { clock, runtime, log, toasts };
}
