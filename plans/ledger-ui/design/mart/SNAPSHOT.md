# Mart snapshot

Written by `plans/ledger-ui/loop/tools/snapshot-mart.ts`; do not edit by hand. Source: the coordinating atm session's mart (`/tmp/atm-mart`), checked against atm at `2d2d5ce8a0052dd63cfe899330aa9c994b517332`.

- `bundle.json` sha256 `c0a90a305b02c1ad8f47c28838e8c54ad4c8537b99bcf13118c949a1c2022b21`, reconcile 1908/1908
- `kpis/<preset>.json.gz`: atm's own `scenario kpis` export, gzipped; its fixtureHash and kpisHash equal `packages/atm/tests/golden/scenarios`, and kpiHash(rows) recomputed with atm's `canonicalize` equals kpisHash
- `views/<preset>/`: atm's `writeViews` output (objects plus `views/manifest.json` with a sha256 per object) for the presets atm can replay

| Preset | fixtureHash | kpisHash | sha256 of kpis.json | Read slice |
|---|---|---|---|---|
| `annual-prepay` | `af29a64c50a24b282a77173c792a0148b0eaa86a2053db5f3d596b9b8eb5b82a` | `8b50db46834b61c2883c65a39e7977bd6ef2588193bd31b0debc220e36e4d12b` | `c280bf8b54561233d218f87a38442259c089024ba56b5d1b5491ea6899d9bf2a` | views at asOf 2027-12-31T03:52:00.000Z |
| `child-only` | `8f29cc7ba576a4686c74933c67444de1a5246b8c653a034081be8a0c6371be8e` | `9181bff49a08614042f28f96416f0423197a8c02543a510b33805345850fd296` | `f254ed46918a7da2ce61901c7f8072b7271f52970b7fb5cad3c3b0e8862041ed` | views at asOf 2026-06-27T02:27:00.000Z |
| `churn-spike` | `4b46df225eab6c10fd8efcfe27b6f5fdddeda27cd75863374de8fe85e3859180` | `0515687d4369168a04a09191241b552ba8fd7e0fd291cd2a019b76979bf93a9a` | `45a27f7354485ba210c37f2953ffbe0e8e6989d4dbbd0be882dfb097b2b088e6` | views at asOf 2026-06-26T22:53:00.000Z |
| `disputes` | `72f0603794f7f620689844211dd40357808c4d07c4b76a426125acdf240e29b9` | `3504c048269137665e3e46dd052ca66c7e443314363c64d5ffd4260a78792939` | `770f3d2710ae5b948537a7a6b39a6e0e58c8af915d63502ddc209d4eea2982d3` | views at asOf 2026-12-30T07:02:00.000Z |
| `fee-oracle` | `85dcbc591de80ecae0badb785845c6cabca85c92d7eda0a3f8692a80abf2ed24` | `39fa669ff25481a48a0d0389163d83b47dda707513cca74222124aa10adbbd9d` | `4c63335b99aa4a8e18535447ec618499eb3495c075f202b3f442bc9f3147a2f1` | views at asOf 2026-06-26T16:53:00.000Z |
| `free-only` | `ac4a781655941878e231c8315f611cdfd4ab81f87cf0bdc17aa1633e51ba8be1` | `1930930534da5d1a383a4619c2e0d5bbe0a4111fd588c9840c5eb2ebd7efa6d5` | `038a48c7949828515f7754b548c2b655dcffb3eba1b073909421a301e846c52e` | views at asOf 2026-12-31T10:23:00.000Z |
| `growth-12mo` | `34936ec2fdf5934080fb2f4056e39cb4bd4f9343eb5e907367ac5192467d2504` | `6dab588ec94c130c88c867efcc006ccd721459a4c3c4e0b5ccccd943514b41be` | `e32df23c3b619265f9aec3f6546a8ea7feeae7cb90caa43742959f1fc643dbef` | views at asOf 2026-12-31T06:19:00.000Z |
| `heavy-refunds` | `9d11b87129800ff0316206a3d7b4370054fe7730aaab054938d164fdb394eeba` | `4ad9b8a23f6440034dee6746684dfdb11b5b8df81de28bdafb89b4fa16e4aa61` | `8192d624d7c54c4676da4f90bf609e79f482a12be9b1edebd300a6069ef0625e` | views at asOf 2026-12-31T06:28:00.000Z |
| `monthly-members` | `9fd0f89bffbb9494deed07a6c751662a61b4107dceddab654d942d51f4562cec` | `53c42fa922683cc67af33a6fd5b4daa0bff44711fe36dc91c940c73ee813f31a` | `b2ca23f18ab5d24a152be091176032533e216f6b5d02a6cf98d40e2e815ae703` | views at asOf 2026-12-28T13:19:00.000Z |
| `non-usd` | `8e22b8e8ff40c08cd3937dfae44abca6725c6842a055b414426486c6dda26f82` | `acb4ce8dcb508cfc629bfde562bec8a3e865983a91597434476add345c190d51` | `5deea82c4730c196fde376738b46feec6b1a2b1b34c33469a6b6a8fb0dc93b96` | views at asOf 2026-12-30T05:09:00.000Z |
| `one-payer-tier` | `1a02d70f55dd33301f28cafa1d204e5749b5d535d25c7601276b7f0eb20416b9` | `b1dec7691c9adb10cd633ea90fc403e028cda5e294f547a6b8ebf96fc84b5f35` | `5203443d9d0e84cfe1da83a82a16cd6183d2fea5d1e9e2f33206f65cd505ad22` | views at asOf 2026-06-28T18:28:00.000Z |
| `seminar-quantities` | `987c2e82a62e841674598e92612972d6d24a8fadd385b18da950c33910ca4685` | `838ca44a83393a23314997a65fe42104b6e83a645a654346e8019f183183bf35` | `120f68b030ccabb5fef77de67e3dd19112205d7e117f5f32ce0eca99a9c50cd0` | views at asOf 2026-06-29T23:53:00.000Z |
| `single-refund-month` | `3533229d368b4cfc6e21ac022a4b7ce5a6bb5238ea08377e8b83c4cfe6bf391d` | `0199ce57aa9ceaa37ad5315ae6603de99cf55c16435b71a994440ab2f70251b0` | `5195f91635c39c0063b5cd668b0f8778a4ff0e6a894ae6bd99be07607e617441` | views at asOf 2026-06-30T22:55:00.000Z |
| `tiny-school` | `3293982d005e904b510e1bae228c203fccb5ee8a585760b55253537ab61a038b` | `accc06a957744a221c0471c3a3c7a9df386f13e68e83650714887cd6ba37ae77` | `ae48d9d656435ae21355983e4a6dac662434fa2c621c677adc1623ea4af90202` | views at asOf 2026-06-30T23:07:00.000Z |
| `yearly-solo` | `fac0eb1df01d4431f2ee16dd9580546b8c63f87249fd3beb796e054136a744b8` | `9ed48a2a712a206b33ab9e030818c0ff0c28f421cc3fdafe42b3676fb5058c94` | `459144e6e1d0fc6a3a14bcf21efb737fafd409a89961e75b45ff69736cf03535` | views at asOf 2026-12-27T16:19:00.000Z |

Presets atm's read slice cannot replay (atm's error, verbatim):

- none
