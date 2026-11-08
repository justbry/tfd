# Trifold business plan

Status: draft, 2026-11-06; checked against the other docs and the code on 2026-11-07; review fixes and owner decisions applied on 2026-11-07. Prices and projections are assumptions to test, not decisions, unless marked as the owner's decision. The repository is `justbry/tfd` since 2026-11-07; old releases and PRs up to #145 stay on `justbry/atm`, so PR numbers above #100 here are `justbry/atm` PRs.

Each topic has one home. Other docs link to it rather than repeat it.

| Topic | Home |
|---|---|
| Names, licensing, claim rules | `../../AGENTS.md`; licenses in prose in `../../LICENSING.md`; marks in `../../TRADEMARKS.md` (draft); the CLA in `../../CONTRIBUTING.md` |
| Prices, tiers, credits, features by tier, the license comparison | `pricing-strategy.md` |
| The first design partners, channels by stage, the firm, referral, affiliate and implementer programs, paying accountants in Idaho and Utah | `go-to-market.md` |
| Unit economics and the model's assumptions; running the model in tfd | `financial-model.md` |
| Competitor prices, the first beachhead, market size, research gaps | `market-research.md` |
| What the website still needs | `website-open-questions.md` |
| Voice, taglines, plain-English glossary, customer profiles | `../brand/trifold-brand-and-messaging.md` |
| The website's messaging, sitemap and decisions | `../website/` |
| Draft pricing page | `pricing-page.html`; the site's `apps/trifold-site/src/lib/pricing/data.ts` is the current version |
| Open decisions | Section 12 of this doc |

## 1. Summary

**Books that show their work.** Every payment gives the payer a receipt they can check, and every closed month is sealed, so a later change shows.

