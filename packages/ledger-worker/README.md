# ledger-worker

The ledger Worker: the read endpoints of the ledger UI (`ledger.b4uni.com`) over a school's R2 views and event log, behind a
ledger token, and a cron job that keeps the views current. The contract is `plans/ledger-ui/S8-contract.md` section 11; this
file says how the package is put together and how to run it.

- `src/worker.ts` — `createLedgerWorker()`: `fetch` serves `/healthz` and `/v1/*`, `scheduled` runs the views job.
  `src/main.ts` is the deployed entry (real clock).
- `src/auth/` — token check (Ed25519 on WebCrypto, `kid` looked up in the JWKS, `iss`, `aud` exactly `atm-ledger`, `iat`
  required and not in the future (5 s leeway), `exp - iat <= 300`), the JWKS cache (its `max-age`, default 300 s; a
  refetch on an unknown `kid`, at most every 30 s), the token's `schools[]`.
- `src/routes/` — one file per endpoint; `src/data/snapshot.ts` opens a school's views generation (manifest `asOf`, the
  verified readers, the events up to `asOf`, the menu, the KPI rows), kept in the isolate while the manifest is unchanged.
- `src/data/answers.ts`, `src/routes/stored.ts` — the stored answers and log of a generation (below);
  `src/data/demo-index.ts` — the demo schools' index.
- `src/views-job.ts` — the cron job.
- `src/testing/` — the test harness (below).

The Worker is built on `atm/worker` (`readViewsFromStore`, `readEventsFromStore`, `kpiDocument`, `ledgerRows`,
`incomeStatement`, `membersIncome`, `audienceViews`, `runViews`) and adds no books logic of its own.

## Order of checks

Token (401; none needed for `GET /v1/schools` and the demo schools, below) → route → the school is in the token's `schools[]` (404 `not_found`, the same body as an unknown school) → the
endpoint's gate (403 `finance_required`, 403 `audience_not_allowed`) → the query (400) → the data (404 `no_data`, 409
`view_mismatch`, 501, 503). Every `/v1` answer is `Cache-Control: private, no-store`, but a stored answer (below).

The token's `sub` is not stored, logged or returned. It is held for the one request only, and a config write turns it into an opaque writer id (`u_` and the first 16 hex characters of the sha256 of `<school>:<sub>`) for the audit line and the manifest. A failure in the views job is
logged as `views job failed for school <id>` and nothing else (a job message can carry an event id or a `family:<id>` key).

## Configuration

`wrangler.jsonc` has one environment, `staging`, with:

| Name | Kind | Value |
| --- | --- | --- |
| `LEDGER_BUCKET` | R2 binding | the staging bucket, `b4uni-stg-ledger` (exists) |
| `LEDGER_ISS` | var | the family service's `API_BASE` (`https://api-staging.b4uni.com`) |
| `LEDGER_JWKS_URL` | var | its `/.well-known/ledger-jwks.json` |
| `ASSETS` | assets binding | `../ledger-ui/dist`, single-page-application fallback, `/v1/*` and `/healthz` run the Worker first |
| cron | trigger | `*/5 * * * *` |
| route | custom domain | `ledger-staging.b4uni.com` |
| `LEDGER_DEMO_SCHOOLS` | var | `on`: the demo schools below (staging only; `tests/assets.test.ts` fails if it appears anywhere else) |

**Production has no binding.** There is no `production` environment, bucket or route in `wrangler.jsonc` until the owner answers
the E2/E11 questions (contract D13: may events keyed `family:<id>` reach a production bucket). `tests/assets.test.ts` fails if
a production environment or a production bucket name appears in the file. Adding one is a deliberate change to that test.

`nodejs_compat` is on (`atm/worker` imports `node:crypto`). `atm/worker` is aliased to its source in the config, so the
bundle does not need atm's `dist`. No secret is needed. `bun run check:bundle` runs `wrangler deploy --dry-run` for
staging (through `bunx wrangler@4.90.0`: the repo's esbuild override breaks a local wrangler). Wrangler needs the
assets directory to exist: the check uses `../ledger-ui/dist` if it is built, builds the UI first when its dependencies are
installed, and otherwise checks against a placeholder page (`--assets`) and says so. A real deploy must build the UI first.

**Assets.** A page that is not a file in the UI build gets `index.html`. `/v1/*` and `/healthz` run the Worker first, so an
unknown `/v1/x` is the Worker's JSON 404, never a page. The harness serves a placeholder `index.html` the same way (or the
`assetsDirectory` it is given).

## Config objects (S9.6)

