# Licensing

This repository holds code under more than one license.

| Path | License |
|---|---|
| Everything not listed below, including the Autumn code this repo forks (see `UPSTREAM.md`) | Apache-2.0, in `LICENSE` |
| `apps/trifold-site/` (the Trifold website) | Proprietary, all rights reserved. See `apps/trifold-site/LICENSE`. Its receipt verifier comes from `packages/verify`. |
| `apps/trifold-brief/` (the confidential, password-protected pitch brief) | Proprietary, all rights reserved. See `apps/trifold-brief/LICENSE`. Its embedded typefaces are under the SIL Open Font License 1.1 (`apps/trifold-brief/fonts/`). |
| `packages/verify/` (`tfd-verify`, the receipt and seal verifier for browsers and other WebCrypto runtimes) | Apache-2.0, in `packages/verify/LICENSE`. |
| `packages/atm/` (tfd, the engine and CLI) | FSL-1.1-ALv2, except its receipt and seal format, verifier and test vectors (Apache-2.0 and CC0-1.0). Details in `packages/atm/LICENSING.md`. |

Each tfd release becomes Apache-2.0 two years after it ships. tfd 0.10.0 (2026-11-07) is the first FSL release; releases up to 0.9.0 are Apache-2.0.
