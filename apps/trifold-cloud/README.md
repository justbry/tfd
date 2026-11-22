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

## Promissory notes: the counterparty's magic-link guest flow (staging)

Build step 2 of `docs/specs/promissory-notes.md` (plan: `plans/promissory-notes/steps-2-5.md`). A lender's side starts a
note through the API; each party gets their own single-use emailed link and acts without an account. The logic is in
`src/notes/` behind three ports (`MailSender`, `Clock`, `IdSource`) and a `NoteStore`, so it runs in tests with fakes.
One SQLite-backed Durable Object, `NoteDO` (binding `NOTE`), holds one note: its event log, hash-chain links, the two
contact records (the only place an address is kept), invites, sessions, step-up codes, rate counters and idempotency
records. Everything is built on the `tfd-notes` library (`validateStream`, `statement`, the chain, `checkAppend`).

| Route | Auth | What it does |
|---|---|---|
| `GET staging-ledger…/n/:id/enter?t=` | none | A page with one button. Redeems nothing (mail scanners fetch links) |
| `POST …/n/:id/enter` | the link token in the form | Redeems the link once, opens a session (2 hours idle, 12 absolute), sets `__Secure-tf_note` (`HttpOnly; Secure; SameSite=Lax; Path=/n/:id`), redirects to `/n/:id` with no token |
| `POST …/n/:id/link` | none | A new link to the address that matches, by email; the same page for any address; limited per note and per address |
| `GET …/n/:id` | session | Both balances side by side, the itemised difference, the schedule, "Needs you", the forms, the history |
| `POST …/n/:id/act`, `POST …/n/:id/code` | session and CSRF token | Enter an event; send a step-up code |
| `GET …/n/assets/notes.css` | none | The one stylesheet (CSP `style-src 'self'`, no script, no inline style) |
| `POST staging-api…/v1/notes` | bearer `NOTES_API_KEY` | `{ terms, lender_email, borrower_email, idem }` → `{ note_id }`; never returns a link |
| `GET staging-api…/v1/notes/:id/statement?as_of=` | bearer `NOTES_API_KEY` | `{ note_id, statement, chain }` |

All of it answers 404 outside staging, and every answer is `Cache-Control: no-store` with `Referrer-Policy: no-referrer`.
A guest may enter `terms.accepted`, `terms.declined` (borrower only), `payment.recorded`, `payment.confirmed`,
`payment.disputed`, `payment.resolved` and `annotation.added`; the server sets `id`, `seq`, `entered_at`, `entered_by`
(the session's role) and `via: "email-link"`. `terms.accepted`, `payment.disputed` and `payment.resolved` need a fresh
emailed 6-digit code (ten minutes, five tries, used once). A page says "confirmed by the holder of a**@e******.com",
never "signed". The two parties see each other's annotations in v1.

Two more Worker secrets (staging only; **not created**, put them yourself like the Stripe ones, from files under
`~/.config/trifold/`, mode 600, or move them to Secrets Store):

| Secret | What for | If unset |
|---|---|---|
| `NOTES_SESSION_SECRET` | keys the form tokens and the code hashes (32+ random bytes, base64) | every notes route answers 503 |
| `NOTES_API_KEY` | the bearer key of `/v1/notes` (32+ random bytes) | the API routes answer 401 |

```sh
env -u CLOUDFLARE_API_TOKEN bunx wrangler@4.90.0 secret put NOTES_SESSION_SECRET --env staging < ~/.config/trifold/notes-session.secret
env -u CLOUDFLARE_API_TOKEN bunx wrangler@4.90.0 secret put NOTES_API_KEY --env staging < ~/.config/trifold/notes-api.key
```

No email provider is wired: until one is chosen the Worker's mailer refuses, a create answers 502 `mail_failed` (the
note exists; each party can ask for a link on the page once mail works), and no email is sent from tests or from here.

### Build step 3: signed documents, release and notices (staging)

Receipts, payoff statements and releases are signed with the `receipt` key; chain-head seals with the `seal` key (plan
D3, the existing Secrets Store keys). The Secrets Store holds the PEM only, so the published key ids come from two
plain Worker vars. Unset, every document step answers 503 `not_configured` and writes nothing (the bundle still comes,
with no seal).

| Var | What for |
|---|---|
| `NOTES_RECEIPT_KEY_ID` | the id published in the key directory for the receipt key (`trifold-YYYY-MM`) |
| `NOTES_SEAL_KEY_ID` | the id published for the seal key |

