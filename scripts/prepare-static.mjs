import { readFile, writeFile, mkdir } from 'node:fs/promises';
const evidence = JSON.parse(await readFile('evidence/manifest.json', 'utf8'));
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .filter(
          ([key]) => !/secret|private.?key|api.?key|authorization|credential|token$/i.test(key),
        )
        .map(([key, item]) => [key, redact(item)]),
    );
  return value;
}
await mkdir('public', { recursive: true });
await writeFile(
  'public/evidence.json',
  JSON.stringify(
    {
      ...redact(evidence),
      evidenceMode: 'captured',
      staticCopyPreparedAt: new Date().toISOString(),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Prepared redacted captured evidence for the static replay. No provider requests made.',
);
