import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALGORITHM_VERSION,
  USDC_SUI,
  addDays,
  allocateReceipt,
  appendCorrection,
  buildScenarios,
  createMemoryRecords,
  createSampleDataset,
  dateDifference,
  endOfDayTimestamp,
  evaluateDataset,
  evaluateReplay,
  formatMoney,
  freezeForecast,
  importReceipts,
  localDay,
  money,
  restoreMemory,
  units,
  validateDataset,
  validateReceipt,
  type ConfirmedMemory,
  type Receipt,
} from '../src/domain/index.ts';

test('money is exact at six decimals, including negative balances and large amounts', () => {
  assert.equal((units(money('0.1')) + units(money('0.2'))).toString(), money('0.3'));
  assert.equal(money('-0.000001'), '-1');
  assert.equal(formatMoney(money('-1095.05')), '−$1,095.05');
  assert.equal(money('999999999999999999.123456'), '999999999999999999123456');
  assert.throws(() => money('0.1234567'));
  assert.throws(() => units('1.5'));
});

test('calendar-day delays respect declared timezone and month boundaries', () => {
  assert.equal(localDay('2026-10-31T20:00:00Z', 'Asia/Kolkata'), '2026-11-01');
  assert.equal(localDay('2026-10-31T18:29:59Z', 'Asia/Kolkata'), '2026-10-31');
  assert.equal(addDays('2026-10-31', 1), '2026-11-01');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(dateDifference('2026-11-01', '2026-10-31'), 1);
  assert.throws(() => localDay('2026-11-01T00:00:00', 'Asia/Kolkata'));
});

test('fictional cash reconstructs from opening balance and actual ledger, not expected income', () => {
  const dataset = createSampleDataset();
  const result = evaluateDataset(dataset, '2026-11-05');
  assert.equal(result.cash, money('1250'));
  assert.equal(result.invoices.find((i) => i.id === 'cedar-next')!.received, '0');
  assert.equal(evaluateDataset(dataset, '2026-11-06').cash, result.cash);
  const altered = structuredClone(dataset);
  altered.invoices.find((i) => i.id === 'cedar-next')!.amount = money('99999');
  assert.equal(evaluateDataset(altered, '2026-11-05').cash, result.cash);
});

test('all three scenarios share a fixed 30-day horizon and exclude receipt double-counting', () => {
  const dataset = createSampleDataset();
  const scenarios = buildScenarios(dataset, '2026-11-05');
  assert.deepEqual(
    scenarios.map((s) => [s.from, s.through]),
    Array(3).fill(['2026-11-05', '2026-12-05']),
  );
  assert.equal(scenarios[0]!.points.length, 31);
  assert.equal(scenarios[0]!.points[0]!.balance, money('1250'));
  assert.equal(scenarios[0]!.points.find((p) => p.date === '2026-11-10')!.inflow, money('1800'));
  assert.equal(scenarios[1]!.points.find((p) => p.date === '2026-11-10')!.inflow, '0');
  assert.equal(scenarios[1]!.points.find((p) => p.date === '2026-11-18')!.inflow, money('1800'));
  assert.ok(scenarios[2]!.points.every((p) => p.inflow === '0'));
});

test('hypothetical purchase subtracts only from purchase date and warns over entire remaining horizon', () => {
  const dataset = createSampleDataset();
  const before = buildScenarios(dataset, '2026-11-05');
  const after = buildScenarios(dataset, '2026-11-05', { date: '2026-11-08', amount: money('240') });
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < after[i]!.points.length; j++) {
      const point = after[i]!.points[j]!;
      const expected =
        units(before[i]!.points[j]!.balance) -
        (point.date >= '2026-11-08' ? units(money('240')) : 0n);
      assert.equal(point.balance, expected.toString());
    }
  assert.equal(after[0]!.purchaseShortfall, '0');
  assert.equal(after[1]!.bufferBreach!.date, '2026-11-12');
  assert.equal(after[1]!.minimum, money('-295'));
  assert.equal(after[1]!.purchaseShortfall, money('595'));
  assert.throws(() =>
    buildScenarios(dataset, '2026-11-05', { date: '2026-12-06', amount: money('1') }),
  );
});

test('receipt imports dedupe stable transfer identity, allowing multiple transfers in one digest', () => {
  const dataset = createSampleDataset();
  const receipt = dataset.receipts[0]!;
  assert.equal(importReceipts(dataset, [receipt]).receipts.length, dataset.receipts.length);
  const another = {
    ...receipt,
    id: 'other-balance-change',
    transferId: receipt.transferId + ':other',
    amount: money('10'),
  };
  const imported = importReceipts(dataset, [another, another]);
  assert.equal(imported.receipts.length, dataset.receipts.length + 1);
  assert.equal(imported.receipts.at(-1)!.digest, receipt.digest);
});

