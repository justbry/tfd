# Validator interoperability spike: findings

Subject: `tfd-credentials` (rdfc proofs via `issueCertifiable`, JCS proofs via `issue`).
Run on 2026-11-08, all local (Docker for the 1EdTech validator; nothing sent to hosted services).
Only the summary tables are committed under `results/`; the generated fixtures and the per-credential reports
(about 2.5 MB) are not. Re-run everything with `run-all.sh` (setup in `setup.sh`) to regenerate them.

The spike agent was cancelled twice by server restarts before it wrote a report. This file was written afterwards from
the raw output in `results/`, which are the numbers below. Anything marked **inferred** is a conclusion from those
results, not something read in the verifier's source.

## What was run

- 1EdTech public validator (`1EdTech/digital-credentials-public-validator`, Java 17 in Docker): 50 fixtures,
  `results/1edtech-table.txt`.
- DCC `@digitalcredentials/verifier-core`: `results/verifier-core-run.txt`.
- `openbadgeslib` (Python): `results/openbadgeslib-run.txt`.
- Our own `verifyCredential` over the same fixtures: `results/ours-run.txt`.
- Intermediate proof values compared with the 1EdTech report (`compare-intermediates.ts`).
- Reverse direction: sample credentials from DCC (`vc-test-fixtures`) and 1EdTech's test set through our verifier
  (`results/reverse-ours-run.txt`), and through the 1EdTech validator (`results/reverse-1edtech/`).

## What was not run

- The W3C `vc-di-eddsa-test-suite` and `vc-bitstring-status-list-test-suite`.
- 1EdTech's official conformance suite (needs a 1EdTech account). The public validator is open source, but whether it
  is the same engine as the certification suite is not confirmed.
- Real browsers, Node 20, a `did:web` on a real domain (all tests used `localhost`).

## Findings

1. **rdfc passes the 1EdTech validator.** `A-rdfc-nostatus` is VALID. `A-rdfc` is a WARNING whose only message is
   `IssuerProbe: url "https://urlu.example" in issuer is not accessible` (the fixture's issuer URL is fake). Document,
   proofConfig and hashData match ours for the rdfc cases.
2. **JCS-only is rejected by every other verifier.** 1EdTech: ERROR `EmbeddedProofProbe: Embedded proof verification
   failed`. DCC: `Unsupported Proof`. openbadgeslib: `no supported Data Integrity proof`. Only our verifier accepts it.
   Matches the certification guide: JCS is not certifiable.
3. **Proof order matters to the 1EdTech validator (inferred).** Both proofs, rdfc first: WARNING (passes).
   JCS first: ERROR. A corrupted or stripped second (JCS) proof is not noticed (`G-C-bad-jcs`, `G-C-strip-jcs` give
   WARNING), so it appears to check only the first proof. DCC and openbadgeslib handle proof sets; DCC reports the
   unsupported one as an advisory.
4. **Status.** Revoked: FATAL in 1EdTech ("Credential has been revoked"), revoked in DCC. Suspended: DCC reports
   suspended; the 1EdTech validator reports only the issuer-URL warning, so a suspended credential looks fine there.
   openbadgeslib could not fetch the local TLS status list, so it gives no status verdict.
5. **Tampering is caught by all of them, with two exceptions.** Changing a field, the context, adding unmapped terms
   (safe mode), stripping the proof, and a rogue or swapped key are all rejected. Exceptions: DCC accepts a copy of
   the OB3 context served from a different URL (`G-A-context-copy`; 1EdTech and ours reject it), and 1EdTech and DCC
   accept a corrupted second JCS proof (ours rejects).
6. **`did:web` with an encoded port.** A path-style `did:web:localhost%3A8443:issuers:x` verifies in 1EdTech. The
   root form `did:web:localhost%3A8443` fails there (`Key document not found ... https://localhost%3A8443/.well-known/did.json`),
   so the validator does not decode `%3A`. Likely a test artifact of using a port; not checked on a real domain.
7. **openbadgeslib disagrees on one fixture.** `A-rdfc-escapes` (string escapes in the signed content) is rejected by
   openbadgeslib ("signature mismatch") but accepted by 1EdTech, DCC and ours. Three against one suggests a bug in
   openbadgeslib's canonicalisation, but that is not proven.
8. **Our verifier is strict.** Of 67 external sample credentials, only 3 verified. The failures are structural
   (`https://w3id.org/security/suites/ed25519-2020/v1` is not an accepted context; credentialSubject needs an id or
   identifier) or an unresolved verification method (the samples name hosts we do not fetch). It behaves as a URLU
   profile verifier, not a general Open Badges verifier. Decide if Buzz clients need to verify other issuers' badges.

## Recommendations

- Certifiable credentials: issue rdfc only, or a proof set with rdfc first. Never JCS first.
- Do not claim "1EdTech-compatible" yet. Passing the public validator is evidence, not certification.
- Where a suspension must be visible in the 1EdTech validator, use revocation.
- If non-URLU badges must be verified, add a looser profile option to `verifyCredential` (more contexts, subject
  without id).
- Check the `A-rdfc-escapes` mismatch with the `openbadgeslib` author or by reading its canonicalisation.
- Cheapest next step toward certification: get a 1EdTech account and run the official suite on an `issueCertifiable`
  credential from a real `did:web` domain. Prepare the required video of how a recipient retrieves the badge.