| Route | Auth | What it does |
|---|---|---|
| `POST …/n/:id/receipt` | session and CSRF, either party | The receipt of one payment, at the current chain head; the first one issued is returned again, same bytes |
| `POST …/n/:id/payoff` | session and CSRF, lender | `as_of` (a date) only; signs the statement and appends `payoff.issued` with its sha256 |
| `POST …/n/:id/release` | session and CSRF, lender | `step=draft` appends `release.drafted`; `step=confirm&target=<draft>` needs the emailed code and the cooling-off (default 24 hours), then issues the `note.release` document |
| `POST …/n/:id/notice` | session and CSRF, lender | `reminder`, or `default` with `cure_days` 0 to 365 and the emailed code; mails the borrower a plain "a notice was recorded" email |
| `GET …/n/:id/docs/:docId`, `…/docs/:docId.json` | session, either party | A readable page; the file (`application/json`, `attachment`, `nosniff`) |
| `GET …/n/:id/bundle.json`, `…/n/:id/seal.json` | session, either party | `{ events, links, documents, seal }` for `tfd-verify-notes`; the latest seal |
| `GET staging-api…/v1/notes/:id/bundle`, `…/seal` | bearer `NOTES_API_KEY` | The same, for the API caller |

A document is only ever signed over a log that parses, validates and matches its chain; otherwise the step answers 409
`chain_invalid` ("Nothing was signed"). The four lender events are not accepted through the generic `act` route.

### Build step 4: organizations as parties (staging)

The lender of a note may be an organization. It acts through **agents**: people it registered by email, each with a stable
opaque `agent_ref` (random, never derived from the address) and a role. Every event an agent enters carries their
`agent_ref` and `via: "email-link"`, set by the server from the session; a client can never send either. Addresses live
only in the note's own Durable Object (`note_agents`, beside the two contact records). Pages say "the lender's team" and
never render a ref or an address; the borrower's address is never sent to an agent (an agent's page says "the borrower's
address"), and an agent's address is never shown to the borrower.

| Role | Reads the note and the portfolio | Records, drafts, confirms, sends | Asks for an approval | Approves | Board report |
|---|---|---|---|---|---|
| `treasurer` | yes | yes (a step the two-person rule covers still needs its approval) | yes | no | yes |
| `board` | yes | yes (same) | yes | yes, never their own request | yes |
| `viewer` | yes | no (every step answers `wrong_role`) | no | no | no |

**Two-person approval.** When the lender is an organization, confirming a release (`release.confirm`), a default notice
(`notice.default`) and a waiver (`waiver`) need an `approval.requested` from one agent and an `approval.granted` from a
different board member. `confirmRelease` and `sendNotice(default)` run `checkAppend` with that policy and answer
`approval_required` (409, with `missing: "request"` or `"approval"`) until it is satisfied. The cooling-off and the
emailed step-up code still apply, to the agent who confirms (the code goes to that agent's own address). Each approved
`notice.default` request allows exactly one default notice. A person lender has an empty policy: nothing changes for
them. **A waiver changes nothing in the engine.** v1 has no event that forgives money: a waiver approval records
`approval.requested`, `approval.granted` and an `annotation.added` saying that two people approved it and that no balance
changes; the statement is identical before and after.

**Where the organization's data lives.** The cross-note index is in **D1** (migration `0003_notes_org_index.sql`, tables
`note_org_index`, `org_agents`, `org_links`, `org_sessions`, `org_counters`): the staging D1 and its numbered migrations
already exist, every statement that must be atomic is one statement (`UPDATE ... RETURNING`, an upsert), and tests run the
real migration file on bun:sqlite behind a D1-shaped fake (`tests/fakes.ts`). It keeps no address: an agent is found by
a salted sha256 (`NOTES_SESSION_SECRET`, the organization id and the normalized address) used only to match a link
request; links and cookies are hashes. Apply it with `bun run migrate:staging` before using these routes. An
organization's agents are organization-wide: an address already known keeps its ref across notes, and the role last
stated for it applies everywhere.

