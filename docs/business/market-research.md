# Trifold market research

Status: research notes, 2026-11-06; checked against `../website/competitors.md` on 2026-11-07. This collects the market data behind `pricing-strategy.md` and `business-plan.md` (both in this folder), and the market size (section 6, 2026-11-07). `../website/competitors.md` holds the competitor facts read from the vendors' own pages on 2026-11-06; where the two differ, the vendor page wins, and the rows below say so.

**How reliable the numbers are.** Most prices come from third-party aggregators, not from the vendors' own pages, and some sources disagree. Treat a figure as accurate to within a few dollars. Recheck the vendor's own page before publishing any comparison. Where sources conflict, the table gives the most recent figure and says so in a note.

## 1. Who Trifold competes with

Trifold sits between four groups. None of them offers books a third party can verify.

| Group | What customers buy it for | How it prices | Where Trifold fits |
|---|---|---|---|
| General accounting software | Books, invoices, tax-time reports | Flat tiers capped by users or features | Replace it for Stripe-native businesses (Pro), or feed it (Starter) |
| AI-native accounting | Books kept automatically, few seats | Flat tiers, no per-user fee | Same buyers. Trifold adds a source-available engine (free to self-host) and provable books |
| Bookkeeping services | Someone else closes the month | Monthly fee that rises with expenses | Audited + Bookkeeper bundle, sold through partners |
| Vertical software for schools and studios | Scheduling, enrollment, billing | Per student, or tiers | Partner and embed (Witness API). They run operations; Trifold keeps the books |

## 2. Prices, November 2026

### General accounting

