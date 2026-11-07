# Trifold go-to-market: channels, the firm program and referrals

Status: draft, 2026-11-07. Every price and rate here is an assumption to test with design partners, not a decision. The phases and growth loops are in `business-plan.md` §7; prices are in `pricing-strategy.md`. This doc covers who brings schools to Trifold, and what they get for it.

## 1. Channels

| Channel | Who | What they get | Section |
|---|---|---|---|
| Receipts | Every family that pays a Trifold school | Nothing: each receipt carries a "Verify at trifold…" link (growth loop 1) | `business-plan.md` §7 |
| Schools referring schools | Paying schools | Account credit | 3.2 |
| Community affiliates | Microschool consultants, co-ops and networks, homeschool and ed-tech creators, Stripe developers | Cash commission, limited to 24 months | 3.1 |
| Accountants and bookkeepers | CPAs, enrolled agents, bookkeepers, tax preparers | No cash; client discounts, free seats, the firm program | 2, 3.3 |
| Vertical software | Jackrabbit-, Pike13- and Mindbody-style tools | A revenue-share contract under Platform / Witness API (not covered here) | `pricing-strategy.md` §4 |

## 2. The firm program ("Trifold for Firms")

Modelled on GoHighLevel's agency model: the agency becomes the vendor. It sets the price, owns the client relationship, earns the markup, and starts each client from a template. The difference here is that firms resell **hosted** Trifold. Self-hosting tfd for many clients remains a Competing Use under the FSL (`pricing-strategy.md` §4c, options A and D), and this program is option D made public.

### What carries over from GoHighLevel

| GoHighLevel | Trifold | Built today? |
|---|---|---|
| Agency account | **Firm account** over many client books (organizations) | Planned for the Platform tier (unlimited organizations with consolidation) |
| Sub-account | One client's books: ledger, receipts, seals | Yes, one ledger per school |
| Snapshot (template) | **Books template** per vertical: menu (`menu.v1`), policy (`policy.v1`), KPI dashboard specs, close checklist, Rifo rules | Partly: the five demo orgs are nearly templates |
| SaaS Mode | **Practice Pro**: the firm sets its prices; clients check out through the firm's Stripe (Connect); Trifold bills the firm wholesale per client | No |
| Agency Wallet and markup | **Firm credit wallet**: Rifo credits and witness signatures bought wholesale, re-billed with the firm's markup | The engine is a credit system already |
| Reseller payouts | Revenue-share statements | `tfd share` exists |
| White-label app | Firm domain, logo and colors on the portal and dashboards | No (`plans/atm-ontology/dashboards.md`) |

**White label stops at the proof.** Every receipt keeps its "Verify at trifold…" link, and every witnessed record keeps "Witnessed by Trifold" (`TRADEMARKS.md`). Firms brand everything except the evidence. This protects moat #1 (the witness) and growth loop 1.

### Firm tiers

Tiers are ranked by active paying clients, like Xero's partner tiers.

| Tier | Unlocked at | Firm pays | What it gets |
|---|---|---|---|
| **Listed** | 1 active client | $0 | Free firm seats on every client's books; clients get 20% off their first year; directory listing. Clients pay Trifold directly |
| **Practice** | 5 active clients | $99/mo + **30% off** each client's plan (like QuickBooks' ProAdvisor discount) | One firm bill, a dashboard across clients, books templates, Rifo closing months in a batch |
| **Practice Pro** | 15 active clients, or pay to unlock | $399/mo + wholesale per client (e.g. Pro $49, Witnessed $99) | The firm's own prices and checkout, branded portal, credit re-billing with markup, client books created from a template on payment, white-label verify page (badge kept) |

**Example:** a firm with 30 schools on Practice Pro charges each $300/mo for bookkeeping plus software. Trifold earns about 30 × $55 + $399 ≈ **$2,050/mo** with no sales cost. Selling direct at about $76 a school would earn ≈ $2,280, but Trifold would have to win all 30 itself. The firm keeps ≈ $7,000/mo for its labor. This is the Witnessed + Bookkeeper bundle (~$349) turned into a program any vetted firm can run.