Trifold is trusted financial accounting automation and AI for any business that bills through Stripe. We focus on schools, co-ops and churches (owner's decision, 2026-11-07). Automation exists today; the AI, Rifo, comes next.

**Trifold** is the company and the managed service. **tfd** is the engine and its CLI (the `atm` command until the rename lands). tfd builds the books from the payment events themselves. It signs a receipt for every payment, for the payer to keep, and seals every closed month. Anyone can check both with a free, open verifier.

What exists today (section 3): the engine and CLI, released as 0.10.0 on 2026-11-07 (tag `atm-v0.10.0` on `justbry/atm`), with signed receipts and sealed months. The hosted service, Rifo and the witness are not built. No school issues signed receipts to families yet.

The format and verifier are open; the engine is source-available and free to self-host (section 5). Customers pay for the hosted service, automation, Rifo, and **Audited**: Trifold as an independent witness, with the auditor portal and compliance packs.

The market is the whole US and each English-speaking country. The first beachhead is Idaho and Utah, led by microschools (owner's decision, 2026-11-07; section 4); then the US nationally, Canada without Quebec, the UK, Australia and New Zealand, and Ireland. Accounting firms are a key enabler and channel from the start, not a later one. B4 Uni's family service (buzz-school) already uses released tfd versions as a pinned dependency, though it doesn't yet call the engine's handler, shipper or receipts (`packages/atm/ROADMAP.md`). B4 Uni and Vibes of Light are the owner's own or related businesses, so they are related parties, not independent customers or design partners in the count (`website-open-questions.md` 4.4).

## 2. Problem

- Small schools, co-ops and churches run on Stripe, spreadsheets and a bookkeeper. Closing a month is manual and slow.
- The books can be changed quietly, and nobody outside can tell.
- Families get a Stripe email, not a receipt that proves anything to a state program, an auditor or a court.
- Accounting software is getting more expensive. QuickBooks, Xero and FreshBooks all raised prices in 2026; QuickBooks caps users at every tier (`market-research.md`).

## 3. Solution

| Piece | What it does | Status |
|---|---|---|
| Books from events | Every Stripe event and booking becomes a ledger event, then a journal, reports and an on-demand Stripe reconciliation (`tfd reconcile`) | Released (tfd 0.10.0, 2026-11-07, and earlier) |
| Signed receipts | Ed25519 receipt per payment and refund; regenerated from the books, so an edit shows; `tfd receipt`, `tfd verify receipt`. Carries the school, date and amount; no payer name and no per-child lines | Released in tfd 0.10.0 (milestone 1, `justbry/atm` #123 and #137). Not yet issued by any school |
| Sealed months | A signed, chained seal per closed month; `tfd seal`, `tfd verify seals` | Released in tfd 0.10.0 (milestone 1). Not yet run by any school |
| Verifier SDK | `tfd-verify`: the receipt and seal checks for browsers, Apache-2.0 | Built on the branch with PR #32; not published to npm |
| Website | `apps/trifold-site`, with an in-browser verifier from `tfd-verify` | Preview at `tfd-ledger.pages.dev`; no real domain yet |
| Pricing what-ifs | `tfd simulate`: replay the books under new prices | Released (since 0.6.0). The paid Pricing Lab is not built |
| MRR in the books | `mrr.changed` events and MRR KPIs | Merged on `dev`, not released |
| Hosted service (cloud Free, Starter, Pro) | Trifold runs tfd for a business | Not built |
| Compliance pack | An itemised, payer-identified receipt for a state program: provider, expense, amount, date and who paid, per child | Not built (Next, phase 1). Blocked on the payer-identity and erasure decision (section 12, item 1) |
| Rifo | Agent that closes the month and answers questions | Not built (Next) |
| Per-event chain | Hash chain over every event in the webhook transaction | Not built (milestone 2) |
| Daily Stripe matching | Events matched to Stripe's balance transactions every day | Not built (milestone 3) |
| Trifold witness | Trifold countersigns receipts and seals ("Witnessed by Trifold") and logs them in a public transparency log | Not built (Next; sold in Audited) |
| Tax packages | Year-end packages for a CPA | Not built (Later) |

What we may say about each piece follows the claim rules in `../../AGENTS.md` ("Claims").

## 4. Customers

**The market** (owner's decision, 2026-11-07): any business that bills through Stripe, in the whole US and in each English-speaking country. Its size, as estimates, is in section 8 and `market-research.md` §6.

**Launch order** (the research's recommendation, `market-research.md` 6.9): the US nationally, with schools in the ESA states first, then education co-ops and churches; then Canada without Quebec; the UK; Australia, then New Zealand; Ireland, alongside an EU plan.

**Focus verticals** (owner's decision, 2026-11-07):
- **Schools:** microschools, small private schools and hybrid schools.
- **Co-ops:** homeschool and education co-ops, and member co-ops.
- **Churches:** recurring giving through Stripe.

**First beachhead (the wedge):** Idaho and Utah, led by microschools of about 10–150 families that bill through Stripe and use a bookkeeper or CPA. Idaho and Utah are where the first design partners come from, not the whole market.

**The wedge pain.** Families in state programs have to keep receipts that show the provider, the expense, the amount, the date and who paid (Idaho's tax credit asks for exactly this; Utah's program has its own rules). tfd's signed receipt today has no payer name and isn't itemised per child. So the wedge needs the compliance pack on the Starter plan (section 6), and the payer-identity and erasure decision blocks it (section 12, item 1).

**Then:** other businesses on Stripe (studios, tutoring, camps, gyms), after the focus verticals.

**Accounting firms are a key enabler and channel** (owner's decision, 2026-11-07). About 5 firms join as co-design partners in Stage A; firms bring clients, check receipts and close months. There are about 46,000–52,000 CPA firms in the US alone (sourced, `market-research.md` 6.6). Channels by stage are in section 7 and `go-to-market.md` §1. Customer profiles and messaging: `../brand/trifold-brand-and-messaging.md`.

## 5. Product and licensing

The rule: **anything a school can do on its own is free to self-host. Anything that needs Trifold as the trusted third party is paid.**

Never paywalled: verification, data export, erasure and privacy tools, security fixes, the receipt format.

**Licensing** (decided; the table and rules are in `../../AGENTS.md`). The receipt and seal format, the verifier (`tfd-verify`) and the test vectors are Apache-2.0 or CC0, so anyone can check, forever. The tfd engine is FSL-1.1-ALv2: free to self-host, no competing hosted service, and each release becomes Apache-2.0 two years after it ships (0.10.0, 2026-11-07, is the first FSL release). The website, the hosted service, Rifo and the witness are proprietary. Outside contributions need a CLA. The comparison with BSL, Elastic, AGPL and SSPL is in `pricing-strategy.md` §8. The license is the weakest moat (section 9): it blocks a hosted clone for two years per release.

## 6. Pricing

A summary. The rate card, limits, credits and reasons are in `pricing-strategy.md`.

| Tier | Price | In one line |
|---|---|---|
| Community | $0, self-hosted | The whole engine and CLI |
| Free | $0 cloud | About 300 events a month (about 40 families), 200 credits, 2 seats; signed receipts included |
| Starter | $29 | **The wedge plan**, recommended for small schools: hosted books and signed receipts, sold with the compliance pack |
| Pro | $79 | Replaces QuickBooks; on sale once Rifo, Pricing Lab, daily reconcile and managed sync exist |
| Audited | $149 | Trifold's countersignature, auditor portal, compliance pack, daily Stripe matching (all Next) |
| Audited + Bookkeeper | ~$349 | A partner bookkeeper closes the month on audited books |
| Compliance pack | $15–30 per state program | Itemised, payer-identified receipts for one program (Next); included in Audited |
| Platform / Witness API | Metered | For networks, platforms and issuers |

**Why "Audited", not "Witnessed"** (owner's decision, 2026-11-07). A timestamp signature ("seen at time T") is commodity cryptography: RFC 3161 timestamping, OpenTimestamps and Sigstore Rekor all do it. And the school pays while the family, auditor or state benefits. So the premium is the audit-ready outcome: the auditor portal, compliance packs, daily Stripe matching, retention and Trifold's name. "Witnessed by Trifold" stays as the badge on a countersigned record (`../../TRADEMARKS.md`).

## 7. Go-to-market

Program designs are in `go-to-market.md`. Channels open in stages:

| Stage | When | Channels |
|---|---|---|
| A | Months 0–6 | Founder-led direct outreach; about 5 accounting firms as co-design partners (Listed tier, with a written agreement on request); school networks and co-ops, each as one partner; schools refer schools for credit |
| B | Months 6–12 | Bookkeepers and CPAs on the Listed and Practice tiers |
| C | After about 20 paying schools | Community affiliates (20% × 24 months); then Practice Pro (after about 100 paying clients across firms); vertical software, the Witness API and the implementer program (after the witness ships) |

The Stripe App is deferred to phase 2.

**Growth loops, as hypotheses to measure:**
1. **Networks, co-ops and referrals (the most credible).** Microschools and co-ops cluster and know each other. A network joins as one partner; schools refer schools for credit. Measure referrals per paying school.
2. **Firms bring clients.** Free firm seats and the firm tiers. Measure firm-sourced signups.
3. **The receipt link.** Each receipt carries a verify link. The verify page asks "Is your school using Trifold?" and links to "Run this for your school". Target: 1 inbound school per 100 receipts viewed. The verify domain isn't registered yet (`website-open-questions.md` 2.2).
4. **Others adopt the standard.** Platforms that issue receipts in the format widen the verifier's reach and can buy the Witness API. Measure outside issuers (phase 2 and later).

The metrics and triggers below are assumptions to test.

| Phase | When | Goal | What ships | Leading metrics | Proof it worked | Kill or pivot if |
|---|---|---|---|---|---|---|
| 0. Foundations | Now to month 3 | Design partners issuing real receipts | Spec v1 in its own repo, test vectors, one verifier (`tfd-verify`), more if a design partner needs it; license split (done); domains and trademark clearance; the first design partners (`go-to-market.md` §0) | Interviews held; organizations onboarded; receipts issued; days to first receipt; verify-link views per 100 receipts | `go-to-market.md` §0 exit test: at least 5 of 10 issuing receipts, 3 say they'd pay, 1 CPA has verified a receipt | Fewer than 3 of 10 issue receipts by day 60, or experiment A fails (section 11): change the offer or the paid line before building hosted |
| 1. Wedge | Months 3–9 | Win the beachhead | Cloud Free and Starter; the compliance pack (itemised, payer-identified receipt for state programs); firm pilot on Listed and Practice | Weekly active schools; free-to-paid conversion; price accepted; referrals per paying school; firm-sourced signups | 100 organizations on cloud, 20 paying, about 10 firm partners | Free-to-paid under 0.5% a month after 3 months on sale, or under half of schools accept the price: rework the plan or the offer before opening Stage C |
| 2. Premium | Months 9–18 | Make Audited real | Pro (with Rifo, Pricing Lab, daily reconcile, sync); milestones 2 and 3, transparency log, Audited, Witness API; Stripe App | Audited attach rate (share of paying schools); auditor portal logins; outside issuers | Audited on 25%+ of paying schools; 3 outside issuers | Audited under 10% of paying schools after 6 months on sale: repackage it, or drop it from the outlook |
| 3. Expand | Month 18+ | Other states, countries and verticals | Studios, tutoring, camps, gyms; embedded deals; tfd Tax | Net revenue retention; platform revenue; CAC by vertical | Platform revenue; net retention above 110% | Net retention under 100%: stay with schools, co-ops and churches |

## 8. Financial outlook (illustrative)

Assumptions, not forecasts. Unit economics, costs and the model's inputs are in `financial-model.md` §7.

**List-price mix (the upside case).** 40% Starter, 35% Pro, 20% Audited, 5% bundle (counting only Trifold's ~$149 share of the bundle): 0.40 × $29 + 0.35 × $79 + 0.20 × $149 + 0.05 × $149 = $11.60 + $27.65 + $29.80 + $7.45 = **$76.50** a school a month. Credit packs (about $2–3) aren't recurring and are left out.

**Realized ARPU (the base case): about $60.** About 40% of schools are non-profits or co-ops at about half price (× 0.80), and about 15% pay annually with two months free (× 0.975): $76.50 × 0.80 × 0.975 ≈ $59.70. Partner and referral discounts take a little more in their first year.

**By year**, because the plans arrive in phases:

| | Year 1 | Year 2 | Year 3 |
|---|---|---|---|
| Paid plans on sale | Starter with the compliance pack | Pro arrives; Audited late in the year | All |
| Realized ARPU (assumption) | ~$40 | ~$55 | ~$65 |
| How | Starter $29 plus the pack ($20) on about 60% of schools, few discounts among the first schools: ($29 + $12) × 0.95 ≈ $39, about $40 | 55% Starter, 35% Pro, 10% Audited, packs on 40%: $66.50 at list × 0.83 (the non-profit share rising toward 40%) ≈ $55 | The full mix at $59.70, plus packs on about 30% of non-Audited schools (≈ $4.70 after discounts) |

| | End of year 1 | End of year 2 | End of year 3 |
|---|---|---|---|
| Free cloud and self-hosted organizations (adoption, not revenue) | 300 | 2,000 | 8,000 |
| Paying organizations | 50 | 300 | 1,000 |
| Base: ARR, end-of-year run-rate (paying × that year's ARPU × 12) | ~$24K | ~$198K | ~$780K |
| Base: revenue in the year | ~$14K | ~$122K | ~$525K |
| Upside (list price, full mix from day one): run-rate ARR (paying × $76.50 × 12) | ~$46K | ~$275K | ~$918K |
| Upside: revenue in the year | ~$28K | ~$170K | ~$618K |
| Platform and Witness API | — | small | 10–20% on top |

Revenue in the year adds up each month's paying organizations × that year's ARPU, with paying organizations growing as in `financial-model.md` §5: 0.75% a month free-to-paid, 3% a month paid churn, plus about 4, 15 and 35 direct paid sign-ups a month in years 1–3 from founder-led sales, firms and referrals. At 0.5–1% conversion the free pool alone gives only about 10–20, 80–160 and 370–720 paying organizations by the three year-ends; the direct channels have to bring the rest.

**Why schools upgrade:** past about 40 families, Free's 300 events run out, so they move to Starter (a family makes about 7 events a month). After that, they upgrade for features (the compliance pack, QuickBooks sync, Pricing Lab, Rifo, Audited), not limits.

**What would change the outlook most:** the price schools actually pay (experiment A), how many free organizations convert, paid churn, whether Rifo can close a month reliably (that decides Pro's and Audited's value), and whether families, CPAs and programs want verifiable receipts (experiment B).

### Market size (estimates)

From `market-research.md` §6, at the realized $60 a month ($720 a year). All are estimates built on sourced counts.

| Ring | Organizations | Revenue a year |
|---|---|---|
| Outer ring: small businesses on Stripe in the six countries | ~0.9M | ~$630M |
| TAM: paid-eligible (over the Free line) schools, co-ops, churches and adjacent verticals | ~426,000 (focus verticals ~217,000) | ~$307M (focus ~$156M) |
| SAM: the share billing through a Stripe account they control | ~77,000 (focus ~45,000) | ~$55M (focus ~$32M) |
| SOM: a 3-year share | ~1,200 paying | ~$0.86M ARR in year 3 |

The SOM fits the outlook above: about 1,000 paying organizations at ~$65, or ~$780K run-rate ARR, in year 3. Churches lead the SAM by count but pay about half price, which is why schools stay the wedge.

## 9. Moat, strongest first

1. Trifold's name on audit-ready books: the witness, its transparency log, the auditor portal and compliance packs. The signature itself is commodity (section 6); the record of what Trifold saw, and when, can't be forked.
2. Owning the open standard.
3. The trademark.
4. Rifo and the workflows on top of the books.
5. The FSL license: it blocks a hosted clone of tfd for two years per release.

## 10. Risks

| Risk | How it's handled |
|---|---|
| A big vendor clones the engine and hosts it | FSL bars a competing hosted service for two years per release. The witness, the transparency log and the trademark can't be cloned. After two years a release is Apache-2.0, so the lead has to come from what Trifold ships next |
| The premium is copied | Timestamp signatures are commodity (RFC 3161, OpenTimestamps, Sigstore Rekor), and the school pays while others benefit. Audited sells the outcome (portal, packs, matching, retention, the name), not the signature; experiment B tests demand |
| License backlash | Low. The conversion date is public, the license text is standard, and checking (format, verifier, vectors) is Apache-2.0 or CC0. Decided while there's one author |
| A fork reuses the Trifold name | `TRADEMARKS.md` (draft): a fork must rename |
| Over-claiming | The claim rules in `AGENTS.md` |
| Tax preparation is regulated (paid preparers need an IRS PTIN) | File through licensed CPAs or enrolled agents; Trifold prepares the books, never signs returns |
| What the witness promises | Defined narrowly: "Trifold saw this exact record at time T," not "the money moved"; terms of service reviewed by a lawyer |
| State programs change or end (Utah's program is under appeal) | Compliance packs are per program and monthly; never claim a program accepts a receipt (`website-open-questions.md` 4.3) |
| Student and donor data (FERPA, state privacy laws) | Checked per organization type; personal data kept out of signed receipts, as it is today |
| Someone else owns the payment rail | FACTS, Brightwheel and Prenda run billing for many schools; Pushpay and Givelify run church giving. Those organizations are outside the SAM (`market-research.md` 6.3). Planning Center Giving runs on each church's own Stripe account, so it is the way in for churches |
| ESA money arrives outside Stripe | ClassWallet, Odyssey and similar pay ESA money to schools directly. Trifold must book that income too, or the books are incomplete (section 11) |
| Payer names on receipts vs erasure | The wedge needs payer names; erasure must not break receipts. Owner decision before the compliance pack (section 12, item 1) |
| Key compromise | Keys in a managed key service, a dated revocation list, old keys kept verifiable |
| Trademark conflict | "Trifold" collides in search with the Samsung Galaxy Z TriFold, and old TRIFOLD filings exist (a dead class 9 application, a class 42 filing of unknown status). Clearance search for Trifold in classes 9, 36 and 42 before filing; "tfd" needs the same check |
| Competitors' deep discounts | Compete with the free core and provable books, not on price |

## 11. Next 90 days

1. Register the domains, including the verify host (gettrifold.com was still unregistered on 2026-11-07); order a trademark clearance search.
2. Recruit the first design partners and run the plan in `go-to-market.md` §0.
3. Run experiments A, B and C below.
4. Settle the payer-identity and erasure decision, then the other receipt decisions in `packages/atm/ROADMAP.md` (section 12, item 1).
5. Move the receipt and seal spec to its own repo with test vectors. The verifier is already its own package, `packages/verify`.
6. Publish the CLA text (`CONTRIBUTING.md`); a lawyer reviews it and the trademark policy.
7. Answer the website's "decide first" list (`website-open-questions.md`).

Build items the market research adds (`market-research.md` 6.9), in the order the US launch needs them:
- ESA-compliant itemised receipts (the compliance pack): itemised, with proof of payment and the payment method, as Odyssey asks.
- Booking ESA payouts (ClassWallet, Odyssey and others) and other income that arrives outside Stripe.
- A year-end giving statement for churches, with the IRS wording for gifts of $250 or more.
- Sales tax on Trifold's own SaaS, state by state.

Three 90-day experiments. The thresholds are assumptions.

| Experiment | How | Pass | Fail, and what then |
|---|---|---|---|
| **A. Price** | Ask 10–15 schools that aren't related parties for a card or a letter of intent | At least 4 commit at $29 or more, and at least 2 at $79 or for the compliance pack | Fewer than 2 commit: change the paid line before building hosted |
| **B. Receipt demand** | Interview about 20 families in a program that requires receipts and about 5 CPAs; contact a program administrator | Any of: at least 50% of CPAs would accept or prefer the receipt; at least 30% of families would ask their school for it; a program or auditor says it prefers verifiable receipts | None: drop Audited from the year-1 and year-2 outlook |
| **C. Cost and reliability** | Run 2 schools for 60 days | Support under 30 minutes a school a month; AI cost under $8 a school a month | Over either: fix onboarding or the included credits before the cloud launch |

## 12. Decisions

The one list of open decisions. Other docs link here.

### Decided

- **Licensing** (2026-11-06; two-year conversion kept 2026-11-07): see section 5 and `AGENTS.md`. The website is proprietary; its verifier comes from the Apache-2.0 `tfd-verify` (2026-11-07).
- **Contributions:** a CLA (2026-11-07, `CONTRIBUTING.md`).
- **Market** (2026-11-07): the whole US and each English-speaking country. Idaho and Utah are the first beachhead (the wedge), not the whole market.
- **Positioning** (2026-11-07): trusted financial accounting automation and AI for any business on Stripe, focused on schools, co-ops and churches. Accounting firms are a key enabler (section 4).
- **Plans** (2026-11-07): Free shrinks to about 300 events a month and keeps signed receipts. Starter ($29) stays and is the wedge plan, sold with the compliance pack. Pro ($79) waits for its features. Witnessed is renamed **Audited** ($149), for the reason in section 6.
- **Affiliates** (2026-11-07): one flat rate, 20% of subscription revenue, for 24 months. No tiers, no recruit bonus (`go-to-market.md` §3).
- **Firms in Stage A** (2026-11-07): about 5 firms as co-design partners; Practice in Stage B; Practice Pro after about 100 paying clients across firms (`go-to-market.md` §2).

### Open

1. **Payer identity and erasure on receipts (blocks the wedge).** State programs need who paid and per-child lines; signed receipts hold no personal data today, and erasure must not break them. Options: keep personal data out of hashed fields, or delete keys instead of editing events (`packages/atm/ROADMAP.md`, `packages/atm/docs/receipts.md`). Decide with the other receipt decisions there: key id format, refunds, disputes, when to seal.
2. **The paid line beyond Audited.** Whether daily Stripe matching or Rifo are paid-only.
3. **Final prices,** after experiment A.
4. **Discount stacking.** Whether the annual and non-profit discounts stack. Recommendation: they don't. The draft pricing page and the site's FAQ stack them today.
5. **The Witness API's free allowance.** The API is for platforms and issuers, not a cheap substitute for Audited for a single school. Whether the first 500 receipts a month stay free, and for whom (`pricing-strategy.md` §4).
6. **Accountants and cash.** Whether accountants stay cash-free, or get cash with the Idaho and Utah disclosures (`go-to-market.md` §4).
7. **Firm program prices:** Practice, Practice Pro, wholesale per plan, and the firm client discount (20% for the first year is a placeholder).
8. **The implementer program** (proposed, `go-to-market.md` 3.6): whether to run it, and its terms.
9. **Confirm the launch order** after the beachhead (section 4, from `market-research.md` 6.9).
10. **Income outside Stripe.** How tfd books ESA payouts and other non-Stripe income (a new event source or a manual entry), and how such income shows on receipts.
11. **Sales tax** on Trifold's SaaS: which states first, and whether prices show "plus applicable tax" (`website-open-questions.md` 5.8).
12. **Licensing items,** listed in `AGENTS.md` ("Open licensing items"): the licensor entity name, a grant for firms hosting tfd for many clients (before the Practice tier), the license of the envelope and KPI schemas, and of other Trifold code.
13. **Claims:** one claim ladder for all copy (`website-open-questions.md` 4.1), and whether "triple-entry" may ever be used (`AGENTS.md`).
