import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { MemWal } from '@mysten-incubation/memwal';
import {
  createSampleDataset,
  createMemoryRecords,
  evaluateDataset,
  USDC_SUI,
} from '../src/domain/index.js';
import {
  createCuratedPublicationDataset,
  createCuratedPublicationRecords,
  prepareFictionalExport,
  memoryAccountScope,
  memoryEvidenceForScope,
} from '../src/sponsors/curated.js';
import {
  MemoryOutbox,
  MemoryManifestOutbox,
  createPublicationManifest,
  recoverFromMemory,
  sha256,
  enumerate,
  assessMemoryRetention,
  type MemoryClient,
  type PublicationManifest,
  type WriteJob,
} from '../src/sponsors/memory.js';
import { managedMemoryFetch } from '../src/sponsors/memory-transport.js';
import { buildProbeMemoryEvidence } from '../src/sponsors/probe-evidence.js';
import { TatumAdapter, receiptsFromTransaction, type TatumReads } from '../src/sponsors/tatum.js';
import {
  requireTatum,
  requireMemory,
  requireMemoryProbe,
  safeFailure,
  supportedMemoryRuntime,
  assertProviderCircuit,
  recordQuotaStop,
} from '../src/sponsors/safety.js';
import { getEvidence } from '../scripts/sponsors-common.js';
const address = '0x' + 'a'.repeat(64);
const reads = (): TatumReads => ({
  balance: async () => ({ coinType: USDC_SUI, balance: 1000000n }),
  transaction: async (digest) => ({
    digest,
    timestamp: { seconds: 1793858400n, nanos: 0 },
    effects: { status: { success: true } },
    balanceChanges: [{ address, coinType: USDC_SUI, amount: '1000000' }],
  }),
});
test('Tatum snapshots retain exact units, cache repeated reads and cap independent reads', async () => {
  const adapter = new TatumAdapter(reads(), 1);
  assert.equal((await adapter.snapshot(address)).amount, '1000000');
  await adapter.snapshot(address);
  assert.equal(adapter.requestsUsed, 1);
  await assert.rejects(adapter.snapshot('0x' + 'b'.repeat(64)), /cap/);
});
test('Tatum quota stops subsequent requests and timeout never manufactures a snapshot', async () => {
  let calls = 0;
  const adapter = new TatumAdapter({
    ...reads(),
    balance: async () => {
      calls++;
      throw { code: 8 };
    },
  });
  await assert.rejects(adapter.snapshot(address), /quota/);
  await assert.rejects(adapter.snapshot(address), /cap/);
  assert.equal(calls, 1);
  const timeout = new TatumAdapter({
    ...reads(),
    balance: async () => {
      throw { code: 4 };
    },
  });
  await assert.rejects(timeout.snapshot(address), /timed out/);
  assert.equal(safeFailure({ status: 429 }).code, 'quota');
});
test('chain receipt validation rejects failed status and excludes wrong token, recipient and negative deltas', async () => {
  const tx = await reads().transaction('digest');
  assert.throws(
    () =>
      receiptsFromTransaction(
        { ...tx, effects: { status: { success: false } } },
        address,
        new Date().toISOString(),
      ),
    /successful/,
  );
  const result = receiptsFromTransaction(
    {
      ...tx,
      balanceChanges: [
        { address, coinType: USDC_SUI, amount: '12' },
        { address, coinType: USDC_SUI, amount: '13' },
        { address, coinType: 'wrong', amount: '200' },
        { address: '0x' + 'b'.repeat(64), coinType: USDC_SUI, amount: '200' },
        { address, coinType: USDC_SUI, amount: '-8' },
      ],
    },
    address,
    new Date().toISOString(),
  );
  assert.equal(result.length, 2);
  assert.notEqual(result[0]!.transferId, result[1]!.transferId);
  assert.equal(result[0]!.provenance, 'chain-observed');
});
test('cost gates fail closed for missing credentials, auto upgrades and unsupported live runtimes', () => {
  assert.throws(() => requireTatum({ checkedAt: new Date().toISOString() }, {}), /requires/);
  assert.equal(supportedMemoryRuntime('24.14.0'), false);
  assert.equal(supportedMemoryRuntime('24.22.1'), true);
  assert.equal(supportedMemoryRuntime('22.23.4'), true);
  assert.throws(
    () => requireMemory({ checkedAt: new Date().toISOString() }, {}, '24.14.0'),
    /patched Node/,
  );
});

