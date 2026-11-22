// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import chainSchema from "../schema/note-chain.v1.json";
import documentSchema from "../schema/note-document.v1.json";
import {
	canonicalJson,
	fromBase64Url,
	sha256Hex,
	utf8Bytes,
} from "../src/canonical";
import { buildChain, type ChainLink } from "../src/chain";
import {
	chainSealBody,
	type DocumentParties,
	documentBody,
	documentSha256,
	type NoteDocumentBody,
	paymentReceiptBody,
	payoffStatementBody,
	releaseBody,
	type SignedDocument,
	signDocument,
} from "../src/documents";
import { validateStream } from "../src/events";
import type { NoteEvent } from "../src/types";
import smallNote from "./golden/documents/small-note.input.json";
import {
	makeTestSigner,
	TEST_RECEIPT_KEY_ID,
	TEST_SEAL_KEY_ID,
} from "./note-signer";

const ISSUED_AT = "2026-03-05T12:00:00Z";
const SEALED_AT = "2026-03-05T12:00:01Z";
const PARTIES: DocumentParties = {
	lender_ref: "party-lender-1",
	borrower_ref: "party-borrower-1",
};
const BANNED_WORDS = /proof|enforceable|binding|tamper-proof|legally/i;

const events: NoteEvent[] = validateStream(smallNote.events);
const receiptSigner = await makeTestSigner(TEST_RECEIPT_KEY_ID, "receipt");
const sealSigner = await makeTestSigner(TEST_SEAL_KEY_ID, "seal");

const allBodies = async (
	stream: NoteEvent[],
	chain: ChainLink[],
	paymentId: string,
	releaseId: string,
): Promise<NoteDocumentBody[]> => [
	await paymentReceiptBody(stream, paymentId, chain, ISSUED_AT, PARTIES),
	await payoffStatementBody(stream, "2026-03-31", chain, ISSUED_AT, PARTIES),
	await releaseBody(stream, releaseId, chain, ISSUED_AT, PARTIES),
	await chainSealBody("note-demo-1", chain, SEALED_AT),
];

const signAll = async (
	bodies: NoteDocumentBody[],
): Promise<SignedDocument[]> => {
	const signed: SignedDocument[] = [];
	for (const body of bodies) {
		signed.push(
			await signDocument(
				body,
				body.type === "note.chain-seal" ? sealSigner : receiptSigner,
			),
		);
	}
	return signed;
};

const propertyNames = (
	value: unknown,
	names: Set<string> = new Set(),
): Set<string> => {
	if (Array.isArray(value)) {
		for (const item of value) propertyNames(item, names);
	} else if (typeof value === "object" && value !== null) {
		for (const [key, child] of Object.entries(value)) {
			if (key === "properties" && typeof child === "object" && child !== null) {
				for (const name of Object.keys(child)) names.add(name);
			}
			propertyNames(child, names);
		}
	}
	return names;
};

const keysOf = (value: unknown, keys: Set<string> = new Set()): Set<string> => {
	if (Array.isArray(value)) {
		for (const item of value) keysOf(item, keys);
	} else if (typeof value === "object" && value !== null) {
		for (const [key, child] of Object.entries(value)) {
			keys.add(key);
			keysOf(child, keys);
		}
	}
	return keys;
};

const ajv = new Ajv2020({ strict: true, allErrors: true });
ajv.addSchema(chainSchema);
ajv.addSchema(documentSchema);
const documentId = documentSchema.$id;
const validateBody: ValidateFunction = ajv.getSchema(
	documentId,
) as ValidateFunction;
const validateSigned: ValidateFunction = ajv.getSchema(
	`${documentId}#/$defs/signed_document`,
) as ValidateFunction;
const validateLink: ValidateFunction = ajv.getSchema(
	`${chainSchema.$id}#/$defs/link`,
) as ValidateFunction;