test('wrong asset, recipient, failed transaction and excess allocations are rejected', () => {
  const dataset = createSampleDataset();
  const receipt = dataset.receipts[0]!;
  for (const patch of [
    { asset: 'FAKE::usdc::USDC' },
    { recipient: 'other-wallet' },
    { status: 'failed' as const },
    { amount: '-1' },
  ])
    assert.throws(() => validateReceipt({ ...receipt, ...patch }, dataset.walletAddress));
  assert.throws(() =>
    allocateReceipt(dataset, {
      id: 'excess',
      receiptId: receipt.id,
      invoiceId: 'cedar-next',
      amount: '1',
      confirmed: true,
      knownAt: '2026-11-05T06:00:00Z',
    }),
  );
  const freeReceipt: Receipt = {
    ...receipt,
    id: 'new',
    transferId: 'new',
    digest: 'new',
    amount: money('2000'),
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
  };
  const imported = importReceipts(dataset, [freeReceipt]);
  assert.throws(() =>
    allocateReceipt(imported, {
      id: 'too-much-invoice',
      receiptId: 'new',
      invoiceId: 'cedar-next',
      amount: money('1900'),
      confirmed: true,
      knownAt: freeReceipt.knownAt,
    }),
  );
});

test('partial payments use the fully-paid date for settlement delay', () => {
  const dataset = createSampleDataset();
  const interim = evaluateDataset(dataset, '2026-09-15').invoices.find(
    (i) => i.id === 'cedar-sep',
  )!;
  assert.equal(interim.status, 'partial');
  assert.equal(interim.received, money('700'));
  assert.equal(interim.outstanding, money('1100'));
  assert.equal(interim.fullyPaidDate, undefined);
  const settled = evaluateDataset(dataset, '2026-09-18').invoices.find(
    (i) => i.id === 'cedar-sep',
  )!;
  assert.equal(settled.status, 'settled');
  assert.equal(settled.firstReceiptDate, '2026-09-14');
  assert.equal(settled.fullyPaidDate, '2026-09-17');
  assert.equal(dateDifference(settled.fullyPaidDate!, settled.dueDate), 7);
});

test('partial settlement orders actual instants across timestamp offsets and late-night calendar days', () => {
  let dataset = createSampleDataset();
  dataset.invoices.push({
    id: 'offset-invoice',
    clientId: 'paper',
    amount: money('200'),
    dueDate: '2026-11-01',
    knownAt: '2026-10-20T06:00:00Z',
    provenance: 'fictional',
  });
  const base = {
    amount: money('100'),
    asset: USDC_SUI,
    recipient: dataset.walletAddress,
    status: 'success' as const,
    knownAt: '2026-11-06T03:00:00Z',
    provenance: 'fictional' as const,
  };
  const later: Receipt = {
    ...base,
    id: 'offset-later',
    transferId: 'fictional:offset-later',
    digest: 'fictional:offset-later',
    occurredAt: '2026-11-05T23:30:00-03:00',
  };
  const earlier: Receipt = {
    ...base,
    id: 'offset-earlier',
    transferId: 'fictional:offset-earlier',
    digest: 'fictional:offset-earlier',
    occurredAt: '2026-11-06T00:00:00+10:00',
  };
  dataset = importReceipts(dataset, [later, earlier]);
  for (const receipt of [later, earlier])
    dataset = allocateReceipt(dataset, {
      id: 'allocation:' + receipt.id,
      receiptId: receipt.id,
      invoiceId: 'offset-invoice',
      amount: receipt.amount,
      confirmed: true,
      knownAt: receipt.knownAt,
    });
  const invoice = evaluateDataset(dataset, '2026-11-06').invoices.find(
    (i) => i.id === 'offset-invoice',
  )!;
  assert.equal(invoice.firstReceiptDate, '2026-11-05');
  assert.equal(invoice.fullyPaidDate, '2026-11-06');
  assert.deepEqual(invoice.observationIds, [earlier.id, later.id]);
  assert.equal(
    evaluateDataset(dataset, '2026-11-05').invoices.find((i) => i.id === 'offset-invoice')!
      .received,
    '0',
  );
});

test('minimum history, bounded median, cautious early-date policy and source IDs are reproducible', () => {
  const dataset = createSampleDataset();
  const insufficient = evaluateDataset(dataset, '2026-07-01').lessons.find(
    (l) => l.clientId === 'cedar',
  )!;
  assert.equal(insufficient.sampleSize, 2);
  assert.equal(insufficient.delayDays, null);
  const learned = evaluateDataset(dataset, '2026-11-05').lessons.find(
    (l) => l.clientId === 'cedar',
  )!;
  assert.equal(learned.sampleSize, 6);
  assert.equal(learned.delayDays, 8);
  assert.equal(learned.window, 6);
  assert.equal(learned.algorithmVersion, ALGORITHM_VERSION);
  assert.equal(learned.sourceObservationIds.length, 7);
  assert.deepEqual(
    evaluateDataset(dataset, '2026-11-05').lessons.find((l) => l.clientId === 'cedar'),
    learned,
  );
  const early = structuredClone(dataset);
  for (const receipt of early.receipts.filter((r) => r.id.startsWith('receipt:aster-'))) {
    const allocation = early.allocations.find((a) => a.receiptId === receipt.id)!;
    const invoice = early.invoices.find((i) => i.id === allocation.invoiceId)!;
    receipt.occurredAt = addDays(invoice.dueDate, -3) + 'T06:00:00Z';
    receipt.knownAt = receipt.occurredAt;
    allocation.knownAt = receipt.occurredAt;
  }
  const earlyLesson = evaluateDataset(early, '2026-11-05').lessons.find(
    (l) => l.clientId === 'aster',
  )!;
  assert.equal(earlyLesson.rawMedianDays, -3);
  assert.equal(earlyLesson.delayDays, 0);
});

