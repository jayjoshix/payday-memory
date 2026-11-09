import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ArrowCounterClockwise,
  CalendarBlank,
  CaretRight,
  ChartLineUp,
  Check,
  CheckCircle,
  Clock,
  Coins,
  Database,
  DownloadSimple,
  Fingerprint,
  Info,
  Plus,
  ShieldCheck,
  Sparkle,
  Wallet,
  WarningCircle,
  X,
} from '@phosphor-icons/react';
import {
  addDays,
  allocateReceipt,
  appendCorrection,
  buildScenarios,
  createSampleDataset,
  evaluateDataset,
  endOfDayTimestamp,
  evaluateReplay,
  formatMoney,
  importReceipts,
  localDay,
  money,
  USDC_SUI,
  validateDataset,
  type Dataset,
  type Receipt,
  type Scenario,
} from '../domain/index';
import { CashChart, shortDate } from './Chart';
import { ConnectedPreview } from './ConnectedPreview';
import { datasetFromRecoveryCapture, type CapturedRecoveryProof } from '../recovery-capture';
import { createExceptionalDelayExample } from '../demo-examples';

type Screen = 'overview' | 'payments' | 'timeline' | 'memory';
const STORAGE = 'payday-memory:disposable-demo:v1';
const SAMPLE_REPLAY_FROM = '2026-09-01';
const SAMPLE_REPLAY_THROUGH = '2026-11-05';
function replayBounds(dataset: Dataset) {
  if (dataset.capturedAt) {
    const capturedDay = localDay(dataset.capturedAt, dataset.timezone);
    return { from: capturedDay, through: capturedDay };
  }
  const from =
    dataset.opening.date > SAMPLE_REPLAY_FROM ? dataset.opening.date : SAMPLE_REPLAY_FROM;
  return { from, through: from > SAMPLE_REPLAY_THROUGH ? from : SAMPLE_REPLAY_THROUGH };
}
function clampReplayDate(dataset: Dataset, date: string) {
  const { from, through } = replayBounds(dataset);
  return date < from ? from : date > through ? through : date;
}
const screens = [
  { id: 'overview', name: 'Overview', icon: Wallet },
  { id: 'payments', name: 'Expected payments', icon: ArrowDownLeft },
  { id: 'timeline', name: 'Cash-flow timeline', icon: ChartLineUp },
  { id: 'memory', name: 'Memory & evidence', icon: Fingerprint },
] as const;
function initialState(): { dataset: Dataset; error: string } {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return { dataset: createSampleDataset(), error: '' };
    const saved = JSON.parse(raw) as Dataset;
    validateDataset(saved);
    return { dataset: saved, error: '' };
  } catch {
    return {
      dataset: createSampleDataset(),
      error:
        'Your saved sample could not be read. A temporary sample is open; choose New sample to replace the damaged local copy.',
    };
  }
}
const decimal = (base: string) => {
  const amount = BigInt(base);
  const absolute = amount < 0n ? -amount : amount;
  const fraction = (absolute % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${amount < 0n ? '-' : ''}${absolute / 1_000_000n}${fraction ? '.' + fraction : ''}`;
};
function Tag({ children, tone = '' }: { children: ReactNode; tone?: string }) {
  return <span className={`tag ${tone}`}>{children}</span>;
}
function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="empty">
      <Database size={28} />
      <p>{children}</p>
    </div>
  );
}
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [initial] = useState(initialState);
  const [dataset, setDataset] = useState(initial.dataset);
  const [error, setError] = useState(initial.error);
  const [recoveryBlocked, setRecoveryBlocked] = useState(Boolean(initial.error));
  const [notice, setNotice] = useState('');
  const [screen, setScreen] = useState<Screen>('overview');
  const [asOf, setAsOf] = useState(() => clampReplayDate(initial.dataset, SAMPLE_REPLAY_THROUGH));
  const [purchaseAmount, setPurchaseAmount] = useState('240');
  const [purchaseDate, setPurchaseDate] = useState('2026-11-08');
  const [usePurchase, setUsePurchase] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingReceipt, setAddingReceipt] = useState(false);
  const [correcting, setCorrecting] = useState<Receipt | null>(null);
  const [matching, setMatching] = useState<Receipt | null>(null);
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const [evidenceState, setEvidenceState] = useState('Loading captured integration status…');
  const [recoveryPath, setRecoveryPath] = useState('./recovered-sample.json');
  const [loadingRecovery, setLoadingRecovery] = useState(false);
  const replayRange = replayBounds(dataset);
  const evaluation = useMemo(() => evaluateDataset(dataset, asOf), [dataset, asOf]);
  const purchase = useMemo(() => {
    try {
      const amount = money(purchaseAmount);
      return BigInt(amount) >= 0n && purchaseDate >= asOf && purchaseDate <= addDays(asOf, 30)
        ? { amount, date: purchaseDate }
        : undefined;
    } catch {
      return undefined;
    }
  }, [purchaseAmount, purchaseDate, asOf]);
  const scenarios = useMemo(
    () => buildScenarios(dataset, asOf, usePurchase ? purchase : undefined),
    [dataset, asOf, usePurchase, purchase],
  );
  const learned = scenarios[1]!;
  const cedar = evaluation.lessons.find((l) => l.clientId === 'cedar') ?? {
    delayDays: null,
    sampleSize: 0,
  };
  const upcoming = evaluation.invoices.filter((i) => BigInt(i.outstanding) > 0n);
  const obligations = evaluation.obligations
    .filter((o) => !o.paidAt || o.paidAt.slice(0, 10) > asOf)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const isConnected = dataset.id.startsWith('connected:');
  const replay = useMemo(() => evaluateReplay(createSampleDataset()), []);
  const memoryEvidence = evidence?.memory as
    | (CapturedRecoveryProof & {
        confirmedCount?: number;
        recoveryStatus?: string;
        retentionAssessment?: { status?: string; requiredThrough?: string };
      })
    | undefined;
  const tatumEvidence = evidence?.tatum as
    { status?: string; balanceSnapshot?: { observedAt: string; stale?: boolean } } | undefined;
  const connectedSnapshotStale = Boolean(
    dataset.capturedAt &&
    (Date.now() - Date.parse(dataset.capturedAt) > 15 * 60_000 ||
      (tatumEvidence?.balanceSnapshot?.observedAt === dataset.capturedAt &&
        (tatumEvidence.status === 'stale' || tatumEvidence.balanceSnapshot.stale))),
  );
  const alias = (clientId: string) =>
    dataset.clients.find((c) => c.id === clientId)?.alias ?? clientId;
  function update(next: Dataset, message: string, allowRestore = false) {
    if (recoveryBlocked && !allowRestore) {
      setError(
        'The unreadable saved copy was preserved. Choose New sample or restore a valid local export before saving edits.',
      );
      return false;
    }
    try {
      validateDataset(next);
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setDataset(next);
      const nextAsOf = clampReplayDate(next, asOf);
      setAsOf(nextAsOf);
      if (nextAsOf !== asOf) {
        setPurchaseDate(addDays(nextAsOf, 3));
        setUsePurchase(false);
      }
      setError('');
      setRecoveryBlocked(false);
      setNotice(message);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Your changes could not be saved.');
      return false;
    }
  }
  function reset() {
    const next = createSampleDataset();
    try {
      localStorage.setItem(STORAGE, JSON.stringify(next));
      setDataset(next);
      setAsOf('2026-11-05');
      setError('');
      setRecoveryBlocked(false);
      setUsePurchase(false);
      setNotice('A fresh fictional sample is ready. Published memory is untouched.');
    } catch {
      setError('Browser storage is unavailable. Your current sample remains open.');
    }
  }
  async function loadCapturedRecovery() {
    setLoadingRecovery(true);
    try {
      const response = await fetch(recoveryPath);
      if (!response.ok)
        throw new Error('The captured recovery is unavailable. Your sample is intact.');
      const text = await response.text();
      if (text.length > 512000)
        throw new Error('The captured recovery is too large. Your sample is intact.');
      const recovered = await datasetFromRecoveryCapture(JSON.parse(text), memoryEvidence ?? {});
      update(
        recovered,
        'Captured Mainnet recovery loaded into this disposable sample. No new sponsor request was made.',
        true,
      );
      setScreen('memory');
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'The captured recovery could not be loaded.',
      );
    } finally {
      setLoadingRecovery(false);
    }
  }
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const runtimeResponse = await fetch('./runtime.json');
        const runtime = runtimeResponse.ok
          ? ((await runtimeResponse.json()) as { mode?: string })
          : {};
        if (active)
          setRecoveryPath(
            runtime.mode === 'local-operator'
              ? './api/recovery-capture'
              : './recovered-sample.json',
          );
        const response = await fetch(
          runtime.mode === 'local-operator' ? './api/evidence' : './evidence.json',
        );
        if (!response.ok) throw new Error();
        const data = (await response.json()) as Record<string, unknown>;
        if (active) {
          setEvidence(data);
          setEvidenceState('Captured status, not a live sponsor request');
        }
      } catch {
        if (active) setEvidenceState('Offline replay. No confirmed sponsor evidence is available.');
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 7000);
    return () => clearTimeout(timer);
  }, [notice]);
  const panelHeader = (eyebrow: string, title: string, extra?: ReactNode) => (
    <div className="panel-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      {extra}
    </div>
  );
  const purchaseControl = (
    <section className="purchase card">
      <div className="purchase-copy">
        <div className="icon-box">
          <Coins size={22} />
        </div>
        <div>
          <h2>A little room for something extra?</h2>
          <p>Try a purchase. See what it leaves for the next 30 days.</p>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (purchase) {
            setUsePurchase(true);
            setNotice('Purchase preview applied to all three scenarios. No money moved.');
          }
        }}
      >
        <label>
          Purchase amount, USDC
          <div className="money-input">
            <span>$</span>
            <input
              aria-label="Purchase amount"
              inputMode="decimal"
              value={purchaseAmount}
              onChange={(e) => {
                setPurchaseAmount(e.target.value);
                setUsePurchase(false);
              }}
            />
          </div>
        </label>
        <label>
          Purchase date
          <input
            aria-label="Purchase date"
            type="date"
            min={asOf}
            max={addDays(asOf, 30)}
            value={purchaseDate}
            onChange={(e) => {
              setPurchaseDate(e.target.value);
              setUsePurchase(false);
            }}
          />
        </label>
        <button className="primary" disabled={!purchase} type="submit">
          Preview purchase <ArrowRight size={17} />
        </button>
        {usePurchase && (
          <button
            type="button"
            className="icon-button"
            aria-label="Remove purchase preview"
            onClick={() => setUsePurchase(false)}
          >
            <X />
          </button>
        )}
      </form>
      {!purchase && (
        <p className="form-error">Enter a positive amount and a date inside the 30 day horizon.</p>
      )}
      {usePurchase && (
        <div className="purchase-results">
          {scenarios.map((s) => (
            <div key={s.id}>
              <span>{s.label}</span>
              <strong className={BigInt(s.purchaseShortfall) > 0n ? 'text-amber' : 'text-green'}>
                {BigInt(s.purchaseShortfall) > 0n
                  ? `${formatMoney(s.purchaseShortfall)} below buffer`
                  : 'Buffer covered'}
              </strong>
              <small>Lowest cash: {formatMoney(s.purchaseMinimum)}</small>
            </div>
          ))}
        </div>
      )}
    </section>
  );
  const forecast = (
    <section className="card forecast">
      {panelHeader(
        'THE NEXT 30 DAYS',
        'Same money. A different arrival date.',
        <Tag>
          <span className="dot" />
          {shortDate(asOf)} – {shortDate(addDays(asOf, 30))}
        </Tag>,
      )}
      <CashChart scenarios={scenarios} buffer={dataset.buffer} />
      <div className="forecast-foot">
        <Info size={17} />
        <span>
          {usePurchase
            ? `Includes your ${formatMoney(purchase!.amount)} purchase on ${shortDate(purchase!.date)}. `
            : ''}
          Unpaid overdue income with unknown timing is excluded. Same horizon and bills in every
          scenario.
        </span>
      </div>
    </section>
  );

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        Skip to planner
      </a>
      <aside className="sidebar">
        <a className="brand" href="#overview" onClick={() => setScreen('overview')}>
          <img src={import.meta.env.BASE_URL + 'mark.svg'} alt="" width="36" height="36" />
          <span>
            payday<span className="brand-memory">memory</span>
          </span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav aria-label="Planner">
          {screens.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={`nav-item ${screen === id ? 'active' : ''}`}
              aria-current={screen === id ? 'page' : undefined}
              onClick={() => setScreen(id)}
            >
              <Icon size={21} weight={screen === id ? 'fill' : 'regular'} />
              <span>{name}</span>
              {screen === id && <span className="nav-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <Sparkle size={23} />
          <h3>A little more foresight.</h3>
          <p>Your past paydays can help you make room for what comes next.</p>
          <button onClick={() => setScreen('memory')}>
            See how memory works <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="profile">
          <span className="avatar">JD</span>
          <div>
            <strong>Jamie’s sample</strong>
            <small>Fictional personal workspace</small>
          </div>
          <ShieldCheck size={18} />
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Personal planner <CaretRight size={13} />
            <strong>{screens.find((s) => s.id === screen)?.name}</strong>
          </div>
          <div className="topbar-actions">
            <Tag tone="sample">
              <span className="dot" />
              Local replay
            </Tag>
            <button className="quiet small" onClick={reset} aria-label="New sample">
              <ArrowCounterClockwise size={16} />
              <span>New sample</span>
            </button>
          </div>
        </header>
        <main id="main">
          <div className="fiction-banner">
            <span>
              <span className="tiny-spark">✦</span>{' '}
              {isConnected
                ? `Captured public chain observations from ${dataset.capturedAt}. ${connectedSnapshotStale ? 'Stale snapshot.' : 'Timestamped snapshot, not a live balance.'} All planning assumptions are hypothetical.`
                : 'A sample you can make your own. All payment history is fictional.'}
            </span>
            <button
              onClick={() => {
                setScreen('timeline');
                setUsePurchase(Boolean(purchase));
              }}
            >
              Try the sample <ArrowRight size={15} />
            </button>
          </div>
          {error && (
            <div className="alert error" role="alert">
              <WarningCircle size={20} />
              {error}
              <button className="quiet" onClick={() => setError('')}>
                Dismiss
              </button>
            </div>
          )}
          {notice && (
            <div
              className={`toast ${notice.startsWith('Mainnet restore') ? 'warning' : ''}`}
              role="status"
            >
              {notice.startsWith('Mainnet restore') ? (
                <WarningCircle size={20} />
              ) : (
                <CheckCircle size={20} />
              )}
              {notice}
            </div>
          )}
          <div className="page-heading">
            <div>
              <p className="eyebrow">
                {screen === 'overview'
                  ? 'MAKE SPACE FOR WHAT MATTERS'
                  : screen === 'payments'
                    ? 'KNOW WHAT IS ON ITS WAY'
                    : screen === 'timeline'
                      ? 'LOOK A LITTLE FURTHER'
                      : 'THE REASON BEHIND THE FORECAST'}
              </p>
              <h1>
                {screen === 'overview'
                  ? 'Your next payday, in perspective.'
                  : screen === 'payments'
                    ? 'Expected doesn’t mean in your pocket.'
                    : screen === 'timeline'
                      ? 'A clearer view of the days ahead.'
                      : 'Every lesson has a paper trail.'}
              </h1>
              <p>
                {screen === 'overview'
                  ? 'Plan around when money arrives, with a little help from memory.'
                  : screen === 'payments'
                    ? 'Keep promises, actual receipts and your own assumptions separate.'
                    : screen === 'timeline'
                      ? 'Compare the promise, the pattern and a plan with no more income.'
                      : 'Inspect the observations. Correct the story. Keep the history.'}
              </p>
            </div>
            {screen === 'payments' ? (
              <button className="primary" onClick={() => setAdding(true)}>
                <Plus size={18} />
                Expected payment
              </button>
            ) : (
              <div className="date-chip">
                <CalendarBlank size={17} />
                <span>
                  {shortDate(asOf)}, {asOf.slice(0, 4)}
                  <small>{dataset.timezone} · replay date</small>
                </span>
              </div>
            )}
          </div>

          {screen === 'overview' && (
            <>
              <section className="balance-strip">
                <div className="current-cash">
                  <span className="metric-label">
                    <span className="dot" />
                    Cash you have
                  </span>
                  <strong>
                    {formatMoney(evaluation.cash)}
                    <small>USDC</small>
                  </strong>
                  <span className="metric-foot">
                    {isConnected
                      ? `${connectedSnapshotStale ? 'Stale' : 'Captured'} chain snapshot · hypothetical plan`
                      : 'Fictional balance as of ' + shortDate(asOf)}
                  </span>
                </div>
                <div>
                  <span className="metric-label">Expected, not received</span>
                  <strong>
                    {formatMoney(evaluation.expectedIncome)}
                    <ArrowDownLeft size={20} />
                  </strong>
                  <span className="metric-foot">
                    {upcoming.length} open payments · timing varies
                  </span>
                </div>
                <div>
                  <span className="metric-label">Upcoming bills</span>
                  <strong>{formatMoney(evaluation.unpaidObligations)}</strong>
                  <span className="metric-foot">
                    Your buffer stays separate: {formatMoney(dataset.buffer, 0)}
                  </span>
                </div>
              </section>
              <div className="overview-grid">
                <div className="primary-column">
                  {forecast}
                  <section className="memory-callout">
                    <div className="memory-symbol">
                      <Fingerprint size={29} />
                    </div>
                    <div>
                      <span className="eyebrow">A PATTERN WORTH PLANNING FOR</span>
                      <h2>
                        {cedar.delayDays === null
                          ? 'This workspace needs more completed observations.'
                          : alias('cedar') +
                            ' tends to arrive ' +
                            cedar.delayDays +
                            ' days after the due date.'}
                      </h2>
                      <p>
                        {cedar.sampleSize} completed payments inform this lesson. Rent is due before
                        the next learned arrival, so your cash may dip below your buffer on{' '}
                        {shortDate(learned.bufferBreach?.date ?? learned.minimumDate)}.
                      </p>
                      <button onClick={() => setScreen('memory')}>
                        Why did this change? <ArrowRight size={17} />
                      </button>
                    </div>
                  </section>
                </div>
                <aside className="up-next card">
                  {panelHeader('ON YOUR CALENDAR', 'Coming up next', <CalendarBlank size={21} />)}
                  <div className="calendar-list">
                    {[
                      ...obligations.map((o) => ({
                        id: o.id,
                        name: o.name,
                        date: o.dueDate,
                        amount: o.amount,
                        income: false,
                      })),
                      ...upcoming
                        .filter((i) => i.dueDate >= asOf)
                        .map((i) => ({
                          id: i.id,
                          name: alias(i.clientId),
                          date: i.learnedDate!,
                          amount: i.outstanding,
                          income: true,
                        })),
                    ]
                      .sort((a, b) => a.date.localeCompare(b.date))
                      .slice(0, 6)
                      .map((item) => (
                        <div className="calendar-item" key={item.id}>
                          <span className={`event-icon ${item.income ? 'income' : ''}`}>
                            {item.income ? <ArrowDownLeft size={19} /> : <ArrowUpRight size={19} />}
                          </span>
                          <div>
                            <strong>{item.name}</strong>
                            <small>
                              {shortDate(item.date)}
                              {item.income ? ' · learned arrival' : ' · bill due'}
                            </small>
                          </div>
                          <b>
                            {item.income ? '+' : '−'}
                            {formatMoney(item.amount, 0)}
                          </b>
                        </div>
                      ))}
                  </div>
                  <div className="buffer-note">
                    <ShieldCheck size={22} />
                    <div>
                      <strong>A {formatMoney(dataset.buffer, 0)} breathing room buffer</strong>
                      <p>A planning preference, separate from money committed to bills.</p>
                    </div>
                  </div>
                  <button className="text-button" onClick={() => setScreen('payments')}>
                    View expected payments <ArrowRight size={17} />
                  </button>
                </aside>
              </div>
              {purchaseControl}
            </>
          )}

          {screen === 'payments' && (
            <>
              <section className="card payments-card">
                {panelHeader(
                  'EXPECTED PAYMENTS',
                  'Promises and outstanding amounts',
                  <Tag>{upcoming.length} open</Tag>,
                )}
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Client / purpose</th>
                        <th>Amount</th>
                        <th>Promised</th>
                        <th>Planning date</th>
                        <th>Received / outstanding</th>
                        <th>Status & source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evaluation.invoices
                        .slice()
                        .sort((a, b) => b.dueDate.localeCompare(a.dueDate))
                        .map((invoice) => (
                          <tr key={invoice.id}>
                            <td>
                              <strong>{alias(invoice.clientId)}</strong>
                              <small>{invoice.note ?? invoice.id}</small>
                            </td>
                            <td>{formatMoney(invoice.amount)}</td>
                            <td>{shortDate(invoice.dueDate)}</td>
                            <td>
                              {invoice.status === 'settled'
                                ? 'Settled ' + shortDate(invoice.fullyPaidDate!)
                                : invoice.timingUnknown
                                  ? 'Timing unknown'
                                  : shortDate(invoice.learnedDate!)}
                            </td>
                            <td>
                              {formatMoney(invoice.received)}
                              <small>{formatMoney(invoice.outstanding)} still open</small>
                            </td>
                            <td>
                              <Tag
                                tone={
                                  invoice.status === 'settled'
                                    ? 'green'
                                    : invoice.status === 'overdue'
                                      ? 'amber'
                                      : ''
                                }
                              >
                                {invoice.status}
                              </Tag>
                              <small>{invoice.provenance}</small>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </section>
              <section className="card">
                {panelHeader(
                  'RECEIPTS',
                  'What actually arrived',
                  <button
                    className="quiet small"
                    disabled={isConnected}
                    onClick={() => setAddingReceipt(true)}
                  >
                    <Plus size={16} />
                    Add sample receipt
                  </button>,
                )}
                <Tag tone="sample">
                  {isConnected
                    ? 'Captured chain observations'
                    : 'Fictional transaction observations'}
                </Tag>
                <p className="section-note">
                  Matching is your assertion about a payment’s purpose. It never proves the client’s
                  identity.
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Received</th>
                        <th>Amount</th>
                        <th>Matched payment</th>
                        <th>Source</th>
                        <th>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {evaluation.receipts
                        .slice()
                        .reverse()
                        .map((receipt) => {
                          const allocation = dataset.allocations.find(
                            (a) => a.receiptId === receipt.id,
                          );
                          const correction = evaluation.corrections
                            .filter((c) => c.receiptId === receipt.id)
                            .at(-1);
                          return (
                            <tr key={receipt.id}>
                              <td>{shortDate(localDay(receipt.occurredAt, dataset.timezone))}</td>
                              <td>{formatMoney(receipt.amount)}</td>
                              <td>
                                {correction?.kind === 'reimbursement'
                                  ? 'Reimbursement · match superseded'
                                  : (allocation?.invoiceId ?? 'Unmatched')}
                                {correction && (
                                  <small>
                                    {correction.kind} · v{correction.effectiveVersion}
                                  </small>
                                )}
                              </td>
                              <td>
                                <Tag>{receipt.provenance}</Tag>
                              </td>
                              <td>
                                <div className="inline-actions">
                                  <button
                                    className="quiet small"
                                    onClick={() => setMatching(receipt)}
                                  >
                                    Match
                                  </button>
                                  <button
                                    className="quiet small"
                                    onClick={() => setCorrecting(receipt)}
                                  >
                                    Correct
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {screen === 'timeline' && (
            <>
              <section className="replay-control card">
                <div>
                  <Clock size={24} />
                  <div>
                    <h2>Go back to what was known.</h2>
                    <p>Only records known by this date can shape the forecast.</p>
                  </div>
                </div>
                <label>
                  Knowledge date{' '}
                  <input
                    aria-label="Replay knowledge date"
                    disabled={Boolean(dataset.capturedAt)}
                    type="date"
                    min={replayRange.from}
                    max={replayRange.through}
                    value={asOf}
                    onChange={(e) => {
                      if (e.target.value && e.target.validity.valid) {
                        const nextAsOf = clampReplayDate(dataset, e.target.value);
                        setAsOf(nextAsOf);
                        setPurchaseDate(addDays(nextAsOf, 3));
                        setUsePurchase(false);
                      }
                    }}
                  />
                </label>
              </section>
              {forecast}
              {purchaseControl}
              <section className="scenario-cards">
                {scenarios.map((s) => (
                  <ScenarioSummary key={s.id} scenario={s} buffer={dataset.buffer} />
                ))}
              </section>
              <section className="card evaluation">
                {panelHeader(
                  'CHRONOLOGICAL FIXTURE REPLAY',
                  'Does remembered timing always help?',
                  <Tag>Authored data only</Tag>,
                )}
                <p>
                  Forecasts are frozen before each authored outcome is revealed. This evaluation
                  replays through December 31, beyond the sample’s November 5 knowledge date.
                </p>
                <div className="evaluation-metrics">
                  <div>
                    <span>Promised date error</span>
                    <strong>
                      {replay.promisedMeanAbsoluteError?.toFixed(1)} <small>days</small>
                    </strong>
                  </div>
                  <div>
                    <span>Learned date error</span>
                    <strong>
                      {replay.learnedMeanAbsoluteError?.toFixed(1)} <small>days</small>
                    </strong>
                  </div>
                  <div>
                    <span>Measured sample</span>
                    <strong>
                      {replay.resolved} <small>resolved · {replay.unresolved} unresolved</small>
                    </strong>
                  </div>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Frozen case</th>
                        <th>Promised error</th>
                        <th>Learned error</th>
                        <th>Outcome</th>
                      </tr>
                    </thead>
                    <tbody>
                      {replay.cases.map((c) => (
                        <tr key={c.invoiceId}>
                          <td>
                            {c.invoiceId}
                            <small>Frozen {shortDate(c.asOf)}</small>
                          </td>
                          <td>{c.promisedError} days</td>
                          <td>{c.learnedError} days</td>
                          <td>
                            {c.learnedError > c.promisedError
                              ? 'Counterexample: this payment was punctual.'
                              : 'Learned date was closer in this fixture.'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="section-note">
                  {replay.limitation} Cash buffer warnings are scenarios, not measured prediction
                  accuracy.
                </p>
              </section>
            </>
          )}

          {screen === 'memory' && (
            <>
              <div className="memory-intro">
                <div className="icon-box">
                  <Fingerprint size={28} />
                </div>
                <p>
                  Memory is a calculation you can inspect. We use the median settlement delay of the
                  last six eligible completed payments, with at least three required. Early arrivals
                  never move cautious planning dates earlier.
                </p>
              </div>
              <section className="lessons-grid">
                {evaluation.lessons.map((lesson) => (
                  <article className="card lesson" key={lesson.clientId}>
                    <div className="lesson-top">
                      <span className={`client-avatar ${lesson.clientId}`}>
                        {alias(lesson.clientId)
                          .split(' ')
                          .map((p) => p[0])
                          .join('')}
                      </span>
                      <Tag tone={lesson.status === 'learned' ? 'green' : 'amber'}>
                        {lesson.status === 'learned' ? 'Pattern remembered' : 'Needs more history'}
                      </Tag>
                    </div>
                    <h2>{alias(lesson.clientId)}</h2>
                    <strong className="lesson-delay">
                      {lesson.delayDays === null
                        ? 'Not enough history'
                        : lesson.delayDays === 0
                          ? 'Around the due date'
                          : `${lesson.delayDays} ${lesson.delayDays === 1 ? 'day' : 'days'} after due`}
                    </strong>
                    <p>
                      {lesson.sampleSize} completed payments · recent window of {lesson.window}.
                      <br />
                      {lesson.unresolvedCount} overdue unresolved ·{' '}
                      {lesson.excludedObservationIds.length} excluded receipts.
                    </p>
                    {upcoming
                      .filter(
                        (invoice) =>
                          invoice.clientId === lesson.clientId && invoice.dueDate >= asOf,
                      )
                      .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
                      .slice(0, 1)
                      .map((invoice) => (
                        <p key={invoice.id} className="next-planning-date">
                          Next planning date: <strong>{shortDate(invoice.learnedDate!)}</strong>
                          <br />
                          Promised {shortDate(invoice.dueDate)} · {formatMoney(invoice.outstanding)}{' '}
                          outstanding.
                        </p>
                      ))}
                    <details open={lesson.clientId === 'cedar'}>
                      <summary>Inspect the source observations</summary>
                      {lesson.sourceObservationIds.map((id) => {
                        const receipt = evaluation.receipts.find((r) => r.id === id)!;
                        const invoice = evaluation.invoices.find((i) =>
                          i.observationIds.includes(id),
                        );
                        return (
                          <div key={id} className="source-row">
                            <div>
                              <strong>{invoice?.id}</strong>
                              <small>
                                Due {invoice ? shortDate(invoice.dueDate) : '—'} · received{' '}
                                {shortDate(localDay(receipt.occurredAt, dataset.timezone))}
                              </small>
                              <small>
                                {receipt.provenance} · {formatMoney(receipt.amount)}
                              </small>
                            </div>
                            <button
                              className="quiet small"
                              aria-label={`Correct ${id}`}
                              onClick={() => setCorrecting(receipt)}
                            >
                              Correct
                            </button>
                          </div>
                        );
                      })}
                    </details>
                    <small className="algorithm-label">
                      {lesson.algorithmVersion} · version {lesson.effectiveVersion}
                    </small>
                  </article>
                ))}
              </section>
              {dataset.receipts.some((r) => r.id === 'receipt:paper-sep:full') && (
                <section className="correction-feature card">
                  <div>
                    <Tag tone="amber">Try a correction</Tag>
                    <h2>A receipt isn’t always income.</h2>
                    <p>
                      Paper Lane’s September receipt was a reimbursement. Correct its interpretation
                      and see the timing lesson lose an unreliable observation. Cash stays exactly
                      where it was.
                    </p>
                  </div>
                  <button
                    className="primary"
                    onClick={() =>
                      setCorrecting(
                        dataset.receipts.find((r) => r.id === 'receipt:paper-sep:full')!,
                      )
                    }
                  >
                    Review reimbursement <ArrowRight size={17} />
                  </button>
                </section>
              )}
              <section className="card">
                {panelHeader('APPEND AND SUPERSEDE', 'Corrections stay in the story')}{' '}
                {!evaluation.corrections.length ? (
                  <Empty>
                    No corrections yet. Review the reimbursement above to see the learning loop.
                  </Empty>
                ) : (
                  <div className="audit-list">
                    {evaluation.corrections
                      .slice()
                      .reverse()
                      .map((c) => (
                        <article key={c.id}>
                          <span className="audit-icon">
                            <ArrowCounterClockwise size={19} />
                          </span>
                          <div>
                            <strong>
                              {c.kind === 'reimbursement'
                                ? 'Reclassified as reimbursement'
                                : c.kind === 'exceptional'
                                  ? 'Excluded as exceptional'
                                  : 'Included in learning again'}
                            </strong>
                            <p>{c.reason}</p>
                            <small>
                              {c.receiptId} · v{c.effectiveVersion} · known{' '}
                              {shortDate(c.knownAt.slice(0, 10))}
                              {c.supersedesRecordId ? ' · supersedes ' + c.supersedesRecordId : ''}
                            </small>
                          </div>
                          <Tag>User correction</Tag>
                        </article>
                      ))}
                  </div>
                )}
              </section>
              <section className="correction-feature card">
                <div>
                  <Tag tone="sample">Separate fictional example</Tag>
                  <h2>One unusual delay can change a pattern.</h2>
                  <p>
                    Load an authored Aster example with a 21 day delay excluded as exceptional.
                    Compare November 3 and 4 in the timeline to inspect the lesson before and after
                    the correction. This replaces only your disposable sample.
                  </p>
                </div>
                <button
                  className="quiet"
                  onClick={() => {
                    if (
                      update(
                        createExceptionalDelayExample(),
                        'Authored fictional exceptional-delay example loaded. The unusual receipt stays in history; its timing is excluded from the lesson.',
                      )
                    ) {
                      setAsOf(SAMPLE_REPLAY_THROUGH);
                      setUsePurchase(false);
                    }
                  }}
                >
                  Load exceptional-delay example <ArrowRight size={17} />
                </button>
              </section>
              <section className="card sponsor-proof">
                {panelHeader(
                  'SPONSOR EVIDENCE',
                  'Real integrations have their own receipts.',
                  <Tag tone={memoryEvidence?.confirmedCount ? 'green' : 'amber'}>
                    {memoryEvidence?.confirmedCount
                      ? `${memoryEvidence.confirmedCount} confirmed memories`
                      : 'Verification pending'}
                  </Tag>,
                )}
                <div className="sponsor-status">
                  <div>
                    <span className="provider-logo">T</span>
                    <div>
                      <h3>Tatum · Sui Mainnet</h3>
                      <p>
                        {tatumEvidence?.status === 'confirmed'
                          ? 'Genuine timestamped Tatum snapshot captured. Planning assumptions remain hypothetical.'
                          : tatumEvidence?.status === 'stale'
                            ? 'The latest Tatum check failed. The last captured balance is retained below as a stale snapshot.'
                            : tatumEvidence?.status === 'failed'
                              ? 'The Tatum balance is unavailable after a failed check. Your local plan is intact.'
                              : 'No confirmed chain snapshot is loaded. The planning layer above is fictional.'}
                      </p>
                      <Tag>Read only · operator controlled</Tag>
                    </div>
                  </div>
                  <div>
                    <span className="provider-logo walrus">w</span>
                    <div>
                      <h3>Walrus Memory · Mainnet</h3>
                      <p>
                        {memoryEvidence?.recoveryStatus === 'confirmed'
                          ? 'A completed Mainnet recovery is captured in the proof below.'
                          : 'No confirmed Mainnet recovery is available. Local sample storage is browser storage.'}
                      </p>
                      <Tag>Sponsored route required</Tag>
                      <p className="section-note">
                        {memoryEvidence?.retentionAssessment?.status === 'verified'
                          ? 'Returned storage expiry was checked through judging. This is not an availability guarantee.'
                          : 'Storage expiry through judging is unverified. Missing expiry metadata is never treated as permanent storage.'}
                      </p>
                    </div>
                  </div>
                </div>
                <ConnectedPreview
                  evidence={evidence}
                  dataset={isConnected ? createSampleDataset() : dataset}
                  open={(next) => {
                    if (
                      update(
                        next,
                        'Separate connected sample loaded from the captured snapshot. No balance refresh was requested. Client identity and planning assumptions are hypothetical.',
                      )
                    )
                      setScreen('payments');
                  }}
                />
                <p className="section-note">
                  {evidenceState}. No visitor action sends a sponsor request or publishes a memory.
                </p>
                <details>
                  <summary>Provider status, job IDs and verification details</summary>
                  <pre>
                    {JSON.stringify(
                      evidence ?? {
                        status: 'unverified',
                        confirmedMainnetMemories: 0,
                        reason:
                          'Credentials and verified free account setup are required. Never enter delegate secrets in the browser.',
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
                <div className="evidence-actions">
                  <button
                    className="quiet"
                    disabled={loadingRecovery || memoryEvidence?.recoveryStatus !== 'confirmed'}
                    onClick={() => void loadCapturedRecovery()}
                  >
                    <Database size={17} />
                    {loadingRecovery ? 'Loading captured recovery…' : 'Load recovered sample'}
                  </button>
                  <button
                    className="quiet"
                    onClick={() => download('payday-memory-local-sample.json', dataset)}
                  >
                    <DownloadSimple size={17} />
                    Export local sample
                  </button>
                  <button
                    className="quiet"
                    onClick={() =>
                      setNotice(
                        memoryEvidence?.recoveryStatus === 'confirmed'
                          ? 'A completed Mainnet recovery is captured in the evidence. Load recovered sample checks its content against that proof. A fresh sponsor retrieval requires the operator memory:verify command; this button makes no external request.'
                          : 'Mainnet restore is unavailable: no completed and verified Memory manifest is configured. Your local history is intact.',
                      )
                    }
                  >
                    <Database size={17} />
                    Check Mainnet recovery
                  </button>
                  <label className="upload-button quiet">
                    Restore local export
                    <input
                      type="file"
                      accept="application/json"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        void file.text().then((text) => {
                          try {
                            const restored = JSON.parse(text) as Dataset;
                            update(
                              restored,
                              'Local export restored. This is not a Walrus recovery demonstration.',
                              true,
                            );
                          } catch {
                            setError(
                              'This file is not a valid Payday Memory local export. Your history is intact.',
                            );
                          }
                        });
                        e.target.value = '';
                      }}
                    />
                  </label>
                </div>
              </section>
            </>
          )}
          <footer>
            <span>
              <ShieldCheck size={15} />
              Private local sample. No wallet. No funds moved.
            </span>
            <span>30 day scenarios · USDC units · estimates, never a guarantee.</span>
            <details>
              <summary>Privacy & terms</summary>
              <p>
                This experimental planner stores your fictional sample in this browser. Operator
                sponsor commands may publish selected fictional records to public Mainnet storage.
                Never put personal financial records or credentials into a sample. No custody or
                payment execution. Estimates depend on entered assumptions.
              </p>
            </details>
          </footer>
        </main>
      </div>
      {adding && (
        <Modal error={error} title="Add an expected payment" onClose={() => setAdding(false)}>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              try {
                const data = new FormData(e.currentTarget);
                const clientAlias = String(data.get('client')).trim();
                const amount = money(String(data.get('amount')));
                if (BigInt(amount) <= 0n || !clientAlias)
                  throw new Error('Enter a client alias and a positive amount.');
                const next = structuredClone(dataset);
                let client = next.clients.find(
                  (c) => c.alias.toLowerCase() === clientAlias.toLowerCase(),
                );
                if (!client) {
                  client = { id: crypto.randomUUID(), alias: clientAlias };
                  next.clients.push(client);
                }
                next.invoices.push({
                  id: 'expected:' + crypto.randomUUID(),
                  clientId: client.id,
                  amount,
                  dueDate: String(data.get('date')),
                  knownAt: endOfDayTimestamp(asOf, dataset.timezone),
                  provenance: 'user-entered',
                  note: String(data.get('note')),
                });
                validateDataset(next);
                const saved = update(
                  next,
                  'Expected payment saved as a user assumption. Your current cash did not change.',
                );
                if (saved) setAdding(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Could not save payment.');
              }
            }}
          >
            <p>An expectation is separate from cash you already hold.</p>
            <label>
              Client alias
              <input
                name="client"
                list="clients"
                required
                maxLength={60}
                defaultValue="Cedar Works"
                autoFocus
              />
              <datalist id="clients">
                {dataset.clients.map((c) => (
                  <option key={c.id} value={c.alias} />
                ))}
              </datalist>
            </label>
            <label>
              Amount, USDC
              <input name="amount" inputMode="decimal" required placeholder="1800.00" />
            </label>
            <label>
              Due date
              <input name="date" type="date" required defaultValue="2026-11-10" />
            </label>
            <label>
              Note, optional
              <input name="note" maxLength={200} placeholder="What are you expecting?" />
            </label>
            <button className="primary" type="submit">
              Save expected payment <Check size={17} />
            </button>
          </form>
        </Modal>
      )}
      {addingReceipt && (
        <Modal
          error={error}
          title="Record a fictional sample receipt"
          onClose={() => setAddingReceipt(false)}
        >
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              try {
                if (isConnected)
                  throw new Error(
                    'Connected receipts must be captured through the read-only Tatum adapter.',
                  );
                const id = 'fictional-local:' + crypto.randomUUID();
                const date = String(data.get('date'));
                if (date > asOf)
                  throw new Error('A receipt cannot arrive after the replay knowledge date.');
                const next = importReceipts(dataset, [
                  {
                    id,
                    transferId: id + ':balance:0',
                    digest: id,
                    amount: money(String(data.get('amount'))),
                    asset: USDC_SUI,
                    recipient: dataset.walletAddress,
                    status: 'success',
                    occurredAt: date + 'T06:00:00Z',
                    knownAt: endOfDayTimestamp(asOf, dataset.timezone),
                    provenance: 'fictional',
                  },
                ]);
                validateDataset(next);
                const saved = update(
                  next,
                  'Fictional receipt recorded as cash. Match it to an expected payment to reduce the outstanding amount.',
                );
                if (saved) setAddingReceipt(false);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Receipt could not be saved.');
              }
            }}
          >
            <p>
              This authors a fictional outcome for your disposable sample. No transaction is
              executed or verified onchain.
            </p>
            <label>
              Receipt amount, USDC
              <input name="amount" inputMode="decimal" required autoFocus placeholder="100.00" />
            </label>
            <label>
              Received date
              <input
                name="date"
                type="date"
                required
                min={dataset.opening.date}
                max={asOf}
                defaultValue={asOf}
              />
            </label>
            <button type="submit" className="primary">
              Record sample receipt <Check size={17} />
            </button>
          </form>
        </Modal>
      )}
      {correcting && (
        <Modal
          error={error}
          title="Give this receipt the right meaning"
          onClose={() => setCorrecting(null)}
        >
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              try {
                const before = evaluateDataset(dataset, asOf).cash;
                const next = appendCorrection(dataset, {
                  id: 'correction:' + crypto.randomUUID(),
                  receiptId: correcting.id,
                  kind: String(data.get('kind')) as 'reimbursement' | 'exceptional' | 'include',
                  reason: String(data.get('reason')),
                  occurredAt: endOfDayTimestamp(asOf, dataset.timezone),
                  knownAt: endOfDayTimestamp(asOf, dataset.timezone),
                });
                const saved = update(
                  next,
                  `Interpretation corrected. Cash remains ${formatMoney(before)}. The lesson has been recomputed and the prior record is preserved.`,
                );
                if (saved) setCorrecting(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Correction could not be saved.');
              }
            }}
          >
            <div className="receipt-preview">
              <span>{correcting.id}</span>
              <strong>{formatMoney(correcting.amount)}</strong>
              <Tag>{correcting.provenance}</Tag>
            </div>
            <label>
              Interpretation
              <select
                name="kind"
                defaultValue={correcting.id.includes('paper-sep') ? 'reimbursement' : 'exceptional'}
              >
                <option value="reimbursement">Reimbursement, not invoice income</option>
                <option value="exceptional">Exceptional delay, exclude from timing</option>
                <option value="include">Include as regular income again</option>
              </select>
            </label>
            <label>
              What changed?
              <textarea
                name="reason"
                required
                maxLength={300}
                defaultValue={
                  correcting.id.includes('paper-sep')
                    ? 'This reimbursed materials I bought. It was not payment for the expected work.'
                    : 'This payment had an unusual delay. Keep the receipt, but exclude it from the timing pattern.'
                }
              />
            </label>
            <p>
              <Info size={17} />
              This revises the lesson, not your held cash. The correction is known from{' '}
              {shortDate(asOf)} onward.
            </p>
            <button className="primary" type="submit">
              Save correction <Check size={17} />
            </button>
          </form>
        </Modal>
      )}
      {matching && (
        <Modal error={error} title="Match a receipt to a payment" onClose={() => setMatching(null)}>
          <form
            className="stack-form"
            onSubmit={(e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              try {
                const next = allocateReceipt(dataset, {
                  id: 'allocation:' + crypto.randomUUID(),
                  receiptId: matching.id,
                  invoiceId: String(data.get('invoice')),
                  amount: money(String(data.get('amount'))),
                  confirmed: true,
                  knownAt: endOfDayTimestamp(asOf, dataset.timezone),
                });
                const saved = update(
                  next,
                  'Receipt allocation saved. Matching is a user assertion, not onchain proof of purpose.',
                );
                if (saved) setMatching(null);
              } catch (e) {
                setError(e instanceof Error ? e.message : 'Matching failed.');
              }
            }}
          >
            <p>
              {formatMoney(matching.amount)} received. Existing allocations are retained; an excess
              allocation will be rejected.
            </p>
            <label>
              Expected payment
              <select name="invoice">
                {upcoming.map((i) => (
                  <option key={i.id} value={i.id}>
                    {alias(i.clientId)} · {i.id} · {formatMoney(i.outstanding)} open
                  </option>
                ))}
              </select>
            </label>
            <label>
              Amount to allocate, USDC
              <input
                name="amount"
                inputMode="decimal"
                required
                defaultValue={decimal(matching.amount)}
              />
            </label>
            <button className="primary" type="submit">
              Confirm match <Check size={17} />
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
function ScenarioSummary({ scenario, buffer }: { scenario: Scenario; buffer: string }) {
  return (
    <article className="card scenario-summary">
      <span className="eyebrow">{scenario.label.toUpperCase()}</span>
      <h2>{formatMoney(scenario.minimum)}</h2>
      <p>Lowest projected cash · {shortDate(scenario.minimumDate)}</p>
      <Tag tone={scenario.bufferBreach ? 'amber' : 'green'}>
        {scenario.bufferBreach
          ? `Below ${formatMoney(buffer, 0)} buffer from ${shortDate(scenario.bufferBreach.date)}`
          : 'Buffer covered across this horizon'}
      </Tag>
      {BigInt(scenario.minimum) < 0n && (
        <p className="negative-explainer">
          Negative means obligations exceed projected available cash. It is a funding gap, not a
          bank overdraft.
        </p>
      )}
    </article>
  );
}
function Modal({
  title,
  children,
  onClose,
  error,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  error?: string;
}) {
  const titleId = useId();
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLDialogElement>('.modal');
    dialog?.showModal();
    return () => {
      dialog?.close();
      previouslyFocused?.focus();
    };
  }, []);
  function trap(e: FormEvent<HTMLDialogElement>) {
    e.preventDefault();
    onClose();
  }
  return (
    <dialog
      className="modal"
      aria-labelledby={titleId}
      onCancel={trap}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" onClick={onClose} aria-label="Close dialog">
          <X size={21} />
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {children}
    </dialog>
  );
}
