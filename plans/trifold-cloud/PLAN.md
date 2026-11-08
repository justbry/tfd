# Trifold Cloud: the hosted, multi-tenant product

Status: plan, revision 11, 2026-11-08. Both reviewers 9/10. Owner decisions marked **(owner)**. Hosts are fixed in `docs/ci-and-deploy.md`
("Domains"). Previews of each host: `plans/trifold-cloud/previews/*.html`. Revision 11 answers every review round
(section 12).

## 1. What "fully working" means

A treasurer who has never heard of tfd can, on staging, with Stripe test mode:

1. Open `staging-ledger.trifold.app`, sign in with an emailed link, create an organization.
2. Connect the org's Stripe account (Connect OAuth, `read_only` scope, test mode).
3. Take an ordinary payment in Stripe: a Payment Link, a Checkout session or a paid invoice, with no Trifold metadata.
   The payment shows in the books, the dashboard, the ledger and the receipts list.
4. Open the payment's receipt, click **Verify**, land on `staging-verify.trifold.app`, and see "Signed by Trifold for
   Juniper School", the org-name verification state, and the seal check once the month is sealed.
5. Refund part of a payment in Stripe. One `payment.refunded` books and gets its own signed receipt.
6. Seal the month. The verifier shows the seal check for that receipt.
7. Invite a second person as a viewer; they see the public reports only, never the raw books or receipts.
8. Create an API key, call `GET staging-api.trifold.app/v1/orgs/<slug>/ledger`, get the same events.
9. Export everything as a zip (events, receipts, seals, public keys) and delete the org.

Each step is an automated end-to-end test (`apps/trifold-cloud/scripts/staging-e2e.ts`) that drives Stripe test mode
(`stripe` API with the connected account header) against staging. It is the acceptance test of M6. Production stays off
until the launch gate (section 10). "Within a minute" is a test timeout, never copy (no speed numbers).

## 2. Hosts

| Host | Runs | Project |
|---|---|---|
| `trifold.app` | Marketing site (live), docs at `/docs` | Pages `tfd-ledger` (`apps/trifold-site`) |
| `ledger.trifold.app` | Product UI and its session API | Worker `trifold-cloud` (`apps/trifold-cloud`) |
| `api.trifold.app` | `/v1` (keys), `/public/v1` (no auth, CORS), `/webhooks/*` | Same Worker, routed by `Host` |
| `verify.trifold.app` | Receipt verifier, `/.well-known/trifold-keys.json` | Pages `trifold-verify` (`apps/trifold-verify`), static |
| `staging-ledger`, `staging-api`, `staging-verify` | Staging | `--env staging`; separate D1, buckets and signing key |
| `send.trifold.app` | Transactional email | Cloudflare Email Sending |

Cookies are host-only (`__Host-tf_session` on `ledger.`); `api.` takes bearer keys only and never reads cookies.

## 3. Architecture

```
 ledger.trifold.app ─┐                 ┌─ D1: users, orgs, memberships, sessions, login links, invites,
                     ├─ Worker ────────┤      api_keys, stripe_accounts (unique), audit, org_directory
 api.trifold.app ────┘  trifold-cloud  └─ OrgDO (one per org, SQLite storage)
        │                                   ├─ tfd handler tables (HANDLER_DDL), outbox, stored inputs
 Stripe Connect → /webhooks/stripe ─────────┤  inbox (accepted, not yet applied), refusals, counters
   (verify, 200, hand to OrgDO inbox)       ├─ alarm: apply inbox → ship → views → seals
                                            └─ R2 trifold-<env>-books: schools/<orgId>/…  (one bucket per env)
 verify.trifold.app (static) ── keys file (same origin) + api.trifold.app/public/v1 (seals, org directory)
```

### 3.1 The engine in a Durable Object

- **Entry point.** New `tfd/cloud` export (`packages/atm/src/cloud.ts`): `handleStripeWebhook` (the function that
  writes the claim, outbox and stored inputs, `index.ts:858-865`; `handleStripeEvent` only decides), `HANDLER_DDL`,
  `shipOutbox`, `shipInputs`, `runViews`, `receiptOf`, `signReceipt`, `sealOf`, `signSeal`. A bundle test (like
  `tests/ledger-read-bundle.test.ts`) fails on `node:fs`, `node:path`, `child_process`, `eval`; a workerd test proves
  `node:crypto` Ed25519 signing and that `sqlite_master` and `pragma_table_info` (`handler/schema.ts:224-235`) work on
  Durable Object SQLite. This is M3's first task; nothing else in M3 starts before it is green.
