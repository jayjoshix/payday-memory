import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
const base = path.resolve('dist');
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  if (!pathname.startsWith('/judge/')) {
    response.writeHead(404);
    response.end();
    return;
  }
  const file = path.resolve(
    base,
    '.' + pathname.slice('/judge'.length),
    pathname.endsWith('/') ? 'index.html' : '',
  );
  if (!file.startsWith(base + path.sep)) {
    response.writeHead(403);
    response.end();
    return;
  }
  try {
    const bytes = await readFile(file);
    const type = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml',
    }[path.extname(file)];
    response.writeHead(200, { 'Content-Type': type ?? 'application/octet-stream' });
    response.end(bytes);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(4174, '127.0.0.1', resolve));
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium'),
});
try {
  const page = await browser.newPage();
  const errors = [];
  const externalRequests = [];
  page.on('request', (request) => {
    if (!request.url().startsWith('http://127.0.0.1:4174/')) externalRequests.push(request.url());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('http://127.0.0.1:4174/judge/');
  await expect(
    page.getByRole('heading', { name: 'Your next payday, in perspective.' }),
  ).toBeVisible();
  expect(await page.locator('.brand img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(
    0,
  );
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(
    page.getByText('Captured status, not a live sponsor request', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Expected payments', exact: true }).click();
  await page.getByRole('button', { name: 'Expected payment', exact: true }).click();
  await page.getByLabel('Client alias').fill('Paper Lane');
  await page.getByLabel('Amount, USDC', { exact: true }).fill('200');
  await page.getByLabel('Due date', { exact: true }).fill('2026-11-16');
  await page.getByRole('button', { name: 'Save expected payment' }).click();
  await page.getByRole('button', { name: 'Cash-flow timeline', exact: true }).click();
  await page.getByText('Read the daily cash table', { exact: true }).click();
  const november16 = () =>
    page.locator('tbody tr').filter({ hasText: 'Nov 16' }).first().locator('td').nth(1);
  await expect(november16()).toHaveText('−$55.00');
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  const paperLesson = () =>
    page
      .locator('.lesson')
      .filter({ has: page.getByRole('heading', { name: 'Paper Lane', exact: true }) });
  await expect(
    paperLesson().getByText('Next planning date: Nov 17', { exact: false }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Review reimbursement' }).click();
  await page.getByRole('button', { name: 'Save correction' }).click();
  await expect(
    paperLesson().getByText('Next planning date: Nov 16', { exact: false }),
  ).toBeVisible();
  await expect(page.getByText('Cash remains $1,250.00.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Cash-flow timeline', exact: true }).click();
  await page.getByText('Read the daily cash table', { exact: true }).click();
  await expect(november16()).toHaveText('$145.00');
  await page.reload();
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(
    paperLesson().getByText('Next planning date: Nov 16', { exact: false }),
  ).toBeVisible();
  await page.evaluate(() => {
    scrollTo(0, 0);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  await page.screenshot({ path: 'docs/screenshots/corrected-forecast-static.png', fullPage: true });
  const capturedEvidence = JSON.parse(await readFile('dist/evidence.json', 'utf8'));
  let capturedRecovery = 'skipped: no confirmed capture';
  if (capturedEvidence.memory?.recoveryStatus === 'confirmed') {
    const capture = JSON.parse(await readFile('dist/recovered-sample.json', 'utf8'));
    await page.getByRole('button', { name: 'New sample', exact: true }).click();
    await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
    await page.getByRole('button', { name: 'Load recovered sample', exact: true }).click();
    await expect(
      page.getByText('Captured Mainnet recovery loaded into this disposable sample.', {
        exact: false,
      }),
    ).toBeVisible();
    const restored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem('payday-memory:disposable-demo:v1')),
    );
    expect(restored).toEqual(capture.dataset);
    await page.reload();
    await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
    await page.screenshot({ path: 'docs/screenshots/memory-mainnet-static.png', fullPage: true });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await mobile.goto('http://127.0.0.1:4174/judge/');
    await mobile.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
    await mobile.getByRole('button', { name: 'Load recovered sample', exact: true }).click();
    await expect(
      mobile.getByText('Captured Mainnet recovery loaded into this disposable sample.', {
        exact: false,
      }),
    ).toBeVisible();
    await mobile.screenshot({ path: 'docs/screenshots/memory-mainnet-mobile.png', fullPage: true });
    const overflow = await mobile.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
      elements: [...document.querySelectorAll('body *')]
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            element instanceof HTMLElement &&
            !element.closest('.chart-viewport, .table-scroll') &&
            rect.width > 0 &&
            rect.right > innerWidth + 1
          );
        })
        .slice(0, 15)
        .map((element) => ({
          tag: element.tagName,
          class: element.className,
          width: Math.round(element.getBoundingClientRect().width),
          right: Math.round(element.getBoundingClientRect().right),
          text: element.textContent?.slice(0, 50),
        })),
    }));
    expect(overflow.document, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.viewport + 1);
    await mobile.close();
    capturedRecovery = 'passed: loaded hash-checked provider-retrieved artifact without a backend';
  }
  await page.getByRole('button', { name: 'Load exceptional-delay example', exact: true }).click();
  await expect(page.getByText('Excluded as exceptional', { exact: true })).toBeVisible();
  const aster = page.locator('.lesson').filter({
    has: page.getByRole('heading', { name: 'Aster Studio', exact: true }),
  });
  await expect(aster.getByText('3 completed payments', { exact: false })).toBeVisible();
  await expect(aster.getByText('Around the due date', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(page.getByText('Excluded as exceptional', { exact: true })).toBeVisible();
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'docs/screenshots/exceptional-delay-static.png', fullPage: true });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('$1,250.00', { exact: false }).first()).toBeVisible();
  expect(externalRequests).toEqual([]);
  if (errors.length) throw new Error(errors.join('\n'));
  await writeFile(
    'evidence/local-verification.json',
    JSON.stringify(
      {
        verifiedAt: new Date().toISOString(),
        mode: 'fictional-static-replay',
        basePath: '/judge/',
        backend: false,
        sponsorCalls: 0,
        checks: {
          staticAssets: 'passed',
          capturedEvidence: 'passed',
          capturedMainnetRecovery: capturedRecovery,
          exceptionalDelayExampleAndReload: 'passed',
          correctionChangesFutureForecast: 'passed',
          reloadPreservesCorrection: 'passed',
          consoleErrors: errors,
        },
        authoredExample: {
          paperExpectedAmount: '200.00',
          dueDate: '2026-11-16',
          learnedDateBefore: '2026-11-17',
          learnedDateAfter: '2026-11-16',
          learnedCashOnDueDateBefore: '-55.00',
          learnedCashOnDueDateAfter: '145.00',
          actualHeldCashBeforeAndAfter: '1250.00',
        },
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    'Static bundle passed at /judge/ with no backend, credentials, console errors or broken local assets.',
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
