# D12: tfd becomes buzz-school's only credit grant engine

Owner decision D12 (2026-11-08): replace buzz-school's credit grant engine with tfd's, in stages. This plan says which stages, in which order, and what each one needs in each repo. Owner questions with recommended answers are in [`decisions.md`](decisions.md).

Sources: the D12 research findings of 2026-11-08 (three read-only reports), re-checked in code against tfd `origin/dev` 85425e62a and buzz-school `origin/main` c63438752. "bs:" means a path under buzz-school's `packages/family-service/`. tfd code still lives in `packages/atm` and keeps its frozen `atm` names (`AGENTS.md`).

## Summary

**Problem.** buzz-school writes credit lots in its own SQL (bs `src/school-billing/grant.ts:61`, `grantLot`) and only runs tfd for the balance arithmetic. tfd never sees a member's subject being created, so a member's credit log cannot replay ("no subject yet"), and the ledger views job writes nothing for a school whose log holds credit events. Credits are therefore missing from the ledger, and the ledger UI shows its credit screens as "not available". Two engines also decide the same grants under different rules.

**Goal.** One engine decides every credit: tfd's Stripe handler. Credits then sit in the ledger with the money, and the ledger is the one source of truth for both.

**Recommended stage order.** This differs from the first proposal (compare, decide, migrate, cut over, retire) in three ways:

- Compare-only needs a `clover` endpoint and an imported shadow first, so part of "migrate" moves before "compare".
- Cutover comes before booking spending ships, while rollback is still cheap.
- Credit events reach the ledger only after the opening-events blocker is fixed.

| # | Stage | Size | Member-visible? | Reversible? |
|---|---|---|---|---|
| 0 | Rulings and facts: owner decisions, production counts, a Stripe test-mode proof of event ids | S | no | yes |
| 1 | tfd prerequisites, released as `tfd-v0.11.0` | L | no | yes |
| 2 | buzz-school foundations, dark: pin, migration, route split, import dry run | L | no | yes (additive) |
| 3 | Compare-only, per school: `clover` endpoint, imported shadow, nightly diff | M per school | no | fully |
| 4 | Cutover, per school: `grant_engine = tfd`, before booking spending ships | M per school | **yes** | fully until the first tfd grant, then partly |
| 5 | Credit events to the ledger: ship the outbox, the views build | M | ledger UI only | yes (stop shipping) |
| 6 | Retire the lot engine | M | no | by redeploy only |

**What changes for members** (details in §9): a rollover cap the school already set starts to apply (one cycle grandfathered), upgrades grant at once instead of at renewal, credits from an unpaid cycle stop at cycle end as today, and the expiry hour can move up to an hour across DST. Balances on the day of cutover do not change.

**Owner decisions needed first** (§12, [`decisions.md`](decisions.md)): seven rule differences, the production state, E2/D-3 for credit events, acacia vs clover, and when to announce.

---

## 1. Goal and why

- **One engine.** Today a paid invoice is decided by bs's `grantForInvoice` (`grant.ts:158`), and tfd only applies the result. After D12, tfd's `handleStripeWebhook` decides it. bs keeps memberships, checkout, the portal, the admin UI and Stripe connect.
- **Credits in the ledger.** tfd writes `plan.attached`, `credit.granted` and the rest beside the money events it already writes, so a member's credit log replays from its first event, and the views job builds every school.
- **What members see.** The same balances on the day of cutover. After it, tfd's rules apply where they differ from bs's (§9). Each school's admins hear before their school moves.
- **What it is not.** It does not ship booking spending (holds and spending stay "Not built"). It does not change prices, checkout or the portal's tier and menu-version reads.

## 2. Stages

Tags: 💰 money path, 🗄 migration, 👪 member-visible. Sizes: S (a day or less), M (a few days), L (a week or more). "T" items are tfd work, "B" items buzz-school work, "O" items are ops or owner actions.

### Stage 0: rulings and facts

**Goal.** Settle what the engines should do and how big production is, before code is written.

| Item | Repo | Size | Tags |
|---|---|---|---|
| O1 Owner rules on decisions 1-12 ([`decisions.md`](decisions.md)) | — | S | 👪 |
| O2 Owner-approved read-only query: per school, `school_billing` rows, memberships by status, lots by `source` (`tier`, `addon:*`, `adjust:*`), lots from `subscription_update` invoices, admin-invoice lots | bs (ops) | S | |
| O3 Stripe test mode, one test account: two endpoints at two versions on one account, one event, compare the `evt_` ids both receive | — | S | |

- **Entry:** this plan is merged.
- **Exit:** every decision in [`decisions.md`](decisions.md) has an answer; O2's counts are recorded in the owner's ops notes (not in this repo); O3 says whether ids match.
- **Rollback:** none needed.
- **Risks:** O3 shows different ids at the two endpoints. (Retired: O3 showed matching ids in test mode, §4.) Then claim seeding (§6) cannot dedupe across endpoints, and cutover relies on `state.invoices` alone, which does not cover events that left no record (§7, race window).

### Stage 1: tfd prerequisites, `tfd-v0.11.0`

**Goal.** tfd can import every bs member with opening events, decide per member, adjust like bs's admins, and be compared. The full dependency order is in §3.