test('append-and-supersede correction changes learning but never held cash', () => {
  const dataset = createSampleDataset();
  const before = evaluateDataset(dataset, '2026-11-05');
  const corrected = appendCorrection(dataset, {
    id: 'correction:paper',
    receiptId: 'receipt:paper-sep:full',
    kind: 'reimbursement',
    reason: 'Travel expenses were reimbursed; this was not invoice income.',
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
  });
  const after = evaluateDataset(corrected, '2026-11-05');
  assert.equal(after.cash, before.cash);
  assert.equal(after.lessons.find((l) => l.clientId === 'paper')!.sampleSize, 2);
  assert.equal(after.lessons.find((l) => l.clientId === 'paper')!.status, 'insufficient-history');
  assert.equal(after.invoices.find((i) => i.id === 'paper-sep')!.outstanding, money('400'));
  assert.deepEqual(
    evaluateDataset(corrected, '2026-11-04'),
    evaluateDataset(dataset, '2026-11-04'),
  );
  const reinstated = appendCorrection(corrected, {
    id: 'correction:paper:restore',
    receiptId: 'receipt:paper-sep:full',
    kind: 'include',
    reason: 'Reconciled against the invoice.',
    occurredAt: '2026-11-06T06:00:00Z',
    knownAt: '2026-11-06T06:00:00Z',
  });
  assert.equal(reinstated.corrections[1]!.supersedesRecordId, 'correction:paper');
  assert.equal(
    evaluateDataset(reinstated, '2026-11-06').lessons.find((l) => l.clientId === 'paper')!
      .sampleSize,
    3,
  );
  assert.equal(reinstated.corrections.length, 2);
  assert.equal(dataset.corrections.length, 0);
});

test('reimbursement frees invoice capacity for a replacement receipt while preserving prior cash and history', () => {
  const original = createSampleDataset();
  const prior = evaluateDataset(original, '2026-11-04');
  let dataset = appendCorrection(original, {
    id: 'paper-reimbursement',
    receiptId: 'receipt:paper-sep:full',
    kind: 'reimbursement',
    reason: 'Materials reimbursement, not the expected fee.',
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
  });
  const replacement: Receipt = {
    id: 'replacement-paper',
    transferId: 'fictional:replacement-paper',
    digest: 'fictional:replacement-paper',
    amount: money('400'),
    asset: USDC_SUI,
    recipient: dataset.walletAddress,
    status: 'success',
    occurredAt: '2026-11-05T07:00:00Z',
    knownAt: '2026-11-05T07:00:00Z',
    provenance: 'fictional',
  };
  dataset = importReceipts(dataset, [replacement]);
  dataset = allocateReceipt(dataset, {
    id: 'replacement-paper-allocation',
    receiptId: replacement.id,
    invoiceId: 'paper-sep',
    amount: replacement.amount,
    confirmed: true,
    knownAt: '2026-11-05T08:00:00Z',
  });
  validateDataset(dataset);
  const now = evaluateDataset(dataset, '2026-11-05');
  const invoice = now.invoices.find((i) => i.id === 'paper-sep')!;
  assert.equal(invoice.status, 'settled');
  assert.equal(invoice.received, money('400'));
  assert.equal(invoice.outstanding, '0');
  assert.deepEqual(invoice.observationIds, [replacement.id]);
  assert.equal(now.cash, money('1650'));
  assert.equal(dataset.allocations.filter((a) => a.invoiceId === 'paper-sep').length, 2);
  assert.ok(dataset.receipts.some((r) => r.id === 'receipt:paper-sep:full'));
  assert.deepEqual(evaluateDataset(dataset, '2026-11-04'), prior);
  assert.equal(original.corrections.length, 0);
  assert.equal(original.receipts.length + 1, dataset.receipts.length);
  const saved = JSON.stringify(dataset);
  assert.throws(
    () =>
      appendCorrection(dataset, {
        id: 'invalid-paper-reinclude',
        receiptId: 'receipt:paper-sep:full',
        kind: 'include',
        reason: 'This would count both receipts as the same fee.',
        occurredAt: '2026-11-06T06:00:00Z',
        knownAt: '2026-11-06T06:00:00Z',
      }),
    /over-allocated/,
  );
  assert.equal(JSON.stringify(dataset), saved);
});