### Build order

1. Firm account over many organizations.
2. Wholesale billing and the dashboard across clients.
3. Books templates.
4. Stripe Connect checkout and credit-wallet re-billing (the engine and `tfd share` do most of the math).
5. White-label portal.

## 3. Referrals

GoHighLevel pays **40% for as long as the customer pays**, plus **5% of the sales of affiliates you recruit**, with a 90-day last-click cookie and monthly Net-30 payouts over $50. Accounting vendors pay much less: Xero doesn't publish a rate (listings show 10% for 6 months, or $160 flat), and QuickBooks pays up to 10% with a 30-day cookie. Neither pays CPAs in cash; they pay through discounts and tiers.

Trifold changes three things:
- **Cash is limited to 24 months,** matching the FSL's two years: a referral earns while the release it was sold on is still Trifold's to license. 40% for life is about $30 a month per school forever, at a ~$76 average.
- **There is no second tier** (3.4).
- **Accountants get no cash** (section 4).

### 3.1 Community affiliates (cash)

The tier is recalculated monthly from the **paying schools the affiliate referred personally that are still active**. Churn lowers it.

| Tier | Active schools referred | Commission | Extras |
|---|---|---|---|
| **Affiliate** | 0–4 | 25% of subscription revenue × 24 months | Link, referral code, dashboard |
| **Partner** | 5–19 | 30% × 24 months | Demo account, co-marketing kit, directory listing |
| **Ambassador** | 20+ | 35% × 24 months | Early access, featured on the site, quarterly call |

The cost is bounded at 35% × 24 ≈ 8.4 months of a school's revenue (about $640 at $76/mo), and there is no lifetime liability. If a school stays 3 years, that is about 23% of its revenue. The referred school gets 20% off its first 3 months.

### 3.2 Schools referring schools (credit)

**Give a month, get a month**, as account credit, never cash, capped at 12 months. Every school already has a code, and no signup is needed. Microschools know each other.

### 3.3 Accountants and bookkeepers (no cash)

They climb the firm tiers in section 2. The firm earns from its own markup, not from a fee Trifold pays, so the no-referral-fee rule (`pricing-strategy.md` §4c) holds.

### 3.4 Recruiting without a second tier

GoHighLevel's 5% second tier pays for building a downline. The FTC's guidance on multi-level marketing treats pay driven by recruitment rather than sales to real customers as the warning sign, and a trust brand can't carry the look. What a second tier is really for is "my network brings schools and I get credit". These give that without a downline:

1. **Organization affiliates instead of downlines.** A co-op, microschool network or consulting firm joins as **one affiliate**. Each staff member or member school gets a sub-link, and all their sales count toward the organization's tier and payout. The organization splits the payout internally if it wants. Trifold pays one party per sale.
2. **Tiers count only your own referrals.** Recruiting affiliates never raises your rate or tier; only paying schools you brought do.
3. **Optional: a one-time recruit bonus, capped and tied to a real customer.** $50 when an affiliate you invited lands their first school that has paid for 3 months, at most 10 a year. There is no override and no percentage of their sales. Leave it out if even this looks wrong.
4. **Published anti-MLM rules:**
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

## 4. Paying accountants: what Idaho and Utah allow

Both first-market states allow a CPA to take a commission or a referral fee, except from a client the CPA audits, reviews or compiles for. The fee must be disclosed. So Trifold's "no referral fees to tax preparers" rule is **a choice stricter than the law**, not a legal requirement.