test('one-record sponsored probe can observe retention without inventing an unpublished free allowance', () => {
  const env = {
    MEMWAL_KEY: 'offline-placeholder',
    MEMWAL_ACCOUNT_ID: address,
    MEMWAL_AGENT_ID: 'offline-public-placeholder',
  };
  const memory = {
    hostedSetupFree: true,
    managedMainnetSponsorship: true,
    freeLimitRecords: 0,
    providerEnforcedFreeLimits: true,
    retentionThrough: 'UNVERIFIED',
  };
  const checks = { checkedAt: new Date().toISOString(), memory };
  assert.doesNotThrow(() => requireMemoryProbe(checks, env, '24.22.1'));
  assert.doesNotThrow(() => requireMemory(checks, env, '24.22.1'));
  assert.doesNotThrow(() =>
    requireMemory(
      { ...checks, memory: { ...memory, retentionThrough: '2026-12-01T00:00:00Z' } },
      env,
      '24.22.1',
    ),
  );
  assert.throws(
    () =>
      requireMemory(
        {
          ...checks,
          memory: {
            ...memory,
            providerEnforcedFreeLimits: false,
            retentionThrough: '2026-12-01T00:00:00Z',
          },
        },
        env,
        '24.22.1',
      ),
    /free-limit policy/,
  );
  assert.throws(
    () =>
      requireMemoryProbe(
        { ...checks, memory: { ...memory, managedMainnetSponsorship: false } },
        env,
        '24.22.1',
      ),
    /sponsorship/,
  );
});
test('account gates separate unknown retention from billing and reject string verification flags', () => {
  const env = {
    TATUM_API_KEY: 'test-placeholder',
    MEMWAL_KEY: 'test-placeholder',
    MEMWAL_ACCOUNT_ID: address,
    MEMWAL_AGENT_ID: 'public-delegate-placeholder',
  };
  const checks = {
    checkedAt: new Date().toISOString(),
    tatum: {
      freePlanConfirmed: true,
      autoUpgradeDisabled: true,
      noPaidBilling: true,
      remainingCredits: 100,
      creditCostUpperBoundPerRead: 1,
      methodsConfirmed: [
        'sui.rpc.v2.StateService/GetBalance',
        'sui.rpc.v2.LedgerService/GetTransaction',
      ],
    },
    memory: {
      hostedSetupFree: true,
      managedMainnetSponsorship: true,
      retentionThrough: '2026-12-01T00:00:00Z',
      freeLimitRecords: 25,
    },
  };
  assert.doesNotThrow(() => requireMemory(checks, env, '24.22.1'));
  for (const retentionThrough of ['UNVERIFIED', '', 'not-a-date', '2026-11-16T00:00:00Z'])
    assert.doesNotThrow(() =>
      requireMemory({ ...checks, memory: { ...checks.memory, retentionThrough } }, env, '24.22.1'),
    );
  assert.throws(
    () =>
      requireMemory(
        {
          ...checks,
          memory: { ...checks.memory, managedMainnetSponsorship: 'false' as unknown as boolean },
        },
        env,
        '24.22.1',
      ),
    /sponsorship/,
  );
  assert.throws(
    () =>
      requireTatum(
        {
          ...checks,
          tatum: { ...checks.tatum, autoUpgradeDisabled: 'false' as unknown as boolean },
        },
        env,
      ),
    /disabled upgrades/,
  );
  assert.throws(
    () =>
      requireTatum(
        {
          ...checks,
          tatum: {
            ...checks.tatum,
            methodsConfirmed: checks.tatum.methodsConfirmed.join(',') as unknown as string[],
          },
        },
        env,
      ),
    /read methods/,
  );
});
test('Memory smoke jobs and captured confirmations stay scoped to one account and namespace', () => {
  const first = memoryAccountScope(address, 'fictional-one');
  const otherAccount = memoryAccountScope('0x' + 'b'.repeat(64), 'fictional-one');
  const otherNamespace = memoryAccountScope(address, 'fictional-two');
  assert.equal(
    first,
    memoryAccountScope(address.toUpperCase().replace('0X', '0x'), 'fictional-one'),
  );
  assert.notEqual(first, otherAccount);
  assert.notEqual(first, otherNamespace);
  const proof = {
    accountScope: first,
    confirmedCount: 20,
    records: [{ blobId: 'actual-returned-id' }],
  };
  assert.deepEqual(memoryEvidenceForScope(proof, first), proof);
  assert.deepEqual(memoryEvidenceForScope(proof, otherAccount), {});
  assert.deepEqual(memoryEvidenceForScope(proof, otherNamespace), {});
  assert.deepEqual(memoryEvidenceForScope({ confirmedCount: 20 }, first), {});
});
async function temporary(t: test.TestContext) {
  const dir = await mkdtemp(join(tmpdir(), 'payday-sponsors-'));
  assert.equal(dirname(dir), tmpdir());
  t.after(async () => {
    assert.equal(dirname(dir), tmpdir());
    await rm(dir, { recursive: true, force: true });
  });
  return dir;
}
test('unreadable sponsor evidence is preserved instead of silently reset to zero confirmations', async (t) => {
  const directory = await temporary(t);
  const file = join(directory, 'evidence.json');
  assert.equal((await getEvidence(file)).status, 'pending_credentials');
  const damaged = '{"memory":{"confirmedCount":20},';
  await writeFile(file, damaged, 'utf8');
  await assert.rejects(getEvidence(file), /unreadable/);
  assert.equal(await readFile(file, 'utf8'), damaged);
});
test('provider quota circuit survives process state and requires a newer documented account check', async (t) => {
  const dir = await temporary(t);
  const path = join(dir, 'stops.json');
  const checkedAt = new Date(Date.now() - 1000).toISOString();
  await recordQuotaStop('memory', { status: 429 }, path);
  await assert.rejects(
    assertProviderCircuit('memory', { checkedAt }, path),
    /stopped after a quota failure/,
  );
  await assertProviderCircuit('tatum', { checkedAt }, path);
  await assertProviderCircuit(
    'memory',
    { checkedAt: new Date(Date.now() + 1000).toISOString() },
    path,
  );
});
function fakeMemory(): MemoryClient & {
  submits: number;
  stored: Map<
    string,
    {
      text: string;
      blob: string;
    }
  >;
  state: string;
} {
  const fake = {
    submits: 0,
    stored: new Map<
      string,
      {
        text: string;
        blob: string;
      }
    >(),
    state: 'done',
    async remember(
      text: string,
      options: {
        idempotencyKey: string;
        dedupe: boolean;
      },
    ) {
      fake.submits++;
      const id = options.idempotencyKey;
      fake.stored.set(id, { text, blob: `blob-${sha256(JSON.parse(text))}` });
      return { job_id: id, status: 'running' };
    },
    async getRememberStatus(jobId: string) {
      return { status: fake.state, blob_id: fake.stored.get(jobId)?.blob };
    },
    async listMemories() {
      return {
        memories: [...fake.stored.values()].map((m) => ({
          blob_id: m.blob,
          status: 'done',
          expires_at: '2026-12-01T00:00:00Z',
          end_epoch: 99,
        })),
        has_more: false,
        next_cursor: null,
        must_resync: false,
      };
    },
    async recall() {
      return { results: [...fake.stored.values()].map((m) => ({ blob_id: m.blob, text: m.text })) };
    },
  };
  return fake;
}
test('durable outbox confirms only provider-completed records and never resubmits on restart', async (t) => {
  const dir = await temporary(t);
  const path = join(dir, 'outbox.json');
  const client = fakeMemory();
  const record = createMemoryRecords(createSampleDataset())[1]!;
  await new MemoryOutbox(path).enqueue([record]);
  const jobs = await new MemoryOutbox(path).process(client);
  assert.equal(jobs[0]!.state, 'confirmed');
  assert.ok(jobs[0]!.blobId);
  await new MemoryOutbox(path).process(client);
  assert.equal(client.submits, 1);
  await assert.rejects(
    new MemoryOutbox(path).enqueue([{ ...record, payload: { changed: true } }]),
    /immutable/,
  );
});
test('queued is not saved: pending jobs survive restart with the same provider ID', async (t) => {
  const dir = await temporary(t);
  const path = join(dir, 'outbox.json');
  const client = fakeMemory();
  client.state = 'running';
  const outbox = new MemoryOutbox(path);
  await outbox.enqueue([createMemoryRecords(createSampleDataset())[1]!]);
  assert.equal((await outbox.process(client, 1, 0))[0]!.state, 'pending');
  client.state = 'done';
  assert.equal((await new MemoryOutbox(path).process(client))[0]!.state, 'confirmed');
  assert.equal(client.submits, 1);
});

