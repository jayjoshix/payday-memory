/** Offline, deterministic financial domain. Amounts are USDC base units (6 decimals). */
export type Amount = string;
export type Day = string;
export type Provenance = 'fictional' | 'user-entered' | 'chain-observed';
export const USDC_SUI =
  '0xdba34672e30cb065b1f93e3ab55318768fd6fef66c15942c9f7cb846e2f900e7::usdc::USDC';
export const ALGORITHM_VERSION = 'settled-median-v1';
export const SAMPLE_AS_OF = '2026-11-05';
export interface Client {
  id: string;
  alias: string;
}
export interface Invoice {
  id: string;
  clientId: string;
  amount: Amount;
  dueDate: Day;
  planningDate?: Day;
  knownAt: string;
  note?: string;
  provenance: Provenance;
}
export interface Receipt {
  id: string;
  transferId: string;
  digest: string;
  amount: Amount;
  asset: string;
  recipient: string;
  status: 'success' | 'failed';
  occurredAt: string;
  knownAt: string;
  provenance: Provenance;
}
export interface Allocation {
  id: string;
  receiptId: string;
  invoiceId: string;
  amount: Amount;
  confirmed: boolean;
  knownAt: string;
}
export interface Obligation {
  id: string;
  name: string;
  amount: Amount;
  dueDate: Day;
  knownAt: string;
  paidAt?: string;
  provenance: Provenance;
}
export interface Correction {
  id: string;
  receiptId: string;
  kind: 'reimbursement' | 'exceptional' | 'include';
  reason: string;
  occurredAt: string;
  knownAt: string;
  effectiveVersion: number;
  supersedesRecordId?: string;
}
export interface TimingLesson {
  id: string;
  clientId: string;
  sampleSize: number;
  window: number;
  delayDays: number | null;
  rawMedianDays: number | null;
  sourceObservationIds: string[];
  excludedObservationIds: string[];
  unresolvedCount: number;
  calculatedAt: string;
  algorithmVersion: string;
  effectiveVersion: number;
  status: 'learned' | 'insufficient-history';
}
export interface Dataset {
  id: string;
  schemaVersion: 1;
  timezone: string;
  currency: 'USDC';
  buffer: Amount;
  horizonDays: number;
  walletAddress: string;
  opening: { date: Day; balance: Amount };
  clients: Client[];
  invoices: Invoice[];
  receipts: Receipt[];
  allocations: Allocation[];
  obligations: Obligation[];
  corrections: Correction[];
  capturedAt?: string;
}
export interface InvoiceView extends Invoice {
  received: Amount;
  outstanding: Amount;
  status: 'settled' | 'partial' | 'overdue' | 'expected';
  fullyPaidDate?: Day;
  firstReceiptDate?: Day;
  observationIds: string[];
  excluded: boolean;
  learnedDate?: Day;
  timingUnknown: boolean;
}
export interface Evaluation {
  asOf: Day;
  cash: Amount;
  expectedIncome: Amount;
  unpaidObligations: Amount;
  lessons: TimingLesson[];
  invoices: InvoiceView[];
  receipts: Receipt[];
  obligations: Obligation[];
  corrections: Correction[];
  snapshotAt: string;
}
export interface ScenarioPoint {
  date: Day;
  balance: Amount;
  inflow: Amount;
  outflow: Amount;
}
export interface Scenario {
  id: 'promised' | 'learned' | 'none';
  label: string;
  from: Day;
  through: Day;
  points: ScenarioPoint[];
  minimum: Amount;
  minimumDate: Day;
  bufferBreach?: { date: Day; balance: Amount; shortfall: Amount };
  purchaseMinimum: Amount;
  purchaseShortfall: Amount;
  unknownInvoiceIds: string[];
}
export interface Purchase {
  amount: Amount;
  date: Day;
}

