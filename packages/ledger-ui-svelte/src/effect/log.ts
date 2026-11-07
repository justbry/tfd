import { Effect, Layer } from "effect";
import { Log, type LogEntry } from "./services.ts";

const keptEntries = 100;

/** The log kept in memory, newest last, at most `keptEntries`: the app writes nothing to `console`. */
export const memoryLogLayer: Layer.Layer<Log> = Layer.sync(Log, () => {
	const entries: LogEntry[] = [];
	return {
		write: (entry) =>
			Effect.sync(() => {
				entries.push(entry);
				if (entries.length > keptEntries) entries.shift();
			}),
		entries: () => entries,
	};
});
