# Trifold financial model

Status: draft, 2026-11-06; updated 2026-11-07 for what has since landed on `dev` (demo orgs, `upgradeRate`, MRR in the books), the soft event limit, the review's model assumptions and the owner's plan decisions (Free at about 300 events, Starter as the wedge plan, Witnessed renamed Audited, a flat 20% affiliate rate). Every number in the worked example is an assumption to test, not a forecast. Code references are to `packages/atm` on `dev` as of 2026-11-06 (tfd 0.9.0, before 0.10.0) unless a path says otherwise; line numbers may have moved since. tfd is the engine and CLI (the `atm` command until the rename lands, so a command such as `tfd scenario kpis` runs as `atm scenario kpis` today).

This doc answers four questions:
1. Can tfd's scenario generator model Trifold's own business for 1–3 years today?
2. What blocks it, ranked?
3. How should expenses get into tfd?
4. What is the plan, step by step, and what would a 36-month Trifold run look like?

Companion docs: `business-plan.md` (section 8, the outlook this model should reproduce) and `pricing-strategy.md` (tiers, credits, overage). Unit economics live in section 7 of this doc.

## 1. Short answer

Not yet. The generator's engine is the right one: it runs every invoice, credit grant, spend, rollover, refund, dispute and payout through tfd's real billing rules, reads no clock, and checks its KPIs in three channels (the tfd fold, hledger, DuckDB). But it only knows the menus of five built-in demo orgs, it caps the population far below Trifold's, it has no growth curve, free-to-paid conversion or downgrades (upgrades exist since 2026-11-06), and it has no expenses beyond Stripe and disputes. MRR is now booked on `dev` (`mrr.changed`, not yet released), so gap 7 is mostly closed.

Three changes would make it usable: pass in a menu (section 5, phase 1), add growth and lifecycle knobs (phases 2 and 3), and add an expense event (phase 5). Until then, the outlook belongs in a notebook outside tfd (phase 0).

## 2. Mapping Trifold onto tfd

| Trifold | tfd concept | Where | Fits today? |
|---|---|---|---|
| Trifold itself | The school (`SCHOOL_ID`) | `src/scenario/school.ts:10` | Name only: hard-coded to `sch_before_university` |
| A customer business | A member ("family"), one in-memory subject each | `src/scenario/generate.ts:176-218` | Yes, as a concept |
| Starter, Pro, Audited | Menu tiers with monthly and yearly prices | `fixtures/billing/menu/before-university.json` | No: the generator only uses the demo menu (section 3, gap 1) |
| Free (cloud) | A tier at $0 | `schema/catalog/menu.v1.json` `amount` minimum 50 cents | No: a tier price must be at least 50 cents. Closest today: `freeShare`, a 100%-discounted invoice, drawn across all tiers |
| Audited + Bookkeeper (~$349) | Audited plus a monthly add-on, with the partner's part as a cost | Add-ons; `share.*` postings as the pattern for the partner's part (`src/ledger/postings.ts:255-277`) | Partly: the add-on fits, the passthrough does not exist |
| Credits (1 credit = $0.01, one month rollover) | A credit feature granted monthly with `rollover: { months: 1 }` | `menu.v1.json` `grant` and `rollover` (grant up to 100,000 units, rollover 1–24 months) | The menu can say it. The generator cannot spend it (gap 6) |
| Ledger events per month (the tier limit) | A second credit feature, or a cap outside tfd | — | Not as a limit: tfd has credit balances, not usage caps on a non-credit metric |
| Compliance packs ($15–30 per state program) | Recurring add-ons | `menu.v1.json` up to 6 add-ons | The menu fits. The generator buys at most one add-on per member, at sign-up, and only the first recurring add-on of an interval (`generate.ts:160-162`, `:198-203`) |
| Credit top-ups ($10 for 1,000 credits); Platform's event fee (about $1 per 10,000; other tiers have a soft limit and no overage) | One-time add-ons that grant credits | `menu.v1.json` add-on `every: "once"` | Menu yes, generator only at sign-up |
| Witness API (500 free, then $0.03–0.05 each) | Metered usage | `docs/usage-metering.md`: metered pricing is out of scope | No. Prepaid packs are the closest fit |
| Stripe fees on Trifold's revenue | `feePercent`, `feeFixedCents` → `expenses:billing:stripe-fees` | `src/scenario/params.ts:131-142`, `src/ledger/postings.ts:197-205` | Yes |
| Annual billing (two months free) | `yearlyShare`, `yearlyCount` | `params.ts:72-77`, `:155-160` | Yes for cash. No for MRR (gap 7) |
| 1–3 years | `months` 1–36 | `params.ts:43-48` | Yes: 36 months is exactly 3 years |