export function units(value: Amount): bigint {
  if (typeof value !== 'string' || !/^-?(0|[1-9]\d*)$/.test(value))
    throw new Error('Money must be canonical integer base units.');
  return BigInt(value);
}
export function money(decimal: string): Amount {
  if (!/^-?\d+(\.\d{1,6})?$/.test(decimal))
    throw new Error('Enter an amount with at most six decimal places.');
  const negative = decimal.startsWith('-');
  const [whole, fraction = ''] = decimal.replace('-', '').split('.');
  return (
    (BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))) *
    (negative ? -1n : 1n)
  ).toString();
}
export function formatMoney(amount: Amount, decimals = 2): string {
  const value = units(amount);
  const absolute = value < 0n ? -value : value;
  const whole = (absolute / 1_000_000n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const fraction = (absolute % 1_000_000n).toString().padStart(6, '0').slice(0, decimals);
  return `${value < 0n ? '−' : ''}$${whole}${decimals ? `.${fraction}` : ''}`;
}
export function day(value: Day): Day {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) !== value
  )
    throw new Error('Invalid calendar date.');
  return value;
}
export function addDays(value: Day, count: number): Day {
  day(value);
  const date = new Date(value + 'T12:00:00Z');
  date.setUTCDate(date.getUTCDate() + count);
  return date.toISOString().slice(0, 10);
}
export function dateDifference(later: Day, earlier: Day): number {
  day(later);
  day(earlier);
  return Math.round(
    (Date.parse(later + 'T12:00:00Z') - Date.parse(earlier + 'T12:00:00Z')) / 86_400_000,
  );
}
export function localDay(timestamp: string, timezone: string): Day {
  validateTimestamp(timestamp);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  return `${parts.find((p) => p.type === 'year')!.value}-${parts.find((p) => p.type === 'month')!.value}-${parts.find((p) => p.type === 'day')!.value}`;
}
/** Replay days include knowledge through 23:59:59 in the configured calendar timezone. */
export function endOfDayTimestamp(value: Day, timezone: string): string {
  day(value);
  const target = Date.parse(`${value}T23:59:59Z`);
  let candidate = target;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = formatter.formatToParts(candidate);
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    const displayed = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      get('hour'),
      get('minute'),
      get('second'),
    );
    const adjustment = target - displayed;
    candidate += adjustment;
    if (adjustment === 0) return new Date(candidate).toISOString().replace('.000Z', 'Z');
  }
  throw new Error('Replay calendar day does not exist in this timezone.');
}
function known(timestamp: string, asOf: Day, timezone: string): boolean {
  return localDay(timestamp, timezone) <= asOf;
}
function validateTimestamp(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('Timestamp must be a valid ISO instant with an offset.');
  day(value.slice(0, 10));
}
function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
function requiredString(value: unknown, label: string, maxLength = 240): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength)
    throw new Error(`Invalid ${label}.`);
}
function positiveAmount(value: unknown, label: string, allowZero = false): void {
  if (typeof value !== 'string' || value.length > 40 || units(value) < (allowZero ? 0n : 1n))
    throw new Error(`Invalid ${label}.`);
}
function provenance(value: unknown): void {
  if (!['fictional', 'user-entered', 'chain-observed'].includes(value as string))
    throw new Error('Invalid provenance category.');
}
function sum(amounts: Amount[]): Amount {
  return amounts.reduce((total, amount) => total + units(amount), 0n).toString();
}
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : Math.ceil((sorted[middle - 1]! + sorted[middle]!) / 2);
}
function activeCorrection(dataset: Dataset, receiptId: string, asOf: Day): Correction | undefined {
  return dataset.corrections
    .filter((c) => c.receiptId === receiptId && known(c.knownAt, asOf, dataset.timezone))
    .sort(
      (a, b) => b.effectiveVersion - a.effectiveVersion || b.knownAt.localeCompare(a.knownAt),
    )[0];
}
function activeCorrectionAt(
  dataset: Dataset,
  receiptId: string,
  instant: number,
): Correction | undefined {
  return dataset.corrections
    .filter((c) => c.receiptId === receiptId && Date.parse(c.knownAt) <= instant)
    .sort((a, b) => b.effectiveVersion - a.effectiveVersion)[0];
}
/** Superseded reimbursement matches remain in history but no longer reserve invoice capacity. */
function invoiceReservedAt(dataset: Dataset, invoiceId: string, instant: number): bigint {
  return dataset.allocations
    .filter(
      (a) =>
        a.invoiceId === invoiceId &&
        Date.parse(a.knownAt) <= instant &&
        activeCorrectionAt(dataset, a.receiptId, instant)?.kind !== 'reimbursement',
    )
    .reduce((total, a) => total + units(a.amount), 0n);
}
/** Check every knowledge boundary, so a later correction cannot conceal an earlier excess. */
function validateInvoiceCapacityHistory(dataset: Dataset): void {
  type CapacityEvent = { at: number; allocation?: Allocation; correction?: Correction };
  const events: CapacityEvent[] = [
    ...dataset.allocations.map((allocation) => ({
      at: Date.parse(allocation.knownAt),
      allocation,
    })),
    ...dataset.corrections.map((correction) => ({
      at: Date.parse(correction.knownAt),
      correction,
    })),
  ];
  events.sort(
    (a, b) =>
      a.at - b.at ||
      (a.correction ? 1 : 0) - (b.correction ? 1 : 0) ||
      (a.correction?.effectiveVersion ?? 0) - (b.correction?.effectiveVersion ?? 0),
  );
  const corrections = new Map<string, Correction>();
  const seen = new Map<string, Allocation[]>();
  const reserved = new Map<string, bigint>();
  const limits = new Map(dataset.invoices.map((invoice) => [invoice.id, units(invoice.amount)]));
  for (let index = 0; index < events.length;) {
    const at = events[index]!.at;
    const changed = new Set<string>();
    const adjust = (allocation: Allocation, direction: bigint) => {
      reserved.set(
        allocation.invoiceId,
        (reserved.get(allocation.invoiceId) ?? 0n) + direction * units(allocation.amount),
      );
      changed.add(allocation.invoiceId);
    };
    do {
      const event = events[index++]!;
      if (event.allocation) {
        const allocation = event.allocation;
        seen.set(allocation.receiptId, [...(seen.get(allocation.receiptId) ?? []), allocation]);
        if (corrections.get(allocation.receiptId)?.kind !== 'reimbursement') adjust(allocation, 1n);
      } else {
        const correction = event.correction!;
        const wasBlocked = corrections.get(correction.receiptId)?.kind === 'reimbursement';
        const isBlocked = correction.kind === 'reimbursement';
        corrections.set(correction.receiptId, correction);
        if (wasBlocked !== isBlocked)
          for (const allocation of seen.get(correction.receiptId) ?? [])
            adjust(allocation, isBlocked ? -1n : 1n);
      }
    } while (index < events.length && events[index]!.at === at);
    for (const invoiceId of changed)
      if ((reserved.get(invoiceId) ?? 0n) > limits.get(invoiceId)!)
        throw new Error('Payment over-allocated at a recorded knowledge time.');
  }
}

export function validateReceipt(receipt: Receipt, walletAddress: string): void {
  if (units(receipt.amount) <= 0n) throw new Error('Receipt amount must be positive.');
  if (receipt.asset !== USDC_SUI) throw new Error('Receipt is not native USDC on Sui.');
  if (receipt.recipient.toLowerCase() !== walletAddress.toLowerCase())
    throw new Error('Receipt has the wrong recipient.');
  if (receipt.status !== 'success') throw new Error('Receipt transaction did not succeed.');
  if (!receipt.transferId || !receipt.digest)
    throw new Error('Receipt needs a stable transfer identity and digest.');
}
export function importReceipts(dataset: Dataset, incoming: Receipt[]): Dataset {
  const next = structuredClone(dataset);
  const identities = new Set(next.receipts.map((r) => r.transferId));
  for (const receipt of incoming) {
    validateReceipt(receipt, next.walletAddress);
    if (identities.has(receipt.transferId)) continue;
    identities.add(receipt.transferId);
    next.receipts.push(receipt);
  }
  return next;
}
export function allocateReceipt(dataset: Dataset, allocation: Allocation): Dataset {
  if (dataset.allocations.some((a) => a.id === allocation.id))
    throw new Error('Allocation ID already exists.');
  const receipt = dataset.receipts.find((r) => r.id === allocation.receiptId);
  const invoice = dataset.invoices.find((i) => i.id === allocation.invoiceId);
  if (!receipt || !invoice) throw new Error('Receipt or expected payment not found.');
  validateReceipt(receipt, dataset.walletAddress);
  validateTimestamp(allocation.knownAt);
  if (
    activeCorrectionAt(dataset, receipt.id, Date.parse(allocation.knownAt))?.kind ===
    'reimbursement'
  )
    throw new Error('A reimbursement receipt must be restored as income before matching.');
  const amount = units(allocation.amount);
  if (amount <= 0n) throw new Error('Allocation must be positive.');
  if (
    units(sum(dataset.allocations.filter((a) => a.receiptId === receipt.id).map((a) => a.amount))) +
      amount >
    units(receipt.amount)
  )
    throw new Error('Allocation exceeds receipt amount.');
  if (
    invoiceReservedAt(dataset, invoice.id, Date.parse(allocation.knownAt)) + amount >
    units(invoice.amount)
  )
    throw new Error('Allocation exceeds expected payment amount.');
  const next = structuredClone(dataset);
  next.allocations.push(allocation);
  validateDataset(next);
  return next;
}
export function appendCorrection(
  dataset: Dataset,
  input: Omit<Correction, 'effectiveVersion' | 'supersedesRecordId'>,
): Dataset {
  if (!input.reason.trim()) throw new Error('A correction needs a reason.');
  if (!dataset.receipts.some((r) => r.id === input.receiptId))
    throw new Error('Receipt not found.');
  if (dataset.corrections.some((c) => c.id === input.id))
    throw new Error('Correction ID already exists.');
  const previous = dataset.corrections
    .filter((c) => c.receiptId === input.receiptId)
    .sort((a, b) => b.effectiveVersion - a.effectiveVersion)[0];
  const next = structuredClone(dataset);
  next.corrections.push({
    ...input,
    effectiveVersion: (previous?.effectiveVersion ?? 0) + 1,
    ...(previous ? { supersedesRecordId: previous.id } : {}),
  });
  validateDataset(next);
  return next;
}