- **SqlDatabase adapter** (`types.ts:2869-2881`, synchronous) over `ctx.storage.sql`. Not a copy of the `BEGIN`/`COMMIT` sketch
  (`bun-sqlite.ts:9-17`; the bun adapter is `:25-37`): Durable Object SQLite rejects `BEGIN`/`COMMIT`, so `transaction` is
  `ctx.storage.transactionSync` (the handler never nests it, `bun-sqlite.ts:21-22`); `exec` splits multi-statement
  DDL (`HANDLER_DDL`, with `WITHOUT ROWID`, `schema.ts:61-73`); `run().changes` comes from `SELECT changes()` after the statement
  (not `rowsWritten`, a billing count that includes index writes; the handler needs exactly 1 for claims and revisions,
  `stripe-webhook.ts:517, 529, 564, 618`). A
  Miniflare test runs `HANDLER_DDL` and the handler's golden deliveries through it before any webhook code exists.
- **Async work first, then the synchronous handler.** The DO calls `handleStripeWebhook` with the raw body, re-signed
  at apply time with a per-org internal secret (`signStripePayload`, `index.ts:851`) passed as `deps.secret`. Stripe's
  own signature is checked once by the Worker; re-signing keeps retries hours later inside the handler's 300 s window
  (`stripe-webhook.ts:1275-1281`). A 401 from the handler is a bug: alert, never retried. Before that it loads the org's context (menu, policy, catalog;
  `types.ts:2915-2925`) and fetches the fee (`paymentFee`, `types.ts:2971`, with the `Stripe-Account` header) before
  the call: the charge's `balance_transaction` becomes `paymentFee` (`types.ts:2958-2965`, extended to the merchant
  trigger), and, for the merchant mapping, the payment's Checkout line items or invoice lines (the product for the
  income account).
- **Migrations.** A `schema_version` row; the constructor runs pending steps in `blockConcurrencyWhile`. Upgrading tfd
  is a Worker deploy; each DO migrates itself on its next wake. A migration test opens a DO at every past version.

### 3.2 Ordinary payments (engine work, M3)

Today the handler books only events carrying `b4u_school` and `family_id` metadata, and only `invoice.paid` makes a
`payment.succeeded` (`handler/stripe-webhook.ts:191-202, 373-405`). The cloud needs a **merchant mapping** in the
engine, beside the existing one, chosen per org:

