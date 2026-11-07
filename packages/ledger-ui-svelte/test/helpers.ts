import { Effect, Layer, ManagedRuntime } from "effect";
import { manualClock } from "../src/effect/clock.ts";
import { type AppServices, fixtureLayer } from "../src/effect/layers.ts";
import { memoryLogLayer } from "../src/effect/log.ts";
import { Toasts } from "../src/effect/services.ts";
import { toastsLayer } from "../src/effect/toasts.ts";

export const calendar = { today: "2026-11-05", now: "2026-11-05T12:00" };

/** The toasts and log over a clock moved by hand. */
export function toastRuntime() {
	const clock = manualClock(calendar);
	const runtime = ManagedRuntime.make(
		Layer.mergeAll(toastsLayer, memoryLogLayer).pipe(
			Layer.provideMerge(clock.layer),
		),
	);
	const toasts = runtime.runSync(Toasts.useSync((service) => service));
	return { clock, runtime, toasts };
}

/** The fixture layer over a clock moved by hand. */
export function fixtureRuntime() {
	const clock = manualClock(calendar);
	const runtime = ManagedRuntime.make<AppServices, never>(
		fixtureLayer({ calendar, clockLayer: clock.layer }),
	);
	return { clock, runtime };
}

export const runTo = <A, E>(effect: Effect.Effect<A, E, never>) =>
	Effect.runPromise(Effect.result(effect));