test('new reimbursement matches are rejected and later corrections cannot mask an earlier excess', () => {
  const original = createSampleDataset();
  const unused: Receipt = {
    id: 'unmatched-reimbursement',
    transferId: 'fictional:unmatched-reimbursement',
    digest: 'fictional:unmatched-reimbursement',
    amount: money('50'),
    asset: USDC_SUI,
    recipient: original.walletAddress,
    status: 'success',
    occurredAt: '2026-11-04T06:00:00Z',
    knownAt: '2026-11-04T06:00:00Z',
    provenance: 'fictional',
  };
  let dataset = importReceipts(original, [unused]);
  dataset = appendCorrection(dataset, {
    id: 'unmatched-is-reimbursement',
    receiptId: unused.id,
    kind: 'reimbursement',
    reason: 'Travel reimbursement.',
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
  });
  assert.throws(
    () =>
      allocateReceipt(dataset, {
        id: 'invalid-reimbursement-match',
        receiptId: unused.id,
        invoiceId: 'cedar-next',
        amount: unused.amount,
        confirmed: true,
        knownAt: '2026-11-05T07:00:00Z',
      }),
    /reimbursement/,
  );
  dataset = appendCorrection(dataset, {
    id: 'paper-now-reimbursement',
    receiptId: 'receipt:paper-sep:full',
    kind: 'reimbursement',
    reason: 'This frees capacity only from November5 onward.',
    occurredAt: '2026-11-05T08:00:00Z',
    knownAt: '2026-11-05T08:00:00Z',
  });
  const malformed = structuredClone(dataset);
  // At November4 the original400 fee was still active. Later reimbursement cannot erase excess50.
  malformed.allocations.push({
    id: 'earlier-excess',
    receiptId: unused.id,
    invoiceId: 'paper-sep',
    amount: unused.amount,
    confirmed: true,
    knownAt: '2026-11-04T07:00:00Z',
  });
  assert.throws(() => validateDataset(malformed), /over-allocated at a recorded knowledge time/);
  const restored = appendCorrection(dataset, {
    id: 'unmatched-restored',
    receiptId: unused.id,
    kind: 'include',
    reason: 'Reviewed as regular income.',
    occurredAt: '2026-11-06T06:00:00Z',
    knownAt: '2026-11-06T06:00:00Z',
  });
  const matched = allocateReceipt(restored, {
    id: 'valid-restored-match',
    receiptId: unused.id,
    invoiceId: 'cedar-next',
    amount: unused.amount,
    confirmed: true,
    knownAt: '2026-11-06T07:00:00Z',
  });
  assert.equal(
    evaluateDataset(matched, '2026-11-06').invoices.find((i) => i.id === 'cedar-next')!.received,
    money('50'),
  );
});

test('exceptional observation retains a reason and excludes only timing evidence', () => {
  const dataset = createSampleDataset();
  const corrected = appendCorrection(dataset, {
    id: 'exception',
    receiptId: 'receipt:cedar-jul:full',
    kind: 'exceptional',
    reason: 'An exceptional invoicing dispute.',
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
  });
  const result = evaluateDataset(corrected, '2026-11-05');
  assert.equal(result.cash, money('1250'));
  assert.equal(result.invoices.find((i) => i.id === 'cedar-jul')!.status, 'settled');
  const lesson = result.lessons.find((l) => l.clientId === 'cedar')!;
  assert.equal(lesson.sampleSize, 5);
  assert.ok(lesson.excludedObservationIds.includes('receipt:cedar-jul:full'));
  assert.ok(!lesson.sourceObservationIds.includes('receipt:cedar-jul:full'));
});

test('overdue unresolved dates become unknown and are not silently moved or received', () => {
  const dataset = createSampleDataset();
  const evaluation = evaluateDataset(dataset, '2026-11-05');
  const overdue = evaluation.invoices.find((i) => i.id === 'paper-open')!;
  assert.equal(overdue.status, 'overdue');
  assert.equal(overdue.timingUnknown, true);
  assert.equal(overdue.outstanding, money('300'));
  assert.equal(evaluation.lessons.find((l) => l.clientId === 'paper')!.unresolvedCount, 1);
  const scenarios = buildScenarios(dataset, '2026-11-05');
  assert.ok(scenarios[1]!.unknownInvoiceIds.includes('paper-open'));
  assert.ok(!scenarios[1]!.points.some((p) => p.inflow === money('300')));
});

test('later corrections and future outcomes cannot leak into immutable frozen forecasts', () => {
  const dataset = createSampleDataset();
  const frozen = freezeForecast(dataset, 'cedar-oct', '2026-10-01');
  const serialized = JSON.stringify(frozen);
  const corrected = appendCorrection(dataset, {
    id: 'late-correction',
    receiptId: 'receipt:cedar-jul:full',
    kind: 'exceptional',
    reason: 'Later explanation.',
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
  });
  assert.deepEqual(freezeForecast(corrected, 'cedar-oct', '2026-10-01'), frozen);
  assert.equal(JSON.stringify(frozen), serialized);
  assert.ok(!frozen.sourceObservationIds.includes('receipt:cedar-oct:full'));
  const result = evaluateReplay(dataset, '2026-11-05');
  assert.equal(result.resolved, 2);
  assert.equal(result.unresolved, 2);
  assert.ok(result.cases.every((c) => c.knownAt < '2026-11-06'));
  assert.equal(evaluateDataset(dataset, '2026-11-05').cash, money('1250'));
  assert.deepEqual(
    evaluateReplay(corrected).cases.find((c) => c.invoiceId === 'cedar-oct')!.forecast,
    frozen,
  );
});

