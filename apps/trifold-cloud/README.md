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
| `src/billing/` | Trifold's own billing (PLAN.md section 5), staging only: checkout, the portal, the fee lookup, the billing webhook, the plans pages |
| `scripts/publish-plans.ts` | Publishes `catalog/trifold`'s menus to Stripe test mode with tfd's `menuToStripe`, and each school's portal configuration with `portalConfigOf`; writes `src/published-plans.json` |

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

## Trifold's own billing (staging, Stripe test mode)

Trifold sells its plans through Stripe Checkout and keeps the paid invoices in its own books, with the tfd engine, as
any school would. One Durable Object, `OrgDO` named `trifold`, is those books: its SQLite holds tfd's handler tables
(`HANDLER_DDL`, migration 2).

| Route | What it does |
|---|---|
| `GET staging-ledger…/billing/plans` | Starter and Audited (Pro is a draft), standard or non-profit, monthly or yearly; calls checkout |
| `GET staging-ledger…/billing/success`, `/billing/cancel` | Checkout's return pages. With `?session_id=cs_test_…` (Checkout puts it there), success offers "Manage your plan" |
| `POST staging-api…/v1/billing/checkout` | `{ tier, interval, org: std\|np, email? }` → `{ id, url }`: a subscription Checkout Session made with tfd's `checkoutParams` (metadata `b4u_school` = `tf-std`/`tf-np`, `family_id` = a minted `tfa_…` id, never an email). CORS for the ledger host only; 10 a minute per address |
| `POST staging-api…/v1/billing/portal` | `{ session_id }` → `{ url }`: a billing portal session for the customer of that Checkout Session. The Worker reads the session from Stripe and takes the customer from it; the browser never names a customer. The session must be complete, Trifold's (`b4u_school`) and under a day old (until sign-in, M2). Same CORS and limit as checkout |
| `POST staging-api…/webhooks/billing` | Verifies Stripe's signature on the raw body (WebCrypto, 5 minutes), hands the event to the `trifold` DO, which reads the Stripe fee of an `invoice.paid` (below), runs tfd's `handleStripeWebhook` and ships the outbox to `schools/<tf-std\|tf-np>/events/…` in the books bucket. 2xx only after the DO committed; a failed ship retries by alarm |
| `GET staging-api…/v1/billing/books` | Counts only: claims by outcome, outbox rows shipped and not, batch keys |

Checkout, the portal, the pages, the webhook and the books counts answer 404 outside staging; production stays
unbound. Every Stripe call (`src/billing/stripe.ts`) refuses a key that is not `sk_test_`/`rk_test_` before sending,
and any answer that holds a `livemode: true` object; the webhook answers a live-mode event 200 without applying it.

**Fees.** No webhook event carries Stripe's fee, so before the handler runs, the DO reads it for each `invoice.paid`
(`src/billing/fees.ts`): the invoice's paid payments (`GET /v1/invoice_payments?invoice=…`), each payment intent's
latest charge, and that charge's `balance_transaction.fee`. It hands the sum to tfd as `paymentFee`; tfd stores it with
the input (`atm_event_inputs.fee`) and books `expenses:billing:stripe-fees`. A fee that is not known yet (no paid
payment, no balance transaction, no key, Stripe down) is a 503 before the handler runs, so Stripe sends the event again;
tfd books a payment once and never adds a fee later, so the Worker never books one at 0. An invoice with nothing
collected, or paid out of band, has a fee of 0.

**Portal.** `bun scripts/publish-plans.ts` also makes one billing portal configuration per school, with tfd's
`portalConfigOf`. No Trifold tier is sold in quantities, so it answers null and the configuration is tfd's base without
a subscription change: invoice history, the payment method, cancel at the period end, no tier switch. It is marked
`metadata[b4u_key]=portal`, `b4u_school` and `b4u_portal_version` (a hash of the form): a rerun finds it and changes it
only when the form changes. Its id is `portalConfiguration` in `src/published-plans.json`.

The Worker imports tfd through `packages/atm/src/cloud.ts`, a Worker-safe entry (no `node:fs`; Ajv is bundled but
never compiled because the menu is validated and the policy resolved when publishing).

Secrets (Worker secrets on `trifold-cloud-staging`, put from files under `~/.config/trifold/`, mode 600):

| Secret | File | |
|---|---|---|
| `STRIPE_BILLING_WEBHOOK_SECRET` | `stripe-test-billing-webhook.secret` | endpoint `we_1UZSkmDsfMqSNUOEcATOUMeH` (test mode, API `2025-10-29.clover`) |
| `STRIPE_SECRET_KEY` | `stripe-test-checkout.key` | a restricted TEST key (`rk_test_…`). Without it checkout and the portal answer 503, and every `invoice.paid` answers 503 (its fee can't be read) until it is set |

The restricted key must belong to the account the plans are published to (`stripeAccount` in
`src/published-plans.json`, `acct_1MmSzYDsfMqSNUOE`, Krono.Works (Mercury), test mode): a key from another account or
sandbox finds none of its prices, sessions or invoices. Make it there (Developers → API keys → Create restricted key)
with only:

| Resource | Access | For |
|---|---|---|
| Checkout Sessions | Write | creating sessions; reading one back for the portal |
| Customer portal | Write | portal sessions |
| Invoices | Read | an invoice's payments (fees) |
| PaymentIntents | Read | a payment's latest charge (fees) |
| Charges | Read | the charge of a payment made by charge (fees) |
| Balance | Read | the charge's balance transaction (fees) |

The endpoint sends exactly what Trifold's books take: `invoice.paid`, `invoice_payment.paid` (links a payment to its
invoice, so refunds and disputes find it), `customer.subscription.created/updated/deleted`, `charge.refunded`, and
`charge.dispute.created/closed` (the dispute and its fee). Not `payout.paid/failed`, which tfd's `STRIPE_WEBHOOK_EVENTS`
also lists: this Stripe account is shared, so its payouts hold money that is not Trifold's, and tfd would book a payout
(which names no school) into the first school tried. The fee needs no event: it is read from the API.

```sh
bun scripts/publish-plans.ts --dry-run   # then without --dry-run; commit src/published-plans.json and deploy
env -u CLOUDFLARE_API_TOKEN bunx wrangler@4.90.0 secret put STRIPE_SECRET_KEY --env staging < ~/.config/trifold/stripe-test-checkout.key
```

To rotate the key: make the new restricted key with the permissions above, write it over
`~/.config/trifold/stripe-test-checkout.key` (mode 600), run the `secret put` above (it takes effect without a
deploy), check `/billing/plans` reaches Stripe's Checkout page, then roll the old key in the dashboard (Roll key, expire
now). To rotate the webhook secret: roll it on the endpoint in the dashboard with the old one expiring in an hour (Stripe
signs with both until then), write the new one to `stripe-test-billing-webhook.secret`, and
`secret put STRIPE_BILLING_WEBHOOK_SECRET` the same way.

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