describe("document bodies", () => {
	it("builds a payment receipt from engine figures", async () => {
		const chain = await buildChain(events);
		const body = await paymentReceiptBody(
			events,
			"evt-6",
			chain,
			ISSUED_AT,
			PARTIES,
		);
		expect(body).toMatchObject({
			schema: "tfd.note-document.v1",
			type: "note.payment-receipt",
			engine_version: "tfd-notes/1",
			note_id: "note-demo-1",
			payment_event_id: "evt-6",
			kind: "payment",
			amount_minor: "20000",
			currency: "USD",
			exponent: 2,
			value_date: "2026-01-20",
			recorded_by: "borrower",
			via: "email-link",
			status: "claimed by borrower",
			issued_at: ISSUED_AT,
			parties: PARTIES,
		});
		expect(body.chain_head.seq).toBe(events.length);
		expect(BigInt(body.lender_payoff_minor)).toBeGreaterThan(
			BigInt(body.borrower_payoff_minor),
		);
	});

	it("labels the payment's status from the statement's wording", async () => {
		const chain = await buildChain(events);
		const labelOf = async (id: string): Promise<string> =>
			(await paymentReceiptBody(events, id, chain, ISSUED_AT)).status;
		expect(await labelOf("evt-3")).toBe("confirmed by both parties");
		expect(await labelOf("evt-6")).toBe("claimed by borrower");
		expect(await labelOf("evt-7")).toBe("claimed by lender");
		const disputed = validateStream([
			...smallNote.events,
			{
				schema: "tfd.note-event.v1",
				id: "evt-10",
				note_id: "note-demo-1",
				seq: 10,
				entered_at: "2026-03-03T10:00:00Z",
				entered_by: "borrower",
				type: "payment.disputed",
				target: "evt-7",
				counter_amount_minor: "40000",
				reason: "I handed over less",
			},
		]);
		const disputedChain = await buildChain(disputed);
		expect(
			(await paymentReceiptBody(disputed, "evt-7", disputedChain, ISSUED_AT))
				.status,
		).toBe("disputed");
	});

	it("leaves via out when the event has none, and parties out when none are given", async () => {
		const chain = await buildChain(events);
		const body = await paymentReceiptBody(events, "evt-3", chain, ISSUED_AT);
		expect("parties" in body).toBe(false);
		const bare = validateStream(
			smallNote.events.map((raw) => {
				const { via: _via, ...rest } = raw;
				return rest;
			}),
		);
		const bareChain = await buildChain(bare);
		expect(
			"via" in (await paymentReceiptBody(bare, "evt-3", bareChain, ISSUED_AT)),
		).toBe(false);
	});

	it("builds a payoff statement with both views and the gap", async () => {
		const chain = await buildChain(events);
		const body = await payoffStatementBody(
			events,
			"2026-03-31",
			chain,
			ISSUED_AT,
		);
		expect(body.as_of).toBe("2026-03-31");
		expect(body.wording).toBe(
			"Computed by tfd-notes from the recorded events. A record, not legal or tax advice.",
		);
		expect(Object.keys(body.lender).sort()).toEqual([
			"interest_minor",
			"payoff_minor",
			"principal_minor",
		]);
		expect(BigInt(body.payoff_gap_minor)).toBe(
			BigInt(body.lender.payoff_minor) - BigInt(body.borrower.payoff_minor),
		);
	});

	it("builds a release that states what the lender said, not that the note was paid", async () => {
		const chain = await buildChain(events);
		const body = await releaseBody(events, "evt-9", chain, ISSUED_AT);
		expect(body.type).toBe("note.release");
		expect(body.release_event_id).toBe("evt-9");
		expect(body.as_of).toBe("2026-03-02");
		expect(body.wording).toBe("The lender states this note is released.");
		expect(body.released_with_balance).toBe(true);
		expect(BigInt(body.balance_at_release_minor)).toBeGreaterThan(0n);
		expect(JSON.stringify(body)).not.toMatch(/paid in full/i);
	});

	it("marks a release with no balance as released without one", async () => {
		const zero = validateStream([
			{
				...clone(smallNote.events[0]),
				terms: { ...clone(smallNote.events[0]?.terms), annual_rate: "0" },
			},
			{
				schema: "tfd.note-event.v1",
				id: "evt-2",
				note_id: "note-demo-1",
				seq: 2,
				entered_at: "2026-01-10T10:00:00Z",
				entered_by: "lender",
				type: "payment.recorded",
				kind: "payment",
				amount_minor: "100000",
				value_date: "2026-01-10",
			},
			{
				schema: "tfd.note-event.v1",
				id: "evt-3",
				note_id: "note-demo-1",
				seq: 3,
				entered_at: "2026-01-11T10:00:00Z",
				entered_by: "lender",
				type: "release.drafted",
			},
			{
				schema: "tfd.note-event.v1",
				id: "evt-4",
				note_id: "note-demo-1",
				seq: 4,
				entered_at: "2026-01-12T10:00:00Z",
				entered_by: "lender",
				type: "release.confirmed",
				target: "evt-3",
			},
		]);
		const chain = await buildChain(zero);
		const body = await releaseBody(zero, "evt-4", chain, ISSUED_AT);
		expect(body.balance_at_release_minor).toBe("0");
		expect(body.released_with_balance).toBe(false);
		expect(validateBody(body)).toBe(true);
	});

	it("names the chain head and refuses a chain that is not these events'", async () => {
		const chain = await buildChain(events);
		await expect(
			paymentReceiptBody(events, "evt-6", chain.slice(0, -1), ISSUED_AT),
		).rejects.toThrow(/links/);
		const edited = clone(events);
		const payment = edited[5];
		if (payment?.type !== "payment.recorded")
			throw new Error("expected a payment");
		payment.amount_minor = "20001";
		await expect(
			paymentReceiptBody(edited, "evt-6", chain, ISSUED_AT),
		).rejects.toThrow(/not in the chain/);
	});

	it("refuses an unknown event id, a wrong event type and a bad instant", async () => {
		const chain = await buildChain(events);
		await expect(
			paymentReceiptBody(events, "evt-404", chain, ISSUED_AT),
		).rejects.toThrow();
		await expect(
			paymentReceiptBody(events, "evt-4", chain, ISSUED_AT),
		).rejects.toThrow(/payment.recorded/);
		await expect(
			releaseBody(events, "evt-8", chain, ISSUED_AT),
		).rejects.toThrow(/release.confirmed/);
		await expect(
			payoffStatementBody(
				events,
				"2026-03-31",
				chain,
				"2026-03-05T12:00:00+02:00",
			),
		).rejects.toThrow(/UTC instant/);
		await expect(
			chainSealBody("note-demo-1", chain, "2026-03-05"),
		).rejects.toThrow(/UTC instant/);
	});

	it("takes opaque references only, never a name or an email", async () => {
		const chain = await buildChain(events);
		const build = (parties: DocumentParties): Promise<unknown> =>
			payoffStatementBody(events, "2026-03-31", chain, ISSUED_AT, parties);
		await expect(build({ lender_ref: "maria@example.com" })).rejects.toThrow(
			/opaque/,
		);
		await expect(build({ borrower_ref: "Ana Lopez" })).rejects.toThrow(
			/opaque/,
		);
		await expect(build({ email: "a@b.c" } as DocumentParties)).rejects.toThrow(
			/lender_ref/,
		);
	});

	it("builds a chain seal of the head", async () => {
		const chain = await buildChain(events);
		const seal = await chainSealBody("note-demo-1", chain, SEALED_AT);
		const body = await payoffStatementBody(
			events,
			"2026-03-31",
			chain,
			ISSUED_AT,
		);
		expect(seal).toEqual({
			schema: "tfd.note-document.v1",
			type: "note.chain-seal",
			note_id: "note-demo-1",
			head_seq: body.chain_head.seq,
			head_hash: body.chain_head.head_hash,
			sealed_at: SEALED_AT,
		});
	});

	it("hashes a body for payoff.issued to name", async () => {
		const chain = await buildChain(events);
		const body = await payoffStatementBody(
			events,
			"2026-03-31",
			chain,
			ISSUED_AT,
		);
		const hash = await documentSha256(body);
		expect(hash).toBe(await sha256Hex(canonicalJson(body)));
		const issued = validateStream([
			...smallNote.events,
			{
				schema: "tfd.note-event.v1",
				id: "evt-10",
				note_id: "note-demo-1",
				seq: 10,
				entered_at: "2026-03-05T12:00:00Z",
				entered_by: "lender",
				type: "payoff.issued",
				as_of: "2026-03-31",
				document_sha256: hash,
			},
		]);
		expect(issued).toHaveLength(events.length + 1);
		const signed = await signDocument(body, receiptSigner);
		expect(await documentSha256(documentBody(signed))).toBe(hash);
	});
});