test('replay derives exact observed errors, same eligible cases, unresolved count, and counterexample', () => {
  const dataset = createSampleDataset();
  const result = evaluateReplay(dataset);
  assert.equal(result.resolved, 4);
  assert.equal(result.unresolved, 1);
  assert.equal(result.eligible, 5);
  assert.equal(result.excluded, 0);
  assert.deepEqual(result.excludedCases, []);
  assert.equal(result.revealedThrough, '2026-12-31');
  assert.ok(result.cases.every((c) => Date.parse(c.forecast.frozenAt) < Date.parse(c.knownAt)));
  assert.equal(result.promisedMeanAbsoluteError, 6);
  assert.equal(result.learnedMeanAbsoluteError, 2.5);
  assert.ok(result.cases.some((c) => c.learnedError > c.promisedError));
  assert.equal(result.cases.find((c) => c.invoiceId === 'cedar-sep')!.actual, '2026-09-17');
});

test('replay respects judge partial/full receipt matching without over-allocation or mutating edits', () => {
  for (const amount of ['100.25', '1800']) {
    let dataset = createSampleDataset();
    const receipt: Receipt = {
      id: 'judge-receipt',
      transferId: 'fictional:judge-receipt',
      digest: 'fictional:judge-receipt',
      amount: money(amount),
      asset: USDC_SUI,
      recipient: dataset.walletAddress,
      status: 'success',
      occurredAt: '2026-11-05T06:00:00Z',
      knownAt: '2026-11-05T06:00:00Z',
      provenance: 'fictional',
    };
    dataset = importReceipts(dataset, [receipt]);
    dataset = allocateReceipt(dataset, {
      id: 'judge-allocation',
      receiptId: receipt.id,
      invoiceId: 'cedar-next',
      amount: receipt.amount,
      confirmed: true,
      knownAt: receipt.knownAt,
    });
    const before = JSON.stringify(dataset);
    const evaluation = evaluateReplay(dataset);
    assert.equal(JSON.stringify(dataset), before);
    const measured = evaluation.cases.find((c) => c.invoiceId === 'cedar-next');
    if (amount === '1800') {
      assert.equal(measured, undefined);
      assert.equal(evaluation.resolved, 3);
      assert.equal(evaluation.eligible, 4);
      assert.equal(evaluation.excluded, 1);
      assert.deepEqual(evaluation.excludedCases, [
        {
          invoiceId: 'cedar-next',
          asOf: '2026-11-05',
          reason: 'already-settled-at-freeze',
        },
      ]);
      assert.throws(() => freezeForecast(dataset, 'cedar-next', '2026-11-05'), /already known/);
    } else {
      assert.equal(measured!.actual, '2026-11-19');
      assert.equal(evaluation.resolved, 4);
      assert.equal(evaluation.eligible, 5);
      assert.equal(evaluation.excluded, 0);
    }
    assert.equal(evaluation.unresolved, 1);
    assert.equal(
      evaluateDataset(dataset, '2026-11-05').invoices.find((i) => i.id === 'cedar-next')!
        .outstanding,
      money(amount === '1800' ? '0' : '1699.75'),
    );
  }
});

test('replay fills capacity known at the outcome and fails when a later match conflicts', () => {
  let dataset = createSampleDataset();
  const receipt: Receipt = {
    id: 'judge-reimbursed',
    transferId: 'fictional:judge-reimbursed',
    digest: 'fictional:judge-reimbursed',
    amount: money('100.25'),
    asset: USDC_SUI,
    recipient: dataset.walletAddress,
    status: 'success',
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
    provenance: 'fictional',
  };
  dataset = importReceipts(dataset, [receipt]);
  dataset = allocateReceipt(dataset, {
    id: 'judge-reimbursed-match',
    receiptId: receipt.id,
    invoiceId: 'cedar-next',
    amount: receipt.amount,
    confirmed: true,
    knownAt: receipt.knownAt,
  });
  dataset = appendCorrection(dataset, {
    id: 'judge-reimbursed-correction',
    receiptId: receipt.id,
    kind: 'reimbursement',
    reason: 'Receipt was an expense reimbursement.',
    occurredAt: '2026-11-06T06:00:00Z',
    knownAt: '2026-11-06T06:00:00Z',
  });
  const before = JSON.stringify(dataset);
  const replay = evaluateReplay(dataset);
  assert.equal(replay.cases.find((c) => c.invoiceId === 'cedar-next')!.actual, '2026-11-19');
  assert.equal(JSON.stringify(dataset), before);
  const futureReceipt: Receipt = {
    ...receipt,
    id: 'judge-future',
    transferId: 'fictional:judge-future',
    digest: 'fictional:judge-future',
    occurredAt: '2026-11-25T06:00:00Z',
    knownAt: '2026-11-25T06:00:00Z',
  };
  const future = allocateReceipt(importReceipts(dataset, [futureReceipt]), {
    id: 'judge-future-match',
    receiptId: futureReceipt.id,
    invoiceId: 'cedar-next',
    amount: futureReceipt.amount,
    confirmed: true,
    knownAt: futureReceipt.knownAt,
  });
  const futureBefore = JSON.stringify(future);
  assert.deepEqual(evaluateReplay(future, '2026-11-20'), evaluateReplay(dataset, '2026-11-20'));
  assert.throws(
    () => evaluateReplay(future),
    /Replay conflict at 2026-11-25T06:00:00.000Z: Payment over-allocated/,
  );
  assert.equal(JSON.stringify(future), futureBefore);
});