export function evaluateDataset(dataset: Dataset, asOf: Day): Evaluation {
  day(asOf);
  if (dataset.capturedAt && asOf < localDay(dataset.capturedAt, dataset.timezone))
    throw new Error('This connected workspace has no balance before its captured snapshot.');
  if (asOf < dataset.opening.date)
    throw new Error('Replay precedes the fictional opening balance.');
  const receipts = dataset.receipts.filter(
    (r) =>
      known(r.knownAt, asOf, dataset.timezone) && localDay(r.occurredAt, dataset.timezone) <= asOf,
  );
  const corrections = dataset.corrections.filter((c) => known(c.knownAt, asOf, dataset.timezone));
  const validReceipts = receipts.filter((r) => {
    try {
      validateReceipt(r, dataset.walletAddress);
      return true;
    } catch {
      return false;
    }
  });
  const validIds = new Set(validReceipts.map((r) => r.id));
  const allocations = dataset.allocations.filter(
    (a) =>
      a.confirmed &&
      known(a.knownAt, asOf, dataset.timezone) &&
      validIds.has(a.receiptId) &&
      activeCorrection(dataset, a.receiptId, asOf)?.kind !== 'reimbursement',
  );
  const invoices: InvoiceView[] = dataset.invoices
    .filter((i) => known(i.knownAt, asOf, dataset.timezone))
    .map((invoice) => {
      const matches = allocations
        .filter((a) => a.invoiceId === invoice.id)
        .sort((a, b) => {
          const r1 = validReceipts.find((r) => r.id === a.receiptId)!;
          const r2 = validReceipts.find((r) => r.id === b.receiptId)!;
          return Date.parse(r1.occurredAt) - Date.parse(r2.occurredAt);
        });
      let total = 0n;
      let paidDate: Day | undefined;
      for (const allocation of matches) {
        total += units(allocation.amount);
        if (total >= units(invoice.amount) && !paidDate)
          paidDate = localDay(
            validReceipts.find((r) => r.id === allocation.receiptId)!.occurredAt,
            dataset.timezone,
          );
      }
      const outstanding = units(invoice.amount) - total;
      if (outstanding < 0n) throw new Error('Stored allocations exceed expected payment amount.');
      const ids = matches.map((a) => a.receiptId);
      return {
        ...invoice,
        received: total.toString(),
        outstanding: outstanding.toString(),
        status:
          outstanding === 0n
            ? 'settled'
            : total > 0n
              ? 'partial'
              : invoice.dueDate < asOf
                ? 'overdue'
                : 'expected',
        fullyPaidDate: paidDate,
        firstReceiptDate: matches[0]
          ? localDay(
              validReceipts.find((r) => r.id === matches[0]!.receiptId)!.occurredAt,
              dataset.timezone,
            )
          : undefined,
        observationIds: ids,
        excluded: ids.some((id) => activeCorrection(dataset, id, asOf)?.kind === 'exceptional'),
        timingUnknown: false,
      };
    });
  const lessons = dataset.clients.map((client) => {
    const clientInvoices = invoices.filter((i) => i.clientId === client.id);
    const completed = clientInvoices
      .filter((i) => i.status === 'settled' && !i.excluded)
      .sort((a, b) => b.fullyPaidDate!.localeCompare(a.fullyPaidDate!) || a.id.localeCompare(b.id))
      .slice(0, 6);
    const rawMedianDays =
      completed.length >= 3
        ? median(completed.map((i) => dateDifference(i.fullyPaidDate!, i.dueDate)))
        : null;
    const version =
      1 +
      clientInvoices.length +
      dataset.allocations.filter(
        (a) =>
          a.confirmed &&
          known(a.knownAt, asOf, dataset.timezone) &&
          clientInvoices.some((i) => i.id === a.invoiceId),
      ).length +
      corrections.filter((c) =>
        clientInvoices.some((i) =>
          dataset.allocations.some((a) => a.invoiceId === i.id && a.receiptId === c.receiptId),
        ),
      ).length;
    return {
      id: `lesson:${client.id}:${asOf}:v${version}`,
      clientId: client.id,
      sampleSize: completed.length,
      window: 6,
      delayDays: rawMedianDays === null ? null : Math.max(0, rawMedianDays),
      rawMedianDays,
      sourceObservationIds: completed.flatMap((i) => i.observationIds),
      excludedObservationIds: clientInvoices
        .filter((i) => i.excluded)
        .flatMap((i) => i.observationIds),
      unresolvedCount: clientInvoices.filter((i) => units(i.outstanding) > 0n && i.dueDate < asOf)
        .length,
      calculatedAt: endOfDayTimestamp(asOf, dataset.timezone),
      algorithmVersion: ALGORITHM_VERSION,
      effectiveVersion: version,
      status: rawMedianDays === null ? 'insufficient-history' : 'learned',
    } as TimingLesson;
  });
  for (const invoice of invoices) {
    const lesson = lessons.find((l) => l.clientId === invoice.clientId)!;
    invoice.learnedDate =
      lesson.delayDays === null
        ? (invoice.planningDate ?? invoice.dueDate)
        : addDays(invoice.dueDate, lesson.delayDays);
    invoice.timingUnknown = units(invoice.outstanding) > 0n && invoice.learnedDate < asOf;
  }
  const obligations = dataset.obligations.filter((o) => known(o.knownAt, asOf, dataset.timezone));
  const paid = obligations.filter((o) => o.paidAt && localDay(o.paidAt, dataset.timezone) <= asOf);
  // Connected opening balances are exact snapshots. Old observations explain income but are
  // already included in physical cash. Fictional replay retains its chronological opening ledger.
  const cashReceipts = dataset.capturedAt
    ? validReceipts.filter((r) => Date.parse(r.occurredAt) > Date.parse(dataset.capturedAt!))
    : validReceipts.filter((r) => localDay(r.occurredAt, dataset.timezone) >= dataset.opening.date);
  const cashOutflows = dataset.capturedAt
    ? paid.filter((o) => Date.parse(o.paidAt!) > Date.parse(dataset.capturedAt!))
    : paid;
  const cash =
    units(dataset.opening.balance) +
    units(sum(cashReceipts.map((r) => r.amount))) -
    units(sum(cashOutflows.map((o) => o.amount)));
  return {
    asOf,
    cash: cash.toString(),
    expectedIncome: sum(invoices.map((i) => i.outstanding)),
    unpaidObligations: sum(
      obligations
        .filter((o) => !o.paidAt || localDay(o.paidAt, dataset.timezone) > asOf)
        .map((o) => o.amount),
    ),
    lessons,
    invoices,
    receipts: validReceipts,
    obligations,
    corrections,
    snapshotAt: dataset.capturedAt ?? endOfDayTimestamp(asOf, dataset.timezone),
  };
}

