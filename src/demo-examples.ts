import {
  appendCorrection,
  createSampleDataset,
  validateDataset,
  type Dataset,
} from './domain/index.js';

export const EXCEPTION_EXAMPLE_ID = 'payday-memory-fictional-exception-v1';

/** A separate authored scenario; never mutate the canonical or sponsor-recovered dataset. */
export function createExceptionalDelayExample(): Dataset {
  const dataset = createSampleDataset();
  dataset.id = EXCEPTION_EXAMPLE_ID;
  const receipt = dataset.receipts.find((record) => record.id === 'receipt:aster-oct:full')!;
  const allocation = dataset.allocations.find((record) => record.receiptId === receipt.id)!;
  // Authored fixture: an isolated processing issue delayed this payment by 21 calendar days.
  receipt.occurredAt = '2026-11-02T06:00:00Z';
  receipt.knownAt = receipt.occurredAt;
  allocation.knownAt = receipt.knownAt;
  validateDataset(dataset);
  return appendCorrection(dataset, {
    id: 'correction:aster-oct-exception:example-v1',
    receiptId: receipt.id,
    kind: 'exceptional',
    reason:
      'Authored example: a one-off processing issue delayed this payment by 21 days. Keep the receipt as cash but exclude it from the usual timing pattern.',
    occurredAt: '2026-11-04T06:00:00Z',
    knownAt: '2026-11-04T06:00:00Z',
  });
}