test('future allocation cannot change a December 1 frozen numerical forecast', () => {
  const dataset = createSampleDataset();
  const prior = evaluateDataset(dataset, '2026-11-05');
  ['may', 'jun', 'jul', 'aug', 'sep', 'oct'].forEach((month, index) => {
    const invoice = dataset.invoices.find((i) => i.id === `cedar-${month}`)!;
    invoice.dueDate = addDays(
      prior.invoices.find((i) => i.id === invoice.id)!.fullyPaidDate!,
      -(index + 1),
    );
  });
  validateDataset(dataset);
  const receipt: Receipt = {
    id: 'december-future',
    transferId: 'fictional:december-future',
    digest: 'fictional:december-future',
    amount: money('1800'),
    asset: USDC_SUI,
    recipient: dataset.walletAddress,
    status: 'success',
    occurredAt: '2026-12-25T06:00:00Z',
    knownAt: '2026-12-25T06:00:00Z',
    provenance: 'fictional',
  };
  const future = allocateReceipt(importReceipts(dataset, [receipt]), {
    id: 'december-future-match',
    receiptId: receipt.id,
    invoiceId: 'cedar-next',
    amount: receipt.amount,
    confirmed: true,
    knownAt: receipt.knownAt,
  });
  const before = JSON.stringify(future);
  const baseline = evaluateReplay(dataset, '2026-12-15');
  const withFuture = evaluateReplay(future, '2026-12-15');
  const prediction = withFuture.cases.find((c) => c.invoiceId === 'cedar-dec')!.forecast;
  assert.deepEqual(withFuture, baseline);
  assert.equal(prediction.learnedDate, '2026-12-15');
  assert.equal(prediction.frozenAt, '2026-12-01T18:29:59.999Z');
  assert.ok(prediction.sourceObservationIds.includes('heldout:cedar-next'));
  assert.ok(!prediction.sourceObservationIds.includes(receipt.id));
  assert.throws(
    () => evaluateReplay(future),
    /Replay conflict at 2026-12-25T06:00:00.000Z: Payment over-allocated/,
  );
  assert.deepEqual(evaluateReplay(future, '2026-12-15'), baseline);
  assert.equal(JSON.stringify(future), before);
});

test('future correction cannot retract an authored outcome or rewrite an earlier prediction', () => {
  let dataset = createSampleDataset();
  const receipt: Receipt = {
    id: 'reinclude-future',
    transferId: 'fictional:reinclude-future',
    digest: 'fictional:reinclude-future',
    amount: money('100.25'),
    asset: USDC_SUI,
    recipient: dataset.walletAddress,
    status: 'success',
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
    provenance: 'fictional',
  };
  dataset = allocateReceipt(importReceipts(dataset, [receipt]), {
    id: 'reinclude-future-match',
    receiptId: receipt.id,
    invoiceId: 'cedar-next',
    amount: receipt.amount,
    confirmed: true,
    knownAt: receipt.knownAt,
  });
  dataset = appendCorrection(dataset, {
    id: 'reinclude-future-reimbursement',
    receiptId: receipt.id,
    kind: 'reimbursement',
    reason: 'This was a reimbursement, not invoice income.',
    occurredAt: '2026-11-06T06:00:00Z',
    knownAt: '2026-11-06T06:00:00Z',
  });
  const future = appendCorrection(dataset, {
    id: 'reinclude-future-income',
    receiptId: receipt.id,
    kind: 'include',
    reason: 'A later interpretation conflicts with the authored replacement payment.',
    occurredAt: '2026-12-25T06:00:00Z',
    knownAt: '2026-12-25T06:00:00Z',
  });
  const before = JSON.stringify(future);
  const baseline = evaluateReplay(dataset, '2026-12-15');
  assert.equal(baseline.cases.find((c) => c.invoiceId === 'cedar-next')!.actual, '2026-11-19');
  assert.deepEqual(evaluateReplay(future, '2026-12-15'), baseline);
  assert.throws(
    () => evaluateReplay(future),
    /Replay conflict at 2026-12-25T06:00:00.000Z: Payment over-allocated/,
  );
  assert.equal(JSON.stringify(future), before);
});

