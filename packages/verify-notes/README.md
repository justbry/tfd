<!-- SPDX-License-Identifier: Apache-2.0 -->
# tfd-verify-notes

Checks the signed documents and the hash chain of a Trifold promissory note offline, from the files and the public keys.
It builds on `tfd-verify` (key rules, Ed25519) and `tfd-notes` (canonical JSON, the chain). It is its own package so that
`tfd-verify`, which the website copies, stays small and does not depend on either. Apache-2.0 (`LICENSE`). Not on npm
yet (`private: true`).

Documents: `note.payment-receipt`, `note.payoff-statement`, `note.release` and `note.chain-seal` (schema
`tfd.note-document.v1`).

| Function | What it checks |
|---|---|
| `verifyNoteDocument(document, keys, { now? })` | The exact shape, the schema string, that a chain seal is signed with purpose `seal` and the other three with `receipt`, the key (published, that purpose, inside its window at `issued_at` or `sealed_at`, not revoked: the same `keyUse` rules as `tfd-verify`), the one base64url spelling of the signature, and the Ed25519 signature over the UTF-8 bytes of the body's canonical JSON (`canonicalJson` from `tfd-notes`). With `now`, a document signed after it fails `signed_in_future`. |
| `verifyNoteChain(events, links, expectedNoteId?)` | Each event and link has the right shape; then `tfd-notes` recomputes the hash chain from the events and compares it with the links. |
| `verifyNoteBundle({ events, links, documents, keys })` | The chain, every document, and that each document fits the chain: same note, the `chain_head` it names is the chain's head at that seq, a seal's head is a link head, and a receipt's or release's event hash is the hash of the event it names. |

Each verdict is `{ ok: true, ... }` or `{ ok: false, code, message }`; none throws. Codes: `not_an_object`,
`unknown_type`, `wrong_schema`, `bad_shape`, `wrong_purpose`, `unknown_key`, `bad_signature_encoding`, `bad_signature`,
`not_canonical`, `key_revoked`, `key_wrong_purpose`, `outside_key_window`, `signed_in_future`, `bad_options`; for a chain
`bad_input`, `bad_event`, `bad_link` and `chain_*` (one per `tfd-notes` reason); for a bundle `chain_not_verified`,
`note_id_mismatch`, `chain_head_unknown`, `chain_head_mismatch`, `event_not_in_chain`, `event_after_head`,
`event_hash_mismatch`, `wrong_event_type`.

A pass says the signature verifies for this key and the document is unchanged since it was signed. It does not say the
facts in the document are true: a payment receipt records what was recorded and how far the two parties agreed.

```ts
import { verifyNoteBundle } from "tfd-verify-notes";

const verdict = await verifyNoteBundle({ events, links, documents, keys });
if (!verdict.ok) console.warn(verdict.chain, verdict.documents);
```

Tests run the CC0 vectors in `packages/tfd-notes/tests/golden/{chain,documents}/` and a table of failures.
