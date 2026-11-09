import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createSampleDataset,
  evaluateDataset,
  buildScenarios,
  money,
} from '../src/domain/index.js';
import { createExceptionalDelayExample, EXCEPTION_EXAMPLE_ID } from '../src/demo-examples.js';

test('authored exceptional-delay example preserves cash and earlier interpretation with a separate identity', () => {
  const canonical = createSampleDataset();
  const original = JSON.stringify(canonical);
  const example = createExceptionalDelayExample();
  assert.equal(example.id, EXCEPTION_EXAMPLE_ID);
  assert.notEqual(example.id, canonical.id);
  assert.equal(JSON.stringify(createSampleDataset()), original);
  const before = evaluateDataset(example, '2026-11-03');
  const after = evaluateDataset(example, '2026-11-05');
  const previousLesson = before.lessons.find((lesson) => lesson.clientId === 'aster')!;
  const revisedLesson = after.lessons.find((lesson) => lesson.clientId === 'aster')!;
  assert.equal(previousLesson.sampleSize, 4);
  assert.equal(previousLesson.delayDays, 1);
  assert.equal(revisedLesson.sampleSize, 3);
  assert.equal(revisedLesson.delayDays, 0);
  assert.ok(previousLesson.sourceObservationIds.includes('receipt:aster-oct:full'));
  assert.ok(!revisedLesson.sourceObservationIds.includes('receipt:aster-oct:full'));
  assert.ok(revisedLesson.excludedObservationIds.includes('receipt:aster-oct:full'));
  assert.equal(after.invoices.find((invoice) => invoice.id === 'aster-oct')!.status, 'settled');
  assert.equal(after.cash, before.cash);
  assert.equal(after.cash, money('1250'));
  assert.equal(
    after.invoices.find((invoice) => invoice.id === 'aster-next')!.learnedDate,
    '2026-11-21',
  );
  assert.equal(
    before.invoices.find((invoice) => invoice.id === 'aster-next')!.learnedDate,
    '2026-11-22',
  );
  assert.ok(after.corrections[0]!.reason.includes('Authored example'));
  for (const scenario of buildScenarios(example, '2026-11-05')) {
    assert.equal(scenario.from, '2026-11-05');
    assert.equal(scenario.through, '2026-12-05');
  }
});
