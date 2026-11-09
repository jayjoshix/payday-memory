import { createHash } from 'node:crypto';
import { MemWal } from '@mysten-incubation/memwal';
import {
  restoreMemory,
  type MemoryRecord,
  type MemoryManifest,
  type ConfirmedMemory,
} from '../domain/index.js';
import { atomicJson, readJson, SponsorError, safeFailure } from './safety.js';
import { DEFAULT_MEMORY_NAMESPACE } from './curated.js';
import { managedMemoryFetch } from './memory-transport.js';
import { readMemoryPackageViaTatum } from './tatum.js';
export const MANAGED_MAINNET_RELAYER = 'https://relayer.memory.walrus.xyz';
export const sha256 = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface WriteJob {
  id: string;
  record: MemoryRecord;
  payloadHash: string;
  idempotencyKey: string;
  state: 'queued' | 'pending' | 'confirmed' | 'failed';
  attempts: number;
  createdAt: string;
  updatedAt: string;
  providerJobId?: string;
  blobId?: string;
  verifiedAt?: string;
  error?: {
    code: string;
    message: string;
  };
}
export interface PublicationManifest {
  schemaVersion: 1;
  recordType: 'manifest';
  datasetId: string;
  id: string;
  createdAt: string;
  entries: {
    id: string;
    sha256: string;
    blobId: string;
  }[];
}
export interface ManifestWriteJob {
  manifest: PublicationManifest;
  namespace: string;
  accountId: string;
  state: 'queued' | 'pending' | 'confirmed' | 'failed';
  attempts: number;
  createdAt: string;
  updatedAt: string;
  jobId?: string;
  blobId?: string;
  verifiedAt?: string;
  error?: WriteJob['error'];
}
export interface MemoryClient {
  remember(
    text: string,
    options: {
      idempotencyKey: string;
      dedupe: boolean;
    },
  ): Promise<{
    job_id: string;
    status: string;
  }>;
  getRememberStatus(jobId: string): Promise<{
    status: string;
    blob_id?: string;
    namespace?: string;
    error?: string;
  }>;
  listMemories(options: { cursor?: string; namespace: string; limit: number }): Promise<{
    memories: {
      blob_id: string;
      status: string;
      expires_at: string | null;
      end_epoch: number | null;
    }[];
    has_more: boolean;
    next_cursor: string | null;
    must_resync: boolean;
  }>;
  recall(options: { query: string; namespace: string; limit: number }): Promise<{
    results: {
      text: string;
      blob_id: string;
    }[];
  }>;
  destroy?(): void;
}
export async function nativeMemoryClient(
  env: NodeJS.ProcessEnv = process.env,
  options: { preflightTimeoutMs?: number } = {},
): Promise<MemoryClient> {
  const preflightTimeoutMs = options.preflightTimeoutMs ?? 5000;
  if (
    !Number.isInteger(preflightTimeoutMs) ||
    preflightTimeoutMs < 1000 ||
    preflightTimeoutMs > 15000
  )
    throw new SponsorError(
      'invalid',
      'Memory preflight timeout must be between 1000 and 15000 ms.',
    );
  // The SDK package-validation read uses Tatum's gated native transport.
  // Advertised third-party RPC hosts and JSON-RPC fallbacks are never contacted.
  const originalFetch = globalThis.fetch;
  globalThis.fetch = managedMemoryFetch(originalFetch, (request) =>
    readMemoryPackageViaTatum(request, env),
  );
  try {
    const client = MemWal.create({
      key: env.MEMWAL_KEY!,
      accountId: env.MEMWAL_ACCOUNT_ID!,
      namespace: env.MEMWAL_NAMESPACE ?? DEFAULT_MEMORY_NAMESPACE,
      serverUrl: MANAGED_MAINNET_RELAYER,
      requestTimeoutMs: 10000,
      recallTimeoutMs: 15000,
      preflightTimeoutMs,
    });
    const expected = env.MEMWAL_AGENT_ID!.replace(/^0x/, '').toLowerCase();
    if ((await client.getPublicKeyHex()).replace(/^0x/, '').toLowerCase() !== expected) {
      client.destroy();
      throw new SponsorError(
        'blocked',
        'MEMWAL_AGENT_ID must match this delegate public key; it is distinct from MEMWAL_ACCOUNT_ID and the private key.',
      );
    }
    const destroy = client.destroy.bind(client);
    client.destroy = () => {
      try {
        destroy();
      } finally {
        globalThis.fetch = originalFetch;
      }
    };
    return client;
  } catch (error) {
    globalThis.fetch = originalFetch;
    throw error;
  }
}
export function validateRecord(value: unknown): asserts value is MemoryRecord {
  const r = value as MemoryRecord;
  if (
    !r ||
    r.schemaVersion !== 1 ||
    !r.id ||
    !r.datasetId ||
    !['observation', 'correction', 'lesson', 'dataset'].includes(r.recordType) ||
    !['fictional', 'user-entered', 'chain-observed'].includes(r.provenance) ||
    !Number.isInteger(r.effectiveVersion) ||
    r.effectiveVersion < 1 ||
    !Number.isFinite(Date.parse(r.occurredAt)) ||
    !Number.isFinite(Date.parse(r.knownAt)) ||
    r.payload === undefined
  )
    throw new SponsorError('invalid', 'Memory record schema is invalid.');
  if (Buffer.byteLength(JSON.stringify(r)) > 64000)
    throw new SponsorError('invalid', 'Memory payload exceeds the64KB application cap.');
}
function rememberJobFailure(status: Awaited<ReturnType<MemoryClient['getRememberStatus']>>) {
  if (status.status !== 'failed' && status.status !== 'not_found') return;
  const quota = /quota|rate.?limit|limit exceeded|resource.?exhausted|allowance exceeded/i.test(
    status.error ?? '',
  );
  return {
    code: quota ? 'quota' : 'unavailable',
    message: quota
      ? 'Provider quota stopped this background job. No further record was submitted.'
      : `Provider job ${status.status}; the record is not confirmed.`,
  };
}
function validateRememberJobId(jobId: unknown): asserts jobId is string {
  if (typeof jobId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(jobId))
    throw new SponsorError('invalid', 'Provider omitted a valid remember job ID.');
}
/** Atomic local outbox. Never resubmit an acknowledged provider job or a confirmed record. */
export class MemoryOutbox {
  constructor(readonly path = 'data/memory-outbox.json') {}
  async jobs(): Promise<WriteJob[]> {
    try {
      return await readJson<WriteJob[]>(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
  }
  private async save(jobs: WriteJob[]): Promise<void> {
    await atomicJson(this.path, jobs);
  }
  async enqueue(records: MemoryRecord[]): Promise<WriteJob[]> {
    const jobs = await this.jobs();
    for (const record of records) {
      validateRecord(record);
      if (record.provenance !== 'fictional')
        throw new SponsorError(
          'blocked',
          'Only curated fictional records can be published by this operator command.',
        );
      const payloadHash = sha256(record);
      const same = jobs.find((j) => j.id === record.id);
      if (same) {
        if (same.payloadHash !== payloadHash)
          throw new SponsorError(
            'invalid',
            'An immutable record ID was reused with changed content; append a new version.',
          );
        continue;
      }
      const now = new Date().toISOString();
      jobs.push({
        id: record.id,
        record,
        payloadHash,
        idempotencyKey: `payday-${payloadHash}`,
        state: 'queued',
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
    await this.save(jobs);
    return jobs;
  }
  async process(client: MemoryClient, maxRecords = 1, waitMs = 20000): Promise<WriteJob[]> {
    if (!Number.isInteger(maxRecords) || maxRecords < 1 || maxRecords > 25)
      throw new SponsorError('invalid', 'Memory write cap must be1 to25.');
    const jobs = await this.jobs();
    let consumed = 0;
    for (const job of jobs) {
      if (job.state === 'confirmed' || job.state === 'failed' || consumed >= maxRecords) continue;
      consumed++;
      try {
        if (!job.providerJobId) {
          if (job.attempts >= 3) {
            job.state = 'failed';
            job.error = {
              code: 'unavailable',
              message: 'Three bounded submission attempts exhausted.',
            };
            await this.save(jobs);
            continue;
          }
          job.attempts++;
          job.updatedAt = new Date().toISOString();
          await this.save(jobs);
          const accepted = await client.remember(JSON.stringify(job.record), {
            idempotencyKey: job.idempotencyKey,
            dedupe: true,
          });
          validateRememberJobId(accepted.job_id);
          job.providerJobId = accepted.job_id;
          job.state = 'pending';
          job.updatedAt = new Date().toISOString();
          await this.save(jobs);
        }
        const deadline = Date.now() + Math.min(waitMs, 30000);
        let poll = 0;
        do {
          const status = await client.getRememberStatus(job.providerJobId);
          if (status.status === 'done' && status.blob_id) {
            job.state = 'confirmed';
            job.blobId = status.blob_id;
            job.verifiedAt = new Date().toISOString();
            delete job.error;
            break;
          }
          const failure = rememberJobFailure(status);
          if (failure) {
            job.state = 'failed';
            job.error = failure;
            break;
          }
          if (Date.now() >= deadline) break;
          await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** poll++, 4000)));
        } while (Date.now() < deadline);
        if (job.state === 'pending')
          job.error = {
            code: 'timeout',
            message:
              'Completion is pending. Resume polling this same job on the next explicit run.',
          };
      } catch (error) {
        job.error = safeFailure(error);
        job.state = job.providerJobId ? 'pending' : 'queued';
        job.updatedAt = new Date().toISOString();
        await this.save(jobs);
        if (job.error.code === 'quota') break;
      }
      job.updatedAt = new Date().toISOString();
      await this.save(jobs);
      if (job.error?.code === 'quota') break;
    }
    return jobs;
  }
}
/** At most one durable manifest submission and one status read per explicit invocation. */
export class MemoryManifestOutbox {
  constructor(readonly path: string) {}

  async process(
    client: MemoryClient,
    manifest: PublicationManifest,
    scope: { namespace: string; accountId: string },
  ): Promise<ManifestWriteJob> {
    const now = new Date().toISOString();
    let previous: Partial<ManifestWriteJob> & { manifest: PublicationManifest };
    try {
      previous = await readJson(this.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      previous = { manifest };
    }
    if (
      previous.manifest.datasetId !== manifest.datasetId ||
      sha256(previous.manifest.entries) !== sha256(manifest.entries)
    )
      throw new SponsorError(
        'invalid',
        'Published dataset changed; use a new namespace and record versions.',
      );
    if (
      (previous.namespace && previous.namespace !== scope.namespace) ||
      (previous.accountId && previous.accountId.toLowerCase() !== scope.accountId.toLowerCase())
    )
      throw new SponsorError('blocked', 'The manifest job belongs to a different Memory scope.');
    // Older manifest-job files had only the manifest, scope and provider receipt.
    // Infer their state without discarding a completed or acknowledged write.
    const job: ManifestWriteJob = {
      ...previous,
      manifest: previous.manifest,
      ...scope,
      state:
        previous.blobId && previous.verifiedAt
          ? 'confirmed'
          : previous.state === 'failed'
            ? 'failed'
            : previous.jobId
              ? 'pending'
              : 'queued',
      attempts: previous.attempts ?? (previous.jobId ? 1 : 0),
      createdAt: previous.createdAt ?? now,
      updatedAt: previous.updatedAt ?? now,
    };
    if (!Number.isInteger(job.attempts) || job.attempts < 0 || job.attempts > 3)
      throw new SponsorError('invalid', 'Manifest submission attempt state is invalid.');
    await atomicJson(this.path, job);
    if (job.state === 'confirmed' || job.state === 'failed') return job;
    try {
      if (!job.jobId) {
        if (job.attempts >= 3) {
          job.state = 'failed';
          job.error = {
            code: 'unavailable',
            message: 'Three bounded manifest submission attempts exhausted.',
          };
          job.updatedAt = new Date().toISOString();
          await atomicJson(this.path, job);
          return job;
        }
        job.attempts++;
        job.updatedAt = new Date().toISOString();
        await atomicJson(this.path, job);
        const accepted = await client.remember(JSON.stringify(job.manifest), {
          idempotencyKey: `payday-manifest-${sha256(job.manifest.entries)}`,
          dedupe: true,
        });
        validateRememberJobId(accepted.job_id);
        job.jobId = accepted.job_id;
        job.state = 'pending';
        job.updatedAt = new Date().toISOString();
        delete job.error;
        await atomicJson(this.path, job);
      }
      const status = await client.getRememberStatus(job.jobId);
      if (status.status === 'done' && status.blob_id) {
        job.state = 'confirmed';
        job.blobId = status.blob_id;
        job.verifiedAt = new Date().toISOString();
        delete job.error;
      } else {
        const failure = rememberJobFailure(status);
        if (failure) {
          job.state = 'failed';
          job.error = failure;
        } else {
          job.error = {
            code: 'timeout',
            message:
              'Manifest completion is pending. Resume this same job on the next explicit run.',
          };
        }
      }
    } catch (error) {
      job.error = safeFailure(error);
      job.state = job.jobId ? 'pending' : job.attempts >= 3 ? 'failed' : 'queued';
    }
    job.updatedAt = new Date().toISOString();
    await atomicJson(this.path, job);
    return job;
  }
}
export function createPublicationManifest(
  jobs: WriteJob[],
  datasetId: string,
): PublicationManifest {
  const selected = jobs.filter((j) => j.record.datasetId === datasetId);
  if (
    !selected.length ||
    selected.some((j) => j.state !== 'confirmed' || !j.blobId || !j.verifiedAt)
  )
    throw new SponsorError(
      'incomplete',
      'Every selected source record must be confirmed before creating a recovery manifest.',
    );
  return {
    schemaVersion: 1,
    recordType: 'manifest',
    datasetId,
    id: `manifest:${datasetId}:${sha256(selected.map((j) => j.payloadHash))}`,
    createdAt: new Date().toISOString(),
    entries: selected.map((j) => ({ id: j.id, sha256: j.payloadHash, blobId: j.blobId! })),
  };
}
export async function enumerate(client: MemoryClient, namespace: string, maxPages = 3) {
  let cursor: string | undefined;
  const all: Awaited<ReturnType<MemoryClient['listMemories']>>['memories'] = [];
  for (let page = 0; page < maxPages; page++) {
    const result = await client.listMemories({
      namespace,
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    if (result.must_resync)
      throw new SponsorError(
        'incomplete',
        'Memory inventory cursor expired; explicit resync required.',
      );
    all.push(...result.memories);
    if (!result.has_more) return all;
    if (!result.next_cursor || result.next_cursor === cursor)
      throw new SponsorError('incomplete', 'Memory inventory pagination did not advance.');
    cursor = result.next_cursor;
  }
  throw new SponsorError(
    'incomplete',
    'Memory inventory exceeded the bounded pagination coverage.',
  );
}

/** Null expiry is unknown. An epoch number alone is not a calendar-date guarantee. */
export function assessMemoryRetention(
  inventory: Awaited<ReturnType<MemoryClient['listMemories']>>['memories'],
  requiredBlobIds: string[],
  requiredThrough = '2026-11-17T23:59:59Z',
) {
  const deadline = Date.parse(requiredThrough);
  if (!Number.isFinite(deadline))
    throw new SponsorError('invalid', 'Retention comparison requires a valid date.');
  const ids = [...new Set(requiredBlobIds)];
  const unverifiedBlobIds: string[] = [];
  const expiresBeforeJudgingBlobIds: string[] = [];
  for (const id of ids) {
    const metadata = inventory.find((item) => item.blob_id === id);
    const expiry = Date.parse(metadata?.expires_at ?? '');
    if (!metadata || !Number.isFinite(expiry)) unverifiedBlobIds.push(id);
    else if (expiry < deadline) expiresBeforeJudgingBlobIds.push(id);
  }
  const status = expiresBeforeJudgingBlobIds.length
    ? 'expires-before-judging'
    : !ids.length || unverifiedBlobIds.length
      ? 'unverified'
      : 'verified';
  return {
    status,
    requiredThrough,
    checkedBlobCount: ids.length,
    unverifiedBlobIds,
    expiresBeforeJudgingBlobIds,
    throughJudgingVerified: status === 'verified',
  };
}
/** Semantic recall is used for content; inventory and hashes prove completeness or fail closed. */
export async function recoverFromMemory(
  client: MemoryClient,
  namespace: string,
  manifest: PublicationManifest,
) {
  if (
    manifest.schemaVersion !== 1 ||
    manifest.recordType !== 'manifest' ||
    !manifest.entries.length ||
    manifest.entries.length > 25 ||
    new Set(manifest.entries.map((e) => e.id)).size !== manifest.entries.length
  )
    throw new SponsorError('invalid', 'Recovery publication manifest is invalid.');
  const inventory = await enumerate(client, namespace);
  for (const entry of manifest.entries)
    if (
      !inventory.some(
        (m) =>
          m.blob_id === entry.blobId &&
          !/^(pending|queued|running|uploaded|failed|expired|deleted)$/i.test(m.status),
      )
    )
      throw new SponsorError(
        'incomplete',
        `Memory inventory is missing ${entry.id}. Existing local data was retained.`,
      );
  const recalled = await client.recall({
    query: `Payday Memory ${manifest.datasetId} financial dataset observations corrections settled timing lesson`,
    namespace,
    limit: 100,
  });
  const confirmed: ConfirmedMemory[] = manifest.entries.map((entry) => {
    const hit = recalled.results.find((h) => h.blob_id === entry.blobId);
    if (!hit)
      throw new SponsorError(
        'incomplete',
        `Recall omitted ${entry.id}. Semantic recall is not an exhaustive ledger; no partial restore was applied.`,
      );
    let record: unknown;
    try {
      record = JSON.parse(hit.text);
    } catch {
      throw new SponsorError('invalid', 'Retrieved memory is not structured JSON.');
    }
    validateRecord(record);
    if (
      record.id !== entry.id ||
      record.datasetId !== manifest.datasetId ||
      sha256(record) !== entry.sha256
    )
      throw new SponsorError(
        'invalid',
        'Retrieved memory content does not match the frozen manifest.',
      );
    return {
      record,
      state: 'confirmed',
      blobId: entry.blobId,
      verifiedAt: new Date().toISOString(),
    };
  });
  const domainManifest: MemoryManifest = {
    schemaVersion: 1,
    datasetId: manifest.datasetId,
    recordIds: manifest.entries.map((e) => e.id),
  };
  return { ...restoreMemory(confirmed, domainManifest), records: confirmed, inventory };
}
