# Trifold pricing strategy

Status: draft, updated 2026-11-06 after reviewing Airtight's pricing (section 9); checked against the other docs and the site's pricing data (`apps/trifold-site/src/lib/pricing/data.ts`) on 2026-11-07; owner's plan decisions applied 2026-11-07 (Free's size, Starter as the wedge plan, Witnessed renamed Audited). Other prices are starting points to test with design partners, not decisions. Market data and sources are in `market-research.md`. The plan this serves is `business-plan.md`; open decisions are in its §12.

## 1. The rule

**Anything a school can do on its own is free to self-host. Anything that needs Trifold to act as the trusted third party is paid.**

A receipt the school signs itself is a strong two-party record. An independent witness adds a third party's signature on top. A self-hosted fork can't produce Trifold's witness signature, so the premium tier protects itself without a strict license.

Paid tiers sell five things: automation and scheduling, teams and collaboration, AI, views across many schools, and audit-ready books with Trifold as witness.

## 2. Never paywall

Keeping these free keeps trust, avoids a fork, and keeps the word "open" true:

1. Verifying receipts and seals, for anyone: families, CPAs, auditors.
2. Data export. The school owns its books.
3. Erasure and privacy tools.
4. Correctness and security fixes.
5. The standards: the receipt and seal specs (Apache-2.0). The KPI spec (`schema/kpis.v1.json`) is free to use but is FSL today, like the event envelope schema; calling it part of the open standard needs the owner to make it Apache-2.0 (`AGENTS.md`, "Open licensing items").

## 3. Pricing units

| Unit | Fits the value? | Fits the cost? | Can the owner predict it? | Works outside schools? | Use |
|---|---|---|---|---|---|
| Per family or student | partly | partly | yes | no (gyms have members, studios clients) | Only as a translation on the pricing page |
| Storage (GB) | no | barely | no | yes | Free, with a fair-use cap |
| Compute | no | barely | no | yes | Free, with a fair-use cap |
| **Ledger events per month** | yes | yes | roughly, with an estimate at signup | yes | **The limit between tiers** |
| **AI credits** | yes | yes (token cost) | yes, with caps | yes | **Metered** |
| **Countersigned receipts and seals** | yes | ops and liability | yes, one per payment | yes | **Metered through credits** |
| % of payment volume | yes | no | yes | yes | Avoid: it stacks on Stripe's fees |
| Per seat | no | no | yes | yes | Unlimited seats |

**Why not storage or compute.** The golden-year fixture (`packages/atm/fixtures/vibes-year`) has one active family making 81 events a year, about 1.7 KB each, 139 KB a year. A 100-family school projects to about 700 events a month and 14 MB a year, which costs well under a cent a month to store on R2 at about $0.015/GB-month. Billing for that means pennies, or an arbitrary markup owners would notice. This is one fixture family; replace the estimate with real customer data.

## 4. The rate card