`schools/<id>/config/` holds the school's config, written only by the Worker (and the seeder in test and staging):
`settings.json`, `disclosure.json`, `booking-rules.json`, `plans-draft.json`, `promos.json`, `manifest.json` (the sha256,
size, time and writer of each) and `audit/YYYY-MM.jsonl` (one line for each accepted write). Every object is canonical JSON
(sorted keys, two-space indent, trailing newline), so equal content is equal bytes and an equal sha256, which is the ETag.
The shapes mirror the UI's types (`src/config/types.ts`); the validators (`src/config/definitions.ts`) are hand-written (no
schema library, no `new Function`) and answer every problem as `{ path, message, hint }`.

- `GET .../config/:name`: any listed school; `promos` also needs `finance:true`. `ETag: "<sha256>"`.
- `POST .../config/:name/verify` (owner): `{ value }` gives `{ ok, problems, diff, verifiedHash, baseEtag }`; writes nothing.
- `PUT .../config/:name` (owner and an `su` claim, unix seconds, no older than 10 minutes, D22): `{ value, verifiedHash }`
  with `If-Match: "<baseEtag>"` (`If-None-Match: *` for a new object). `403 owner_only`, `403 step_up_required`, `412
  stale_etag`, `422 invalid_config`. Until buzz-school sends `su` (S9-bz1) every put is `step_up_required`.

A put writes the object (a conditional put on the ETag it read), then the audit line (conditional too, so two writers each
keep theirs), then the manifest, which is rebuilt from the objects' own bytes so a write that stopped half way is repaired
by the next. If the audit or manifest step fails after the object landed, the answer is a 503 and the object is changed:
read it again before saving.

**Seeding.** `src/testing/seed-config.ts` `seedSchoolFixtures(store, { schools, now })` lands the UI's fixtures
(`packages/ledger-ui/src/fixtures`, imported read-only) as these objects: an object is written only when absent or its
sha256 differs, with `If-None-Match: *` or the ETag, so a second run reports `written:0` and changes no byte, and runs at
once are safe. The same fixtures overwrite an owner's edit of an object they describe. `bun run --cwd packages/ledger-worker
seed:r2 [--env staging] [--school <id>] [--dry-run]` runs it on the staging bucket with the four `R2_LEDGER_*` variables
(`set -a; . ~/.config/b4uni/r2-stg-ledger-s3.env; set +a`); it refuses every bucket but `b4uni-stg-ledger`, every environment
but `staging` and every host outside `r2.cloudflarestorage.com`, and prints no credential. It seeds config only: events and
views come from the shipper and the views job (the harness seeds its own).

| UI reader (`ledger-ui/src/http/reader.ts`) | Config keys | Fixture it comes from |
| --- | --- | --- |
| `settings` | `settings`, `booking-rules` | `fixtures/settings.json` (basis, Stripe, Zeffy, keys); rules below |
| `schoolRules` | `booking-rules` | `fixtures/ledger-data.ts` `rulesBySchool` |
| `promos` | `promos` | `fixtures/ledger-data.ts` `promosBySchool` |
| `planSummary` | `plans-draft` (features, tier copy and order, link flag) | `fixtures/plans.ts` `plansBySchool` |
| `disclosure` | `disclosure` (the school's override) | `fixtures/disclosure.json` `schools.<id>.override` |

`tests/seed-config.test.ts` fails when a reader that `reader.ts` leaves unavailable has neither a row in `readerConfig`
(`seed-config.ts`) nor a place on the list of readers that stay unavailable. The Worker's `disclosure` route does not read
`config/disclosure.json` yet (its `override` is `null`).

## Demo schools (staging)

Owner decision 2026-11-08 (contract section 11, "Demo schools"): with `LEDGER_DEMO_SCHOOLS=on`, a school id matching
`^demo-[a-z0-9-]+$` is a demo school (`src/demo.ts`). `GET /v1/schools` and a demo school's reads need no token; every
caller holds it as owner with the finance grant; an invalid or expired token is still a 401; a config verify or put on one
is `403 demo_read_only`. `GET /v1/schools` lists the token's schools, then the demo schools in the bucket (`demo: true`,
with `name`, `timeZone`, `currency`, `creditUnit` and `bookingsOpenOn` from `schools/demo-<preset>/demo.json`).
`GET /v1/schools/demo-<preset>/demo-api/<route>` serves the demo school's answers to the buzz-school reads the UI makes
(`src/routes/demo-api.ts`): `ledger/school`, `ledger/capabilities`, `billing/members-list`, `billing/menu/versions[/<n>]`,
`bookings?from=&to=` and `finance-grants`, shaped as buzz-school's own, worked out from the preset's events
(`src/demo/route-answers.ts`). A real school id is 404 there, token or not.

The data is atm's fifteen school presets (the mart presets), through the real path: events, the views job, the endpoints.

    set -a; . ~/.config/b4uni/r2-stg-ledger-s3.env; set +a
    bun run --cwd packages/ledger-worker seed:demo [--preset <name>]... [--no-views]

writes each preset's events to `schools/demo-<preset>/events/date=<day>/batch-*.jsonl` (the shipper's `planOutbox`), deletes
any other object under that `events/`, writes `demo.json` and the route answers under `demo-api/` as of now
(`src/demo/demo-api-store.ts`), and runs the views as of now. A rerun replaces the demo prefixes
and touches no other one. It refuses a bucket whose name holds `prod`, and any bucket but `b4uni-stg-ledger`. No watermark is
written: nothing ships to a demo school, so `asOf` is the run's time. The views job rebuilds one demo school per run (the one
whose views are oldest, once they are an hour old), so fifteen logs of a year of daily batches do not cost every run thousands of
reads; each rebuild writes that school's route answers again, as of its views. The harness seeds them with
`startLedgerWorker({ presets, demoPresets })`.

## Stored answers: a cold isolate answers without the log

Measured on staging before this (2026-11-08, real Chrome, `#/demo-monthly-members/dashboard`): the first figure after 8.8 s
cold, 2.4 s on a reload. A cold isolate read the school's whole log (a year of daily batch files) to answer `disclosure`,
`kpi` or the ledger: 5 to 6.3 s each, against 0.2 to 0.5 s warm. `GET /v1/schools` listed the bucket and read two objects per
demo school: 1 to 1.7 s every time.

