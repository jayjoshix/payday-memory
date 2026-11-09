import path from 'node:path';
import { createAppServer } from './app.js';

// Only the explicitly named project file is loaded. No unrelated credential store is inspected.
try {
  process.loadEnvFile(path.resolve('.env.local'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
const development = process.argv.includes('--dev');
const port = Number(process.env.PORT ?? 4173);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('PORT must be between 1024 and 65535');
const vite = development
  ? await (await import('vite')).createServer({ server: { middlewareMode: true }, appType: 'spa' })
  : undefined;
const server = createAppServer({
  dataDirectory: path.resolve('.data'),
  publicDirectory: path.resolve('dist'),
  evidenceFile: path.resolve('evidence/manifest.json'),
  recoveryFile: path.resolve('evidence/recovered-sample.json'),
  operatorToken: process.env.PAYDAY_OPERATOR_TOKEN,
  developmentMiddleware: vite?.middlewares,
});
server.listen(port, '127.0.0.1', () =>
  console.log(
    `Payday Memory: http://127.0.0.1:${port} (${development ? 'development' : 'production'}; local replay)`,
  ),
);
async function close() {
  server.close();
  await vite?.close();
}
process.once('SIGINT', () => {
  void close();
});
process.once('SIGTERM', () => {
  void close();
});
