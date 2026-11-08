# Trifold Individual Contributor License Agreement

> **DRAFT — not for signature until reviewed by a lawyer.**
> Don't sign it, and don't publish it to the CLA bot, until a lawyer has reviewed it and Trifold has published the reviewed text.

Version 0.1, 2026-11-08 (draft). Adapted from the Apache Software Foundation's Individual Contributor License Agreement V2.2 (<https://www.apache.org/licenses/icla.pdf>, fetched 2026-11-07). The section numbering and wording follow Apache's; the table lists every deliberate change. How the text gets published and signed is in `SETUP.md`; the corporate form is `corporate.md`.

## Changes from the Apache ICLA

| # | Where | Apache V2.2 | This draft | Why |
|---|---|---|---|---|
| 1 | Throughout | "The Apache Software Foundation (the 'Foundation')" | "Trifold" | The licensor. No legal entity exists yet. |
| 2 | Section 1, new definition of "Trifold" | None | Trifold is the project's owner until a legal entity exists, and includes successors and assignees | The license has to pass to the entity once it's formed. Apache never needed this. |
| 3 | Opening paragraph | Promises not to use Contributions "contrary to the public benefit or inconsistent with its nonprofit status and bylaws" | Removed | Trifold isn't a nonprofit, and the promise would conflict with proprietary licensing. |
| 4 | Section 2, new last sentence | Grants a license to "sublicense, and distribute" | Adds that Trifold may license Contributions under any terms, naming open source, source-available (FSL-1.1-ALv2) and proprietary | Apache's grant implies this; CONTRIBUTING.md promises it in plain words, so this sentence says it outright. |
| 5 | Contributor details | Public name, Apache id, "notify project", public-profile note | GitHub login added. The Apache-only fields are removed. | Signing happens through CLA assistant on GitHub. |
| 6 | How to sign | Email a PDF to secretary@apache.org | Sign through CLA assistant on your first pull request | Trifold collects signatures with a bot. |
| 7 | Privacy line | ASF privacy policy link | Trifold's privacy notice (placeholder) | Trifold has no privacy notice yet. |
| 8 | "products owned or managed by" | the Foundation | Trifold | Follows from 1. |

Apache's sections 3 (patents) and 5 to 8 change only the licensor's name.

## For the reviewing lawyer

1. **Licensor and assignment (change 2).** Is defining "Trifold" to include successors and assignees enough to move the license to a future company, or is a separate assignment clause needed? Who signs on Trifold's side, if anyone?
2. **Relicensing (change 4).** Does section 2 support releasing a Contribution under proprietary terms and changing those terms later? Should Trifold promise anything in return, for example that a Contribution also stays available under the license its file had when it was submitted? Apache's nonprofit promise (change 3) was its consideration language.
3. **Patents after a move.** Section 3 covers "the Work to which such Contribution(s) was submitted". If Trifold moves a Contribution into another product, such as the proprietary hosted service, is it still covered? Consider widening it.
4. **Click-to-sign.** Is a GitHub-authenticated click in CLA assistant a valid signature in the places contributors are likely to live?
5. **Personal data.** Apache asks for a residence address. Keep it, or ask only for name, email and country? A privacy notice is needed before signatures are collected.
6. **Not added on purpose:** governing law, a moral-rights waiver, and a right to terminate. Apache has none of them. Add any?

## License of this text

These drafts fall under the repository's default license, Apache-2.0 (see `LICENSING.md`). apache.org, where the Apache agreements are published, is under the same license; the table above is the notice of changes that Apache-2.0 section 4(b) asks for.

---

## Agreement

*Everything below this line is the text to publish once it's been reviewed.*

### Trifold Individual Contributor License Agreement ("Agreement") v0.1

Thank you for your interest in Trifold. To clarify the intellectual property license granted with Contributions from any person or entity, Trifold must have on file a signed Contributor License Agreement ("CLA") from each Contributor, indicating agreement with the license terms below. This agreement is for your protection as a Contributor as well as the protection of Trifold and its users. It does not change your rights to use your own Contributions for any other purpose.

Please sign this Agreement through CLA assistant, which asks you to do so on your first pull request to a Trifold repository. Read this document carefully before signing and keep a copy for your records.

- Full name: ______________________________
- GitHub login: ______________________________
- Residence address: ______________________________
- Country: ______________________________
- E-mail: ______________________________