| Product | Monthly list price | Notes | Source |
|---|---|---|---|
| QuickBooks Online | $38 / $85 / $140 / $340 | Simple Start, Essentials, Plus, Advanced. Raised for renewals from Aug 1 2026 (Essentials $75 to $85, Plus $115 to $140, Advanced $275 to $340). Hard user caps of 1 / 3 / 5 / 25. Payroll is extra. Introductory offers of about 50% off fade after a few months | [NerdWallet](https://www.nerdwallet.com/business/software/learn/quickbooks-pricing), [Dancing Numbers](https://www.dancingnumbers.com/how-much-is-quickbooks-online-per-month/) |
| Xero (US) | $27 / $59 / $97 | Early, Growing, Established, from Oct 1 2026 (were $25 / $55 / $90). Some aggregators show older, lower figures. Has run 90%-off-for-6-months offers | [Xero update](https://www.xero.com/us/pricing-plans/update/), [saascrmreview](https://saascrmreview.com/xero-review/) |
| FreshBooks | $23 / $43 / $70 | Raised Jan 27 2026 | [agentdeals](https://agentdeals.dev/accounting-software-pricing-2026) |
| Wave | Free / Pro $19 | Automatic bank imports moved from free to Pro | [agentdeals](https://agentdeals.dev/accounting-software-pricing-2026) |
| Zoho Books | Free (under $50K revenue) / Standard $15–20 | Free includes one user and one accountant seat | [agentdeals](https://agentdeals.dev/accounting-software-pricing-2026) |

### AI-native accounting

| Product | Monthly price | Notes | Source |
|---|---|---|---|
| Puzzle | $30 / $72 / $120 / $360 (Puzzle's page, 2026-11-06); aggregators show ~$25 / $60 | Starter, Core, Complete, Scale. The free Starter promotion ended Sep 2026. Core + Expert Reviewed is $171 (up to $10K monthly expenses) | [Puzzle pricing FAQ](https://help.puzzle.io/en/articles/8891734-faq-pricing), [usagepricing](https://www.usagepricing.com/blueprint/activity/puzzle-2026-09-20-promo-ends-free-starter-removed) |
| Digits | $65 / $100 / Pro ~$250 | Essentials, Core, Pro (quoted). No per-user fee. Firms get per-client rates | [Digits pricing](https://www.digits.com/pricing), [softwarefinder](https://softwarefinder.com/accounting-software/digits) |

### Bookkeeping services

| Product | Monthly price | Notes | Source |
|---|---|---|---|
| Pilot | Bookkeeping Essentials $99 (Pilot's page, 2026-11-06, up to $100K monthly expenses); aggregators show $199 entry and human-led $349–849+ | QuickBooks is required and billed separately (aggregators). Onboarding fee about one month. Tax from $1,000 a year; CFO from $1,750 a month | [Capterra](https://www.capterra.com/p/186313/Pilot/pricing/), [Eightx](https://eightx.co/blog/compare/how-much-does-pilot-cost) |

### Vertical software for schools, studios and tutoring

| Product | Monthly price | Notes | Source |
|---|---|---|---|
| Jackrabbit Class | $49–245 | **By student count** at month end (0–100, 101–250, 251–500, 501–1,000, more) | [Jackrabbit](https://www.jackrabbitclass.com/pricing), [G2](https://www.g2.com/products/jackrabbit-class/pricing) |
| Pike13 | $139–249 | Essential, Advanced, Premium. No annual billing | [Pike13](https://www.pike13.com/pricing) |
| Mindbody | ~$99–349+ | Payment processing and marketplace fees on top | [G2 compare](https://www.g2.com/compare/mindbody-vs-pike13) |
| Teachworks | $16.49 + $0.32 per student lesson | Tutoring and lesson businesses | [ustechautomations](https://ustechautomations.com/resources/blog/brightwheel-alternatives-for-tutoring-businesses-2026) |
| Brightwheel | Not public | Childcare. Card processing 2.9% + $0.30 | [pebbledesk](https://pebbledesk.pages.dev/compare/pricing/brightwheel) (a competitor's page) |

### Stripe

| Product | Price | Notes | Source |
|---|---|---|---|
| Stripe Billing | 0.7% of billing volume | Pay-as-you-go. Replaced the 0.5% and 0.8% tiers in 2024 | [Stripe support](https://support.stripe.com/questions/july-2024-changes-to-stripe-billing) |
| Stripe Revenue Recognition | 0.25% of volume | Whether it is still charged separately in 2026 is unconfirmed | [Stripe docs](https://docs.stripe.com/revenue-recognition/pricing) |

### Open-source accounting

| Product | License | Hosted price | Source |
|---|---|---|---|
| Akaunting | Open source | Self-host free; cloud $12 / $36 / $84 / $218 | [toolradar](https://toolradar.com/tools/akaunting/pricing) |
| Bigcapital | AGPL-3.0 | ~$20 | [gappsy](https://gappsy.com/tools/bigcapital/) |
| ERPNext / Frappe Cloud | GPL-3.0 (one source says MIT) | ~$10–50 per site (unconfirmed) | [ecosire](https://ecosire.com/blog/erpnext-pricing-explained-2026) |

### AI priced per outcome

| Product | Price | Source |
|---|---|---|
| Intercom Fin | $0.99 per resolution; $49/mo base with 50 resolutions when run on another help desk | [sitegpt](https://sitegpt.ai/blog/intercom-fin-ai-review) |

## 3. What the data says

1. **Prices are rising.** QuickBooks, Xero and FreshBooks all raised prices in 2026, and Puzzle dropped its free tier. A free core, a flat price and unlimited seats stand out right now.
2. **User caps hurt.** QuickBooks caps users at every tier, so a school that adds its CPA or a second admin has to upgrade. Unlimited seats is a selling point.
3. **This vertical prices per student.** Jackrabbit charges by student count and Teachworks per lesson, so owners understand per-student pricing. Trifold meters ledger events underneath but can say "for schools up to about 100 students" on its pricing page.
4. **Owners pay the most for having it done.** Human bookkeeping costs $349–849+ a month on aggregator figures, against $60–140 for software. The money is in closing the month, so Rifo's close and the bookkeeper bundle are where premium pricing works.
5. **Nobody offers provable books.** None of the products above offers signed receipts, sealed months or an independent witness. That's Trifold's opening, and the reason vertical tools are partners rather than competitors.
6. **Discounts are common.** Xero and QuickBooks lead with deep introductory offers. Trifold shouldn't race them on discounts; it competes with a free core and with provable books.

## 4. Why the first beachhead is Idaho and Utah

The market is any business that bills through Stripe, in the whole US and each English-speaking country, with a focus on schools, co-ops and churches (owner's decision, 2026-11-07). Idaho and Utah, led by microschools, are the first beachhead, not the whole market; the launch order after them is in section 6.9.

- The owner's own and related businesses (B4 Uni and its family service, buzz-school; Vibes of Light) already run on released tfd versions, which gives real data. They are related parties, not independent customers (`website-open-questions.md` 4.4).
- Families using state programs such as Idaho's parental choice tax credit or Utah's scholarship program (under appeal, `website-open-questions.md` 4.3) need payment records that hold up: provider, expense, amount, date and who paid. **Check each program's current receipt rules before building on this.** The itemised-receipt questions are open in `packages/atm/docs/receipts.md`.
- Microschools run on Stripe and spreadsheets and usually pay a bookkeeper. That's the exact problem Trifold solves.

## 5. Gaps in this research

- **Market size.** See section 6.
- **Willingness to pay.** No customer interviews yet. Experiment A tests it (`business-plan.md` §11).
- **State program rules.** The receipt requirements for each state program need checking from primary sources.
- **Competitors' AI pricing.** How Digits and Puzzle meter AI, if they do, wasn't found.

## 6. Market size: the US and English-speaking countries

Trifold is for any business that bills through Stripe. The focus verticals are **schools, co-ops and churches**, and **accounting firms** are a key channel. This section sizes three rings in six countries: the US, UK, Canada, Australia, New Zealand and Ireland.

**How to read the numbers.**
- Every figure is marked **sourced** or **estimate**. Estimates show their steps.
- Realized ARPU is **$60/mo ($720/yr)** throughout, with sensitivity at $45 and $76.50. Churches all get non-profit half price, so they sit near the $45 column.
- **Free covers about 40 families or members.** Smaller organisations are counted in the free pool, not in the TAM.
- Starter at $29 is the entry paid plan. Affiliates and firms earn a flat 20%.

### 6.1 The three rings

1. **Outer ring: any small business on Stripe.**
   - BuiltWith counts about 695,000–710,000 live US websites using Stripe and about 82,000–86,000 in the UK (sourced, secondary snapshots from 2025).
   - For Canada, Australia, New Zealand and Ireland we apply the UK rate of about 1,250 per million people: about 52,000, 34,000, 7,000 and 7,000 (estimate).
   - Total about **0.9M** (estimate). Websites aren't the same as businesses: this misses Stripe users with no Stripe code on their site and double-counts some sites.
   - For context: 36.2M US small businesses (sourced, SBA 2025), 5.7M UK private businesses (sourced, DBT 2025) and 1.08M Canadian small employer businesses (sourced, ISED, Dec 2024).
2. **Focus TAM:** schools, co-ops and churches that are big enough to pay.
3. **Adjacent TAM:** tutoring, camps and clubs, and studios and gyms.

The rings overlap but don't nest. Focus organisations that don't use Stripe are in the TAM but not in the outer ring.

### 6.2 United States: counts

| Row | All organisations | Basis | Over the Free line (paid-eligible) |
|---|---|---|---|
| **Schools: microschools** | ~75,000 | Sourced: National Microschooling Center, 2026. Median nonpublic microschool has 20 students | ~15,000. Estimate: 20%, meaning ~15% over 40 families plus ~5% that want the QuickBooks sync |
| **Schools: private schools under 150 students** | 19,953 (11,878 under 50; 8,075 with 50–149) | Sourced: NCES 2021–22 | ~11,000. Estimate: all 50–149 plus 25% of those under 50 |
| **Co-ops: homeschool and education co-ops** | ~20,000 (range 10,000–30,000) | Estimate: no count exists. Base is ~3.4M homeschool students (NHERI) | ~6,000 (estimate: 30%) |
| **Co-ops: small member co-ops** (housing, food, childcare, worker) | ~12,000 | Estimate: 30% of the ~40,000 US co-ops (sourced: NCBA/UWCC, a lower bound) | ~7,000 (estimate: 60%) |
| **Churches and congregations** | ~350,000–370,000 | Sourced: Hartford Institute / Faith Communities Today. Median attendance 70 (2025); 69% have 100 or fewer attending (2020) | ~144,000. Estimate: 40% of 360,000, taking 40 households as about 80 attending |
| Adjacent: tutoring and enrichment | ~15,000 | Estimate. Vertical IQ counts ~9,000 tutoring providers | ~10,500 (70%) |
| Adjacent: camps | ~15,000 | Sourced: American Camp Association | ~10,500 (70%) |
| Adjacent: studios and gyms | ~177,000 | Dance 14,622 and Pilates/yoga ~37,400 (sourced: IBISWorld). Martial arts ~75,000 (estimate: 127,369 employees ÷ 1.7 per business). Half of 106,547 gyms (estimate) | ~124,000 (70%) |

The **free pool** is everything below the line: about 420,000 US organisations, mostly congregations and microschools. They pay nothing but cost hosting and AI credits.

### 6.3 Who owns the payment rail

| Segment | Owns the rail | Effect on the SAM |
|---|---|---|
| Churches | **Planning Center Giving runs on Stripe Connect.** Each church holds its own Stripe account, and Planning Center processes about $600M a month (sourced: Stripe case study; Planning Center help) | **Stays in the SAM.** The best church way in |
| Churches | Pushpay ("direct payment infrastructure"); Givelify; Subsplash (unverified) | Removed |
| Churches | Tithe.ly (claims 50,000+ churches). Third parties say it charges Stripe's processing rate (unverified) | Check. It could be a partner |
| Churches, England | Parish Giving Scheme: Direct Debit, free to Church of England parishes since 2024 | Removes many Anglican parishes |
| Schools | FACTS (about 12,000 schools), Brightwheel and Prenda own their rails | Removed |
| Schools | ClassWallet, Odyssey and Student First pay ESA money directly to schools | The school stays in the SAM. Its ESA income arrives outside Stripe, and Trifold must book it |
| Schools | Omella: free, tips only, listed in Stripe's partner directory | A partner |
| Studios | Jackrabbit, Mindbody and similar (unverified) | The main reason the studio share is low |

About 64% of churches offer online giving, and about 38–41% of giving now arrives electronically (sourced from vendor surveys: Givelify, Christian Standard).

### 6.4 Programs that make receipts worth paying for

| Country | Schools and co-ops | Churches and charities |
|---|---|---|
| US | **ESAs:**<br>• Florida FES-EO 280,611 and FES-UA 140,147 students<br>• Arizona 96,802 (more than 100,000 by Jan 2026)<br>• Texas $1B, 90,000–100,000 expected in 2026–27<br>• Arkansas 46,578, Iowa 27,862, Tennessee 20,000, Alabama 18,484, Utah's program 14,657, West Virginia 14,221<br>(sourced: EdChoice 2026; news reports)<br>Odyssey asks for an itemized receipt, proof of payment and the payment method.<br>**Tax credits:** Idaho $50M (10,809 students applied); Oklahoma; the federal credit from 2027.<br>**Accounts:** 529 K-12 up to $20,000 a year; dependent-care FSA $7,500 for day camps (secondary sources) | The IRS requires a written acknowledgment for any gift of $250 or more, which drives year-end giving statements (sourced: IRS Pub. 1771) |
| UK | VAT at 20% on private school fees since Jan 2025. Tax-Free Childcare: 826,000 families, £632M (sourced: HMRC) | Gift Aid: £1.71bn paid to ~67,000 charities (sourced: HMRC) |
| Canada | Childcare receipts (form T778) for day camps | CRA official donation receipts, with strict required content |
| Australia | Child Care Subsidy (a government-registered rail Trifold doesn't own); NSW Active and Creative Kids vouchers | Gifts to most congregations aren't tax-deductible (verify) |
| New Zealand | No strong school program found | Donations tax credit of 33.33% on receipted gifts (sourced: IRD) |
| Ireland | Tax relief on fees covers third level only | Charitable Donation Scheme on gifts of €250 or more |

**The top five:** US ESAs; US church giving statements; US tax credits plus 529s; Canadian donation and T778 receipts; UK Gift Aid plus VAT on school fees.

For co-ops the pull is accountability to members, not a tax program. Sealed months let members check the books. Some homeschool co-ops are approved ESA vendors.

### 6.5 Other countries: counts (all estimates unless marked)

Population-scaled rows use US density per million people, adjusted with local data.

| | UK | Canada | Australia | NZ | Ireland |
|---|---|---|---|---|---|
| Schools (paid-eligible) | ~1,200. Base: 2,491 independent schools in England (sourced) | ~900. Base: about 2,000 independent schools (sourced, undated) | ~500. Base: about 1,170 independent schools (ACARA) | ~100 | ~200. Base: 51 fee-paying schools (sourced) |
| Co-ops (paid-eligible) | ~1,900. 7,063 co-ops (sourced, undated); 126,000 home-educated children in England (sourced, DfE 2025) | ~1,200. 5,714 non-financial co-ops (sourced, StatCan 2023) | ~400. About 1,800 co-ops (secondary source) | ~100 | ~100 |
| Churches (all → paid-eligible) | ~40,000 (sourced: Brierley, 2021) → 12,000 (30%) | ~25,000 congregations (base: 31,647 religious charities, Carleton/CRA) → 8,750 (35%) | ~13,000 (base: 13,872 religious charities, ACNC) → 4,550 (35%) | ~2,700 (scaled from Australia) → 950 | ~2,500 (unverified) → 1,250 |
| Adjacent (paid-eligible) | ~30,100 | ~17,600 | ~11,900 | ~2,200 | ~2,200 |
| Competing rails | GoCardless and Direct Debit; Parish Giving Scheme | Interac e-Transfer; CanadaHelps (check) | BECS direct debit (~90% of account-to-account payments), BPAY | Bank transfer | SEPA, bank transfer |

### 6.6 The accounting-firm channel

| Country | Small accounting and bookkeeping firms | Label |
|---|---|---|
| US | 46,000–52,000 CPA firms; ~87,000 including non-CPA firms; 137,069 employer establishments (NAICS 5412, 2023) | Sourced: CPA Trendlines 2024; Census via a secondary compilation |
| UK | 30,705 accounting and auditing enterprises (SIC 69201, March 2024). Bookkeepers are extra | Sourced: ONS via a secondary compilation |
| Canada | ~29,700–30,400 | Sourced: IBISWorld 2025–26 |
| Australia | 36,553 | Sourced: IBISWorld 2024 |
| New Zealand | 5,603 | Sourced: IBISWorld 2025 |
| Ireland | ~6,900 enterprises (2019); ~3,500 people authorised to offer accountancy services to the public | Sourced: CSO series via a secondary source; IAASA |

**Channel maths (estimate).** Suppose about 300 partner firms each bring 1–2 paying clients in 3 years. That's about a third of the SOM. Those clients earn about $48 net, after the 20% share. If 30% of all customers come through firms or affiliates, blended net ARPU is about $56.

### 6.7 TAM, SAM, SOM

**Method.**
- **TAM** = paid-eligible organisations × $720.
- **SAM** = paid-eligible × the share billing through a Stripe account they control. US estimates: schools 30%, education co-ops 30%, member co-ops 25%, churches 20% (64% offer online giving × about 30% on their own Stripe), tutoring and camps 25%, studios 15%. Other countries: 10–20% for focus rows (churches 10–15%) and 10–20% for adjacent rows.
- **SOM** = a 3-year share. US schools 5% (the wedge), co-ops 3%, churches 1.5% (entrenched giving platforms), US adjacent 0.5%, all other countries 1%.

| Country | TAM count (focus / total) | SAM count (focus / total) | SOM |
|---|---|---|---|
| US | 183,000 / 328,000 | 40,000 / 64,000 (schools 7,800; co-ops 3,550; churches 28,800) | ~1,050 (schools ~390, co-ops ~110, churches ~430, adjacent ~120) |
| UK | 15,100 / 45,200 | 1,800 / 5,800 | ~60 |
| Canada | 10,900 / 28,500 | 1,700 / 4,000 | ~40 |
| Australia | 5,500 / 17,400 | 900 / 2,300 | ~25 |
| New Zealand | 1,200 / 3,300 | 170 / 400 | ~5 |
| Ireland | 1,600 / 3,700 | 170 / 400 | ~5 |
| **Total** | **217,000 / 426,000** | **45,000 / 77,000** | **~1,200** |

| Annual revenue (estimate) | $45/mo | **$60/mo** | $76.50/mo |
|---|---|---|---|
| Outer ring (~0.9M businesses on Stripe) | ~$475M | **~$630M** | ~$805M |
| TAM, focus / total | $117M / $230M | **$156M / $307M** | $199M / $391M |
| SAM, focus / total | $24M / $42M | **$32M / $55M** | $41M / $71M |
| SOM ARR in year 3 | ~$0.65M | **~$0.86M** (~$0.81M net of affiliates) | ~$1.1M |

The SOM fits the financial model's 1,000–1,300 paying schools by year 3, now spread across schools, co-ops and churches. Churches lead the SAM by count but earn about half the ARPU, which is why schools stay the wedge.

### 6.8 Compliance, by country

- **US.**
  - Sales tax on SaaS varies by state.
  - COPPA covers data collected from children under 13 (Trifold collects from parents). FERPA mostly binds schools that receive federal funds. Student-privacy laws such as California's SOPIPA may apply.
  - Church receipts must include the IRS $250 acknowledgment wording.
- **UK.**
  - VAT invoices. The threshold is £90,000, but a business with no UK establishment has no threshold, so get advice on B2B rules.
  - UK GDPR, plus an Article 27 UK representative, plus the ICO fee.
  - Gift Aid declarations.
- **Canada.**
  - GST/HST, including the simplified regime for non-residents.
  - PIPEDA. In Quebec, Law 25 and French-language receipts.
  - CRA donation-receipt fields.
- **Australia.**
  - GST: approved education courses are GST-free; memberships are taxable.
  - Tax invoices above $82.50 AUD, with buyer details at $1,000 AUD or more. The non-resident GST threshold is $75,000 AUD.
  - Privacy Act, with a small-business exemption that has exceptions.
- **New Zealand.**
  - GST at 15%.
  - Taxable supply information rules since April 2023.
  - Privacy Act 2020, including its rule on overseas transfers (IPP 12).
- **Ireland.**
  - VAT at 23%; education is exempt. The registration threshold is about €42,500 (verify).
  - EU GDPR, plus an Article 27 EU representative.

No country requires private-sector data to be stored locally. UK, EU and Quebec transfers need contract terms.

**Other English-speaking countries** (Stripe status from stripe.com/global):
- **Singapore:** later.
- **Hong Kong:** later.
- **UAE, Malaysia:** not now.
- **Malta, Gibraltar:** only alongside Ireland.
- **Exclude:** South Africa, Nigeria and Kenya (Stripe only through Paystack); India (preview only); the Philippines (not listed).

### 6.9 Launch order

1. **US, nationally.**
   - Schools in the ESA states first: AZ, FL, TX, UT, ID, then AR, IA, TN, AL and WV.
   - Then education co-ops that are ESA vendors.
   - Then churches through the Planning Center and Stripe-direct route, and accounting firms in the same states.
   - Build: ESA-compliant receipts; booking of ESA payouts as income outside Stripe; a year-end giving statement with the $250 acknowledgment; sales tax.
2. **Canada without Quebec.** Build: CAD, GST/HST, T778 and CRA donation-receipt templates, and booking of Interac payments outside Stripe. Quebec comes later.
3. **UK.** Build: GBP, VAT invoices, Gift Aid declarations and claim export, UK GDPR terms, and Bacs and GoCardless matching.
4. **Australia, then New Zealand.** Build: GST invoice formats, BECS and PayTo matching, and NZ donation-credit receipts.
5. **Ireland,** alongside an EU plan.

### 6.10 What to research next

- Census County Business Patterns (now needs an API key), for NAICS 813110 (religious organizations), 611691 (tutoring), 611610 (fine arts schools) and 713940 (gyms).
- Congregation counts for New Zealand and Ireland.
- Which payment processor Tithe.ly and Subsplash use.
- The share of organisations above 40 families in each segment, from design partners.
- Counts of homeschool co-ops.
- Each ESA administrator's receipt rules.

### Sources

**US schools, microschools and homeschooling**
- National Microschooling Center figures (via K-12 Dive): https://www.k12dive.com/news/what-you-need-to-know--about-microschools/827601/
- NCES Private School Survey 2021–22, Table 8 (school size): https://nces.ed.gov/surveys/pss/tables/TABLE08fl2122.asp
- NHERI homeschool estimate: https://nheri.org/?p=309582

**US school-choice programs and accounts**
- EdChoice 2026 participation rankings: https://www.edchoice.org/2026-edchoice-participation-rankings/
- Arizona ESA above 100,000: https://www.edchoice.org/2026-arizonas-esa-program-crosses-the-100000-student-threshold/
- Idaho tax credit cap reached: https://idahocapitalsun.com/2026/07/17/idahos-private-education-tax-credit-reaches-annual-cap-applications-close/
- Idaho applications: https://www.spokesman.com/stories/2026/may/07/applications-for-idahos-education-tax-credit-close/
- Utah's program, 2025–26 awards: https://www.sltrib.com/news/education/2025/10/10/utahs-school-voucher-program-heres/
- Texas TEFA applications: https://communityimpact.com/south-central-austin/texas-legislature/applications-for-new-texas-education-savings-accounts-close-tuesday-march-17/
- Texas selects Odyssey: https://www.hppr.org/hppr-news/2025-10-08/texas-selects-company-that-will-help-develop-its-school-voucher-program
- Odyssey 2026–27 spending policy (Utah's program): https://support.withodyssey.com/hc/en-us/articles/52333135806491-Updated-UFA-Spending-Policies-for-2026-27-Awards-06-05-2026
- Wyoming ESA reimbursement guidelines: https://edu.wyoming.gov/wp-content/uploads/2025/04/Reimbursement-Guidelines.pdf
- ClassWallet ESA: https://classwallet.com/esa/
- ClassWallet, North Carolina: https://classwallet.com/press_releases/north-carolina-selects-classwallet-to-support-states-esa-program/
- Federal tax credit, state opt-in: https://www.k12dive.com/news/federal-private-school-choice-state-opt-in-IRS-Treasury-notice/807984/
- Federal tax credit overview: https://ballotpedia.org/U.S._school_choice_tax_credit_scholarship_program
- 529 changes: https://www.kiplinger.com/retirement/retirement-planning/how-the-one-big-beautiful-bill-act-could-reshape-529-plans
- 529 changes (South Carolina Treasurer): https://treasurer.sc.gov/about-us/newsroom/529-updates-in-one-big-beautiful-bill-give-south-carolina-families-even-more-flexibility-for-educational-savings
- Dependent-care FSA limit: https://blog.axcethr.com/big-beautiful-bill-employee-benefits-changes

**US adjacent verticals**
- IBISWorld, dance studios: https://www.ibisworld.com/industry-statistics/number-of-businesses/dance-studios-united-states/
- IBISWorld, Pilates and yoga studios: https://www.ibisworld.com/united-states/number-of-businesses/pilates-yoga-studios/4185
- IBISWorld, martial arts employment: https://www.ibisworld.com/united-states/employment/martial-arts-studios/4187
- IBISWorld, gyms: https://img3.ibisworld.com/united-states/number-of-businesses/gym-health-fitness-clubs/1655
- IBISWorld, tutoring and driving schools: https://script.ibisworld.com/united-states/number-of-businesses/tutoring-driving-schools/1544/
- Vertical IQ, NAICS 611691: https://verticaliq.com/?p=3598
- Camp counts: https://rankings.newsweek.com/americas-best-summer-camps-2024/overnight-camps
- Camp counts (ACA 2016, via National Academies): https://www.nationalacademies.org/read/25546/chapter/11

**US school billing vendors**
- FACTS school count: https://finviz.com/news/403373/facts-introduces-facts-compass-a-scholarship-administration-platform-for-the-federal-scholarship-tax-credit
- Omella for microschools: https://omella.com/solutions/microschools
- Omella in Stripe's partner directory: https://stripe.partners/directory/omella-inc
- Prenda invoicing: https://help.prenda.com/knowledge/fl-pep-and-fes-ua-student-invoicing-overview-using-ema-to-pay-a-prenda-invoice
- Brightwheel billing: https://intercom.help/brightwheel/en/collections/87111-billing
- Brightwheel processing fees: https://us.fitgap.com/products/brightwheel

**Churches and giving**
- Hartford Institute fast facts: https://hirr.hartfordinternational.edu/?p=40
- Faith Communities Today 2020 summary: https://goodfaithmedia.org/most-u-s-faith-communities-are-small-with-declining-attendance/
- Faith Communities Today 2025 attendance: https://zeale.co/news/articles/study-finds-signs-of-renewed-church-growth-in-us
- Givelify, State of Church Giving 2025: https://www.givelify.com/giving-in-faith/state-of-church-giving-2025
- Christian Standard church giving survey: https://christianstandard.com/?p=132661
- Planning Center on Stripe: https://stripe.com/customers/planning-center
- Planning Center help, accepting payments with Stripe: https://help.planningcenter.com/en/accept-payments-with-stripe.html
- Tithe.ly comparison page: https://get.tithe.ly/compare
- Pushpay: https://pushpay.com/blog/best-church-management-software-for-2026/
- IRS Publication 1771 (charitable contributions): https://www.irs.gov/pub/irs-pdf/p1771.pdf
- Parish Giving Scheme: https://www.parishgiving.org.uk/about-us/latest-news
- Church of England digital giving: https://www.churchofengland.org/resources/building-generous-church/generosity-resources/digital-giving
- UK church numbers (Brierley): https://www.christianitytoday.com/news/2022/may/after-2000-uk-church-buildings-close-new-church-plants-get-.html
- Canada religious charities (Carleton): https://carleton.ca/profbrouard/wp-content/uploads/PARGnote202562RNReligionOverview20251014FBMLFZ.pdf
- Canada congregation estimate: https://www.christiandaily.com/news/canadian-evangelical-body-urges-government-to-retain-religious-charities-status-amid-proposed-policy-changes
- Australia religious charities (ACNC submission): https://www.parliament.vic.gov.au/4af9a3/contentassets/570a2ca7e2da45cbaf7c4216dd1333ec/25.12.04_acnc-response.pdf

**Co-ops**
- US co-op count (NCBA/UWCC): https://www.usworker.coop/blog/new-state-of-the-co-op-economy-report-counts-40000-co-ops-in-u-s/
- Co-operatives in Canada, 2023 (Statistics Canada): https://www150.statcan.gc.ca/n1/pub/11-627-m/11-627-m2026014-eng.htm
- UK co-op key figures: https://test.coops4dev.coop/sites/default/files/2021-04/Key%20Figures%20Highlights%20UK.pdf
- Australian co-ops and mutuals (BCCM): https://bccm.coop/wp-content/uploads/2024/09/BCCM-IYC2025-National-Flyer-Members.pdf

**Accounting firms**
- CPA Trendlines almanac 2024: https://cpatrendlines.com/2024/01/01/cornerstone-cpa-trendlines-almanac-key-data-points-for-the-tax-accounting-and-finance-profession/
- Accounting industry statistics (Census and ONS figures): https://tailride.so/blog/accounting-industry-statistics-2026
- IBISWorld, accounting services in Canada: https://www.ibisworld.com/canada/number-of-businesses/accounting-services/1398/
- IBISWorld, accounting services in Australia: https://static.ibisworld.com/australia/number-of-businesses/accounting-services/561
- IBISWorld, accounting services in New Zealand: https://www.ibisworld.com/new-zealand/number-of-businesses/accounting-services/561/
- Ireland accounting enterprises (CSO series): https://d3fqfiq2w1ez7u.cloudfront.net/nmx/timeseries/ireland-number-of-enterprises-of-accounting-bookkeeping-and-auditing-services-tax-consultancy
- IAASA podcast transcript (authorised members): https://iaasa.ie/wp-content/uploads/2025/05/Transcript-of-Podcast-2-FINAL.pdf

**Small businesses and Stripe usage**
- SBA 2025 small business profiles: https://advocacy.sba.gov/2025/06/30/2025-small-business-profiles-for-the-states-territories-and-nation
- UK business population estimates 2025: https://www.gov.uk/government/statistics/business-population-estimates-2025/business-population-estimates-for-the-uk-and-regions-2025-statistical-release
- ISED Key Small Business Statistics 2025: https://ised-isde.canada.ca/site/sme-research-statistics/en/node/439
- BuiltWith Stripe usage: https://trends.builtwith.com/payment/Stripe
- Stripe usage by country, May 2025 snapshot: https://redstagfulfillment.com/how-many-businesses-use-stripe/
- Stripe availability by country: https://stripe.com/global
- Stripe Bacs Direct Debit: https://docs.stripe.com/payments/payment-methods/bacs-debit
- Stripe pre-authorized debit (ACSS): https://docs.stripe.com/payments/acss-debit
- Stripe PayTo: https://docs.stripe.com/payments/payto

**United Kingdom**
- Elective home education, autumn 2025: https://www.gov.uk/government/statistics/elective-home-education-autumn-term-2025
- Schools, pupils and their characteristics 2025/26: https://explore-education-statistics.service.gov.uk/find-statistics/school-pupils-and-their-characteristics/2025-26
- Independent school openings and closures: https://www.gov.uk/government/publications/independent-schools-applications-changes-and-closures/independent-school-applications-material-changes-and-closures
- VAT on private school fees: https://www.gov.uk/government/publications/vat-on-private-school-fees
- VAT on education (Notice 701/30): https://www.gov.uk/guidance/vat-on-education-and-vocational-training-notice-70130
- VAT registration: https://www.gov.uk/vat-registration/when-to-register
- Tax-Free Childcare: https://www.gov.uk/tax-free-childcare
- Tax-Free Childcare usage 2024–25: https://www.gov.uk/government/news/826000-families-boost-finances-with-childcare-savings
- UK charity tax relief statistics: https://www.gov.uk/government/statistics/uk-charity-tax-relief-statistics/uk-charity-tax-relief-statistics-commentary
- Leisure DB fitness report 2025: https://www.leisureopportunities.co.uk/news/Industry-metrics-are-at-an-all-time-high-says-LeisureDB-David-Minton/356016

**Canada**
- Fraser Institute, Canadian enrolment 2026: https://www.fraserinstitute.org/studies/where-our-students-are-educated-measuring-student-enrolment-canada
- Globe and Mail private school primer: https://www.theglobeandmail.com/canada/education/article-primer-on-private-schools/
- CRA form T778: https://www.canada.ca/en/revenue-agency/services/forms-publications/forms/t778.html
- CRA donation receipts: https://www.canada.ca/en/revenue-agency/services/charities-giving/charities/operating-a-registered-charity/issuing-receipts.html

**Australia**
- ACARA school numbers: https://acara.edu.au/reporting/national-report-on-schooling-in-australia/school-numbers
- Home Education Australia, state figures: https://www.hea.edu.au/state-information
- Child Care Subsidy data report, June quarter 2025: https://www.education.gov.au/node/19472
- NSW Active and Creative Kids voucher: https://www.service.nsw.gov.au/active-and-creative-kids-voucher
- PayTo and BECS figures (Zepto): https://fintechnews.sg/113635/australia/zepto-payto-index-australia-real-time-payments/
- ATO tax invoices: https://www.ato.gov.au/businesses-and-organisations/gst-excise-and-indirect-taxes/gst/tax-invoices
- OAIC small business privacy: https://www.oaic.gov.au/privacy/privacy-guidance-for-organisations-and-government-agencies/organisations/small-business

**New Zealand**
- Homeschooling count (RNZ, Ministry of Education data): https://www.rnz.co.nz/news/national/582018/more-than-10-000-children-stood-down-for-physically-assaulting-other-students-teachers-last-year
- IRD taxable supply information: https://www.ird.govt.nz/gst/tax-invoices-for-gst
- IRD donations tax credit: https://www.ird.govt.nz/income-tax/income-tax-for-individuals/individual-tax-credits/tax-credits-for-donations

**Ireland**
- Tusla home education register 2025: https://data.gov.ie/dataset/no-of-children-on-the-register-for-home-education-2025/resource/b2c0eaf7-fd7b-45ee-82b6-203cdea6d680
- Fee-paying schools: https://www.irishexaminer.com/news/arid-40034693.html
- Revenue Charitable Donation Scheme: https://www.revenue.ie/en/companies-and-charities/charities-and-sports-bodies/charitable-donation-scheme/index.aspx
