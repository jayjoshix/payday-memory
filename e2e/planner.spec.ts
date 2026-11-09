import { test, expect } from '@playwright/test';
import { createHash } from 'node:crypto';
import { createCuratedPublicationDataset } from '../src/sponsors/curated.js';
import { createSampleDataset, USDC_SUI, validateDataset } from '../src/domain/index.js';

test.beforeEach(async ({ page }) => {
  // Normal browser checks never depend on an operator's captured Mainnet state.
  await page.route('**/api/evidence', (route) =>
    route.fulfill({
      json: {
        evidenceMode: 'offline-test-fixture',
        tatum: { status: 'skipped' },
        memory: { confirmedCount: 0, recoveryStatus: 'not-verified' },
      },
    }),
  );
});

test('complete private sample flow, corrections persist and mobile stays usable', async ({
  page,
}, info) => {
  test.setTimeout(60_000);
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) externalRequests.push(request.url());
  });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Your next payday, in perspective.' }),
  ).toBeVisible();
  await expect(page.getByText('$1,250.00', { exact: false }).first()).toBeVisible();
  await expect(page.getByText('All payment history is fictional.', { exact: false })).toBeVisible();
  await page.screenshot({
    path: `docs/screenshots/overview-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Preview purchase' }).click();
  await expect(page.getByText('$595.00 below buffer')).toBeVisible();
  await expect(page.getByText('Buffer covered', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Every lesson has a paper trail.' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review reimbursement' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Give this receipt the right meaning' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByText('Reclassified as reimbursement', { exact: true })).toBeVisible();
  await expect(page.getByText('Cash remains $1,250.00.', { exact: false })).toBeVisible();
  await expect(page.getByText('Not enough history', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(page.getByText('Reclassified as reimbursement', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Check Mainnet recovery' }).click();
  await expect(page.getByText('Mainnet restore is unavailable:', { exact: false })).toBeVisible();
  await page.screenshot({
    path: `docs/screenshots/memory-${info.project.name}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Expected payments', exact: true }).click();
  await page.getByRole('button', { name: 'Expected payment', exact: true }).click();
  await page.getByLabel('Client alias').fill('Juniper Sample');
  await page.getByRole('textbox', { name: 'Amount, USDC' }).fill('125.75');
  await page.getByRole('button', { name: 'Save expected payment' }).click();
  await expect(page.getByText('Juniper Sample', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add sample receipt' }).click();
  await page.getByLabel('Receipt amount, USDC').fill('100.25');
  await page.getByRole('button', { name: 'Record sample receipt', exact: true }).click();
  const unmatched = page.getByRole('row').filter({ hasText: 'Unmatched' });
  await expect(unmatched).toBeVisible();
  await unmatched.getByRole('button', { name: 'Match', exact: true }).click();
  await page.getByRole('dialog').getByRole('combobox').selectOption('cedar-next');
  await expect(page.getByRole('dialog').getByLabel('Amount to allocate, USDC')).toHaveValue(
    '100.25',
  );
  await page.getByRole('button', { name: 'Confirm match' }).click();
  await expect(page.getByText('Receipt allocation saved.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Cash-flow timeline', exact: true }).click();
  await page.getByLabel('Replay knowledge date').fill('2026-09-01');
  await expect(page.getByText('Sep 1, 2026', { exact: false })).toHaveCount(
    info.project.name === 'desktop' ? 1 : 1,
  );
  await page.getByText('Read the daily cash table', { exact: true }).click();
  await expect(page.getByRole('table').first()).toBeVisible();
  await page.screenshot({
    path: `docs/screenshots/timeline-${info.project.name}.png`,
    fullPage: true,
  });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
  expect(overflow).toBe(false);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
});

test('restored opening dates bound replay input and stay usable after reload', async ({ page }) => {
  test.setTimeout(90_000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Cash-flow timeline', exact: true }).click();
  await page.getByLabel('Replay knowledge date').fill('2026-09-01');

  for (const opening of ['2026-09-15', '2026-11-20', '2026-09-15']) {
    const dataset = createSampleDataset();
    dataset.opening.date = opening;
    dataset.invoices = [];
    dataset.receipts = [];
    dataset.allocations = [];
    dataset.corrections = [];
    dataset.obligations = [];
    validateDataset(dataset);
    await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
    await page.getByLabel('Restore local export').setInputFiles({
      name: 'later-opening-local-export.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(dataset)),
    });
    await expect(page.getByText('Local export restored.', { exact: false })).toBeVisible();
    await page.getByRole('button', { name: 'Cash-flow timeline', exact: true }).click();
    const date = page.getByLabel('Replay knowledge date');
    await expect(date).toHaveAttribute('min', opening);
    await expect(date).toHaveAttribute('max', opening > '2026-11-05' ? opening : '2026-11-05');
    const selected = await date.inputValue();
    expect(selected >= opening).toBe(true);
    expect(selected <= (await date.getAttribute('max'))!).toBe(true);
    await date.fill('2026-09-01');
    await expect(date).toHaveValue(selected);
    await date.fill('');
    await expect(date).toHaveValue(selected);
    await page.reload();
    await page.getByRole('button', { name: 'Cash-flow timeline', exact: true }).click();
    await expect(page.getByLabel('Replay knowledge date')).toHaveValue(
      opening > '2026-11-05' ? opening : '2026-11-05',
    );
    await expect(
      page.getByRole('heading', { name: 'A clearer view of the days ahead.' }),
    ).toBeVisible();
  }
  expect(errors).toEqual([]);
});

test('a failed Tatum refresh retains the stale balance, capture time and failure explanation', async ({
  page,
}) => {
  test.setTimeout(60_000);
  const observedAt = '2026-11-08T12:44:45.757Z';
  const failedAt = '2026-11-09T10:00:00Z';
  await page.route('**/api/evidence', (route) =>
    route.fulfill({
      json: {
        evidenceMode: 'offline-test-fixture',
        tatum: {
          status: 'stale',
          provider: 'Tatum',
          network: 'sui-mainnet',
          balanceSnapshot: {
            amount: '123450000',
            coinType: USDC_SUI,
            address: '0x' + 'a'.repeat(64),
            observedAt,
            source: 'chain-observed',
            provider: 'Tatum',
            network: 'sui-mainnet',
            stale: true,
          },
          receipts: [],
          lastFailure: { code: 'timeout', message: 'Tatum read timed out.', at: failedAt },
          requestsAttempted: 1,
          maximumRequests: 1,
        },
      },
    }),
  );
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) external.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(
    page.getByText(`$123.45 native USDC · captured ${observedAt}`, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText(`The latest Tatum check timed out at ${failedAt}.`, { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText('Opening this sample does not refresh the balance.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Open connected sample', exact: true }).click();
  await expect(
    page.getByText(`Captured public chain observations from ${observedAt}. Stale snapshot.`, {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText('No balance refresh was requested.', { exact: false })).toBeVisible();
  await page.reload();
  await expect(
    page.getByText('Stale chain snapshot · hypothetical plan', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.current-cash strong')).toContainText('$123.45');
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
    false,
  );
  expect(external).toEqual([]);
});

test('a failed Tatum check without a snapshot explains that the balance is unavailable', async ({
  page,
}) => {
  await page.route('**/api/evidence', (route) =>
    route.fulfill({
      json: {
        evidenceMode: 'offline-test-fixture',
        tatum: {
          status: 'failed',
          lastFailure: {
            code: 'timeout',
            message: 'Tatum read timed out.',
            at: '2026-11-09T10:00:00Z',
          },
        },
      },
    }),
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(
    page.getByRole('alert').filter({ hasText: 'No captured balance is available.' }),
  ).toBeVisible();
  await expect(page.getByText('Your local plan is intact.', { exact: false }).last()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Open connected sample', exact: true }),
  ).toHaveCount(0);
});

test('the exceptional delay example changes learning and reset preserves the original sample', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Load exceptional-delay example', exact: true }).click();
  await expect(page.getByText('Excluded as exceptional', { exact: true })).toBeVisible();
  let aster = page
    .locator('.lesson')
    .filter({ has: page.getByRole('heading', { name: 'Aster Studio', exact: true }) });
  await expect(aster.getByText('3 completed payments', { exact: false })).toBeVisible();
  await expect(aster.getByText('Around the due date', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('payday-memory:disposable-demo:v1')!).id,
    ),
  ).toBe('payday-memory-fictional-exception-v1');
  await page.getByRole('button', { name: 'Cash-flow timeline', exact: true }).click();
  await page.getByLabel('Replay knowledge date').fill('2026-11-03');
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  aster = page
    .locator('.lesson')
    .filter({ has: page.getByRole('heading', { name: 'Aster Studio', exact: true }) });
  await expect(aster.getByText('4 completed payments', { exact: false })).toBeVisible();
  await expect(aster.getByText('1 day after due', { exact: true })).toBeVisible();
  await aster.getByText('Inspect the source observations', { exact: true }).click();
  await expect(aster.getByText('fictional ·', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'New sample', exact: true }).click();
  await expect(page.getByText('Excluded as exceptional', { exact: true })).toHaveCount(0);
  await expect(page.getByText('No corrections yet.', { exact: false })).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem('payday-memory:disposable-demo:v1')!).id,
    ),
  ).toBe(createSampleDataset().id);
});

test('keyboard can reach navigation and a fresh context has no previous edits', async ({
  page,
}) => {
  await page.goto('/');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to planner' })).toBeFocused();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(page.getByText('No corrections yet.', { exact: false })).toBeVisible();
  const response = await page.request.post('/api/operator/seed');
  expect(response.status()).toBe(401);
});

test('unreadable browser history is preserved until an explicit reset', async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem('payday-memory:disposable-demo:v1', '{broken'),
  );
  await page.goto('/');
  await expect(
    page.getByText('Your saved sample could not be read.', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Expected payments', exact: true }).click();
  await page.getByRole('button', { name: 'Expected payment', exact: true }).click();
  await page.getByLabel('Amount, USDC', { exact: true }).fill('100');
  await page.getByRole('button', { name: 'Save expected payment' }).click();
  expect(await page.evaluate(() => localStorage.getItem('payday-memory:disposable-demo:v1'))).toBe(
    '{broken',
  );
  await expect(
    page
      .getByRole('dialog')
      .getByText('The unreadable saved copy was preserved.', { exact: false }),
  ).toBeVisible();
});

test('captured recovery is hash checked, isolated and retained without an external request', async ({
  page,
}) => {
  const dataset = createCuratedPublicationDataset();
  const hash = createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
  const memory = {
    confirmedCount: 20,
    recoveryStatus: 'confirmed',
    recoveredDatasetHash: hash,
    accountScope: 'offline-browser-fixture',
    recoveryVerifiedAt: '2026-11-08T12:00:00Z',
    manifestReceipt: { blobId: 'offline-browser-manifest' },
    retentionAssessment: { status: 'unverified' },
  };
  const capture = {
    schemaVersion: 1,
    evidenceMode: 'captured',
    provider: 'Walrus Memory',
    network: 'sui-mainnet',
    datasetHash: hash,
    accountScope: memory.accountScope,
    verifiedAt: memory.recoveryVerifiedAt,
    manifestBlobId: memory.manifestReceipt.blobId,
    recordCount: 20,
    dataset,
  };
  await page.route('**/api/evidence', (route) =>
    route.fulfill({
      json: { evidenceMode: 'offline-test-fixture', memory },
    }),
  );
  let corrupt = true;
  await page.route('**/api/recovery-capture', (route) =>
    route.fulfill({
      json: corrupt ? { ...capture, dataset: { ...dataset, buffer: '300000001' } } : capture,
    }),
  );
  const external: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4173')) external.push(request.url());
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await page.getByRole('button', { name: 'Load recovered sample', exact: true }).click();
  await expect(
    page.getByText('Captured recovery content failed its hash check.', { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem('payday-memory:disposable-demo:v1')),
  ).toBeNull();
  corrupt = false;
  await page.getByRole('button', { name: 'Load recovered sample', exact: true }).click();
  await expect(
    page.getByText('Captured Mainnet recovery loaded into this disposable sample.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText('Reclassified as reimbursement', { exact: true })).toBeVisible();
  await expect(page.getByText('Not enough history', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Storage expiry through judging is unverified.', { exact: false }),
  ).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('payday-memory:disposable-demo:v1')!),
  );
  expect(saved.id).toBe(dataset.id);
  await page.reload();
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(page.getByText('Reclassified as reimbursement', { exact: true })).toBeVisible();
  expect(external).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)).toBe(
    false,
  );
});
