import { createSampleDataset, evaluateReplay, buildScenarios, money } from '../src/domain/index.js';

const dataset = createSampleDataset();
const evaluation = evaluateReplay(dataset);
const scenarios = buildScenarios(dataset, '2026-11-05', {
  amount: money('240'),
  date: '2026-11-08',
});
console.log(
  JSON.stringify(
    {
      datasetId: dataset.id,
      provenance: 'fictional',
      asOf: '2026-11-05',
      horizonDays: 30,
      evaluation,
      purchaseExample: {
        amount: '240.00',
        date: '2026-11-08',
        scenarios: scenarios.map(
          ({
            id,
            through,
            minimum,
            minimumDate,
            purchaseMinimum,
            purchaseShortfall,
            bufferBreach,
          }) => ({
            id,
            through,
            minimum,
            minimumDate,
            purchaseMinimum,
            purchaseShortfall,
            bufferBreach,
          }),
        ),
      },
    },
    null,
    2,
  ),
);