describe("signing", () => {
	it("signs the canonical bytes of the body with the key's purpose", async () => {
		const chain = await buildChain(events);
		const bodies = await allBodies(events, chain, "evt-6", "evt-9");
		for (const signed of await signAll(bodies)) {
			const body = documentBody(signed);
			expect(signed.signature.alg).toBe("Ed25519");
			expect(signed.signature.key_id).toBe(
				body.type === "note.chain-seal"
					? TEST_SEAL_KEY_ID
					: TEST_RECEIPT_KEY_ID,
			);
			expect(signed.signature.purpose).toBe(
				body.type === "note.chain-seal" ? "seal" : "receipt",
			);
			const signature = fromBase64Url(signed.signature.sig);
			expect(signature).toHaveLength(64);
			const verifier =
				body.type === "note.chain-seal" ? sealSigner : receiptSigner;
			expect(
				await verifier.verify(utf8Bytes(canonicalJson(body)), signature),
			).toBe(true);
		}
	});

	it("is deterministic and fails once any byte of the body changes", async () => {
		const chain = await buildChain(events);
		const body = await payoffStatementBody(
			events,
			"2026-03-31",
			chain,
			ISSUED_AT,
		);
		const first = await signDocument(body, receiptSigner);
		expect(await signDocument(body, receiptSigner)).toEqual(first);
		const tampered = { ...body, as_of: "2026-03-30" };
		expect(
			await receiptSigner.verify(
				utf8Bytes(canonicalJson(tampered)),
				fromBase64Url(first.signature.sig),
			),
		).toBe(false);
	});

	it("needs a receipt key for receipts, payoffs and releases, and a seal key for a chain seal", async () => {
		const chain = await buildChain(events);
		const [receipt, payoff, release, seal] = await allBodies(
			events,
			chain,
			"evt-6",
			"evt-9",
		);
		for (const body of [receipt, payoff, release]) {
			if (body === undefined) throw new Error("body missing");
			await expect(signDocument(body, sealSigner)).rejects.toThrow(
				/receipt key/,
			);
		}
		if (seal === undefined) throw new Error("seal missing");
		await expect(signDocument(seal, receiptSigner)).rejects.toThrow(/seal key/);
	});

	it("refuses to sign a body that already carries a signature", async () => {
		const chain = await buildChain(events);
		const body = await payoffStatementBody(
			events,
			"2026-03-31",
			chain,
			ISSUED_AT,
		);
		const signed = await signDocument(body, receiptSigner);
		await expect(signDocument(signed, receiptSigner)).rejects.toThrow(
			/already signed/,
		);
	});
});

