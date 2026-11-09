import test from 'node:test';
import assert from 'node:assert/strict';
import { SuiGrpcClient, GrpcTypes } from '@mysten/sui/grpc';
import { managedMemoryFetch, type MemoryPackageReader } from '../src/sponsors/memory-transport.js';
import { SponsorError } from '../src/sponsors/safety.js';

const relayer = 'https://relayer.memory.walrus.xyz';
const rpc = 'https://mysten-rpc.mainnet.sui.io';
const packageId = '0x' + 'a'.repeat(64);
const method = '/sui.rpc.v2.LedgerService/GetObject';
function request(id = packageId, extraHeaders: Record<string, string> = {}) {
  const payload = GrpcTypes.GetObjectRequest.toBinary(
    GrpcTypes.GetObjectRequest.create({ objectId: id, readMask: { paths: ['version'] } }),
  );
  const body = new Uint8Array(payload.length + 5);
  new DataView(body.buffer).setUint32(1, payload.length, false);
  body.set(payload, 5);
  return {
    method: 'POST',
    headers: { 'content-type': 'application/grpc-web+proto', ...extraHeaders },
    body,
  };
}
function makeBridge(reader?: MemoryPackageReader) {
  const forwarded: string[] = [];
  let reads = 0;
  const bridge = managedMemoryFetch(
    (async (input) => {
      const address = String(input);
      forwarded.push(address);
      assert.ok(address.startsWith(relayer + '/'));
      return Response.json({
        network: 'mainnet',
        suiTransport: 'grpc',
        packageId,
        suiGrpcUrl: rpc,
        suiRpcUrl: 'https://rpc-mainnet.suiscan.xyz',
      });
    }) as typeof fetch,
    async (req) => {
      reads++;
      assert.equal(req.objectId, packageId);
      return reader
        ? reader(req)
        : GrpcTypes.GetObjectResponse.create({
            object: {
              objectId: packageId,
              version: 1n,
              objectType: 'package',
              owner: { kind: GrpcTypes.Owner_OwnerKind.IMMUTABLE },
            },
          });
    },
  );
  return {
    bridge,
    forwarded,
    get reads() {
      return reads;
    },
  };
}

test('official SDK grpc-web requests use the Tatum callback and immutable package cache without contacting a third RPC', async () => {
  const harness = makeBridge();
  const config = await (await harness.bridge(relayer + '/config')).json();
  assert.equal(config.packageId, packageId);
  assert.equal(config.suiRpcUrl, undefined);
  const original = globalThis.fetch;
  globalThis.fetch = harness.bridge;
  try {
    const sdk = new SuiGrpcClient({ network: 'mainnet', baseUrl: rpc });
    const first = await sdk.ledgerService.getObject({ objectId: packageId });
    const second = await sdk.ledgerService.getObject({ objectId: packageId });
    const core = await sdk.core.getObject({ objectId: packageId });
    assert.equal(first.response.object?.version, 1n);
    assert.equal(second.response.object?.objectId, packageId);
    assert.equal(core.object.version, '1');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(harness.reads, 1);
  assert.deepEqual(harness.forwarded, [relayer + '/config']);
});

test('package routing rejects wrong objects, write methods, fallback hosts and missing configuration', async () => {
  const harness = makeBridge();
  await assert.rejects(harness.bridge(rpc + method, request()), /Only the SDK/);
  await harness.bridge(relayer + '/config');
  await assert.rejects(
    harness.bridge(rpc + method, request('0x' + 'b'.repeat(64))),
    /does not match/,
  );
  await assert.rejects(
    harness.bridge(rpc + '/sui.rpc.v2.TransactionExecutionService/ExecuteTransaction', request()),
    /Only the SDK/,
  );
  await assert.rejects(
    harness.bridge('https://rpc-mainnet.suiscan.xyz', request()),
    /Only the SDK/,
  );
  const batch = GrpcTypes.BatchGetObjectsRequest.toBinary(
    GrpcTypes.BatchGetObjectsRequest.create({
      requests: [{ objectId: packageId }, { objectId: packageId }],
    }),
  );
  const batchBody = new Uint8Array(batch.length + 5);
  new DataView(batchBody.buffer).setUint32(1, batch.length, false);
  batchBody.set(batch, 5);
  await assert.rejects(
    harness.bridge(rpc + '/sui.rpc.v2.LedgerService/BatchGetObjects', {
      ...request(),
      body: batchBody,
    }),
    /exactly one/,
  );
  const masked = GrpcTypes.GetObjectRequest.toBinary(
    GrpcTypes.GetObjectRequest.create({
      objectId: packageId,
      readMask: { paths: ['test_private_value'] },
    }),
  );
  const maskedBody = new Uint8Array(masked.length + 5);
  new DataView(maskedBody.buffer).setUint32(1, masked.length, false);
  maskedBody.set(masked, 5);
  await assert.rejects(
    harness.bridge(rpc + method, { ...request(), body: maskedBody }),
    /public object field names/,
  );
  assert.equal(harness.reads, 0);
  assert.deepEqual(harness.forwarded, [relayer + '/config']);
});

test('private headers and malformed grpc-web input cannot reach Tatum', async () => {
  const harness = makeBridge();
  await harness.bridge(relayer + '/config');
  for (const header of [
    'authorization',
    'cookie',
    'x-api-key',
    'x-signature',
    'x-delegate-key',
    'x-seal-session',
    'x-account-id',
  ]) {
    await assert.rejects(
      harness.bridge(rpc + method, request(packageId, { [header]: 'test-private-value' })),
      /Private authentication headers/,
    );
  }
  await assert.rejects(
    harness.bridge(rpc + method, { ...request(), body: new Uint8Array([0, 0, 0, 0, 5, 1]) }),
    /framing/,
  );
  await assert.rejects(
    harness.bridge(rpc + method, { ...request(), method: 'PUT' }),
    /Unexpected method/,
  );
  assert.equal(harness.reads, 0);
});

test('failed Tatum checks never fall back or consume another package read in the same client', async () => {
  const harness = makeBridge(async () => {
    throw new Error('Offline simulated Tatum quota block');
  });
  await harness.bridge(relayer + '/config');
  await assert.rejects(harness.bridge(rpc + method, request()), /Tatum quota block/);
  await assert.rejects(harness.bridge(rpc + method, request()), /Tatum quota block/);
  assert.equal(harness.reads, 1);
  assert.deepEqual(harness.forwarded, [relayer + '/config']);
});

test('mismatched package observations fail instead of fabricating successful validation', async () => {
  for (const object of [
    { objectId: '0x' + 'b'.repeat(64), version: 1n },
    { objectId: packageId, version: 2n },
  ]) {
    const harness = makeBridge(async () => GrpcTypes.GetObjectResponse.create({ object }));
    await harness.bridge(relayer + '/config');
    await assert.rejects(harness.bridge(rpc + method, request()), /did not match/);
  }
});

test('quota refusals on every managed route retain their code and stop the entire client', async () => {
  for (const route of ['/version', '/health', '/config', '/api/remember', '/api/stats']) {
    let requests = 0;
    const bridge = managedMemoryFetch(
      async () => {
        requests++;
        return new Response('{}', { status: 429 });
      },
      async () => {
        throw new Error('A quota refusal must not trigger package validation.');
      },
    );
    const isQuota = (error: unknown) => error instanceof SponsorError && error.code === 'quota';
    await assert.rejects(bridge(relayer + route), isQuota);
    await assert.rejects(bridge(relayer + '/api/remember'), isQuota);
    assert.equal(requests, 1, route);
  }
});