| Route | Auth | What it does |
|---|---|---|
| `POST staging-api…/v1/notes` | bearer `NOTES_API_KEY` | now also `lender_org: { org_id, agents: [{ email, role }] }` instead of `lender_email`; `org_id` is 1 to 64 of `[A-Za-z0-9_-]`; answers `{ note_id, agents: [{ agent_ref, role, active }] }`; one link mailed to each agent, and the borrower's link as before |
| `POST …/v1/notes/:id/agents` | bearer | `{ action: "add", email, role }` (also brings a deactivated agent back) or `{ action: "deactivate", agent_ref \| email }`: deactivating ends the agent's sessions and pending links at once, on every note of the organization; history keeps the ref |
| `GET …/v1/orgs/:orgId/portfolio?as_of=` | bearer | `{ org_id, as_of, portfolio, approvals: [{ note_id, action, requested_at }] }`; 404 for an organization with no notes |
| `GET staging-ledger…/o/:orgId/enter?t=&n=` | none | A page with one button; redeems nothing |
| `POST …/o/:orgId/enter` | the link token in the form | Redeems once, opens an organization session (2 hours idle, 12 absolute), cookie `__Secure-tf_org` with `Path=/o/:orgId`; `n` (a note id) only picks where to land |
| `POST …/o/:orgId/link` | none | A new link to the agent whose address matches (sent to that address); the same page for any address; 3 an hour per address, 20 an hour per organization |
| `GET …/o/:orgId` | org session, any role | The portfolio: notes with aging, owed, overdue, awaiting confirmation, disputed, terms pending and closed; totals per currency; the approvals queue (Approve buttons for a board member, on other people's requests); a note that cannot be read is listed apart and left out of the totals |
| `GET …/o/:orgId/board.csv`, `board.json` | org session, treasurer or board | `as_of=` (default today). `text/csv` / JSON as an attachment, `nosniff`, `no-store`. Counts, amounts and dates only: no free text, agent refs, event ids or addresses; a cell that starts with `=`, `+`, `-` or `@` gets a leading `'` |
| `GET …/o/:orgId/n/:id` and `…/docs/:docId[.json]`, `…/bundle.json`, `…/seal.json` | org session, agent active on that note | The lender page of steps 2 and 3, with the agent's role, the approvals panel and release and notice buttons disabled with the reason until approved |
| `POST …/o/:orgId/n/:id/act`, `code`, `receipt`, `payoff`, `release`, `notice` | org session and CSRF | As on `/n/:id`, for the lender, by an agent who may act |
| `POST …/o/:orgId/n/:id/request`, `approve` | org session and CSRF | `action` and `target`, or `request_id`: ask for an approval (treasurer or board), approve (board) |

An organization that has no notes answers 404 on every `/o/:orgId` path, signed in or not. A signed-in agent opening a
note that is not their organization's gets a plain 404; an organization's cookie is nothing to another organization.
All of it answers 404 outside staging.

### Sharing a note (build step 5)

The audience is set per note and starts as the two parties. Widening needs both: the proposer counts as consent and the
other party agrees with an emailed code. A typed disclosure (a carve-out for the proposer's own books, legal advice,
enforcement or assignment) is active on its proposer's consent alone and is always listed for both parties. Either party
ends any share at any time. There is no public tier. A recipient is shown only what both parties count identically
(`sharedView` in `tfd-notes`); a dispute, an age, a notice, an annotation, an agent or a name is never an input to its
pages. The recipient's address is kept in the note's Durable Object only, and events carry an opaque reference.

| Route | Auth | What it does |
|---|---|---|
| `POST …/n/:id/share/propose` | session and CSRF, either party | `recipient_email`, `level` (`summary` or `statement`), `days` (1 to 365, default 30), optional `carve_out=1` with `purpose`. Ten proposals per note per day |
| `POST …/n/:id/share/consent` | session and CSRF, the other party, with the emailed code (`grant.consented`) | Makes a pending share active; a person is then emailed a single-use link |
| `POST …/n/:id/share/revoke` | session and CSRF, either party | Immediate; the page shows the exact revoke notice |
| `POST …/n/:id/share/verify-link`, `reveal`, `resend` | session and CSRF | Propose a verify link; show its token once (its proposer, after it is active); send a person's link again (its proposer; five a day) |
| `GET /s/:noteId/:grantId/enter?t=` | none | Shows a button, redeems nothing |
| `POST /s/:noteId/:grantId/enter` | the token in the form | Redeems once into a read-only session (cookie `__Secure-tf_share`, Path `/s/:noteId/:grantId`, at most 12 hours and never past the grant) |
| `GET /s/:noteId/:grantId` | share session | The view at the grant's level, re-evaluated on every request; "This share has ended." once it is not active. Any other method answers 403 |
| `GET`, `POST /v/:token` | the token in the path | Lists the issued documents (type, time, sha256, key id) and checks one pasted document (64 KB at most, not kept) against `NOTES_PUBLIC_KEYS_JSON`. Shows no amount, party or balance |

The same `share/...` steps exist under `/o/:orgId/n/:id` for a treasurer or board member (a viewer reads the panel and
presses nothing). The optional Worker variable `NOTES_PUBLIC_KEYS_JSON` is the published public keys (key id to PEM, or to
`{ pem, purpose, not_before, not_after }`); unset, the verify page says the check is not configured. A share cookie sent to
a `/n` or `/o` route is refused with 403. All of it answers 404 outside staging.

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