| | Idaho (Code §54-218; IDAPA 24.30.01.200) | Utah (Code §58-26a-502) |
|---|---|---|
| Commission banned when the CPA or firm also does this for the same client | An attest service, or a compilation a third party will use that does not disclose a lack of independence | An audit or review; a compilation a third party will use that does not disclose a lack of independence; an examination of prospective financial information |
| How long the ban lasts | During the engagement, plus the period the statements cover | Same |
| Otherwise | Allowed. Disclosure must be **in writing, clear and conspicuous, stating the amount or its basis**, made **before** the referral, or before the client retains the referred licensee | Allowed. A commission is disclosed to the person referred; a referral fee is disclosed to the client |
| Also | No contingent fee for preparing a tax return | Same |

**If Trifold ever pays CPAs cash,** the partner would confirm "no attest or compilation work for this client", and Trifold would generate the written disclosure (amount, basis and timing). Keeping accountants on non-cash rewards (3.3) avoids this and keeps their independence clean.

**Not checked:**
- enrolled agents, who fall under the IRS's Circular 230, not state boards;
- states beyond Idaho and Utah (Florida's statute is stricter);
- the AICPA code's own wording (Rule 1.520).

A lawyer reviews the affiliate terms, the disclosures and the FTC wording before launch.

## 5. Risks

| Risk | How it's handled |
|---|---|
| Firms compete with direct sales (a firm undercuts $79 Pro) | Wholesale stays above cost; firms sell service plus software, not cheaper software; one published direct price |
| White label hides the brand | The receipt link and witness badge can't be removed; "Powered by Trifold" on the verify page |
| GoHighLevel's reputation for get-rich-quick reselling | Vet firms (CPA, enrolled agent or bookkeeper credentials); binding terms; no income claims |
| A departing firm takes 50 clients | The school owns its books and export is never paywalled; a client can move to direct Trifold or another firm with its ledger intact |
| Student data (FERPA, state laws) | A data agreement per firm; a firm sees only the roles the school grants |
| Support load | The firm handles first-line support, as GoHighLevel agencies do; Trifold supports the firm |
| Affiliate fraud | Manual review of each affiliate's first customers; payout only after the refund window; no self-referral |

## 6. Open decisions

1. Rates and tier thresholds, after design-partner tests.
2. Whether to offer the one-time recruit bonus (3.4, item 3), or nothing at all.
3. Whether accountants stay cash-free, or get cash with the Idaho and Utah disclosures (section 4).
4. Practice and Practice Pro prices, and wholesale per plan.
5. Which program ships first. The referral program needs little engineering (codes, `tfd share`, Stripe Connect payouts). The firm program needs firm accounts and wholesale billing.

## Sources

- GoHighLevel: [SetSmart, white label and SaaS Mode](https://setsmart.io/blog/gohighlevel-white-label); [OneExpand, affiliate program](https://oneexpand.com/gohighlevel-affiliate-program/); [RevenueGeeks, affiliate program](https://revenuegeeks.com/guides/gohighlevel-affiliate-program). These are third-party guides; confirm against HighLevel's own terms.
- [Intuit: ProAdvisor Preferred Pricing](https://quickbooks.intuit.com/accountants/products-solutions/pricing-promotions/wholesale-discounts/); [Xero partner terms](https://www.xero.com/us/about/legal/partner-agreement); [Xero affiliate program](https://www.xero.com/affiliate-program/).
- [Idaho Code §54-218](https://legislature.idaho.gov/statutesrules/idstat/Title54/T54CH2/SECT54-218); [IDAPA 24.30.01, Idaho Accountancy Rules](https://files.dfm.idaho.gov/dfm-admin-website/rules/current/24/243001.pdf) (section 200, dated 3-28-23).
- [Utah Code 58-26a Part 5](https://le.utah.gov/xcode/Title58/Chapter26A/C58-26a-P5_1800010118000101.pdf) (§58-26a-502, last amended 2008).
- [FTC: business guidance concerning multi-level marketing](https://www.ftc.gov/business-guidance/resources/business-guidance-concerning-multi-level-marketing).
