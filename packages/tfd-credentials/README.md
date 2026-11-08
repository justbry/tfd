# tfd-credentials

Issue and verify **Open Badges 3.0** credentials as **W3C Verifiable Credentials 2.0** with **Data Integrity** proofs,
`eddsa-rdfc-2022` (Ed25519 over RDF canonicalisation, the one 1EdTech certifies) and/or `eddsa-jcs-2022` (Ed25519
over RFC 8785 JCS), and revoke or suspend them with a **Bitstring Status List**.

It is a pure library: no I/O, no clock and no randomness inside. The caller injects `now` (ms), entropy
(`randomBytes`), a `Signer`, DID and status list resolvers, and stores. `src/` loads unchanged in Bun, Node 20+,
Cloudflare Workers and browsers (no `node:` imports, no `Buffer`, no `eval` or `new Function`; a test enforces it).

The first use: "Certified by the URLU Institute" certificates at three levels, Participant, Coach and Mediator
(`urluLevels`).

## One library, three consumers

The issue, verify and status logic must be the same everywhere, so it lives here and only storage differs:

| Consumer | Storage | Uses |
| --- | --- | --- |
| Trifold (this repo) | atm's `Store` (R2, or the folder store locally), a per-org Durable Object | issue, revoke, publish status lists, verify |
| Buzz (relay + TS clients) | none | verify in clients and browsers |
| buzz-school family-service | Workers with SQLite in Durable Objects, R2 | issue, a public verify page |

## Ports

| Port | Shape | Notes |
| --- | --- | --- |
| `Signer` | `{ keyId: string; sign(bytes: Uint8Array): Promise<Uint8Array> }` | `keyId` is the verification method, e.g. `did:web:urlu.example#key-1`. A KMS-held or org-held key both fit; the library never sees a private key. `sign` returns the 64-byte Ed25519 signature. |
| `DidResolver` | `(did) => Promise<DidDocument>` | `composeDidResolver({ fetchJson })` does `did:key` in-process and `did:web` through your fetch (and cache). |
| `StatusListResolver` | `(url) => Promise<unknown>` | Returns the status list credential JSON. Verification checks its proof, issuer, validity and purpose. |
| `RandomBytes` | `(length) => Uint8Array` | `crypto.getRandomValues(new Uint8Array(length))` in production. Used for status indexes and `credentialIdFromRandom`. |
| `CredentialStore` | `put` (create-only), `get(id)`, `list({ holder?, level? })` | Credentials are immutable; status lives in the lists. |
| `StatusListStore` | `get(id) → { value, etag }`, `putIfAbsent`, `putIfMatch(id, record, etag)` | Every bit flip is read, recompute, put-if-match; a `conflict` re-reads, so two writers never clobber each other. |

Shipped implementations: `memoryCredentialStore`, `memoryStatusListStore`, and the `ObjectStore` adapters below.
`tfd-credentials/testing` exports `credentialStoreContract(makeStore)` and `statusListStoreContract(makeStore)`:
framework-free lists of `{ name, run }` cases that every adapter must pass, plus test-only `createTestKey(label)`,
`seededRandomBytes(label)` and `memoryObjectStore()`.

## Proof suites

| Suite | Entry | Certifiable by 1EdTech | Notes |
| --- | --- | --- | --- |
| `eddsa-rdfc-2022` | `tfd-credentials/rdfc` | **Yes**: Certification Guide 1.5 §3.1.1 (issuers) and §4.2.1 (verifiers) list only `eddsa-rdfc-2022` and `ecdsa-sd-2023` for Linked Data Proofs | JSON-LD → RDFC-1.0 N-Quads, JSON-LD safe mode, bundled contexts only. About 36 KB gzipped on top of the core. |
| `eddsa-jcs-2022` | `tfd-credentials` | No (not listed in the guide) | JSON as written; no JSON-LD. The default of the main entry, so verify-only consumers pay nothing for JSON-LD. |

Suites are a port (`ProofSuite`, keyed by `cryptosuite`); `addProof`, `addProofSet`, `inspectProof`, `issue`,
`ensureStatusList`, `revoke` and `verifyCredential` take them as options. `ecdsa-sd-2023` is not implemented.

