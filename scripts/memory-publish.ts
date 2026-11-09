import { type Dataset } from '../src/domain/index.js';
import {
  createCuratedPublicationDataset,
  createCuratedPublicationRecords,
  prepareFictionalExport,
  DEFAULT_MEMORY_NAMESPACE,
  memoryAccountScope,
  memoryEvidenceForScope,
} from '../src/sponsors/curated.js';
import {
  atomicJson,
  loadAccountChecks,
  readJson,
  requireMemory,
  assertProviderCircuit,
  recordQuotaStop,
} from '../src/sponsors/safety.js';
import {
  nativeMemoryClient,
  MemoryOutbox,
  MemoryManifestOutbox,
  createPublicationManifest,
  sha256,
  type PublicationManifest,
} from '../src/sponsors/memory.js';
import {
  loadLocalEnv,
  liveRequested,
  cappedArgument,
  reportFailure,
  getEvidence,
  saveEvidence,
} from './sponsors-common.js';
loadLocalEnv();
if (!liveRequested()) {
  console.log('SKIPPED: add --live after reviewing zero-cost account checks. No upload was made.');
} else {
  try {
    const checks = await loadAccountChecks();
    requireMemory(checks);
    await assertProviderCircuit('memory', checks);
    const max = cappedArgument('max-records', 1, 25);
    if (checks.memory!.freeLimitRecords > 0 && max > checks.memory!.freeLimitRecords)
      throw new Error('Requested cap exceeds the verified free record allowance.');
    const datasetPath = process.argv
      .find((argument) => argument.startsWith('--dataset='))
      ?.slice('--dataset='.length);
    const dataset = datasetPath
      ? prepareFictionalExport(await readJson<Dataset>(datasetPath))
      : createCuratedPublicationDataset();
    console.log(
      'Selected fictional publication. User-entered sample fields remain hypothetical planning assertions. Never include personal financial records in this operator command.',
    );
    const namespace = process.env.MEMWAL_NAMESPACE ?? DEFAULT_MEMORY_NAMESPACE;
    const accountScope = memoryAccountScope(process.env.MEMWAL_ACCOUNT_ID!, namespace);
    const publicationDirectory = `data/publications/${sha256({ datasetId: dataset.id, namespace, accountId: process.env.MEMWAL_ACCOUNT_ID }).slice(0, 24)}`;
    const outbox = new MemoryOutbox(`${publicationDirectory}/outbox.json`);
    const before = await outbox.enqueue(createCuratedPublicationRecords(dataset));
    if (
      before.length + 1 > 25 ||
      (checks.memory!.freeLimitRecords > 0 && before.length + 1 > checks.memory!.freeLimitRecords)
    )
      throw new Error(
        'Curated records plus manifest exceed the verified free allowance. Stop instead of upgrading.',
      );
    const alreadyComplete = before.every((j) => j.state === 'confirmed');
    const client = await nativeMemoryClient();
    try {
      const jobs = await outbox.process(client, max);
      if (jobs.some((job) => job.state === 'failed' || job.error?.code === 'quota'))
        process.exitCode = 1;
      for (const job of jobs)
        if (job.error?.code === 'quota') await recordQuotaStop('memory', job.error);
      const confirmed = jobs.filter((j) => j.state === 'confirmed');
      let publication: PublicationManifest | undefined;
      let manifestReceipt: Record<string, unknown> | undefined;
      if (alreadyComplete && confirmed.length === jobs.length) {
        publication = createPublicationManifest(jobs, dataset.id);
        const state = await new MemoryManifestOutbox(
          `${publicationDirectory}/manifest-job.json`,
        ).process(client, publication, { namespace, accountId: process.env.MEMWAL_ACCOUNT_ID! });
        publication = state.manifest;
        if (state.error?.code === 'quota') await recordQuotaStop('memory', state.error);
        if (state.state === 'failed' || state.error?.code === 'quota') process.exitCode = 1;
        await atomicJson('evidence/recovery-manifest.json', publication);
        if (state.blobId && state.verifiedAt) await atomicJson('data/publication-job.json', state);
        manifestReceipt = {
          jobId: state.jobId,
          blobId: state.blobId ?? null,
          verifiedAt: state.verifiedAt ?? null,
          sha256: sha256(publication),
          state: state.state,
          attempts: state.attempts,
          error: state.error ?? null,
        };
      }
      const evidence = await getEvidence();
      evidence.capturedAt = new Date().toISOString();
      const confirmedCount = new Set(confirmed.map((job) => job.blobId)).size;
      evidence.status = manifestReceipt?.blobId
        ? 'mainnet-records-confirmed-awaiting-recovery'
        : 'mainnet-publication-in-progress';
      evidence.memory = {
        ...memoryEvidenceForScope(evidence.memory, accountScope),
        accountScope,
        status:
          confirmed.length === jobs.length && manifestReceipt?.blobId
            ? 'confirmed'
            : manifestReceipt?.state === 'failed'
              ? 'failed'
              : 'pending',
        provider: 'Walrus Memory',
        network: 'sui-mainnet',
        managedRelayer: 'https://relayer.memory.walrus.xyz',
        namespace: process.env.MEMWAL_NAMESPACE ?? DEFAULT_MEMORY_NAMESPACE,
        datasetId: dataset.id,
        confirmedCount,
        requiredCount: 10,
        records: jobs.map((j) => ({
          id: j.id,
          state: j.state,
          jobId: j.providerJobId ?? null,
          blobId: j.blobId ?? null,
          verifiedAt: j.verifiedAt ?? null,
          payloadHash: j.payloadHash,
          error: j.error ?? null,
        })),
        manifestReceipt: manifestReceipt ?? null,
        recoveryStatus: 'not-yet-verified',
        reason: `${confirmedCount} distinct fictional source records have completed Mainnet jobs. Complete manifest retrieval and clean recovery are separate checks; storage expiry is not assumed.`,
      };
      evidence.claims = {
        ...(evidence.claims as Record<string, unknown>),
        fixture: 'Authored fictional payment history; actual writes occurred during this build.',
        storage: `${confirmedCount} distinct completed Mainnet source records. Full-set retrieval and recovery are not yet verified.`,
      };
      await saveEvidence(evidence);
      console.log(
        JSON.stringify(
          {
            confirmed: confirmed.length,
            total: jobs.length,
            manifest: manifestReceipt ?? 'Wait for all source records to complete, then run again.',
            evidence: 'evidence/manifest.json',
          },
          null,
          2,
        ),
      );
    } finally {
      client.destroy?.();
    }
  } catch (error) {
    await recordQuotaStop('memory', error);
    await reportFailure(error);
  }
}
