import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectedWorkspace, connectedScenarios, isSnapshotStale } from '../src/connected';
import {
  allocateReceipt,
  appendCorrection,
  createSampleDataset,
  endOfDayTimestamp,
  evaluateDataset,
  money,
  USDC_SUI,
  validateDataset,
  type Receipt,
} from '../src/domain/index';
const address = '0x' + 'a'.repeat(64);
const snapshot = {
  amount: money('500'),
  coinType: USDC_SUI,
  address,
  observedAt: '2026-11-05T12:00:00Z',
  source: 'chain-observed' as const,
  provider: 'Tatum' as const,
  network: 'sui-mainnet' as const,
  stale: false,
};
test('captured balance affects every scenario without adding old receipts again', () => {
  const dataset = createSampleDataset();
  const scenarios = connectedScenarios(dataset, snapshot);
  assert.equal(scenarios[0]!.points[0]!.balance, money('500'));
  assert.equal(scenarios[1]!.points.find((p) => p.date === '2026-11-12')!.balance, money('-685'));
  assert.equal(evaluateDataset(dataset, '2026-11-05').cash, money('1250'));
});
test('separate chain workspace reconciles same-day receipt already included in snapshot', () => {
  const receipt: Receipt = {
    id: 'real-id',
    transferId: 'digest:balance:0',
    digest: 'digest',
    amount: money('100'),
    recipient: address,
    asset: USDC_SUI,
    status: 'success',
    occurredAt: '2026-11-05T09:00:00Z',
    knownAt: snapshot.observedAt,
    provenance: 'chain-observed',
  };
  const connected = createConnectedWorkspace(createSampleDataset(), snapshot, [receipt, receipt]);
  assert.equal(connected.receipts.length, 1);
  assert.equal(connected.opening.balance, snapshot.amount);
  assert.equal(evaluateDataset(connected, '2026-11-05').cash, money('500'));
  assert.equal(connected.allocations.length, 0);
  assert.ok(evaluateDataset(connected, '2026-11-05').lessons.every((l) => l.delayDays === null));
  assert.throws(
    () =>
      createConnectedWorkspace(createSampleDataset(), snapshot, [
        { ...receipt, occurredAt: '2026-11-05T15:00:00Z' },
      ]),
    /newer/,
  );
});

test('historical chain receipts and later-known receipt evidence never inflate a captured balance', () => {
  const historical: Receipt = {
    id: 'old-chain',
    transferId: 'digest-old:balance:0',
    digest: 'digest-old',
    amount: money('600'),
    recipient: address,
    asset: USDC_SUI,
    status: 'success',
    occurredAt: '2026-10-14T09:00:00Z',
    knownAt: '2026-11-05T12:00:01Z',
    provenance: 'chain-observed',
  };
  const sameDay: Receipt = {
    ...historical,
    id: 'same-day',
    transferId: 'digest-new:balance:0',
    digest: 'digest-new',
    amount: money('100'),
    occurredAt: '2026-11-05T09:00:00Z',
    knownAt: '2026-11-05T12:00:02Z',
  };
  const connected = createConnectedWorkspace(createSampleDataset(), snapshot, [
    historical,
    sameDay,
  ]);
  validateDataset(connected);
  assert.equal(evaluateDataset(connected, '2026-11-05').cash, money('500'));
  assert.equal(connected.opening.balance, money('500'));
  assert.equal(evaluateDataset(connected, '2026-11-05').receipts.length, 2);
  assert.throws(() => evaluateDataset(connected, '2026-11-04'));
  const dayEnd = endOfDayTimestamp('2026-11-05', connected.timezone);
  const matched = allocateReceipt(connected, {
    id: 'manual-match',
    receiptId: 'same-day',
    invoiceId: 'cedar-next',
    amount: money('100'),
    confirmed: true,
    knownAt: dayEnd,
  });
  validateDataset(matched);
  assert.equal(evaluateDataset(matched, '2026-11-05').cash, money('500'));
  assert.equal(
    evaluateDataset(matched, '2026-11-05').invoices.find((i) => i.id === 'cedar-next')!.outstanding,
    money('1700'),
  );
  const corrected = appendCorrection(matched, {
    id: 'manual-correction',
    receiptId: 'same-day',
    kind: 'reimbursement',
    reason: 'Purpose was a reimbursement, not invoice income.',
    occurredAt: dayEnd,
    knownAt: dayEnd,
  });
  assert.equal(evaluateDataset(corrected, '2026-11-05').cash, money('500'));
  assert.equal(
    evaluateDataset(corrected, '2026-11-05').invoices.find((i) => i.id === 'cedar-next')!
      .outstanding,
    money('1800'),
  );
});