export function buildScenarios(dataset: Dataset, asOf: Day, purchase?: Purchase): Scenario[] {
  const evaluation = evaluateDataset(dataset, asOf);
  const through = addDays(asOf, dataset.horizonDays);
  if (purchase) {
    if (units(purchase.amount) < 0n) throw new Error('Purchase amount cannot be negative.');
    day(purchase.date);
    if (purchase.date < asOf || purchase.date > through)
      throw new Error('Purchase must be within the fixed forecast horizon.');
  }
  return (['promised', 'learned', 'none'] as const).map((id) => {
    let balance = units(evaluation.cash);
    const points: ScenarioPoint[] = [];
    const unknownInvoiceIds: string[] = [];
    const inflows = new Map<Day, bigint>();
    const outflows = new Map<Day, bigint>();
    if (id !== 'none')
      for (const invoice of evaluation.invoices) {
        if (units(invoice.outstanding) === 0n) continue;
        const date =
          id === 'promised' ? (invoice.planningDate ?? invoice.dueDate) : invoice.learnedDate!;
        if (date < asOf) {
          unknownInvoiceIds.push(invoice.id);
          continue;
        }
        if (date <= through)
          inflows.set(date, (inflows.get(date) ?? 0n) + units(invoice.outstanding));
      }
    for (const obligation of evaluation.obligations) {
      if (obligation.paidAt && localDay(obligation.paidAt, dataset.timezone) <= asOf) continue;
      const date = obligation.dueDate < asOf ? asOf : obligation.dueDate;
      if (date <= through)
        outflows.set(date, (outflows.get(date) ?? 0n) + units(obligation.amount));
    }
    if (purchase)
      outflows.set(purchase.date, (outflows.get(purchase.date) ?? 0n) + units(purchase.amount));
    for (let date = asOf; date <= through; date = addDays(date, 1)) {
      const inflow = inflows.get(date) ?? 0n;
      const outflow = outflows.get(date) ?? 0n;
      balance += inflow - outflow;
      points.push({
        date,
        balance: balance.toString(),
        inflow: inflow.toString(),
        outflow: outflow.toString(),
      });
    }
    const minimumPoint = points.reduce(
      (min, p) => (units(p.balance) < units(min.balance) ? p : min),
      points[0]!,
    );
    const breach = points.find((p) => units(p.balance) < units(dataset.buffer));
    const purchasePoints = points.filter((p) => p.date >= (purchase?.date ?? asOf));
    const purchaseMinimum = purchasePoints.reduce(
      (min, p) => (units(p.balance) < min ? units(p.balance) : min),
      units(purchasePoints[0]!.balance),
    );
    return {
      id,
      label:
        id === 'promised'
          ? 'Promised dates'
          : id === 'learned'
            ? 'Learned dates'
            : 'No further income',
      from: asOf,
      through,
      points,
      minimum: minimumPoint.balance,
      minimumDate: minimumPoint.date,
      purchaseMinimum: purchaseMinimum.toString(),
      purchaseShortfall: (purchaseMinimum < units(dataset.buffer)
        ? units(dataset.buffer) - purchaseMinimum
        : 0n
      ).toString(),
      unknownInvoiceIds,
      ...(breach
        ? {
            bufferBreach: {
              date: breach.date,
              balance: breach.balance,
              shortfall: (units(dataset.buffer) - units(breach.balance)).toString(),
            },
          }
        : {}),
    };
  });
}

