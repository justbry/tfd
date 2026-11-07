# Trifold go-to-market: design partners, channels, the firm program and referrals

Status: draft, 2026-11-07; review fixes and owner decisions applied the same day. Every price and rate here is an assumption to test with design partners, unless marked as the owner's decision. Nothing in this doc is built; the engine pieces it reuses (`tfd share`, credits, organizations) are noted where they exist. The phases, metrics and experiments are in `business-plan.md` §7 and §11; prices are in `pricing-strategy.md`; open decisions are in `business-plan.md` §12. This doc covers who brings customers to Trifold, and what they get for it.

**Market** (owner's decision, 2026-11-07): any business that bills through Stripe, in the whole US and in each English-speaking country, with a focus on schools, co-ops and churches. Idaho and Utah are the first beachhead (the wedge), not the whole market, so the first design partners and Stage A outreach start there. The launch order after that is in `business-plan.md` §4. Accounting firms are a key enabler and channel from the start.

## 0. The first design partners

**Who.** 10 organizations across schools, co-ops and churches, plus about 5 accounting firms (owner's decision, 2026-11-07). Each organization:
- has about 10–150 families or members (for a church, giving households);
- bills or takes giving through Stripe;
- uses a bookkeeper or CPA.

Lead with microschools in Idaho and Utah, where the compliance pack is the wedge. B4 Uni and Vibes of Light are related parties: they don't count toward the 10 (`website-open-questions.md` 4.4).

**Sourcing.** A named list of about 30 organizations, built from state program provider lists, education-choice groups, and 2–3 school networks or co-ops. About 5 CPA or bookkeeping firms that serve them.

**The offer.** Free hosted setup (Trifold runs tfd for them, by hand until the cloud exists). In return the organization:
1. issues real receipts within 30 days;
2. gives two interviews;
3. signs a testimonial clause (signed consent, with any connection disclosed; `website-open-questions.md` 4.5);
4. has a price conversation at day 60.

Firms get the Listed tier (§2) for free, with a written agreement on request (`pricing-strategy.md` §4c, option D).

**Exit test (day 90).** At least 5 of 10 issue receipts. At least 3 say they'd pay (this feeds experiment A, `business-plan.md` §11). At least 1 CPA has verified a receipt. If it fails, see the phase 0 trigger in `business-plan.md` §7.

## 1. Channels, by stage

| Stage | When | Channels |
|---|---|---|
| **A** | Months 0–6 | Founder-led direct outreach; about 5 firms as co-design partners (Listed, plus a written agreement on request); school networks and co-ops, each as one partner; schools refer schools |
| **B** | Months 6–12 | Bookkeepers and CPAs on Listed and Practice |
| **C** | After about 20 paying schools | Community affiliates; then Practice Pro (after about 100 paying clients across firms); vertical software, the Witness API and implementers (after the witness ships) |

The Stripe App is deferred to phase 2 (`business-plan.md` §7).

| Channel | Who | What they get | Stage | Section |
|---|---|---|---|---|
| Founder-led outreach | The named list (§0) | The design-partner offer | A | 0 |
| Accounting firms | CPAs, enrolled agents, bookkeepers, tax preparers | No cash; free seats, client discounts, the firm tiers | Listed in A; Practice in B; Practice Pro in C | 2, 3.3 |
| Networks and co-ops | Microschool networks, homeschool and member co-ops | One partner each; member schools join through sub-links | A | 3.4 |
| Schools referring schools | Paying schools | Account credit | A | 3.2 |
| Receipts | Every family that pays a Trifold school | Nothing: each receipt carries a verify link (a hypothesis to measure, `business-plan.md` §7) | From the first receipt | — |
| Community affiliates | Consultants, homeschool and ed-tech creators, Stripe developers | 20% for 24 months | C | 3.1 |
| Implementers | Integrators and consultants who set up Trifold | Proposed: referral pay, leads, a marketplace | C | 3.6 |
| Vertical software | Jackrabbit-, Pike13- and Mindbody-style tools | A revenue-share contract under Platform / Witness API | C | `pricing-strategy.md` §4 |

## 2. The firm program ("Trifold for Firms")

**Ships:** Listed in Stage A; Practice in Stage B; Practice Pro in Stage C.

The program borrows GoHighLevel's agency and reseller mechanics only: the agency becomes the vendor. It sets the price, owns the client relationship, earns the markup, and starts each client from a template. It doesn't borrow the get-rich-quick culture around them (3.4 and §5). Firms resell **hosted** Trifold. Self-hosting tfd for many clients remains a Competing Use under the FSL (`pricing-strategy.md` §4c, options A and D), and this program is option D made public.

### What carries over from GoHighLevel

| GoHighLevel | Trifold | Built today? |
|---|---|---|
| Agency account | **Firm account** over many client books (organizations) | Planned for the Platform tier (unlimited organizations with consolidation) |
| Sub-account | One client's books: ledger, receipts, seals | Yes, one ledger per school |
| Snapshot (template) | **Books template** per vertical: menu (`menu.v1`), policy (`policy.v1`), KPI dashboard specs, close checklist, Rifo rules | Partly: the five demo orgs are nearly templates |
| SaaS Mode | **Practice Pro**: the firm sets its prices; clients check out through the firm's Stripe (Connect); Trifold bills the firm wholesale per client | No |
| Agency Wallet and markup | **Firm credit wallet**: Rifo credits and witness signatures bought wholesale, re-billed with the firm's markup | The engine is a credit system already |
| Reseller payouts | Revenue-share statements | `tfd share` exists |
| White-label app | Firm domain, logo and colors on the portal and dashboards (Practice Pro only) | No (`plans/atm-ontology/dashboards.md`) |

**White label only through Practice Pro, and never on the receipt link or the witness badge.** Every receipt keeps its verify link, and every countersigned record keeps "Witnessed by Trifold" (`TRADEMARKS.md`). Firms brand everything except the evidence.

### Firm tiers

Ranked by active paying clients, like Xero's partner tiers.

| Tier | Unlocked at | Firm pays | What it gets |
|---|---|---|---|
| **Listed** | 1 active client | $0 | Free firm seats on every client's books; clients get 20% off their first year; directory listing. Clients pay Trifold directly |
| **Practice** | 5 active clients | $99/mo + **30% off** each client's plan (like QuickBooks' ProAdvisor discount) | One firm bill, a dashboard across clients, books templates, Rifo closing months in a batch (Next) |
| **Practice Pro** | 15 active clients, or pay to unlock | $399/mo + wholesale per client (e.g. Pro $49; Audited $99 once the witness ships) | The firm's own prices and checkout, branded portal, credit re-billing with markup, client books created from a template on payment, branded verify page (link and badge kept) |

**Example:** a firm with 30 schools on Practice Pro charges each $300/mo for bookkeeping plus software. At an average wholesale of about $55 a client (mostly Pro at $49, a few Audited at $99), Trifold earns about 30 × $55 + $399 ≈ **$2,050/mo** with no sales cost. Selling direct would earn about $1,800 at the realized ~$60 a school ($2,280 at the $76 list mix), and Trifold would have to win all 30 itself. The firm keeps about $7,000/mo for its labor. This is the Audited + Bookkeeper bundle (~$349) turned into a program any vetted firm can run.

### Build order

1. Firm account over many organizations.
2. Wholesale billing and the dashboard across clients.
3. Books templates.
4. Stripe Connect checkout and credit-wallet re-billing (the engine and `tfd share` do most of the math).
5. White-label portal.

## 3. Referrals

**Ships:** schools referring schools and network partners in Stage A; affiliates in Stage C.

GoHighLevel pays **40% for as long as the customer pays**, plus **5% of the sales of affiliates you recruit**, with a 90-day last-click cookie and monthly Net-30 payouts over $50. Accounting vendors pay much less: Xero doesn't publish a rate (listings show 10% for 6 months, or $160 flat), and QuickBooks pays up to 10% with a 30-day cookie. Neither pays CPAs in cash; they pay through discounts and tiers.

Trifold changes three things:
- **Cash lasts 24 months** (owner's decision, 2026-11-07; it was 12 in the first draft), matching the FSL's two years, so the company has one number for how long its protections last. 40% for life is about $30 a month per school forever, at the ~$76 list mix.
- **There is no second tier** (3.4).
- **Accountants get no cash** (§4).

### 3.1 Community affiliates (cash)

**One flat rate: 20% of subscription revenue for 24 months** (owner's decision, 2026-11-07). No rate tiers. Every affiliate gets a link, a referral code and a dashboard. The referred school gets 20% off its first 3 months.

The cost is bounded at 20% × 24 = 4.8 months of a school's revenue: about $290 at the realized ~$60 a month. There is no lifetime liability. If a school stays 3 years, that is about 13% of its revenue.

### 3.2 Schools referring schools (credit)

**Give a month, get a month**, as account credit, never cash, capped at 12 months. Every school already has a code, and no signup is needed. Microschools know each other.

### 3.3 Accountants and bookkeepers (no cash)

They climb the firm tiers in §2. Trifold pays tax preparers no referral fees, and says so in the partner directory. The firm earns from its own markup, not from a fee Trifold pays, so the rule holds. Idaho and Utah would allow a disclosed fee (§4), so the rule is a choice stricter than the law.

### 3.4 Recruiting without a second tier

GoHighLevel's 5% second tier pays for building a downline. The FTC's guidance on multi-level marketing treats pay driven by recruitment rather than sales to real customers as the warning sign, and a trust brand can't carry the look. What a second tier is really for is "my network brings schools and I get credit". These give that without a downline:

1. **Organization partners instead of downlines.** A co-op, microschool network or consulting firm joins as **one partner**. Each staff member or member school gets a sub-link, and all their sales count toward the organization. The organization splits any payout internally if it wants. Trifold pays one party per sale. In Stage A a network earns referral credit; cash affiliate terms (3.1) start in Stage C.
2. **Pay comes only from paying schools you brought.** Recruiting other affiliates earns nothing.
3. **Published anti-MLM rules:**
   - free to join, no purchase required, no paid ranks;
   - commission only on subscriptions customers actually paid for, never on affiliate signups or fees;
   - no income claims; affiliates disclose their commission (FTC endorsement guides);
   - the 24-month cap means nobody earns forever from other people's work.

### 3.5 Mechanics

| Term | Rule | Why |
|---|---|---|
| What counts | Subscriptions and compliance packs | Credits and metered API use are excluded; they are easy to game |
| Attribution | 90-day cookie, last click wins, **plus a referral code at checkout** | Schools often sign up after a conversation, not a click |
| Payout | Monthly, **after the 30-day refund window**, $50 minimum, Stripe Connect; 1099-NEC above the IRS threshold | Refunds and disputes take the commission back |
| Downgrade or refund | Commission follows what was actually paid | As GoHighLevel does |
| Banned | Bidding on "Trifold" in search ads, coupon sites, self-referral, income claims, breaking the claim rules (no "triple-entry", no "we file your taxes") | Protects the trust brand |
| Review | Manual approval of an affiliate's first 3 customers | Stops fraud early |

**Run on tfd.** The engine already models revenue share as events: `share.accrued` when a payment earns a share, `share.reversed` on a refund or dispute, then `share.charged` and `share.settled` when it is paid. `tfd share` prints each referrer's monthly statement. Trifold's affiliate ledger is therefore a Trifold ledger, with signed receipts for affiliates and payouts reconciled against Stripe Connect. The organization sub-link is a dimension on `share.accrued`. Because each payment earns at most one share, the ledger stays as simple as the rule.

### 3.6 Implementers and integrators (proposed, Stage C)

A proposal, not a decision (`business-plan.md` §12).

- **Tiers:** Registered, Certified and Premier, by clients sourced and serviced, and by certified staff. Leads go to Certified and above.
- **Certification** is built on the scenario fixtures and the receipt test vectors.
- **Pay:** 20% for 24 months on hosted clients they source, under 3.5. No commission on API or credit use.
- **Marketplace** for books templates, dashboard specs and mappings.
- **Integration bounties,** under the CLA (`CONTRIBUTING.md`).
- **Deal registration** for 90 days.
- **Limits:** no multi-client hosting of tfd (hosted Trifold only); white label only through Practice Pro; the school owns its data; a CPA implementer who takes pay follows §4's disclosure rules.
- **The name** "Trifold Certified Implementer" only for certified partners, and revocable (`TRADEMARKS.md`).

## 4. Paying accountants: what Idaho and Utah allow

Both beachhead states allow a CPA to take a commission or a referral fee, except from a client the CPA audits, reviews or compiles for. The fee must be disclosed. So Trifold's "no referral fees to tax preparers" rule is **a choice stricter than the law**, not a legal requirement.

| | Idaho (Code §54-218; IDAPA 24.30.01.200) | Utah (Code §58-26a-502) |
|---|---|---|
| Commission banned when the CPA or firm also does this for the same client | An attest service, or a compilation a third party will use that does not disclose a lack of independence | An audit or review; a compilation a third party will use that does not disclose a lack of independence; an examination of prospective financial information |
| How long the ban lasts | During the engagement, plus the period the statements cover | Same |
| Otherwise | Allowed. Disclosure must be **in writing, clear and conspicuous, stating the amount or its basis**, made **before** the referral, or before the client retains the referred licensee | Allowed. A commission is disclosed to the person referred; a referral fee is disclosed to the client |
| Also | No contingent fee for preparing a tax return | Same |

**If Trifold ever pays CPAs cash,** the partner would confirm "no attest or compilation work for this client", and Trifold would generate the written disclosure (amount, basis and timing). Keeping accountants on non-cash rewards (3.3) avoids this and keeps their independence clean.

**Not checked:**
- enrolled agents, who fall under the IRS's Circular 230, not state boards;
- other states and countries (Florida's statute is stricter). Check each before recruiting firms there;
- the AICPA code's own wording (Rule 1.520).

A lawyer reviews the affiliate terms, the disclosures and the FTC wording before launch.

## 5. Risks

| Risk | How it's handled |
|---|---|
| Firms compete with direct sales (a firm undercuts $79 Pro) | Wholesale stays above cost; firms sell service plus software, not cheaper software; one published direct price |
| White label hides the brand | Only Practice Pro; the receipt link and witness badge can't be removed; "Powered by Trifold" on the verify page |
| GoHighLevel's reputation for get-rich-quick reselling | Vet firms (CPA, enrolled agent or bookkeeper credentials); binding terms; no income claims |
| A departing firm takes 50 clients | The school owns its books and export is never paywalled; a client can move to direct Trifold or another firm with its ledger intact |
| Student and donor data (FERPA, state laws) | A data agreement per firm; a firm sees only the roles the organization grants |
| Support load | The firm handles first-line support, as GoHighLevel agencies do; Trifold supports the firm |
| Affiliate fraud | Manual review of each affiliate's first customers; payout only after the refund window; no self-referral |

## Sources

- GoHighLevel: [SetSmart, white label and SaaS Mode](https://setsmart.io/blog/gohighlevel-white-label); [OneExpand, affiliate program](https://oneexpand.com/gohighlevel-affiliate-program/); [RevenueGeeks, affiliate program](https://revenuegeeks.com/guides/gohighlevel-affiliate-program). These are third-party guides; confirm against HighLevel's own terms.
- [Intuit: ProAdvisor Preferred Pricing](https://quickbooks.intuit.com/accountants/products-solutions/pricing-promotions/wholesale-discounts/); [Xero partner terms](https://www.xero.com/us/about/legal/partner-agreement); [Xero affiliate program](https://www.xero.com/affiliate-program/).
- [Idaho Code §54-218](https://legislature.idaho.gov/statutesrules/idstat/Title54/T54CH2/SECT54-218); [IDAPA 24.30.01, Idaho Accountancy Rules](https://files.dfm.idaho.gov/dfm-admin-website/rules/current/24/243001.pdf) (section 200, dated 3-28-23).
- [Utah Code 58-26a Part 5](https://le.utah.gov/xcode/Title58/Chapter26A/C58-26a-P5_1800010118000101.pdf) (§58-26a-502, last amended 2008).
- [FTC: business guidance concerning multi-level marketing](https://www.ftc.gov/business-guidance/resources/business-guidance-concerning-multi-level-marketing).
