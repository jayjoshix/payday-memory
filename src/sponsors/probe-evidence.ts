import { memoryEvidenceForScope } from './curated.js';
import type { WriteJob } from './memory.js';

export interface ProbeRetention {
  expiresAt: string | null;
  endEpoch: number | null;
  throughJudging: boolean;
}

/** A probe may extend proof only for the exact same account and namespace. */
export function buildProbeMemoryEvidence(
  previous: unknown,
  options: {
    accountScope: string;
    namespace: string;
    job: WriteJob;
    retrieved: boolean;
    retention: ProbeRetention | null;
    checkedAt: string;
  },
): Record<string, unknown> {
  const { accountScope, namespace, job, retrieved, retention, checkedAt } = options;
  const scoped = memoryEvidenceForScope(previous, accountScope);
  const priorRecords = (scoped.records ?? []) as {
    id: string;
    state: string;
    blobId?: string | null;
  }[];
  const records = [
    ...priorRecords.filter((item) => item.id !== job.id),
    {
      id: job.id,
      state: job.state,
      jobId: job.providerJobId ?? null,
      blobId: job.blobId ?? null,
      verifiedAt: job.verifiedAt ?? null,
      payloadHash: job.payloadHash,
    },
  ];
  return {
    ...scoped,
    accountScope,
    namespace,
    provider: 'Walrus Memory',
    network: 'sui-mainnet',
    managedRelayer: 'https://relayer.memory.walrus.xyz',
    status: job.state === 'confirmed' && retrieved ? 'round-trip-confirmed' : job.state,
    confirmedCount: new Set(
      records
        .filter((item) => item.state === 'confirmed' && item.blobId)
        .map((item) => item.blobId),
    ).size,
    requiredCount: 10,
    records,
    smokeRoundTrip: {
      checkedAt,
      state: job.state,
      retrieved,
      retention,
      maximumWrites: 1,
      publishedFreeAllowance: 'not exposed; provider-enforced shared limits',
    },
    recoveryStatus: 'not-verified',
  };
}