test('background job quota failure stops publication before another record is submitted', async (t) => {
  const dir = await temporary(t);
  const client = fakeMemory();
  client.getRememberStatus = async () => ({
    status: 'failed',
    error: 'Storage quota exceeded',
  });
  const outbox = new MemoryOutbox(join(dir, 'quota-outbox.json'));
  await outbox.enqueue(createMemoryRecords(createSampleDataset()).slice(0, 3));
  const jobs = await outbox.process(client, 3, 0);
  assert.equal(client.submits, 1);
  assert.equal(jobs[0]!.state, 'failed');
  assert.equal(jobs[0]!.error!.code, 'quota');
  assert.deepEqual(
    jobs.slice(1).map((job) => job.state),
    ['queued', 'queued'],
  );
});

test('installed SDK preflight quota stops the source outbox and remains a durable provider stop', async (t) => {
  const dir = await temporary(t);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = managedMemoryFetch(
    async (input) => {
      requests++;
      assert.equal(String(input), 'https://relayer.memory.walrus.xyz/version');
      return new Response('{}', { status: 429 });
    },
    async () => {
      throw new Error('No package read is allowed after the quota refusal.');
    },
  );
  const client = MemWal.create({
    key: '11'.repeat(32),
    accountId: address,
    namespace: 'offline-quota-test',
    serverUrl: 'https://relayer.memory.walrus.xyz',
  });
  try {
    const outbox = new MemoryOutbox(join(dir, 'source-outbox.json'));
    await outbox.enqueue(createMemoryRecords(createSampleDataset()).slice(0, 2));
    const jobs = await outbox.process(client, 2, 0);
    assert.equal(requests, 1);
    assert.equal(jobs[0]!.error!.code, 'quota');
    assert.equal(jobs[1]!.attempts, 0);
    const stops = join(dir, 'provider-stops.json');
    await recordQuotaStop('memory', jobs[0]!.error, stops);
    await assert.rejects(
      assertProviderCircuit(
        'memory',
        { checkedAt: new Date(Date.now() - 1000).toISOString() },
        stops,
      ),
      /stopped after a quota failure/,
    );
  } finally {
    client.destroy();
    globalThis.fetch = originalFetch;
  }
});