What works now, with no change: 36 months; monthly and yearly payments; refunds, partial refunds and disputes with their fees; Stripe fees on every payment; payouts; credit grants, rollover and expiry under the real engine; a constant churn rate; KPI export to `kpis.json` and `kpis.parquet` (`docs/scenarios.md`, "The export"); and three-channel parity on every KPI.

## 3. The gaps, ranked by how much they block a 1–3 year model

"Smallest fix" means the least change that gets a credible number, not the ideal design.

| # | Gap | Why it matters | Evidence | Smallest fix |
|---|---|---|---|---|
| 1 | **The generator is tied to built-in menus.** No menu can be passed in. Since 2026-11-06 it can pick one of five demo orgs (a school, a studio, a church, a SaaS product, a course creator; `src/scenario/orgs.ts`), but the `tierMix` and `tierCounts` keys still come from Before University | Every revenue number would be at a demo org's prices (for the school, Before University's $12, $29, $9 a seat, $59), not Trifold's | When written: `generate.ts:104` copied `BEFORE_UNIVERSITY_MENU` (now `ORGS[scenario.org].menu`); `params.ts:40` builds `TIER_IDS` from it, and `tierMix` and `tierCounts` accept only those keys; usage spends only the `class` feature (`generate.ts:410-425`); expiry runs only the demo features (`generate.ts:538`, `FEATURES` from `school.ts:15`); the CLI has no `--menu` (`src/scenario/cli.ts:58-82`) | `generateScenario(scenario, { menu })`, a `menu` field in the scenario input (or `--menu <file>`), checked by `validateMenu`; derive `TIER_IDS` and the feature list from the menu; put the menu (or its hash) in the fixture hash (`src/scenario/fixture.ts:17-20`). Code, medium |
| 2 | **Population caps and run time.** `members` ≤ 200, `newMembersPerMonth` ≤ 50, so at most 1,950 members in 36 months. The plan has 1,000 paying and 8,000 free by year 3 | Free schools carry cost (hosting, AI credits) and are the conversion pool; they can't be left out of a P&L | `params.ts:55-66`; the count caps of `tierCounts`, `yearlyCount`, `refundCount` are also 200 (`:152`, `:158`, `:164`). Measured on this machine, 36 months, default knobs, `--channels atm`: 24 members 2.7 s, 100 members 31 s, 200 members 159 s. For 100 members, generation took 1.0 s and the tfd KPI fold 0.06 s; 28 s was the write-path round trip (`src/scenario/roundtrip.ts`: outbox, ship, read). Another run shared the machine, so treat these as indicative | Raise the caps (say 20,000 members, 2,000 a month) and add a planning mode that skips the round trip (the round trip proves the write path, which a business forecast doesn't need). Code, small. Fallback: a scale factor applied outside tfd (one simulated member = k schools), which makes small counts lumpy |
| 3 | **Constant growth.** One `newMembersPerMonth` for every month: no ramp, no S-curve, no school-year seasonality | Section 8 grows paying schools 50 → 300 → 1,000. A constant rate that ends at 1,000 in month 36 puts about 360 paying schools at month 12, seven times the plan (worked in section 5) | `params.ts:61-66`; `generate.ts:164-167` | A `joinsByMonth` series knob (up to 36 whole numbers, overriding `newMembersPerMonth`). A new knob kind, `series`, in `PARAMS`. Code, small |
| 4 | **No free-to-paid conversion and no downgrades.** Upgrades now exist: `upgradeRate` moves a monthly member to the next dearer tier, and `seatChangeRate` changes a quantity, each billed on a prorated `subscription_update` (on `dev` since 2026-11-06). Otherwise a member keeps its first tier | The plan's biggest unknown is "how many free schools convert to paid" (`business-plan.md` section 8). Net revenue retention above 110% (phase 3 of the plan) needs expansion | `FamilyPlan` is fixed before the run (`generate.ts:88-100`, `:320-519`). The engine already handles an upgrade (`subscription_update` with a proration line) and a downgrade at renewal (`src/billing/grants.ts:788-800`); `invoicePaid` already accepts `subscription_update` (`src/scenario/stripe-events.ts:68-72`). The generator now sends upgrades, not downgrades | Knobs `freeTier` (members on it get zero invoices), `conversionRate` (monthly chance a free member moves to a paid tier, drawn from `tierMix`), `downgradeRate`. The engine is unchanged. Code, medium |
| 5 | **Constant churn.** One `churnRate` for all months, tiers and ages | Churn is usually higher in the first months and differs by tier; a single rate hides that | `params.ts:90-95`; `generate.ts:362-363` | `churnByTier` weights and, optionally, `firstYearChurnRate`. Code, small |
| 6 | **No credit consumption model.** Usage is "a chance to book a class, per class credit, at most 3 a month", one unit per booking | AI credits and countersigned receipts are Trifold's metered revenue and its largest variable cost. 500–1,500 credits per Rifo close can't be booked one unit at a time | `params.ts:120-125`; `generate.ts:410-425`; the store's `consume` always tracks `value: 1` (`src/scenario/store.ts:265-290`), though the engine's `track` takes any value | `usage: { [featureId]: { meanPerMonth, byTier? } }` and `consume({ value })`. A top-up add-on bought when a balance runs out (`topUpAddon`). Code, medium |
| 7 | **Cash basis only: no ARR or deferred revenue. MRR is now built on `dev` (unreleased):** a `mrr.changed` event in a memo commodity `MRR`, booked from a subscription's recurring lines, with KPIs `mrr`, `new_mrr`, `expansion_mrr`, `contraction_mrr`, `churned_mrr` and `net_new_mrr` in all three channels (`CHANGELOG.md`, Unreleased). What follows is the gap as it was on 2026-11-06; deferred revenue is still open | Investors and pricing decisions read MRR, ARR, expansion and churned MRR. On cash basis a yearly payment is a spike; `paying_members` falls to 0 in months with no yearly renewal | `docs/scenarios.md`, "Dropped, and why"; `ROADMAP.md`, "Revenue is booked when the invoice is paid" (owner decision open); `payment.succeeded`'s payload has no interval (`src/billing/money.ts:198-210`), although the invoice line has one (`generate.ts:344`) | The fix `docs/scenarios.md` proposes: `interval` and `period_end` labels on `payment.succeeded`, from the invoice line. Then MRR is a KPI spec entry (a yearly payment counted as amount / 12 in each month to `period_end`) — but that spread is a new spec operation, not a `sum`. Code in the production write path, plus a payload schema change and every golden. Needs the owner's decision |
| 8 | **No expenses beyond Stripe and disputes.** | Without COGS and opex there is no gross margin, operating income, burn or runway | The only expense accounts are `expenses:billing:stripe-fees`, `:disputes`, `:dispute-fees` and `:b4uni-share` (`src/ledger/postings.ts:197-277`) | Section 4. Code, medium |
| 9 | **Partner passthrough (the bundle).** | The plan counts only Trifold's ~$149 of the ~$349 bundle. Booked as one income line, gross collected overstates revenue by about $200 per bundle | No partner account exists. `share.accrued` is the shape to copy: `expenses:billing:b4uni-share` + / `liabilities:b4uni` − (`postings.ts:255-264`) | Model the bundle as Audited plus a `bookkeeper` add-on; book the partner's part as `expenses:billing:partner-share` against `liabilities:partners:<partner>`; add a `net_revenue` KPI (gross less refunds and partner share). Part of the expense work |
| 10 | **No metered revenue.** Platform's event fee and Witness API receipts are post-paid usage (the other tiers' event limit is soft, with no overage) | Small in years 1–2 (section 8 says "small"); 10–20% on top in year 3 | `docs/usage-metering.md`: metered pricing is out of scope; an invoice line the menu doesn't know refuses the invoice (`ROADMAP.md`, D4) | Model as prepaid packs (one-time add-ons that grant credits), which is what `pricing-strategy.md` already sells through credits. Post-paid metering: outside tfd |
| 11 | **No cohorts.** | Net revenue retention, payback by cohort and conversion curves are cohort views | The KPI spec has `sum`, `count`, `distinct` (with `first`), `ratio`, `combine` (`schema/kpis.v1.json`); nothing groups holders by first-payment month | Outside tfd: DuckDB over the event Parquet, grouping by each holder's first `payment.succeeded`. A spec operation only if this becomes a dashboard |
| 12 | **SaaS KPIs missing.** MRR, ARR, NRR, logo churn, CAC, payback, gross margin, burn, runway | They are the outputs a 1–3 year plan is read by | `kpis/school.v1.json` has money, counts, rates, members, credits and balances only | Most become spec entries once gaps 7 and 8 are closed (table below). One file, `kpis/saas.v1.json`, and a `--kpis <file>` option (`runParity` already takes a `spec`, `src/scenario/parity.ts:73-86`; the CLI always passes the default) |
| 13 | **The Free tier can't be priced at $0, and the menu holds 4 tiers.** | Free, Starter, Pro, Audited and the bundle are five offers | `menu.v1.json`: `amount` minimum 50, `tiers` `maxItems` 4 | Four tiers: free (a nominal price, always invoiced at zero via `freeTier`), starter, pro, audited. The bundle is audited plus the `bookkeeper` add-on. No schema change |
| 14 | **Zero invoices leave no ledger event after the first month.** | Free schools can't be counted from the books month by month | `docs/scenarios.md`, "A renewal that moves nothing leaves no credit event"; `paying_members` counts payments only | Count active free schools from `credit.spent` (distinct holders with no membership payment), or report them from the generator's `stats`. A KPI entry or a stat |

