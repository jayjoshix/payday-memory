import { GrpcTypes } from '@mysten/sui/grpc';
import { SponsorError } from './safety.js';

const MANAGED = 'https://relayer.memory.walrus.xyz';
const PACKAGE_METHOD = '/sui.rpc.v2.LedgerService/GetObject';
const BATCH_PACKAGE_METHOD = '/sui.rpc.v2.LedgerService/BatchGetObjects';
export type MemoryPackageReader = (
  request: GrpcTypes.GetObjectRequest,
) => Promise<GrpcTypes.GetObjectResponse>;

function frame(payload: Uint8Array, flag = 0): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(payload.length + 5);
  bytes[0] = flag;
  new DataView(bytes.buffer).setUint32(1, payload.length, false);
  bytes.set(payload, 5);
  return bytes;
}

/** Adapt the SDK's one public package check to Tatum; never contact its advertised RPC hosts. */
export function managedMemoryFetch(
  original: typeof fetch,
  readPackage: MemoryPackageReader,
): typeof fetch {
  let packageId: string | undefined;
  let sdkRpcOrigin: string | undefined;
  let cachedPackage: Promise<GrpcTypes.GetObjectResponse> | undefined;
  let quotaStopped = false;
  return async (input, init) => {
    if (quotaStopped)
      throw new SponsorError(
        'quota',
        'Memory quota stopped this client. No further request was made.',
      );
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
    );
    if (url.origin === MANAGED) {
      const response = await original(input, { ...init, redirect: 'error' });
      // SDK preflights turn non-success statuses into plain Errors. Preserve the
      // quota classification before that conversion so the outbox and durable
      // provider circuit stop on the very first refusal.
      if (response.status === 429) {
        quotaStopped = true;
        throw new SponsorError('quota', 'Memory quota reached. No further request was made.');
      }
      if (url.pathname !== '/config' || !response.ok) return response;
      const config = (await response.clone().json()) as Record<string, unknown>;
      if (
        config.network !== 'mainnet' ||
        config.suiTransport !== 'grpc' ||
        typeof config.packageId !== 'string' ||
        !/^0x[0-9a-f]{64}$/i.test(config.packageId) ||
        typeof config.suiGrpcUrl !== 'string'
      )
        throw new SponsorError(
          'blocked',
          'Memory did not advertise a valid Mainnet gRPC package configuration.',
        );
      const nextPackage = config.packageId.toLowerCase();
      if (packageId && packageId !== nextPackage)
        throw new SponsorError(
          'blocked',
          'Memory package changed within one client session. Start a fresh explicit check.',
        );
      packageId = nextPackage;
      sdkRpcOrigin = new URL(config.suiGrpcUrl).origin;
      // Endpoint routing only: all package/network/account data remains genuine.
      // Removing JSON-RPC prevents an SDK fallback after a failed Tatum read.
      const clientConfig = { ...config };
      delete clientConfig.suiRpcUrl;
      return new Response(JSON.stringify(clientConfig), {
        status: response.status,
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      });
    }
    if (
      !packageId ||
      !sdkRpcOrigin ||
      url.origin !== sdkRpcOrigin ||
      ![PACKAGE_METHOD, BATCH_PACKAGE_METHOD].includes(url.pathname) ||
      url.search ||
      url.username ||
      url.password
    )
      throw new SponsorError(
        'blocked',
        'Only the SDK public-package GetObject read can be routed through Tatum. No fallback RPC provider was contacted.',
      );
    const request = new Request(input, init);
    if (request.method !== 'POST')
      throw new SponsorError('blocked', 'Unexpected method for the SDK package check.');
    for (const header of [
      'authorization',
      'cookie',
      'x-api-key',
      'x-signature',
      'x-delegate-key',
      'x-seal-session',
      'x-account-id',
    ])
      if (request.headers.has(header))
        throw new SponsorError(
          'blocked',
          'Private authentication headers cannot enter the SDK package bridge.',
        );
    const contentType = request.headers.get('content-type') ?? '';
    const textFormat = contentType.startsWith('application/grpc-web-text');
    if (!textFormat && !contentType.startsWith('application/grpc-web+proto'))
      throw new SponsorError('invalid', 'Unsupported SDK package request format.');
    const raw = new Uint8Array(await request.arrayBuffer());
    if (raw.length > 12000)
      throw new SponsorError('invalid', 'SDK package request exceeds its bounded size.');
    const wire = textFormat
      ? Uint8Array.from(Buffer.from(new TextDecoder().decode(raw), 'base64'))
      : raw;
    if (
      wire.length < 5 ||
      wire[0] !== 0 ||
      new DataView(wire.buffer, wire.byteOffset, wire.byteLength).getUint32(1, false) !==
        wire.length - 5
    )
      throw new SponsorError('invalid', 'SDK package request framing is invalid.');
    let decoded: GrpcTypes.GetObjectRequest;
    const batch = url.pathname === BATCH_PACKAGE_METHOD;
    if (batch) {
      const decodedBatch = GrpcTypes.BatchGetObjectsRequest.fromBinary(wire.subarray(5), {
        readUnknownField: 'throw',
      });
      if (decodedBatch.requests.length !== 1)
        throw new SponsorError(
          'blocked',
          'SDK package validation can request exactly one public object.',
        );
      decoded = {
        ...decodedBatch.requests[0]!,
        readMask: decodedBatch.readMask ?? decodedBatch.requests[0]!.readMask,
      };
    } else {
      decoded = GrpcTypes.GetObjectRequest.fromBinary(wire.subarray(5), {
        readUnknownField: 'throw',
      });
    }
    const allowedFields = new Set(GrpcTypes.Object.fields.map((field) => field.name));
    if ((decoded.readMask?.paths ?? []).some((field) => !allowedFields.has(field)))
      throw new SponsorError(
        'blocked',
        'Only public object field names may enter the SDK package bridge.',
      );
    if (
      decoded.objectId?.toLowerCase() !== packageId ||
      (decoded.version !== undefined && decoded.version !== 1n)
    )
      throw new SponsorError(
        'blocked',
        'SDK object read does not match the advertised public package.',
      );
    request.signal.throwIfAborted();
    cachedPackage ??= readPackage(decoded).then((result) => {
      const object = result.object;
      if (!object || object.objectId?.toLowerCase() !== packageId || object.version !== 1n)
        throw new SponsorError(
          'invalid',
          'Tatum package response did not match the requested immutable package.',
        );
      return result;
    });
    const actual = await cachedPackage;
    const encoded = batch
      ? GrpcTypes.BatchGetObjectsResponse.toBinary(
          GrpcTypes.BatchGetObjectsResponse.create({
            objects: [{ result: { oneofKind: 'object', object: actual.object! } }],
          }),
        )
      : GrpcTypes.GetObjectResponse.toBinary(actual);
    const payload = frame(encoded);
    const trailer = frame(new TextEncoder().encode('grpc-status: 0\r\n'), 128);
    const body = new Uint8Array(payload.length + trailer.length);
    body.set(payload);
    body.set(trailer, payload.length);
    return new Response(textFormat ? Buffer.from(body).toString('base64') : body, {
      headers: {
        'content-type': textFormat ? 'application/grpc-web-text' : 'application/grpc-web+proto',
      },
    });
  };
}