test('receipt/snapshot reconciliation compares instants, including offset timestamps', () => {
  const receipt: Receipt = {
    id: 'offset',
    transferId: 'offset:balance:0',
    digest: 'offset-digest',
    amount: money('100'),
    recipient: address,
    asset: USDC_SUI,
    status: 'success',
    occurredAt: '2026-11-05T15:00:00+05:30',
    knownAt: '2026-11-05T12:00:01Z',
    provenance: 'chain-observed',
  };
  //15:00+05:30 is09:30Z, earlier than the12:00Z balance capture.
  assert.equal(
    evaluateDataset(
      createConnectedWorkspace(createSampleDataset(), snapshot, [receipt]),
      '2026-11-05',
    ).cash,
    money('500'),
  );
  //10:00-03:00 is13:00Z, later than capture despite a lexicographically smaller hour.
  assert.throws(
    () =>
      createConnectedWorkspace(createSampleDataset(), snapshot, [
        { ...receipt, occurredAt: '2026-11-05T10:00:00-03:00', knownAt: '2026-11-05T13:00:01Z' },
      ]),
    /newer/,
  );
});

test('duplicate chain observations dedupe safely and conflicting copies fail closed', () => {
  const receipt: Receipt = {
    id: 'dedupe',
    transferId: 'dedupe:balance:0',
    digest: 'dedupe-digest',
    amount: money('100'),
    recipient: address,
    asset: USDC_SUI,
    status: 'success',
    occurredAt: '2026-11-05T09:00:00Z',
    knownAt: '2026-11-05T12:00:01Z',
    provenance: 'chain-observed',
  };
  const duplicate = { ...receipt, knownAt: '2026-11-05T12:01:00Z' };
  const connected = createConnectedWorkspace(createSampleDataset(), snapshot, [duplicate, receipt]);
  assert.equal(connected.receipts.length, 1);
  assert.equal(connected.receipts[0]!.knownAt, receipt.knownAt);
  assert.throws(
    () =>
      createConnectedWorkspace(createSampleDataset(), snapshot, [
        receipt,
        { ...receipt, amount: money('101') },
      ]),
    /Conflicting/,
  );
});

test('snapshot data validates timestamp, canonical amounts and stale state without inventing freshness', () => {
  for (const broken of [
    { ...snapshot, observedAt: 'not-a-time' },
    { ...snapshot, amount: '0500' },
    { ...snapshot, stale: 'false' as unknown as boolean },
    { ...snapshot, amount: '-1' },
  ])
    assert.throws(() => connectedScenarios(createSampleDataset(), broken));
  const captured = Date.parse(snapshot.observedAt);
  assert.equal(isSnapshotStale(snapshot, captured + 5 * 60_000), false);
  assert.equal(isSnapshotStale(snapshot, captured + 16 * 60_000), true);
  assert.equal(isSnapshotStale({ ...snapshot, stale: true }, captured), true);
  assert.equal(
    connectedScenarios(createSampleDataset(), { ...snapshot, stale: true })[0]!.points[0]!.balance,
    money('500'),
  );
});