- **Each payment books once, to an account the finance views sum.** `payment.succeeded` credits
  `income:billing:<kind>` (`postings.ts:208-215`), and month totals sum only `income:billing:*` (`finance.ts:25-27,
  60`), so the merchant mapping uses kind `booking` for Checkout and Payment Links and `other` for a bare payment
  intent; the product goes in `labels.product`, not the account.
  - **One idem per payment: `stripe:<pi_…>` whenever a payment intent exists**, on every path (today `invoice.paid`
    uses `stripe:<in_…>` and Checkout `stripe:<pi_…>`, `money.ts:152, 233-237`, so a Checkout that also creates an
    invoice would book twice). Whichever event applies first books; the other finds the idem in the outbox and writes
    nothing. This holds even when the payment intent applies before Stripe has made the invoice.
  - **Both directions are looked up.** For `invoice.paid` the async step lists
    `GET /v1/invoice_payments?invoice=in_…` (with `Stripe-Account`), because the pinned API's webhook payload carries
    no `payments` and `invoiceRefsOf` gets payment refs only from `deps.paymentRefs` or an expanded `invoice.payments`
    (`stripe-webhook.ts:310-329`). The result is passed as `deps.paymentRefs`, chooses the idem and is kept in the stored
    inputs. On the pinned API an invoice payment is a `payment_intent` or a `charge` (`objects.clover.json:3215`); the customer balance is not an
    invoice payment, it is on the invoice (`starting_balance`, `ending_balance`). So: if the lookup fails, or a
    default invoice payment is still `open`, the event retries. Once the invoice is paid, each paid `payment_intent`
    or `charge` books under its own idem. A paid invoice with `amount_paid > 0`, an empty paid list and no balance
    change keeps retrying (Stripe's list can lag); the only terminal outcomes are booked payments or a credit-only
    marker. **Customer balance applied to an invoice is not booked as income**:
    it isn't money received in that invoice (it may be a goodwill credit, or an overpayment already booked), so the
    handler writes a `money.skipped` marker with `kind: "invoice"` and a new `reason: "customer_balance"` (today
    `reason` allows only `non_usd`, `schema/payload/money.skipped.v1.json:14-19`; additive, with an `UPGRADING.md`
    note), idem `stripe:<in_…>:customer_balance`, the invoice's currency, and the credit consumed as a non-negative
    amount (Stripe balances are negative for credit: consumed = `ending_balance - starting_balance` when that is
    positive; credit created by an overpayment is already inside the payment and gets no marker). A new builder beside
    `skippedNonUsd` (`billing/money.ts:46-76`), which hard-codes the reason and idem. Every reader that today treats
    any marker as non-USD checks `reason === "non_usd"`: `skippedLines` and the claim outcome and warning in
    `handler/stripe-webhook.ts:653-659, 929-934, 975` (a golden test: a credit-only invoice is answered `applied`, not
    `non_usd`); `reconcile.ts:647-650` and `scenario/generate.ts:751-754` gain a bucket; `finance.ts:217` and
    `report.ts:129` already filter. The UI reads the markers through a new read path, and the UI shows it under the invoice. A credit-only invoice (`amount_paid` may be 0) books
    only that marker and never retries. **(owner: book credits as income instead; default no.)** An invoice paid by several payment intents
    books one line per payment intent, for that payment's amount.
  - **Fees wait for Stripe.** When the charge's `balance_transaction` isn't ready yet (some payment methods), the async
    step answers 409 inside the DO and retries; it never books a zero fee (a first delivery's fee is never updated later,
    `stripe-webhook.ts:88, 707-711`).
  - A payment backed by an invoice is booked by `invoice.paid` or its payment intent, with `paymentFee`
    (`stripe-webhook.ts:645-647`). In merchant mode `invoice.paid` is **money only**: no `b4u_school`/`family_id`
    (`handle.ts:134-139`), no menu matching (which refuses unknown prices, `handle.ts:144-156`), no grants; kind
    `other`, product in `labels.product`. `customer.subscription.*` (`stripe-webhook.ts:194-196`) is not handled in
    merchant mode.
  - Any other payment is booked by `payment_intent.succeeded`, idem `stripe:<pi_…>`, reusing the Checkout helper
    already keyed that way (`money.ts:233-251`). The async step decides which case applies (it looks up an
    `invoice_payment` for the payment intent; the pinned API `2025-10-29.clover` has no `invoice` on a PaymentIntent,
    `types.ts:951`), loads the fee for this case too, and the Checkout line items for `labels.product`.
  - `checkout.session.completed` books nothing in merchant mode. Delayed (ACH) payments book when their payment intent
    succeeds.
  - **Refunds and disputes resolve without an invoice.** Today `atm_payment_index.invoice_id` is `NOT NULL`
    (`schema.ts:29-33`), `locateSubject` inner-joins the invoice index (`stripe-webhook.ts:463-480`), and a refund or
    dispute books only when `grants.invoices[invoiceId].paid` is set (`handle.ts:349-353, 409-411`; otherwise
    `money.ts:310-311` returns nothing). Engine change (a new table rebuild step in `migrateHandlerSchema` (create, copy, drop, rename; SQLite has no `ALTER COLUMN`, and
    `HANDLER_DDL` is `IF NOT EXISTS`, `schema.ts:53-55`). It must run on databases that already have `env`, where
    today's migration returns early (`schema.ts:348`); new org databases get the new shape directly): the payment index gains
    `subject_key` and `invoice_id` becomes nullable; `locateSubject` uses `subject_key` when there is no invoice;
    merchant booking records the payment intent, charge and amount on the subject, and the merchant `charge.refunded`
    and dispute paths call `refundEvents` and the dispute events from that record. Golden tests: a Payment Link
    payment then `charge.refunded` books one `payment.refunded`; the same for a dispute; an invoice-backed Checkout
    books once, whichever of its two events applies first.
  - A refund or dispute of a charge created before the org connected Stripe (the refunded charge's `created`; for a
    dispute the async step fetches the charge) is answered 200 and ignored (unless a
    backfill is running), so it doesn't fill **Refusals**. Golden tests for both.
- `charge.refunded` books `payment.refunded`; payouts, failed payouts and disputes as today.
- **Mapping and locating, merchant mode.** A new `2025-10-29.clover` mapping for `payment_intent.succeeded` in
  `schema/mapping/` (today `mappingFor` answers `unknown_mapping`, `normalize.ts:357-372`, `handle.ts:706-712`), and the
  type joins `HANDLED_TYPES` (`stripe-webhook.ts:191`). In merchant mode, `payment_intent.succeeded` and money-only
  `invoice.paid` are located from the org id plus the `customer:`/`payment:` holder, not by `locateHolder`
  (whose 200 `ignored` path, which stores the claim done so Stripe never retries, `stripe-webhook.ts:72-73, 382, 1304`,
  stays B4 Uni only), and payment index rows for both the `pi_…` and the `ch_…` refs (the charge id from the payment intent's
  `latest_charge`, fetched in the async step when the payload lacks it) (`subject_key`, nullable invoice, amount; refunds look
  up both, `stripe-webhook.ts:295-302, 907-911`) are inserted in the same transaction as the booking, so a later refund finds it. The money builder is generalized: today
  `bookingPaymentEvents` hard-codes kind `booking` and a booking id (`money.ts:272-286`); a bare payment intent books
  kind `other` with no booking id. The merchant refund path skips the `unlinkedInvoice`/`removeOnFullRefund` rule
  (`handle.ts:192-202, 339-344`, `policy.ts:10`), which would 409 a full refund. `stripe:<pi_…>` idems apply in
  merchant mode only; the B4 Uni mapping keeps `stripe:<in_…>`. In merchant mode `b4u_school` metadata is ignored.
  **The school id is always the org id (`org_<ULID>`), never Stripe's `acct_…`.** `event.account` is only the intake
  routing key: the Worker looks it up in `stripe_accounts`, and the OrgDO refuses an event whose account isn't its own
  row. The DO passes its org id as `deps.schoolId`; it is the first segment of the subject key (`schoolOf`,
  `stripe-webhook.ts:292`), the context lookup (`:828-829`), the `school_mismatch` check (`:386`), the events,
  `receipt.school`, the bucket prefix and the public seal URL.
- Member totals and ledger rows treat only `family:` as a holder today (`finance.ts:35, 443`, `ledger-rows.ts:265`);
  the engine change makes both count `customer:` and `payment:` keys, with golden tests.
- The holder key is `customer:<HMAC-SHA256(org salt, customer id)>`, so it can't be reversed from a known customer id.
  `payment:<HMAC(pi)>` when there is no customer; member views leave those out and show them as one "Unattributed"
  total (month totals already count them). The salt is per org and only destroyed when the org is deleted; erasing one
  member is `subject.erased` plus `eraseStoredInputs` (S8 D4).
- **Replays stay exact.** The stored inputs (`inputs.ts:223`) gain the async step's results: the invoice-backed
  decision, `labels.product` and the salt version, beside `fee`, `paymentRefs` and `bookingRefs`. They remain trimmed
  facts, never raw bodies; shipping them to R2 is covered by the D13 answer.
- **Connect endpoint events**: `payment_intent.succeeded`, `invoice.paid`, `charge.refunded`, `charge.dispute.*`,
  `payout.paid`, `payout.failed`, `account.application.deauthorized`. `invoice_payment.paid` is not subscribed in
  merchant mode (in B4 Uni mode it goes through `settlePayment`, `stripe-webhook.ts:1294-1301`).
- **Credit-balance invoices**: see above; golden tests for credit-only, mixed (payment intent plus balance) and an
  invoice whose payment is still open.
- **API version.** The Connect endpoint and every Stripe call pin `2025-10-29.clover`; any other version is refused as
  `unknown_mapping` (`handle.ts:704-712`).
- At org creation a starter catalog with one add-on ("Payments") is seeded, since an empty menu can't be published
  (`catalog.ts:39-41`); a `catalog.published` event is appended and the same catalog passed to `runViews`, which reads
  the log and otherwise returns `no-catalog` (`run-views.ts:32-39`, `summary.ts:210-218`). A golden test builds views
  from a log of merchant events only.

It is released as a tfd minor version with golden tests and a `UPGRADING.md` entry. The B4 Uni mapping is unchanged.

### 3.3 Intake

- `POST api.trifold.app/webhooks/stripe` (a Connect endpoint). Body capped at 256 KB; signature checked with the
  platform's endpoint secret (`constructEvent`-equivalent on WebCrypto, 5-minute tolerance).
- Raw body verified before parsing. Routing is on `event.account` only: an event with no `account` (a platform event)
  is ignored here; `event.account` maps to an org through `stripe_accounts`, unique on `(account_id, livemode)`. An
  unknown account gets 503 while an OAuth connection for it is in progress (a `stripe_oauth_pending` row, 1 hour), so a
  webhook that beats the callback is retried by Stripe; otherwise 200, logged.
- **After a valid signature, the Worker answers 2xx once the OrgDO has stored the event in its inbox** (idempotent
  on the event id), and 5xx if that write fails, so Stripe retries only a delivery Trifold never kept. The DO applies it in its alarm. The handler's own status decides what the DO does: 200 done; 409 retried with backoff for 3 days, then
  **Refusals**; 422 straight to **Refusals** (fixing the org's setup and pressing Retry re-runs it). One misconfigured org can't push the shared endpoint's failure rate up.
- The `stripe_accounts` row is committed before the OAuth redirect returns, so no early event is dropped. Importing
  payments from before the connection is an optional backfill (M7).
- `account.application.deauthorized` marks the account disconnected; the books stay.
- **Environments never mix.** Staging takes test mode only; production takes live mode only and answers test events
  200 without applying them. One bucket per environment, as `S8-contract.md` D2 does.

### 3.4 Shipping, views, seals

- Inside the alarm, in order: apply the inbox, `shipInputs` first (every shipped event must already have its input,
  `ship-inputs.ts:8-9`), then `shipOutbox` to R2 under `schools/<orgId>/` (the prefix `runViews` and
  the ledger worker read, `ship.ts:90`, `run-views.ts:27-38`), write `events/_shipped-through.json` as `{school, env, shippedThrough}` (`watermark.ts:13-28`; the watermark the
  readers use for `asOf`, `data/watermark.ts:8-10`, which `shipOutbox` doesn't write), then `runViews`. `shipInputs`
  has never run against R2 and imports `FolderStore` (`ship-inputs.ts:17`, which pulls `node:fs`); M3 splits that
  import so the bundle test passes, and tests it against R2. A `conflicts` result from `shipOutbox` (rows that never move,
  `ship.ts:157-165`) raises an alert and shows on the org's status. The ledger worker's global `scheduled` scan (`views-job.ts:110-120`) is not exported by the cloud.
- **Seals** (`schools/<orgId>/ledger/seals.jsonl`, `packages/atm/README.md:264`) are never made by the regular alarm,
  which would re-seal an open month on every ship (`seal.ts:53-57`). An owner seals a closed month by hand, or a
  once-per-month alarm seals the previous month 7 days after it ends **(owner)**; both only after a successful ship.
  **Late events re-seal.** When a ship includes events dated in an already sealed month (a retried refusal, a slow
  ACH payment), the alarm seals that month again (a new line chained by `prev_seal_hash`; `sealOf` allows it,
  `seal.ts:52-58`). The public endpoint returns the latest seal. Written with `putIfMatch` on the seal chain head (the CLI's lock file has no cloud
  equivalent).
- **Cost.** `runViews` runs at most once per 5 minutes per org (alarms batch), and re-reads the whole history
  (`run-views.ts:38`). Fine to about 50,000 events per org; past that
  it moves to per-month incremental views (M7 load test sets the line).

### 3.5 Receipts, keys, issuers

- **Signed once, at ship time, idempotently** (put-if-absent on `receipts/<event_id>.json`, so a crash between ship
  and sign can't issue two receipts with different `issued_at`). Only the revocation runbook overwrites it (a
  separate, owner-run path with its own test). Until the receipt exists the UI shows the payment as "signing". After each ship the DO signs a receipt for every new `payment.succeeded` and
  `payment.refunded` (`receiptOf` + `signReceipt`) and stores it at `schools/<orgId>/receipts/<event_id>.json`. The
  receipt equals `receiptOfV2(event, receipt.issued_at)`, so the books check in `plans/atm-signed-receipts.md` still holds; storing the signed
  copy means a key rotation never changes an issued receipt and old private keys never need to stay online (they are
  archived offline).
- One platform key per environment and per purpose (receipts and seals; a separate key for directory documents), in
  Secrets Store, key id `trifold-YYYY-MM` **(owner: id format)**. Staging and production key files are separate.
- **Receipt v2.** Receipt v1 has no signing time (`receipt.ts:64-77`) and its schema and verifiers pin `v: 1`
  (`schema/receipt.v1.json:28-29`, `packages/verify/src/core.ts:20, 415, 441`). The cloud issues v2: v1 plus a signed
  `issued_at` **(owner: approve v2)**. M1 work: `schema/receipt.v2.json`, a v2 builder (`receiptOfV2(event,
  issuedAt)`), `verifyReceipt` in `packages/atm` and `packages/verify` accepting v1 and v2, the books check
  (`checkReceiptAgainstEvents`, which compares canonical bytes, `receipt.ts:132-134`) comparing the v2 receipt with
  `receiptOfV2(event, receipt.issued_at)`, and golden v2 receipts with test vectors. v1 stays frozen and verifiable.
- **Keys.** Two signing keys per environment, one for receipts and one for seals, plus a third for directory
  documents. The keys file is `{key_id: {pem, purpose: "receipt"|"seal"|"directory", not_before, not_after,
  revoked_at?}}`, a superset of today's `{key_id: PEM}`. The signer always uses the current key. The verifier fails a
  key used for the wrong purpose and a v2 receipt (or seal, by `sealed_at`) whose time is outside its key's window.
  **A revoked key fails everything it ever signed, whatever `issued_at` says**, because a thief can backdate
  `issued_at`; the revocation runbook re-signs that key's receipts with the current key and a fresh `issued_at`, and appends a new
  seal line for each affected month under the current key (re-signing a seal in place would change its hash and break
  every later `prev_seal_hash`, `seal.ts:50, 85, 143`); `verifySeals` treats a revoked-key line as superseded once a
  later valid seal of the same month exists, and still accepts it as a link in the chain (its hash, not its
  signature), so `prev_seal_hash` doesn't break. The rule lands in both chain checks: `packages/atm/src/ledger/seal.ts`
  (`verifySeals`) and `packages/verify/src/core.ts` (its own chain check, `:551-586`); M1 tests run on both. M1 tests: a backdated forgery under a revoked key, and a revocation
  followed by re-sign and re-seal that verifies.
- Runbooks in `docs/ci-and-deploy.md`: rotation (publish the new key, deploy `trifold-verify`, switch the signer,
  close the old window) and revocation (set `revoked_at`, re-sign that key's receipts and seals with the current key,
  notify orgs that printed copies need the new link).
- **Issuer wording.** The key is Trifold's, so the verifier says "Signed by Trifold for *Juniper School*". Below it, it
  says either "Organization name verified (domain juniper.school)" or "Name as entered by the organization, not
  verified". Verification: a DNS TXT record or an email on the org's domain (M6); EIN check later.
- **Seal publishing** is on by default and disclosed at onboarding: the public seal shows the month's event ids, event
  count, transaction count and `events_hash` (`seal.ts:44-49`); no amounts per person, no names. An owner can turn it off; the verifier then shows the signature check
  only **(owner: default)**.
- **Org directory.** `GET api.trifold.app/public/v1/orgs/<orgId>` returns `{org_id, name, verification, domain, issued_at}`,
  signed with the directory key. The verifier checks that signature against the keys file before it shows the
  name, and never trusts a name inside the receipt. Org ids are `org_<ULID>`, inside the claim's pattern
  `^[0-9A-Za-z_-]+$` (`claims.ts:26`).

## 4. Sign-in, roles, sessions

- **Email link**, no passwords. `POST /auth/link` (Turnstile) stores a SHA-256 of a 32-byte token, 15-minute expiry,
  single use. The emailed link opens a page with a **Continue** button that POSTs the token, so mail scanners that
  fetch links don't use it up. Same answer whether or not the address exists. Rate limits per address and per IP.
- **Session**: `__Host-tf_session`, HttpOnly, Secure, SameSite=Lax, 30-day sliding, stored hashed in D1, revocable,
  rotated at sign-in and step-up. The link token is consumed atomically (`UPDATE … WHERE used_at IS NULL` must change
  one row). CSRF: a separate non-HttpOnly `__Host-tf_csrf` cookie echoed in a header, plus an `Origin` check, on every
  non-GET.
- **Step-up**: owner actions (API keys, Stripe connect and disconnect, roles, export, delete) need a fresh email-link
  confirmation within 10 minutes, stored as `stepped_up_at` on the session row. It is not the ledger token's `su`
  claim, which stays the PIN step-up the ledger worker defines (`claims.ts:21-22`).
- **Roles** per membership: `owner`, `admin`, `finance` flag, `viewer`. Owners are always minted with `finance: true`
  (the ledger worker's finance gate reads only `grant.finance`, `ledger-worker/src/worker.ts:391`).
- **Settings writes** go through `trifold-cloud`'s own settings API, which applies the role table below and writes the
  config objects. The ledger worker's PIN-gated config PUTs (`routes/config.ts:85-89`) are not exposed in the cloud.

| | owner | admin + finance | admin | viewer |
|---|---|---|---|---|
| Public reports, dashboard totals | ✓ | ✓ | ✓ | ✓ |
| Raw ledger, members, receipts, refusals | ✓ | ✓ | – | – |
| Settings, invites | ✓ | ✓ | ✓ | – |
| Stripe, API keys, export, delete, roles | ✓ (step-up) | – | – | – |

- **Abuse**: Turnstile on sign-in and org creation; orgs per account as the plan allows (1 on Free and Starter, 3 on
  Pro); connecting a live Stripe account needs a step-up.

## 5. Stripe and billing

- **Connect Standard, OAuth with `scope=read_only`** **(owner: approve Connect; needs a Trifold platform account; confirm with Stripe that Standard OAuth with `read_only`
  is offered to new platforms and that Connect webhooks arrive for `read_only` accounts. Fallback: Connect with
  `read_write` and the copy changes to "Trifold only reads")**.
  The OAuth `state` is a random value bound to the session and the org, single use. With `read_only`, the UI can truly
  say Trifold can't move money.
- **Trifold's own billing** (Starter, Pro, Witnessed): Stripe Checkout and the customer portal on the platform
  account, per account (the person or firm paying), covering the orgs that plan allows (pricing strategy: 1 on Free and
  Starter, 3 on Pro). Webhooks to `/webhooks/billing`, with a separate secret.
- **Seats** are counted for the tier limit (Free has 2), never charged per seat. CPA and auditor seats don't count.

## 6. Reads: the ledger worker as a library

`createLedgerWorker` (`packages/ledger-worker/src/worker.ts`) is reused inside `trifold-cloud`, with these conditions:

- The token keeps the claim name `schools` (`auth/claims.ts:28-31`); the cloud mints it with
  `iss = https://ledger.trifold.app`, `aud = "atm-ledger"`, `exp - iat <= 300`.
- `fetchJwks` is injected in-process (`worker.ts:228`), so the Worker never fetches its own host.
- Paths stay `/v1/schools/<orgId>/…` inside; the session API maps `/o/<slug>` to the org id at the edge.
- The bucket layout stays `schools/<orgId>/` (an internal name), so `R2BindingStore` needs no prefix option.
- Org creation writes the config objects the ledger worker reads (`config/store.ts:32, 164`): `settings.json`,
  `disclosure.json`, `booking-rules.json`, `plans-draft.json`, `promos.json` and `manifest.json` under
  `schools/<orgId>/config/`, plus the catalog (section 3.2), so every read endpoint answers on day one.
- **API keys** reach the same routes: the Worker checks the hashed key, then mints the same short `schools[]` token
  (org id, role, finance) in-process. `/v1/orgs/<slug>/…` on `api.` maps to `/v1/schools/<orgId>/…`
  (`ledger-worker/src/worker.ts:63, 120-172`); events are `/v1/orgs/<slug>/ledger`. `LEDGER_DEMO_SCHOOLS` stays off.
- **New code, budgeted in M4 and M5**: raw events read, receipts list and one receipt, seals, refusals, members and
  roles, API keys, billing, export.

## 7. The product UI

`packages/ledger-ui` gets a `cloud` data source: the token comes from `POST /session/ledger-token` (cookie + CSRF);
writes go to `trifold-cloud`. Path routing `/o/<slug>/<tab>`; hash links redirect. New screens: sign-in, org picker,
onboarding (create org, connect Stripe, invite), receipts, seals, refusals, people and roles, API keys, plan and
limits, export and delete. The B4 Uni build keeps its own data source.

## 8. verify.trifold.app

- `apps/trifold-verify`: a static Vite + Svelte build of the site's verifier (`VerifierFull`, `packages/verify`).
- **Printed link form: `https://verify.trifold.app/#r=<base64url(JSON)>`**. The fragment never reaches a server. `?r=`
  is still accepted (`packages/verify/src/link.ts`) **(owner: confirm)**.
- The signature check runs in the browser against `/.well-known/trifold-keys.json` (same origin; every key ever used,
  never removed, `Access-Control-Allow-Origin: *`).
- **The seal check** is new verifier code: `checkReceiptInSeal` in `packages/verify` (Apache-2.0, no `packages/atm`
  import; today `check.ts:62-110` checks seals only together with the org's events). It fetches the month's signed seal from `api.trifold.app/public/v1/orgs/<orgId>/seals/<YYYY-MM>`.
  No seal for the month yet means "not sealed yet", not a failure. It passes when the seal's signature verifies, `seal.school === receipt.school`, `seal.month` is the month of
  `receipt.date`, and `receipt.event_id ∈ seal.event_ids`. Event ids carry no personal
  data. No raw events are published (D13), so there is no separate "in the books" check; the seal is that check.
- **Copy**: "The receipt is checked in your browser. To check the seal, this page asks Trifold for the organization's
  public seal; the receipt itself is never sent." Result: "Signed by Trifold for Juniper School and unchanged since."
  It never says the payment happened, or anything about tax treatment.
- `/public/v1` (seals, directory) answers with `Access-Control-Allow-Origin: https://verify.trifold.app` (and the
  staging host on staging), `GET` only.
- Before org-name verification ships (M6) every org shows the unverified wording.
- Phone first: one result, the checks, nothing else above the fold.

## 9. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Infra and safety | DNS for every host; D1 (Time Travel on), buckets per env, Secrets Store keys; `trifold-cloud` `/healthz` on `staging-ledger` and `staging-api`; CI deploys staging; error reporting and logs on; nightly copy of each books bucket to a locked backup bucket; www→apex; `hello@` routed |
| M1 | Verifier | `checkReceiptInSeal` and key windows in `packages/verify`; `staging-verify` verifies the golden receipts (`packages/atm/tests/golden/receipt/`) and fails each tampered one; keys file with CORS; mobile Lighthouse ≥ 95 |
| M2 | Accounts | Email sign-in, sessions, CSRF, Turnstile, orgs, memberships, invites, roles, step-up; D1 migrations; a test for every auth refusal and every cell of the role table |
| M3 | Books intake | `tfd/cloud` export and workerd tests; merchant mapping released in tfd; OrgDO, adapter, migrations; Connect OAuth (test); webhook → inbox → handler → ship → views → seals; duplicates book once; refusals retry and surface; envs never mix; a real test-mode receipt verifies on `staging-verify` |
| M4 | Product UI | `cloud` source, path routing, onboarding, receipts with Verify links, seals, refusals, roles. Steps 1–7 of section 1 pass in a browser test |
| M5 | API | `/v1` reads including `GET /v1/orgs` and `/reports/income`, API keys (`tf_live_`/`tf_test_` prefixes, hashed, shown once, inherit the creator's role, revoked when the membership ends), `/public/v1`, OpenAPI document, docs at `trifold.app/docs/api`. Step 8 passes |
| M6 | Plans and data rights | Trifold billing, limits from the rate card (`pricing-strategy.md`: Free 1,000 events, 200 credits, 2 seats; soft event cap with 80% and 100% warnings; orgs per plan), org-name verification, export zip (streamed to R2, then a signed download link), org deletion (DO storage wiped, R2 prefix deleted, D1 rows tombstoned; afterwards the public seal endpoint answers
  410 and the verifier says the issuer deleted these books; backups and D1 Time Travel keep data up to their
  retention window (30 days), stated in the privacy policy. Member erasure inside a live org follows the engine's
  `subject.erased` and S8 D4). **All of section 1 passes on staging in CI** |
| M7 | Hardening | Rate limits on every route, audit log UI, `security.txt`, status page, restore drill from backups, load test (100 orgs × 1,000 events) |

## 10. Production launch gate

Production (`ledger.`, `api.`) stays unbound in `wrangler.jsonc` until all of these are true, with a test that fails
if a production binding appears early (as `packages/ledger-worker/tests/assets.test.ts` does today):

- D13 answered: personal-keyed events (`customer:<hash>`) may live in a production bucket, with retention and region
  stated.
- Legal entity, privacy policy, terms, DPA published.
- Trademark clearance for "Trifold" done.
- Stripe Connect platform approved.
- Section 1's staging e2e green in CI for 14 days running; ship-conflict and refusal alerts wired to a person; a restore
  drill from the D1, Durable Object and R2 backups done.
- Only then does the marketing site switch "Get early access" to "Start free" (messaging rule 6.2).

## 11. Claim rules the product must follow

From `AGENTS.md` and `docs/website/messaging.md`: never "triple-entry", "immutable", "open source" (for the engine),
"verified by Stripe", "Witnessed by Trifold" (until the witness ships), or a speed number. Verification, export and
deletion are never paywalled. "Trifold can't move your money" only with the `read_only` OAuth scope.

## 12. Review log

| Round | Opus | Grok | Main changes |
|---|---|---|---|
| 1 | 4/10 | 4/10 | Merchant mapping (3.2); 2xx-then-inbox intake (3.3); env separation; issuer wording and org directory (3.5); seal check through `/public/v1` (8); `tfd/cloud` export and workerd tests first (3.1); ledger-worker reuse conditions (6); step-up on the session; POST-confirm sign-in; Turnstile; role table; milestone order; backups in M0; DO migrations; key chosen by event date; `read_only` scope. From Grok: `handleStripeWebhook`; adapter details; watermark write; seals off the regular alarm; API keys mint the `schools[]` token; platform events ignored; launch gate adds e2e, alerts and restore drill; CSRF cookie, atomic link use, session rotation |
| 2 | 6/10 | 6/10 (on r3) | Re-sign at apply (signature window); one payment trigger (`payment_intent.succeeded`) with enrichment; `changes()`; `checkReceiptInSeal`; late events re-seal; receipts signed at ship time and stored; key windows and revocation; 2xx only after the inbox write; HMAC holder keys; `catalog.published` at org creation; seal publishing opt-out; plan fixes. From Grok: `income:billing:booking|other`; invoice-backed payments via `invoice.paid`; payment index written at booking for refunds; real starter catalog plus `catalog.published`; member totals count `customer:` keys; `shipInputs` before `shipOutbox`; directory signature checked; `FolderStore` import split |
| 3 | 7/10 | 7/10 (on r5) | Merchant `invoice.paid` money only; invoice index plus paid record for refunds and disputes; receipt v2 with signed `issued_at`, windows on signing time, key purpose; API version pinned; stored inputs extended; seal check matches school and month; directory doc fields; config objects named; refund step in section 1. From Grok: one idem `stripe:<pi>` on every path; payment index `subject_key`, nullable invoice, `locateSubject` and refund/dispute paths from the subject record; holders in ledger rows; watermark body |
| 4 | 8/10 | 8/10 (on r6) | `invoice_payments` lookup for `invoice.paid`, no `in_` fallback on failure; multi-payment invoices; fee retry; revoked key fails everything; receipt v2 schema, builder, verifiers and books check minus `issued_at`; pre-connection refunds ignored; owners get `finance`; settings API in the cloud; milestone steps; two signing keys. From Grok: `payment_intent.succeeded` mapping; merchant locate from `event.account` and holder with the payment index inserted in the booking transaction; generalized money builder; full-refund rule skipped; `ALTER` migration; empty fee 409; missing seal means not sealed |
| 5 | **9/10** | 8/10 | Revocation re-signs with fresh `issued_at` and re-seals by appending; books check via `receiptOfV2`; table rebuild for nullable invoice; pre-connection test for refunds and disputes; idempotent ship-time signing; Connect event list; credit-balance invoices; Turnstile in mockup. From Grok: school id is the org id, `event.account` only routes; both `pi_` and `ch_` index rows; empty `invoice_payments` retries; customer-balance portions; rebuild runs after `env` exists |
| 6 | **9/10** | 8/10 | Customer balance is a `money.skipped` marker, not income (owner can opt in); retry only while a payment is open; revocation overwrite path; unknown account 503 during OAuth; `latest_charge` for the `ch_` row; CORS on `/public/v1`; seal chain accepts revoked links by hash; "signing" state; rate-card limits; API extras budgeted; pre-connection golden tests |
| 7 | **9/10** | **9/10** | Marker uses `kind: invoice` with new `reason: customer_balance`, its own builder and idem; non-USD readers check `reason`; consumed credit as a non-negative amount; `charge` invoice payments; list-lag retry; seal-chain rule in both verifiers |

Line references in this plan are as of 2026-11-08; re-pin them when each milestone starts.

Target: 9/10 from both reviewers on the plan, then on each milestone as it ships.
