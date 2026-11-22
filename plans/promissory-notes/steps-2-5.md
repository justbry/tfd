# Promissory notes, build steps 2 to 5: plan

Spec: `docs/specs/promissory-notes.md` (step 1 is PR #106). This plan turns build steps 2 to 5 into work packages with
file ownership. Written 2026-11-22. Nothing here deploys, sends email, creates a secret or touches production.

**Status 2026-11-22: every work package below is built** (library halves and hosted halves; hosted code is staging-only,
nothing deployed). "What is left" at the end lists the owner decisions and the setup that remains. The spec is the
source of truth for rules (R-20 to R-42); this plan records why.

## Decisions taken as defaults (the owner may overturn any; each is also an open question in the spec)

- **D1 Sharing (step 5).** The audience is set **per note**. Widening beyond the two parties needs **every named party's
  consent**; either party may narrow at any time. Negative events (dispute, overdue, notice, forgiveness, default) **never
  leave the two parties** (ceiling). **No public tier.** Three presets: **Private** (default), **Shared with a named person**
  (read-only, expiring, revocable, shown to both parties, logged), **Verify link** (checks a signed document, no data).
  A share needs `expires_at`, at most 365 days. The owner's "payer decides" model is not built; the spec keeps it as an
  open alternative.
  **Exception, a typed carve-out (added in review).** Either party may disclose to one `person` for a stated purpose
  (`accountant`, `lawyer`, `court`, `assignee`), at level `summary` or `statement`, for at most 90 days. It is active on
  the proposer's consent alone; the other party is emailed and sees it in the disclosure log (never hidden, whatever
  its status). Everything else still needs both parties. The owner may drop the exception.
- **D2 Guest identity (step 2).** A counterparty acts through a magic link. A confirmation is worded "confirmed by the
  holder of <masked email>", never "signature". Method `email-link`. Sensitive actions (accept terms, dispute, resolve,
  release confirmation) need a fresh email code even in a live session.
- **D3 Signing keys.** Reuse the three existing Ed25519 purposes. Chain-head seals use purpose `seal`; note receipts,
  payoff statements and releases use purpose `receipt`. No new purpose, no new secret.
- **D4 Where code lives (corrected).** Pure, deterministic logic goes in `packages/tfd-notes` (Apache-2.0, zero
  dependencies, no `node:`; hashing through WebCrypto, so chain functions are async). The offline verifier for notes is
  the separate package `packages/verify-notes` (Apache-2.0; imports `tfd-verify` and `tfd-notes`), **not** `packages/verify`:
  the website copies `packages/verify`, so it must stay small and free of workspace dependencies. Hosted routes, storage
  and pages go in `apps/trifold-cloud/src/notes/` (staging-only gating: routes answer 404 unless
  `env.ENVIRONMENT === "staging"`; the licence of that app is an open question). The CLI stays thin.
- **D5 Ports, not services.** `MailSender`, `Clock`, `IdSource` are injected; tests use in-memory fakes. No real mail is
  sent, nothing is deployed, no wrangler production binding appears (`tests/config.test.ts` guards it).
- **D6 Wording.** AGENTS.md claim rules and the spec's Claim limits apply to every string a user can see. Pay later is
  capped at 4 installments by pricing config, not by the engine.

## Work packages

| WP | Step | Owns | Depends on | Status |
|---|---|---|---|---|
| W0 | 2-5 | Event vocabulary in `tfd-notes`: `types.ts`, `events.ts`, `schema/note-event.v1.json`, `statement.ts` state fields | none | built |
| W1 | 3 | `tfd-notes/src/{canonical,chain,documents}.ts`, schemas `note-chain.v1.json`, `note-document.v1.json`; the verifier `packages/verify-notes`; vectors | W0 | built |
| W3L | 4 | `tfd-notes/src/{approvals,portfolio}.ts` | W0 | built |
| W4L | 5 | `tfd-notes/src/{visibility,grants}.ts` | W0 | built |
| W2a | 2 | `apps/trifold-cloud/src/notes/{store,note-do,sessions,...}.ts` (guest flow, pages, routes) | W1 | built, staging only |
| W2b | 3 | notes signing, payoff, release, receipts routes | W2a | built, staging only |
| W2c | 4 | org parties, approvals, portfolio and board report routes and pages | W2b, W3L | built, staging only |
| W2d | 5 | shares, consent, verify-link routes and pages | W2c, W4L | built, staging only |

Library workers do not edit `src/index.ts`; the coordinator adds exports after each phase.

