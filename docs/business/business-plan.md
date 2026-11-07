# Trifold business plan

Status: draft, 2026-11-06; checked against the other docs and the code on 2026-11-07. Prices and projections are assumptions to test, not decisions. The repository is `justbry/tfd` since 2026-11-07; old releases and PRs up to #145 stay on `justbry/atm`, so PR numbers above #100 here are `justbry/atm` PRs.

Detail lives in the companion docs in this folder:

| Doc | What's in it |
|---|---|
| `pricing-strategy.md` | Tiers, pricing units, credits, features by tier, the license comparison |
| `market-research.md` | Competitor prices with sources, the first market, research gaps |
| `financial-model.md` | How to model 1–3 years with tfd's scenario generator, what it lacks, and how to add expenses |
| `go-to-market.md` | Channels, the firm program ("Trifold for Firms"), referral and affiliate tiers, what Idaho and Utah allow when paying accountants |
| `website-open-questions.md` | What must be decided or researched before the website can be built and launched |
| `pricing-page.html` | A self-contained draft of the pricing page; the site's `apps/trifold-site/src/lib/pricing/data.ts` is the current version |
| `../brand/trifold-brand-and-messaging.md` | Names, voice, website outline, customer profiles |
| `../website/` | The website's messaging, sitemap, brand guide, competitor research and decisions log |
| `../../AGENTS.md`, `../../LICENSING.md`, `../../TRADEMARKS.md`, `../../CONTRIBUTING.md` | The decided names, licenses, claim rules, trademark policy (draft) and the CLA |

## 1. Summary

**Trifold** is the company and the managed service. **tfd** is the engine and its CLI (the `atm` command until the rename lands). tfd keeps the books for small businesses that bill through Stripe (memberships, usage, paid bookings, add-ons), and Trifold will host it for them. tfd builds the books from the payment events themselves. It signs a receipt for every payment, for the customer to keep, and seals every closed month. Anyone can verify both with an open, free verifier.

What exists today (section 3): the engine and CLI, released as 0.10.0 on 2026-11-07 (tag `atm-v0.10.0` on `justbry/atm`), with signed receipts and sealed months. The hosted service, Rifo and the witness are not built. No school issues signed receipts to families yet.

The business is **source-available**, with an open format:
- The receipt and seal format and the verifier are Apache-2.0. Anyone can check, forever.
- The tfd engine is free to self-host under FSL-1.1-ALv2, and each release becomes Apache-2.0 two years after it ships (section 5).
- Customers pay for the hosted service, the Rifo agent, automation, and **Trifold acting as an independent witness**, the premium tier.

The first market is microschools in Idaho and Utah (the working default; section 12, item 3). Families in state education programs need payment records that hold up. B4 Uni's family service (buzz-school) already uses released tfd versions as a pinned dependency, though it doesn't yet call the engine's handler, shipper or receipts (`packages/atm/ROADMAP.md`). B4 Uni and Vibes of Light are the owner's own or related businesses, so they count as design partners, not independent customers (`website-open-questions.md` 4.4).

## 2. Problem

- Small membership and booking businesses run on Stripe, spreadsheets and a bookkeeper. Closing a month is manual and slow.
- The books can be changed quietly, and nobody outside can tell.
- Families get a Stripe email, not a receipt that proves anything to a state program, an auditor or a court.
- Accounting software is getting more expensive. QuickBooks, Xero and FreshBooks all raised prices in 2026; QuickBooks caps users at every tier (`market-research.md`).

## 3. Solution