### KPIs a SaaS model needs

| KPI | How | Needs |
|---|---|---|
| Gross margin | `combine`: net revenue less Stripe fees, COGS and partner share, then `ratio` over net revenue | Gap 8 |
| Operating income, burn | `combine` of revenue and every `expenses:` sum | Gap 8 |
| Cash on hand | Cumulative `sum` over `^assets:` with no dimension (as `credits_outstanding` is over credits) | An opening balance: a knob outside tfd, or an equity event later |
| Runway | Cash / burn | Outside tfd until there is an opening balance (a ratio of a cumulative and a monthly KPI is legal in the spec, but the opening cash isn't in the books) |
| CAC | `ratio`: `expenses:opex:marketing` / `new_paying_members` | Gap 8 |
| Payback (months) | CAC / (ARPA × gross margin) | Gaps 7 and 8 |
| MRR, new / expansion / contraction / churned MRR | `mrr.changed` postings in the `MRR` commodity | Built on `dev`, unreleased (gap 7) |
| ARR | MRR × 12 | Derived from `mrr` in the notebook |
| Logo churn | Holders paying last month and not this month | Gap 7 (yearly payers look churned otherwise); `plan.canceled` has no postings, so hledger can't count it (`docs/scenarios.md`, "Channel discrepancies found") |
| Net revenue retention | Cohort revenue now / the same cohort 12 months ago | Gap 11: outside tfd |
| Credits outstanding, breakage | Already in the spec | — |

## 4. Expenses

### Which costs, and what drives them

| Cost line | Driver | Variable or fixed | Account (proposed; matches existing naming) |
|---|---|---|---|
| Stripe fees on Trifold's revenue | Per payment: 2.9% + 30 cents | Variable | `expenses:billing:stripe-fees` (exists) |
| Dispute losses and fees | Per dispute | Variable | `expenses:billing:disputes`, `expenses:billing:dispute-fees` (exist) |
| Partner bookkeeper payouts | Per bundle per month | Variable | `expenses:billing:partner-share`, owed on `liabilities:partners:<partner>` until paid |
| AI tokens | Per credit consumed by Rifo | Variable | `expenses:cogs:ai-tokens` |
| Witness operations (key service, transparency log) | Per countersigned receipt and seal; a fixed floor | Mixed | `expenses:cogs:witness` |
| Hosting (Workers, R2, D1) | Per ledger event; a fixed floor | Mixed, small | `expenses:cogs:hosting` |
| Support | Per paying school, $8–12 a month (section 7) | Variable; counted as COGS | `expenses:cogs:support` |
| Affiliate commissions | 20% of a referred school's subscription for 24 months | Variable | `expenses:opex:affiliate-commissions` (Trifold's own `share.*` ledger, `go-to-market.md` 3.5) |
| Firm wholesale | Practice clients at 30% off, Practice Pro at wholesale | Variable | None: book the lower price as revenue; it lowers ARPU, not CAC |
| People | Salary schedule, at 1.2× salary for taxes and benefits | Fixed | `expenses:opex:payroll` |
| Founder pay | Schedule | Fixed | `expenses:opex:payroll:founder` |
| Contractors | Schedule | Fixed | `expenses:opex:contractors` |
| Legal (license, trademarks, witness terms, partner contracts) | One-off and yearly | Fixed | `expenses:opex:legal` |
| Software and tools | Monthly | Fixed | `expenses:opex:software` |
| Marketing (CPA program, events, ads) | Budget | Fixed | `expenses:opex:marketing` |

