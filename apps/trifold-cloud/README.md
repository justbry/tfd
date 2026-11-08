# trifold-cloud

The hosted Trifold product: `ledger.trifold.app` (the product UI and its session API) and `api.trifold.app` (the
public API and Stripe webhooks), one Worker routed by `Host`. The plan, the milestones and the review log are in
`plans/trifold-cloud/PLAN.md`. This is milestone M0: the Worker, its bindings and staging.

| What | Where |
|---|---|
| `src/router.ts` | Routes by host; `GET /healthz` on both hosts checks D1 and R2 (503 if either fails) |
| `src/org-do.ts` | `OrgDO`, one SQLite-backed Durable Object per organization (handler, inbox and alarm in M3) |
| `src/backup.ts`, `src/prune.ts`, `src/cron.ts` | The hourly cron: copies each new version of every books object into the locked backup bucket, resuming across runs |
| `migrations/` | D1 migrations (`bun run migrate:staging`) |

## Environments

Only `staging` is bound. The top level of `wrangler.jsonc` is production and stays unbound until the launch gate
(PLAN.md section 10); `tests/config.test.ts` fails if a route, database or bucket appears there.

| Staging | |
|---|---|
| Hosts | `staging-ledger.trifold.app`, `staging-api.trifold.app` (Workers custom domains; Cloudflare manages their DNS) |
| D1 | `trifold-cloud-staging` (Time Travel: 30 days, built in) |
| R2 | `trifold-staging-books`; `trifold-staging-backups` (below) |
| Cron | `17 * * * *`, the backup (hourly; `BACKUP_SUBREQUEST_BUDGET` per run, 900 by default, raise toward 9,000 on the Paid plan) |
| Signing keys | Secrets Store `TRIFOLD_STAGING_SIGNING_RECEIPT`, `_SEAL`, `_DIRECTORY` (Ed25519, key ids `trifold-staging-2026-11-<purpose>`); `/healthz` proves they import. Public halves: `apps/trifold-verify/public/.well-known/trifold-keys.json`. The private PEMs live only in Secrets Store and `~/.config/trifold/keys/staging/` (mode 600) |

## Backups

| Store | How it is kept | Restore |
|---|---|---|
| D1 | Time Travel, 30 days, built in | `wrangler d1 time-travel restore trifold-cloud-staging --timestamp=…` |
| Org Durable Objects | SQLite point-in-time recovery, 30 days, built in | per object, from the DO's bookmark API (runbook in M7) |
| R2 books | Hourly copy to `trifold-staging-backups` as `versions/<etag>/<key>` | copy the wanted version back to `<key>` with its original bytes in a single-part put, so its ETag matches the copy again; the prune pass then treats that copy as current and clears its supersession date |

The backup bucket has a 30-day bucket lock: a copy can't be deleted or overwritten for 30 days, which is why each
version has its own key. There is no expiry rule. After each complete backup pass, the cron prunes a copy only once it has been
**superseded for 30 days**: the pass records in D1 (`backup_superseded`) when it first sees a copy no longer match its
source (rewritten or deleted there), deletes it 30 days after that, and for a rewritten object only once the backup
holds the current version. The current version of every object is kept however old it is, and an accidental delete or
bad write at the source leaves the last good copy for 30 days. A deleted org's books leave the backups 30 days after
the deletion, plus one pass: the retention the privacy policy states (PLAN.md M6). Supersession rows for copies removed some other way are
never cleaned up; harmless, and tidied in M7.

```sh
bunx wrangler@4.90.0 r2 bucket lock add trifold-staging-backups --name keep-30-days --retention-days 30
```

A run copies at most `BACKUP_SUBREQUEST_BUDGET` subrequests' worth and saves its cursor in D1 (`schema_meta.backup_state`); the next run
resumes. The watermark moves only after a pass with no failures. A failed object is logged and fails the cron run, so it
shows as an error in Workers observability. Alerting on a failed cron (a Cloudflare notification on Workers errors
to the owner's email) is set up before the launch gate.

Each copy is fetched with `onlyIf: { etagMatches }`, so an object rewritten after the listing is never stored under the old
ETag; it counts as a failure and the next pass copies the current version.

`apps/trifold-verify` is the verifier host (`staging-verify.trifold.app`): static assets only, no Worker code. Its `_headers` CSP names only the staging API; the
production build will need its own headers file when production is bound.

## Run

```sh
bun run test        # unit tests
bun run ts          # typecheck
bun run migrate:staging && bun run deploy:staging
(cd ../trifold-verify && bunx wrangler@4.90.0 deploy --env staging)
```

CI (`.github/workflows/trifold-cloud.yml`) tests every pull request; it deploys staging when run by hand, or on every
push to `dev` once the repository variable `TRIFOLD_CLOUD_DEPLOY` is `on` (set it after giving the `staging`
environment a token with Workers Scripts, Workers Routes, D1, R2 and Secrets Store edit).
