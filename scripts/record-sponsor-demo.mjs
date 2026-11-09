import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

if (!process.argv.includes('--live')) {
  console.log(
    'SKIPPED: --live is required. This recording performs one operator Mainnet recovery and no writes.',
  );
  process.exit(0);
}
const readProof = async () => JSON.parse(await readFile('evidence/manifest.json', 'utf8'));
const initial = await readProof();
if (
  initial.tatum?.status !== 'confirmed' ||
  initial.memory?.confirmedCount < 10 ||
  initial.memory?.recoveryStatus !== 'confirmed'
)
  throw new Error(
    'A genuine Tatum snapshot, ten confirmed records and clean Mainnet recovery are required before recording.',
  );
await mkdir('docs/demo/raw', { recursive: true });
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium'),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  recordVideo: { dir: 'docs/demo/raw', size: { width: 1440, height: 1000 } },
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const video = page.video();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let completed = false;
let recoveryProof;
let sampleStartedAt;
let error;
const recordingStartedAt = new Date().toISOString();
try {
  await page.goto('http://127.0.0.1:4173');
  await page.getByRole('heading', { name: 'Your next payday, in perspective.' }).waitFor();
  sampleStartedAt = Date.now();
  const until = async (seconds) => {
    const remaining = seconds * 1000 - (Date.now() - sampleStartedAt);
    if (remaining > 0) await page.waitForTimeout(remaining);
  };
  await until(12);
  await page.getByRole('button', { name: 'Preview purchase', exact: true }).click();
  await page.locator('.forecast').scrollIntoViewIfNeeded();
  await until(40);
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await until(60);
  await page.getByRole('button', { name: 'Review reimbursement', exact: true }).click();
  await until(72);
  await page.getByRole('button', { name: 'Save correction', exact: true }).click();
  await page.locator('.lessons-grid').scrollIntoViewIfNeeded();
  await until(88);
  console.log(
    'Running one genuine read-only Mainnet recovery while recording. No new memories are published.',
  );
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['scripts/run-sponsor.mjs', 'memory-verify', '--live'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
    // The command reports only redacted status; keep output off the product screen.
    child.stdout.resume();
    child.stderr.resume();
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(
            new Error('Operator recovery failed. No successful recovery recording is claimed.'),
          ),
    );
  });
  recoveryProof = await readProof();
  if (
    recoveryProof.memory.recoveryStatus !== 'confirmed' ||
    Date.parse(recoveryProof.memory.recoveryVerifiedAt) < sampleStartedAt
  )
    throw new Error('No fresh successful Mainnet recovery was captured.');
  await page.evaluate(() => localStorage.removeItem('payday-memory:disposable-demo:v1'));
  await page.reload();
  await page.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Load recovered sample', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Load recovered sample', exact: true }).click();
  await expect(
    page.getByText('Captured Mainnet recovery loaded into this disposable sample.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.getByText('Reclassified as reimbursement', { exact: true })).toBeVisible();
  await page.locator('.lessons-grid').scrollIntoViewIfNeeded();
  await until(115);
  await page.locator('.sponsor-proof').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/screenshots/memory-mainnet-desktop.png', fullPage: false });
  await until(130);
  await page.locator('.connected-preview').scrollIntoViewIfNeeded();
  await until(140);
  await page.getByRole('button', { name: 'Cash-flow timeline', exact: true }).click();
  await page.locator('.evaluation').scrollIntoViewIfNeeded();
  await until(153);
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await until(160);
  if (errors.length) throw new Error('Browser errors occurred during recording.');
  completed = true;
} catch (failure) {
  error = failure;
} finally {
  await context.close();
  const file = completed
    ? 'docs/demo/payday-memory-sponsor-uncut.webm'
    : `docs/demo/raw/failed-sponsor-${Date.now()}.webm`;
  await video.saveAs(path.resolve(file));
  await browser.close();
  const report = {
    recordedAt: recordingStartedAt,
    completedAt: new Date().toISOString(),
    file,
    completed,
    fictionalPlanningData: true,
    mainnetWritesDuringRecording: 0,
    operatorMainnetRecoveryDuringRecording: completed,
    recoveryVerifiedAt: recoveryProof?.memory.recoveryVerifiedAt ?? null,
    recoveredDatasetHash: recoveryProof?.memory.recoveredDatasetHash ?? null,
    confirmedRecordCount: recoveryProof?.memory.confirmedCount ?? null,
    tatumEvidence: 'Genuine previously captured read-only balance; not refreshed by the browser',
    retentionThroughJudging: recoveryProof?.memory.retentionAssessment?.status ?? 'unverified',
    consoleErrors: errors,
  };
  await writeFile(
    completed ? 'docs/demo/sponsor-recording.json' : 'docs/demo/raw/failed-sponsor-recording.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(JSON.stringify(report, null, 2));
}
if (error) throw error;