Naming: the existing payment-processing costs live under `expenses:billing:`; keep them there. A separate `expenses:cogs:` root lets gross margin be one regex (`^expenses:(cogs|billing):`), and `expenses:opex:` makes operating expenses another. `incomeStatement` already picks up any new `expenses:` account as `otherExpenses` and as a line (`src/ledger/finance.ts:173-174`, `:693-702`, `:720-741`), so the finance views need no change.

The money side: today the cash accounts are `assets:stripe` and `assets:clearing:stripe-payouts`. Real bills are paid from a bank account, which needs a new `assets:bank` (or `assets:bank:<name>`). In a simulation, paying from `assets:clearing:stripe-payouts` is a reasonable stand-in.

### Option A: a layer outside tfd

A marimo notebook (or a DuckDB SQL file) reads `kpis.parquet` from `tfd scenario kpis` and adds COGS and opex from rate tables and a schedule.

- For: no tfd code at all; usable today; fast to change assumptions; fixed costs (payroll, legal) are naturally a schedule, not events.
- Against: the costs never reach the ledger, so hledger and the three-channel parity don't check them; per-credit and per-event costs have to be multiplied from monthly KPI totals, which loses the link to which member caused them; the result can't be a real P&L for a real business.

### Option B: cost drivers inside the scenario generator

