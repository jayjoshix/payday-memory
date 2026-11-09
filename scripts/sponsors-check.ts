import {
  loadAccountChecks,
  requireTatum,
  requireMemory,
  safeFailure,
  assertProviderCircuit,
  recordQuotaStop,
  supportedMemoryRuntime,
} from '../src/sponsors/safety.js';
import { nativeTatumReads, TatumAdapter } from '../src/sponsors/tatum.js';
import { nativeMemoryClient, MemoryOutbox, sha256 } from '../src/sponsors/memory.js';
import { createMemoryRecords, createSampleDataset } from '../src/domain/index.js';
import {
  DEFAULT_MEMORY_NAMESPACE,
  memoryAccountScope,
  memoryEvidenceForScope,
} from '../src/sponsors/curated.js';
import {
  getEvidence,
  saveEvidence,
  loadLocalEnv,
  liveRequested,
  reportFailure,
} from './sponsors-common.js';
const evidencePathHint = 'evidence/manifest.json';
loadLocalEnv();
const evidence = await getEvidence();
evidence.lastCheckAt = new Date().toISOString();
const present = Object.fromEntries(
  ['TATUM_API_KEY', 'MEMWAL_KEY', 'MEMWAL_ACCOUNT_ID', 'MEMWAL_AGENT_ID'].map((name) => [
    name,
    Boolean(process.env[name]),
  ]),
);
if (!liveRequested()) {
  const accountGates: Record<string, { status: string; reason?: string }> = {};
  try {
    const checks = await loadAccountChecks();
    for (const [provider, check] of [
      ['tatum', requireTatum],
      ['memory', requireMemory],
    ] as const) {
      try {
        check(checks);
        accountGates[provider] = { status: 'ready-for-explicit-check' };
      } catch (error) {
        accountGates[provider] = { status: 'blocked', reason: safeFailure(error).message };
      }
    }
  } catch (error) {
    const reason = safeFailure(error).message;
    accountGates.tatum = { status: 'blocked', reason };
    accountGates.memory = { status: 'blocked', reason };
  }
  evidence.connectionSetup = {
    checkedAt: new Date().toISOString(),
    credentialsPresent: present,
    runtime: process.versions.node,
    runtimeSupportedForMemory: supportedMemoryRuntime(),
    accountGates,
    authenticatedProviderCallsMade: 0,
    mainnetWritesMade: 0,
  };
  await saveEvidence(evidence);
  console.log(
    JSON.stringify(
      {
        status: 'skipped',
        reason:
          'Readiness inspection only. Explicit --live and timestamped account checks are required for external operations.',
        credentialsPresent: present,
        runtime: process.versions.node,
        accountGates,
        actualMainnetConfirmations:
          (
            evidence.memory as {
              confirmedCount?: number;
            }
          )?.confirmedCount ?? 0,
      },
      null,
      2,
    ),
  );
} else {
  try {
    const checks = await loadAccountChecks();
    const previousTatum = evidence.tatum as Record<string, unknown>;
    try {
      requireTatum(checks);
      await assertProviderCircuit('tatum', checks);
      const adapter = new TatumAdapter(nativeTatumReads(process.env.TATUM_API_KEY!));
      try {
        const balanceSnapshot = await adapter.snapshot(process.env.TATUM_PUBLIC_ADDRESS ?? '');
        const receipts = process.env.TATUM_TRANSACTION_DIGEST
          ? await adapter.receipt(
              process.env.TATUM_TRANSACTION_DIGEST,
              process.env.TATUM_PUBLIC_ADDRESS ?? '',
            )
          : [];
        evidence.tatum = {
          status: 'confirmed',
          provider: 'Tatum',
          network: 'sui-mainnet',
          capturedAt: new Date().toISOString(),
          balanceSnapshot,
          receipts,
          requestsUsed: adapter.requestsUsed,
          coverage: {
            mode: 'one-address-one-optional-digest',
            completeWalletHistory: false,
            statement:
              'No history scan was performed. Invoice aliases, due dates and purposes remain hypothetical user assertions.',
          },
        };
      } finally {
        adapter.close();
      }
    } catch (error) {
      await recordQuotaStop('tatum', error);
      const snapshot = previousTatum?.balanceSnapshot as Record<string, unknown> | undefined;
      evidence.tatum = {
        ...previousTatum,
        status: snapshot ? 'stale' : 'failed',
        ...(snapshot ? { balanceSnapshot: { ...snapshot, stale: true } } : {}),
        lastFailure: { ...safeFailure(error), at: new Date().toISOString() },
      };
    }
    const namespace = process.env.MEMWAL_NAMESPACE ?? DEFAULT_MEMORY_NAMESPACE;
    const accountScope = /^0x[0-9a-fA-F]{64}$/.test(process.env.MEMWAL_ACCOUNT_ID ?? '')
      ? memoryAccountScope(process.env.MEMWAL_ACCOUNT_ID!, namespace)
      : undefined;
    const previousMemory = accountScope
      ? memoryEvidenceForScope(evidence.memory, accountScope)
      : (evidence.memory as Record<string, unknown>);
    try {
      requireMemory(checks);
      await assertProviderCircuit('memory', checks);
      const client = await nativeMemoryClient();
      try {
        const record = createMemoryRecords(createSampleDataset()).find(
          (r) => r.recordType === 'observation',
        )!;
        const outbox = new MemoryOutbox(`data/memory-smoke/${accountScope!}/outbox.json`);
        await outbox.enqueue([record]);
        const jobs = await outbox.process(client, 1, 20000);
        const job = jobs[0]!;
        if (job.error?.code === 'quota') await recordQuotaStop('memory', job.error);
        let retrieved = false;
        if (job.state === 'confirmed') {
          const hits = await client.recall({
            query: `Payday Memory ${record.id}`,
            namespace,
            limit: 100,
          });
          retrieved = hits.results.some((h) => {
            try {
              return h.blob_id === job.blobId && sha256(JSON.parse(h.text)) === job.payloadHash;
            } catch {
              return false;
            }
          });
        }
        const previousRecords = (previousMemory.records ?? []) as {
          id: string;
          state: string;
          blobId: string | null;
        }[];
        const records = [
          ...previousRecords.filter((r) => r.id !== job.id),
          ...jobs.map((j) => ({
            id: j.id,
            state: j.state,
            jobId: j.providerJobId ?? null,
            blobId: j.blobId ?? null,
            verifiedAt: j.verifiedAt ?? null,
            payloadHash: j.payloadHash,
          })),
        ];
        const confirmedCount = new Set(
          records.filter((r) => r.state === 'confirmed' && r.blobId).map((r) => r.blobId),
        ).size;
        evidence.memory = {
          ...previousMemory,
          accountScope,
          namespace,
          status: job.state === 'confirmed' && retrieved ? 'confirmed' : 'pending',
          provider: 'Walrus Memory',
          network: 'sui-mainnet',
          managedRelayer: 'https://relayer.memory.walrus.xyz',
          capturedAt: new Date().toISOString(),
          confirmedCount,
          requiredCount: 10,
          retrieved,
          records,
          smokeRoundTrip: { state: job.state, retrieved, checkedAt: new Date().toISOString() },
          reason: retrieved
            ? 'Genuine fictional record completion and retrieval confirmed. Submission also requires ten distinct completed records and complete recovery.'
            : 'No completed smoke round trip was confirmed.',
        };
      } finally {
        client.destroy?.();
      }
    } catch (error) {
      await recordQuotaStop('memory', error);
      evidence.memory = {
        ...previousMemory,
        status: 'failed',
        lastFailure: { ...safeFailure(error), at: new Date().toISOString() },
      };
    }
    evidence.capturedAt = new Date().toISOString();
    evidence.status = 'operator-check-completed';
    evidence.claims = {
      fixture: 'Authored fictional payment history.',
      chain: (
        evidence.tatum as {
          balanceSnapshot?: unknown;
        }
      ).balanceSnapshot
        ? 'Genuine timestamped Tatum balance; planning assumptions remain hypothetical.'
        : 'No genuine chain observation confirmed.',
      storage: `${
        (
          evidence.memory as {
            confirmedCount?: number;
          }
        ).confirmedCount ?? 0
      } genuinely confirmed Mainnet records; see returned receipts.`,
    };
    await saveEvidence(evidence);
    console.log(
      JSON.stringify(
        {
          status: evidence.status,
          tatum: (
            evidence.tatum as {
              status: string;
            }
          ).status,
          memory: (
            evidence.memory as {
              status: string;
            }
          ).status,
          evidence: evidencePathHint,
        },
        null,
        2,
      ),
    );
    if (
      (
        evidence.tatum as {
          status: string;
        }
      ).status !== 'confirmed' ||
      (
        evidence.memory as {
          status: string;
        }
      ).status !== 'confirmed'
    )
      process.exitCode = 1;
  } catch (error) {
    await reportFailure(error);
  }
}
