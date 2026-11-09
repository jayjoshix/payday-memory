import { createHash } from 'node:crypto';
import {
  appendCorrection,
  createMemoryRecords,
  createSampleDataset,
  evaluateDataset,
  validateDataset,
  type Dataset,
  type MemoryRecord,
} from '../domain/index.js';

export const DEFAULT_MEMORY_NAMESPACE = 'payday-memory-fictional-v1';
export const CURATED_DATASET_ID = 'payday-memory-fictional-v1-corrected-v1';

/** Public identity only: never include the delegate credential in paths or evidence. */
export function memoryAccountScope(accountId: string, namespace: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(accountId) || !namespace.trim())
    throw new Error('A Memory account and namespace are required for proof scoping.');
  return createHash('sha256')
    .update(JSON.stringify({ accountId: accountId.toLowerCase(), namespace }))
    .digest('hex')
    .slice(0, 24);
}
export function memoryEvidenceForScope(
  value: unknown,
  accountScope: string,
): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    (value as Record<string, unknown>).accountScope !== accountScope
  )
    return {};
  return { ...(value as Record<string, unknown>) };
}

/** Authored history plus an explicit later interpretation; physical cash is unchanged. */
export function createCuratedPublicationDataset(): Dataset {
  const source = createSampleDataset();
  source.id = CURATED_DATASET_ID;
  return appendCorrection(source, {
    id: 'correction:paper-sep-reimbursement:curated-v1',
    receiptId: 'receipt:paper-sep:full',
    kind: 'reimbursement',
    reason:
      'Authored sample correction: this receipt repaid shared travel costs and was not payment for the September expected income.',
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
  });
}

/** Stable content-specific identity prevents an edited export from mutating a published record. */
export function prepareFictionalExport(source: Dataset): Dataset {
  validateDataset(source);
  if (
    !source.id.startsWith('payday-memory-fictional-') ||
    source.walletAddress !== 'fictional-wallet' ||
    [...source.invoices, ...source.receipts, ...source.obligations].some(
      (record) => record.provenance === 'chain-observed',
    )
  )
    throw new Error(
      'Only an explicitly fictional local sample export can be published. Connected records and real user financial data are excluded.',
    );
  const dataset = structuredClone(source);
  const contentHash = createHash('sha256')
    .update(JSON.stringify(source))
    .digest('hex')
    .slice(0, 16);
  dataset.id = `payday-memory-fictional-export-${contentHash}`;
  return dataset;
}

/** Include every source receipt and a before-correction Paper Lane lesson when reproducible. */
export function createCuratedPublicationRecords(dataset: Dataset): MemoryRecord[] {
  validateDataset(dataset);
  const evaluation = evaluateDataset(dataset, '2026-11-05');
  const records = createMemoryRecords(dataset, '2026-11-05');
  const common = {
    schemaVersion: 1 as const,
    datasetId: dataset.id,
    provenance: 'fictional' as const,
    effectiveVersion: 1,
  };
  for (const receipt of evaluation.receipts) {
    const id = `observation:${receipt.id}`;
    if (!records.some((record) => record.id === id))
      records.push({
        ...common,
        id,
        recordType: 'observation',
        occurredAt: receipt.occurredAt,
        knownAt: receipt.knownAt,
        payload: receipt,
      });
  }
  const correctedPaper = dataset.corrections.some(
    (c) =>
      c.receiptId === 'receipt:paper-sep:full' &&
      c.kind === 'reimbursement' &&
      c.knownAt.startsWith('2026-11-05'),
  );
  if (correctedPaper) {
    const prior = evaluateDataset(dataset, '2026-11-04').lessons.find(
      (lesson) => lesson.clientId === 'paper',
    )!;
    records.push({
      ...common,
      id: prior.id,
      recordType: 'lesson',
      occurredAt: prior.calculatedAt,
      knownAt: prior.calculatedAt,
      effectiveVersion: prior.effectiveVersion,
      sourceObservationIds: prior.sourceObservationIds,
      algorithmVersion: prior.algorithmVersion,
      payload: prior,
    });
    const current = records.find(
      (record) =>
        record.recordType === 'lesson' &&
        (record.payload as { clientId?: string }).clientId === 'paper' &&
        record.knownAt > prior.calculatedAt,
    );
    if (current) current.supersedesRecordId = prior.id;
  }
  if (records.length < 10 || records.length > 24)
    throw new Error(
      'Curated publication requires10–24 meaningful records plus one manifest. Trim the fictional export rather than increasing the work cap.',
    );
  return records;
}
