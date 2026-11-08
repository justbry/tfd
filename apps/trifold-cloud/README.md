# trifold-cloud

The hosted Trifold product: `ledger.trifold.app` (the product UI and its session API) and `api.trifold.app` (the
public API and Stripe webhooks), one Worker routed by `Host`. The plan, the milestones and the review log are in
`plans/trifold-cloud/PLAN.md`. This is milestone M0: the Worker, its bindings and staging.

| What | Where |
|---|---|
| `src/router.ts` | Routes by host; `GET /healthz` on both hosts checks D1 and R2 (503 if either fails) |
| `src/org-do.ts` | `OrgDO`, one SQLite-backed Durable Object per organization (handler, inbox and alarm in M3) |
| `src/backup.ts` | The nightly cron: copies each new version of every books object into the locked backup bucket |
| `migrations/` | D1 migrations (`bun run migrate:staging`) |

## Environments

Only `staging` is bound. The top level of `wrangler.jsonc` is production and stays unbound until the launch gate
(PLAN.md section 10); `tests/config.test.ts` fails if a route, database or bucket appears there.

| Staging | |
|---|---|
| Hosts | `staging-ledger.trifold.app`, `staging-api.trifold.app` (Workers custom domains; Cloudflare manages their DNS) |
| D1 | `trifold-cloud-staging` (Time Travel: 30 days, built in) |
| R2 | `trifold-staging-books`; `trifold-staging-backups` with a 30-day bucket lock |
| Cron | `17 3 * * *`, the backup |

`apps/trifold-verify` is the verifier host (`staging-verify.trifold.app`): static assets only, no Worker code.

## Run

```sh
bun run test        # unit tests
bun run ts          # typecheck
bun run migrate:staging && bun run deploy:staging
(cd ../trifold-verify && bunx wrangler@4.90.0 deploy --env staging)
```

CI (`.github/workflows/trifold-cloud.yml`) tests every pull request and deploys staging when run by hand.