The generator already knows every payment, credit spent and bundle. New knobs give a rate per driver, and the generator books the cost as events:
- `aiCostPerCreditMicros`: AI token cost per credit consumed.
- `hostingCostPerThousandEventsCents` and `hostingFixedCents`.
- `witnessCostPerReceiptMicros`.
- `partnerShare: { addon: "bookkeeper", percent: 100 }`: the passthrough.
- `opex: [{ account, monthlyCents, fromMonth, toMonth }]`: a fixed schedule.

Costs below a cent (a credit's tokens, an event's hosting) are summed per month and rounded once, half away from zero, then booked as one event per line per month. Postings are two-place USD, and the usage spike found that rounding per event loses about a quarter of the total (`docs/usage-metering.md`, "Rating").

- For: costs go through the ledger, so hledger, DuckDB and the tfd fold check them like revenue; gross margin, burn and CAC become spec entries; stays pure (rates are knobs, counts are what the run already made, no clock, no I/O).
- Against: needs an event type that can carry an expense (none of today's can, see below); one more set of goldens.

### Option C: an expense event type for real operating expenses

None of today's event types can book an arbitrary expense: `moneyPostings` has a fixed `switch` and throws on anything else (`src/ledger/postings.ts:189-292`), and `share.*` is fixed to `expenses:billing:b4uni-share` and `liabilities:b4uni`. A new type makes tfd's books able to hold a real P&L for any business, Trifold included:

- `expense.paid` (cash basis, like the rest of the books): `expenses:<tail>` + amount, `<paidFrom>` − amount. Payload: `account` (the tail, checked against `^(cogs|opex|billing):[a-z0-9-]+(:[a-z0-9-]+)?$`), `paid_from` (an `assets:` account), `amount` in cents, `vendor` as a category, never a person's name, `driver` label (`credit`, `event`, `payment`, `bundle`, `fixed`), `period` (`YYYY-MM`) for costs booked in arrears.
- Later, if the owner chooses accrual: `expense.accrued` / `expense.settled` against `liabilities:payable:<vendor>`, copying `share.accrued` / `share.settled` exactly.
- The partner passthrough uses the same type with `account: billing:partner-share`, or a `partner.accrued` / `partner.settled` pair if the bundle needs a statement per partner like `share` has (`src/ledger/share-statement.ts`).

Edits needed, the same list the usage spike found for a new type (`docs/usage-metering.md`, "Envelope fit"): the `event_type` enum in `schema/envelope.v1.json`; `AtmEventType` in `src/types.ts:92-129`; a `case` in `moneyPostings`; `schema/payload/expense.paid.v1.json` and `bun schema/build.ts`; the source in `defaultSource` (`postings.ts:294-304`). The KPI channels need nothing: none of them names an event type in code (`src/scenario/channels/*.ts`), they read postings.

How a real expense arrives stays outside the library: a CLI command (`tfd expense add --account opex:legal --amount 150000 --date 2027-02-03 --vendor law-firm`) or the family service writing to the outbox as it writes its own commands. The library only builds the event with `ledgerEvent`, a pure function. A later step could map Stripe's own invoices for Trifold's vendors, but that is not needed for a plan.

### Comparison

| | A: notebook | B: generator drivers | C: expense event |
|---|---|---|---|
| tfd code | none | knobs + generator, needs C's event | event type, schema, CLI |
| Costs checked by three-channel parity | no | yes | yes |
| Real P&L for a real business | no | no (simulation only) | yes |
| Fixed opex | easy | as a schedule knob | as real bills |
| Keeps "pure, no clock, no I/O" | n/a | yes | yes (I/O in the CLI) |
| Time to first number | a day | after C | — |

### Recommendation

Do all three, in this order, because each is small and the later ones reuse the earlier:
1. **A now** (phase 0): the notebook gives the section 8 outlook with costs in a day, with no tfd change, and becomes the check for B later.
2. **C next, minimal** (phase 5a): `expense.paid` only, cash basis. It's the one piece that also serves real businesses, and B needs it.
3. **B on top** (phase 5b): the generator emits `expense.paid` for its drivers; the notebook's cost lines move into the ledger one by one and must match.

Keep in the notebook for good: opening cash, runway, cohorts, NRR, and anything that is a judgment rather than a fact about money moving. Don't build accrual (`expense.accrued`, payables) until the owner decides the cash-basis question (`ROADMAP.md`, "Revenue is booked when the invoice is paid"), because it's the same decision as deferred revenue.

Scope, honestly: this section is a plan. Nothing in it is built.

## 5. The plan

| Phase | What | Files | Rough size |
|---|---|---|---|
| 0 | Notebook model outside tfd: section 8's counts, prices and costs as tables; monthly revenue, COGS, opex, burn, runway | New notebook outside `packages/atm` (for example `docs/business/model.py`, marimo) | 1 day, no tfd code |
| 1 | Pass a menu in. Menu-derived `tierMix` and `tierCounts` keys, features for usage and expiry. A Trifold menu fixture | `src/scenario/generate.ts`, `params.ts`, `profiles.ts`, `fixture.ts`, `cli.ts`, `school.ts`; `fixtures/billing/menu/trifold.json`; tests | ~250 lines + tests; every golden's `fixtureHash` moves if the menu enters the hash |
| 2 | Scale and growth: raise the caps; `joinsByMonth`; a planning mode with no round trip; `churnByTier` | `params.ts`, `generate.ts`, `cli.ts`, `src/scenario/roundtrip.ts` (skip), tests | ~150 lines |
| 3 | Lifecycle and usage: `freeTier`, `conversionRate`, `downgradeRate` (`upgradeRate` exists); credit consumption per feature with `value` > 1; top-ups when a balance runs out | `generate.ts`, `store.ts`, `params.ts`, tests | ~300 lines |
| 4 | Mostly done on `dev` (unreleased) by another route: `mrr.changed` and six MRR KPIs, from subscription facts rather than labels on `payment.succeeded`. Left: logo churn and deferred revenue | `src/billing/mrr.ts`, `schema/payload/mrr.changed.v1.json`, `kpis/` | Deferred revenue still needs the owner's decision |
| 5a | `expense.paid` event type; `tfd expense add` | `schema/envelope.v1.json`, `src/types.ts`, `src/ledger/postings.ts`, `schema/payload/expense.paid.v1.json`, CLI, tests | ~200 lines |
| 5b | Cost drivers in the generator (`aiCostPerCreditMicros`, hosting, witness, `partnerShare`, `opex` schedule) | `params.ts`, `generate.ts`, tests | ~200 lines |
| 6 | `kpis/saas.v1.json` (net revenue, COGS, gross margin, opex, operating income, cash, CAC, active free schools) and `--kpis <file>` | `kpis/saas.v1.json`, `cli.ts`, parity tests | ~150 lines, mostly JSON |

Phases 1–3 are useful on their own (revenue under Trifold's menu); 5–6 add the P&L. Phase 4's MRR part is built on `dev`; logo churn and deferred revenue can wait, and phase 0's notebook can compute them from the plan's counts in the meantime.

### Worked example: a 36-month Trifold run

Every value is an assumption. Knobs marked "new" don't exist yet; the phase that adds them is in brackets.

**Menu** (`fixtures/billing/menu/trifold.json`, phase 1):

| Id | Kind | Price | Grants |
|---|---|---|---|
| `free` | tier | 50 cents nominal, always invoiced at zero (`freeTier`); about 300 events a month, a soft limit outside tfd | 200 `credit` a month, rollover 1 month |
| `starter` | tier | $29 a month, $290 a year (`pricing-strategy.md` section 4) | 1,000 `credit` a month, rollover 1 month |
| `pro` | tier | $79 a month, $790 a year | 5,000 `credit`, rollover 1 month |
| `audited` | tier | $149 a month, $1,490 a year | 8,000 `credit`, rollover 1 month |
| `bookkeeper` | add-on, monthly | $200 (makes the ~$349 bundle with Audited) | none |
| `compliance-pack` | add-on, monthly | $20 (assumption, middle of $15–30); included in `audited` | none |
| `credits-1000` | add-on, once | $10 | 1,000 `credit` |
| `witness-1000` | add-on, once | $30 (Witness API pack for platforms, low end of $0.03–0.05) | 1,000 `credit` |

**Knobs:**

| Knob | Value | Note |
|---|---|---|
| `months`, `start` | 36, `2027-01` | Assumption: phase 1 of the plan starts in January |
| `members` | 10 | The design partners (`go-to-market.md` §0), on `free` with free hosted setup; about half pay after the day-60 price conversation. Related parties (B4 Uni, Vibes of Light) are not counted |
| `joinsByMonth` (new, 2) | 35 a month in year 1, 200 in year 2, 730 in year 3 | Sign-ups land on `free` |
| `paidJoinsByMonth` (new, 2) | 4 a month in year 1, 15 in year 2, 35 in year 3 | Direct paid sign-ups from founder-led sales, firms and referrals |
| `freeTier` (new, 3) | `free` | |
| `conversionRate` (new, 3) | 0.0075 a month (range 0.005–0.01) | Free → paid, drawn from `tierMix`. Free's smaller limit (about 40 families) pushes growing schools to Starter |
| `tierMix` | `starter` 40, `pro` 35, `audited` 25 | Section 8's steady mix, the bundle inside Audited. In year 1 only `starter` is on sale; `pro` comes in year 2 and `audited` late in year 2 (`business-plan.md` §8) |
| `addonRates` (new, 3) | `bookkeeper` 0.2 of Audited (5% of paying); `compliance-pack` 0.6 of Starter in year 1, then 0.3 of non-Audited schools | |
| `upgradeRate` (exists), `downgradeRate` (new, 3) | 0.01, 0.003 a month | |
| `churnRate` | 0.03 a month paid; free schools 0.03 (new, 3) | |
| `yearlyShare` | 0.15 | |
| `usage` (new, 3) | `credit` per month: free 50, starter 300, pro 1,500, audited 1,800 | Pro: a Rifo close (~1,000) plus questions and Pricing Lab. Audited: Pro's use plus ~100 countersigned receipts × 3 and a seal at 25 (`pricing-strategy.md` §5) |
| `refundRate`, `disputeRate` | 0.01, 0.002 | |
| `feePercent`, `feeFixedCents` | 2.9, 30 | Exist today |
| `aiCostPerCreditMicros` (new, 5b) | 3,300 (0.33 cents a credit, under a third of face, `pricing-strategy.md` §4) | A ceiling; replace with measured token cost (experiment C) |
| `supportCostPerSchoolCents` (new, 5b) | 1,000 a paying school a month (range 800–1,200) | COGS; experiment C tests under 30 minutes a school a month |
| `affiliateShare` (new, 5b) | 20% for 24 months on affiliate-sourced schools, from Stage C (about 15% of new paying schools) | The owner's flat rate, `go-to-market.md` 3.1 |
| `firmWholesale` (new, 5b) | 30% off for Practice clients (about 10% of paying schools from year 2) | Lowers revenue, not CAC |
| `hostingFixedCents`, `hostingCostPerThousandEventsCents` (new, 5b) | 5,000 a month, 5 | Assumption, generous; R2 storage alone is under a cent a school (`pricing-strategy.md` section 3) |
| `partnerShare` (new, 5b) | `bookkeeper` 100% | Trifold keeps the $149 Audited price |
| `opex` (new, 5b) | software $300/mo; legal $15,000 over months 1–6, then $500/mo; marketing $1,000/mo year 1, $3,000 year 2, $25,000 year 3; founder pay $6,000/mo; one hire at $8,000/mo salary ($9,600 at 1.2×) from month 19, two more from month 28 | All assumptions. Support is now COGS. Founder pay at $0 gives the bootstrapped case |

Why the growth knobs matter: with today's constant `newMembersPerMonth` and 3% monthly churn, reaching ~1,000 paying schools at month 36 needs about 46 new paying schools a month (46 × (1 − 0.97^35) / 0.03 ≈ 1,005). The same rate puts about 440 paying schools at month 12 (46 × (1 − 0.97^11) / 0.03), against the plan's 50.

Rough check of the year-end counts with these knobs (a monthly hand model, to tune against the run): year 1 ends with about 330 free and 55 paying (about 16 from the free pool, the rest direct, including design partners who pay after day 60); year 2 about 2,100 free and 300 paying; year 3 about 8,200 free and 1,030 paying. At 0.5% conversion year 3 ends near 850 paying; at 1%, near 1,200. That's about 13,000 members created, which is why phase 2's caps and planning mode come before anything else in this run.

**What it would output, per month** (`kpis.json` and `kpis.parquet`):
- Revenue: `gross_collected`, `revenue_by_tier:<tier>`, `revenue_by_kind:membership|addon`, `refunds`, `net_revenue` (new).
- Members: `paying_members`, `new_paying_members`, `arpa`, active free schools (new), `mrr` and the other MRR KPIs (on `dev`), and later `arr` and `logo_churn`.
- Credits: `credits_granted`, `credits_consumed`, `credits_expired`, `breakage_rate`, `credits_outstanding`.
- Costs: `stripe_fees`, `dispute_fees`, `partner_share`, `cogs` (AI, witness, hosting), `gross_margin`, `opex` by account, `operating_income`, `cac` (all new except the first two).
- Cash: `payouts`, cash on hand (new). Runway and NRR from the notebook.

**What month 36 should roughly show** (hand arithmetic, not a run; all assumptions):
- **Collected:** 1,000 paying schools × ~$64.70 realized (subscriptions ~$60 plus compliance packs ~$4.70) ≈ $64,700; credit packs ≈ $2,500; bookkeeper passthrough ≈ $10,000 (50 bundles × $200). Gross collected ≈ $77,200.
- **Net revenue** ≈ $65,400: gross less the passthrough (the partner's money, never Trifold's revenue) and firm wholesale discounts (≈ $1,800: 100 schools × 30% × $60). The passthrough is netted here once, so it is not a cost below.
- **COGS** ≈ $16,500–20,500: Stripe ≈ $2,600; support $8,000–12,000; AI ≤ $4,700 (paying schools average about 1,000 AI credits a month, free schools 50, at 0.33 cents); witness operations ≈ $500; hosting under $1,000.
- **Gross margin** ≈ 69–75% of net revenue, company-wide, including the free schools' AI. Per paying school it is 75–80% when support lands near $8 (section 7).
- **Opex** ≈ $62,000: marketing $25,000, three hires $28,800, founder pay $6,000, affiliate commissions ≈ $1,400 (about 120 schools inside their 24 months × 20% × $60), software and legal $800.
- **Operating income** ≈ −$13,000 to −$17,000 a month. Under these assumptions Trifold isn't yet profitable at month 36. Break-even needs about 1,250–1,350 paying schools at this cost base, or marketing held near $8,000 a month, or the list-price case.

## 6. What this doesn't cover

- Self-hosted (Community) schools: they never touch Trifold's Stripe account, so no ledger can see them. Count them, if at all, from verifier traffic or downloads, outside tfd.
- Taxes, sales tax on SaaS by state, and income tax.
- Fundraising and equity. tfd has `fundraise.*` for Zeffy donations, which is not equity.
- Price response (how conversion changes when a price changes). That is Pricing Lab's forward forecast (`pricing-strategy.md` section 7), which would build on phases 1–4.

## 7. Unit economics (assumptions)

The one home for unit economics; other docs link here. Every number is an assumption to test, mostly by the experiments in `business-plan.md` §11. Per paying school, per month, base case:

| Line | Base | Basis |
|---|---|---|
| Realized ARPU | ~$60 | The list mix ($76.50) less non-profit, annual, partner and referral discounts (`business-plan.md` §8). By year: ~$40, ~$55, ~$65 |
| Stripe fees | ~$2 | 2.9% + 30 cents |
| Support | $8–12 | Counted as COGS; under 30 minutes a school a month (experiment C) |
| AI tokens | ≤ $3.40 | About 1,000 AI credits used a month across the mix, at under a third of face value |
| Witness operations and hosting | ~$1 | Key service, transparency log, Workers and R2 |
| Gross margin | 75–80% | Needs support near $8; at $12 it is about 70%. Company-wide, with free schools' AI, ≈ 69–75% (month 36 above) |
| Contribution | ~$45–48 | ARPU × gross margin |
| Paid churn | 3% a month | |
| Lifetime | ~33 months | 1 / churn |
| LTV | ~$1,500 | Contribution × lifetime |

**CAC by channel:**

| Channel | CAC | Basis | LTV / CAC | Payback |
|---|---|---|---|---|
| Founder-led direct | ~$300–500 | About 5–8 hours of founder time per school, plus travel | 3–5× | 7–11 months |
| Schools refer schools | ~$130 | Give a month, get a month: two months at ~$60, plus handling | ~11× | ~3 months |
| Affiliates | ~$245–325 | 20% of ~$60 for the months the school pays within 24 (about 17 at 3% churn, at most 24), plus the referred school's 20% off three months (~$36). Paid as it is earned, not up front | 5–6× | 5–7 months equivalent |
| Firms | ~$0 cash | The cost is the Practice discount or the wholesale margin, booked as lower revenue | n/a | n/a |
| Paid ads and content | ~$800–1,500 | The reviewers' estimate; not measured | 1–2× | 18–33 months. **Avoid in years 1–2** |
