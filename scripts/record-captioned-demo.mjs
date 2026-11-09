import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const checkOnly = process.argv.includes('--check-flow');
const origin = 'http://127.0.0.1:4173';
const dimensions = { width: 1440, height: 1080, appHeight: 900, captionHeight: 180 };
const evidence = JSON.parse(await readFile('evidence/manifest.json', 'utf8'));
if (
  evidence.tatum?.status !== 'confirmed' ||
  evidence.memory?.confirmedCount < 10 ||
  evidence.memory?.recoveryStatus !== 'confirmed'
)
  throw new Error(
    'The captioned demo requires genuine captured Tatum and completed Mainnet recovery proof.',
  );
await mkdir('docs/demo/raw', { recursive: true });
await mkdir('.data', { recursive: true });
const shell = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Payday Memory — captioned application recording</title><style>
*{box-sizing:border-box}html,body{margin:0;width:1440px;height:1080px;overflow:hidden;background:#f6f7f3;font-family:'Segoe UI',system-ui,sans-serif;color:#253d34}
#app-frame{display:block;border:0;width:1440px;height:900px;background:#f6f7f3}
#captions{height:180px;width:1440px;background:#18382f;color:#fff;padding:20px 64px 24px;display:flex;flex-direction:column;justify-content:center;gap:10px;position:absolute;left:0;bottom:0;border-top:4px solid #93b8a3}
#chapter{font-size:16px;line-height:22px;font-weight:600;letter-spacing:1.5px;color:#bed7c9;text-transform:uppercase;margin:0}
#caption{font-size:26px;line-height:35px;font-weight:500;max-width:1290px;margin:0;text-wrap:pretty}
#proof{display:none;position:absolute;inset:0 0 180px;background:#f6f7f3;padding:58px 86px;overflow:hidden}
#proof.visible{display:block}#proof .label{font-size:18px;line-height:24px;letter-spacing:1px;color:#237664;text-transform:uppercase;font-weight:600}
#proof h1{font-size:36px;line-height:44px;margin:18px 0 12px}#proof .intro{font-size:22px;line-height:32px;margin:0 0 26px;color:#50665c}
#proof .card{background:white;padding:28px 34px;border:1px solid #dbe3db;border-radius:12px;box-shadow:0 5px 22px #263f3510}
#proof .state{font-size:25px;line-height:32px;color:#237664;font-weight:600;margin:0 0 18px}#proof dl{display:grid;grid-template-columns:265px 1fr;gap:15px 20px;font-size:21px;line-height:30px;margin:0}
#proof dt{color:#64756a}#proof dd{margin:0;font-weight:500}#proof .code{font-family:Consolas,monospace;font-size:18px;overflow-wrap:anywhere}
#proof .note{font-size:20px;line-height:30px;margin-top:24px;color:#64756a}#proof .waiting{color:#8c6e35}
</style></head><body><iframe id="app-frame" title="Working Payday Memory application" src="/"></iframe>
<section id="proof" aria-label="Operator verification of captured sponsor evidence"><p class="label">Operator verification · captured Mainnet evidence</p><h1>Recovery proof you can inspect.</h1><p class="intro">The provider result is dated. The integrity check below runs during this recording.</p><div class="card"><p id="proof-state" class="state waiting">Checking captured record and manifest hashes…</p><dl id="proof-fields"></dl></div><p class="note">This panel displays actual recorded job/blob references and verification output. It makes no fresh provider request and claims no new Mainnet write.</p></section>
<section id="captions" aria-label="Embedded demonstration captions"><p id="chapter">Fictional sample · actual application</p><p id="caption">Opening Payday Memory. This authored sample needs no signup, wallet or funds.</p></section></body></html>`;
const browser = await chromium.launch({
  channel: process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium'),
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: dimensions.width, height: dimensions.height },
  ...(checkOnly
    ? {}
    : {
        recordVideo: {
          dir: 'docs/demo/raw',
          size: { width: dimensions.width, height: dimensions.height },
        },
      }),
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const video = page.video();
const errors = [];
const externalRequests = [];
const viewportChecks = [];
const cues = [];
let started;
let completed = false;
let operation;
let failure;
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (!request.url().startsWith(origin + '/')) externalRequests.push(request.url());
});
await page.route(origin + '/__captioned_recording__', (route) =>
  route.fulfill({ contentType: 'text/html', body: shell }),
);
const app = page.frameLocator('#app-frame');
const until = async (seconds) => {
  if (checkOnly) return;
  const remaining = seconds * 1000 - (Date.now() - started);
  if (remaining > 0) await page.waitForTimeout(remaining);
};
async function caption(chapter, text) {
  await page.evaluate(
    ({ chapter, text }) => {
      document.getElementById('chapter').textContent = chapter;
      document.getElementById('caption').textContent = text;
    },
    { chapter, text },
  );
  cues.push({ elapsedSeconds: (Date.now() - started) / 1000, chapter, text });
  const size = await app
    .locator('body')
    .evaluate(() => ({ width: innerWidth, height: innerHeight }));
  if (size.width !== dimensions.width || size.height !== dimensions.appHeight)
    throw new Error(
      'The application viewport changed while recording. No valid final video is claimed.',
    );
  viewportChecks.push({ ...size, chapter });
  const captionFits = await page.evaluate(() => {
    const band = document.getElementById('captions').getBoundingClientRect();
    const text = document.getElementById('caption').getBoundingClientRect();
    return text.bottom <= band.bottom - 12 && text.left >= 0 && text.right <= innerWidth;
  });
  if (!captionFits)
    throw new Error('An embedded caption does not fit inside the fixed caption band.');
  if (checkOnly)
    await page.screenshot({
      path: `.data/captioned-preflight-${String(cues.length).padStart(2, '0')}.png`,
    });
}
async function showProof(checkResult) {
  await page.evaluate(
    ({ evidence, checkResult }) => {
      const memory = evidence.memory;
      document.getElementById('proof').classList.add('visible');
      const state = document.getElementById('proof-state');
      state.textContent = checkResult
        ? 'Passed · all captured payload and manifest hashes match'
        : 'Checking captured payload and manifest hashes…';
      state.classList.toggle('waiting', !checkResult);
      const fields = [
        [
          'Recorded provider result',
          `${memory.confirmedCount} source memories + separate manifest`,
        ],
        ['Mainnet recovery captured', memory.recoveryVerifiedAt],
        ['Manifest job', memory.manifestReceipt.jobId],
        ['Manifest blob', memory.manifestReceipt.blobId],
        ['Recovered dataset SHA-256', memory.recoveredDatasetHash],
        ['Current local check', checkResult ? new Date().toISOString() : 'Running…'],
        ['Provider requests in this check', '0 · captured-artifact verification only'],
      ];
      const list = document.getElementById('proof-fields');
      list.replaceChildren();
      for (const [label, value] of fields) {
        const dt = document.createElement('dt');
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.textContent = String(value);
        if (/job|blob|SHA-256/.test(label)) dd.className = 'code';
        list.append(dt, dd);
      }
    },
    { evidence, checkResult },
  );
}
async function verifyCaptured() {
  const startAt = new Date().toISOString();
  const output = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/verify-captured.ts'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
      windowsHide: true,
    });
    let result = '';
    child.stdout.on('data', (bytes) => {
      result += bytes.toString();
    });
    child.stderr.resume();
    const deadline = setTimeout(() => {
      child.kill();
      reject(new Error('The offline integrity check timed out.'));
    }, 20000);
    child.on('error', (error) => {
      clearTimeout(deadline);
      reject(error);
    });
    child.on('exit', (code) => {
      clearTimeout(deadline);
      if (code !== 0) reject(new Error('The offline captured-evidence check failed.'));
      else resolve(result);
    });
  });
  const result = JSON.parse(output);
  if (
    result.status !== 'captured-artifacts-verified-offline' ||
    result.sponsorRequestsMade !== 0 ||
    result.recoveredDatasetHash !== evidence.memory.recoveredDatasetHash
  )
    throw new Error('The local check does not match the captured sponsor proof.');
  return { startedAt: startAt, completedAt: new Date().toISOString(), ...result };
}

try {
  await page.goto(origin + '/__captioned_recording__');
  await app.getByRole('heading', { name: 'Your next payday, in perspective.' }).waitFor();
  await expect(app.locator('.current-cash strong')).toContainText('$1,250.00');
  started = Date.now();
  await caption(
    'Fictional sample · actual application',
    'Payday Memory remembers how you actually get paid. This is authored fictional history; no signup, wallet or funds are needed.',
  );
  await until(12);
  await app.getByRole('button', { name: 'Preview purchase', exact: true }).click();
  await expect(app.getByText('$595.00 below buffer', { exact: true })).toBeVisible();
  await app.locator('.purchase-results').scrollIntoViewIfNeeded();
  await caption(
    'The spending decision · same 30-day horizon',
    'A $240 purchase keeps the promised-date buffer covered. With learned delays, the lowest cash is $295 below zero: $595 below the chosen buffer.',
  );
  await until(24);
  await app.locator('.forecast').scrollIntoViewIfNeeded();
  await caption(
    'Why timing matters',
    'Rent is due before Cedar’s learned arrival date. Promised dates, learned dates and no further income use the same 30-day horizon.',
  );
  await until(37);
  await app.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await app.locator('body').evaluate(() => scrollTo(0, 0));
  await caption(
    'Inspect the evidence',
    'Cedar’s cautious plan uses the median delay of six completed payments: eight days. These observations are explicitly fictional.',
  );
  await until(50);
  await app.getByRole('button', { name: 'Review reimbursement', exact: true }).click();
  await expect(
    app.getByRole('dialog', { name: 'Give this receipt the right meaning' }),
  ).toBeVisible();
  await caption(
    'Correct an assumption',
    'Paper Lane’s receipt repaid shared costs. Reclassify it as a reimbursement; keep the receipt and its earlier interpretation in the audit history.',
  );
  await until(62);
  await app.getByRole('button', { name: 'Save correction', exact: true }).click();
  await expect(app.getByText('Not enough history', { exact: true })).toBeVisible();
  await app.locator('.lessons-grid').scrollIntoViewIfNeeded();
  await caption(
    'The lesson changes; held cash does not',
    'Paper Lane now has only two eligible payments, so its entered planning date is retained. Physical cash stays $1,250.',
  );
  await until(74);
  await app.getByRole('button', { name: 'Load exceptional-delay example', exact: true }).click();
  await expect(app.getByText('Excluded as exceptional', { exact: true })).toBeVisible();
  await app.locator('.lessons-grid').scrollIntoViewIfNeeded();
  await caption(
    'Separate authored exception example',
    'An isolated 21-day Aster delay can be excluded with a reason. Its usual timing changes from one day late to the due date; the cash stays put.',
  );
  await until(86);
  await caption(
    'Captured Mainnet recovery · local verification now',
    'The Mainnet recovery shown next was captured on 8 November. We now run an offline check of every stored-record reference, manifest hash and recovered dataset hash.',
  );
  await showProof(null);
  operation = await verifyCaptured();
  await showProof(operation);
  if (checkOnly) await page.screenshot({ path: '.data/captioned-proof-preflight.png' });
  await until(102);
  await caption(
    'Actual recorded job and blob identifiers',
    'Twenty meaningful fictional records and their separate manifest were genuinely retrieved. These are the recorded completion IDs and timestamp; this check makes no fresh provider request.',
  );
  await until(113);
  await page.evaluate(() => document.getElementById('proof').classList.remove('visible'));
  await app.locator('body').evaluate(() => {
    localStorage.removeItem('payday-memory:disposable-demo:v1');
    location.reload();
  });
  await app.getByRole('heading', { name: 'Your next payday, in perspective.' }).waitFor();
  await app.getByRole('button', { name: 'Memory & evidence', exact: true }).click();
  await app.getByRole('button', { name: 'Load recovered sample', exact: true }).click();
  await expect(app.getByText('Reclassified as reimbursement', { exact: true })).toBeVisible();
  await app.locator('.lessons-grid').scrollIntoViewIfNeeded();
  await page.evaluate(() => document.getElementById('proof').classList.remove('visible'));
  await caption(
    'Clean disposable browser copy · captured recovery',
    'A clean browser copy loads the hash-checked recovery. The corrected reimbursement and revised lesson return; loading this capture sends no sponsor request.',
  );
  await until(127);
  await app.locator('.connected-preview').scrollIntoViewIfNeeded();
  await expect(
    app.getByText('Captured chain cash, hypothetical plan', { exact: true }),
  ).toBeVisible();
  await caption(
    'Tatum evidence · genuinely captured, not live',
    'Tatum captured zero native USDC for the supplied public address. That real snapshot changes this hypothetical forecast. No owner identity or complete wallet history is claimed.',
  );
  await until(141);
  await app.getByRole('button', { name: 'Cash-flow timeline', exact: true }).click();
  await app.locator('.evaluation').scrollIntoViewIfNeeded();
  await caption(
    'Measured only on this authored fixture',
    'Four resolved cases: promised-date error is 6 days; learned-date error is 2.5 days. One punctual payment is a counterexample where the learned date is worse.',
  );
  await until(154);
  await app.getByRole('button', { name: 'Overview', exact: true }).click();
  await app.locator('body').evaluate(() => scrollTo(0, 0));
  await caption(
    'A planner with a visible memory',
    'Exact amounts, traceable lessons and corrections that survive recovery. All recorded expiries cover judging. Public publication remains a separate step.',
  );
  await until(166);
  if (errors.length || externalRequests.length)
    throw new Error('Unexpected browser errors or external browser requests occurred.');
  completed = true;
} catch (error) {
  failure = error;
} finally {
  const completedAt = new Date().toISOString();
  await context.close();
  let output = null;
  if (video) {
    output = completed
      ? 'docs/demo/payday-memory-submission-uncut.webm'
      : `docs/demo/raw/failed-captioned-${Date.now()}.webm`;
    await video.saveAs(path.resolve(output));
  }
  await browser.close();
  const report = {
    schemaVersion: 1,
    recordedAt: started ? new Date(started).toISOString() : null,
    completedAt,
    completed,
    checkOnly,
    sourceFile: output,
    mode: 'captured',
    dimensions,
    captionMethod: 'Permanent caption band recorded below the fixed application iframe',
    captionsEmbedded: true,
    freshMainnetRecoveryDuringRecording: false,
    mainnetWritesDuringRecording: 0,
    sponsorRequestsDuringRecording: 0,
    capturedMainnetRecoveryAt: evidence.memory.recoveryVerifiedAt,
    capturedTatumAt: evidence.tatum.balanceSnapshot.observedAt,
    capturedSourceRecordCount: evidence.memory.confirmedCount,
    integrityCheck: operation ?? null,
    viewportChecks,
    captions: cues,
    consoleErrors: errors,
    externalBrowserRequests: externalRequests,
    ...(failure ? { failure: failure.message } : {}),
  };
  await writeFile(
    checkOnly ? '.data/captioned-demo-preflight.json' : 'docs/demo/captioned-recording.json',
    JSON.stringify(report, null, 2) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        completed,
        checkOnly,
        output,
        mode: report.mode,
        captionsEmbedded: true,
        fixedViewportChecks: viewportChecks.length,
        sponsorRequests: 0,
        ...(failure ? { failure: failure.message } : {}),
      },
      null,
      2,
    ),
  );
}
if (failure) throw failure;
