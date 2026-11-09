import {
  buildScenarios,
  evaluateDataset,
  localDay,
  units,
  USDC_SUI,
  validateDataset,
  validateReceipt,
  type Dataset,
  type Receipt,
  type Scenario,
} from './domain/index';

export interface CapturedSnapshot {
  amount: string;
  coinType: string;
  address: string;
  observedAt: string;
  source: 'chain-observed';
  provider: 'Tatum';
  network: 'sui-mainnet';
  stale: boolean;
}
function validateSnapshot(snapshot: CapturedSnapshot, timezone: string): void {
  if (
    !snapshot ||
    snapshot.coinType !== USDC_SUI ||
    typeof snapshot.amount !== 'string' ||
    snapshot.amount.length > 40 ||
    units(snapshot.amount) < 0n ||
    snapshot.provider !== 'Tatum' ||
    snapshot.network !== 'sui-mainnet' ||
    snapshot.source !== 'chain-observed' ||
    typeof snapshot.address !== 'string' ||
    !/^0x[0-9a-f]{64}$/i.test(snapshot.address) ||
    typeof snapshot.stale !== 'boolean'
  )
    throw new Error('Captured balance failed chain provenance validation.');
  localDay(snapshot.observedAt, timezone);
}
/** Captured evidence remains useful when old, but age never becomes a claim of a live balance. */
export function isSnapshotStale(
  snapshot: CapturedSnapshot,
  now: number = Date.now(),
  maxAgeMs = 15 * 60_000,
): boolean {
  if (!Number.isFinite(now) || !Number.isFinite(maxAgeMs) || maxAgeMs < 0)
    throw new Error('Invalid snapshot freshness policy.');
  localDay(snapshot.observedAt, 'UTC');
  return snapshot.stale || now - Date.parse(snapshot.observedAt) > maxAgeMs;
}
/** Apply a timestamped balance once. Historical receipts explain income; they are never added to cash again. */
export function connectedScenarios(dataset: Dataset, snapshot: CapturedSnapshot): Scenario[] {
  validateSnapshot(snapshot, dataset.timezone);
  const asOf = localDay(snapshot.observedAt, dataset.timezone);
  const fictionalCash = BigInt(evaluateDataset(dataset, asOf).cash);
  const delta = BigInt(snapshot.amount) - fictionalCash;
  return buildScenarios(dataset, asOf).map((s) => {
    const points = s.points.map((p) => ({ ...p, balance: (BigInt(p.balance) + delta).toString() }));
    const minimum = points.reduce((a, b) => (BigInt(a.balance) <= BigInt(b.balance) ? a : b));
    const breach = points.find((p) => BigInt(p.balance) < BigInt(dataset.buffer));
    const shortfall =
      BigInt(minimum.balance) < BigInt(dataset.buffer)
        ? (BigInt(dataset.buffer) - BigInt(minimum.balance)).toString()
        : '0';
    return {
      ...s,
      points,
      minimum: minimum.balance,
      minimumDate: minimum.date,
      purchaseMinimum: minimum.balance,
      purchaseShortfall: shortfall,
      bufferBreach: breach
        ? {
            date: breach.date,
            balance: breach.balance,
            shortfall: (BigInt(dataset.buffer) - BigInt(breach.balance)).toString(),
          }
        : undefined,
    };
  });
}
/** A separate connected workspace: public chain facts plus explicitly hypothetical future bills. */
export function createConnectedWorkspace(
  sample: Dataset,
  snapshot: CapturedSnapshot,
  receipts: Receipt[],
): Dataset {
  connectedScenarios(sample, snapshot); // validate balance metadata and time
  const asOf = localDay(snapshot.observedAt, sample.timezone);
  if (!Array.isArray(receipts)) throw new Error('Captured receipts must be a list.');
  const incoming = receipts.map((receipt) => {
    validateReceipt(receipt, snapshot.address);
    localDay(receipt.occurredAt, sample.timezone);
    localDay(receipt.knownAt, sample.timezone);
    if (receipt.provenance !== 'chain-observed')
      throw new Error('A captured receipt must retain chain provenance.');
    return structuredClone(receipt);
  });
  const byTransfer = new Map<string, Receipt>();
  for (const receipt of incoming) {
    const prior = byTransfer.get(receipt.transferId);
    if (prior) {
      if (
        prior.id !== receipt.id ||
        prior.digest !== receipt.digest ||
        prior.amount !== receipt.amount ||
        prior.asset !== receipt.asset ||
        prior.recipient.toLowerCase() !== receipt.recipient.toLowerCase() ||
        Date.parse(prior.occurredAt) !== Date.parse(receipt.occurredAt)
      )
        throw new Error('Conflicting captured observations share one transfer identity.');
      if (Date.parse(receipt.knownAt) < Date.parse(prior.knownAt)) prior.knownAt = receipt.knownAt;
    } else byTransfer.set(receipt.transferId, receipt);
  }
  const unique = [...byTransfer.values()];
  // All captured receipts belong to the snapshot. Future receipts require a new snapshot/reconciliation.
  if (unique.some((r) => Date.parse(r.occurredAt) > Date.parse(snapshot.observedAt)))
    throw new Error(
      'Receipt is newer than the captured balance. Refresh the snapshot before reconciliation.',
    );
  const connected: Dataset = {
    ...structuredClone(sample),
    id: `connected:${snapshot.address}:${snapshot.observedAt}`,
    walletAddress: snapshot.address,
    capturedAt: snapshot.observedAt,
    opening: { date: asOf, balance: snapshot.amount },
    invoices: sample.invoices
      .filter((i) => i.dueDate >= asOf)
      .map((i) => ({
        ...i,
        provenance: 'user-entered',
        knownAt: snapshot.observedAt,
        note: 'Hypothetical sample assumption attached to public chain facts.',
      })),
    receipts: unique,
    allocations: [],
    corrections: [],
    obligations: sample.obligations
      .filter((o) => !o.paidAt && o.dueDate >= asOf)
      .map((o) => ({ ...o, provenance: 'user-entered', knownAt: snapshot.observedAt })),
  };
  validateDataset(connected);
  return connected;
}
