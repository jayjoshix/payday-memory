import { validateDataset, type Dataset } from './domain/index.js';

export interface CapturedRecoveryProof {
  recoveryStatus?: string;
  recoveredDatasetHash?: string;
  accountScope?: string;
  recoveryVerifiedAt?: string;
  manifestReceipt?: { blobId?: string | null };
}

/** Only a complete operator retrieval can authorize a captured sample in this browser. */
export async function datasetFromRecoveryCapture(
  value: unknown,
  proof: CapturedRecoveryProof,
): Promise<Dataset> {
  const capture = value as {
    schemaVersion?: number;
    evidenceMode?: string;
    provider?: string;
    network?: string;
    datasetHash?: string;
    accountScope?: string;
    verifiedAt?: string;
    manifestBlobId?: string;
    recordCount?: number;
    dataset?: Dataset;
  } | null;
  if (
    proof.recoveryStatus !== 'confirmed' ||
    !proof.recoveredDatasetHash ||
    !proof.accountScope ||
    !proof.recoveryVerifiedAt ||
    !proof.manifestReceipt?.blobId ||
    capture?.schemaVersion !== 1 ||
    capture.evidenceMode !== 'captured' ||
    capture.provider !== 'Walrus Memory' ||
    capture.network !== 'sui-mainnet' ||
    capture.datasetHash !== proof.recoveredDatasetHash ||
    capture.accountScope !== proof.accountScope ||
    capture.verifiedAt !== proof.recoveryVerifiedAt ||
    capture.manifestBlobId !== proof.manifestReceipt.blobId ||
    !Number.isInteger(capture.recordCount) ||
    capture.recordCount! < 1 ||
    !capture.dataset
  )
    throw new Error(
      'Captured recovery does not match the confirmed operator proof. Your sample is intact.',
    );
  validateDataset(capture.dataset);
  if (
    capture.dataset.walletAddress !== 'fictional-wallet' ||
    !capture.dataset.id.startsWith('payday-memory-fictional-') ||
    [...capture.dataset.invoices, ...capture.dataset.receipts, ...capture.dataset.obligations].some(
      (record) => record.provenance !== 'fictional',
    )
  )
    throw new Error('Only a fictional recovered sample can be loaded in this public demo.');
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(capture.dataset)),
  );
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  if (hash !== proof.recoveredDatasetHash)
    throw new Error('Captured recovery content failed its hash check. Your sample is intact.');
  return structuredClone(capture.dataset);
}
