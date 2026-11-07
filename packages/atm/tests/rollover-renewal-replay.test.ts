/**
 * A renewal on a tier whose credits roll over, when a rollover expires at the same instant the cycle turns. The reset
 * (stamped 1 ms after the cycle end) leaves that rollover alone: it has lapsed, and the cron books its expiry. An older
 * engine counted it toward the rollover cap and trimmed or deleted it, so the cron's lapse (stamped at the expiry, so
 * replayed before the reset) disagreed with the trimmed row, and a deleted row's credits were never booked as expired.
 */
import { describe, expect, test } from "bun:test";
import { menuCatalogRows } from "../src/billing/grants.js";
import { replayEvents } from "../src/ledger/replay.js";
import { membersOf } from "../src/ledger/summary.js";
import { generateScenario } from "../src/scenario/generate.js";
import { resolveScenario } from "../src/scenario/profiles.js";
import type { AtmEvent } from "../src/types.js";

/** The scenario that found it: class packs, seat changes at half the families each month. */
const classPacks = (seed: number) =>
	resolveScenario({
		org: "studio",
		seed,
		params: {
			members: 30,
			tierMix: { "class-pack": 1 },
			seatChangeRate: 0.5,
			usageRate: 0.2,
		},
	} as never);

const logOf = (seed: number) => {
	const { events, menu } = generateScenario(classPacks(seed));
	const school = (events[0] as AtmEvent).school;
	const asOf = events
		.map((event) => event.event_time)
		.sort()
		.at(-1) as string;
	return { events, catalog: menuCatalogRows({ menu, school }), asOf };
};

type Change = { table: string; op: string; id?: string };
type Lapsed = {
	table: string;
	id: string;
	balance: number;
	expires_at: number;
};
const payloadOf = (event: AtmEvent) =>
	event.payload as {
		command?: { commandId: string };
		mutation?: { changes: Change[] };
		lapsed?: Lapsed[];
	};

/**
 * The log an older engine would have written: each reset 1 ms after a rollover's expiry also deletes that rollover,
 * and the cron, finding it gone, books no lapse for it.
 */
const asOlderEngineWrote = (events: readonly AtmEvent[]) => {
	const lapses = events.filter((event) => {
		const lapsed = payloadOf(event).lapsed;
		return lapsed?.length === 1 && lapsed[0]?.table === "rollovers";
	});
	const deleted = new Set<string>();
	const deletes = new Map<string, Change[]>();
	for (const lapse of lapses) {
		const row = payloadOf(lapse).lapsed?.[0] as Lapsed;
		const reset = events.find(
			(event) =>
				event.key === lapse.key &&
				payloadOf(event).mutation !== undefined &&
				Date.parse(event.event_time) === row.expires_at + 1,
		);
		const commandId = reset && payloadOf(reset).command?.commandId;
		if (!commandId) continue;
		deleted.add(lapse.id);
		deletes.set(commandId, [
			...(deletes.get(commandId) ?? []),
			{ table: "rollovers", op: "delete", id: row.id },
		]);
	}
	const rewritten = events
		.filter((event) => !deleted.has(event.id))
		.map((event) => {
			const payload = payloadOf(event);
			const extra = payload.command && deletes.get(payload.command.commandId);
			if (!extra || !payload.mutation) return event;
			return {
				...event,
				payload: {
					...payload,
					mutation: {
						...payload.mutation,
						changes: [...payload.mutation.changes, ...extra],
					},
				},
			} as AtmEvent;
		});
	return { events: rewritten, resets: deletes.size };
};

/** What the books hold in `credits:avail`, by holder and feature. */
const availPostings = (events: readonly AtmEvent[]) => {
	const out = new Map<string, number>();
	for (const event of events)
		for (const posting of event.postings ?? []) {
			if (!posting.account.startsWith("credits:avail:")) continue;
			const key = posting.account.slice("credits:avail:".length);
			out.set(key, (out.get(key) ?? 0) + Number(posting.amount));
		}
	return out;
};

describe("a renewal when a rollover expires as the cycle turns", () => {
	for (const seed of [1, 5])
		test(`seed ${seed} of the class-pack seat changes replays`, () => {
			const { events, catalog, asOf } = logOf(seed);
			const members = membersOf(events, new Date(asOf), { catalog });
			expect(members.ok ? null : members.error).toBeNull();
		});

	test("the books' available credits are what the engine counts", () => {
		const { events, catalog } = logOf(1);
		// The cron last ran at the start of the run's last month; rows lapsing after it are not booked yet.
		const lastCron = events
			.filter((event) => payloadOf(event).lapsed !== undefined)
			.map((event) => event.event_time)
			.sort()
			.at(-1) as string;
		const booked = events.filter((event) => event.event_time <= lastCron);
		const { balances } = replayEvents({
			events: booked,
			catalog,
			asOf: lastCron,
		});
		const counted = new Map(
			balances.map((b) => [`${b.holder}:${b.feature}`, b.avail]),
		);
		const books = availPostings(booked);
		const keys = new Set(
			[...books.keys(), ...counted.keys()].filter(
				(key) => (books.get(key) ?? 0) !== 0 || (counted.get(key) ?? 0) !== 0,
			),
		);
		expect(keys.size).toBeGreaterThan(0);
		for (const key of keys)
			expect([key, books.get(key) ?? 0]).toEqual([key, counted.get(key) ?? 0]);
	});

	test("a log an older engine wrote, its resets also deleting the lapsed rollovers, still replays", () => {
		const { events, catalog, asOf } = logOf(1);
		const older = asOlderEngineWrote(events);
		expect(older.resets).toBeGreaterThan(0);
		const now = replayEvents({ events, catalog, asOf });
		const then = replayEvents({ events: older.events, catalog, asOf });
		expect(then.balances).toEqual(now.balances);
	});

	test("an extra write to a rollover still live at the reset is not taken for an older engine's", () => {
		const { events, catalog, asOf } = logOf(1);
		const reset = events.find((event) => {
			const { command, mutation } = payloadOf(event);
			return (
				command !== undefined &&
				(command as { type?: string }).type === "reset" &&
				mutation?.changes.some(
					(change) => change.table === "rollovers" && change.op === "insert",
				)
			);
		}) as AtmEvent;
		const commandId = payloadOf(reset).command?.commandId;
		const inserted = payloadOf(reset).mutation?.changes.find(
			(change) => change.table === "rollovers" && change.op === "insert",
		) as Change & { row: { id: string } };
		// a later reset of the same holder deletes the rollover this one inserted, while it is still live
		const later = events.find(
			(event) =>
				event.key === reset.key &&
				event.event_time > reset.event_time &&
				(payloadOf(event).command as { type?: string } | undefined)?.type ===
					"reset" &&
				Date.parse(event.event_time) <
					Date.parse(reset.event_time) + 40 * 864e5,
		) as AtmEvent;
		expect(commandId).toBeDefined();
		const laterId = payloadOf(later).command?.commandId;
		const tampered = events.map((event) => {
			const payload = payloadOf(event);
			if (payload.command?.commandId !== laterId || !payload.mutation)
				return event;
			return {
				...event,
				payload: {
					...payload,
					mutation: {
						...payload.mutation,
						changes: [
							...payload.mutation.changes,
							{ table: "rollovers", op: "delete", id: inserted.row.id },
						],
					},
				},
			} as AtmEvent;
		});
		expect(() => replayEvents({ events: tampered, catalog, asOf })).toThrow(
			"the engine decides differently from the recorded mutation",
		);
	});
});
