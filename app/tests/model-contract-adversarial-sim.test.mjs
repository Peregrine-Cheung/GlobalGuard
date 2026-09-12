import test from 'node:test';
import assert from 'node:assert/strict';
import { runAdversarialSimulation } from '../src/model-contract-adversarial-sim.mjs';

test('ninety deterministic adversarial contract mutations are rejected', () => {
  const report = runAdversarialSimulation(30);
  assert.equal(report.totals.trials, 90);
  assert.equal(report.totals.rejected, 90);
  assert.equal(report.totals.survivors, 0);
  assert.equal(report.allExpectedMutationsRejected, true);
  assert.match(report.notice, /不代表模型准确率/);
  for (const route of report.results) assert.ok(Object.keys(route.errorCounts).length >= 6);
});