| Item | Repo | Size | Tags |
|---|---|---|---|
| T1 Fix the replace recipe in `UPGRADING.md` | tfd | S | |
| T2 Importer: accept `adjust:*`, prorated raise, dropped add-on and partly removed lots; store the menu version | tfd | M | 🗄 💰 |
| T3 Opening events at import | tfd | M | 🗄 |
| T4 `adjustCredits` command | tfd | M | 💰 👪 |
| T5 Per-member menu version in the handler | tfd | M | 💰 |
| T6 Claim and index seeding helper | tfd | S | 🗄 |
| T7 Shadow recipe and `diffBalances` helper | tfd | S | |
| T8 Rule policies the owner picks, behind a policy version (rollover expiry in the menu's zone at least) | tfd | M | 👪 |
| T9 Golden bundles for each rule decision, plus import then renewal | tfd | M | |
| T10 Rename step 3 compatibility items | tfd | S | |
| T11 Release `tfd-v0.11.0` | tfd | S | |

- **Entry:** stage 0 decisions 1-7 answered (they set T8 and T9).
- **Exit:** `just` gates green; each new golden bundle passes; an import property test (§11) passes over 10,000 generated members; the release tarball installs under the `atm` key in a scratch Bun project and `import … from "atm"` resolves.
- **Rollback:** do not pin it. Nothing in bs changes.
- **Risks:** T3 needs a new payload type (`credit.imported`) if `credit.granted` can't express an opening balance, and that changes the event schema (schema `$id`s are frozen, so add a v1 file, don't edit one). T5 touches the handler's hot path, which every caller shares.

### Stage 2: buzz-school foundations, dark

**Goal.** Everything for compare and cutover exists in bs, switched off, with a dry-run import passing on a copy of production data.

| Item | Repo | Size | Tags |
|---|---|---|---|
| B1 Pin `tfd-v0.11.0`; the dependency key stays `atm` | bs | S | |
| B2 `identityOf` env from `billingKeyMode`, not the hard-coded `"live"` (`subject.ts:20`) | bs | S | 💰 |
| B3 Migration (forward-only, additive, Litestream-portable): `HANDLER_DDL` tables (empty), `school_billing.grant_engine`, `school_billing.webhook_secret_clover_enc`, `school_billing.clover_endpoint_id`, `shadow_diffs`, `shadow_errors` | bs | M | 🗄 |
| B4 Handler `SqlDatabase` on bun:sqlite, reusing `ledger-export/sql.ts`, with a write-lock transaction | bs | S | |
| B5 Webhook context builder: the member's menu version, policy, catalog, price ids, `prefetchFee`, zone, env | bs | M | 💰 |
| B6 Route split on `/hooks/stripe/school`: `&v=clover` verifies with the second secret; dispatch by `grant_engine`; split `handleSchoolEvent` into its credit part and its non-credit part (membership upsert, checkout pending, admin-invoice record) | bs | M | 💰 |
| B7 Pin `Stripe-Version` on checkout and every request that creates a subscription | bs | S | 💰 |
| B8 Endpoint ops command: dry run by default; create the clover endpoint with the 10 events; seal its secret; delete the old one; audited; `--yes-prod` | bs | M | 💰 |
| B9 Import command: per member, dry run by default, refusal report, sum check, into the shadow file or the main database | bs | L | 🗄 💰 👪 |
| B10 Kill switch: a global flag `tfd_grants` in `flags/registry.ts` (`safeguarding: false`) | bs | S | |
| B11 Erasure, teen link, cleanup, data map: purge the tfd rows and the shadow's (§10) | bs | S | |

- **Entry:** `tfd-v0.11.0` released.
- **Exit:** bs gates green with `grant_engine = 'lots'` everywhere, and member behavior unchanged; `schema-portable.test.ts` covers the new SQL, `HANDLER_DDL` included; B9's dry run on a copy of production data refuses zero members, or every refusal has a resolution from §6; an older image still starts on the migrated database (staging proof).
- **Rollback:** redeploy the previous image. The migration only adds, so it stays.
- **Risks:** B3's `ledger_outbox` already exists (bs migration 0138); `HANDLER_DDL` creates it `IF NOT EXISTS` with the same columns today (checked), so a later tfd change to its shape would be silently skipped. B6 is the riskiest change here: it moves non-credit side effects behind a dispatcher.

### Stage 3: compare-only, per school

**Goal.** tfd decides every live event of a school beside the lot engine, in a separate database, and the nightly diff shows only excused differences. Design in §5.

| Item | Repo | Size | Tags |
|---|---|---|---|
| B12 Shadow runner on the clover branch: `handleStripeWebhook` on `shadow.sqlite`, no shipping, no Stripe reads | bs | M | |
| B13 Nightly diff job (`scheduleJob`) writing `shadow_diffs`, alerting on unexcused rows | bs | S | |
| O4 Per school: announce file, create the clover endpoint (B8), import into the shadow (B9), set `grant_engine = 'shadow'` | ops | S | 💰 |

- **Entry:** stage 2 exited; the school's import passes its dry run; announce file for the endpoint change.
- **Exit:** 14 consecutive nightly diffs with only excused rows (the period must include one renewal of every member, so 31 nights for a school with monthly members whose renewals fall late in the month); zero unexplained rows in `shadow_errors`; Stripe shows the clover endpoint healthy.
- **Rollback:** delete the clover endpoint, set `grant_engine = 'lots'`, delete `shadow.sqlite`. Nothing else changed.
- **Risks:** a failing shadow endpoint makes Stripe email the school and then disable it (§4). Doubled webhook work on one machine (the volume is small). The shadow never sees admin adjustments, so their lots are excused.

