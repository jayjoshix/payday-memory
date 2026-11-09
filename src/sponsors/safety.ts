import { readFile, mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname } from 'node:path';
export class SponsorError extends Error {
  constructor(
    public readonly code:
      'blocked' | 'quota' | 'timeout' | 'unavailable' | 'invalid' | 'incomplete',
    message: string,
  ) {
    super(message);
    this.name = 'SponsorError';
  }
}
export interface AccountChecks {
  checkedAt: string;
  tatum?: {
    freePlanConfirmed: boolean;
    autoUpgradeDisabled: boolean;
    noPaidBilling: boolean;
    remainingCredits: number;
    creditCostUpperBoundPerRead: number;
    methodsConfirmed: string[];
  };
  memory?: {
    hostedSetupFree: boolean;
    managedMainnetSponsorship: boolean;
    retentionThrough: string;
    freeLimitRecords: number;
    providerEnforcedFreeLimits?: boolean;
  };
}
export async function atomicJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
}
export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}
export async function loadAccountChecks(): Promise<AccountChecks> {
  let checks: AccountChecks;
  try {
    checks = await readJson<AccountChecks>('data/account-checks.json');
  } catch {
    throw new SponsorError(
      'blocked',
      'Create data/account-checks.json from the reviewed account-checks example after inspecting your sponsor dashboards. No external call was made.',
    );
  }
  const age = Date.now() - Date.parse(checks.checkedAt);
  if (!Number.isFinite(age) || age < 0 || age > 86400000)
    throw new SponsorError(
      'blocked',
      'Account cost and quota checks must be timestamped within the last 24 hours.',
    );
  return checks;
}
export async function assertProviderCircuit(
  provider: 'tatum' | 'memory',
  checks: AccountChecks,
  path = 'data/provider-stops.json',
): Promise<void> {
  let stops: Record<string, string>;
  try {
    stops = await readJson(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  if (stops[provider] && Date.parse(checks.checkedAt) <= Date.parse(stops[provider]))
    throw new SponsorError(
      'quota',
      `${provider} is stopped after a quota failure. Inspect the actual free allowance again and timestamp new account checks before another request.`,
    );
}
export async function recordQuotaStop(
  provider: 'tatum' | 'memory',
  error: unknown,
  path = 'data/provider-stops.json',
): Promise<void> {
  const failure =
    (
      error as {
        code?: string;
      }
    )?.code === 'quota'
      ? (error as {
          code: string;
        })
      : safeFailure(error);
  if (failure.code !== 'quota') return;
  let stops: Record<string, string> = {};
  try {
    stops = await readJson(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  stops[provider] = new Date().toISOString();
  await atomicJson(path, stops);
}
export function requireTatum(checks: AccountChecks, env: NodeJS.ProcessEnv = process.env): void {
  const t = checks.tatum;
  if (
    !env.TATUM_API_KEY ||
    t?.freePlanConfirmed !== true ||
    t.autoUpgradeDisabled !== true ||
    t.noPaidBilling !== true ||
    !Number.isFinite(t.remainingCredits) ||
    !Number.isFinite(t.creditCostUpperBoundPerRead) ||
    t.creditCostUpperBoundPerRead <= 0 ||
    t.remainingCredits < t.creditCostUpperBoundPerRead * 3 ||
    !Array.isArray(t.methodsConfirmed) ||
    !['sui.rpc.v2.StateService/GetBalance', 'sui.rpc.v2.LedgerService/GetTransaction'].every(
      (method) => t.methodsConfirmed.includes(method),
    )
  )
    throw new SponsorError(
      'blocked',
      'Tatum requires a key, a verified free account, disabled upgrades, no paid billing, current credit headroom and account-supported read methods.',
    );
}
export function supportedMemoryRuntime(version = process.versions.node): boolean {
  const [major, minor, patch] = version.split('.').map(Number) as [number, number, number];
  return (
    (major === 22 && (minor > 23 || (minor === 23 && patch >= 4))) ||
    (major === 24 && (minor > 22 || (minor === 22 && patch >= 1))) ||
    (major === 26 && (minor > 12 || (minor === 12 && patch >= 1))) ||
    major > 26
  );
}
export function requireMemory(
  checks: AccountChecks,
  env: NodeJS.ProcessEnv = process.env,
  runtime = process.versions.node,
): void {
  requireMemoryProbe(checks, env, runtime);
  const m = checks.memory!;
  const capacityVerified =
    Number.isInteger(m.freeLimitRecords) &&
    (m.freeLimitRecords >= 1 ||
      (m.freeLimitRecords === 0 && m.providerEnforcedFreeLimits === true));
  if (!capacityVerified)
    throw new SponsorError(
      'blocked',
      'Memory publication requires a verified free-limit policy. Do not invent a remaining record allowance. Storage expiry is a separate submission-readiness check.',
    );
}

/** A single sponsored probe observes actual retention; it does not assert an unpublished quota. */
export function requireMemoryProbe(
  checks: AccountChecks,
  env: NodeJS.ProcessEnv = process.env,
  runtime = process.versions.node,
): void {
  if (!supportedMemoryRuntime(runtime))
    throw new SponsorError(
      'blocked',
      'Walrus official quickstart requires patched Node 22.23.4+,24.22.1+ or26.12.1+; update your free local runtime before live Memory operations.',
    );
  const m = checks.memory;
  if (
    !env.MEMWAL_KEY ||
    !/^0x[0-9a-fA-F]{64}$/.test(env.MEMWAL_ACCOUNT_ID ?? '') ||
    !env.MEMWAL_AGENT_ID ||
    m?.hostedSetupFree !== true ||
    m.managedMainnetSponsorship !== true
  )
    throw new SponsorError(
      'blocked',
      'Memory requires application delegate credentials, verified zero-cost hosted onboarding and verified managed Mainnet sponsorship. Do not buy tokens.',
    );
}
export function safeFailure(error: unknown): {
  code: string;
  message: string;
} {
  if (error instanceof SponsorError) return { code: error.code, message: error.message };
  const status =
    (
      error as {
        status?: number;
        code?: number | string;
      }
    )?.status ??
    (
      error as {
        code?: number | string;
      }
    )?.code;
  if (status === 429 || status === 8 || status === 'RESOURCE_EXHAUSTED')
    return {
      code: 'quota',
      message: 'Provider quota reached. Sponsor requests stopped; local replay remains available.',
    };
  if (
    status === 504 ||
    status === 4 ||
    status === 'DEADLINE_EXCEEDED' ||
    (
      error as {
        name?: string;
      }
    )?.name === 'AbortError'
  )
    return {
      code: 'timeout',
      message:
        'Provider timed out. Retain the previous snapshot as stale; no success was recorded.',
    };
  return {
    code: 'unavailable',
    message:
      'Sponsor request failed. Check account access, supported methods and provider availability. Provider error details are withheld to avoid exposing credentials.',
  };
}
