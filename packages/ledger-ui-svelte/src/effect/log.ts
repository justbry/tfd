import { Effect, Layer } from "effect";
import { Log, type LogEntry } from "./services.ts";

const keptEntries = 100;

/** A log kept in memory, newest last, at most `keptEntries`: the app writes nothing to `console`. `entries` is for
 * whoever made it (a test, a later support view); the `Log` service only writes. */
export function memoryLog(): {
	layer: Layer.Layer<Log>;
	entries: () => readonly LogEntry[];
} {
	const entries: LogEntry[] = [];
	return {
		layer: Layer.succeed(Log, {
			write: (entry) =>
				Effect.sync(() => {
					entries.push(entry);
					if (entries.length > keptEntries) entries.shift();
				}),
		}),
		entries: () => entries,
	};
}
