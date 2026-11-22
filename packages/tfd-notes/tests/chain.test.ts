// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { sha256Hex } from "../src/canonical";
import {
	buildChain,
	type ChainLink,
	chainHead,
	eventHash,
	extendChain,
	genesisHash,
	linkHash,
	verifyChain,
} from "../src/chain";
import { validateStream } from "../src/events";
import type { NoteEvent } from "../src/types";
import smallNote from "./golden/chain/small-note.input.json";
import outOfOrder from "./golden/chain/value-dates-out-of-order.input.json";

const events: NoteEvent[] = validateStream(smallNote.events);
const [firstEvent] = events;
const clone = <Value>(value: Value): Value => structuredClone(value);
const linkAt = (links: ChainLink[], index: number): ChainLink => {
	const link = links[index];
	if (link === undefined) throw new Error(`no link at ${index}`);
	return link;
};

describe("chain construction", () => {
	it("binds link 1 to a genesis hash made from the note id", async () => {
		const links = await buildChain(events);
		expect(await genesisHash("note-demo-1")).toBe(
			await sha256Hex("tfd.note-chain.v1:note-demo-1"),
		);
		expect(linkAt(links, 0).prev_hash).toBe(await genesisHash("note-demo-1"));
		expect(await genesisHash("note-other")).not.toBe(
			await genesisHash("note-demo-1"),
		);
	});

	it("chains each link to the hash of the one before and each event by its hash", async () => {
		const links = await buildChain(events);
		expect(links).toHaveLength(events.length);
		for (const [index, link] of links.entries()) {
			const event = events[index];
			if (event === undefined) throw new Error("event missing");
			expect(link.seq).toBe(index + 1);
			expect(link.event_id).toBe(event.id);
			expect(link.event_hash).toBe(await eventHash(event));
			if (index > 0) {
				expect(link.prev_hash).toBe(await linkHash(linkAt(links, index - 1)));
			}
		}
	});

	it("names the head by the last link's seq and hash", async () => {
		const links = await buildChain(events);
		const head = await chainHead(links);
		expect(head).toEqual({
			seq: events.length,
			head_hash: await linkHash(linkAt(links, links.length - 1)),
		});
		await expect(chainHead([])).rejects.toThrow(/empty/);
	});

	it("is deterministic and orders by seq whatever order the events arrive in", async () => {
		const forward = await buildChain(events);
		expect(await buildChain(events)).toEqual(forward);
		expect(await buildChain([...events].reverse())).toEqual(forward);
	});

	it("refuses an empty stream, a seq gap and events of two notes", async () => {
		await expect(buildChain([])).rejects.toThrow(/at least one/);
		await expect(
			buildChain(events.filter((event) => event.seq !== 4)),
		).rejects.toThrow(/seq/);
		const mixed = clone(events);
		const last = mixed[mixed.length - 1];
		if (last === undefined) throw new Error("no events");
		last.note_id = "note-other";
		await expect(buildChain(mixed)).rejects.toThrow(/note-other/);
	});

	it("extendChain appends one link equal to the one buildChain makes", async () => {
		const links = await buildChain(events);
		const next = events[events.length - 1];
		if (next === undefined) throw new Error("no events");
		const shorter = await buildChain(events.slice(0, -1));
		expect(await extendChain(shorter, next)).toEqual(links);
		expect(shorter).toHaveLength(events.length - 1);
		if (firstEvent === undefined) throw new Error("no events");
		expect(await extendChain([], firstEvent)).toEqual(links.slice(0, 1));
		await expect(extendChain(links, next)).rejects.toThrow(/expected seq/);
	});
});

