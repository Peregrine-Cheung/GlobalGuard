import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { evaluateModelContracts } from '../src/model-contract-evaluator.mjs';

const reportUrl = new URL('../docs/evidence/model-contracts-offline-2026-09-09.json', import.meta.url);
const report = await evaluateModelContracts();
const serialized = `${JSON.stringify(report, null, 2)}\n`;

if (process.argv.includes('--write')) {
  await fs.mkdir(new URL('../docs/evidence/', import.meta.url), { recursive: true });
  await fs.writeFile(reportUrl, serialized, 'utf8');
}
if (process.argv.includes('--check')) {
  const stored = JSON.parse(await fs.readFile(reportUrl, 'utf8'));
  assert.deepEqual(stored, report, 'MODEL_CONTRACT_REPORT_OUTDATED');
}

console.log(serialized.trimEnd());
if (!report.totals.allPassed) process.exitCode = 1;