export interface FrozenForecast {
  id: string;
  invoiceId: string;
  frozenAt: string;
  dueDate: Day;
  promisedDate: Day;
  learnedDate: Day;
  sourceObservationIds: string[];
  algorithmVersion: string;
}
export function freezeForecast(dataset: Dataset, invoiceId: string, asOf: Day): FrozenForecast {
  const evaluation = evaluateDataset(dataset, asOf);
  const invoice = evaluation.invoices.find((i) => i.id === invoiceId);
  if (!invoice) throw new Error('Payment was not known at freeze time.');
  if (invoice.status === 'settled')
    throw new Error('Payment outcome was already known at freeze time.');
  const lesson = evaluation.lessons.find((l) => l.clientId === invoice.clientId)!;
  return {
    id: `forecast:${invoiceId}:${asOf}`,
    invoiceId,
    // A day view includes fractional instants in its final second as well.
    frozenAt: new Date(Date.parse(endOfDayTimestamp(asOf, dataset.timezone)) + 999).toISOString(),
    dueDate: invoice.dueDate,
    promisedDate: invoice.planningDate ?? invoice.dueDate,
    learnedDate: invoice.learnedDate!,
    sourceObservationIds: [...lesson.sourceObservationIds],
    algorithmVersion: ALGORITHM_VERSION,
  };
}
/** Held-out authored outcomes are separate from the running sample dataset. Never read by forecasts. */
export const REPLAY_OUTCOMES = [
  { invoiceId: 'cedar-next', occurredAt: '2026-11-19T06:00:00Z', knownAt: '2026-11-19T06:00:00Z' },
  { invoiceId: 'cedar-dec', occurredAt: '2026-12-10T06:00:00Z', knownAt: '2026-12-10T06:00:00Z' },
] as const;
export function evaluateReplay(dataset: Dataset, revealedThrough: Day = '2026-12-31') {
  day(revealedThrough);
  validateDataset(dataset);
  const specifications = [
    { invoiceId: 'cedar-sep', asOf: '2026-09-01' },
    { invoiceId: 'cedar-oct', asOf: '2026-10-01' },
    { invoiceId: 'cedar-next', asOf: '2026-11-05' },
    { invoiceId: 'cedar-dec', asOf: '2026-12-01' },
    { invoiceId: 'paper-open', asOf: '2026-10-20' },
  ];
  type Specification = (typeof specifications)[number];
  type Outcome = (typeof REPLAY_OUTCOMES)[number];
  interface Boundary {
    invoices: Invoice[];
    receipts: Receipt[];
    allocations: Allocation[];
    obligations: Obligation[];
    corrections: Correction[];
    outcomes: Outcome[];
    freezes: Specification[];
  }
  const cutoff = Date.parse(endOfDayTimestamp(revealedThrough, dataset.timezone)) + 999;
  const boundaries = new Map<number, Boundary>();
  const boundaryAt = (instant: number): Boundary => {
    let boundary = boundaries.get(instant);
    if (!boundary) {
      boundary = {
        invoices: [],
        receipts: [],
        allocations: [],
        obligations: [],
        corrections: [],
        outcomes: [],
        freezes: [],
      };
      boundaries.set(instant, boundary);
    }
    return boundary;
  };
  const source = structuredClone(dataset);
  for (const collection of [
    'invoices',
    'receipts',
    'allocations',
    'obligations',
    'corrections',
  ] as const)
    for (const record of source[collection]) {
      const instant = Date.parse(record.knownAt);
      if (instant <= cutoff)
        // Each collection retains its own record type at this boundary.
        (boundaryAt(instant)[collection] as (typeof record)[]).push(record);
    }
  for (const outcome of REPLAY_OUTCOMES)
    if (Date.parse(outcome.knownAt) <= cutoff)
      boundaryAt(Date.parse(outcome.knownAt)).outcomes.push(outcome);
  for (const specification of specifications)
    if (specification.asOf <= revealedThrough)
      boundaryAt(
        Date.parse(endOfDayTimestamp(specification.asOf, dataset.timezone)) + 999,
      ).freezes.push(specification);
  let replayDataset: Dataset = {
    ...source,
    invoices: [],
    receipts: [],
    allocations: [],
    obligations: [],
    corrections: [],
  };
  const frozen: Array<Specification & { forecast: FrozenForecast }> = [];
  const excludedCases: Array<
    Specification & {
      reason: 'already-settled-at-freeze' | 'not-known-at-freeze' | 'before-workspace-opening';
    }
  > = [];
  // Replay policy: explicit records known at an instant arrive before that instant's authored
  // outcome. The fixture fills only capacity available then. Later explicit records cannot
  // retract an earlier outcome; incompatible histories fail at their reveal boundary.
  for (const [instant, boundary] of [...boundaries].sort(([a], [b]) => a - b)) {
    replayDataset.invoices.push(...boundary.invoices);
    replayDataset.receipts.push(...boundary.receipts);
    replayDataset.allocations.push(...boundary.allocations);
    replayDataset.obligations.push(...boundary.obligations);
    replayDataset.corrections.push(...boundary.corrections);
    try {
      validateDataset(replayDataset);
      for (const outcome of boundary.outcomes) {
        const invoice = replayDataset.invoices.find((i) => i.id === outcome.invoiceId);
        if (!invoice) continue;
        const remaining =
          units(invoice.amount) - invoiceReservedAt(replayDataset, invoice.id, instant);
        if (remaining <= 0n) continue;
        let receiptId = `heldout:${invoice.id}`;
        const usedIds = new Set(
          [
            replayDataset.clients,
            replayDataset.invoices,
            replayDataset.receipts,
            replayDataset.allocations,
            replayDataset.obligations,
            replayDataset.corrections,
          ].flatMap((records) => records.map((record) => record.id)),
        );
        while (
          usedIds.has(receiptId) ||
          usedIds.has(`allocation:${receiptId}`) ||
          replayDataset.receipts.some((r) => r.transferId === `fictional:${receiptId}:balance-0`)
        )
          receiptId += ':replay';
        const amount = remaining.toString();
        replayDataset = importReceipts(replayDataset, [
          {
            id: receiptId,
            transferId: `fictional:${receiptId}:balance-0`,
            digest: `fictional:${receiptId}`,
            amount,
            asset: USDC_SUI,
            recipient: dataset.walletAddress,
            status: 'success',
            occurredAt: outcome.occurredAt,
            knownAt: outcome.knownAt,
            provenance: 'fictional',
          },
        ]);
        replayDataset = allocateReceipt(replayDataset, {
          id: `allocation:${receiptId}`,
          receiptId,
          invoiceId: invoice.id,
          amount,
          confirmed: true,
          knownAt: outcome.knownAt,
        });
      }
    } catch (error) {
      throw new Error(
        `Replay conflict at ${new Date(instant).toISOString()}: ${error instanceof Error ? error.message : 'incompatible records'}`,
        { cause: error },
      );
    }
    for (const specification of boundary.freezes) {
      const firstDay = replayDataset.capturedAt
        ? localDay(replayDataset.capturedAt, replayDataset.timezone)
        : replayDataset.opening.date;
      if (specification.asOf < firstDay) {
        excludedCases.push({ ...specification, reason: 'before-workspace-opening' });
        continue;
      }
      const invoice = evaluateDataset(replayDataset, specification.asOf).invoices.find(
        (i) => i.id === specification.invoiceId,
      );
      if (!invoice || invoice.status === 'settled') {
        excludedCases.push({
          ...specification,
          reason: invoice ? 'already-settled-at-freeze' : 'not-known-at-freeze',
        });
        continue;
      }
      frozen.push({
        ...specification,
        forecast: freezeForecast(replayDataset, specification.invoiceId, specification.asOf),
      });
    }
  }
  const revealed = evaluateDataset(replayDataset, revealedThrough);
  const cases = frozen.flatMap((c) => {
    const invoice = revealed.invoices.find((i) => i.id === c.invoiceId);
    if (!invoice?.fullyPaidDate) return [];
    const actual = invoice.fullyPaidDate;
    return [
      {
        ...c,
        actual,
        knownAt: [
          ...replayDataset.receipts
            .filter((r) => invoice.observationIds.includes(r.id))
            .map((r) => r.knownAt),
          ...replayDataset.allocations
            .filter(
              (a) =>
                a.confirmed &&
                a.invoiceId === invoice.id &&
                invoice.observationIds.includes(a.receiptId),
            )
            .map((a) => a.knownAt),
          ...invoice.observationIds.flatMap((receiptId) => {
            const correction = activeCorrection(replayDataset, receiptId, revealedThrough);
            return correction ? [correction.knownAt] : [];
          }),
        ]
          .sort((a, b) => Date.parse(a) - Date.parse(b))
          .at(-1)!,
        forecast: c.forecast,
        promisedError: Math.abs(dateDifference(actual, c.forecast.promisedDate)),
        learnedError: Math.abs(dateDifference(actual, c.forecast.learnedDate)),
        provenance: 'fictional' as const,
      },
    ];
  });
  const unresolvedCases = frozen.filter(
    (c) => !cases.some((resolved) => resolved.invoiceId === c.invoiceId),
  );
  return {
    revealedThrough,
    sampleSize: cases.length,
    resolved: cases.length,
    unresolved: unresolvedCases.length,
    eligible: frozen.length,
    excluded: excludedCases.length,
    promisedMeanAbsoluteError: cases.length
      ? cases.reduce((s, c) => s + c.promisedError, 0) / cases.length
      : null,
    learnedMeanAbsoluteError: cases.length
      ? cases.reduce((s, c) => s + c.learnedError, 0) / cases.length
      : null,
    cases,
    unresolvedCases,
    excludedCases,
    eventPolicy:
      'Explicit records known at an instant precede its authored outcome. Authored outcomes fill only then-available capacity; later conflicts stop replay without rewriting earlier predictions.',
    limitation:
      'Authored fixture only. Only payments outstanding at freeze are eligible. Completed invoices exclude unresolved delays; this small sample cannot establish real-world accuracy.',
  };
}

