import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const scripts = new Set([
  'sponsors-check',
  'memory-publish',
  'memory-verify',
  'memory-account-check',
  'memory-probe',
  'tatum-read',
]);
const command = process.argv[2];
if (!scripts.has(command)) throw new Error('Select a supported sponsor command.');
const portable = path.join(root, '.tooling', 'node-v24.22.1-win-x64', 'node.exe');
const runtime = process.platform === 'win32' && existsSync(portable) ? portable : process.execPath;
const child = spawn(
  runtime,
  ['--import', 'tsx', path.join(root, 'scripts', `${command}.ts`), ...process.argv.slice(3)],
  {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
    shell: false,
  },
);
child.on('error', () => {
  console.error(
    'Sponsor command could not start its local runtime. No provider result is claimed.',
  );
  process.exitCode = 1;
});
child.on('exit', (code) => {
  process.exitCode = code ?? 1;
});