describe("chain order is recording order", () => {
	const stream = validateStream(outOfOrder.events);

	it("reads seq only: value dates out of order do not move a link", async () => {
		const byValueDate = [...stream]
			.filter((event) => event.type === "payment.recorded")
			.sort((left, right) =>
				left.type === "payment.recorded" && right.type === "payment.recorded"
					? left.value_date.localeCompare(right.value_date)
					: 0,
			);
		expect(byValueDate.map((event) => event.seq)).not.toEqual(
			byValueDate.map((event) => event.seq).sort((left, right) => left - right),
		);
		const chain = await buildChain(stream);
		const shuffled = await buildChain([...byValueDate, ...stream.slice(0, 1)]);
		expect(shuffled).toEqual(chain);
		expect(chain.map((link) => link.seq)).toEqual([1, 2, 3, 4]);
		expect(await verifyChain(stream, chain)).toEqual({ ok: true });
	});

	it("never reads entered_at to order: a clock that runs backwards still chains by seq", async () => {
		const backwards = clone(stream);
		const third = backwards[2];
		if (third === undefined) throw new Error("no third event");
		third.entered_at = "2026-01-02T00:00:00Z";
		const chain = await buildChain(backwards);
		expect(chain.map((link) => link.event_id)).toEqual(
			stream.map((event) => event.id),
		);
		expect(await verifyChain(backwards, chain)).toEqual({ ok: true });
	});
});

