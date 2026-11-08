<!-- SPDX-License-Identifier: Apache-2.0 -->
# tfd-verify

Check a Trifold receipt or seal anywhere WebCrypto runs: a browser, Bun, Deno, Node 20+ or a Worker. It ships its
TypeScript source (`exports` point at `src/*.ts`), so a browser, Node or a Worker needs a bundler or build step. It is
tfd's own receipt and seal checks (`packages/atm/src/ledger/{receipt,seal,sign,util}.ts`), ported line for line, so a
receipt verifies here exactly when it verifies with tfd. No `node:*` imports, no network: nothing leaves the page.

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

## Tests

```sh
bun test tests   # tfd's receipt test vectors (packages/atm/tests/golden/receipt/, CC0-1.0)
bun run ts
```

`tests/golden.test.ts` reads the vectors as data files: the event, receipt and signed receipt must come out byte for
byte, the signed receipt must verify, and each tampered or malformed variant must get the verdict tfd's own tests expect.
The Trifold website (`apps/trifold-site/tests/verifier.test.ts`) also runs this package beside tfd's code on its sample
receipts.

The site depends on this package as `file:../../packages/verify`, which bun copies into the site's `node_modules`: after
changing a file here, run `bun install` in `apps/trifold-site`.
