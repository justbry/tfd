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
- `src/views-job.ts` — the cron job.
- `src/testing/` — the test harness (below).

The Worker is built on `atm/worker` (`readViewsFromStore`, `readEventsFromStore`, `kpiDocument`, `ledgerRows`,
`incomeStatement`, `membersIncome`, `audienceViews`, `runViews`) and adds no books logic of its own.

## Order of checks

Token (401) → route → the school is in the token's `schools[]` (404 `not_found`, the same body as an unknown school) → the
endpoint's gate (403 `finance_required`, 403 `audience_not_allowed`) → the query (400) → the data (404 `no_data`, 409
`view_mismatch`, 501, 503). Every `/v1` answer is `Cache-Control: private, no-store`.

The token's `sub` is dropped when the token is checked: it is not stored, logged or returned. A failure in the views job is
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
`schools/<id>/events/date=*/day.jsonl`, and run through `runViews` as of its last event. `mintToken` is async.

Also on the harness: `seeded` (id → `{ preset, asOf, events }`), `seedEvents(id, events, { views? })` for a custom log,
`runCron()`, `clock` (`now()`, `set(iso)`, `advance(ms)`: the clock the Worker and the tokens use; it starts one minute after
the latest seeded `asOf`), `jwks` (`fetches()`, `setKeys()`, `keys()`), `signRaw(claims, header?)` for a token with exactly
these claims, `extraSigner(fill)`, `signer`, `issuer`, `bucket` (the Worker's R2 binding).

## Tests

`bun test` (or `bun run test`); `bun run ts` for the types. `endpoints.test.ts` compares every endpoint with the same
`atm/worker` function called directly, on four presets; `errors.test.ts` covers the error table; `gating.test.ts` the
finance-false guarantees; `cron.test.ts` the views job; `consumer.test.ts` uses the harness as another package would.
