import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createCuratedPublicationDataset,
  createCuratedPublicationRecords,
} from '../src/sponsors/curated.js';
import { assessMemoryRetention, type PublicationManifest } from '../src/sponsors/memory.js';
import { validateDataset, type Dataset } from '../src/domain/index.js';

// Offline artifact verification only. Never loads .env.local or creates a sponsor client.
const read = async <T>(file: string): Promise<T> => JSON.parse(await readFile(file, 'utf8')) as T;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const evidence = await read<{
  memory: {
    accountScope: string;
    namespace: string;
    confirmedCount: number;
    records: {
      id: string;
      state: string;
      blobId: string;
      payloadHash: string;
      verifiedAt: string;
    }[];
    manifestReceipt: { blobId: string; sha256: string; verifiedAt: string };
    recoveryStatus: string;
    recoveryVerifiedAt: string;
    recoveredDatasetHash: string;
    retention: { blobId: string; endEpoch: number | null; expiresAt: string | null }[];
  };
}>('evidence/manifest.json');
const manifest = await read<PublicationManifest>('evidence/recovery-manifest.json');
const capture = await read<{
  accountScope: string;
  verifiedAt: string;
  manifestBlobId: string;
  recordCount: number;
  datasetHash: string;
  dataset: Dataset;
}>('evidence/recovered-sample.json');
const memory = evidence.memory;
validateDataset(capture.dataset);
assert.equal(memory.recoveryStatus, 'confirmed');
assert.equal(hash(capture.dataset), memory.recoveredDatasetHash);
assert.equal(capture.datasetHash, memory.recoveredDatasetHash);
assert.equal(capture.accountScope, memory.accountScope);
assert.equal(capture.verifiedAt, memory.recoveryVerifiedAt);
assert.equal(capture.manifestBlobId, memory.manifestReceipt.blobId);
assert.equal(hash(manifest), memory.manifestReceipt.sha256);
assert.equal(manifest.datasetId, capture.dataset.id);
assert.equal(capture.recordCount, manifest.entries.length);
assert.equal(new Set(manifest.entries.map((entry) => entry.id)).size, manifest.entries.length);
assert.equal(new Set(manifest.entries.map((entry) => entry.blobId)).size, manifest.entries.length);
const sourceRecords = createCuratedPublicationRecords(createCuratedPublicationDataset());
assert.equal(sourceRecords.length, manifest.entries.length);
assert.deepEqual(capture.dataset, createCuratedPublicationDataset());
for (const entry of manifest.entries) {
  const record = sourceRecords.find((item) => item.id === entry.id);
  assert.ok(record, `Missing curated record: ${entry.id}`);
  assert.equal(hash(record), entry.sha256, `Changed published content: ${entry.id}`);
  const receipt = memory.records.find((item) => item.id === entry.id);
  assert.ok(receipt, `Missing source receipt: ${entry.id}`);
  assert.equal(receipt.state, 'confirmed');
  assert.equal(receipt.blobId, entry.blobId);
  assert.equal(receipt.payloadHash, entry.sha256);
  assert.ok(Number.isFinite(Date.parse(receipt.verifiedAt)));
}
assert.equal(memory.confirmedCount, manifest.entries.length);
const retention = assessMemoryRetention(
  memory.retention.map((item) => ({
    blob_id: item.blobId,
    status: 'done',
    expires_at: item.expiresAt,
    end_epoch: item.endEpoch,
  })),
  [memory.manifestReceipt.blobId, ...manifest.entries.map((entry) => entry.blobId)],
);
assert.equal(retention.status, 'verified');
assert.deepEqual(await read('public/evidence/manifest.json'), evidence);
assert.deepEqual(await read('public/recovered-sample.json'), capture);
console.log(
  JSON.stringify(
    {
      status: 'captured-artifacts-verified-offline',
      sourceRecords: manifest.entries.length,
      manifestBlobs: 1,
      recoveredDatasetHash: capture.datasetHash,
      publishedContentUnchanged: true,
      recordedRetentionThroughJudging: retention.status,
      sponsorRequestsMade: 0,
      currentProviderAvailability: 'not checked',
    },
    null,
    2,
  ),
);
