import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { evaluateModelContracts } from '../src/model-contract-evaluator.mjs';

test('three market fact contracts pass all synthetic accept and reject paths', async () => {
  const report = await evaluateModelContracts();
  assert.deepEqual(report.policies.map(policy => policy.policyVersion), [
    'us-visual-facts-v7', 'cn-ad-facts-v2', 'eu-offer-facts-v2'
  ]);
  assert.equal(report.totals.policies, 3);
  assert.equal(report.totals.cases, 27);
  assert.equal(report.totals.passed, 27);
  assert.equal(report.totals.allPassed, true);
  assert.equal(report.modelAccuracyMeasured, false);
  assert.equal(report.legalCorrectnessMeasured, false);
});

test('stored contract report matches the deterministic evaluator output', async () => {
  const expected = await evaluateModelContracts();
  const stored = JSON.parse(await fs.readFile(new URL('../docs/evidence/model-contracts-offline-2026-09-09.json', import.meta.url), 'utf8'));
  assert.deepEqual(stored, expected);
  assert.match(stored.notice, /不测量模型准确率/);
});
