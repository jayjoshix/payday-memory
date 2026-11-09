import { nativeMemoryClient } from '../src/sponsors/memory.js';
import { DEFAULT_MEMORY_NAMESPACE, memoryAccountScope } from '../src/sponsors/curated.js';
import {
  loadAccountChecks,
  supportedMemoryRuntime,
  SponsorError,
  safeFailure,
  assertProviderCircuit,
  recordQuotaStop,
} from '../src/sponsors/safety.js';
import { loadLocalEnv, liveRequested, getEvidence, saveEvidence } from './sponsors-common.js';

loadLocalEnv();
if (!liveRequested()) {
  console.log(
    'SKIPPED: use --live for one authenticated metadata page. This command never uploads or retrieves memory contents.',
  );
} else {
  const observedAt = new Date().toISOString();
  let requests = 0;
  let signedReadRequests = 0;
  let providerMetadataFields: string[] = [];
  let providerNumericMetadata: Record<string, number | boolean> = {};
  const originalFetch = globalThis.fetch;
  let client: Awaited<ReturnType<typeof nativeMemoryClient>> | undefined;
  let result: Record<string, unknown>;
  try {
    const checks = await loadAccountChecks();
    if (!supportedMemoryRuntime())
      throw new SponsorError('blocked', 'Use the supported local runtime before accessing Memory.');
    if (checks.memory?.hostedSetupFree !== true)
      throw new SponsorError(
        'blocked',
        'Free hosted onboarding must be confirmed before the account read.',
      );
    await assertProviderCircuit('memory', checks);
    globalThis.fetch = async (input, init) => {
      if (requests >= 4)
        throw new SponsorError(
          'quota',
          'The four-request metadata inspection cap was reached. No retry was made.',
        );
      requests += 1;
      if (new Headers(init?.headers ?? {}).has('x-signature')) signedReadRequests += 1;
      const response = await originalFetch(input, init);
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      if (url.pathname === '/api/stats' && response.ok) {
        const metadata = (await response.clone().json()) as Record<string, unknown>;
        providerMetadataFields = Object.keys(metadata);
        providerNumericMetadata = Object.fromEntries(
          Object.entries(metadata).filter(
            ([key, value]) =>
              /limit|quota|remaining|retention|epoch|credit|count|total/i.test(key) &&
              (typeof value === 'number' || typeof value === 'boolean'),
          ),
        ) as Record<string, number | boolean>;
      }
      return response;
    };
    client = await nativeMemoryClient(process.env, { preflightTimeoutMs: 15000 });
    const page = await client.listMemories({
      namespace: process.env.MEMWAL_NAMESPACE ?? DEFAULT_MEMORY_NAMESPACE,
      limit: 1,
    });
    result = {
      status: 'authenticated-read-confirmed',
      observedAt,
      provider: 'Walrus Memory',
      network: 'sui-mainnet',
      requestCount: requests,
      applicationMemoriesOnThisPage: page.memories.length,
      coverageComplete: !page.has_more && !page.must_resync,
      recordContentsRetrieved: false,
      writesMade: 0,
      writeAllowance: 'unverified',
      retentionThroughJudging: 'unverified',
      runtime: process.versions.node,
      providerMetadataFields,
      providerNumericMetadata,
    };
  } catch (error) {
    const failure = safeFailure(error);
    await recordQuotaStop('memory', error);
    result = {
      status: 'not-confirmed',
      observedAt,
      provider: 'Walrus Memory',
      network: 'sui-mainnet',
      requestCount: requests,
      writesMade: 0,
      ...failure,
    };
    const status = (error as { status?: unknown }).status;
    if (Number.isInteger(status) && Number(status) >= 400 && Number(status) < 600)
      result.httpStatus = status;
    process.exitCode = 1;
  } finally {
    client?.destroy?.();
    globalThis.fetch = originalFetch;
  }
  result.signedReadRequests = signedReadRequests;
  result.accountScope = memoryAccountScope(
    process.env.MEMWAL_ACCOUNT_ID!,
    process.env.MEMWAL_NAMESPACE ?? DEFAULT_MEMORY_NAMESPACE,
  );
  const evidence = await getEvidence();
  evidence.lastCheckAt = new Date().toISOString();
  const previous = evidence.memory as Record<string, unknown>;
  evidence.memory = {
    ...previous,
    accountAccessCheck: result,
    accountAccessChecks: [
      ...((previous.accountAccessChecks as unknown[]) ??
        (previous.accountAccessCheck ? [previous.accountAccessCheck] : [])),
      result,
    ].slice(-3),
  };
  await saveEvidence(evidence);
  console.log(JSON.stringify(result, null, 2));
}