test('replay outcome knowledge includes the later confirmed allocation, not just receipt time', () => {
  const dataset = createSampleDataset();
  const receipt: Receipt = {
    id: 'later-confirmed',
    transferId: 'fictional:later-confirmed',
    digest: 'fictional:later-confirmed',
    amount: money('1800'),
    asset: USDC_SUI,
    recipient: dataset.walletAddress,
    status: 'success',
    occurredAt: '2026-11-04T06:00:00Z',
    knownAt: '2026-11-04T06:00:00Z',
    provenance: 'fictional',
  };
  const matched = allocateReceipt(importReceipts(dataset, [receipt]), {
    id: 'later-confirmed-match',
    receiptId: receipt.id,
    invoiceId: 'cedar-next',
    amount: receipt.amount,
    confirmed: true,
    knownAt: '2026-11-07T06:00:00Z',
  });
  const measured = evaluateReplay(matched).cases.find((c) => c.invoiceId === 'cedar-next')!;
  assert.equal(measured.actual, '2026-11-04');
  assert.equal(measured.knownAt, '2026-11-07T06:00:00Z');
  assert.ok(Date.parse(measured.forecast.frozenAt) < Date.parse(measured.knownAt));
  assert.ok(!measured.forecast.sourceObservationIds.includes(receipt.id));
});

test('explicit matching known at an authored outcome instant precedes the fixture', () => {
  const dataset = createSampleDataset();
  const receipt: Receipt = {
    id: 'same-instant',
    transferId: 'fictional:same-instant',
    digest: 'fictional:same-instant',
    amount: money('1800'),
    asset: USDC_SUI,
    recipient: dataset.walletAddress,
    status: 'success',
    occurredAt: '2026-11-19T06:00:00Z',
    knownAt: '2026-11-19T06:00:00Z',
    provenance: 'fictional',
  };
  const matched = allocateReceipt(importReceipts(dataset, [receipt]), {
    id: 'same-instant-match',
    receiptId: receipt.id,
    invoiceId: 'cedar-next',
    amount: receipt.amount,
    confirmed: true,
    knownAt: receipt.knownAt,
  });
  const before = JSON.stringify(matched);
  const replay = evaluateReplay(matched);
  const measured = replay.cases.find((c) => c.invoiceId === 'cedar-next')!;
  const laterForecast = replay.cases.find((c) => c.invoiceId === 'cedar-dec')!.forecast;
  assert.equal(measured.actual, '2026-11-19');
  assert.ok(laterForecast.sourceObservationIds.includes(receipt.id));
  assert.ok(!laterForecast.sourceObservationIds.includes('heldout:cedar-next'));
  assert.equal(replay.resolved, 4);
  assert.equal(JSON.stringify(matched), before);
});

test('confirmed complete recovery into empty workspace reproduces active lessons; failed/pending excluded', () => {
  const dataset = createSampleDataset();
  const records = createMemoryRecords(dataset);
  const manifest = {
    schemaVersion: 1 as const,
    datasetId: dataset.id,
    recordIds: records.map((r) => r.id),
  };
  const confirmed: ConfirmedMemory[] = records.map((record, index) => ({
    record: JSON.parse(JSON.stringify(record)),
    state: 'confirmed',
    blobId: `test-only-blob-${index}`,
    verifiedAt: '2026-11-05T12:00:00Z',
  }));
  const recovered = restoreMemory(confirmed, manifest);
  assert.deepEqual(recovered.dataset, dataset);
  assert.deepEqual(recovered.lessons, evaluateDataset(dataset, '2026-11-05').lessons);
  assert.notEqual(recovered.dataset, dataset);
  for (const state of ['pending', 'failed'] as const) {
    const incomplete = structuredClone(confirmed);
    incomplete[1]!.state = state;
    assert.throws(() => restoreMemory(incomplete, manifest), /Incomplete restore/);
  }
  assert.throws(() => restoreMemory(confirmed.slice(1), manifest), /Incomplete restore/);
  assert.throws(() => restoreMemory([...confirmed, confirmed[0]!], manifest), /Incomplete restore/);
  const tampered = structuredClone(confirmed);
  const lesson = tampered.find((m) => m.record.recordType === 'lesson')!;
  (lesson.record.payload as { delayDays: number }).delayDays = 99;
  assert.throws(() => restoreMemory(tampered, manifest), /does not reproduce/);
});

test('restoration rejects malformed schema and over-allocation instead of resetting history', () => {
  const dataset = createSampleDataset();
  const malformed = structuredClone(dataset);
  malformed.allocations[0]!.amount = money('99999');
  assert.throws(() => validateDataset(malformed), /over-allocated/);
  const wrongAsset = structuredClone(dataset);
  wrongAsset.receipts[0]!.asset = USDC_SUI.toUpperCase();
  assert.throws(() => validateDataset(wrongAsset), /native USDC/);
});

