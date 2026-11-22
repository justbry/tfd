// SPDX-License-Identifier: Apache-2.0
/**
 * The per-note hash chain (docs/specs/promissory-notes.md, build step 3). One link per event, in recording order
 * (`seq`). Each link names its event by id and hash and the hash of the link before it, so editing, reordering, dropping
 * or inserting an event changes every later link. The chain reads `seq` and the event's own bytes only: `value_date` is
 * a payload field and `entered_at` is never consulted for ordering.
 */
import { canonicalJson, sha256Hex } from "./canonical.js";
import type { NoteEvent } from "./types.js";

/** What the genesis hash is made from, followed by the note id. */
export const CHAIN_GENESIS_PREFIX = "tfd.note-chain.v1:";

export interface ChainLink {
	/** The event's per-note sequence number; link `n` is the n-th link. */
	seq: number;
	event_id: string;
	/** sha256 hex of the event's canonical JSON. */
	event_hash: string;
	/** The hash of the previous link (`linkHash`), or the note's genesis hash on link 1. */
	prev_hash: string;
}

export interface ChainHead {
	/** The seq of the last link. */
	seq: number;
	/** `linkHash` of the last link. */
	head_hash: string;
}

export type ChainVerdict =
	| { ok: true }
	| { ok: false; reason: ChainFailure; seq?: number };

/** Why a chain did not verify. Each is a different kind of tampering or mistake; the strings are stable. */
export type ChainFailure =
	| "events_out_of_order"
	| "mixed_note_ids"
	| "wrong_note_id"
	| "duplicated_link"
	| "links_out_of_order"
	| "missing_link"
	| "extra_link"
	| "link_event_mismatch"
	| "event_hash_mismatch"
	| "wrong_genesis"
	| "broken_link";

/** The `prev_hash` of link 1 for a note: sha256 of `tfd.note-chain.v1:` and the note id. Binds a chain to its note. */
export const genesisHash = (noteId: string): Promise<string> =>
	sha256Hex(`${CHAIN_GENESIS_PREFIX}${noteId}`);

/** sha256 hex of an event's canonical JSON. Throws when the event holds a value canonical JSON refuses. */
export const eventHash = (event: NoteEvent): Promise<string> =>
	sha256Hex(canonicalJson(event));

/** The hash the next link carries as `prev_hash`: sha256 of the link's canonical JSON. */
export const linkHash = (link: ChainLink): Promise<string> =>
	sha256Hex(
		canonicalJson({
			seq: link.seq,
			event_id: link.event_id,
			event_hash: link.event_hash,
			prev_hash: link.prev_hash,
		}),
	);

const FIRST_SEQ = 1;

/** Events in recording order. `events` should already have passed `validateStream`. */
const bySeq = (events: readonly NoteEvent[]): NoteEvent[] =>
	[...events].sort((left, right) => left.seq - right.seq);

/**
 * The chain of a validated stream: one link per event, ordered by `seq` (so the order the caller passes events in does
 * not matter). Throws on an empty stream, events of more than one note, or a `seq` that is not 1 to n.
 */
export const buildChain = async (
	events: readonly NoteEvent[],
): Promise<ChainLink[]> => {
	const ordered = bySeq(events);
	const [first] = ordered;
	if (first === undefined) {
		throw new Error("buildChain: a chain needs at least one event");
	}
	let previous = await genesisHash(first.note_id);
	const links: ChainLink[] = [];
	for (const [index, event] of ordered.entries()) {
		if (event.note_id !== first.note_id) {
			throw new Error(
				`buildChain: event ${event.id} is for note ${event.note_id}, not ${first.note_id}`,
			);
		}
		if (event.seq !== index + FIRST_SEQ) {
			throw new Error(
				`buildChain: expected seq ${index + FIRST_SEQ}, got ${event.seq} (event ${event.id})`,
			);
		}
		const link: ChainLink = {
			seq: event.seq,
			event_id: event.id,
			event_hash: await eventHash(event),
			prev_hash: previous,
		};
		links.push(link);
		previous = await linkHash(link);
	}
	return links;
};

/** The head of a chain: the last link's seq and `linkHash`. Throws on an empty chain. */
export const chainHead = async (
	links: readonly ChainLink[],
): Promise<ChainHead> => {
	const last = links[links.length - 1];
	if (last === undefined) {
		throw new Error("chainHead: an empty chain has no head");
	}
	return { seq: last.seq, head_hash: await linkHash(last) };
};

/**
 * `links` with one more link for `newEvent`. The event must be the next in sequence (seq `links.length + 1`); on an
 * empty chain it must be seq 1, and the link binds to the note's genesis hash. Returns a new array.
 */