export interface MemoryRecord {
  id: string;
  schemaVersion: 1;
  recordType: 'observation' | 'correction' | 'lesson' | 'dataset';
  datasetId: string;
  provenance: Provenance;
  occurredAt: string;
  knownAt: string;
  effectiveVersion: number;
  supersedesRecordId?: string;
  sourceObservationIds?: string[];
  algorithmVersion?: string;
  payload: unknown;
}
export interface ConfirmedMemory {
  record: MemoryRecord;
  state: 'confirmed' | 'pending' | 'failed';
  blobId?: string;
  verifiedAt?: string;
}
export interface MemoryManifest {
  schemaVersion: 1;
  datasetId: string;
  recordIds: string[];
}
export function createMemoryRecords(dataset: Dataset, asOf: Day = SAMPLE_AS_OF): MemoryRecord[] {
  const evaluation = evaluateDataset(dataset, asOf);
  const common = {
    schemaVersion: 1 as const,
    datasetId: dataset.id,
    provenance: 'fictional' as const,
    effectiveVersion: 1,
  };
  return [
    {
      ...common,
      id: `dataset:${dataset.id}`,
      recordType: 'dataset' as const,
      occurredAt: `${asOf}T00:00:00Z`,
      knownAt: `${asOf}T00:00:00Z`,
      payload: dataset,
    },
    ...evaluation.receipts.slice(-12).map((r) => ({
      ...common,
      id: `observation:${r.id}`,
      recordType: 'observation' as const,
      occurredAt: r.occurredAt,
      knownAt: r.knownAt,
      payload: r,
    })),
    ...evaluation.corrections.map((c) => ({
      ...common,
      id: c.id,
      recordType: 'correction' as const,
      occurredAt: c.occurredAt,
      knownAt: c.knownAt,
      effectiveVersion: c.effectiveVersion,
      supersedesRecordId: c.supersedesRecordId,
      payload: c,
    })),
    ...evaluation.lessons.map((l) => ({
      ...common,
      id: l.id,
      recordType: 'lesson' as const,
      occurredAt: l.calculatedAt,
      knownAt: l.calculatedAt,
      effectiveVersion: l.effectiveVersion,
      sourceObservationIds: l.sourceObservationIds,
      algorithmVersion: l.algorithmVersion,
      payload: l,
    })),
  ];
}
export function restoreMemory(
  memories: ConfirmedMemory[],
  manifest: MemoryManifest,
): { dataset: Dataset; lessons: TimingLesson[] } {
  if (
    !plainObject(manifest) ||
    manifest.schemaVersion !== 1 ||
    !Array.isArray(manifest.recordIds) ||
    !manifest.recordIds.length ||
    manifest.recordIds.length > 1000 ||
    new Set(manifest.recordIds).size !== manifest.recordIds.length
  )
    throw new Error('Invalid recovery manifest.');
  requiredString(manifest.datasetId, 'manifest dataset ID');
  for (const id of manifest.recordIds) requiredString(id, 'manifest record ID');
  if (!Array.isArray(memories)) throw new Error('Invalid retrieved memory set.');
  const confirmed = memories.filter(
    (m) => plainObject(m) && m.state === 'confirmed' && m.blobId && m.verifiedAt,
  );
  const records = manifest.recordIds.map((id) => {
    const matches = confirmed.filter((m) => plainObject(m.record) && m.record.id === id);
    if (matches.length !== 1)
      throw new Error(`Incomplete restore: ${id} is missing or duplicated.`);
    const memory = matches[0]!;
    requiredString(memory.blobId, 'confirmed blob ID');
    validateTimestamp(memory.verifiedAt);
    const record = memory.record;
    if (
      record.schemaVersion !== 1 ||
      record.datasetId !== manifest.datasetId ||
      !['observation', 'correction', 'lesson', 'dataset'].includes(record.recordType) ||
      !plainObject(record.payload)
    )
      throw new Error('Recovery record schema or dataset mismatch.');
    requiredString(record.id, 'memory record ID');
    provenance(record.provenance);
    validateTimestamp(record.occurredAt);
    validateTimestamp(record.knownAt);
    if (
      Date.parse(record.knownAt) < Date.parse(record.occurredAt) ||
      !Number.isSafeInteger(record.effectiveVersion) ||
      record.effectiveVersion < 1
    )
      throw new Error('Invalid memory version or knowledge time.');
    if (record.supersedesRecordId !== undefined)
      requiredString(record.supersedesRecordId, 'superseded record ID');
    return record;
  });
  const sources = records.filter((r) => r.recordType === 'dataset');
  if (sources.length !== 1)
    throw new Error('Recovery must have exactly one complete dataset record.');
  const source = sources[0]!;
  const dataset = structuredClone(source.payload) as Dataset;
  validateDataset(dataset);
  if (
    dataset.id !== manifest.datasetId ||
    source.id !== `dataset:${dataset.id}` ||
    source.provenance !== 'fictional'
  )
    throw new Error('Recovered dataset identity mismatch.');
  const lessonRecords = records.filter((r) => r.recordType === 'lesson');
  const latest = new Map<string, MemoryRecord>();
  for (const record of records) {
    if (record.recordType === 'observation') {
      const payload = record.payload as Receipt;
      const receipt = dataset.receipts.find((r) => r.id === payload.id);
      if (
        !receipt ||
        record.id !== `observation:${receipt.id}` ||
        record.provenance !== receipt.provenance ||
        record.occurredAt !== receipt.occurredAt ||
        record.knownAt !== receipt.knownAt ||
        JSON.stringify(payload) !== JSON.stringify(receipt)
      )
        throw new Error('Recovered observation envelope does not match its source.');
    }
    if (record.recordType === 'correction') {
      const payload = record.payload as Correction;
      const correction = dataset.corrections.find((c) => c.id === payload.id);
      if (
        !correction ||
        record.id !== correction.id ||
        record.effectiveVersion !== correction.effectiveVersion ||
        record.supersedesRecordId !== correction.supersedesRecordId ||
        record.occurredAt !== correction.occurredAt ||
        record.knownAt !== correction.knownAt ||
        JSON.stringify(payload) !== JSON.stringify(correction)
      )
        throw new Error('Recovered correction envelope does not match its source.');
    }
  }
  for (const record of lessonRecords) {
    const lesson = record.payload as TimingLesson;
    validateTimestamp(lesson.calculatedAt);
    if (
      record.id !== lesson.id ||
      record.effectiveVersion !== lesson.effectiveVersion ||
      record.knownAt !== lesson.calculatedAt ||
      record.occurredAt !== lesson.calculatedAt ||
      record.algorithmVersion !== lesson.algorithmVersion ||
      JSON.stringify(record.sourceObservationIds) !== JSON.stringify(lesson.sourceObservationIds) ||
      !dataset.clients.some((c) => c.id === lesson.clientId)
    )
      throw new Error('Recovered lesson envelope does not match its source.');
    const asOf = localDay(lesson.calculatedAt, dataset.timezone);
    const recomputed = evaluateDataset(dataset, asOf).lessons.find(
      (l) => l.clientId === lesson.clientId,
    );
    if (JSON.stringify(recomputed) !== JSON.stringify(lesson))
      throw new Error('Recovered lesson does not reproduce from source evidence.');
    const current = latest.get(lesson.clientId);
    if (
      current &&
      current.effectiveVersion === record.effectiveVersion &&
      current.knownAt === record.knownAt &&
      JSON.stringify(current.payload) !== JSON.stringify(record.payload)
    )
      throw new Error('Conflicting active lesson versions.');
    if (
      !current ||
      current.effectiveVersion < record.effectiveVersion ||
      (current.effectiveVersion === record.effectiveVersion &&
        Date.parse(current.knownAt) < Date.parse(record.knownAt))
    )
      latest.set(lesson.clientId, record);
  }
  const lessons = [...latest.values()].map((r) => r.payload as TimingLesson);
  if (lessons.length !== dataset.clients.length)
    throw new Error('Incomplete restore: active timing lessons missing.');
  return { dataset, lessons };
}
export function validateDataset(dataset: Dataset): void {
  if (
    !plainObject(dataset) ||
    dataset.schemaVersion !== 1 ||
    !Array.isArray(dataset.invoices) ||
    !Array.isArray(dataset.receipts) ||
    !Array.isArray(dataset.allocations) ||
    !Array.isArray(dataset.obligations) ||
    !Array.isArray(dataset.corrections) ||
    !Array.isArray(dataset.clients)
  )
    throw new Error('Unsupported dataset schema.');
  requiredString(dataset.id, 'dataset ID');
  requiredString(dataset.walletAddress, 'wallet address');
  requiredString(dataset.timezone, 'timezone');
  if (dataset.currency !== 'USDC') throw new Error('Unsupported planning currency.');
  try {
    new Intl.DateTimeFormat('en', { timeZone: dataset.timezone }).format(0);
  } catch {
    throw new Error('Invalid timezone.');
  }
  if (!plainObject(dataset.opening)) throw new Error('Missing opening ledger balance.');
  day(dataset.opening.date);
  units(dataset.opening.balance);
  positiveAmount(dataset.buffer, 'cash buffer', true);
  if (!Number.isInteger(dataset.horizonDays) || dataset.horizonDays !== 30)
    throw new Error('Invalid buffer or horizon.');
  if (dataset.capturedAt !== undefined) {
    validateTimestamp(dataset.capturedAt);
    if (
      dataset.opening.date !== localDay(dataset.capturedAt, dataset.timezone) ||
      units(dataset.opening.balance) < 0n
    )
      throw new Error('Connected opening balance must match its nonnegative captured snapshot.');
  }
  const ids = new Set<string>();
  for (const collection of [
    dataset.clients,
    dataset.invoices,
    dataset.receipts,
    dataset.allocations,
    dataset.obligations,
    dataset.corrections,
  ]) {
    if (collection.length > 5000) throw new Error('Dataset exceeds local record limit.');
    for (const entity of collection) {
      if (!plainObject(entity)) throw new Error('Malformed dataset entity.');
      requiredString(entity.id, 'record ID');
      if (ids.has(entity.id)) throw new Error('Duplicate record ID.');
      ids.add(entity.id);
    }
  }
  for (const client of dataset.clients) requiredString(client.alias, 'client alias', 120);
  const transferIds = new Set<string>();
  for (const receipt of dataset.receipts) {
    positiveAmount(receipt.amount, 'receipt amount');
    requiredString(receipt.asset, 'asset');
    requiredString(receipt.recipient, 'recipient');
    requiredString(receipt.transferId, 'transfer identity');
    requiredString(receipt.digest, 'transaction digest');
    provenance(receipt.provenance);
    validateReceipt(receipt, dataset.walletAddress);
    if (transferIds.has(receipt.transferId)) throw new Error('Duplicate transfer identity.');
    transferIds.add(receipt.transferId);
    validateTimestamp(receipt.occurredAt);
    validateTimestamp(receipt.knownAt);
    if (Date.parse(receipt.knownAt) < Date.parse(receipt.occurredAt))
      throw new Error('Receipt is known before it occurred.');
    if (
      !dataset.capturedAt &&
      localDay(receipt.occurredAt, dataset.timezone) < dataset.opening.date
    )
      throw new Error('Receipt precedes the opening ledger.');
  }
  for (const invoice of dataset.invoices) {
    day(invoice.dueDate);
    if (invoice.planningDate !== undefined) day(invoice.planningDate);
    positiveAmount(invoice.amount, 'expected payment amount');
    validateTimestamp(invoice.knownAt);
    provenance(invoice.provenance);
    if (invoice.note !== undefined && typeof invoice.note !== 'string')
      throw new Error('Invalid payment note.');
    if (!dataset.clients.some((c) => c.id === invoice.clientId)) throw new Error('Unknown client.');
  }
  for (const allocation of dataset.allocations) {
    positiveAmount(allocation.amount, 'allocation amount');
    validateTimestamp(allocation.knownAt);
    if (typeof allocation.confirmed !== 'boolean')
      throw new Error('Allocation requires confirmation state.');
    const receipt = dataset.receipts.find((r) => r.id === allocation.receiptId);
    const invoice = dataset.invoices.find((i) => i.id === allocation.invoiceId);
    if (!receipt || !invoice) throw new Error('Invalid allocation references.');
    if (
      Date.parse(allocation.knownAt) <
      Math.max(Date.parse(receipt.knownAt), Date.parse(invoice.knownAt))
    )
      throw new Error('Allocation is known before its source records.');
  }
  for (const receipt of dataset.receipts)
    if (
      units(
        sum(dataset.allocations.filter((a) => a.receiptId === receipt.id).map((a) => a.amount)),
      ) > units(receipt.amount)
    )
      throw new Error('Receipt over-allocated.');
  for (const obligation of dataset.obligations) {
    requiredString(obligation.name, 'obligation name', 160);
    day(obligation.dueDate);
    positiveAmount(obligation.amount, 'obligation amount', true);
    validateTimestamp(obligation.knownAt);
    provenance(obligation.provenance);
    if (obligation.paidAt !== undefined) {
      validateTimestamp(obligation.paidAt);
      if (Date.parse(obligation.paidAt) < Date.parse(obligation.knownAt))
        throw new Error('Obligation payment precedes knowledge of the obligation.');
      if (
        !dataset.capturedAt &&
        localDay(obligation.paidAt, dataset.timezone) < dataset.opening.date
      )
        throw new Error('Obligation payment precedes the opening ledger.');
    }
  }
  const chains = new Map<string, Correction[]>();
  for (const correction of dataset.corrections) {
    const receipt = dataset.receipts.find((r) => r.id === correction.receiptId);
    if (!receipt) throw new Error('Correction references unknown receipt.');
    if (!['reimbursement', 'exceptional', 'include'].includes(correction.kind))
      throw new Error('Invalid correction kind.');
    requiredString(correction.reason, 'correction reason', 2000);
    validateTimestamp(correction.occurredAt);
    validateTimestamp(correction.knownAt);
    if (
      Date.parse(correction.knownAt) < Date.parse(correction.occurredAt) ||
      Date.parse(correction.knownAt) < Date.parse(receipt.knownAt)
    )
      throw new Error('Correction is known before its source.');
    if (!Number.isSafeInteger(correction.effectiveVersion) || correction.effectiveVersion < 1)
      throw new Error('Invalid correction version.');
    chains.set(receipt.id, [...(chains.get(receipt.id) ?? []), correction]);
  }
  for (const chain of chains.values()) {
    chain.sort((a, b) => a.effectiveVersion - b.effectiveVersion);
    for (let index = 0; index < chain.length; index++) {
      const correction = chain[index]!;
      const previous = chain[index - 1];
      if (
        correction.effectiveVersion !== index + 1 ||
        correction.supersedesRecordId !== previous?.id
      )
        throw new Error('Broken correction version chain.');
      if (previous && Date.parse(correction.knownAt) < Date.parse(previous.knownAt))
        throw new Error('Correction version precedes prior knowledge.');
    }
  }
  validateInvoiceCapacityHistory(dataset);
  if (dataset.capturedAt !== undefined) validateTimestamp(dataset.capturedAt);
}

