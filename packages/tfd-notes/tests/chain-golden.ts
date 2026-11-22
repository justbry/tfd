// SPDX-License-Identifier: Apache-2.0
/**
 * The golden runners for the `chain` and `documents` vector folders. They are async (hashing is WebCrypto); the results
 * are passed through canonical JSON so the comparison does not depend on key order, which is what a second implementation
 * can reproduce. The expected files come from tests/golden/generate_note_vectors.py, which shares no code with src.
 */
import { canonicalJson } from "../src/canonical";
import { buildChain, chainHead, genesisHash } from "../src/chain";
import {
	chainSealBody,
	type DocumentParties,
	documentSha256,
	paymentReceiptBody,
	payoffStatementBody,
	releaseBody,
	signDocument,
} from "../src/documents";
import { validateStream } from "../src/events";
import type { CivilDate } from "../src/types";
import { makeTestSigner } from "./note-signer";

interface ChainInput {
	events: unknown[];
}

interface DocumentsInput {
	events: unknown[];
	payment_event_id: string;
	as_of: CivilDate;
	release_event_id: string;
	issued_at: string;
	sealed_at: string;
	parties: DocumentParties;
	test_keys: { receipt: string; seal: string };
}

const normalised = (value: unknown): unknown =>
	JSON.parse(canonicalJson(value));

export const chainRunner = async (input: unknown): Promise<unknown> => {
	const { events } = input as ChainInput;
	const stream = validateStream(events);
	const links = await buildChain(stream);
	const [first] = stream;
	return normalised({
		note_id: first?.note_id,
		genesis_hash: await genesisHash(first?.note_id ?? ""),
		event_hashes: links.map((link) => link.event_hash),
		links,
		head: await chainHead(links),
	});
};

export const documentsRunner = async (input: unknown): Promise<unknown> => {
	const given = input as DocumentsInput;
	const stream = validateStream(given.events);
	const chain = await buildChain(stream);
	const receiptSigner = await makeTestSigner(
		given.test_keys.receipt,
		"receipt",
	);
	const sealSigner = await makeTestSigner(given.test_keys.seal, "seal");
	const bodies = {
		payment_receipt: await paymentReceiptBody(
			stream,
			given.payment_event_id,
			chain,
			given.issued_at,
			given.parties,
		),
		payoff_statement: await payoffStatementBody(
			stream,
			given.as_of,
			chain,
			given.issued_at,
			given.parties,
		),
		release: await releaseBody(
			stream,
			given.release_event_id,
			chain,
			given.issued_at,
			given.parties,
		),
		chain_seal: await chainSealBody(
			stream[0]?.note_id ?? "",
			chain,
			given.sealed_at,
		),
	};
	return normalised({
		public_keys: {
			[receiptSigner.keyId]: receiptSigner.publicKeyHex,
			[sealSigner.keyId]: sealSigner.publicKeyHex,
		},
		document_sha256: {
			payment_receipt: await documentSha256(bodies.payment_receipt),
			payoff_statement: await documentSha256(bodies.payoff_statement),
			release: await documentSha256(bodies.release),
			chain_seal: await documentSha256(bodies.chain_seal),
		},
		documents: {
			payment_receipt: await signDocument(
				bodies.payment_receipt,
				receiptSigner,
			),
			payoff_statement: await signDocument(
				bodies.payoff_statement,
				receiptSigner,
			),
			release: await signDocument(bodies.release, receiptSigner),
			chain_seal: await signDocument(bodies.chain_seal, sealSigner),
		},
	});
};