describe("schemas and wording", () => {
	it("validates every body and every signed document", async () => {
		const chain = await buildChain(events);
		const bodies = await allBodies(events, chain, "evt-6", "evt-9");
		const signed = await signAll(bodies);
		for (const body of bodies) {
			expect(validateBody(body)).toBe(true);
			expect(validateSigned(body)).toBe(false);
		}
		for (const document of signed) {
			expect(validateBody(document)).toBe(true);
			expect(validateSigned(document)).toBe(true);
		}
		for (const link of chain) {
			expect(validateLink(link)).toBe(true);
		}
	});

	it("rejects an unknown property and a bad figure", async () => {
		const chain = await buildChain(events);
		const body = await payoffStatementBody(
			events,
			"2026-03-31",
			chain,
			ISSUED_AT,
		);
		expect(validateBody({ ...body, extra: 1 })).toBe(false);
		expect(validateBody({ ...body, payoff_gap_minor: "1.5" })).toBe(false);
		expect(validateBody({ ...body, parties: { email: "a@b.c" } })).toBe(false);
	});

	it("declares no property called email or name", () => {
		for (const schema of [documentSchema, chainSchema]) {
			const names = propertyNames(schema);
			expect(names.has("email")).toBe(false);
			expect(names.has("name")).toBe(false);
		}
	});

	it("produces bodies with no property called email or name, and none of the banned words", async () => {
		const chain = await buildChain(events);
		const signed = await signAll(
			await allBodies(events, chain, "evt-6", "evt-9"),
		);
		for (const document of signed) {
			const keys = keysOf(document);
			expect(keys.has("email")).toBe(false);
			expect(keys.has("name")).toBe(false);
			expect(JSON.stringify(document)).not.toMatch(BANNED_WORDS);
		}
	});
});

const clone = <Value>(value: Value): Value => structuredClone(value);