const manifestFixture = (): PublicationManifest => ({
  schemaVersion: 1,
  recordType: 'manifest',
  datasetId: 'fictional-manifest-test',
  id: 'manifest:fictional-manifest-test',
  createdAt: '2026-11-05T12:00:00Z',
  entries: [{ id: 'source-record', sha256: 'a'.repeat(64), blobId: 'source-blob' }],
});
const manifestScope = { namespace: 'fictional-test', accountId: address };

test('manifest outbox preserves legacy confirmed and pending receipts across migration', async (t) => {
  const dir = await temporary(t);
  const manifest = manifestFixture();
  for (const confirmed of [false, true]) {
    const path = join(dir, `legacy-${confirmed}.json`);
    const verifiedAt = '2026-11-06T12:00:00Z';
    const legacy = {
      manifest,
      ...manifestScope,
      jobId: 'legacy-job',
      ...(confirmed ? { blobId: 'legacy-blob', verifiedAt } : {}),
    };
    await writeFile(path, JSON.stringify(legacy));
    const client = fakeMemory();
    let polls = 0;
    client.getRememberStatus = async (jobId) => {
      polls++;
      assert.equal(jobId, 'legacy-job');
      return { status: 'done', blob_id: 'legacy-blob' };
    };
    const incoming = { ...manifest, createdAt: new Date().toISOString() };
    const migrated = await new MemoryManifestOutbox(path).process(client, incoming, manifestScope);
    assert.equal(migrated.state, 'confirmed');
    assert.equal(migrated.blobId, 'legacy-blob');
    assert.deepEqual(migrated.manifest, manifest);
    assert.equal(client.submits, 0);
    assert.equal(polls, confirmed ? 0 : 1);
    if (confirmed) assert.equal(migrated.verifiedAt, verifiedAt);
    await new MemoryManifestOutbox(path).process(client, incoming, manifestScope);
    assert.equal(polls, confirmed ? 0 : 1);
    assert.equal(client.submits, 0);
  }
});