| Piece | What it does | Status |
|---|---|---|
| Books from events | Every Stripe event and booking becomes a ledger event, then a journal, reports and an on-demand Stripe reconciliation (`tfd reconcile`) | Released (tfd 0.10.0, 2026-11-07, and earlier) |
| Signed receipts | Ed25519 receipt per payment and refund; regenerated from the books, so an edit shows; `tfd receipt`, `tfd verify receipt` | Released in tfd 0.10.0 (milestone 1, `justbry/atm` #123 and #137). Not yet issued by any school |
| Sealed months | A signed, chained seal per closed month; `tfd seal`, `tfd verify seals` | Released in tfd 0.10.0 (milestone 1). Not yet run by any school |
| Verifier SDK | `tfd-verify`: the receipt and seal checks for browsers, Apache-2.0 | Built on the branch with PR #32; not published to npm |
| Website | `apps/trifold-site`, with an in-browser verifier from `tfd-verify` | Preview at `tfd-ledger.pages.dev`; no real domain yet |
| Pricing what-ifs | `tfd simulate`: replay the books under new prices | Released (since 0.6.0). The paid Pricing Lab is not built |
| MRR in the books | `mrr.changed` events and MRR KPIs | Merged on `dev`, not released |
| Hosted service (cloud Free, Starter, Pro) | Trifold runs tfd for a business | Not built |
| Rifo | Agent that closes the month and answers questions | Not built (Next) |
| Per-event chain | Hash chain over every event in the webhook transaction | Not built (milestone 2) |
| Daily Stripe matching | Events matched to Stripe's balance transactions every day | Not built (milestone 3) |
| Trifold witness | Trifold countersigns receipts and seals and logs them in a public transparency log | Not built (Next, premium) |
| Tax packages | Year-end packages for a CPA | Not built (Later) |

**Claim rule.** Say "signed receipts and sealed books" until milestones 2 and 3 ship. Never say "triple-entry accounting" for Trifold. Say that tfd signs receipts and seals months, not that schools or families use them, until a school issues real receipts (`website-open-questions.md` 4.2). Rifo, the witness, daily matching and tax packages are never described as shipped.

## 4. Customers

**First:** microschools and small private schools (about 10–150 families) that bill through Stripe, starting in Idaho and Utah.

**Next:** businesses with the same shape (memberships, credits, bookings): studios, tutoring, camps, gyms.

**Channels:**
- CPAs and bookkeepers, who get free auditor seats and a partner listing.
- Vertical software (Jackrabbit, Pike13 and Mindbody-style tools), which can embed Trifold through the Witness API.
- Developers, through the `tfd` CLI and a Stripe App.

Customer profiles and messaging: `../brand/trifold-brand-and-messaging.md`.

## 5. Product and licensing

The rule: **anything a school can do on its own is free to self-host. Anything that needs Trifold as the trusted third party is paid.**

Never paywalled: verification, data export, erasure and privacy tools, security fixes, the receipt format.

### Licensing

Decided by the owner on 2026-11-06. On 2026-11-07 the owner considered a three-year conversion and kept FSL with its fixed two years (three years would mean BUSL-1.1 with a custom grant, not FSL). tfd 0.10.0 (2026-11-07) is the first release under FSL; releases up to 0.9.0 stay Apache-2.0.

| Part | License |
|---|---|
| tfd engine and CLI (the `packages/atm` package, except the parts below) | **FSL-1.1-ALv2** (Functional Source License 1.1, Apache-2.0 future license). Source-available: free to use, modify and self-host for your own books, for non-commercial education and research, and for professional services to a licensee (for example an accountant working on a client's own install). Not allowed: offering it to others as a commercial product or service that competes with Trifold. **Each release becomes Apache-2.0 two years after it ships.** |
| Receipt and seal format, spec and verifier (the receipt and seal JSON schemas, `docs/receipts.md`, the receipt, seal, sign and canonicalisation code, and `tfd-verify`, the verifier package the website's in-browser check comes from) | **Apache-2.0** |
| The website (`apps/trifold-site`): code, copy, design (2026-11-07) | Proprietary; its verifier comes from the Apache-2.0 `tfd-verify` |
| Test vectors (golden receipt files) | **CC0-1.0** (public domain) |
| Autumn code this repo forks (`balance-engine`, `shared`, and so on) | **Apache-2.0**, the upstream license, unchanged |
| Hosted Trifold service, Rifo, the witness | Proprietary |

A trademark policy (`TRADEMARKS.md`, draft of 2026-11-07, for a lawyer to review) covers Trifold, Witnessed by Trifold, tfd, Rifo and the logo. None is registered; they take ™, never ®. Outside contributions need a CLA (decided 2026-11-07, `CONTRIBUTING.md`); none are accepted until its text is published.

**Why.** The promise is "anyone can check, forever." That only holds if checking (the verifier, the format and the vectors) can never be restricted, so those parts are Apache-2.0 or public domain. The engine is the part a cheap hosted clone would copy, so it carries a license that blocks that. Because each release becomes Apache-2.0 after two years, the durability promise has a backstop: even if Trifold disappears, the code becomes Apache-2.0.

**The moat.** The license is the weakest of the moats (section 9). It stops a vendor from reselling tfd as a competing hosted service for two years per release. What can't be copied is the witness network and its transparency log, the trademark, and Rifo.

**How FSL compares** (table in `pricing-strategy.md` section 8):
- BSL 1.1 is close, but each author sets their own usage grant and the conversion can take up to four years. FSL is a fixed, short text with a two-year conversion.
- Elastic License 2.0 bars managed services too, but it never converts to an open license.
- AGPL is OSI open source, but it lets a competitor host the engine if they publish their changes, and many company lawyers ban it. SSPL requires publishing the whole hosting stack, never converts, and is seen as hostile.

**Wording.** Never call the engine "open source"; FSL isn't OSI-approved. Say "source-available", "Fair Source" or "free to self-host". "Open standard", "open spec" and "open verifier" are fine, because those parts are Apache-2.0. "The verifier and receipt format are Apache-2.0" and "Every tfd release becomes Apache-2.0 two years after it ships" are fine to say.

## 6. Pricing

| Tier | Price | In one line |
|---|---|---|
| Community | $0, self-hosted | The whole engine and CLI |
| Free | $0 cloud | 1,000 events, 200 credits and 2 seats a month |
| Starter | $29 | Signed receipts on top of QuickBooks or Xero |
| Pro | $79 | Replaces QuickBooks: Pricing Lab, daily reconcile, Rifo, unlimited seats |
| Witnessed | $149 | Trifold as witness, auditor portal, transparency log |
| Witnessed + Bookkeeper | ~$349 | A partner bookkeeper closes the month on provable books |
| Compliance pack | $15–30 per state program | Itemised receipts for state programs |
| Platform / Witness API | Metered | For networks and vertical software |

Tiers are limited by ledger events per month, plus credits for AI and witness signatures. Storage and compute are included. Full rate card, credit prices and reasoning: `pricing-strategy.md`.

## 7. Go-to-market

Channels, the firm program and the referral program are in `go-to-market.md`.

The plan is built for adoption. Three loops spread the product:
1. **Receipts carry a "Verify at trifold…" link.** Every payment a family makes shows them the product.
2. **Others adopt the standard.** Every platform that issues receipts in the format extends the verifier's reach and can buy the Witness API.
3. **CPAs refer clients.** Free auditor seats bring them in.

| Phase | When | Goal | What ships | Proof it worked |
|---|---|---|---|---|
| 0. Foundations | Now to month 3 | A credible standard | Spec v1 in its own repo, test vectors, verifiers in three languages; license split; domains and trademark filings; 5–10 design-partner schools | Design partners issuing real receipts |
| 1. Wedge | Months 3–9 | Win microschools in Idaho and Utah | Cloud Free, Starter and Pro; CPA partner pilot; Stripe App | 100 schools on cloud, 20 paying, ~10 CPA partners |
| 2. Premium | Months 9–18 | Make Witnessed real | Milestones 2 and 3, transparency log, Witness API | Witnessed is 25%+ of paying schools; 3 outside issuers |
| 3. Expand | Month 18+ | Adjacent verticals and platforms | Studios, tutoring, camps, gyms; embedded deals; tfd Tax | Platform revenue; net retention above 110% |

## 8. Financial outlook (illustrative)

These are assumptions, not forecasts. `financial-model.md` describes how to run this through tfd's scenario generator and where it falls short.

**Assumed mix of paying schools:** 40% Starter, 35% Pro, 20% Witnessed, 5% bundle (counting only Trifold's ~$149 share of the bundle). That gives $76.50 a school per month in subscription ($11.60 + $27.65 + $29.80 + $7.45, from 0.40 × $29 + 0.35 × $79 + 0.20 × $149 + 0.05 × $149), plus a little credit-pack revenue that isn't recurring and is left out below (included credits are generous and overage is opt-in, so assume about $2–3). **Subscription revenue is about $76 a month per paying school** ($76.50 before rounding).

| | End of year 1 | End of year 2 | End of year 3 |
|---|---|---|---|
| Free cloud and self-hosted schools (adoption, not revenue) | 300 | 2,000 | 8,000 |
| Paying schools | 50 | 300 | 1,000 |
| Annual recurring revenue (paying × $76.50 × 12, before annual-billing discounts) | ~$46K ($45,900) | ~$275K ($275,400) | ~$918K ($918,000) |
| Platform and Witness API | — | small | 10–20% on top |

**Costs to model** (`financial-model.md`, "Expenses"):
- Stripe fees on Trifold's own revenue.
- AI tokens per credit used.
- Hosting: Workers and R2, small.
- Partner bookkeeper payouts on the bundle.
- Support.
- Legal: license, trademarks, witness terms, tax-prep partner contracts.
- People.

**Why schools upgrade:** for features (QuickBooks sync, Pricing Lab, Rifo, the witness), not limits. A family makes about 7 events a month, so Free's 1,000 events covers about 140 families.

**What would change the outlook most:** how many free schools convert to paid, whether Rifo can close a month reliably (that decides Witnessed's value), and how many platforms adopt the standard.

## 9. Moat, strongest first

1. The witness network and its transparency log. It can't be forked.
2. Owning the open standard.
3. The trademark.
4. Rifo and the workflows on top of the books.
5. The FSL license: it blocks a hosted clone of tfd for two years per release.

## 10. Risks

| Risk | How it's handled |
|---|---|
| A big vendor clones the engine and hosts it | FSL bars a competing hosted service for two years per release. The witness, the transparency log and the trademark can't be cloned. After two years a release is Apache-2.0, so the lead has to come from what Trifold ships next |
| License backlash | Low. The conversion date is public, the license text is standard, and checking (format, verifier, vectors) is Apache-2.0 or CC0 and can never be restricted. Decided now, while there's one author |
| A fork reuses the Trifold name | The trademark policy (`TRADEMARKS.md`, draft) covers Trifold, Witnessed by Trifold, tfd and Rifo; a fork must rename |
| Over-claiming | "Signed receipts and sealed books" until milestones 2 and 3 ship. "Triple-entry" is never used for Trifold, and no speed numbers are claimed |
| Tax preparation is regulated (paid preparers need an IRS PTIN) | File through licensed CPAs or enrolled agents; Trifold prepares the books, never signs returns |
| What the witness promises | Defined narrowly: "Trifold saw this exact record at time T," not "the money moved"; terms of service reviewed by a lawyer |
| Student data (FERPA, state privacy laws) | Checked per school type; personal data kept out of signed receipts, as it is today |
| Key compromise | Keys in a managed key service, a dated revocation list, old keys kept verifiable |
| Erasure breaks receipts | Owner decision before release (`packages/atm/ROADMAP.md`): keep personal data out of hashed fields, or delete keys instead of editing events |
| Trademark conflict | "Trifold" collides in search with the Samsung Galaxy Z TriFold, and old TRIFOLD filings exist (a dead class 9 application, a class 42 filing of unknown status). Clearance search for Trifold in classes 9, 36 and 42 before filing. The old name "atm" was too generic to register, and "tfd" needs the same check. The trademark protection sits on Trifold |
| Competitors' deep discounts | Compete with the free core and provable books, not on price |

## 11. Next 90 days

1. ~~Merge the brand kit and this plan.~~ Done (`justbry/atm` #121 and #140).
2. ~~Add the per-package license files and `TRADEMARKS.md`.~~ Done: `packages/atm/LICENSE.md` (FSL), `packages/verify/LICENSE` (Apache-2.0), `apps/trifold-site/LICENSE` (proprietary), `REUSE.toml`; `TRADEMARKS.md` is a draft (2026-11-07). Still to do: the CLA text (decided 2026-11-07, `CONTRIBUTING.md`) and a lawyer's review of it and of the trademark policy.
3. Register the domains (gettrifold.com was still unregistered on 2026-11-07); order a trademark clearance search.
4. Move the receipt and seal spec to its own repo with test vectors. Not done; the verifier is now its own package, `packages/verify`.
5. Recruit 5–10 design-partner schools; test prices with them.
6. Answer the open questions for the website, starting with its "decide first" list (`website-open-questions.md`).
7. Settle the open owner decisions in `packages/atm/ROADMAP.md`: erasure, key id format, refunds on receipts, disputes, when to seal.

## 12. Open decisions

1. ~~Engine license~~ **Decided 2026-11-06:** FSL-1.1-ALv2 for the engine; Apache-2.0 for the receipt and seal format, spec and verifier; CC0-1.0 for test vectors; proprietary for the hosted service, Rifo and the witness (section 5).
2. The paid line: is it only "Trifold as witness," or also Stripe matching or Rifo?
3. First market: microschools in Idaho and Utah, or broader membership businesses from the start. Idaho and Utah microschools are the working default in this plan, `go-to-market.md` and the website plan (`../website/decisions.md`).
4. Final prices, after design-partner tests.
5. Licensor legal entity name. The `LICENSE` says "Trifold" until a company is formed.
6. Whether accounting firms hosting tfd for many clients need an extra grant beyond FSL's "professional services" clause. Decide before the accountant partner program.
7. ~~Contributor terms~~ **Decided 2026-11-07:** a CLA (`CONTRIBUTING.md`); the text is adapted from the Apache ICLA and CCLA and reviewed by a lawyer before outside contributions are accepted.
8. Whether the event envelope schema should also be Apache-2.0, so other ledgers can adopt the full standard.