- **New OB3 credentials default to rdfc** through `issueCertifiable` from `tfd-credentials/rdfc`
  (`proofSuites: RDFC_AND_JCS_PROOFS` attaches both). The main entry's `issue` keeps JCS as its default so it never
  loads JSON-LD. Publish status lists with the same suite (`ensureStatusList({ proofSuites: CERTIFIABLE_PROOF_SUITES })`):
  a verifier checks the list's proof too. A list is re-signed with the suites it already has; `revoke` refuses
  (`cryptosuite_unsupported`) rather than swap them when you do not pass `suites: RDFC_AND_JCS_SUITES`.
- **Offline contexts.** rdfc processes JSON-LD with a document loader over bundled contexts only: VC 2.0
  (`credentials/v2`), Open Badges `context-3.0.3.json` and `security/data-integrity/v2`. The first and last are
  byte-identical to the SHA2-256 digests VC DM 2.0 §B.1 and VC Data Integrity §2.4 publish; 1EdTech publishes none for
  OB3. Nothing is ever fetched. A document naming any other context fails with `context_unknown`; a term no context
  defines fails with `term_undefined` (jsonld.js safe mode, which 1EdTech's guide requires). `createRdfcSuite({ contexts
  })` adds vetted contexts; the main entry's structural check still refuses contexts beyond VC 2.0 and OB3 unless
  `extraContexts` allows them.
- **Proof sets.** VC Data Integrity §2.1.1 allows a set (an unordered array of proofs) and §4.5 verifies a set only if
  every proof verifies. This library's rule: every proof of a suite in the verifier's `suites` registry must pass
  signature and issuer-key checks; a proof of another type or an unregistered cryptosuite is reported in
  `result.proofs` as `unsupported` and skipped; a credential with no proof of a registered suite fails
  (`cryptosuite_unsupported`). Each proof covers the document without `proof`. Proof chains (`previousProof`) are
  refused. 1EdTech's guide does not say whether a certifiable badge may carry more than one proof.

## Issue and verify

```ts
import {
	composeDidResolver, ensureStatusList, issue, issuerProfile, memoryCredentialStore,
	memoryStatusListStore, publicView, revoke, urluLevels, verifyCredential, credentialIdFromRandom,
} from "tfd-credentials";

const now = Date.now(); // the caller's clock
const randomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));
const signer = myKmsSigner("did:web:urlu.example#key-1"); // your Signer
const statusLists = memoryStatusListStore();
const credentials = memoryCredentialStore();
const listId = "https://urlu.example/status/revocation/1";

await ensureStatusList({ store: statusLists, id: listId, issuer: "did:web:urlu.example", statusPurpose: "revocation", signer, now });

const { credential, event } = await issue({
	kind: "achievement", // or "standing": the annual listing, validUntil one year out
	credential: {
		id: credentialIdFromRandom(randomBytes),
		issuer: issuerProfile({ id: "did:web:urlu.example", name: "URLU Institute" }),
		level: urluLevels("https://urlu.example/achievements").Mediator,
		holder: { reference: { value: memberId, salt: perHolderSalt } }, // no DID, no email needed
	},
	now, signer, randomBytes,
	statusList: { store: statusLists, id: listId },
	credentials, holderKey: memberId,
	actor: staffAccountId, onBehalfOf: orgId,
});
await journal.append(event); // the library only builds the audit event

const result = await verifyCredential(credential, {
	now,
	resolveDid: composeDidResolver({ fetchJson: (url) => fetch(url).then((r) => r.json()) }),
	resolveStatusList: (url) => fetch(url).then((r) => r.json()),
});
// result.verified: structure, signature, issuer key and validity period passed
// result.status: "valid" | "revoked" | "suspended" | "unchecked"
// result.checks.{structure,signature,issuerKey,validity,status}: each with a machine-readable reason on failure

await revoke({ credential, now, signer, statusLists, actor: staffAccountId });
const page = publicView(result); // only level, achievement name, issue date, validUntil, status, issuer name
```

Publish each status list's `record.value.credential` at its id URL (cacheable; it is signed) and your `did:web`
document (`buildDidWebDocument`) at `didWebToUrl(did)`.

## Plugging in storage

### 1. atm's `Store` (R2, folder) through the ObjectStore adapter

`ObjectStore` is a structural subset of atm's `Store` (`get`, `putIfAbsent`, `putIfMatch`, `list`; errors recognised
by name: `NotFound`, `AlreadyExists`, `Stale`), so an atm `R2Store` or `FolderStore` plugs in as it is:

```ts
import { R2Store } from "atm";
import { objectStoreCredentialStore, objectStoreStatusListStore } from "tfd-credentials";

