# Trifold Corporate Contributor License Agreement

> **DRAFT — not for signature until reviewed by a lawyer.**
> Don't sign it, and don't send it to anyone to sign, until a lawyer has reviewed it and Trifold has published the reviewed text.

Version 0.1, 2026-11-08 (draft). Adapted from the Apache Software Foundation's Software Grant and Corporate Contributor License Agreement (v r190612, <https://www.apache.org/licenses/cla-corporate.pdf>, fetched 2026-11-07). The section numbering and wording follow Apache's; the table lists every deliberate change. The individual form is `individual.md`; how signatures are recorded is in `SETUP.md`.

## Changes from the Apache CCLA

| # | Where | Apache r190612 | This draft | Why |
|---|---|---|---|---|
| 1 | Throughout | "The Apache Software Foundation (the 'Foundation')" | "Trifold" | The licensor. No legal entity exists yet. |
| 2 | Section 1, new definition of "Trifold" | None | Trifold is the project's owner until a legal entity exists, and includes successors and assignees | The license has to pass to the entity once it's formed. |
| 3 | Opening paragraph | Promises not to use Contributions "contrary to the public benefit or inconsistent with its nonprofit status and bylaws" | Removed | Trifold isn't a nonprofit, and the promise would conflict with proprietary licensing. |
| 4 | Section 2, new last sentence | Grants a license to "sublicense, and distribute" | Adds that Trifold may license Contributions under any terms, naming open source, source-available (FSL-1.1-ALv2) and proprietary | Says outright what CONTRIBUTING.md promises. |
| 5 | How to sign | Email a PDF to secretary@apache.org | Sign with an e-signature service and send the PDF to Trifold | Trifold has no secretary. |
| 6 | New paragraph "How Trifold records this Agreement" | None | Trifold keeps the signed PDF and adds Schedule A's GitHub logins to the CLA bot's allowlist | Says what happens to the signature. |
| 7 | Schedule A | Names only | Name, GitHub login and email, plus a "Changes to Schedule A" procedure | The allowlist is keyed by GitHub login; Apache only says "subsequent written modification". |
| 8 | Section 8, new last sentence | None | Removing someone from Schedule A takes effect when Trifold receives the notice and doesn't affect earlier Contributions | Makes add and remove predictable. |
| 9 | Title | "Software Grant and Corporate Contributor License Agreement" | "Corporate Contributor License Agreement" | Schedule B (the optional software grant) is kept, but the name is shorter. |
| 10 | "products owned or managed by" | the Foundation | Trifold | Follows from 1. |

Apache's sections 3 (patents), 5, 6 and 7 change only the licensor's name.

**A practice change, not a text change.** The ASF also requires every employee to sign their own ICLA, even when their employer has signed a CCLA. This draft doesn't: an employee named in Schedule A goes on the allowlist and isn't asked to sign the individual CLA. Each employee's own representations (individual CLA sections 4, 5 and 8) are therefore missing. See question 2 below.

## For the reviewing lawyer

1. All the questions in `individual.md` apply here too: licensor and assignment, the relicensing sentence, patents after a move to another product, and personal data.
2. **Employees without an individual CLA.** Is the corporation's signature enough for its Schedule A employees, or should they also sign the individual CLA, as the ASF requires? If they should, the allowlist step in `SETUP.md` goes away.
3. **Who may sign.** The form asks for someone with authority to bind the corporation. Should Trifold check that, for example by asking for the signer's title or proof of authority?
4. **Changes to Schedule A.** Is an email from the Point of Contact enough to add or remove an employee, or should each change be signed?
5. **Schedule B.** Keep the software grant schedule, or drop it until someone wants to donate an existing code base?

## License of this text

These drafts fall under the repository's default license, Apache-2.0 (see `LICENSING.md`). apache.org, where the Apache agreements are published, is under the same license; the table above is the notice of changes that Apache-2.0 section 4(b) asks for.

---

## Agreement

*Everything below this line is the text to publish once it's been reviewed.*

### Trifold Corporate Contributor License Agreement ("Agreement") v0.1

Thank you for your interest in Trifold. In order to clarify the intellectual property license granted with Contributions from any person or entity, Trifold must have a Contributor License Agreement (CLA) on file that has been signed by each Contributor, indicating agreement to the license terms below. This license is for your protection as a Contributor as well as the protection of Trifold and its users; it does not change your rights to use your own Contributions for any other purpose.

This version of the Agreement allows an entity (the "Corporation") to submit Contributions to Trifold, to authorize Contributions submitted by its designated employees to Trifold, and to grant copyright and patent licenses thereto.

Please fill in this Agreement, have it signed with an electronic signature service by a person authorized to enter into contracts for the Corporation, and email the signed PDF to Trifold at [contact address to be published]. Please read this document carefully before signing and keep a copy for your records.

