import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = fileURLToPath(new URL('..', import.meta.url));
const tests = fs.readdirSync(path.join(appDir, 'tests'))
  .filter(name => name.endsWith('.test.mjs'))
  .sort()
  .map(name => path.join('tests', name));
const steps = [
  { id: 'node-tests', args: ['--test', ...tests] },
  { id: 'rule-regression', args: ['scripts/evaluate.mjs'] },
  { id: 'model-fact-contracts', args: ['scripts/evaluate-model-contracts.mjs', '--check'] },
  { id: 'adversarial-contract-simulation', args: ['scripts/simulate-model-contract-attacks.mjs'] },
  { id: 'visual-fixtures', args: ['scripts/build-visual-eval-fixtures.mjs', '--check'] },
  { id: 'visual-robustness-fixtures', args: ['scripts/build-visual-robustness-fixtures.mjs', '--check'] }
];
const results = [];
for (const step of steps) {
  console.log(`\n=== ${step.id} ===`);
  const result = spawnSync(process.execPath, step.args, { cwd: appDir, stdio: 'inherit', windowsHide: true });
  results.push({ id: step.id, passed: result.status === 0, exitCode: result.status });
  if (result.status !== 0) break;
}
const summary = {
  mode: 'offline-demo-verification',
  realModelCalls: 0,
  browserCheckIncluded: false,
  results,
  allPassed: results.length === steps.length && results.every(result => result.passed),
  browserCommand: 'npm run check:browser'
};
console.log(`\n${JSON.stringify(summary, null, 2)}`);
if (!summary.allPassed) process.exitCode = 1;
