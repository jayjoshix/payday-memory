import { readdir, readFile } from 'node:fs/promises';
const files = (await readdir('dist/assets')).filter((name) => /\.(js|css)$/.test(name));
for (const file of files) {
  const text = await readFile(`dist/assets/${file}`, 'utf8');
  if (
    /MEMWAL_KEY|TATUM_API_KEY|BEGIN PRIVATE KEY|@mysten-incubation\/memwal|sui-mainnet-grpc\.gateway/.test(
      text,
    )
  )
    throw new Error(`Server-only sponsor material leaked into ${file}`);
}
console.log(
  `Checked ${files.length} browser assets: no server-only credential names or sponsor clients.`,
);
