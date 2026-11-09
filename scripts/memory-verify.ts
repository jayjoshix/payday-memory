import {
  atomicJson,
  loadAccountChecks,
  readJson,
  requireMemory,
  SponsorError,
  assertProviderCircuit,
  recordQuotaStop,
} from '../src/sponsors/safety.js';
import {
  nativeMemoryClient,
  recoverFromMemory,
  assessMemoryRetention,
  sha256,
  type PublicationManifest,
} from '../src/sponsors/memory.js';
import {
  loadLocalEnv,
  liveRequested,
  reportFailure,
  getEvidence,
  saveEvidence,
  isEmptyWorkspace,
} from './sponsors-common.js';
import { memoryAccountScope } from '../src/sponsors/curated.js';
loadLocalEnv();
if (!liveRequested()) {
  console.log(
    'SKIPPED: add --live to retrieve sponsor-confirmed records into an empty disposable recovery workspace.',
  );
} else {
  try {
    const checks = await loadAccountChecks();
    requireMemory(checks);
    await assertProviderCircuit('memory', checks);
    const job = await readJson<{
      manifest: PublicationManifest;
      blobId?: string;
      verifiedAt?: string;
      namespace?: string;
      accountId?: string;
    }>('data/publication-job.json');
    if (job.accountId && job.accountId !== process.env.MEMWAL_ACCOUNT_ID)
      throw new SponsorError(
        'blocked',
        'The confirmed publication belongs to a different Memory account. Select the matching account credentials privately.',
      );
    if (!job.blobId || !job.verifiedAt)
      throw new SponsorError(
        'incomplete',
        'Publication manifest itself has no confirmed Mainnet receipt.',
      );
    const output = `data/recovered-${Date.now()}/dataset.json`;
    if (!(await isEmptyWorkspace(output)))
      throw new SponsorError('blocked', 'Recovery target must be empty.');
    const client = await nativeMemoryClient();
    try {
      const namespace =
        job.namespace ?? process.env.MEMWAL_NAMESPACE ?? 'payday-memory-fictional-v1';
      const manifestHits = await client.recall({
        query: `Payday Memory recovery manifest ${job.manifest.datasetId}`,
        namespace,
        limit: 100,
      });
      const manifestHit = manifestHits.results.find((h) => h.blob_id === job.blobId);
      if (!manifestHit)
        throw new SponsorError(
          'incomplete',
          'Confirmed manifest was not retrieved; recovery stopped.',
        );
      const retrievedManifest = JSON.parse(manifestHit.text) as PublicationManifest;
      if (sha256(retrievedManifest) !== sha256(job.manifest))
        throw new SponsorError('invalid', 'Retrieved manifest differs from its frozen content.');
      const recovered = await recoverFromMemory(client, namespace, retrievedManifest);
      const retentionAssessment = assessMemoryRetention(recovered.inventory, [
        job.blobId,
        ...retrievedManifest.entries.map((entry) => entry.blobId),
      ]);
      const verifiedAt = new Date().toISOString();
      const datasetHash = sha256(recovered.dataset);
      if (retentionAssessment.throughJudgingVerified) {
        const required = new Set([
          job.blobId,
          ...retrievedManifest.entries.map((entry) => entry.blobId),
        ]);
        const earliest = Math.min(
          ...recovered.inventory
            .filter((item) => required.has(item.blob_id))
            .map((item) => Date.parse(item.expires_at!)),
        );
        await atomicJson('data/account-checks.json', {
          ...checks,
          memory: {
            ...checks.memory,
            retentionThrough: new Date(earliest).toISOString(),
            retentionEvidence: {
              verifiedAt,
              source: 'Actual managed Mainnet inventory for every source and manifest blob',
              checkedBlobCount: required.size,
            },
          },
        });
      }
      await atomicJson(output, recovered.dataset);
      await atomicJson(output.replace('dataset.json', 'receipt.json'), {
        verifiedAt,
        source: 'Walrus Memory Mainnet',
        manifestBlobId: job.blobId,
        records: recovered.records.map((r) => ({ id: r.record.id, blobId: r.blobId })),
        lessons: recovered.lessons,
        retentionAssessment,
      });
      if (
        !recovered.dataset.id.startsWith('payday-memory-fictional-') ||
        recovered.dataset.walletAddress !== 'fictional-wallet' ||
        recovered.records.some((record) => record.record.provenance !== 'fictional')
      )
        throw new SponsorError(
          'blocked',
          'Public recovery captures may contain only fictional samples.',
        );
      const capture = {
        schemaVersion: 1,
        evidenceMode: 'captured',
        provider: 'Walrus Memory',
        network: 'sui-mainnet',
        accountScope: memoryAccountScope(process.env.MEMWAL_ACCOUNT_ID!, namespace),
        verifiedAt,
        datasetHash,
        manifestBlobId: job.blobId,
        recordCount: recovered.records.length,
        dataset: recovered.dataset,
      };
      await atomicJson('evidence/recovered-sample.json', capture);
      await atomicJson('public/recovered-sample.json', capture);
      const evidence = await getEvidence();
      evidence.capturedAt = verifiedAt;
      evidence.memory = {
        ...(evidence.memory as Record<string, unknown>),
        recoveryStatus: 'confirmed',
        recoveryVerifiedAt: verifiedAt,
        recoveryRecords: recovered.records.length,
        recoveredDatasetHash: datasetHash,
        retentionAssessment,
        retention: recovered.inventory.map((m) => ({
          blobId: m.blob_id,
          endEpoch: m.end_epoch,
          expiresAt: m.expires_at,
        })),
        reason: `${recovered.records.length} fictional source records and their confirmed manifest were retrieved, hash-checked and reconstructed in an empty directory. Storage expiry through judging is ${retentionAssessment.status}.`,
      };
      try {
        const packageRead = await readJson<Record<string, unknown>>(
          'data/memory-package-read.json',
        );
        if (
          packageRead.provider === 'Tatum' &&
          packageRead.network === 'sui-mainnet' &&
          packageRead.readOnly === true
        )
          (evidence.memory as Record<string, unknown>).packageValidationTransport = {
            provider: 'Tatum',
            method: packageRead.method,
            configured: true,
            liveVerified: true,
            otherRpcProvidersContacted: false,
            lastObservedRead: packageRead,
          };
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      evidence.status = 'sponsor-round-trips-and-recovery-confirmed';
      evidence.submissionReadiness = {
        status: 'pending',
        storageExpiryThroughJudging: retentionAssessment.status,
        publicDistribution: 'not-published',
        organizerAcceptanceOfStaticDemo: 'not-confirmed',
      };
      evidence.claims = {
        fixture:
          'Authored fictional history. Actual Mainnet writes occurred during this build, not on historical fixture dates.',
        chain:
          'Genuine captured Tatum native USDC balance; no verified receipt or complete wallet-history claim.',
        storage: `${recovered.records.length} source records and the separately completed manifest were genuinely retrieved from Mainnet; active corrected lessons were reconstructed in an empty directory.`,
      };
      await saveEvidence(evidence);
      console.log(
        JSON.stringify(
          {
            status: 'confirmed',
            restoredRecords: recovered.records.length,
            activeLessons: recovered.lessons.length,
            retentionThroughJudging: retentionAssessment.status,
            output,
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
