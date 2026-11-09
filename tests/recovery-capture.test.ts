import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createCuratedPublicationDataset } from '../src/sponsors/curated.js';
import { datasetFromRecoveryCapture } from '../src/recovery-capture.js';

test('captured recovery binds content, account, manifest and verification time before replacing a sample', async () => {
  const dataset = createCuratedPublicationDataset();
  const datasetHash = createHash('sha256').update(JSON.stringify(dataset)).digest('hex');
  const proof = {
    recoveryStatus: 'confirmed',
    recoveredDatasetHash: datasetHash,
    accountScope: 'offline-fixture-account',
    recoveryVerifiedAt: '2026-11-08T12:00:00Z',
    manifestReceipt: { blobId: 'offline-fixture-manifest' },
  };
  const capture = {
    schemaVersion: 1,
    evidenceMode: 'captured',
    provider: 'Walrus Memory',
    network: 'sui-mainnet',
    datasetHash,
    accountScope: proof.accountScope,
    verifiedAt: proof.recoveryVerifiedAt,
    manifestBlobId: proof.manifestReceipt.blobId,
    recordCount: 20,
    dataset,
  };
  const restored = await datasetFromRecoveryCapture(capture, proof);
  assert.deepEqual(restored, dataset);
  assert.notEqual(restored, dataset);
  for (const changed of [
    { ...capture, accountScope: 'other-account' },
    { ...capture, verifiedAt: '2026-11-09T12:00:00Z' },
    { ...capture, manifestBlobId: 'other-manifest' },
    { ...capture, network: 'sui-testnet' },
    { ...capture, recordCount: 0 },
  ])
    await assert.rejects(datasetFromRecoveryCapture(changed, proof), /does not match/);
  await assert.rejects(
    datasetFromRecoveryCapture(capture, { ...proof, recoveryStatus: 'pending' }),
    /does not match/,
  );
  const altered = structuredClone(capture);
  altered.dataset.buffer = '300000001';
  await assert.rejects(datasetFromRecoveryCapture(altered, proof), /hash check/);
  const realWallet = structuredClone(capture);
  realWallet.dataset.walletAddress = '0x' + 'a'.repeat(64);
  for (const receipt of realWallet.dataset.receipts)
    receipt.recipient = realWallet.dataset.walletAddress;
  await assert.rejects(datasetFromRecoveryCapture(realWallet, proof), /fictional recovered sample/);
});