export function createSampleDataset(): Dataset {
  const dataset: Dataset = {
    id: 'payday-memory-fictional-v1',
    schemaVersion: 1,
    timezone: 'Asia/Kolkata',
    currency: 'USDC',
    buffer: money('300'),
    horizonDays: 30,
    walletAddress: 'fictional-wallet',
    opening: { date: '2026-05-01', balance: money('1250') },
    clients: [
      { id: 'aster', alias: 'Aster Studio' },
      { id: 'cedar', alias: 'Cedar Works' },
      { id: 'paper', alias: 'Paper Lane' },
    ],
    invoices: [],
    receipts: [],
    allocations: [],
    obligations: [],
    corrections: [],
  };
  const addInvoice = (
    id: string,
    clientId: string,
    amount: string,
    dueDate: Day,
    delay?: number,
    partial = false,
  ) => {
    const knownAt = addDays(dueDate, -20) + 'T06:00:00Z';
    dataset.invoices.push({
      id,
      clientId,
      amount: money(amount),
      dueDate,
      knownAt,
      provenance: 'fictional',
    });
    if (delay === undefined) return;
    const settled = addDays(dueDate, delay);
    const receipts = partial
      ? [
          { suffix: 'a', date: addDays(settled, -3), amount: money('700') },
          {
            suffix: 'b',
            date: settled,
            amount: (units(money(amount)) - units(money('700'))).toString(),
          },
        ]
      : [{ suffix: 'full', date: settled, amount: money(amount) }];
    for (const item of receipts) {
      const receiptId = `receipt:${id}:${item.suffix}`;
      const timestamp = item.date + 'T06:00:00Z';
      dataset.receipts.push({
        id: receiptId,
        transferId: `fictional:${id}:${item.suffix}:balance-0`,
        digest: `fictional:${id}:${item.suffix}`,
        amount: item.amount,
        asset: USDC_SUI,
        recipient: dataset.walletAddress,
        status: 'success',
        occurredAt: timestamp,
        knownAt: timestamp,
        provenance: 'fictional',
      });
      dataset.allocations.push({
        id: `allocation:${id}:${item.suffix}`,
        receiptId,
        invoiceId: id,
        amount: item.amount,
        confirmed: true,
        knownAt: timestamp,
      });
    }
  };
  const months = ['may', 'jun', 'jul', 'aug', 'sep', 'oct'];
  [7, 8, 9, 8, 7, 8].forEach((delay, index) =>
    addInvoice(
      `cedar-${months[index]}`,
      'cedar',
      '1800',
      `2026-${String(index + 5).padStart(2, '0')}-10`,
      delay,
      index === 4,
    ),
  );
  [0, 1, -1, 0].forEach((delay, index) =>
    addInvoice(
      `aster-${months[index + 2]}`,
      'aster',
      '500',
      `2026-${String(index + 7).padStart(2, '0')}-12`,
      delay,
    ),
  );
  [0, 10, 1].forEach((delay, index) =>
    addInvoice(
      `paper-${months[index + 3]}`,
      'paper',
      '400',
      `2026-${String(index + 8).padStart(2, '0')}-15`,
      delay,
    ),
  );
  addInvoice('cedar-next', 'cedar', '1800', '2026-11-10');
  addInvoice('aster-next', 'aster', '650', '2026-11-21');
  addInvoice('paper-open', 'paper', '300', '2026-10-25');
  addInvoice('cedar-dec', 'cedar', '1800', '2026-12-10');
  for (let index = 0; index < 6; index++) {
    const date = `2026-${String(index + 5).padStart(2, '0')}-${index === 5 ? '30' : '25'}`;
    dataset.obligations.push({
      id: `historic-living-${index}`,
      name: 'Historical living expenses',
      amount: money(index < 4 ? '2300' : '2400'),
      dueDate: date,
      knownAt: '2026-05-01T00:00:00Z',
      paidAt: date + 'T07:00:00Z',
      provenance: 'fictional',
    });
  }
  for (const [id, name, amount, date] of [
    ['groceries-1', 'Groceries', '85', '2026-11-07'],
    ['rent', 'Rent', '1100', '2026-11-12'],
    ['utilities', 'Utilities', '120', '2026-11-15'],
    ['groceries-2', 'Groceries', '95', '2026-11-22'],
    ['internet', 'Internet', '45', '2026-11-26'],
    ['groceries-3', 'Groceries', '90', '2026-11-29'],
  ] as const)
    dataset.obligations.push({
      id,
      name,
      amount: money(amount),
      dueDate: date,
      knownAt: '2026-11-01T06:00:00Z',
      provenance: 'fictional',
    });
  validateDataset(dataset);
  return dataset;
}
