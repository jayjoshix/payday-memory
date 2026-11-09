import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { request } from 'node:http';
import { createAppServer } from '../src/server/app.js';
import { AtomicJsonStore } from '../src/server/store.js';

async function setup() {
  const directory = await mkdtemp(path.join(tmpdir(), 'payday-test-'));
  const token = 'operator-test-secret-at-least-24';
  const server = createAppServer({
    dataDirectory: directory,
    operatorToken: token,
    env: {
      TATUM_API_KEY: 'never-expose-tatum',
      MEMWAL_KEY: 'never-expose-memory',
      MEMWAL_ACCOUNT_ID: 'public-account',
      MEMWAL_AGENT_ID: 'public-agent',
    },
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { directory, token, url, server };
}

test('anonymous sessions are isolated and reset cannot mutate canonical or sponsor state', async () => {
  const { directory, token, url, server } = await setup();
  try {
    const first = await (await fetch(`${url}/api/demo/session`, { method: 'POST' })).json();
    const second = await (await fetch(`${url}/api/demo/session`, { method: 'POST' })).json();
    assert.notEqual(first.id, second.id);
    first.dataset.id = 'edited-disposable-copy';
    const saved = await fetch(`${url}/api/demo/session/${first.id}`, {
      method: 'PUT',
      body: JSON.stringify(first.dataset),
    });
    assert.equal(saved.status, 200);
    const untouched = await (await fetch(`${url}/api/demo/session/${second.id}`)).json();
    assert.notEqual(untouched.dataset.id, first.dataset.id);
    await writeFile(path.join(directory, 'canonical.json'), '{"protected":true}');
    await writeFile(path.join(directory, 'memory-jobs.json'), '{"published":"keep"}');
    const rejected = await fetch(`${url}/api/operator/reset-demo`, { method: 'POST' });
    assert.equal(rejected.status, 401);
    const reset = await fetch(`${url}/api/operator/reset-demo`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    assert.equal(reset.status, 200);
    assert.equal((await fetch(`${url}/api/demo/session/${second.id}`)).status, 404);
    assert.equal(
      await readFile(path.join(directory, 'canonical.json'), 'utf8'),
      '{"protected":true}',
    );
    assert.equal(
      await readFile(path.join(directory, 'memory-jobs.json'), 'utf8'),
      '{"published":"keep"}',
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('status is redacted; cross-origin mutations and DNS rebinding hosts are rejected', async () => {
  const { url, server } = await setup();
  try {
    const status = await (await fetch(`${url}/api/status`)).text();
    assert.ok(!status.includes('never-expose'));
    assert.ok(status.includes('local-replay'));
    assert.equal(
      (
        await fetch(`${url}/api/demo/session`, {
          method: 'POST',
          headers: { Origin: 'https://evil.invalid' },
        })
      ).status,
      403,
    );
    const rebindingStatus = await new Promise<number>((resolve) => {
      const outgoing = request(
        `${url}/api/status`,
        { headers: { Host: 'evil.invalid' } },
        (incoming) => {
          incoming.resume();
          resolve(incoming.statusCode ?? 0);
        },
      );
      outgoing.end();
    });
    assert.equal(rebindingStatus, 403);
    assert.equal(
      (
        await fetch(`${url}/api/operator/seed`, {
          method: 'POST',
          headers: { Authorization: 'Bearer wrong' },
        })
      ).status,
      401,
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('durable store survives reconstruction and corrupt history never silently resets', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'payday-store-'));
  const first = new AtomicJsonStore(directory);
  await Promise.all([first.write('one', { n: 1 }), first.write('one', { n: 2 })]);
  const restored = new AtomicJsonStore(directory);
  assert.deepEqual(await restored.read('one'), { n: 2 });
  await writeFile(path.join(directory, 'one.json'), '{broken');
  await assert.rejects(restored.read('one'), /preserved for recovery/);
  assert.equal(await readFile(path.join(directory, 'one.json'), 'utf8'), '{broken');
  await assert.rejects(restored.write('../escape', {}), /Invalid storage key/);
});
