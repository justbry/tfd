import { Effect, Layer } from "effect";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import { Clock } from "./services.ts";

/** The browser's timers behind the UI's fixed calendar. */
export const liveClockLayer = (calendar: CalendarClock): Layer.Layer<Clock> =>
	Layer.succeed(Clock, {
		calendar,
		sleep: (milliseconds) => Effect.sleep(milliseconds),
	});

type Sleeper = { at: number; wake: () => void };

/** A clock that moves only when told (tests, screenshots): `advance` lets fibers forked before it start, wakes
 * every sleep that has come due, then lets the woken fibers run before it resolves. */
export function manualClock(calendar: CalendarClock): {
	layer: Layer.Layer<Clock>;
	advance: (milliseconds: number) => Promise<void>;
	sleeping: () => number;
} {
	let elapsed = 0;
	const sleepers = new Set<Sleeper>();
	const settle = async (): Promise<void> => {
		for (let turn = 0; turn < 3; turn += 1)
			await new Promise((resolve) => setTimeout(resolve, 0));
	};
	return {
		layer: Layer.succeed(Clock, {
			calendar,
			sleep: (milliseconds) =>
				Effect.callback<void>((resume) => {
					const sleeper: Sleeper = {
						at: elapsed + milliseconds,
						wake: () => resume(Effect.void),
					};
					sleepers.add(sleeper);
					return Effect.sync(() => {
						sleepers.delete(sleeper);
					});
				}),
		}),
		advance: async (milliseconds) => {
			// Fibers forked just before (a toast's countdown) start sleeping first.
			await settle();
			elapsed += milliseconds;
			for (const sleeper of [...sleepers].sort(
				(first, second) => first.at - second.at,
			))
				if (sleeper.at <= elapsed) {
					sleepers.delete(sleeper);
					sleeper.wake();
				}
			await settle();
		},
		sleeping: () => sleepers.size,
	};
}
