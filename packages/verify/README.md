<!-- SPDX-License-Identifier: Apache-2.0 -->
# tfd-verify

Check a Trifold receipt or seal anywhere WebCrypto runs: a browser, Bun, Deno, Node 20+ or a Worker. It is tfd's own
receipt and seal checks (`packages/atm/src/ledger/{receipt,seal,sign,util}.ts`), ported line for line, so a receipt
gets the verdict here that it gets from tfd (one known exception, below). No `node:*` imports, no network: nothing
leaves the page.

Apache-2.0 (`LICENSE`), so that anyone can check a receipt forever. It imports nothing from tfd itself (FSL-1.1-ALv2);
its one dependency is `@noble/ed25519` (MIT). Not on npm yet (`private: true`).

## Entry points

| Import | What it has |
|---|---|
| `tfd-verify` | `verifyReceipt` (shape, key id, then strict Ed25519), `checkReceiptAgainstEvents` (the books make the receipt again, byte for byte), `verifySealChain` (each seal's signature, its link to the seal before, and its events hashed and counted again), `receiptOf`, `canonicalize`, `sha256Hex`, the shape checks and the types. |
| `tfd-verify/check` | `checkReceipt`: the whole check of one receipt as a verifier page runs it, the signature, then the books and the month's seal when the caller has them. |
| `tfd-verify/link` | `encodeReceiptParam` and `decodeReceiptParam` for `/verify?r=` links (base64url of the receipt's JSON). No crypto, so a page can read a link without loading the verifier. |

```ts
import { verifyReceipt } from "tfd-verify";

const verdict = await verifyReceipt(JSON.parse(text), { "key-id": "-----BEGIN PUBLIC KEY-----…" });
// "ok" | "malformed" | "unknown_key" | "bad_signature"
```

Every check is async (WebCrypto) and never throws for untrusted input.

## Keys

A key is the text tfd's `createPublicKey` reads, and tfd-verify reads it the same way: BoringSSL's PEM reader, as tfd
runs on Bun. The first `-----BEGIN PUBLIC KEY-----` block counts, with any text on the lines around it; markers must
start their own lines, and the body needs its own lines. With no public key block, an Ed25519 `PRIVATE KEY` (PKCS#8)
counts as its public key. Anything else is `unknown_key`.

- **The exception:** an X.509 `CERTIFICATE` holding an Ed25519 key. tfd takes the certificate's key; tfd-verify answers
  `unknown_key`.
- **Node:** tfd under Node reads keys with OpenSSL 3, which differs from Bun on a few malformed texts (a byte-order mark,
  a `-` inside the base64, non-DER lengths, PKCS#8 v2). tfd-verify follows Bun.

`tests/pem-cases.ts` lists key texts with the verdict tfd gives each; `tests/pem.test.ts` holds tfd-verify to them, and
the site's `tests/pem.test.ts` runs tfd's own `verifyBytes` on the same texts.

## Tests

```sh
bun test tests   # tfd's receipt test vectors (packages/atm/tests/golden/receipt/, CC0-1.0)
bun run ts
```

`tests/golden.test.ts` reads the vectors as data files: the event, receipt and signed receipt must come out byte for
byte, the signed receipt must verify, and each tampered or malformed variant must get the verdict tfd's own tests expect.
The Trifold website (`apps/trifold-site/tests/verifier.test.ts`) also runs this package beside tfd's code on its sample
receipts.

`tests/check.test.ts` covers `checkReceipt`: a pass, each failure, untrusted seal entries and which seal decides.

The site depends on this package as `file:../../packages/verify`, which bun copies into the site's `node_modules`.
**After changing a file here, run `bun install` in `apps/trifold-site`**; the site's `tests/verify-copy.test.ts` fails
until you do.
