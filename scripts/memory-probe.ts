import {
  createCuratedPublicationDataset,
  createCuratedPublicationRecords,
  DEFAULT_MEMORY_NAMESPACE,
  memoryAccountScope,
} from '../src/sponsors/curated.js';
import { MemoryOutbox, nativeMemoryClient, sha256 } from '../src/sponsors/memory.js';
import { buildProbeMemoryEvidence, type ProbeRetention } from '../src/sponsors/probe-evidence.js';
import {
  loadAccountChecks,
  requireMemoryProbe,
  requireTatum,
  assertProviderCircuit,
  recordQuotaStop,
  atomicJson,
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
  console.log(
    'SKIPPED: explicit --live is required for one sponsor-funded fictional record. No write was made.',
  );
} else {
  try {
    const checks = await loadAccountChecks();
    requireMemoryProbe(checks);
    requireTatum(checks); // The SDK's public package validation uses only the approved Tatum transport.
    await assertProviderCircuit('memory', checks);
    await assertProviderCircuit('tatum', checks);
    const namespace = process.env.MEMWAL_NAMESPACE ?? DEFAULT_MEMORY_NAMESPACE;
    const accountScope = memoryAccountScope(process.env.MEMWAL_ACCOUNT_ID!, namespace);
    const evidence = await getEvidence();
    const previous = evidence.memory as Record<string, unknown>;
    const access = previous.accountAccessCheck as
      { status?: string; accountScope?: string; observedAt?: string } | undefined;
    const accessAge = Date.now() - Date.parse(access?.observedAt ?? '');
    if (
      access?.status !== 'authenticated-read-confirmed' ||
      access.accountScope !== accountScope ||
      !Number.isFinite(accessAge) ||
      accessAge < 0 ||
      accessAge > 86400000
    )
      throw new Error(
        'A recent successful metadata check for this account and namespace is required before a probe.',
      );
    const record = createCuratedPublicationRecords(createCuratedPublicationDataset()).find(
      (item) => item.recordType === 'observation',
    )!;
    const outbox = new MemoryOutbox(`data/memory-probe/${accountScope}/outbox.json`);
    await outbox.enqueue([record]);
    const client = await nativeMemoryClient();
    try {
      const jobs = await outbox.process(client, 1, 20000);
      const job = jobs.find((item) => item.id === record.id)!;
      if (job.error?.code === 'quota') await recordQuotaStop('memory', job.error);
      let retrieved = false;
      let retention: ProbeRetention | null = null;
      if (job.state === 'confirmed') {
        const recalled = await client.recall({
          query: `Payday Memory ${record.id}`,
          namespace,
          limit: 20,
        });
        retrieved = recalled.results.some((hit) => {
          try {
            return hit.blob_id === job.blobId && sha256(JSON.parse(hit.text)) === job.payloadHash;
          } catch {
            return false;
          }
        });
        const page = await client.listMemories({ namespace, limit: 100 });
        const metadata = page.memories.find((item) => item.blob_id === job.blobId);
        if (metadata)
          retention = {
            expiresAt: metadata.expires_at,
            endEpoch: metadata.end_epoch,
            throughJudging:
              Number.isFinite(Date.parse(metadata.expires_at ?? '')) &&
              Date.parse(metadata.expires_at!) >= Date.parse('2026-11-17T23:59:59Z'),
          };
        if (retention?.throughJudging) {
          checks.memory!.retentionThrough = retention.expiresAt!;
          await atomicJson('data/account-checks.json', checks);
        }
      }
      evidence.memory = buildProbeMemoryEvidence(previous, {
        accountScope,
        namespace,
        job,
        retrieved,
        retention,
        checkedAt: new Date().toISOString(),
      });
      evidence.lastCheckAt = new Date().toISOString();
      await saveEvidence(evidence);
      console.log(
        JSON.stringify(
          {
            status: (evidence.memory as { status: string }).status,
            retrieved,
            jobId: job.providerJobId ?? null,
            blobId: job.blobId ?? null,
            retention,
            maximumWrites: 1,
            actualConfirmedMemories: (evidence.memory as { confirmedCount: number }).confirmedCount,
          },
          null,
          2,
        ),
      );
      if (job.state !== 'confirmed' || !retrieved) process.exitCode = 1;
    } finally {
      client.destroy?.();
    }
  } catch (error) {
    await recordQuotaStop('memory', error);
    await reportFailure(error);
  }
}