## Event vocabulary (W0, built)

All with validator rules, schema branches and tests: `terms.accepted`, `terms.declined` (guest "Not my loan"),
`payoff.issued` (lender; `as_of` and the sha256 of the signed payoff statement; no figures in the event), `release.drafted`,
`release.confirmed` (lender; names its draft; two-person approval from W3L), `notice.sent` (lender; kind `reminder`|`default`;
`cure_days` for a default; optional `approval`), `party.rebound` (a salted `contact_commitment`, entered by the other
party), `visibility.changed` (`grant.proposed`, `grant.consented`, `grant.revoked`), `approval.requested` (with `cure_days`
for `notice.default`), `approval.granted`. Every event may carry optional `via: "email-link" | "account"` and an opaque
`agent_ref`. Personal data stays out of events: never names or emails. `Statement` gains
`state: { terms: "proposed"|"accepted"|"declined"; closed: boolean }`. `release.confirmed` closes the note; a later
reversal (value date after the release's UTC date) reopens it (R-9a stays).

## Decisions taken in review (2026-11-22)

- **Declined terms.** After `terms.declined`, `payoff.issued`, `notice.sent` and a default-notice approval request are
  refused until the borrower accepts; payments and release stay; the portfolio leaves the note out of outstanding,
  overdue and aging, and counts it as declined (spec R-25).
- **Notice binding.** A default notice names one approval: a satisfied `notice.default` request, used by no other
  notice, equal `cure_days`, at most 30 days old (R-28), so one approval covers one notice.
- **Seal required at the head.** A bundle is `ok` only with a verified seal at the chain head; a rebuilt chain passes
  `verifyNoteChain` alone (R-35, `packages/verify-notes`).
- **Per-note agent refs.** An agent's `agent_ref` is per note, so a ref cannot be followed from one note to another;
  the role stays organization-wide.
- **MAC on note ids.** A note id is `nt_<32 hex>.<16 hex>`: the second part is an HMAC of the first under
  `NOTES_SESSION_SECRET`, so a guessed or edited id is refused before any Durable Object is addressed (one exists the moment it
  is addressed). The same create key still names the same note.
- **Carve-out** as a typed exception to D1 (above); **no free text with control or bidirectional characters** (R-42);
  a shared view and a verify link carry no event id, amount list or document list beyond what R-39 and R-40 say.

## Acceptance (whole build)

- Every new rule has a failing-first test; vectors for chain, documents, approvals, visibility are CC0 under `tests/golden/`.
- `tfd-notes` and `tfd-verify` stay free of `node:` imports; portability and licensing tests pass.
- A guest can, through the in-memory service: open an invite, accept terms, record and confirm and dispute a payment,
  see both balances; every action lands in the chain with `via: email-link`.
- A statement, payoff and release verify offline in `tfd-verify-notes` (`packages/verify-notes`) from the file and the public keys, and the bundle is `ok` only with a verified seal at the head.
- An org note: release and default notice need two distinct agents; the portfolio shows aging, awaiting confirmation,
  disputes; the board report exports without private events.
- A share cannot widen without consent of every named party; negative events never project to a shared view; revoking
  stops later reads and says it cannot unsee.
- Full `packages/atm`, `tfd-notes`, `verify`, `verify-notes` and `trifold-cloud` tests, `tsc`, build and knip pass locally.

## What is left

- **Owner decisions** (spec, Open questions): payer-decides versus consent of both; keep or drop the carve-out; whether to
  block a payment before accepted terms; the hosted app licence (`apps/trifold-cloud` has no `LICENSE` or SPDX headers,
  root default is Apache-2.0, `AGENTS.md` calls the hosted service proprietary, and the app bundles FSL code).
- **Mail provider.** None chosen; the Worker's mailer refuses, so no link, code or notice email has been sent.
- **Secrets and vars to create** (staging): `NOTES_SESSION_SECRET` (at least 32 characters), `NOTES_API_KEY`,
  `NOTES_RECEIPT_KEY_ID`, `NOTES_SEAL_KEY_ID`, `NOTES_PUBLIC_KEYS_JSON`; the Secrets Store `receipt` and `seal` keys
  already exist.
- **Staging deploy.** Apply the D1 migration (`bun run migrate:staging`), then deploy; nothing is deployed yet.
- **Counsel.** Disclosure wording for the carve-out email and log; Pay later and Regulation Z; usury and below-AFR warnings.
- **Later (step 6).** Stripe evidence, fees and default, Rifo drafting, the witness, per-party keys.