| Tier | Price | Limits | For whom | What's in it |
|---|---|---|---|---|
| **Community** | $0, self-hosted | None | Developers, technical schools | The whole engine and `tfd` CLI (the `atm` command until the rename lands), including `simulate` and `reconcile`. Self-signed receipts and seals |
| **Free** (cloud) | $0 | About 300 events (about 40 families), 200 credits, 2 seats | First-time small schools, co-ops and churches | Hosted books, **signed receipts, even on Free**, one Pricing Lab scenario a month. Past about 40 families, move to Starter |
| **Starter** | $29/mo | 5,000 events, 1,000 credits, 5 seats | **The wedge plan**, recommended for small schools | Hosted books and signed receipts, sold with the compliance pack (Next); **sync to QuickBooks or Xero** (Next) for those who keep them |
| **Pro** | $79/mo | 25,000 events, 5,000 credits, unlimited seats, **up to 3 organizations** | Stripe-native organizations ready to replace QuickBooks; small school networks and fiscal sponsors | Pricing Lab, daily reconcile with alerts, scheduled close, **bank-statement import (CSV/OFX)**, multi-user ledger UI with roles and CPA seats, Rifo. On sale once these exist |
| **Audited** | $149/mo | 25,000 events, 8,000 credits | Organizations that need audit-ready books (state programs, audits, boards, investors) | Pro, plus Trifold's countersignature ("Witnessed by Trifold"), the auditor portal, the compliance pack, daily Stripe matching, the transparency log and the per-event chain. All Next |
| **Audited + Bookkeeper** | ~$349/mo | As Audited | Owners who want the month closed for them | A partner bookkeeper does the close, on audited books |
| **Compliance pack** | $15–30/mo per state program | | Schools in state education programs | Itemised, payer-identified receipts for that program (provider, expense, amount, date, who paid, per child), kept current as the rules change. Next; included in Audited |
| **Platform / Enterprise** | Metered or custom | | School networks, franchises, vertical software | Rollups across schools, network revenue share, SSO/SAML, SLA, embedding rights |
| **Witness API** | First 500 receipts a month free, then $0.03–0.05 each | | Platforms and issuers, under the Platform agreement | The witness alone, for receipts other software issues. Not sold to a single school as a cheap substitute for Audited; whether the free 500 stay is open (`business-plan.md` §12) |

**No per-seat fees. No per-transaction fees. No surprise bills.** This is the line on the pricing page; Airtight leads with the same promise ("Pricing you can actually read"), so our pricing has to read at least as simply.

Over the event limit: the event limit is a **soft limit** on Free, Starter, Pro and Audited. The books never stop and nothing is billed automatically; after two months over, the owner is asked to move up a tier. Platform pays about $1 per 10,000 events. (This replaces the earlier $2 per 10,000 overage: a metered overage contradicts "no surprise bills" and would cost more in trust than it earns.)

**What the pricing page shows.** Cards show the plan, its features and "about N families". Events and credits appear only in the comparison matrix and the FAQ. Developers and platforms see the metered view.

Annual billing: two months free (Starter $290/yr, Pro $790/yr, Audited $1,490/yr).

**Included credits and margin.** Included credits are a cost if they're used: 8,000 credits is $80 at face value on a $149 plan. Price credits so AI token cost stays under about a third of their face value, and watch actual use per tier.

### Why these prices (summary of `market-research.md`)

- **Starter at $29** is the wedge (owner's decision, 2026-11-07). It fills the gap between $0 and $79, and with the compliance pack it answers the beachhead's pain: receipts state programs ask for. Owners who keep QuickBooks ($38) or Xero ($27) get the sync on top.
- **Pro at $79** sits just under QuickBooks Essentials ($85, 3 users) and near Digits Essentials ($65) and Puzzle Core ($72 on Puzzle's own page; aggregators show $60), with unlimited seats. It has to replace QuickBooks; stacked on top, the total is $117–164. So it waits until Rifo, Pricing Lab, daily reconcile and sync exist (owner's decision, 2026-11-07).
- **Audited at $149**, down from a first draft of $199. At $199 it was priced like Pilot's entry service ($199 on aggregators; Pilot's own page shows Bookkeeping Essentials at $99) without a human behind it, and $79–99 above Puzzle Complete ($120) and Digits Core ($100). It was called Witnessed; the owner renamed it on 2026-11-07 because a timestamp signature alone is commodity cryptography, so the price has to buy the audit-ready outcome (`business-plan.md` §6).
- **The bookkeeper bundle at ~$349** undercuts human bookkeeping ($349–849+) and the books are provable. Most of it passes through to the partner, so count only Trifold's share as revenue.
- **Against Airtight** (section 9): their AUD $49 / $99 / $199 plans are roughly US$32 / $65 / $130. Pro at $79 and Audited at $149 sit a little above, which the free tier, non-profit pricing, Stripe-native books and payer-held receipts justify. Don't cut prices to match.

## 4a. Billing policies

Published on the pricing page and in the FAQ. Airtight publishes the same set, and owners now expect it.