You accept and agree to the following terms and conditions for Your Contributions (present and future) that you submit to Trifold. Except for the license granted herein to Trifold and recipients of software distributed by Trifold, You reserve all right, title, and interest in and to Your Contributions.

1. **Definitions.**

   "You" (or "Your") shall mean the copyright owner or legal entity authorized by the copyright owner that is making this Agreement with Trifold. For legal entities, the entity making a Contribution and all other entities that control, are controlled by, or are under common control with that entity are considered to be a single Contributor. For the purposes of this definition, "control" means (i) the power, direct or indirect, to cause the direction or management of such entity, whether by contract or otherwise, or (ii) ownership of fifty percent (50%) or more of the outstanding shares, or (iii) beneficial ownership of such entity.

   "Trifold" shall mean the owner of the Trifold project, including the tfd repository at https://github.com/justbry/tfd. Until a legal entity is formed to hold the project, that owner is [legal name of the project's owner]. "Trifold" includes its successors and assignees, including any legal entity to which the project is transferred.

   "Contribution" shall mean any original work of authorship, including any modifications or additions to an existing work, that is intentionally submitted by You to Trifold for inclusion in, or documentation of, any of the products owned or managed by Trifold (the "Work"). For the purposes of this definition, "submitted" means any form of electronic, verbal, or written communication sent to Trifold or its representatives, including but not limited to communication on electronic mailing lists, source code control systems, and issue tracking systems that are managed by, or on behalf of, Trifold for the purpose of discussing and improving the Work, but excluding communication that is conspicuously marked or otherwise designated in writing by You as "Not a Contribution."

2. **Grant of Copyright License.** Subject to the terms and conditions of this Agreement, You hereby grant to Trifold and to recipients of software distributed by Trifold a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable copyright license to reproduce, prepare derivative works of, publicly display, publicly perform, sublicense, and distribute Your Contributions and such derivative works. Without limiting the foregoing, Trifold may license and distribute Your Contributions and such derivative works under any license terms it chooses, at any time, including open source licenses (such as the Apache License 2.0), source-available licenses (such as the Functional Source License, FSL-1.1-ALv2), public domain dedications (such as CC0 1.0), and proprietary or commercial terms.

3. **Grant of Patent License.** Subject to the terms and conditions of this Agreement, You hereby grant to Trifold and to recipients of software distributed by Trifold a perpetual, worldwide, non-exclusive, no-charge, royalty-free, irrevocable (except as stated in this section) patent license to make, have made, use, offer to sell, sell, import, and otherwise transfer the Work, where such license applies only to those patent claims licensable by You that are necessarily infringed by Your Contribution(s) alone or by combination of Your Contribution(s) with the Work to which such Contribution(s) was submitted. If any entity institutes patent litigation against You or any other entity (including a cross-claim or counterclaim in a lawsuit) alleging that your Contribution, or the Work to which you have contributed, constitutes direct or contributory patent infringement, then any patent licenses granted to that entity under this Agreement for that Contribution or Work shall terminate as of the date such litigation is filed.

4. You represent that you are legally entitled to grant the above license. If your employer(s) has rights to intellectual property that you create that includes your Contributions, you represent that you have received permission to make Contributions on behalf of that employer, that your employer has waived such rights for your Contributions to Trifold, or that your employer has executed a separate Corporate CLA with Trifold.

5. You represent that each of Your Contributions is Your original creation (see section 7 for submissions on behalf of others). You represent that Your Contribution submissions include complete details of any third-party license or other restriction (including, but not limited to, related patents and trademarks) of which you are personally aware and which are associated with any part of Your Contributions.

6. You are not expected to provide support for Your Contributions, except to the extent You desire to provide support. You may provide support for free, for a fee, or not at all. Unless required by applicable law or agreed to in writing, You provide Your Contributions on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied, including, without limitation, any warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A PARTICULAR PURPOSE.

7. Should You wish to submit work that is not Your original creation, You may submit it to Trifold separately from any Contribution, identifying the complete details of its source and of any license or other restriction (including, but not limited to, related patents, trademarks, and license agreements) of which you are personally aware, and conspicuously marking the work as "Submitted on behalf of a third-party: [named here]".

8. You agree to notify Trifold of any facts or circumstances of which you become aware that would make these representations inaccurate in any respect.

Signed through CLA assistant by the GitHub account named above. Date: ________________

This is a legal contract containing personally identifiable information. Trifold's privacy notice, [URL to be published], says how this information is used and shared.

*Adapted from the Apache Software Foundation Individual Contributor License Agreement V2.2.*
