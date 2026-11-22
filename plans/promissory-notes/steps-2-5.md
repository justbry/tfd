# Promissory notes, build steps 2 to 5: plan

Spec: `docs/specs/promissory-notes.md` (step 1 is PR #106). This plan turns build steps 2 to 5 into work packages with
file ownership. Written 2026-11-22. Nothing here deploys, sends email, creates a secret or touches production.

## Decisions taken as defaults (the owner may overturn any; each is also an open question in the spec)

- **D1 Sharing (step 5).** The audience is set **per note**. Widening beyond the two parties needs **every named party's
  consent**; either party may narrow at any time. Negative events (dispute, overdue, notice, forgiveness, default) **never
  leave the two parties** (ceiling). **No public tier.** Three presets: **Private** (default), **Shared with a named person**
  (read-only, expiring, revocable, shown to both parties, logged), **Verify link** (checks a signed document, no data).
  The owner's "payer decides" model is not built; the spec keeps it as an open alternative.
- **D2 Guest identity (step 2).** A counterparty acts through a magic link. A confirmation is worded "confirmed by the
  holder of <masked email>", never "signature". Method `email-link`. Sensitive actions (accept terms, dispute, resolve,
  release confirmation) need a fresh email code even in a live session.
- **D3 Signing keys.** Reuse the three existing Ed25519 purposes. Chain-head seals use purpose `seal`; note receipts,
  payoff statements and releases use purpose `receipt`. No new purpose, no new secret.
- **D4 Where code lives.** Pure, deterministic logic goes in `packages/tfd-notes` (Apache-2.0, zero dependencies, no
  `node:`; hashing through WebCrypto, so chain functions are async) and the verifier in `packages/verify` (Apache-2.0).
  Hosted routes, storage and pages go in `apps/trifold-cloud/src/notes/` (follow that app's license and
  staging-only gating: routes answer 404 unless `env.ENVIRONMENT === "staging"`). The CLI stays thin.
- **D5 Ports, not services.** `MailSender`, `Clock`, `IdSource` are injected; tests use in-memory fakes. No real mail is
  sent, nothing is deployed, no wrangler production binding appears (`tests/config.test.ts` guards it).
- **D6 Wording.** AGENTS.md claim rules and the spec's Claim limits apply to every string a user can see. Pay later is
  capped at 4 installments by pricing config, not by the engine.

## Work packages

| WP | Step | Owns | Depends on |
|---|---|---|---|
| W0 | 2-5 | Event vocabulary in `tfd-notes`: `types.ts`, `events.ts`, `schema/note-event.v1.json`, `statement.ts` state fields | none |
| W1 | 3 | `tfd-notes/src/{canonical,chain,documents}.ts`, schemas `note-chain.v1.json`, `note-document.v1.json`; `packages/verify` note checks; vectors | W0 |
| W3L | 4 | `tfd-notes/src/{approvals,portfolio}.ts` | W0 |
| W4L | 5 | `tfd-notes/src/{visibility,grants}.ts` | W0 |
| W2a | 2 | `apps/trifold-cloud/src/notes/{store,note-do,sessions,guest-api}.ts` | W1 |
| W2b | 3 | notes signing, payoff, release, receipts routes | W2a |
| W2c | 4 | org parties, approvals, portfolio and board report routes and pages | W2b, W3L |
| W2d | 5 | shares, consent, verify-link routes and pages | W2c, W4L |

Library workers do not edit `src/index.ts`; the coordinator adds exports after each phase.

## Event vocabulary (W0)

New events, all with validator rules, schema branches and tests: `terms.accepted`, `terms.declined` (guest "Not my loan"),
`payoff.issued` (lender; `as_of`, engine figures as strings, never typed numbers beyond what `statement` returns),
`release.drafted`, `release.confirmed` (lender; two-person approval comes from W3L), `notice.sent` (lender; kind
`reminder`|`default`, `cure_days`), `party.rebound` (new contact commitment, needs the other party's confirmation event),
`visibility.changed`, `approval.requested`, `approval.granted`. `PaymentRecordedEvent` and confirmations gain optional
`via: "email-link" | "account"`. Personal data stays out of events: parties are `party_ref` ids and salted commitments, never
names or emails. `Statement` gains `state: { terms: "proposed"|"accepted"|"declined"; closed: boolean }`. `release.confirmed`
closes the note; a later `payment.recorded` reversal reopens it (R-9a stays). Existing 309 tests and goldens keep passing.

## Acceptance (whole build)

- Every new rule has a failing-first test; vectors for chain, documents, approvals, visibility are CC0 under `tests/golden/`.
- `tfd-notes` and `tfd-verify` stay free of `node:` imports; portability and licensing tests pass.
- A guest can, through the in-memory service: open an invite, accept terms, record and confirm and dispute a payment,
  see both balances; every action lands in the chain with `via: email-link`.
- A statement, payoff and release verify offline in `tfd-verify` from the file and the public keys.
- An org note: release and default notice need two distinct agents; the portfolio shows aging, awaiting confirmation,
  disputes; the board report exports without private events.
- A share cannot widen without consent of every named party; negative events never project to a shared view; revoking
  stops later reads and says it cannot unsee.
- Full `packages/atm`, `tfd-notes`, `verify` and `trifold-cloud` tests, `tsc`, build and knip pass locally.