describe("verifyChain", () => {
	it("accepts the chain it built", async () => {
		expect(await verifyChain(events, await buildChain(events))).toEqual({
			ok: true,
		});
		expect(
			await verifyChain(events, await buildChain(events), "note-demo-1"),
		).toEqual({
			ok: true,
		});
	});

	it("rejects an event with one byte changed, at its seq", async () => {
		const links = await buildChain(events);
		const edited = clone(events);
		const payment = edited[2];
		if (payment?.type !== "payment.recorded")
			throw new Error("expected a payment");
		payment.reference = "TX-2";
		expect(await verifyChain(edited, links)).toEqual({
			ok: false,
			reason: "event_hash_mismatch",
			seq: 3,
		});
	});

	it("rejects two events that traded places", async () => {
		const links = await buildChain(events);
		const swapped = [...events];
		const [left, right] = [swapped[2], swapped[5]];
		if (left === undefined || right === undefined)
			throw new Error("events missing");
		swapped[2] = right;
		swapped[5] = left;
		expect(await verifyChain(swapped, links)).toEqual({
			ok: false,
			reason: "events_out_of_order",
			seq: 3,
		});
	});

	it("rejects two events that traded content under their seq", async () => {
		const links = await buildChain(events);
		const swapped = clone(events);
		const [left, right] = [clone(events[2]), clone(events[5])];
		if (left === undefined || right === undefined)
			throw new Error("events missing");
		swapped[2] = { ...right, seq: 3 };
		swapped[5] = { ...left, seq: 6 };
		expect(await verifyChain(swapped, links)).toMatchObject({
			ok: false,
			reason: "link_event_mismatch",
			seq: 3,
		});
	});

	it("rejects a deleted link, in the middle and at either end", async () => {
		const links = await buildChain(events);
		expect(
			await verifyChain(
				events,
				links.filter((link) => link.seq !== 4),
			),
		).toEqual({
			ok: false,
			reason: "missing_link",
			seq: 4,
		});
		expect(await verifyChain(events, links.slice(0, -1))).toEqual({
			ok: false,
			reason: "missing_link",
			seq: events.length,
		});
		expect(await verifyChain(events, links.slice(1))).toEqual({
			ok: false,
			reason: "missing_link",
			seq: 1,
		});
	});

	it("rejects a duplicated link", async () => {
		const links = await buildChain(events);
		const doubled = [...links.slice(0, 4), linkAt(links, 3), ...links.slice(4)];
		expect(await verifyChain(events, doubled)).toEqual({
			ok: false,
			reason: "duplicated_link",
			seq: 5,
		});
		expect(
			await verifyChain(events, [...links, linkAt(links, links.length - 1)]),
		).toEqual({
			ok: false,
			reason: "duplicated_link",
			seq: events.length + 1,
		});
	});

	it("rejects links that traded places", async () => {
		const links = await buildChain(events);
		const swapped = [...links];
		swapped[2] = linkAt(links, 3);
		swapped[3] = linkAt(links, 2);
		expect(await verifyChain(events, swapped)).toEqual({
			ok: false,
			reason: "links_out_of_order",
			seq: 3,
		});
	});

	it("rejects a forged appended link", async () => {
		const links = await buildChain(events);
		const forged: ChainLink = {
			seq: events.length + 1,
			event_id: "evt-forged",
			event_hash: await sha256Hex("forged"),
			prev_hash: await linkHash(linkAt(links, links.length - 1)),
		};
		expect(await verifyChain(events, [...links, forged])).toEqual({
			ok: false,
			reason: "extra_link",
			seq: events.length + 1,
		});
	});

	it("rejects a link bound to another note's genesis", async () => {
		const links = await buildChain(events);
		const rebound = clone(links);
		linkAt(rebound, 0).prev_hash = await genesisHash("note-other");
		expect(await verifyChain(events, rebound)).toEqual({
			ok: false,
			reason: "wrong_genesis",
			seq: 1,
		});
	});

	it("rejects events of another note, or not the note the caller expects", async () => {
		const links = await buildChain(events);
		expect(await verifyChain(events, links, "note-other")).toEqual({
			ok: false,
			reason: "wrong_note_id",
			seq: 1,
		});
		const mixed = clone(events);
		const last = mixed[mixed.length - 1];
		if (last === undefined) throw new Error("no events");
		last.note_id = "note-other";
		expect(await verifyChain(mixed, links)).toEqual({
			ok: false,
			reason: "mixed_note_ids",
			seq: events.length,
		});
		const renamed = clone(events).map((event) => ({
			...event,
			note_id: "note-other",
		}));
		expect(await verifyChain(renamed, links)).toMatchObject({
			ok: false,
			reason: "event_hash_mismatch",
			seq: 1,
		});
	});

	it("rejects a link whose prev_hash is not the hash of the link before", async () => {
		const links = await buildChain(events);
		const broken = clone(links);
		linkAt(broken, 4).prev_hash = await sha256Hex("not the previous link");
		expect(await verifyChain(events, broken)).toEqual({
			ok: false,
			reason: "broken_link",
			seq: 5,
		});
	});

	it("rejects a link that names a different event id", async () => {
		const links = await buildChain(events);
		const renamed = clone(links);
		linkAt(renamed, 1).event_id = "evt-elsewhere";
		expect(await verifyChain(events, renamed)).toEqual({
			ok: false,
			reason: "link_event_mismatch",
			seq: 2,
		});
	});

	it("rejects an edited event whose own link was rewritten, at the next link", async () => {
		const links = await buildChain(events);
		const edited = clone(events);
		const payment = edited[2];
		if (payment?.type !== "payment.recorded")
			throw new Error("expected a payment");
		payment.reference = "TX-2";
		const rewritten = clone(links);
		linkAt(rewritten, 2).event_hash = await eventHash(payment);
		expect(await verifyChain(edited, rewritten)).toEqual({
			ok: false,
			reason: "broken_link",
			seq: 4,
		});
	});

	it("gives every kind of failure its own reason", async () => {
		const links = await buildChain(events);
		const reasons = new Set<string>();
		const record = (verdict: Awaited<ReturnType<typeof verifyChain>>): void => {
			if (!verdict.ok) reasons.add(verdict.reason);
		};
		record(await verifyChain(events, links.slice(1)));
		record(await verifyChain(events, [...links, linkAt(links, 0)]));
		record(
			await verifyChain(events, [...links, { ...linkAt(links, 0), seq: 99 }]),
		);
		record(await verifyChain(events, links, "other"));
		expect(reasons.size).toBe(4);
	});
});
