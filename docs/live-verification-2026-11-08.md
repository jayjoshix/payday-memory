# Genuine sponsor verification — 8 November 2026

The billing gates are now open based on the builder's dashboard attestations: Tatum free plan, no payment method, automatic upgrades OFF and all 100,000 credits unused before this run. The application did not inspect the dashboard directly. That number is a timestamped pre-run statement, not a claim about the remaining balance after these calls.

## Tatum

`npm run tatum:read -- --live` made one genuine read-only Sui Mainnet native USDC balance request. It returned **0 base units** for the supplied public address at **2026-11-08T11:56:00.725Z**. There is no wallet-owner assertion, transaction-history completeness claim or verified client receipt. The connected preview uses this actual snapshot with explicitly hypothetical bills and income.

The first eight-second attempt timed out. DNS, TLS and an unauthenticated native gRPC readiness check then passed. A bounded retry succeeded with a 15-second deadline and channel retry/DNS policy disabled so the application controls retry work. The timeout remains historical evidence, not a successful read.

The installed official Memory SDK also needs an immutable package-object read for its Seal session. The application adapts that SDK request in process to Tatum `LedgerService/GetObject`. A genuine response for the relayer's package, version 1, was observed. No advertised third-party RPC host was contacted. The latest redacted object observation is in the local operator data and reflected in the public proof manifest.

## Walrus Memory

The corrected account/delegate authenticated on the official managed Mainnet relayer. The first meaningful fictional observation was accepted as job `f7375b5f-300e-4ba0-bc03-6a0efbd001d6`. The first bounded polling window ended pending; the next invocation resumed that same job without a duplicate submission. Completion returned blob `gqMrq73a9JkjwtwX1gcLqXOONo7KLX8HrvvACOXTheM`, and recall retrieved matching structured content and hash.

This is real Mainnet storage of fictional history. All writes occurred during this build; the dates inside the fictional observations do not establish earlier Mainnet authorship, real customers or economic accuracy.

The full curated publication contains 20 meaningful records: a corrected dataset, source observations, the reimbursement correction, current timing lessons and the superseded lesson. A separately completed manifest binds every source ID, blob and content hash. Consult [the actual evidence manifest](../evidence/manifest.json) for current counts and completion/recovery timestamps; attempts and retries never count as extra memories.

## Complete retrieval and finite expiry verified

At **2026-11-08T12:25:22.569Z**, `memory:verify` retrieved all 20 source records and the separate confirmed manifest into a newly created empty directory. It reproduced three active lessons, including Paper Lane's corrected insufficient-history state, while preserving the prior lesson and unchanged held cash. The recovered dataset hash is `9bdaa58aa5d2480313ffcf9022a731a83a37aad0938bfbd4f12b355b9a95921e`.

The first probe's inventory initially returned null expiry fields. The later complete inventory returned **end epoch 58** and expiry dates on **6 June 2027** for all 21 required blobs. The earliest observed expiry is `2027-06-06T12:00:26.242146Z`, after the checked judging period and the application's 17 November margin. The manifest records every returned value. Null fields were never treated as permanent storage. This verifies finite expiry through judging, not an availability SLA or everlasting storage.

The initial implementation blocked bulk work until a calendar expiry was present. After the first genuine completed record exposed no such metadata, storage expiry was separated from the monetary safety gates and retained as an explicit verification result. The later full-set assessment passed. Verified managed sponsorship, free onboarding, provider-enforced limits, application caps and persistent quota stops remain required. No renewal, token purchase, self-funded uploader or additional RPC provider was added.

## Reproduce as a local operator

```sh
npm run sponsors:check
npm run tatum:read -- --live
npm run memory:probe -- --live
npm run memory:publish -- --live --max-records=4
npm run memory:verify -- --live
```

Do not repeat publication just to increase a count. Confirmed jobs are retained, pending jobs resume, IDs are stable, and quota failures stop the affected integration. A fresh recovery writes to a newly created empty directory, validates the retrieved manifest and every record, and recomputes active lessons. Only a fictional recovered dataset is copied to the captured judge artifact.

The browser's **Load recovered sample** validates the captured dataset hash, account scope, manifest and verification time before replacing its own disposable copy. It performs no new sponsor request. Fresh Mainnet retrieval is an explicit operator CLI action.

Public hosting, repository/article/video publication and organizer acceptance of the static distribution remain separate requirements. No public URL has been created by these checks. The official event portal was rechecked on 8 November: the deadline remains 10 November 2026 at 17:00 UTC (22:30 IST), with judging 11–16 November.