After each school's views the job stores, under `schools/<id>/views/answers/` (`src/data/answers.ts`):

| Object | What | Written |
| --- | --- | --- |
| `log.jsonl` | The events up to the generation's `asOf`, one object; a header line names the SHA-256 of the event lines. | When those lines change. |
| `answers.jsonl` | A header line (`v`, `generation`, `day`), then `<name>\t<data JSON>` per answer: `disclosure/<adminAudience>` for each audience, `kpi/<audience>-open` for each, `kpi/<audience>-locked` from governance up. The data is the endpoint's `data`, `JSON.stringify`'d by the same functions. | Each new generation, or a new local day. |
| `current.json` | The pointer: `v`, `generation`, `asOf`, `zone`, `day`, `log` (the hash). Written last. | With `answers.jsonl`. |

`generation` is the first 20 hex of the SHA-256 of the manifest's `asOf`, `generatedFrom.lastEventId` and `eventCount`.
The answers depend on the request's time only through the school's local day (`clockOf`), so they hold for every request on
`day` in `zone`. One object for all the answers keeps a generation at two writes (fourteen otherwise; a real school gets a
new generation every five minutes). The keys are fixed, so nothing piles up; every reader checks what it reads instead:

- `kpi`, `disclosure` and `audience-report` read the manifest and the pointer at once (one round trip). The pointer counts
  only when it names the manifest's generation and the request's local day is its `day`. The answer is then read from the
  isolate, else the data centre's cache (`caches.default`), else `answers.jsonl` (once per generation per isolate; its
  header must name the same generation and day; every answer of it then goes in the cache). `audience-report` is
  `audienceReportOf` over the stored `kpi/<audience>-open`. The snapshot is not opened.
- Anything else, or no usable stored answer (a generation written before this, another day, a run in flight), computes as
  before; the snapshot then takes its events from `log.jsonl` when the pointer names it, else from the day files. So the
  ledger, income statement, fundraising and member money also skip the day files.
- Bump `ANSWERS_VERSION` when an answer's shape or computation changes: older stored answers are then misses until the job
  writes them again (each new generation, at most an hour for a demo school).

**Cache.** The key is `<origin>/v1/__stored-answers/v<version>/<school>/<generation>/<day>/<name>`: no token, no `sub`, no
grant. Safety: every check (token, the school in the token, the finance gate, the audience gate, the query) runs before the
key is built, and the name is picked by the server from the checked audience (`kpi`, `audience-report`) or the caller's grant
(`disclosure`), so a caller only reaches an answer of an audience they may see, of a school their token lists. An answer
holds what its audience may see and nothing about the caller, so callers of one audience can share it. The key names the
generation, so an entry is never stale (kept a day). The envelope is not cached: `asOf` comes from the pointer and
`lagMinutes` is worked out at request time, written around the stored data text, so the bytes are what `okResponse` writes.

**Browser.** A stored answer has `ETag: "v<version>-<generation>-<day>-<endpoint>-<audience>[-<pin or from>]"` and an `If-None-Match`
naming it answers `304` (after the checks). Real schools: `Cache-Control: private, max-age=0, must-revalidate` (the browser
asks each time; the 304 costs two small reads, no body). Demo schools: `public, max-age=60` (fictional, the same for every
caller; `lagMinutes` may then be up to a minute old). The disclosure's ETag names the caller's admin audience, so a
browser that changes token reads it again. A computed answer stays `private, no-store`.