export const extendChain = async (
	links: readonly ChainLink[],
	newEvent: NoteEvent,
): Promise<ChainLink[]> => {
	const expectedSeq = links.length + FIRST_SEQ;
	if (newEvent.seq !== expectedSeq) {
		throw new Error(
			`extendChain: expected seq ${expectedSeq}, got ${newEvent.seq}`,
		);
	}
	const last = links[links.length - 1];
	const link: ChainLink = {
		seq: newEvent.seq,
		event_id: newEvent.id,
		event_hash: await eventHash(newEvent),
		prev_hash:
			last === undefined
				? await genesisHash(newEvent.note_id)
				: await linkHash(last),
	};
	return [...links, link];
};

const fail = (reason: ChainFailure, seq?: number): ChainVerdict =>
	seq === undefined ? { ok: false, reason } : { ok: false, reason, seq };

/** What is wrong with the seq of `links[index]` when it is not `index + 1`. */
const linkSeqFailure = (
	links: readonly ChainLink[],
	index: number,
): ChainVerdict => {
	const expected = index + FIRST_SEQ;
	const actual = links[index]?.seq;
	const seenBefore = links.slice(0, index).some((link) => link.seq === actual);
	if (seenBefore) return fail("duplicated_link", expected);
	const comesLater = links
		.slice(index + 1)
		.some((link) => link.seq === expected);
	if (comesLater) return fail("links_out_of_order", expected);
	if (actual !== undefined && actual > expected) {
		return fail("missing_link", expected);
	}
	return fail("links_out_of_order", expected);
};

const checkEventsShape = (
	events: readonly NoteEvent[],
	expectedNoteId: string | undefined,
): ChainVerdict | undefined => {
	const [first] = events;
	if (first === undefined) return fail("missing_link", FIRST_SEQ);
	if (expectedNoteId !== undefined && first.note_id !== expectedNoteId) {
		return fail("wrong_note_id", first.seq);
	}
	for (const [index, event] of events.entries()) {
		if (event.note_id !== first.note_id) {
			return fail("mixed_note_ids", event.seq);
		}
		if (event.seq !== index + FIRST_SEQ) {
			return fail("events_out_of_order", index + FIRST_SEQ);
		}
	}
	return undefined;
};

/**
 * Recomputes the chain from `events` (which must be given in `seq` order, as `validateStream` returns them) and checks
 * `links` against it, link by link. The first problem found is returned with the `seq` it was found at:
 *
 * - `events_out_of_order`: the events are not seq 1 to n in order (for example two were swapped).
 * - `mixed_note_ids` / `wrong_note_id`: the events are not all one note, or not the note `expectedNoteId` names.
 * - `duplicated_link`, `links_out_of_order`, `missing_link`: the link seqs are not 1 to n.
 * - `extra_link`: more links than events (a forged appended link); `duplicated_link` when the extra link repeats a seq.
 * - `link_event_mismatch`: a link names a different event id than the event at its seq.
 * - `event_hash_mismatch`: an event was edited after it was chained.
 * - `wrong_genesis`: link 1 is not bound to this note's genesis hash.
 * - `broken_link`: a link's `prev_hash` is not the hash of the link before it.
 *
 * A chain whose last event was edited and whose last link was rewritten to match verifies on its own; the head seal
 * (a signed `note.chain-seal`) is what pins the head.
 */
export const verifyChain = async (
	events: readonly NoteEvent[],
	links: readonly ChainLink[],
	expectedNoteId?: string,
): Promise<ChainVerdict> => {
	const shapeProblem = checkEventsShape(events, expectedNoteId);
	if (shapeProblem !== undefined) return shapeProblem;
	const [first] = events;
	if (first === undefined) return fail("missing_link", FIRST_SEQ);
	let previous = await genesisHash(first.note_id);
	for (const [index, event] of events.entries()) {
		const link = links[index];
		if (link === undefined) return fail("missing_link", index + FIRST_SEQ);
		if (link.seq !== index + FIRST_SEQ) return linkSeqFailure(links, index);
		if (link.event_id !== event.id) {
			return fail("link_event_mismatch", link.seq);
		}
		if (link.event_hash !== (await eventHash(event))) {
			return fail("event_hash_mismatch", link.seq);
		}
		if (link.prev_hash !== previous) {
			return fail(index === 0 ? "wrong_genesis" : "broken_link", link.seq);
		}
		previous = await linkHash(link);
	}
	const extra = links[events.length];
	if (extra !== undefined) {
		const repeatsEarlierSeq = extra.seq <= events.length;
		return fail(
			repeatsEarlierSeq ? "duplicated_link" : "extra_link",
			events.length + FIRST_SEQ,
		);
	}
	return { ok: true };
};