| Policy | Rule |
|---|---|
| Refunds | Full refund within 30 days of the first paid charge |
| Cancelling | Two clicks in settings; no retention call or email |
| Plan changes | Any time. Upgrades are prorated to the day; downgrades credit the next invoice |
| Onboarding | Included on every paid plan; no setup fee |
| Data on leaving | Export everything, in open formats, before and after cancelling (export is never paywalled, section 2) |
| Annual billing | Two months free (about 17% off) |

## 4b. Non-profits, co-ops and churches

Verified 501(c) organizations (IRS determination letter or EIN check), churches and cooperatives (articles or bylaws) pay about half:

| Tier | Standard | Non-profit / co-op |
|---|---|---|
| Starter | $29 | $15 |
| Pro | $79 | $39 |
| Audited | $149 | $79 |
| Audited + Bookkeeper | ~$349 | ~$249 |

- Non-profits with gross receipts of $50,000 or less get the witness free on the Free plan, once it ships: up to about 66 countersigned receipts a month (Free's 200 credits at 3 credits each).
- Donation acknowledgments use no credits; board, member and auditor seats are unlimited.
- Add-on packs ($15–25/mo): the non-profit pack (donation acknowledgments, restricted funds, grant reports, a Form 990 package) and the co-op pack (member capital accounts, patronage allocation, 1099-PATR export).
- Whether the annual discount stacks with the non-profit price is open; the recommendation is that it doesn't (`business-plan.md` §12). The draft pricing page and the site's FAQ stack them today.
- Airtight has no non-profit pricing; this is a clear difference.

## 4c. Accounting firms

The firm's own seats are free and unlimited on every client's books, on every plan. Everything else for firms (client discounts, the directory, the no-referral-fee rule, the firm tiers and referrals) is in `go-to-market.md`.

### Firms hosting tfd for their clients: the tradeoffs (open, decide before the Practice tier)

The FSL already allows a firm to work on a client's **own** install ("professional services that you provide to a licensee"). The open question is one firm running **one tfd for many clients**: that is probably a Competing Use, because it substitutes for Starter, Pro and the Audited + Bookkeeper bundle.

| Option | For | Against |
|---|---|---|
| **A. No grant** (FSL as written) | Strongest protection; no new legal text; firms are steered to hosted Trifold, where their seats are already free | Firms that want their own servers (data control, one tool across all clients) may pick a competitor; firms are a key enabler |
| **B. Public grant: "a firm may host tfd for its own clients"** | Easiest for firms; more schools issue receipts with the verify link; goodwill | A 200-client firm becomes a small Trifold at $0, cannibalising Pro and the $349 bundle. "Own clients" and "bookkeeping service" are hard to draw (hosted books *is* the service). A published grant can't be taken back for the releases it covers. Two years later each release is Apache-2.0 anyway, so the grant only matters for the newest releases, which are the ones that compete |
| **C. Public grant with a cap**, e.g. up to 10 clients free, then a partner agreement | Small firms are free; large ones pay; one rule, no case-by-case deals | A cap needs counting and trust; a firm can split into entities; still new legal text to maintain |
| **D. No public grant; a written partner agreement on request** (a commercial license, priced per client or as a revenue share) | Keeps FSL's text clean; terms fit each firm; turns the largest firms into revenue | Case-by-case, which this section otherwise avoids; slower for firms; needs a lawyer per template |

**Suggestion:** A now, with D available on request (offered to the Stage A co-design firms), published as the firm program in `go-to-market.md` §2. B gives the most away exactly where Trifold earns: hosted books with a bookkeeper. Revisit C once the program has data on firm sizes. Whatever is chosen, it lives in a separate written permission, never in an edited FSL (a changed FSL is no longer FSL).

## 5. Credits

1 credit = $0.01. Unused credits roll over for one month, then expire. tfd's own rollover and expiry rules can run this.

| Action | Credits | Why |
|---|---|---|
| Rifo question or explanation | 2–10 | Passes on the token cost with margin |
| Rifo monthly close (categorize, reconcile, write the summary) | 500–1,500 | Replaces hours of bookkeeper time; still far below a service |
| Pricing Lab forecast or scenario run | 25 | Replays a year of events and forecasts |
| Countersigned receipt ("Witnessed by Trifold") | 3 | The viral object: kept cheap on purpose |
| Countersigned month seal | 25 | |
| Self-signed receipt, seal, `verify`, CLI `simulate` | **0, always** | Free to self-host; format and verifier are Apache-2.0 |

### Rules that make credits safe for small businesses

1. **Running out never stops the books.** Payments still book, journals still build, receipts are still self-signed. Only Rifo and new witness signatures pause. Receipts made while out of credits are countersigned once credits return, and the transparency log shows the later time honestly.
2. **A hard cap by default**, with alerts at 80% and 100%. Overage is opt-in, so there are no surprise bills.
3. **Estimates at signup:** "A school with about 40 families makes about 280 events a month, and Free covers it. Past that, Starter."
4. **School owners see a flat plan.** Events and credits stay in the background, with defaults that rarely run out. Developers and platforms see pure usage.

## 6. Features by tier

Free is the Community column, hosted, within Free's limits. Starter is Free plus higher limits, the compliance pack and the QuickBooks and Xero sync.

| Feature (what exists in tfd today) | Community | Pro | Audited | Platform |
|---|---|---|---|---|
| Billing engine: credits, plans, bookings, codes, membership status, deduction order | ✅ all | | | |
| Event log, `ship`, stored inputs, `inputs ship` | ✅ | Managed storage, backups, retention | | Data residency |
| `journal` (hledger), `report` | ✅ | Scheduled monthly close, CPA package | | Consolidation across schools |
| `reconcile` (Stripe matching) | ✅ on demand | Daily automatic run plus alerts | Matches enter the countersigned record | |
| `simulate`, both modes | ✅ | **Pricing Lab** (section 7) | | Network-wide pricing tests |
| `scenarios`, KPI spec, parity, parquet export | ✅ (the KPI spec is FSL today, not yet part of the open standard; section 2) | KPI dashboards; anonymous benchmarks against peer schools | | Network rollup |
| `share` (revenue-share statement) | ✅ | | | Network revenue-share billing |
| Receipts, seals, `verify` | ✅ self-signed | | Trifold countersignature, transparency log, per-event chain, auditor portal | Co-branded verify page (link and badge kept) |
| Ledger UI | Single-user, read-only viewer | Multiple users, roles, CPA seats, approvals | Auditor role | SSO, audit log |
| Rifo agent | Small monthly quota | ✅, with approval modes: **Off**, **Ask first** (default) and **Auto within limits**. Rifo drafts, you approve, the engine does the math | | Custom agents and API |
| Bank-statement import (CSV/OFX) | Not built in tfd yet (planned as a CLI import) | ✅ hosted, with matching rules (planned) | | |
| Organizations per account | 1 | Up to 3 | | Unlimited, with consolidation |
| Erasure and privacy tools | ✅ never paywalled | | | |
| State program receipts | | Compliance packs (add-on, also on Starter) | Included | |
| QuickBooks and Xero | CSV and hledger export | Managed sync (also in Starter) | | |

**SSO:** charging extra for single sign-on is widely criticized as an "SSO tax." Basic Google sign-in goes in Pro; SAML stays in Platform.

## 7. Pricing Lab: what `simulate` becomes in Pro

The `simulate` engine and CLI stay free. They were already published under Apache-2.0 (releases 0.6.0 to 0.9.0; from 0.10.0 they are FSL, still free to self-host), they're a strong developer hook (exit code 1 lets CI block a pricing change), and they run on the core billing engine. Pro sells what the CLI can't do:

| Free `simulate` | Paid Pricing Lab |
|---|---|
| Replays the past under a new menu or deduction order | Forward forecast: next quarter's revenue and credit liability under new prices, with churn and price-response assumptions |
| What-if on grant rules from stored inputs (`--inputs`) | Saved scenarios side by side, shareable with an owner or board |
| JSON diff and exit codes | Visual diff: which families pay more or less, by month |
| USD totals fixed (Stripe's charges can't be replayed) | Revenue impact estimate under the new menu |
| A developer runs it locally | Rifo suggests and explains prices |
| A developer wires up the CI gate | Hosted GitHub check; staged rollout from a date, or to new families only |

## 8. Licensing that supports the pricing

The licenses are decided; the table and rules are in `../../AGENTS.md`. In short: the engine is FSL-1.1-ALv2, so a hosted clone is blocked and each release becomes Apache-2.0 after two years; the format, verifier and vectors are Apache-2.0 or CC0, so checking can never be restricted; the hosted service, Rifo, the witness and the website are proprietary. Releases up to 0.9.0 stay Apache-2.0; 0.10.0 (2026-11-07) is the first FSL release.

This is the one place the license comparison lives:

| License | Internal use | Competitor can host? | OSI open source? | Opens up later? | Track record |
|---|---|---|---|---|---|
| Apache-2.0 / MIT | yes | yes | yes | n/a | Maximum adoption, no protection |
| AGPL-3.0 + commercial | yes | yes, must publish changes | yes | n/a | Grafana, Plausible. Many company lawyers ban AGPL |
| **FSL-1.1 (chosen for the engine)** | yes | no | no ("Fair Source") | Apache or MIT after 2 years (Apache here) | Sentry and others; low backlash |
| BSL 1.1 | yes, within its usage grant | per the grant | no | after up to 4 years | MariaDB, HashiCorp (whose 2023 switch led to the OpenTofu fork) |
| Elastic License 2.0 | yes | no managed service | no | never | Elastic |
| SSPL | yes | only if the whole stack is published | no | never | MongoDB; seen as hostile |

## 9. What Airtight's pricing taught us

Airtight (airtight.one) sells triple-entry accounting with Ed25519 receipts to Australian and Gulf-region businesses, with an AI assistant, Bella. Reviewed 2026-11-06 from its own pricing and home pages; its claims aren't independently verified.

| Plan (AUD/mo) | Foundation $49 | Plus $99 | Scale $199 | Enterprise $499+ |
|---|---|---|---|---|
| Unit | 1 entity | 3 entities, payroll for 5 | 10 entities, payroll for 50, read-only auditor access | Unlimited entities |

No free tier or trial; 17% off annual; no seat or transaction fees; $0 auditor seats; firm discounts set by hand; 30-day refund; two-click cancel.

**Adopted here:** the "no seat fees, no transaction fees" promise (section 4), soft event limits instead of overage, published billing policies (4a), approval modes for Rifo (section 6), bank-statement import and up to 3 organizations in Pro, a published accounting-firm rule (4c).

**Where Trifold differs, and says so on comparison pages:**
- Airtight signs a receipt for each entry it posts, kept in its own system. Trifold gives the signed receipt to **the person who paid**, so both sides hold the record, and anyone can check it with a free verifier and an open format.
- A free hosted plan and a self-hostable engine; Airtight has neither.
- Signed receipts on every plan, even Free; Airtight's cheapest plan is about US$32 a month.
- Auditor seats free on every hosted plan; Airtight includes auditor access from Scale ($199 AUD).
- Non-profit and co-op pricing; Airtight has none.
- Stripe-native and US-first; Airtight is bank-feed-first in Australia and the Gulf.

**What it costs us:** Airtight already says "triple-entry" and claims a SHA-256 hash chain. Trifold doesn't use the term at all. Milestones 2 and 3 still matter, because they back the hash-chain claim.

Sources: https://airtight.one/pricing/ and https://airtight.one/

## 10. Risks

- **Stack fatigue.** Pro only wins if it replaces QuickBooks. Starter's sync is the bridge while Pro proves it can replace them.
- **Audited needs Rifo to close reliably.** Until it does, the bookkeeper bundle carries the premium value.
- **The premium is commodity cryptography.** `business-plan.md` §10.
- **Over-claiming.** The claim rules in `AGENTS.md`.
- **Credit confusion.** Mitigated by flat plans, hard caps and generous defaults (section 5).

## 11. Open decisions

In `business-plan.md` §12.
