import { TatumAdapter, nativeTatumReads } from '../src/sponsors/tatum.js';
import {
  loadAccountChecks,
  requireTatum,
  assertProviderCircuit,
  recordQuotaStop,
  safeFailure,
} from '../src/sponsors/safety.js';
import {
  loadLocalEnv,
  liveRequested,
  getEvidence,
  saveEvidence,
  reportFailure,
} from './sponsors-common.js';

loadLocalEnv();
if (!liveRequested()) {
  console.log('SKIPPED: explicit --live is required for one read-only Tatum balance request.');
} else {
  const evidence = await getEvidence();
  const previous = evidence.tatum as Record<string, unknown>;
  let adapter: TatumAdapter | undefined;
  try {
    const checks = await loadAccountChecks();
    requireTatum(checks);
    await assertProviderCircuit('tatum', checks);
    adapter = new TatumAdapter(nativeTatumReads(process.env.TATUM_API_KEY!), 1);
    const balanceSnapshot = await adapter.snapshot(process.env.TATUM_PUBLIC_ADDRESS ?? '');
    evidence.tatum = {
      ...previous,
      status: 'confirmed',
      provider: 'Tatum',
      network: 'sui-mainnet',
      capturedAt: balanceSnapshot.observedAt,
      balanceSnapshot,
      receipts: [],
      requestsUsed: adapter.requestsUsed,
      maximumRequests: 1,
      documentedCreditUpperBound: checks.tatum!.creditCostUpperBoundPerRead,
      coverage: {
        mode: 'one-public-address-balance-only',
        completeWalletHistory: false,
        statement:
          'No transaction history was scanned. Wallet ownership is not asserted; the planning layer remains hypothetical.',
      },
      reason:
        'Genuine read-only Tatum balance captured. Expected payments, client aliases and obligations remain fictional assumptions.',
    };
    evidence.lastCheckAt = new Date().toISOString();
    evidence.claims = {
      ...(evidence.claims as Record<string, unknown>),
      chain:
        'Genuine timestamped Tatum native USDC balance; no verified receipt or complete-history claim. Planning assumptions remain hypothetical.',
    };
    await saveEvidence(evidence);
    console.log(
      JSON.stringify(
        {
          status: 'confirmed',
          provider: 'Tatum',
          network: 'sui-mainnet',
          balanceSnapshot,
          requestsUsed: adapter.requestsUsed,
          maximumRequests: 1,
          documentedCreditUpperBound: checks.tatum!.creditCostUpperBoundPerRead,
          historyCoverage: 'balance only; no receipt or complete-history claim',
        },
        null,
        2,
      ),
    );
  } catch (error) {
    await recordQuotaStop('tatum', error);
    const snapshot = previous.balanceSnapshot as Record<string, unknown> | null | undefined;
    evidence.tatum = {
      ...previous,
      status: snapshot ? 'stale' : 'failed',
      ...(snapshot ? { balanceSnapshot: { ...snapshot, stale: true } } : {}),
      lastFailure: { ...safeFailure(error), at: new Date().toISOString() },
      requestsAttempted: adapter?.requestsUsed ?? 0,
      maximumRequests: 1,
    };
    evidence.lastCheckAt = new Date().toISOString();
    await saveEvidence(evidence);
    await reportFailure(error);
  } finally {
    adapter?.close();
  }
}
