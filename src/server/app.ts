import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createSampleDataset, validateDataset, type Dataset } from '../domain/index.js';
import { AtomicJsonStore } from './store.js';

const MAX_BODY = 512 * 1024;
const SESSION_LIMIT = 40;
type Session = { id: string; createdAt: string; updatedAt: string; dataset: unknown };
type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => void;
export type AppOptions = {
  dataDirectory: string;
  publicDirectory?: string;
  evidenceFile?: string;
  recoveryFile?: string;
  operatorToken?: string;
  developmentMiddleware?: Middleware;
  env?: NodeJS.ProcessEnv;
};

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(value));
}

function safeHost(request: IncomingMessage): boolean {
  try {
    const host = new URL(`http://${request.headers.host ?? ''}`).hostname;
    return ['localhost', '127.0.0.1', '[::1]'].includes(host);
  } catch {
    return false;
  }
}

function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (!origin) return true; // CLI requests have no browser ambient credentials.
  try {
    return new URL(origin).host === request.headers.host && new URL(origin).protocol === 'http:';
  } catch {
    return false;
  }
}

function authorized(request: IncomingMessage, expected: string | undefined): boolean {
  if (!expected || expected.length < 24) return false;
  const actual = request.headers.authorization ?? '';
  const wanted = `Bearer ${expected}`;
  return (
    Buffer.byteLength(actual) === Buffer.byteLength(wanted) &&
    timingSafeEqual(Buffer.from(actual), Buffer.from(wanted))
  );
}

async function body(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    size += Buffer.byteLength(chunk);
    if (size > MAX_BODY) throw Object.assign(new Error('The save is too large'), { status: 413 });
    chunks.push(Buffer.from(chunk));
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('The request must contain valid JSON'), { status: 400 });
  }
}

function acceptableDataset(value: unknown): boolean {
  try {
    validateDataset(value as Dataset);
    return true;
  } catch {
    return false;
  }
}

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

export function createAppServer(options: AppOptions) {
  const store = new AtomicJsonStore(options.dataDirectory);
  const environment = options.env ?? process.env;
  let createdSessions = 0;
  const server = createServer(async (request, response) => {
    if (!safeHost(request))
      return json(response, 403, { error: 'Use the local application address' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method ?? '') && !sameOrigin(request)) {
      return json(response, 403, { error: 'This action must originate in the local application' });
    }
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const route = url.pathname;
      if (route === '/runtime.json' && request.method === 'GET') {
        return json(response, 200, { mode: 'local-operator' });
      }
      if (route === '/api/status' && request.method === 'GET') {
        return json(response, 200, {
          mode: 'local-replay',
          network: 'offline',
          fictionalData: true,
          sponsorOperations: 'Explicit operator CLI only',
          operatorConfigured: Boolean(options.operatorToken && options.operatorToken.length >= 24),
          providers: {
            tatum: { configured: Boolean(environment.TATUM_API_KEY), verified: false },
            memory: {
              configured: Boolean(
                environment.MEMWAL_ACCOUNT_ID &&
                environment.MEMWAL_KEY &&
                environment.MEMWAL_AGENT_ID,
              ),
              verified: false,
            },
          },
        });
      }
      if (route === '/api/evidence' && request.method === 'GET') {
        if (!options.evidenceFile)
          return json(response, 200, { status: 'not-verified', capturedAt: null, records: [] });
        try {
          const evidence: unknown = JSON.parse(await readFile(options.evidenceFile, 'utf8'));
          return json(response, 200, evidence);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return json(response, 200, { status: 'not-verified', capturedAt: null, records: [] });
          throw new Error('Sponsor evidence is unreadable; no verification is claimed', {
            cause: error,
          });
        }
      }
      if (route === '/api/recovery-capture' && request.method === 'GET') {
        if (!options.recoveryFile)
          return json(response, 404, { error: 'No captured recovery is configured.' });
        try {
          return json(response, 200, JSON.parse(await readFile(options.recoveryFile, 'utf8')));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            return json(response, 404, { error: 'No completed Mainnet recovery is captured.' });
          throw new Error('The captured recovery is unreadable. Existing files were preserved.', {
            cause: error,
          });
        }
      }
      if (route === '/api/demo/session' && request.method === 'POST') {
        if (createdSessions >= SESSION_LIMIT)
          return json(response, 429, {
            error: 'Session limit reached. Restart the local server to start more sample sessions.',
          });
        const id = randomUUID();
        const now = new Date().toISOString();
        const session: Session = {
          id,
          createdAt: now,
          updatedAt: now,
          dataset: createSampleDataset(),
        };
        await store.write(`session-${id}`, session);
        createdSessions += 1;
        return json(response, 201, session);
      }
      const match =
        /^\/api\/demo\/session\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
          route,
        );
      if (match) {
        const saved = await store.read<Session>(`session-${match[1]}`);
        if (!saved)
          return json(response, 404, { error: 'Sample session not found. Start a fresh sample.' });
        if (request.method === 'GET') return json(response, 200, saved);
        if (request.method === 'PUT') {
          const incoming = await body(request);
          if (!acceptableDataset(incoming))
            return json(response, 400, { error: 'The sample dataset has an invalid structure' });
          const next = { ...saved, dataset: incoming, updatedAt: new Date().toISOString() };
          await store.write(`session-${match[1]}`, next);
          return json(response, 200, next);
        }
      }
      if (route.startsWith('/api/operator/')) {
        if (!authorized(request, options.operatorToken))
          return json(response, 401, { error: 'A local operator credential is required' });
        if (route === '/api/operator/seed' && request.method === 'POST') {
          await store.write('canonical', createSampleDataset());
          return json(response, 200, { saved: true, fictionalData: true });
        }
        if (route === '/api/operator/reset-demo' && request.method === 'POST') {
          await store.clearSessions();
          return json(response, 200, { cleared: 'disposable-sessions-only' });
        }
      }
      if (route.startsWith('/api/'))
        return json(response, 404, { error: 'This local API route does not exist' });
      if (!['GET', 'HEAD'].includes(request.method ?? ''))
        return json(response, 405, { error: 'Method not allowed' });
      if (options.developmentMiddleware) {
        options.developmentMiddleware(request, response, () =>
          json(response, 404, { error: 'Page not found' }),
        );
        return;
      }
      if (!options.publicDirectory)
        return json(response, 404, {
          error: 'Build the application before starting the production server',
        });
      const base = path.resolve(options.publicDirectory);
      const requested = path.resolve(base, `.${decodeURIComponent(route)}`);
      if (requested !== base && !requested.startsWith(`${base}${path.sep}`))
        return json(response, 403, { error: 'Invalid path' });
      let target = requested;
      try {
        if (!(await stat(target)).isFile()) target = path.join(base, 'index.html');
      } catch {
        target = path.join(base, 'index.html');
      }
      const data = await readFile(target);
      response.writeHead(200, {
        'Content-Type': types[path.extname(target)] ?? 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-cache',
      });
      response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      const status = Number((error as { status?: number }).status) || 500;
      const message =
        status === 500
          ? 'Local state could not be read or saved. Existing files were preserved.'
          : (error as Error).message;
      json(response, status, { error: message });
    }
  });
  return server;
}