test('manifest outbox resumes acknowledged jobs and bounds ambiguous submissions with one stable key', async (t) => {
  const dir = await temporary(t);
  const manifest = manifestFixture();
  const pendingPath = join(dir, 'pending-manifest.json');
  const client = fakeMemory();
  client.state = 'running';
  const pending = await new MemoryManifestOutbox(pendingPath).process(
    client,
    manifest,
    manifestScope,
  );
  assert.equal(pending.state, 'pending');
  assert.equal(pending.attempts, 1);
  client.state = 'done';
  const confirmed = await new MemoryManifestOutbox(pendingPath).process(
    client,
    manifest,
    manifestScope,
  );
  assert.equal(confirmed.state, 'confirmed');
  assert.equal(client.submits, 1);
  const path = join(dir, 'ambiguous-manifest.json');
  const keys: string[] = [];
  client.remember = async (_text, options) => {
    keys.push(options.idempotencyKey);
    assert.equal(options.dedupe, true);
    const persisted = JSON.parse(await readFile(path, 'utf8'));
    assert.equal(persisted.attempts, keys.length);
    throw { status: 504 };
  };
  for (let attempt = 0; attempt < 5; attempt++)
    await new MemoryManifestOutbox(path).process(client, manifest, manifestScope);
  const failed = JSON.parse(await readFile(path, 'utf8'));
  assert.equal(keys.length, 3);
  assert.equal(new Set(keys).size, 1);
  assert.equal(failed.state, 'failed');
  assert.equal(failed.attempts, 3);
});

test('failed and missing manifest jobs are terminal and background quota persists the stop', async (t) => {
  const dir = await temporary(t);
  const manifest = manifestFixture();
  for (const status of ['failed', 'not_found']) {
    const path = join(dir, `${status}-manifest.json`);
    const client = fakeMemory();
    let polls = 0;
    client.getRememberStatus = async () => {
      polls++;
      return { status, error: status === 'failed' ? 'Storage quota exceeded' : 'Job not found' };
    };
    const failed = await new MemoryManifestOutbox(path).process(client, manifest, manifestScope);
    assert.equal(failed.state, 'failed');
    assert.equal(failed.error!.code, status === 'failed' ? 'quota' : 'unavailable');
    await new MemoryManifestOutbox(path).process(client, manifest, manifestScope);
    assert.equal(client.submits, 1);
    assert.equal(polls, 1);
    if (status === 'failed') {
      const stops = join(dir, 'manifest-stops.json');
      await recordQuotaStop('memory', failed.error, stops);
      await assert.rejects(
        assertProviderCircuit(
          'memory',
          { checkedAt: new Date(Date.now() - 1000).toISOString() },
          stops,
        ),
        /stopped after a quota failure/,
      );
    }
  }
});

test('manifest migration rejects changed source entries or mismatched account and namespace', async (t) => {
  const dir = await temporary(t);
  const path = join(dir, 'scoped-manifest.json');
  const client = fakeMemory();
  const manifest = manifestFixture();
  await writeFile(path, JSON.stringify({ manifest, ...manifestScope, jobId: 'legacy-job' }));
  for (const scope of [
    { ...manifestScope, namespace: 'other-namespace' },
    { ...manifestScope, accountId: '0x' + 'b'.repeat(64) },
  ])
    await assert.rejects(
      new MemoryManifestOutbox(path).process(client, manifest, scope),
      /different Memory scope/,
    );
  await assert.rejects(
    new MemoryManifestOutbox(path).process(
      client,
      { ...manifest, entries: [{ ...manifest.entries[0]!, blobId: 'different-source' }] },
      manifestScope,
    ),
    /Published dataset changed/,
  );
  assert.equal(client.submits, 0);
});