**How Trifold records this Agreement.** Trifold keeps the signed PDF. It adds the GitHub login of each employee named in Schedule A to the list of accounts its contribution bot (CLA assistant) accepts, so those employees' pull requests pass the CLA check. Trifold updates that list when it receives a change to Schedule A under section 8.

- Corporation name: ______________________________
- Corporation address: ______________________________
- Point of Contact: ______________________________
- E-mail: ______________________________
- Telephone: ______________________________

You accept and agree to the following terms and conditions for Your present and future Contributions submitted to Trifold. Except for the license granted herein to Trifold and recipients of software distributed by Trifold, You reserve all right, title, and interest in and to Your Contributions.

1. **Definitions.**

   "You" (or "Your") shall mean the copyright owner or legal entity authorized by the copyright owner that is making this Agreement with Trifold. For legal entities, the entity making a Contribution and all other entities that control, are controlled by, or are under common control with that entity are considered to be a single Contributor. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

   "Trifold" shall mean the owner of the Trifold project, including the tfd repository at https://github.com/justbry/tfd. Until a legal entity is formed to hold the project, that owner is [legal name of the project's owner]. "Trifold" includes its successors and assignees, including any legal entity to which the project is transferred.

   "Contribution" shall mean the code, documentation or other original works of authorship expressly identified in Schedule B, as well as any original work of authorship, including any modifications or additions to an existing work, that is intentionally submitted by You to Trifold for inclusion in, or documentation of, any of the products owned or managed by Trifold (the "Work"). For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to Trifold or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, Trifold for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by You as "Not a Contribution."

2. **Grant of Copyright License.** Subject to the terms and conditions of this Agreement, You hereby grant to Trifold and to recipients of software distributed by Trifold a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute Your Contributions and such derivative works. Without limiting the foregoing, Trifold may license and distribute Your Contributions and such derivative works under any license terms it chooses, at any time, including open source licenses (such as the Apache License 2.0), source-available licenses (such as the Functional Source License, FSL-1.1-ALv2), public domain dedications (such as CC0 1.0), and proprietary or commercial terms.

3. **Grant of Patent License.** Subject to the terms and conditions of this Agreement, You hereby grant to Trifold and to recipients of software distributed by Trifold a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by You that are necessarily infringed by Your Contribution(s) alone or by combination of Your Contribution(s) with the Work to which such Contribution(s) were submitted. If any entity institutes patent litigation against You or any other entity (including a cross-claim or counterclaim in a lawsuit) alleging that your Contribution, or the Work to which you have contributed, constitutes direct or contributory patent infringement, then any patent licenses granted to that entity under this Agreement for that Contribution or Work shall terminate as of the date such litigation is filed.

4. You represent that You are legally entitled to grant the above license. You represent further that each employee of the Corporation designated on Schedule A below (or in a subsequent written modification to that Schedule) is authorized to submit Contributions on behalf of the Corporation.

5. You represent that each of Your Contributions is Your original creation (see section 7 for submissions on behalf of others).

6. You are not expected to provide support for Your Contributions, except to the extent You desire to provide support. You may provide support for free, for a fee, or not at all. Unless required by applicable law or agreed to in writing, You provide Your Contributions on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE.

7. Should You wish to submit work that is not Your original creation, You may submit it to Trifold separately from any Contribution, identifying the complete details of its source and of any license or other restriction (including, but not limited to, related patents, trademarks, and license agreements) of which you are personally aware, and conspicuously marking the work as "Submitted on behalf of a third-party: [named here]".

8. It is your responsibility to notify Trifold when any change is required to the list of designated employees authorized to submit Contributions on behalf of the Corporation, or to the Corporation's Point of Contact with Trifold. Removing an employee from Schedule A takes effect when Trifold receives the notice, and does not affect the licenses granted for Contributions submitted before then.

Please sign: ______________________________ Date: ________________

- Name: ______________________________
- Title: ______________________________

### Schedule A

[Initial list of designated employees. NB: authorization is not tied to particular Contributions.]

| Full name | GitHub login | E-mail |
|---|---|---|
| | | |
| | | |
| | | |
| | | |
| | | |
| | | |
| | | |
| | | |
| | | |
| | | |

**Changes to Schedule A.** To add or remove a designated employee, the Point of Contact emails Trifold at [contact address to be published] with the Corporation's name, the date of this Agreement, and, for each change, the employee's full name, GitHub login and whether they are added or removed. That email is a written modification to this Schedule. Trifold confirms the change by reply and updates its allowlist; an added employee may contribute once the confirmation arrives.

### Schedule B

[Identification of optional concurrent software grant. Would be left blank or omitted if there is no concurrent software grant.]

[describe grant here]

*Adapted from the Apache Software Foundation Software Grant and Corporate Contributor License Agreement (v r190612).*
