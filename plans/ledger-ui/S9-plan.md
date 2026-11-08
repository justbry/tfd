# S9: the Svelte UI, the remaining tabs on R2 data, and config writes

Owner goal (2026-11-07): keep the UI 9/10 similar to the mockup but build it on shadcn-svelte and Tailwind 4; build out the remaining tabs with fixture data that lands in R2, idempotently, where each tab's reader reads from; let config in R2 be written from the Plans tab or Settings (verify, then update); use Effect v4 for error handling, with actionable messages in a toast or message queue that is easy to see.

Builds on `S8-contract.md` (transport, gating, R2 layout, Worker endpoints). Where this file and the contract disagree, this file wins for S9 work only.

## 1. Decisions (default taken 2026-11-07 under the owner's S9 goal; the owner may override)

The question tool was aborted, so these are the recommended options, taken.

| ID | Question | Default |
| --- | --- | --- |
| D18 | Who writes R2 config | **The ledger Worker.** New owner-only routes (section 4). R2 is the source of truth for this config. buzz-school keeps the menu and money. |
| D19 | What "config in R2 via Plans" means | Menu save and publish stay in buzz-school (it creates the Stripe products and prices); the published menu lands in R2 through `catalog.published` as today. What Plans and Settings write to R2 is the school's config objects (section 3), including the Plans draft/preview copy and order. |
| D20 | How the rewrite lands | New package `packages/ledger-ui-svelte` beside `packages/ledger-ui`. It imports the `Reader`/`Writer` contract and the fixtures from `ledger-ui/src/data` and `src/fixtures` (no fork) and runs the same parity and state-matrix tests. The Worker's `ASSETS` swaps over only when the three-reviewer panel scores 9 or more against the mockup. Staging keeps the Preact UI until then. |
| D21 | Errors and toasts | **Effect 4.1.2** (`effect@latest` on npm as of today). Section 5. |
| D22 | PIN step-up for Worker writes | The Worker cannot check a PIN. buzz-school `POST /school-admin/ledger-token` gains an optional `su` claim (unix seconds): present only when the session's PIN was verified in the last 10 minutes. Config writes need `role: owner` and a fresh `su`. buzz-school change **S9-bz1**, one small PR; until it merges the Worker route refuses writes with 403 `step_up_required`. |
| D23 | All schools totals (owner decision 2026-11-08) | **Summed in the UI, as a documented exception** to "nothing is summed or recomputed". No server route serves a cross-school total, so All schools adds each school's `membersIncome` per currency, in exact integer minor units (never across currencies), and the Needs attention counts. The note under the Income total names the schools it leaves out and why (did not load, or income not seen). |

## 2. Slices

Each slice is one PR to `dev`, gated locally (typecheck, Biome on touched files, tests, hygiene, bundle budget), then the three-model panel from `loop/protocol-v8.md` (Opus 5.5, Fable 5.1, Grok 4.7, each 9 or more, no blockers). Screenshots are taken against `mockup.html` at 1100, 728 and 390 px, light and dark.

