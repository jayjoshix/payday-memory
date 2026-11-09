import path from 'node:path';
import { createSampleDataset, validateDataset } from '../src/domain/index.js';
import { AtomicJsonStore } from '../src/server/store.js';

const store = new AtomicJsonStore(path.resolve('.data'));
const action = process.argv[2];
if (action === 'seed') {
  const sample = createSampleDataset();
  validateDataset(sample);
  await store.write('canonical', sample);
  console.log(
    'Seeded the fictional canonical dataset in .data/canonical.json. No external calls were made.',
  );
} else if (action === 'reset') {
  await store.clearSessions();
  console.log(
    'Cleared disposable server sessions only. Canonical data, sponsor jobs and published memories were preserved. Use New sample in the browser to clear its disposable copy.',
  );
} else {
  throw new Error('Use demo.ts seed or demo.ts reset');
}
