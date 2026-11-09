# Payday Memory

A cash-flow planner that remembers how you actually get paid.

**Target: Total Recall — Tatum × Walrus, Track 3: Consumer Finance Apps.** This is a single-operator local application with a disposable, fictional judge sample. It uses deterministic arithmetic and a documented median timing rule; there is no LLM, bank connection, custody, payment execution or paid service dependency.

## Readiness

On 8 November, a genuine read-only Tatum native USDC balance check and sponsored Walrus Mainnet publication/recovery succeeded. **20 meaningful fictional records plus a separate manifest** were completed and retrieved into an empty directory, reproducing three active lessons. The connected preview uses the actual captured zero balance with hypothetical planning assumptions. The later complete inventory returned finite expiry in June 2027 for all 21 blobs, covering judging. See [the live verification report](docs/live-verification-2026-11-08.md). The [source repository](https://github.com/jayjoshix/payday-memory) was published and verified publicly accessible on 9 November 2026. Public app hosting, article publication and a verified video watch URL remain pending.

| Area                             | Status                                                                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Local application                | Verified: 71 offline tests and 24 browser checks; final build/static results are in `docs/handoff.md`                                    |
| Fictional replay                 | Offline, authored data; never customer evidence                                                                                          |
| Tatum account                    | Genuine balance and package-object reads passed. Billing/quota checks are builder-attested; no real receipt or complete history claimed. |
| Walrus Mainnet                   | 20 source records plus manifest completed and retrieved; clean recovery passed; all 21 observed expiries cover judging.                  |
| Ten confirmed Mainnet memories   | Passed: 20 distinct meaningful source records; manifest counted separately. Actual IDs and timestamps are in the evidence manifest.      |
| Public repository                | Published at [jayjoshix/payday-memory](https://github.com/jayjoshix/payday-memory); anonymous access verified on 9 November 2026.        |
| Public demo/blog/video watch URL | Pending. The captioned video file is included in the repository; no separate watch URL or app deployment is confirmed.                   |

The event page checked during implementation lists **10 November 2026, 17:00 UTC (22:30 IST)**. Recheck [the official event page](https://tatum.io/hackathon/total-recall) before submission. Organizer acceptance of a static sample plus recorded operator integration is still a builder check.

## Run locally

Use Node **24.14+** for the offline app. The Memory SDK has a higher documented runtime floor; check `docs/sponsor-research.md` before live Memory work. Dependency versions are pinned by `package-lock.json`.

```sh
npm ci
npm run demo:seed
npm run dev
```

Open **http://127.0.0.1:4173**. The sample requires no signup, wallet or funds. Browser edits persist in that browser profile's `localStorage` and belong to its disposable sample. **New sample** clears that copy only. Browser profiles have separate copies; tabs in the same profile share the same storage key. The optional server sample-session API isolates copies by unguessable identifiers and persists them separately from canonical operator state; the interface uses browser storage directly.

![The working overview showing fictional cash, bills and three cash-flow assumptions](docs/screenshots/overview-desktop.png)

```sh
npm run typecheck
npm run lint
npm test
npm run test:e2e
npm run build
npm run test:static
npm start
npm run replay:evaluate
npm run evidence:verify
npm run demo:reset
```

Browser checks were run with the existing Microsoft Edge on Windows. Other platforms default to Playwright Chromium; install it with the free local command `npx playwright install chromium`. `PLAYWRIGHT_CHANNEL` can select an installed supported browser. The latest [2:45.5 captioned submission video](docs/demo/payday-memory-submission.webm) shows the application after the 9 November fixes. Captions are permanently embedded below a fixed-size application view. See the [storyboard and recording notes](docs/demo-storyboard.md) for provenance and reproduction commands.

`demo:seed`, normal tests and replay never call sponsors. The seed command writes an operator fixture to `.data/canonical.json`; the browser initializes its own authored sample. `demo:reset` clears only disposable server session files; it preserves canonical state, outbox files, captured evidence and every published memory. Use **New sample** in the app to clear a browser copy.

The production server serves `dist` and listens on loopback only. It writes durable local files under ignored `.data`. It is a local operator distribution, not a hosted multi-user service. A static host may serve `dist` for browser replay, but cannot run the Node server, keep the outbox, sign, use gRPC or provide live sponsor routes.

In **Memory & evidence**, **Export local sample** and **Restore local export** handle browser JSON. **Load recovered sample** instead validates the captured Mainnet recovery against its dataset hash, account scope, manifest and verification time, then loads a disposable copy. It makes no sponsor request. `npm run memory:verify -- --live` performs a fresh real retrieval into an empty local directory and refreshes that captured artifact.

In **Expected payments**, **Add sample receipt** authors a fictional outcome without executing or verifying a transaction. The receipt becomes cash once; **Match** then lets you allocate some or all of it to an expected payment. Matching reduces the amount still expected and does not add cash a second time. This action is disabled in a captured connected workspace, where receipt evidence must come from the read-only Tatum adapter.

The displayed evaluation is a fixed chronological benchmark on the canonical authored fixture. Disposable judge edits change the interactive plan, not the reported benchmark cases or frozen predictions.

**Load exceptional-delay example** in Memory & evidence opens a separate authored fictional dataset. Aster has one 21-day processing delay. Replay 3 and 4 November to see its explicit exclusion change a four-observation, one-day cautious delay to three observations and zero days. The receipt stays in history and held cash remains $1,250. This example does not replace the published recovery capture or canonical benchmark.

## Safe sponsor setup

Copy `.env.example` to **`.env.local`** and fill it locally from the official dashboards. Never paste secret values into chat, put them in `VITE_*` variables, or commit the file. Only these product credentials are used:

| Variable                   | Meaning                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `TATUM_API_KEY`            | Secret Tatum key for read-only Sui access                        |
| `TATUM_PUBLIC_ADDRESS`     | Public Sui address; no ownership or client identity is asserted  |
| `TATUM_TRANSACTION_DIGEST` | Optional public transaction to validate                          |
| `MEMWAL_KEY`               | Secret Memory delegate credential                                |
| `MEMWAL_ACCOUNT_ID`        | Memory account object ID                                         |
| `MEMWAL_AGENT_ID`          | Public delegate key, distinct from the credential and account ID |
| `MEMWAL_NAMESPACE`         | Fictional application dataset namespace; it is not authorization |
| `PAYDAY_OPERATOR_TOKEN`    | At least 24 random characters for local operator HTTP actions    |

Before any live call, inspect the account dashboard yourself: no payment method or paid agreement, no automatic upgrades, actual remaining credits, Sui transport availability, free delegate/account onboarding and managed Mainnet sponsorship. Copy `evidence/account-checks.example.json` to ignored `data/account-checks.json` and record the actual account-specific facts required by `docs/sponsor-research.md`. False/zero defaults block live calls; a checklist assertion is not a substitute for inspecting the account.

The initial build had no sponsor credentials. Credentials were configured on 8 November; this does not verify account billing settings, quota or successful Mainnet storage. Do not buy assets, fund an account, use a self-funded Walrus uploader or turn on paid renewal to make a command succeed.

```sh
npm run sponsors:check
npm run memory:account-check -- --live
npm run tatum:read -- --live
npm run memory:probe -- --live
npm run sponsors:check -- --live
npm run memory:publish -- --live --max-records=1
npm run memory:verify -- --live
```

These are separate, explicit operator commands. `sponsors:check` without `--live` is offline readiness only. Live commands cap work, preserve durable job status under ignored `data/` and stop on missing gates, quota exhaustion or provider failure. Read their output and `evidence/manifest.json`; **skipped is not passed**. A queued `remember()` operation is not a confirmed write. Confirmation requires completion and retrieval, with the real job/blob references and verification timestamp.

The one-record probe confirms completion/retrieval and inspects returned expiry, which may remain unknown. `tatum:read` separately caps its balance read at one request. The combined live check permits up to two product Tatum reads, at most one SDK package read, and one Memory round trip. Publish the curated set only after genuine initial verification. The application limits curated sources plus manifest to 25, obeys the provider's enforced free limits and stops on quota failures. After all sources complete, another capped invocation publishes the manifest. Count unique completed, retrieved records. Missing expiry never passes the separate judging-time retention check.

The default curated publication contains 20 fictional records, including the original reimbursement receipt, its preserved allocation, a correction, the prior timing lesson and the revised lesson. All 20 and their separate manifest have actual Mainnet completion and retrieval evidence. An operator can also select a reviewed fictional browser export with `npm run memory:publish -- --live --dataset=path/to/export.json --max-records=1`. Content-specific IDs and isolated outboxes prevent a changed export from silently replacing an immutable record. Connected chain records are excluded from this fictional publication path.

## How planning works

Amounts are integer base-unit strings and calculate with `bigint`. The sample uses six decimals and the native Sui USDC coin type from [Circle's Sui asset documentation](https://www.circle.com/multi-chain-usdc/sui). A display symbol is insufficient to validate a receipt. No SUI/USD conversion is made.

The configured calendar timezone is **Asia/Kolkata**. A day view includes records known by that calendar day's end. Receipt occurrence and knowledge times are separate. Fictional cash is reconstructed from the opening balance, chronological successful receipts and paid obligations; reclassifying income never removes the physical cash. Connected balances are timestamped snapshots and must not receive imported receipts again.

Payment matching is explicit. A successful receipt must have the expected coin type and recipient. Transfer identity deduplicates imports. Partial allocations cannot exceed either the receipt or invoice. An address does not establish the payer's client alias, invoice due date or purpose; those remain user assertions.

For each client, learning uses **fully paid date minus due date** for the most recent six eligible settled invoices. With fewer than three completed observations, the entered planning date remains. Otherwise the median calendar delay is rounded up when necessary and clamped to zero for cautious planning. Early arrivals remain evidence but never pull a cautious date earlier. Exceptions and reimbursements append versioned corrections; previous interpretations remain available for replay. Outstanding past estimates become unknown rather than magically received or moved to tomorrow.

The three scenarios share one fixed **30-day horizon**: promised dates, learned dates and no further income. A hypothetical purchase only subtracts from its selected date onward. The decision compares the minimum balance from purchase date through the same horizon with the chosen cash buffer. Warnings describe assumptions, not guarantees. Settled-only histories can miss the slowest unresolved invoices; unresolved counts and this bias stay visible.

## Architecture

```text
src/domain/      Exact money, dates, receipts, learning, scenarios, replay, recovery
src/sponsors/    Tatum read adapter, official Memory SDK adapter, durable outbox
src/server/      Loopback HTTP server, atomic JSON persistence, operator guard
src/            React interface; never imports sponsor credentials/signing clients
scripts/        Offline seed/reset/replay and separate bounded sponsor commands
tests/          Offline domain, provenance, quota, recovery and server invariants
e2e/            Browser flow, responsiveness, keyboard checks and app captures
evidence/       Redacted captured verification; account-specific proof is ignored
docs/           Build notes, factual blog draft, storyboard and submission preparation
```

The server uses atomic file replacement and a serialized write queue. Corrupt history produces a visible error instead of an empty replacement. This compact design supports one local process; it does not claim cross-process transactions, multi-user production isolation or an independent security audit.

Replay processes explicit records by knowledge time before that instant's authored outcome, freezes only outstanding targets, and reports excluded cases separately. Later conflicting matches stop replay at their reveal boundary instead of changing an earlier prediction. The manifest outbox uses bounded durable attempts and migrates older confirmed or pending jobs without resubmitting them. HTTP 429 retains its quota classification before SDK preflight handling and stops the affected client.

Memory records have stable IDs, schema/dataset/provenance, occurrence and knowledge times, effective versions, source IDs and algorithm version. The outbox distinguishes pending, failed and confirmed records. Reconstruction uses an explicit completeness manifest and retrieved records, validates schemas and deterministically selects active versions. Semantic recall supplies related explanations; it is never treated as an exhaustive latest-fact ledger. A valid recovery demonstration starts in an empty disposable directory, not the original local database.

## Evidence and privacy

The normal sample is fictional. User assumptions, genuine chain observations and genuine Mainnet storage confirmations have independent provenance. A fictional receipt written to Mainnet remains fictional history with a real storage receipt. It does not establish historical authorship or economic accuracy.

Only selected fictional application records may be published through the managed relayer. The relayer handles plaintext. Do not put real financial records or unrelated conversation history into this dataset. Captured evidence is labelled with its capture time; it is not live. No analytics, cookies for tracking, email service, external financial-data service or hosted database is included.

## Submission materials

Read [the blog draft](docs/blog-draft.md), [demo storyboard](docs/demo-storyboard.md), [submission preparation](docs/submission-preparation.md), [publication instructions](docs/publication.md), [cost inventory](docs/cost-inventory.md) and [verification handoff](docs/handoff.md). The blog is a factual draft to edit in your own voice. Form preparation is an outline for the builder's own answers. Source publication is complete; app hosting, article publication, a verified video watch URL and form submission remain pending. No domain or paid hosting was purchased.

The [9 November audit fixes](docs/audit-fixes-2026-11-09.md) address quota stops, manifest failures, replay chronology, imported-date bounds, proof scoping, stale-balance explanations and dialog names. `npm run evidence:verify` checks the captured source/manifest hashes and expiry records entirely offline; it makes no freshness or current-provider-availability claim.

The latest [2:45.5 captioned submission video](docs/demo/payday-memory-submission.webm) and [recording metadata](docs/demo/captioned-recording.json) cover the 9 November application, including the separate exceptional-delay example. This is continuous actual application footage with permanent captions and a fixed 1440×1080 frame: a 1440×900 application view plus a caption band. The Mainnet recovery and Tatum snapshot are genuine **8 November captured evidence**. The new recording runs a local offline integrity check and loads the hash-checked capture into a clean disposable browser copy. It makes **zero provider requests**, performs no fresh Mainnet retrieval and publishes no memory. Automated checks of 166 one-second samples and visual inspection of the contact sheet and selected full-size frames passed; see [the review record](docs/demo/captioned-video-review.json). This was sampled frame review, not continuous playback review. The uncut files remain local and excluded from Git; the genuine 8 November operator run is documented by [its retained receipt](docs/demo/sponsor-recording.json) and [verification report](docs/live-verification-2026-11-08.md).

The presentation removes only 2.6 seconds of reviewed browser startup from the 167.96-second original. The remaining application run is continuous, with no cropping or scaling. Reproduce the captioned capture with the app running: `npm run demo:record:captioned`, then `python scripts/encode-captioned-demo.py --startup-seconds 2.6` using the existing Playwright FFmpeg encoder and Pillow. Review the new capture's startup before reusing that offset. This flow verifies captured artifacts offline. The separate historical operator recorder, `npm run demo:record:sponsors -- --live`, explicitly performs a fresh provider retrieval only after its account gates pass; it never publishes a memory. Without `--live`, that command skips.

Current limits include a small authored evaluation, no real customer validation, no probability or trained-model claim, no live onchain receipt or complete-history claim, and no public app deployment. The public source repository is separate from hosting the application.

Sponsor commands select the verified portable Node runtime under ignored `.tooling` when it is present on Windows; otherwise they use the installed system Node. This leaves the system installation unchanged. `memory:account-check -- --live` is an explicit bounded metadata read, not a memory upload.

The one-record probe uses verified managed sponsorship and provider-enforced shared limits; it does not invent a numeric remaining allowance. Null expiry remains unknown. Complete recovery assesses each required blob's expiry separately from current retrieval success, and never triggers paid renewal. The SDK package-validation read uses Tatum native gRPC, with private headers, arbitrary objects, write methods and alternate RPC fallbacks blocked.