test('probe evidence builder discards other accounts and namespaces and preserves only matching proof', () => {
  const namespace = 'probe-current';
  const accountScope = memoryAccountScope(address, namespace);
  const record = createMemoryRecords(createSampleDataset())[1]!;
  const job: WriteJob = {
    id: record.id,
    record,
    payloadHash: sha256(record),
    idempotencyKey: 'offline-probe',
    state: 'confirmed',
    attempts: 1,
    createdAt: '2026-11-08T12:00:00Z',
    updatedAt: '2026-11-08T12:00:00Z',
    providerJobId: 'current-job',
    blobId: 'current-blob',
    verifiedAt: '2026-11-08T12:00:00Z',
  };
  const previous = {
    accountScope,
    namespace,
    records: [{ id: 'old-record', state: 'confirmed', blobId: 'old-blob' }],
    datasetId: 'old-dataset',
    manifestReceipt: { blobId: 'old-manifest' },
    recoveredDatasetHash: 'old-hash',
    retentionAssessment: { status: 'verified' },
    packageValidationTransport: { liveVerified: true },
  };
  const options = {
    accountScope,
    namespace,
    job,
    retrieved: true,
    retention: null,
    checkedAt: job.verifiedAt!,
  };
  const matching = buildProbeMemoryEvidence(previous, options);
  assert.equal(matching.confirmedCount, 2);
  assert.deepEqual(matching.manifestReceipt, previous.manifestReceipt);
  for (const priorScope of [
    memoryAccountScope('0x' + 'b'.repeat(64), namespace),
    memoryAccountScope(address, 'other-namespace'),
  ]) {
    const changed = buildProbeMemoryEvidence({ ...previous, accountScope: priorScope }, options);
    assert.equal(changed.accountScope, accountScope);
    assert.equal(changed.namespace, namespace);
    assert.equal(changed.confirmedCount, 1);
    assert.deepEqual(changed.records, [
      {
        id: job.id,
        state: job.state,
        jobId: job.providerJobId,
        blobId: job.blobId,
        verifiedAt: job.verifiedAt,
        payloadHash: job.payloadHash,
      },
    ]);
    for (const key of [
      'datasetId',
      'manifestReceipt',
      'recoveredDatasetHash',
      'retentionAssessment',
      'packageValidationTransport',
    ])
      assert.equal(changed[key], undefined, key);
  }
});
test('all confirmed Mainnet-shaped test records recover identical lessons into a new dataset', async (t) => {
  const dir = await temporary(t);
  const client = fakeMemory();
  const outbox = new MemoryOutbox(join(dir, 'outbox.json'));
  const source = createSampleDataset();
  await outbox.enqueue(createMemoryRecords(source));
  const jobs = await outbox.process(client, 25, 0);
  const manifest = createPublicationManifest(jobs, source.id);
  const recovered = await recoverFromMemory(client, 'fictional-test', manifest);
  assert.deepEqual(recovered.dataset, source);
  assert.equal(recovered.lessons.length, 3);
  assert.notEqual(recovered.dataset, source);
});
test('incomplete semantic retrieval refuses partial restoration even when inventory exists', async (t) => {
  const dir = await temporary(t);
  const client = fakeMemory();
  const outbox = new MemoryOutbox(join(dir, 'outbox.json'));
  const source = createSampleDataset();
  await outbox.enqueue(createMemoryRecords(source));
  const jobs = await outbox.process(client, 25, 0);
  const manifest = createPublicationManifest(jobs, source.id);
  client.recall = async () => ({ results: [] });
  await assert.rejects(recoverFromMemory(client, 'fictional-test', manifest), /omitted/);
  assert.throws(
    () =>
      createPublicationManifest(
        jobs.map((j) => ({ ...j, state: 'pending' })),
        source.id,
      ),
    /confirmed/,
  );
});
test('inventory pagination follows has_more across empty filtered pages and rejects incomplete walks', async () => {
  let calls = 0;
  const client = fakeMemory();
  client.listMemories = async () => {
    calls++;
    return {
      memories: [],
      has_more: calls === 1,
      next_cursor: calls === 1 ? 'cursor' : null,
      must_resync: false,
    };
  };
  assert.deepEqual(await enumerate(client, 'sample'), []);
  assert.equal(calls, 2);
  client.listMemories = async () => ({
    memories: [],
    has_more: true,
    next_cursor: 'same',
    must_resync: false,
  });
  await assert.rejects(enumerate(client, 'sample'), /advance/);
});

