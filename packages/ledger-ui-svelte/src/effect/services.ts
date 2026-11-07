import { Context, type Effect } from "effect";
import type { Reader as ReaderContract } from "$contract/data/reader.ts";
import type { Clock as CalendarClock } from "$contract/data/types.ts";
import type { Writer as WriterContract } from "$contract/data/writer.ts";
import type { ToastInput, ToastPatch, ToastState } from "./toast-model.ts";

/** The services of the Svelte app's data layer (S9-plan section 5). The shared Reader and Writer stay promise-based;
 * these tags carry them, and `run` turns their calls into effects. A layer provides each: the fixture layer in tests
 * and the fixture build, the HTTP layer in the HTTP build. */
export class Reader extends Context.Service<Reader, ReaderContract>()(
	"ledger-ui-svelte/Reader",
) {}

export class Writer extends Context.Service<Writer, WriterContract>()(
	"ledger-ui-svelte/Writer",
) {}

/** The UI's clock (protocol §3: the UI never reads the system time): the calendar the entry supplies, and the
 * waits the toasts and retries use, so that a test can move time by hand. */
export class Clock extends Context.Service<
	Clock,
	{
		readonly calendar: CalendarClock;
		readonly sleep: (milliseconds: number) => Effect.Effect<void>;
	}
>()("ledger-ui-svelte/Clock") {}

/** The toast queue (section 5). `subscribe` and `current` are the synchronous edge the Svelte rune store reads. */
export class Toasts extends Context.Service<
	Toasts,
	{
		readonly show: (toast: ToastInput) => Effect.Effect<string>;
		readonly update: (id: string, patch: ToastPatch) => Effect.Effect<void>;
		readonly dismiss: (id: string) => Effect.Effect<void>;
		readonly state: Effect.Effect<ToastState>;
		readonly current: () => ToastState;
		readonly subscribe: (listener: (state: ToastState) => void) => () => void;
	}
>()("ledger-ui-svelte/Toasts") {}

export type LogEntry = {
	level: "error" | "warning";
	message: string;
	cause?: unknown;
};

/** Where an unexpected failure is written (never `console`): kept in memory, newest last, for a support view. */
export class Log extends Context.Service<
	Log,
	{
		readonly write: (entry: LogEntry) => Effect.Effect<void>;
		readonly entries: () => readonly LogEntry[];
	}
>()("ledger-ui-svelte/Log") {}
