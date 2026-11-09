import { useState } from 'react';
import { ArrowRight, ShieldCheck, WarningCircle } from '@phosphor-icons/react';
import {
  createConnectedWorkspace,
  connectedScenarios,
  isSnapshotStale,
  type CapturedSnapshot,
} from '../connected';
import { formatMoney, type Dataset, type Receipt } from '../domain/index';
import { CashChart } from './Chart';

export function ConnectedPreview({
  evidence,
  dataset,
  open,
}: {
  evidence: Record<string, unknown> | null;
  dataset: Dataset;
  open: (dataset: Dataset) => void;
}) {
  const [error, setError] = useState('');
  const tatum = evidence?.tatum as
    | {
        status?: string;
        balanceSnapshot?: CapturedSnapshot;
        receipts?: Receipt[];
        lastFailure?: { code?: string; at?: string };
      }
    | undefined;
  const snapshot = tatum?.balanceSnapshot;
  const failed = tatum?.status === 'stale' || tatum?.status === 'failed';
  const failureDescription =
    tatum?.lastFailure?.code === 'timeout'
      ? 'The latest Tatum check timed out'
      : 'The latest Tatum check failed';
  const failureTime = tatum?.lastFailure?.at ? ` at ${tatum.lastFailure.at}` : '';
  if (!snapshot || !['confirmed', 'stale'].includes(tatum?.status ?? ''))
    return (
      <div className="connected-empty" role={failed ? 'alert' : undefined}>
        {failed ? <WarningCircle size={19} /> : <ShieldCheck size={19} />}
        <p>
          {failed
            ? `${failureDescription}${failureTime}. No captured balance is available. Your local plan is intact. Ask the operator to retry the capture; this page makes no sponsor request.`
            : 'A connected scenario appears here after the operator captures a genuine native USDC balance through Tatum. No wallet connection or visitor request is needed.'}
        </p>
      </div>
    );
  try {
    const retainedSnapshot = tatum?.status === 'stale' ? { ...snapshot, stale: true } : snapshot;
    const scenarios = connectedScenarios(dataset, retainedSnapshot);
    const stale = isSnapshotStale(retainedSnapshot);
    return (
      <section className="connected-preview">
        <h3>Captured chain cash, hypothetical plan</h3>
        <p>
          {formatMoney(snapshot.amount)} native USDC · captured {snapshot.observedAt} ·{' '}
          {stale ? 'stale snapshot' : 'timestamped snapshot, not a live balance'}.
        </p>
        {failed && (
          <p role="status">
            {failureDescription}
            {failureTime}. The last captured balance is retained as stale. Ask the operator to retry
            the capture. Opening this sample does not refresh the balance.
          </p>
        )}
        <p>
          The sample’s future bills and remembered timing are hypothetical. This public address has
          no asserted owner. Receipt amounts already included in this balance are never added again.
        </p>
        <CashChart scenarios={scenarios} buffer={dataset.buffer} />
        <button
          className="quiet"
          onClick={() => {
            try {
              open(createConnectedWorkspace(dataset, retainedSnapshot, tatum?.receipts ?? []));
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Captured data could not be loaded.');
            }
          }}
        >
          Open connected sample <ArrowRight size={16} />
        </button>
        <p className="section-note">
          This opens a disposable workspace with chain receipts available for manual matching.
          Fictional historical lessons are removed. Client aliases, due dates and bills remain
          hypothetical user assertions.{' '}
          {stale && 'The workspace keeps this stale captured snapshot.'}
        </p>
        {error && (
          <p role="alert">
            <WarningCircle size={16} />
            {error}
          </p>
        )}
      </section>
    );
  } catch {
    return <p role="alert">Captured evidence failed validation. Your local replay is unchanged.</p>;
  }
}