### Stage 4: cutover, per school

**Goal.** tfd is the school's only grant engine. Readers, admin adjust and admin invoices go through tfd. Do it for every school before booking spending ships.

| Item | Repo | Size | Tags |
|---|---|---|---|
| B14 Readers through tfd for `tfd` schools: `/family/memberships`, ledger `members-list` (with the new `granted` bar, §9), refund ownership | bs | M | 👪 |
| B15 Admin adjust through tfd's `adjustCredits` | bs | M | 💰 👪 |
| B16 Admin-invoice grant through tfd (§13, open question 4) | bs | M | 💰 👪 |
| B17 Lapse job calling tfd's `recordLapse` for memberships past their cycle end | bs | M | 👪 |
| B18 Money events: `book` off for `tfd` schools; the handler writes money to the same `ledger_outbox` | bs | S | 💰 |
| B19 Cutover command: the single transaction in §7 | bs | M | 💰 🗄 |
| B20 Rollback command: back to lots, with tfd-only grants as lots (§8) | bs | M | 💰 |
| B21 Port the ~150 lot-model tests (§11) | bs | L | |
| O5 Per school: tell admins, then run B19, watch, delete the acacia endpoint after 3 days | ops | S | 👪 💰 |

- **Entry:** stage 3 exited for this school; B14-B21 shipped; B20 rehearsed in staging; the announce file for the switch; admins told (decision 11).
- **Exit:** two renewal cycles where each member's tfd balance equals the frozen lots plus the tfd events since the flip; zero `shadow_errors`-class failures on the live branch; the acacia endpoint deleted.
- **Rollback:** before the first tfd grant, flip back (the acacia endpoint's 400s mean Stripe still holds those events). After it, B20 (§8).
- **Risks:** an admin adjust during the flip (§7); an event in flight at the flip; a member-visible rule change surprising a school.

### Stage 5: credit events to the ledger

**Goal.** A school's credit events ship with its money events and the views build.

| Item | Repo | Size | Tags |
|---|---|---|---|
| T12 S8f: a new stage in `packages/ledger-worker/scripts/staging-e2e.ts` that proves the views build for a school whose log holds credit events | tfd | S | |
| T13 Ledger UI: credit screens on for schools with credit events | tfd | S | 👪 |
| B22 Shipping per E2/D-3: staging at once; production when D-3 allows family-keyed credit events | bs | S | |

- **Entry:** stage 4 done for the school; T3 in the release (opening events written at cutover); for production, E2/D-3 decided (decision 9).
- **Exit:** S8f green in staging; for each school, a replay of its log from the first event equals the handler's balances.
- **Rollback:** stop shipping. Unshipped rows wait in `ledger_outbox`.
- **Risks:** a replay that fails on an opening event in production, which the S8f stage exists to catch.

### Stage 6: retire the lot engine

**Goal.** One code path.

| Item | Repo | Size | Tags |
|---|---|---|---|
| B23 Remove `grantForInvoice`, `grantForAdminInvoice`, `removeForInvoice`, `raiseLots`, `balancesFrom`, `grantedFrom`, the acacia branch, and the shadow code | bs | M | |
| B24 Keep `school_credit_lots` read-only; drop it in a later forward-only migration, at least two releases after the last cutover | bs | S | 🗄 |

- **Entry:** every school on `tfd` for two cycles; no acacia endpoint left.
- **Exit:** no code writes `school_credit_lots`; tests green.
- **Rollback:** redeploy. Not possible after B24's drop, which is why B24 waits.
- **Risks:** a reader of lots someone missed (the inventory lists every reader today: `routes/school-billing.ts`, `routes/ledger-admin.ts`, `deletion.ts`, `cleanup.ts`, `teen-link.ts`, `ledger-export/*`).

## 3. tfd prerequisites in dependency order, and `tfd-v0.11.0`

| Order | Item | Needs | Why |
|---|---|---|---|
| 1 | T1 Fix the replace recipe (`UPGRADING.md:169-179`, `:341-355`; README `:375-411`) | — | It says bs is on `atm-v0.3.0` (it is on `atm-v0.10.0`), ignores bs's existing `ledger_outbox` and shipper, and lacks the two-endpoint method. |
| 2 | T5 Per-member menu version | — | `deps.context(school)` is called once per event with one menu (`src/handler/stripe-webhook.ts:829`), `WebhookContext` holds one menu (`src/types.ts:2908`), and `GrantsState` stores no menu version. bs members keep the version they bought. Change: context per subject, `GrantsState.menuVersion`. |
| 3 | T2 Importer gaps | T5 (stores the version) | §6 refusal classes. |
| 4 | T3 Opening events | T2 | Without them an imported member's log can't replay. |
| 5 | T4 `adjustCredits` | T2 (the `ce_adjust_*` row shape) | bs's positive adjustment is a new lot with no expiry. tfd has no command for it, and `recordEngineCommand` refuses `applyBillingPlan` (`src/ledger/outbox.ts:59`). Template: `redeemSessionGiftCode` (`src/billing/codes.ts:141`). Negative: soonest expiry first, never below zero, `credit.adjusted` with `reason`. |
| 6 | T6 Seeding helper | T2 | Seed `atm_event_claims` from finished bs event ids; backfill `atm_invoice_index` and `atm_payment_index` for every invoice before the import, or a refund of an old invoice waits forever (409 `unmatched_invoice`). |
| 7 | T7 Shadow recipe and `diffBalances` | T2 | `atm_rows` → `stateFromRows` → `balancesOf`, compared with caller sums; excused reasons as data. |
| 8 | T8 Rule policies | owner decisions 1-7 | `rolloverExpiry` uses `addUtcMonths` (`src/billing/grants.ts:443`); `addZonedMonths` exists (`:417`). Behind a policy version so old logs replay unchanged. |
| 9 | T9 Golden bundles | T2-T8 | §11. |
| 10 | T10 Rename step 3 items | — | `TFD_*` env read first with `ATM_*` fallback; `Atm*` type aliases; announce the `atm:` log prefix change. |
| 11 | T11 Release | all | |

**`tfd-v0.11.0` contents:** T1-T10. It is the first `tfd-v*` release, published with `release.ts` to `justbry/atm` as `tfd-v0.11.0/tfd-0.11.0.tgz`. B1 moves bs's pin to it under the unchanged key `atm`, which completes the first open item of rename step 3 (`plans/tfd-rename.md`). If T8 waits on an owner answer, ship it in `tfd-v0.11.1`; stage 3 can run without it (zone differences are excused), stage 4 cannot.

## 4. Stripe migration: acacia to clover

tfd reads only `2025-10-29.clover`: all 13 mapping files pin it, and `mappingFor` refuses any other version (`unknown_mapping`, `src/billing/normalize.ts:358-372`). bs creates its endpoints at `2025-02-24.acacia` (`MONEY_STRIPE_VERSION`, bs `src/school-billing/money.ts:44`; `connect.ts:67`) with 6 events. **Recommendation: bs moves to clover** (decision 10). Supporting acacia in tfd would be M-L and doubles the mapping tests.

### Field changes (all from basil, 2025-03-31; clover keeps them)

| Acacia | Clover | bs today |
|---|---|---|
| `invoice.lines[].price` | `lines[].pricing.price_details.price` | reads both |
| `invoice.subscription`, `line.proration` | `invoice.parent.subscription_details.subscription`, `line.parent.subscription_item_details.proration` | reads both |
| `charge.invoice`, `invoice.charge`, `invoice.payment_intent` | removed; the link is an InvoicePayment (`invoice_payment.paid`) | falls back to a charge read at acacia |
| `subscription.current_period_start/end` | on `subscription.items.data[]` | reads both |
| default billing mode for a new subscription | `flexible`, chosen by the **request's** version | checkout sends no `Stripe-Version`, so the account default decides |

### Events

The clover endpoint needs the 10 types tfd's handler takes (`HANDLED_TYPES`, `stripe-webhook.ts:190-201`): today's 6 plus `invoice_payment.paid`, `charge.dispute.created`, `payout.paid`, `payout.failed`. (The findings say 9; `payout.failed` is handled too.) Payout events need the restricted key's payout permission (§13).

### The two-endpoint method

An endpoint's version can't be updated, so it is recreated. Stripe's documented method:

1. Create a second endpoint at clover on the school's account, URL `…/hooks/stripe/school?school=<id>&v=clover`.
2. Both stay enabled. Stripe sends each event to each endpoint, shaped per its version.
3. **The endpoint you are not using answers 400.** Stripe keeps retrying it (up to 3 days), so if you revert, its events are still there to process.
4. Once the new one has run cleanly, delete the old one.

In stage 3 the clover endpoint is the shadow: it answers 200 (or tfd's 409 waits) and the acacia endpoint stays live. At cutover the roles swap: clover is live, acacia answers 400 for 3 days, then B8 deletes it.

### Dedup across the two endpoints

**Both endpoints receive the same `evt_` id for one event** (O3, verified 2026-11-08 in test mode). Only the payload shape and `api_version` differ. So a claim keyed by `evt_` id dedupes across the two endpoints, and claim seeding (§6, §7) works as planned.

How it was found: one test account, two temporary endpoints created with a restricted key (one at `2025-02-24.acacia`, one at `2025-10-29.clover`), both pointed at a throwaway echo Worker that logged only `{id, type, api_version}`. A 100-cent refund (`re_3UYWsUDsfMqSNUOE1gkNozcg`) produced three events. Each reached both endpoints within a second, with the same id:

| Event type | `evt_` id at both endpoints | `api_version` delivered |
|---|---|---|
| `refund.created` | `evt_3UYWsUDsfMqSNUOE1oGMzRBo` | acacia: `2025-02-24.acacia`; clover: `2025-10-29.clover` |
| `charge.refunded` | `evt_3UYWsUDsfMqSNUOE1KTbKSKh` | acacia: `2025-02-24.acacia`; clover: `2025-10-29.clover` |
| `charge.refund.updated` | `evt_3UYWsUDsfMqSNUOE1Nnz0m9Q` | acacia: `2025-02-24.acacia`; clover: `2025-10-29.clover` |

The endpoints and the Worker were deleted afterwards. The staging rehearsal (§13, row 1) still checks this on a school's real endpoints.

### Second secret and route split

The route reads one `webhook_secret_enc` per school (bs `routes/school-billing.ts:353-354`). B3 adds `webhook_secret_clover_enc` and `clover_endpoint_id`; B6 picks the secret by `v`. The two branches keep separate claim tables: acacia `school_stripe_events`, clover `atm_event_claims`.

### Pin `Stripe-Version` on checkout

B7 pins `Stripe-Version` on Checkout Session creation and every subscription-creating request to the version bs tests against today (acacia). Then a change of the account's default, or a move to clover, can't silently make new subscriptions `flexible`. Moving request versions to clover is a separate, later change.

### Per-school ops rules

- An endpoint is created and deleted on the **school's own Stripe account** with its restricted key (Webhook Endpoints: write). That is a production action: prod-ops lock, plus an announce file in `docs/verification/production/` naming the school, before create and before delete.
- B8 runs dry by default, prints what it will do, and needs `--yes-prod`. It is audited.
- One school at a time.

### Risk: Stripe emails the school

When an endpoint keeps failing, Stripe emails the **account owner, who is the school**, and may then disable the endpoint. Two places this can happen:

- The shadow endpoint in stage 3, if tfd refuses events. B12 answers 200 for everything except tfd's 409 waits, and `shadow_errors` alerts us first.
- The acacia endpoint's 400s after cutover. B8 deletes it after 3 days, and the school's admins are told beforehand that a Stripe warning may arrive (decision 11).

## 5. Compare-only design

- **Separate database.** `shadow.sqlite` beside the main database, created with `HANDLER_DDL`, never replicated, never shipped. It can be rebuilt any time by re-importing. Separate file, so separate write lock: the shadow never blocks member writes.
- **Isolation:**
  - *Members:* no reader opens the shadow. Readers stay on lots while `grant_engine` is `shadow`.
  - *Outbox:* the shadow's own `ledger_outbox` table is never passed to `shipOutbox`. bs's phase-1 money events keep going to the main database's `ledger_outbox` from the acacia branch (`atomically`/`book`, bs `webhook.ts:17-24`); the shadow never gets that sink.
  - *Stripe answers:* the acacia endpoint's answer never depends on the shadow; they are separate requests. The shadow's answer is 200 unless tfd says wait (409), so Stripe retries it.
  - *Stripe reads:* `prefetchFee` off in the shadow (fees are money, which the shadow doesn't compare).
- **Context:** B5's builder, which resolves the menu per membership (needs T5).
- **Main-database tables** (B3, forward-only):
  - `shadow_diffs(run_at, school_id, membership_id, feature_id, lots_balance, tfd_balance, delta, excused_reason)`: one row per difference per night.
  - `shadow_errors(at, school_id, event_id, type, kind, detail)`: every refusal or throw, with no personal data (ids and kinds only).
- **Nightly diff (B13, `scheduleJob`):** per membership per feature, at one `now`: the sum of `balance` over unremoved lots with `expires_at` null or later than `now`, against tfd's `balancesOf` from the shadow. Sums, not rows. A difference is excused when it matches one of these:

| Excused reason | Matches when |
|---|---|
| `rollover_cap` | tfd is lower by at most what the cap removed at a renewal since import |
| `upgrade_grant` | tfd is higher after a mid-cycle tier change or quantity raise |
| `expiry_dst` | a lot expires within 1 hour of tfd's expiry, across a DST change |
| `unrenewed_cycle` | the cycle ended unpaid: lots read 0, tfd still holds it until the lapse job |
| `gift_expiry` | a one-time lot's expiry differs by tfd's `giftSessionMonths` rule |
| `admin_adjust` | an `adjust:*` lot newer than the import (the shadow never sees admin adjustments) |

  Anything else alerts. Each excused reason has to be one the owner accepted (decisions 1-7); a reason the owner rejects becomes a T8 policy and is no longer excused.

## 6. Import

Per membership, inside one transaction per school:

1. Build `CallerRowsInput` from the membership, its lots and **the menu of its own `menu_version`**. (The importer takes the menu it is given, and the row type has `menu_version`; the gap is that tfd stores no version afterwards, which T5 fixes.)
2. `grantsStateFromCallerRows` → rows and state, at one revision. Env from `billingKeyMode` (B2).
3. **Opening events (T3)** in the same transaction: `plan.attached` and one opening `credit.granted` per credit row (or a new `credit.imported`), idem derived from membership, row and import id, so a retry writes nothing twice.
4. **Seed (T6):** `atm_invoice_index` and `atm_payment_index` for every invoice the member paid before the import; `atm_event_claims` from `school_stripe_events` rows that are `done` (not the `admin:*` ids, which stay bs's).
5. **Verify sums:** per member per feature, tfd's `balancesOf` at `now` equals bs's `balancesFrom` at the same `now`. Any difference aborts the school's transaction. Both are pure, so the dry run is the real computation without the write.
6. **Re-runnable:** the import replaces the subject's rows. Into the shadow, run it as often as needed. Into the main database, run it once, at cutover; a failed transaction leaves nothing behind.

### Refusal classes

The importer throws with every problem named (`packages/atm/src/billing/adopt.ts`). Each class and its resolution:

| Class (where in `adopt.ts`) | Cause in bs | Resolution |
|---|---|---|
| Unknown source, e.g. `adjust:goodwill` (`:197-201`) | any admin adjustment | T2: import as `ce_adjust_*` rows with the lot's expiry (null), the row `adjustCredits` writes |
| Lots taken back for some invoices only (`:337-341`) | a refund of one invoice in a row with several | T2: accept it; record the removed invoice as taken back in `state.invoices`; the balance is the lots' |
| A dropped add-on's lots (`:228-232`) | the add-on was removed while its lots still hold credits | T2: import as a retired row (`state.retired`), keeping the lots' expiry |
| Newest tier lot not a whole number of units (`:313-321`) | a prorated quantity raise (`raiseLots`, bs `grant.ts:112`) | T2: recognise raise lots (source `tier`, same cycle end as the cycle's lot, `subscription_update` invoice) and fold them into the cycle's row; quantity from `membership.quantity` |
| Feature, tier or add-on not on the menu; lot expiry vs menu disagree; rows on different cycles; tier grant with no lot | wrong menu version passed, or edited data | Pass the member's own version (step 1). What remains is a per-member ops fix, listed by the dry run |

**Correction to the findings:** a prorated raise lot is **not always refused**. `raiseLots` grants `ceil(perUnit × diff × left / span)`, and when that happens to be a whole number of units, the importer accepts it and sets the member's quantity from it. Example: 10 credits per unit, raised 1 → 3 units with half the cycle left gives 10, read as quantity 1 when the member has 3. Sums still match on import day, but the next renewal grants a third of what it should. T2 must recognise raise lots, not rely on the refusal, and the property test (§11) must generate raises.

### The opening-events requirement

Import writes rows and no event today. A log that starts after an import can't replay the imported balances (`no subject yet`), the same failure D12 sets out to fix. No opening or import payload exists (`packages/atm/schema/payload/` has `credit.granted` and `plan.attached`, but nothing marks an opening). So T3 is a hard blocker for stage 5, and the import at cutover must write opening events, or stage 5 needs a re-import that rewrites history. Whether a money-only log followed by opening credit events replays is unverified (§13).

## 7. Per-school cutover

**Switch.** `school_billing.grant_engine TEXT NOT NULL DEFAULT 'lots' CHECK (grant_engine IN ('lots', 'shadow', 'tfd'))`, set only by an audited ops command (B19, B20). Flags are global only (`flags/registry.ts` has no scope; per-school flags are deferred in the flags spec), hence a column.

**Kill switch.** The global flag `tfd_grants` (B10). Off means *pause*, not rollback: the clover branch answers 503 for `tfd` schools (Stripe retries for up to 3 days) and does nothing for `shadow` schools. It stops a bad release in seconds while ops decides between a fix and B20.

**Flip order** (B19), for one school:

1. Preconditions: the clover endpoint exists and is healthy; stage 3 exited; announce file; admins told; no row in `school_stripe_events` with state `processing` (wait or take over after 300 s).
2. Block admin adjust and admin invoices for the school (`409 cutover_in_progress`, at most a minute).
3. One write transaction:
   1. `grant_engine = 'tfd'`.
   2. Re-import from the lots. The lots are the truth; the shadow is discarded.
   3. Write the opening events (T3).
   4. Seed claims and indexes (T6).
   5. Verify sums; on a mismatch the transaction rolls back and the school stays on `lots`.
4. From commit: the acacia branch answers 400 and never grants; the clover branch runs tfd on the main database. The lots are frozen: no code writes them for a `tfd` school.
5. Unblock admin adjust (now through `adjustCredits`, B15) and admin invoices (B16).
6. After 3 days of clean running, delete the acacia endpoint (B8).

**Race window.** Between the last acacia delivery and the commit, an event can reach both endpoints. It is safe when:
- it was granted by bs: its invoice is in `state.invoices` after the re-import, so tfd decides nothing again;
- it left no lot (a proration, a subscription update): its acacia claim is seeded into `atm_event_claims`, provided the ids match (stage 0, O3);
- it arrived at acacia after the commit: 400, then tfd handles the clover copy.

If O3 shows the ids differ, add a step: before the flip, pause the clover endpoint's processing (503) and let acacia drain; then flip, and let Stripe retry clover.

**Admin adjust during the flip.** Step 2 blocks it. An adjust that started before the block finishes on lots first, because it takes the same write lock, and is imported with them.

**Money-event dedupe.** For a `tfd` school, bs's `book` is off (B18) and the handler writes money events into the same `ledger_outbox`. An event both wrote resolves by `ON CONFLICT (school_id, env, idem) DO NOTHING`, but only when the idem matches. `payment.refunded`'s idem differs between the two writers (it names the payment intent), so a refund in flight at the flip could be booked twice. The drain in step 1 and the claim seeding remove that case; the stage 4 exit check compares money sums too.

## 8. Rollback table

| Stage | Rollback | Complete? | Gap |
|---|---|---|---|
| 0 | none | — | — |
| 1 | don't pin | yes | — |
| 2 | redeploy the previous image | yes | the migration stays (additive); prove an old image runs on it |
| 3 | delete the clover endpoint, `grant_engine = 'lots'`, delete `shadow.sqlite` | yes | — |
| 4, before the first tfd grant | `grant_engine = 'lots'`; the acacia endpoint's held events retry and grant | yes | none, if inside Stripe's 3-day retry window |
| 4, after tfd grants | B20: `grant_engine = 'lots'`; write each tfd-only change since the flip as a lot | partly | **No reverse import exists.** With no spending, a balance changes only by grants, takebacks, admin adjusts and expiry, so the delta can be written as lots (`adjust:rollback`, with the tfd row's expiry). The school's credit events since the flip are still unshipped (stage 5 comes later), so B20 deletes them from `ledger_outbox`; money events stay. Rehearse in staging before the first production cutover. |
| 5 | stop shipping | yes | shipped events stay shipped; the ledger is append-only |
| 6 | redeploy | until B24 | after B24 drops the lots table, none |

The B20 gap is why cutover must come before booking spending: once members spend, a balance change is no longer just a grant, and writing it back as lots is no longer enough.

## 9. Member-visible changes and the announcement plan

| Change | Today (bs) | After (tfd) | Who notices | Plan |
|---|---|---|---|---|
| Rollover cap | `rollover.max` stored but not enforced (bs `menu.ts`) | leftover above `max` is lost at renewal | members with large balances at schools that set a max | imported rows are uncapped: the first renewal after cutover is grandfathered; the cap applies from the second. Tell admins before cutover; they may raise or remove the max |
| Mid-cycle upgrade | credits at the next renewal | credits at once | upgraders, who gain | release note |
| Expiry zone | `addMonthsInZone` in the school's zone (bs `time.ts:15`) | `addUtcMonths` (T8 moves it to the menu's zone) | up to 1 hour, across DST | not announced; T8 removes it |
| Lapse | an expired lot reads 0; nothing is booked | the row stays until the next invoice or cancel; B17's `recordLapse` job books it | nobody, if B17 runs | B17 must ship with stage 4 |
| One-time add-on and gift expiry | expires after the grant's rollover months, or **never** | gifts expire after `policy.giftSessionMonths` (default 6) | buyers of one-time packs | decision 5 |
| Admin adjustments | positive = a lot that never expires | `adjustCredits` row with no expiry (T4) | nobody | — |
| Menu version | the member keeps the version they bought | the same, with T5 | nobody | — |
| `granted` bar (ledger `members-list`) | `grantedFrom`: the sum of the cycle's lots | the credit row's allowance for the current cycle, plus one-time grants dated in the cycle; rollovers and adjustments are not "granted" | admins | say so in the ledger UI's help text |

**Announcement plan.** Per school, before its stage 4: an email to the school's admins at least 14 days ahead (decision 11) naming its cutover date, the rollover cap if it set one, the Stripe warning email they may see, and the new upgrade behavior. A release note when the first school moves. Members of capped schools get a notice before their first post-cutover renewal, which is grandfathered, so they lose nothing they were not told about.

## 10. Ops and safeguarding constraints

- **Prod-ops.** Every production deploy, secret, switch or Stripe endpoint change takes the prod-ops lock and an announce file in `docs/verification/production/` first (bs `.claude/skills/prod-ops/references/operating-rules.md:15-20`). Deploys go only through `deploy-prod.yml`. The owner runs secrets and env. A non-safeguarding switch uses `--yes-prod`, not `--record`. Switch states are never written in docs.
- **Forward-only migrations.** An older image on a newer database is not proven safe (bs `docs/runbooks/production-rollback.md:40`), so every schema step here only adds: columns with defaults, new tables. Stage 2's exit includes proving an older image on the migrated database in staging.
- **Litestream-portable SQL.** B3's SQL, including `HANDLER_DDL` (unchecked today), passes `schema-portable.test.ts`. `shadow.sqlite` is outside Litestream on purpose.
- **One machine.** One family-service machine, so one writer. The shadow is a second file with its own lock; compare mode roughly doubles webhook CPU at small volume.
- **E2/D-3.** The handler writes family-keyed rows to `ledger_outbox` itself, which conflicts with what `ledger_export` off means today. Default (decision 9): written always, shipped only where the export is on; production ships credit events only after D-3 allows it.
- **D4 erasure.** `deletion.ts:236-238` deletes lots and memberships. It must also delete, in the same transaction, the family's tfd rows (`atm_rows`, `atm_grants`, index rows, claims keyed by the family's subject), its unshipped `ledger_outbox` rows, and its rows in `shadow.sqlite`. Whether erasure also writes `subject.erased` waits on D4. `teen-link.ts:114`, `cleanup.ts:194,196` and the data map get the same treatment (B11).
- **`identityOf` env.** It hard-codes `env: "live"` (bs `subject.ts:20`), so staging writes `live` rows. B2 takes it from `billingKeyMode`, before any import, because the import keys rows by env.

## 11. Testing plan

| Test | Where | What it proves |
|---|---|---|
| Golden bundles (T9) | tfd `packages/atm/fixtures/scenarios/` (46 today) | one bundle per rule decision (rollover cap and the grandfathered cycle, immediate upgrade, menu-zone expiry across DST, lapse, gift expiry, per-member menu version, never-expiring adjust); import then renewal; import then refund of a pre-import invoice |
| Import property test | tfd | for generated bs members (tiers, add-ons, raises, partial refunds, adjustments, expired lots, both intervals), import never throws on a valid member, sums equal `balancesFrom`, and one renewal after import equals bs's renewal under the agreed rules |
| Opening-events replay | tfd | a log of opening events replays to the imported balances; a money-only log followed by opening events replays (open question 3) |
| Conformance extension | bs `test/ledger-money-conformance.test.ts` (16 vendored bundles) | the same bundles through lots and through the shadow give equal balances, apart from the excused reasons |
| Port the lot-model tests (B21) | bs: ~150 of 233 tests across 13 files (school-billing 55, school-money 44, ledger-admin-reads 29, …) | each keeps its intent against tfd's balances; tests that pin a rule the owner changed move to the new rule |
| Migration tests | bs | portable SQL, defaults, an old image's queries on the new schema |
| Staging rehearsal | staging, Stripe test mode | on one school: two endpoints at once, **confirm both deliver the same `evt_` ids**; import; 3+ shadow nights including a renewal (test clocks); cutover; one admin adjust and one refund across the flip; kill switch; B20 rollback; re-cutover; delete acacia |
| S8f stage (T12) | tfd `packages/ledger-worker/scripts/staging-e2e.ts` | after cutover with credit events on, the views build for the school and the ledger UI's credit screens show |

## 12. Owner decisions

Details and reasons in [`decisions.md`](decisions.md). Recommended defaults:

1. **Rollover cap:** enforce it, with the first renewal after cutover grandfathered.
2. **Mid-cycle upgrade:** grant at once (tfd's rule).
3. **Expiry zone:** the menu's zone (T8), behind a policy version.
4. **Lapse:** credits stop at cycle end as today, via B17's `recordLapse` job.
5. **One-time add-on and gift expiry:** keep bs's rule (the grant's rollover months, else no expiry) as a policy, not tfd's 6 months.
6. **Per-member menu version:** keep it (T5).
7. **Never-expiring admin adjustments:** keep them (T4).
8. **Production state:** the owner runs O2, a read-only query, and confirms whether `school_billing` is on in production. Sources disagree, so this plan assumes nothing.
9. **E2/D-3 for credit events:** write always, ship in production only after D-3 allows family-keyed credit events.
10. **Acacia vs clover:** bs moves to clover.
11. **Announcement timing:** admins 14 days before their school's cutover; members of capped schools before their first non-grandfathered renewal.
12. **Stage 3 length:** 14 nights of only excused diffs, covering one renewal of every member (up to 31 nights).

## 13. Open questions and unverified items

| # | Question | How to settle | Blocks |
|---|---|---|---|
| 1 | Do both endpoints deliver the same `evt_` id for one event? **Yes in test mode** (O3, 2026-11-08): two endpoints at acacia and clover got the same id for each of three refund events, each shaped at its own `api_version` (§4, "Dedup across the two endpoints") | Settled by O3; the staging rehearsal confirms it on a school's real endpoints | nothing now; the race-window plan (§7) can assume matching ids |
| 2 | How does a prorated raise lot import? | Partly settled here: refused unless whole, else silently wrong (§6). T2's fix needs a test with real `raiseLots` output | stage 2 exit |
| 3 | Does a money-only log followed by opening credit events replay? | tfd test (§11) | stage 5, and whether imports before T3 are usable |
| 4 | What replaces the admin-invoice grant (`adminInvoicePaid`, bs `webhook.ts:147`; `invoice.ts:104`)? No tfd handler for it was found. Lead: the admin invoice holds the add-on's published one-time price (`invoice.ts:48`), so tfd's one-time add-on path (`ce_once_*`) may already grant it if the handler can locate the member from the invoice's metadata | a golden bundle with a real admin invoice | B16 |
| 5 | Do schools' restricted keys allow payout reads and balance-transaction reads? Today's key has no payout permission; balance transactions are unverified | the connect flow's permission list; a test-mode key | `payout.*` events, `prefetchFee` |
| 6 | Production member and school counts | O2 | sizing stage 3 and 4 |

## 14. Rough timeline

Sizes, not dates. Tracks run in parallel where the arrows allow.

```
Track A (tfd)     T1 ─ T5 ─ T2 ─ T3 ─ T6 ─ T7 ─ T9 ─ T11 (v0.11.0)          T12, T13
                  T4 (after T2) ─┘   T8 (after decisions) ─┘  T10 (any time)
Track B (bs)                                  B1 ─ B2 ─ B3 ─ B4 ─ B5 ─ B6 ─ B9   B12 B13   B14-B20   B22   B23 B24
                  B7, B10, B11 (any time after B3) ──────────┘
Track C (ops)     O1 O2 O3                                       O4 per school   O5 per school
Track D (tests)                              conformance, property ─ B21 (during stage 3) ─ staging rehearsal
```

| Step | Size | Can overlap with |
|---|---|---|
| Stage 0 | S | Stage 1 start (T1, T5, T10 need no decisions) |
| Stage 1 | L | B7, B10 and B11 drafted against the dev tarball |
| Stage 2 | L | B14-B20 built dark in parallel |
| Stage 3, first school | M + 14-31 nights | B21 test porting; staging rehearsal of stage 4 |
| Stage 4, first school | M | other schools in stage 3 |
| Stage 4, the rest | S each | — |
| Stage 5 | M | Stage 4 of later schools (staging only) |
| Stage 6 | M | after every school has 2 clean cycles |

**The one hard date:** every school finishes stage 4 before booking spending ships. If spending is scheduled first, spending must be built on tfd's `holdBooking` and the rest (they exist, `src/billing/booking-commands.ts`), never on lots.
