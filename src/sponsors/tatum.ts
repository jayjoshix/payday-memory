import { SuiGrpcClient, GrpcTypes } from '@mysten/sui/grpc';
import { GrpcTransport } from '@protobuf-ts/grpc-transport';
import { credentials } from '@grpc/grpc-js';
import { USDC_SUI, type Receipt } from '../domain/index.js';
import {
  SponsorError,
  safeFailure,
  loadAccountChecks,
  requireTatum,
  assertProviderCircuit,
  recordQuotaStop,
  atomicJson,
} from './safety.js';
export const TATUM_HOST = 'sui-mainnet-grpc.gateway.tatum.io:443';

function tatumTransport(apiKey: string): GrpcTransport {
  return new GrpcTransport({
    host: TATUM_HOST,
    channelCredentials: credentials.createSsl(),
    meta: { 'x-api-key': apiKey },
    timeout: 15000,
    // A capped application call must not inherit retries from channel/DNS policy.
    clientOptions: { 'grpc.enable_retries': 0, 'grpc.service_config_disable_resolution': 1 },
  });
}

/** Read-only dependency used by the official Memory SDK's Seal package validation. */
export async function readMemoryPackageViaTatum(
  request: GrpcTypes.GetObjectRequest,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GrpcTypes.GetObjectResponse> {
  const checks = await loadAccountChecks();
  requireTatum(checks, env);
  await assertProviderCircuit('tatum', checks);
  if (!/^0x[0-9a-f]{64}$/i.test(request.objectId ?? ''))
    throw new SponsorError('invalid', 'Invalid SDK package object ID.');
  const transport = tatumTransport(env.TATUM_API_KEY!);
  try {
    const client = new SuiGrpcClient({ network: 'mainnet', transport });
    const { response } = await client.ledgerService.getObject({
      ...request,
      readMask: {
        paths: [
          ...new Set([
            'object_id',
            'version',
            'digest',
            'owner',
            'object_type',
            ...(request.readMask?.paths ?? []),
          ]),
        ],
      },
    });
    if (
      response.object?.objectId?.toLowerCase() !== request.objectId!.toLowerCase() ||
      response.object.version !== 1n
    )
      throw new SponsorError('invalid', 'Tatum returned an unexpected SDK package object.');
    await atomicJson('data/memory-package-read.json', {
      provider: 'Tatum',
      network: 'sui-mainnet',
      method: 'sui.rpc.v2.LedgerService/GetObject',
      observedAt: new Date().toISOString(),
      packageId: response.object.objectId,
      version: '1',
      requestsUsed: 1,
      readOnly: true,
    });
    return response;
  } catch (error) {
    await recordQuotaStop('tatum', error);
    const failure = safeFailure(error);
    throw new SponsorError(
      failure.code === 'quota' ? 'blocked' : 'unavailable',
      failure.code === 'quota'
        ? 'Tatum quota stopped the SDK package check. No Memory content request was made.'
        : 'Tatum SDK package validation failed. No alternate RPC provider was used.',
    );
  } finally {
    transport.close();
  }
}
export interface ChainSnapshot {
  amount: string;
  coinType: string;
  address: string;
  observedAt: string;
  source: 'chain-observed';
  provider: 'Tatum';
  network: 'sui-mainnet';
  stale: boolean;
}
export interface TatumReads {
  balance(address: string): Promise<{
    coinType?: string;
    balance?: bigint;
  }>;
  transaction(digest: string): Promise<ChainTransaction>;
  close?(): void;
}
export interface ChainTransaction {
  digest?: string;
  timestamp?: {
    seconds: bigint;
    nanos: number;
  };
  effects?: {
    status?: {
      success?: boolean;
    };
  };
  balanceChanges: {
    address?: string;
    coinType?: string;
    amount?: string;
  }[];
}
export function nativeTatumReads(apiKey: string): TatumReads {
  const transport = tatumTransport(apiKey);
  const client = new SuiGrpcClient({ network: 'mainnet', transport });
  return {
    async balance(address) {
      const { response } = await client.stateService.getBalance({
        owner: address,
        coinType: USDC_SUI,
      });
      if (!response.balance)
        throw new SponsorError('invalid', 'Tatum omitted the requested native USDC balance.');
      return response.balance;
    },
    async transaction(digest) {
      const { response } = await client.ledgerService.getTransaction({
        digest,
        readMask: { paths: ['digest', 'timestamp', 'effects.status', 'balance_changes'] },
      });
      if (!response.transaction)
        throw new SponsorError('invalid', 'Tatum omitted the requested transaction.');
      return response.transaction;
    },
    close() {
      transport.close();
    },
  };
}
export function validateAddress(address: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(address))
    throw new SponsorError(
      'invalid',
      'Provide one public Sui address with0x and64 hexadecimal digits.',
    );
  return address.toLowerCase();
}
export function receiptsFromTransaction(
  tx: ChainTransaction,
  address: string,
  knownAt: string,
): Receipt[] {
  const recipient = validateAddress(address);
  if (
    !tx.digest ||
    tx.effects?.status?.success !== true ||
    !tx.timestamp ||
    tx.timestamp.seconds < 0n
  )
    throw new SponsorError(
      'invalid',
      'Transaction must include a digest, successful effects and a finalized timestamp.',
    );
  const occurredAt = new Date(
    Number(tx.timestamp.seconds) * 1000 + Math.floor(tx.timestamp.nanos / 1e6),
  ).toISOString();
  return tx.balanceChanges.flatMap((change, index) => {
    if (change.address?.toLowerCase() !== recipient || change.coinType !== USDC_SUI) return [];
    if (!change.amount || !/^\d+$/.test(change.amount) || BigInt(change.amount) <= 0n) return [];
    const transferId = `${tx.digest}:balance-change:${index}:${recipient}:${USDC_SUI}`;
    return [
      {
        id: transferId,
        transferId,
        digest: tx.digest!,
        amount: change.amount,
        asset: USDC_SUI,
        recipient,
        status: 'success' as const,
        occurredAt,
        knownAt,
        provenance: 'chain-observed' as const,
      },
    ];
  });
}
/** One operator invocation, sequential reads, no history scan and no transaction submission API. */
export class TatumAdapter {
  private used = 0;
  private stopped = false;
  private cache = new Map<string, ChainSnapshot>();
  constructor(
    private readonly reads: TatumReads,
    private readonly maxRequests = 3,
  ) {
    if (!Number.isInteger(maxRequests) || maxRequests < 1 || maxRequests > 3)
      throw new SponsorError('invalid', 'Tatum request cap must be1 to3.');
  }
  private async call<T>(fn: () => Promise<T>): Promise<T> {
    if (this.stopped || this.used >= this.maxRequests)
      throw new SponsorError('quota', 'Tatum operator request cap reached.');
    this.used++;
    try {
      return await fn();
    } catch (error) {
      const safe = safeFailure(error);
      if (safe.code === 'quota') this.stopped = true;
      throw new SponsorError(safe.code as 'quota' | 'timeout' | 'unavailable', safe.message);
    }
  }
  async snapshot(address: string): Promise<ChainSnapshot> {
    const normalized = validateAddress(address);
    const cached = this.cache.get(normalized);
    if (cached) return cached;
    const balance = await this.call(() => this.reads.balance(normalized));
    if (
      balance.coinType !== USDC_SUI ||
      typeof balance.balance !== 'bigint' ||
      balance.balance < 0n
    )
      throw new SponsorError('invalid', 'Unexpected token identity or invalid exact balance.');
    const result: ChainSnapshot = {
      amount: balance.balance.toString(),
      coinType: USDC_SUI,
      address: normalized,
      observedAt: new Date().toISOString(),
      source: 'chain-observed',
      provider: 'Tatum',
      network: 'sui-mainnet',
      stale: false,
    };
    this.cache.set(normalized, result);
    return result;
  }
  async receipt(digest: string, address: string): Promise<Receipt[]> {
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,50}$/.test(digest))
      throw new SponsorError('invalid', 'Provide a valid public transaction digest.');
    return receiptsFromTransaction(
      await this.call(() => this.reads.transaction(digest)),
      address,
      new Date().toISOString(),
    );
  }
  get requestsUsed(): number {
    return this.used;
  }
  close(): void {
    this.reads.close?.();
  }
}