const store = new R2Store({ endpoint, bucket, accessKeyId, secretAccessKey });
const credentials = objectStoreCredentialStore(store, { prefix: `orgs/${orgId}/` });
const statusLists = objectStoreStatusListStore(store, { prefix: `orgs/${orgId}/` });
```

Bodies are RFC 8785 JSON, so equal records are equal bytes and atm's sha256 content identity holds; keys are the
SHA-256 hex of the id. A `putIfMatch` retried after a timeout whose first try landed reads back as written (atm's
`replaceIfMatch` rule). `list` scans: an object store has no index, so filter-heavy callers should keep their own.
The test suite runs both contract suites against atm's real `FolderStore`.

### 2. SQLite in a Durable Object (buzz-school, Trifold's per-org DO)

Not shipped; implement the two ports over `ctx.storage.sql`. Suggested tables:

```sql
CREATE TABLE credential (
  id TEXT PRIMARY KEY,          -- the urn:uuid
  body TEXT NOT NULL,           -- canonical JSON of the StoredCredential
  holder TEXT,                  -- the caller's opaque holder key, nullable
  level TEXT                    -- achievement.humanCode
);
CREATE INDEX credential_holder ON credential (holder);
CREATE INDEX credential_level ON credential (level);

CREATE TABLE status_list (
  id TEXT PRIMARY KEY,          -- the list credential URL
  body TEXT NOT NULL,           -- canonical JSON of the StatusListRecord
  revision INTEGER NOT NULL     -- the etag: putIfMatch is UPDATE ... WHERE id = ? AND revision = ?
);
```

`put` is `INSERT ... ON CONFLICT DO NOTHING`, then compare bodies for `existing` versus `conflict`. A Durable Object
serialises its own requests, but the etag still matters when one request reads, awaits, and writes. Prove it:

```ts
import { credentialStoreContract, statusListStoreContract } from "tfd-credentials/testing";
for (const { name, run } of statusListStoreContract(() => sqliteStatusListStore(freshDatabase()))) test(name, run);
```

### 3. Verify only: a browser, a Buzz client, a public verify page

No stores and no signer: `verifyCredential` with `composeDidResolver({ fetchJson })` and, when online, a
`resolveStatusList` that fetches the list URL (through a cache or proxy, so the issuer does not see who checks). Then
`publicView(result)` for display. In Bun the package resolves to `src/` (the `bun` export condition); everywhere else
to `dist/` (browser-target ESM; `@noble/*` are its only runtime dependencies, and `dist/rdfc.js` carries jsonld
bundled). Verify-only clients that accept rdfc import `RDFC_AND_JCS_SUITES` from `tfd-credentials/rdfc` and pass it as
`suites`.

## What a result means

- **Offline semantics.** Without a status resolver, or when a list cannot be fetched or trusted, a credential can be
  `verified: true` with `status: "unchecked"`: valid when issued, status unchecked. It is never reported `valid`
  without a verified, current status list. A credential with no status entry is `unchecked` too.
- **A certificate proves the URLU Institute issued it, not who is holding it.** Anyone can show a copy. Binding to a
  person is out of band (the holder's reference hash, or a DID the holder controls).
- `status` is a separate field from `verified` on purpose: a revoked credential still verifies as authentic.
- Status lists signed by another issuer are refused unless `acceptStatusIssuer` allows them.

## Privacy defaults

- `credentialSubject.id` is optional: holders may be children with no key. Without it the holder is an OB3
  `IdentityObject` with a salted SHA-256 of an opaque reference the caller chooses (`identityType: "identifier"`).
  Email-like values are refused.
- The name is optional (a plain `IdentityObject` of type `name`) and appears in `publicView` only with
  `{ includeName: true }`.
- Credential ids are caller-supplied random `urn:uuid:` values (`credentialIdFromRandom`); the builder refuses others.
- Evidence is a pointer plus `digestMultibase` (`evidencePointer`, `sha256DigestMultibase`), never the content.
- Status indexes are random (BSL §2.1), so an index says nothing about issue order or list size.
- Audit events carry ids and the actor's opaque id only.

## Achievement versus standing

`buildAchievementCredential` makes the permanent certificate (no `validUntil`, revocation entry by default).
`buildStandingCredential` makes the annual listing from the same `LevelDefinition`: its own Achievement
(`<achievement id>/standing`, `achievementType: "Membership"`), `validUntil` one calendar year after `validFrom`, and a
suspension entry by default, so a listing can be suspended and reinstated. Same types, different template.

**Levels.** OB3 has no level property; the level label is carried in `Achievement.humanCode`.

## Specifications

Verified against the published text on 2026-11-07:

| Spec | Version | Used for |
| --- | --- | --- |
| [W3C VC Data Model 2.0](https://www.w3.org/TR/vc-data-model-2.0/) | Recommendation, 15 May 2025 | `@context` first item, `validFrom`/`validUntil` (dateTimeStamp), `credentialStatus`, `evidence` |
| [W3C VC Data Integrity 1.0](https://www.w3.org/TR/vc-data-integrity/) | Recommendation, 15 May 2025 | §2.1 proof members, §2.3 `digestMultibase`, §4.4 Verify Proof |
| [W3C Data Integrity EdDSA Cryptosuites 1.0](https://www.w3.org/TR/vc-di-eddsa/) | Recommendation, 15 May 2025 | §3.2 `eddsa-rdfc-2022` and §3.3 `eddsa-jcs-2022`; Appendix B.1 and B.2 (rdfc) and B.3 (jcs) vectors verified in `tests/rdfc.test.ts` and `tests/proof.test.ts` |
| [1EdTech OB3 Conformance and Certification Guide](https://www.imsglobal.org/spec/ob/v3p0/cert/) | Final Release, document 1.5, 15 June 2026 | §3.1.1 and §4.2.1 supported proof mechanisms; JSON-LD safe mode |
| [W3C RDF Dataset Canonicalization (RDFC-1.0)](https://www.w3.org/TR/rdf-canon/) | Recommendation | through jsonld.js 9.0.0 and rdf-canonize 5.0.0 (Digital Bazaar) |
| [W3C Bitstring Status List 1.0](https://www.w3.org/TR/vc-bitstring-status-list/) | Recommendation, 15 May 2025 | 131,072-entry (16KB) minimum, left-most bit is index 0, GZIP then base64url multibase, random indexes |
| [W3C Controlled Identifiers 1.0](https://www.w3.org/TR/cid-1.0/) | Recommendation | Multikey (`0xed01` prefix), §3.3 Retrieve Verification Method |
| [1EdTech Open Badges 3.0](https://www.imsglobal.org/spec/ob/v3p0/) | Final Release, document 1.4.5, 29 June 2026 | context `https://purl.imsglobal.org/spec/ob/v3p0/context-3.0.3.json`, `OpenBadgeCredential`, Achievement, Profile, IdentityObject, one `credentialStatus` |
| [RFC 8785 JCS](https://www.rfc-editor.org/rfc/rfc8785) | June 2020 | canonicalisation; §3.2 samples and Appendix B number vectors in `tests/canonical.test.ts` |
| [did:web](https://w3c-ccg.github.io/did-method-web/) | CCG draft | id to URL mapping |
| [did:key](https://w3c-ccg.github.io/did-key-spec/) | CCG draft | Ed25519 expansion |

## Known limits

- A credential with only a JCS proof is not certifiable and fails in OB3 verifiers that check only rdfc; use rdfc.
- The rdfc bundle contains jsonld's default XMLHttpRequest document loader as dead code; it never runs, since every
  call passes the offline loader. `dist/rdfc.js` replaces rdf-canonize's `setimmediate` polyfill (whose source holds a
  `new Function`) with a timer, and the build fails if any output contains `new Function` or `eval(`.
- OB3 allows one `credentialStatus`, so a credential carries a revocation or a suspension entry, not both.
- Status lists are re-signed with `validFrom = now` on every change but carry no `validUntil`, so a verifier handed an
  older signed copy of a list cannot tell it is stale. Fetch lists from the issuer's URL, not from the holder.
- Proof chains (`previousProof`) are refused; the synchronous `checkProof` reads a single JCS proof only.
- Ed25519 verification is RFC 8032 strict (not ZIP-215), so every consumer accepts exactly the same signatures.
- Key custody, who may revoke, HTTP, PDF/PNG baking and other proof formats are the caller's or out of scope.

## Development

```sh
bun test          # unit, contract, end-to-end, tamper, spec-vector and dist (Node) tests
bun run ts        # tsc on src+tests, and on src alone with web-platform types only
bun run build     # dist/: index.js, rdfc.js, testing.js, shared chunks, .d.ts per module
```