test('dataset boundary rejects duplicate IDs, missing money/timestamps and unsupported settings', () => {
  const dataset = createSampleDataset();
  const mutations: Array<(value: typeof dataset) => void> = [
    (value) => {
      value.invoices.push(structuredClone(value.invoices[0]!));
    },
    (value) => {
      value.allocations[1]!.id = value.allocations[0]!.id;
    },
    (value) => {
      value.currency = 'SUI' as 'USDC';
    },
    (value) => {
      value.timezone = 'invented/timezone';
    },
    (value) => {
      delete (value.obligations[0] as Partial<(typeof value.obligations)[number]>).amount;
    },
    (value) => {
      value.obligations[0]!.knownAt = 'yesterday';
    },
    (value) => {
      value.receipts[0]!.knownAt = '2026-05-01T00:00:00Z';
    },
    (value) => {
      value.invoices[0]!.knownAt = '2026-02-30T00:00:00Z';
    },
    (value) => {
      value.allocations[0]!.confirmed = 'yes' as unknown as boolean;
    },
    (value) => {
      value.obligations[0]!.provenance = 'verified' as 'fictional';
    },
    (value) => {
      value.invoices[0]!.clientId = 'missing-client';
    },
  ];
  for (const mutate of mutations) {
    const malformed = structuredClone(dataset);
    mutate(malformed);
    assert.throws(() => validateDataset(malformed));
  }
});

test('correction versions must form one monotonic supersession chain', () => {
  const base = createSampleDataset();
  const corrected = appendCorrection(base, {
    id: 'first',
    receiptId: 'receipt:paper-sep:full',
    kind: 'reimbursement',
    reason: 'Expense reimbursement.',
    occurredAt: '2026-11-05T06:00:00Z',
    knownAt: '2026-11-05T06:00:00Z',
  });
  const next = appendCorrection(corrected, {
    id: 'second',
    receiptId: 'receipt:paper-sep:full',
    kind: 'include',
    reason: 'Correction reversed after reconciliation.',
    occurredAt: '2026-11-06T06:00:00Z',
    knownAt: '2026-11-06T06:00:00Z',
  });
  const gaps = structuredClone(next);
  gaps.corrections[1]!.effectiveVersion = 3;
  assert.throws(() => validateDataset(gaps), /version chain/);
  const wrongPointer = structuredClone(next);
  wrongPointer.corrections[1]!.supersedesRecordId = 'unrelated';
  assert.throws(() => validateDataset(wrongPointer), /version chain/);
  const outOfOrder = structuredClone(next);
  outOfOrder.corrections[1]!.knownAt = '2026-11-05T05:00:00Z';
  assert.throws(() => validateDataset(outOfOrder));
  const before = evaluateDataset(base, '2026-11-05').lessons.find((l) => l.clientId === 'paper')!;
  const after = evaluateDataset(corrected, '2026-11-05').lessons.find(
    (l) => l.clientId === 'paper',
  )!;
  assert.ok(after.effectiveVersion > before.effectiveVersion);
  assert.notEqual(after.id, before.id);
});

test('recovery verifies observation and lesson envelopes, not just payload IDs', () => {
  const records = createMemoryRecords(createSampleDataset());
  const manifest = {
    schemaVersion: 1 as const,
    datasetId: createSampleDataset().id,
    recordIds: records.map((r) => r.id),
  };
  const original: ConfirmedMemory[] = records.map((record, index) => ({
    record,
    state: 'confirmed',
    blobId: `test-only-blob-${index}`,
    verifiedAt: '2026-11-05T12:00:00Z',
  }));
  const wrongObservation = structuredClone(original);
  wrongObservation.find((m) => m.record.recordType === 'observation')!.record.knownAt =
    '2026-11-05T01:00:00Z';
  assert.throws(() => restoreMemory(wrongObservation, manifest), /envelope/);
  const wrongLesson = structuredClone(original);
  wrongLesson.find((m) => m.record.recordType === 'lesson')!.record.effectiveVersion += 1;
  assert.throws(() => restoreMemory(wrongLesson, manifest), /envelope/);
  const missingLesson = structuredClone(manifest);
  missingLesson.recordIds = missingLesson.recordIds.filter((id) => !id.startsWith('lesson:paper:'));
  assert.throws(() => restoreMemory(original, missingLesson), /active timing lessons/);
  const badVerification = structuredClone(original);
  badVerification[0]!.verifiedAt = 'not-a-timestamp';
  assert.throws(() => restoreMemory(badVerification, manifest), /Timestamp/);
});

test('replay end-of-day timestamps follow profile timezone, including daylight saving changes', () => {
  assert.equal(endOfDayTimestamp('2026-11-05', 'Asia/Kolkata'), '2026-11-05T18:29:59Z');
  assert.equal(endOfDayTimestamp('2026-11-05', 'UTC'), '2026-11-05T23:59:59Z');
  assert.equal(endOfDayTimestamp('2026-11-01', 'America/New_York'), '2026-11-02T04:59:59Z');
  assert.equal(endOfDayTimestamp('2026-03-08', 'America/New_York'), '2026-03-09T03:59:59Z');
});