test('retention remains unverified for null, missing or epoch-only metadata and checks every blob', () => {
  const metadata = (blob_id: string, expires_at: string | null, end_epoch: number | null = 99) => ({
    blob_id,
    status: 'done',
    expires_at,
    end_epoch,
  });
  const future = metadata('later', '2026-12-01T00:00:00Z');
  assert.equal(assessMemoryRetention([future], ['later']).status, 'verified');
  assert.equal(assessMemoryRetention([], []).status, 'unverified');
  const incomplete = assessMemoryRetention(
    [future, metadata('unknown', null)],
    ['later', 'unknown', 'missing', 'later'],
  );
  assert.equal(incomplete.checkedBlobCount, 3);
  assert.equal(incomplete.throughJudgingVerified, false);
  assert.deepEqual(incomplete.unverifiedBlobIds, ['unknown', 'missing']);
  assert.equal(
    assessMemoryRetention([metadata('early', '2026-11-16T00:00:00Z')], ['early']).status,
    'expires-before-judging',
  );
  assert.throws(() => assessMemoryRetention([], [], 'not-a-date'), /valid date/);
});

test('recovery rejects pending and failed inventory even when semantic content is returned', async (t) => {
  const dir = await temporary(t);
  const client = fakeMemory();
  const outbox = new MemoryOutbox(join(dir, 'inventory-state.json'));
  const dataset = createSampleDataset();
  await outbox.enqueue(createMemoryRecords(dataset));
  const jobs = await outbox.process(client, 25, 0);
  const manifest = createPublicationManifest(jobs, dataset.id);
  const inventory = await client.listMemories({ namespace: 'fictional-test', limit: 100 });
  for (const status of ['pending', 'uploaded', 'failed', 'expired', 'deleted']) {
    client.listMemories = async () => ({
      ...inventory,
      memories: inventory.memories.map((memory) => ({ ...memory, status })),
    });
    await assert.rejects(recoverFromMemory(client, 'fictional-test', manifest), /missing/);
  }
});

test('curated corrected-state publication preserves the prior lesson and restores revised learning without changing held cash', async (t) => {
  const source = createSampleDataset();
  const corrected = createCuratedPublicationDataset();
  const records = createCuratedPublicationRecords(corrected);
  assert.equal(records.length, 20);
  assert.equal(
    evaluateDataset(source, '2026-11-05').cash,
    evaluateDataset(corrected, '2026-11-05').cash,
  );
  const paperRecords = records.filter(
    (record) =>
      record.recordType === 'lesson' &&
      (record.payload as { clientId?: string }).clientId === 'paper',
  );
  assert.equal(paperRecords.length, 2);
  const prior = paperRecords.find((record) => record.knownAt.startsWith('2026-11-04'))!;
  const current = paperRecords.find((record) => record.knownAt.startsWith('2026-11-05'))!;
  assert.equal((prior.payload as { sampleSize: number }).sampleSize, 3);
  assert.equal((current.payload as { sampleSize: number }).sampleSize, 2);
  assert.equal(current.supersedesRecordId, prior.id);
  assert.ok(records.some((record) => record.recordType === 'correction'));
  const dir = await temporary(t);
  const client = fakeMemory();
  const outbox = new MemoryOutbox(join(dir, 'corrected-outbox.json'));
  await outbox.enqueue(records);
  const jobs = await outbox.process(client, 25, 0);
  const recovered = await recoverFromMemory(
    client,
    'fictional-test',
    createPublicationManifest(jobs, corrected.id),
  );
  assert.deepEqual(recovered.dataset, corrected);
  const paper = recovered.lessons.find((lesson) => lesson.clientId === 'paper')!;
  assert.equal(paper.sampleSize, 2);
  assert.equal(paper.status, 'insufficient-history');
  assert.equal(recovered.dataset.allocations.length, source.allocations.length);
});

test('exported fictional corrections have deterministic content identities and real chain records are refused', () => {
  const source = createSampleDataset();
  const corrected = createCuratedPublicationDataset();
  assert.equal(
    prepareFictionalExport(source).id,
    prepareFictionalExport(structuredClone(source)).id,
  );
  assert.notEqual(prepareFictionalExport(source).id, prepareFictionalExport(corrected).id);
  assert.equal(createCuratedPublicationRecords(prepareFictionalExport(corrected)).length, 20);
  const enteredAssumption = structuredClone(source);
  enteredAssumption.invoices[0]!.provenance = 'user-entered';
  assert.ok(
    prepareFictionalExport(enteredAssumption).id.startsWith('payday-memory-fictional-export-'),
  );
  const connected = structuredClone(source);
  connected.receipts[0]!.provenance = 'chain-observed';
  assert.throws(() => prepareFictionalExport(connected), /explicitly fictional/);
});
