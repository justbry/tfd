# Setting up the CLA

The owner's checklist for collecting CLA signatures on `justbry/tfd`. None of it is done yet. Don't start until a lawyer has reviewed `individual.md` and `corporate.md`.

## Why cla-assistant.io

- **cla-assistant.io** is SAP's free hosted CLA bot. It is still maintained: the last commit to `cla-assistant/cla-assistant` was on 2026-11-05. It keeps signatures in its own database and exports them as CSV.
- **`contributor-assistant/github-action`**, the GitHub Action version, is archived and read-only. Its last commit, on 2026-03-23, put "no longer actively maintained" at the top of its README. Checked 2026-11-07.

## 1. Before you start

- [ ] A lawyer has reviewed both texts and answered the questions at the top of each file.
- [ ] Fill in the placeholders: the owner's legal name, the contact address and the privacy notice URL.
- [ ] Set both version lines to v1.0 with the new date, remove the DRAFT banners, and merge that change into `dev`.

## 2. Publish the individual CLA as a gist

CLA assistant reads the CLA from a GitHub gist. Each edit to the gist makes a new revision, and CLA assistant records which revision each person signed. The gist's revision history is the CLA's version history.

- [ ] Signed in as `justbry`, create a **public** gist at <https://gist.github.com>.
- [ ] Name the file `trifold-individual-cla.md`. Paste everything in `individual.md` below the `## Agreement` heading. Leave out the changes table and the lawyer notes.
- [ ] Add a second file named `metadata` (no extension). CLA assistant turns it into the form people fill in before they sign:

  ```json
  {
    "name": { "title": "Full name", "type": "string", "githubKey": "name", "required": true },
    "email": { "title": "E-mail", "type": "string", "githubKey": "email", "required": true },
    "address": { "title": "Residence address", "type": "string", "required": true },
    "country": { "title": "Country", "type": "string", "required": true }
  }
  ```

  Drop `address` if the lawyer says not to collect it.
- [ ] Copy the gist's URL.

The corporate CLA doesn't go in a gist. Companies sign it as a PDF (step 5).

## 3. Connect cla-assistant.io to justbry/tfd

- [ ] Install the CLA assistant GitHub App (<https://github.com/apps/cla-assistant>) on the `justbry` account, for `justbry/tfd` only. Its README recommends the App over the older OAuth sign-in.
- [ ] Sign in at <https://cla-assistant.io> with GitHub and choose **Configure CLA**. Pick `justbry/tfd` and paste the gist URL.
- [ ] Open the linked repository's settings:
  - **Exempted users** (the allowlist): see step 4.
  - **Privacy policy URL**: Trifold's privacy notice.
  - **Minimum file or code changes**: leave empty, so every pull request needs a signature, typo fixes included.
- [ ] Test it. Open a pull request from an account that isn't on the allowlist. CLA assistant should comment, and the commit should get a `license/cla` status that stays pending until the account signs.

## 4. The allowlist

CLA assistant skips anyone on its list of exempted users. The list is comma-separated, and `*` is a wildcard.

```
justbry,dependabot[bot],github-actions[bot]
```

- `justbry` is the owner, who is the licensor and has no one to sign to.
- **Bots** can't sign. Name each bot that opens pull requests here, rather than `*[bot]`, which would exempt every GitHub App account, including ones you never chose. Today only `justbry` opens pull requests and there's no `dependabot.yml`; add Dependabot, Renovate or any other bot when you turn it on.
- **Corporate signers**: add each GitHub login from a signed Schedule A (step 5).
- CLA assistant also has an organization allowlist. It exempts every public member of an organization when the pull request comes from that organization's fork. Don't use it for a corporate CLA, because Schedule A names people, not whole organizations.

A commit whose email isn't linked to a GitHub account can't be matched to anyone, so the check stays pending. The contributor has to add that email to their GitHub account, or amend the commit with one that is.

## 5. Record a corporate CLA

- [ ] Send the company the text of `corporate.md` below `## Agreement`, as a PDF, through an e-signature service.
- [ ] Keep the signed PDF where only Trifold can read it, not in this repository: it holds names and addresses.
- [ ] Log it in a private register: company, signer and title, date, CLA version, Point of Contact, and each Schedule A name with its GitHub login.
- [ ] Add the Schedule A logins to the allowlist (step 4) and confirm by email to the Point of Contact.
- [ ] **Changes to Schedule A** arrive by email from the Point of Contact (`corporate.md`, Schedule A). Add or remove the logins, log the change with its date, and reply to confirm. A removal doesn't touch contributions made before it.

## 6. Require the check on `dev`

`dev` has no branch protection today (checked 2026-11-07). The `license/cla` status shows up in GitHub's list of checks only after CLA assistant has posted it once, so do the test in step 3 first.

- [ ] Settings → Branches → Add branch protection rule (or Settings → Rules → New branch ruleset) for `dev`:
  - turn on **Require status checks to pass before merging**;
  - add `license/cla`.
- [ ] Or, from the command line:

  ```sh
  gh api -X PUT repos/justbry/tfd/branches/dev/protection --input - <<'EOF'
  {
    "required_status_checks": { "strict": false, "contexts": ["license/cla"] },
    "enforce_admins": false,
    "required_pull_request_reviews": null,
    "restrictions": null
  }
  EOF
  ```

  This replaces any protection rule `dev` already has, so add other checks to `contexts` if you want them required too. With `enforce_admins` false the owner can still merge past a stuck check.

Bots on the allowlist get a passing `license/cla` status, so their pull requests aren't blocked.

## 7. When the CLA text changes

- [ ] Change `individual.md` or `corporate.md` in this repo first, through a pull request. Raise the version, set the date, and update the changes table. A lawyer reviews anything beyond a typo.
- [ ] Export the signer list (CSV) from the CLA assistant dashboard and keep it with the corporate register.
- [ ] Then paste the new text into the gist. The edit makes a new revision, and CLA assistant asks each contributor to sign again on their next pull request. A typo fix triggers this too, so batch your edits.
- [ ] Corporate CLAs are signed PDFs, so nothing re-prompts. A signed one stays valid under the version it names. Decide whether to ask companies to sign the new version; their Schedule A logins stay on the allowlist meanwhile.

## 8. After it's live

- [ ] Point `CONTRIBUTING.md` at the gist and say signing happens on the first pull request.
- [ ] Mark the contributor-terms item in `AGENTS.md` as live.
