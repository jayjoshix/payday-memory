import { readFile } from 'node:fs/promises';
import { atomicJson, readJson, safeFailure } from '../src/sponsors/safety.js';
export const evidencePath = 'evidence/manifest.json';
export async function getEvidence(path = evidencePath): Promise<Record<string, unknown>> {
  try {
    return await readJson<Record<string, unknown>>(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
      throw new Error('Sponsor evidence is unreadable. Existing evidence was preserved.', {
        cause: error,
      });
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      network: 'sui-mainnet',
      status: 'pending_credentials',
      tatum: {
        status: 'skipped',
        reason: 'Credentials and account-specific zero-cost settings have not been verified.',
      },
      memory: {
        status: 'skipped',
        confirmedCount: 0,
        records: [],
        reason: 'No genuine Mainnet write has been attempted.',
      },
      claims: {
        fixture: 'Fictional authored payment history.',
        chain: 'No live chain observation claimed.',
        storage: 'No Mainnet storage confirmation claimed.',
      },
    };
  }
}
export async function saveEvidence(value: Record<string, unknown>): Promise<void> {
  await atomicJson(evidencePath, value);
  await atomicJson('public/evidence/manifest.json', value);
}
export function loadLocalEnv(): void {
  try {
    process.loadEnvFile('.env.local');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
export function liveRequested(): boolean {
  return process.argv.includes('--live');
}
export function cappedArgument(name: string, fallback: number, maximum: number): number {
  const raw = process.argv.find((v) => v.startsWith(`--${name}=`))?.split('=')[1];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > maximum)
    throw new Error(`--${name} must be an integer1 to${maximum}.`);
  return value;
}
export async function reportFailure(error: unknown): Promise<void> {
  console.error(JSON.stringify({ status: 'failed', ...safeFailure(error) }));
  process.exitCode = 1;
}
export async function isEmptyWorkspace(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return true;
    throw error;
  }
}