**Demo index.** `schools/_demo-index.json` (`src/data/demo-index.ts`): each demo school's `asOf` and its facts, so
`GET /v1/schools` reads it once instead of listing the bucket and reading two objects per demo school. `seed:demo` writes it
last; the views job writes it again on each run when it changed. It names demo schools only (it is built from a listing of
`schools/demo-`): the token's own schools are still read from their manifests, at once, and a real school never appears in
the index. Without it the list is worked out from the bucket, the same rows.

**After a deploy.** A generation written before this has no stored answers: those requests compute as before. The views job
stores them on its next run for each real school with a new generation (every five minutes while events ship; a school
whose `asOf` does not move gets them on the first run, since it has no pointer). Demo schools get them only when the job
rebuilds them (one per run, hourly), so run `seed:demo` again to store all fifteen and the index at once.

## The views job and `asOf`

Every 5 minutes the job runs `runViews` for each school prefix in the bucket, with `asOf` set to the earlier of the scheduled
time and the school's ship watermark: the object `schools/<id>/events/_shipped-through.json`,
`{ "school", "env", "shippedThrough": "<ISO instant>" }`, that the buzz-school shipper writes after each run (one constant,
`watermarkKey` in `src/data/watermark.ts`). `asOf` is what the UI's pending state waits for, so a write must not look shipped
before it is.

**Without a watermark, `asOf` can run ahead of unshipped events**: the job then uses the scheduled time. It does the same for
a watermark that is unreadable, not JSON, another school's, or without an instant, and a watermark dated after the
scheduled time never raises `asOf` above it.

Not implemented: rate limiting (`429 rate_limited` is in the table and is never sent).

## Test harness

`startLedgerWorker({ presets, schools })` in `src/testing/harness.ts` (package export `ledger-worker/testing`) starts the real
Worker, as Wrangler would deploy it, on Miniflare over an in-memory R2 bucket, with a test Ed25519 key pair and a JWKS
endpoint, and gives back the URL, a token minter and `stop()`.

```ts
import { startLedgerWorker } from "ledger-worker/testing"; // or the path to src/testing/harness.ts

const harness = await startLedgerWorker({
  presets: ["monthly-members", "free-only"], // the mart presets to seed
  schools: ["b4u", "har"],                   // optional: the school id of each preset (default: the preset's name)
});
const token = await harness.mintToken({
  sub: "profile_kim",
  schools: [{ id: "b4u", role: "owner", finance: true }, { id: "har", role: "admin", finance: false }],
  expiresInSeconds: 120, // optional, default 300 (the most the Worker accepts)
});
const response = await fetch(`${harness.url}/v1/schools/b4u/kpi?audience=owner&pin=open`, {
  headers: { authorization: `Bearer ${token}` },
});
await harness.stop();
```

Each preset is generated by the scenario generator, given a `catalog.published` event for its menu, written as
`schools/<id>/events/date=*/day.jsonl`, and run through `runViews` as of its last event; its answers are then stored as
the views job stores them, for the harness clock's day. `mintToken` is async.

Also on the harness: `seeded` (id → `{ preset, asOf, events }`), `seedEvents(id, events, { views? })` for a custom log,
`runCron()`, `clock` (`now()`, `set(iso)`, `advance(ms)`: the clock the Worker and the tokens use; it starts one minute after
the latest seeded `asOf`), `jwks` (`fetches()`, `setKeys()`, `keys()`), `signRaw(claims, header?)` for a token with exactly
these claims, `extraSigner(fill)`, `signer`, `issuer`, `bucket` (the Worker's R2 binding).

## Tests

`bun test` (or `bun run test`); `bun run ts` for the types. `endpoints.test.ts` compares every endpoint with the same
`atm/worker` function called directly, on four presets; `errors.test.ts` covers the error table; `gating.test.ts` the
finance-false guarantees; `cron.test.ts` the views job; `consumer.test.ts` uses the harness as another package would;
`stored-answers.test.ts` the stored answers, the cache, the ETag and the demo index. The harness stores each school's
answers as the job would, so the endpoint tests go through them; a test removes `current.json` to compute.

## Staging end-to-end (S8f)

`bun run staging-e2e [--stage N[,N]] [--json] [--strict]` (`scripts/staging-e2e.ts`) checks the deployed staging Worker and family service; it refuses any host but the two staging ones. `tests/staging-e2e.test.ts` runs its stage 1 against the harness. Stage 6 (S8d, `scripts/staging-s8d.ts`, only with `--stage 6`) publishes the menu and refunds through buzz-school's routes and follows both events through `ledger-status`, the bucket, the watermark and the Worker's ledger; `tests/staging-s8d.test.ts` covers its readers and a whole run on fakes. Inputs, owner steps and expected output: `plans/ledger-ui/S8f-staging-runbook.md`.