| Slice | Content |
| --- | --- |
| S9.0 | Scaffold `packages/ledger-ui-svelte`: Svelte 5, Vite, Tailwind 4 (`@tailwindcss/vite`, CSS-first `@theme` carrying the mockup's tokens), shadcn-svelte components copied in (`dialog`, `drawer`/`sheet`, `tabs`, `table`, `button`, `input`, `select`, `switch`, `badge`, `tooltip`, `sonner`-style toaster written locally), shell (school switcher, tabs, period controls, theme), Effect runtime and the error/toast layer (section 5). |
| S9.1 | Dashboard (Money, Members, Risk), all viewer states and grains. |
| S9.2 | Bookings and Members (list, drawer, actions). |
| S9.3 | Plans (edit, preview, draft, publish) and Promos. |
| S9.4 | Ledger and Reports. |
| S9.5 | Member portal ("View as member") and Settings. |
| S9.6 | R2 seeding (section 3.2) and the config routes (section 4); the Plans and Settings writes wired through them. |
| S9.7 | Swap `ASSETS`, staging check (the S8f script, extended), retire the Preact package after the owner agrees. |

S9.6 can start in parallel with S9.0 (it is Worker-side and does not touch the UI). S9.1 to S9.5 are sequential on S9.0.

## 3. R2 config and the fixture landing

### 3.1 Objects

New prefix `schools/<id>/config/`, written only by the Worker (and the seeder in test and staging):

```
config/settings.json         Settings drawer: accounting basis display, contact, portal theme, embed
config/disclosure.json       the school's disclosure override (the Worker already reads a school override; moves here)
config/booking-rules.json    school rules (D11: null today; becomes a real object)
config/plans-draft.json      the Plans tab's draft/preview copy and tier order (not prices)
config/promos.json           promo list for the Promos tab (display; Stripe promotion codes stay in buzz-school)
config/manifest.json         { schemaVersion, objects: { name: { sha256, bytes, updatedAt, updatedBy } } }
config/audit/YYYY-MM.jsonl   one line per accepted write: who (opaque sub), name, before/after sha256, at
```

Every object is canonical JSON (sorted keys, two-space indent, trailing newline) so equal content gives equal bytes and an equal sha256. The Worker serves `GET /v1/schools/:school/config/:name` with `ETag` = sha256 and the usual `{asOf, lagMinutes, data}` envelope.

### 3.2 Idempotent fixture landing

`packages/ledger-worker/src/testing/seed-config.ts` exports `seedSchoolFixtures(store, { schools, now })` and a CLI `bun run --cwd packages/ledger-worker seed:r2 [--env staging] [--school <id>] [--dry-run]`.

- It writes each object the UI's fixtures describe (settings, disclosure, rules, plans draft, promos, plus the existing events and views through `runViews`) only when the object is absent or its sha256 differs from the fixture's. A second run reports `written: 0, unchanged: N` and changes no byte or `updatedAt`.
- A conditional put (`If-None-Match: *` for new objects, the etag for changed ones) makes two concurrent runs safe.
- The CLI allows only the staging bucket by name (as `staging-e2e` allows only staging hosts). Production is refused in code.
- Test: run twice on Miniflare and assert the second run's report and the bucket's listing hash.
- A table in the PR maps each tab to the R2 key its reader reads and the fixture file it came from; a test fails if a tab's reader has no seeded key.

## 4. Config write routes (Worker)

| Method and path | Who | What |
| --- | --- | --- |
| `GET /v1/schools/:school/config/:name` | any listed school; `finance` where the object is money-bearing | Read with `ETag`. |
| `POST /v1/schools/:school/config/:name/verify` | owner | Body `{ value }`. Validates against the object's schema; returns `{ ok, problems: [{path, message, hint}], diff, verifiedHash, baseEtag }`. Writes nothing. |
| `PUT /v1/schools/:school/config/:name` | owner with fresh `su` (D22) | Body `{ value, verifiedHash }`, header `If-Match: <baseEtag>`. Re-validates, checks that `verifiedHash` is the hash of this canonical value, checks the etag, writes with a conditional put, appends the audit line, updates the manifest. |

Errors use the contract's envelope, plus `412 stale_etag` (someone else changed it: the UI shows the diff and offers reload), `422 invalid_config` with `problems[]`, `403 owner_only`, `403 step_up_required`. No route answers 200 for a write that did not happen. Schemas are hand-written validators (no zod, no ajv, no `new Function`; Worker-safe). The Plans and Settings screens call verify on every pause in editing, show the problems inline, and enable Save only for a verified value; Save sends PUT.

## 5. Errors with Effect v4

Package `effect@4.1.2`, used in the Svelte app's data layer only (the shared `Reader`/`Writer` contract stays promise-based).

- **Services.** `Reader`, `Writer`, `Toasts` and `Clock` as Effect services (`Context` tags and `Layer`s): the HTTP adapters and the fixture adapters are two layers; tests provide the fixture layer.
- **Bridge.** One function, `run(effect)`, wraps an adapter promise as `Effect.tryPromise` and maps a thrown `AdapterError` to a tagged error `UiError` carrying `kind` and `detail`, so every failure in the app has the same shape. Anything else becomes `UiError` with kind `unexpected` (and is logged through the logger service, never `console`).
- **Message table.** One module maps each `AdapterErrorKind` (and the server codes `stale_etag`, `invalid_config`, `step_up_required`, `owner_only`, `finance_required`, `audience_not_allowed`, `stripe_permission_missing`) to `{ title, what, doThis, action? }`. Examples: `unavailable` → "The ledger is catching up. Try again in a minute." with a Retry action that re-runs the same effect (same `Idempotency-Key`); `step_up` → "Confirm it is you" with a button that opens the mailed-link step; `pin_locked` → how long to wait from `retryAfterSeconds`; `stale_etag` → "Someone changed this. Review their change" with a Reload action; `invalid_config` → lists `problems[]` and focuses the first field. A test fails if an `AdapterErrorKind` has no entry.
- **Retry.** `Effect.retry` with `Schedule.exponential` plus jitter, only for kinds the adapter marks retryable (`isRetryable`), never for a write without an `Idempotency-Key`, never more than three tries; the toast shows "Retrying (2 of 3)".
- **Queue.** A `Toasts` service backed by an Effect `Queue`/`Ref` and a Svelte 5 rune store: `error` and `warning` stay until dismissed or fixed, `success` and `info` dismiss after 5 s; identical messages (same title and detail) merge into one with a count; at most four visible, the rest queue; each toast has a role (`alert` for errors, `status` otherwise), a live region, a keyboard-reachable action and Dismiss; the region sits top right on wide screens and bottom on narrow ones, above dialogs (z-index from the theme), and never covers the focused control.
- **Inline too.** A field-level problem (`field` in the detail, or `problems[]`) also appears at the field; the toast carries the summary only.
- **Never silent.** A hygiene test fails on an empty `catch` and on a `.catch(() => {})` in the Svelte package. A rejected read leaves the pane in its "not available" or error state with the same message and Retry, not an empty table.

## 6. Dependencies on other threads

- **S9-bz1** (buzz-school): `su` claim on the ledger token (D22). Small PR, thread to be launched when S9.6 starts.
- **Orchestrator (ledger-ui):** owns `packages/ledger-ui/src/data/` and the fixtures. S9 imports them read-only; any contract change goes through the orchestrator as today. S8f staging stays with the orchestrator; S9 touches staging only for the seeding step (S9.6) and the swap (S9.7), after saying so in the thread.
- **Mockup parity:** `plans/ledger-ui/loop/parity-checklist.md` and `test/parity/` are reused unchanged; the Svelte package must pass the same checks.

## 7. Open questions for the owner

1. D18 to D22 above (taken by default).
2. Whether `promos.json` should be the source for the Promos tab or only a display mirror of buzz-school's promotion codes (default: mirror, buzz-school stays the source; a promo route in buzz-school is group 6 of `ledger-ui-gaps`).
3. Retire the Preact package after the swap, or keep it for one release (default: keep for one release).
