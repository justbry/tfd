# Trademarks

Status: draft policy, 2026-11-07. A lawyer reviews it before any mark is filed or the website launches. Until a legal entity exists, "Trifold" below means the project's owner.

The code licenses (`LICENSING.md`) let you use, change and share the code. They give no rights to Trifold's names or logos: Apache-2.0 section 6 and the FSL's Trademarks clause both say so. This policy is what governs the names.

## The marks

| Mark | What it names |
|---|---|
| **Trifold**™ | The company, the hosted service and the product |
| **Witnessed by Trifold**™ | A record that Trifold itself countersigned |
| **tfd**™ | The engine, package and CLI |
| **Rifo**™ | Trifold's AI agent |
| The Trifold logo | Not final yet; covered once published |

None is registered yet. A clearance search comes first (`docs/business/business-plan.md`, risks). Use ™, never ®, until a registration issues.

## Fine without asking

- **Saying what is true.** For example: "runs on tfd", "a fork of tfd", "imports Trifold receipts", "works with Trifold". Use the plain word, not the logo, and don't make it the most prominent name on the page.
- **Shipping official releases unchanged**, under their names.
- **Running tfd for your own books** (the FSL allows it), and calling it tfd inside your organization.
- **Writing about Trifold**: articles, reviews, tutorials, courses, talks.
- **Linking** to Trifold's site and to its public verifier, including from receipts you issue yourself.
- **Saying you implement the receipt format**, for example "implements the Trifold receipt format v1". You may say this only if your implementation passes the published test vectors (`packages/atm/tests/golden/receipt/`).

## Not without written permission

- **A fork or modified version keeps none of the names.** Rename it, and don't name it after a mark either: no "tfd-plus", no "Open Trifold", nothing confusingly similar. "Based on tfd" in its description is fine.
- **A hosted service, product or company** may not use a mark in its name, domain, app name, package name (npm and others) or social handle.
- **Nothing may suggest that Trifold endorses, certifies, sponsors or runs** something it doesn't.
- **Nobody may change the logo** or combine it with another mark.

## "Witnessed by Trifold"

This phrase is a promise about one specific record: Trifold saw that exact record at that time and countersigned it. So:
- Use it only on a receipt or seal that carries a valid Trifold witness signature.
- Never use it on a self-signed receipt, on your own seal, or on a whole set of books where only some records are witnessed.
- A verifier shows "Witnessed by Trifold" only when the signature checks against a Trifold witness key.

A self-hosted tfd issues self-signed receipts. You may say they are "verifiable with the open verifier", but not that Trifold witnessed them.

## "Trifold Certified Implementer"

Only a partner Trifold has certified may call itself a "Trifold Certified Implementer", and only while the certification lasts. Trifold may revoke it, and the partner then stops using it. It names the partner, not the partner's software or a hosted service, and it doesn't make the partner Trifold's agent. The program is proposed, not running (`docs/business/go-to-market.md` 3.6).

## Reporting misuse, asking permission

Open an issue on the repository until Trifold publishes a contact address.
