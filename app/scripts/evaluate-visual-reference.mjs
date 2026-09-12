import fs from 'node:fs/promises';
import path from 'node:path';
import { evaluateVisualFixtureRuns } from '../src/visual-model-evaluator.mjs';

const [referencePath, runPath] = process.argv.slice(2);
if (!referencePath || !runPath || process.argv.length !== 4) {
  throw new Error('USAGE: node scripts/evaluate-visual-reference.mjs <reference.json> <model-run.json>');
}
async function readJsonFile(filename) {
  const absolute = path.resolve(filename);
  const stat = await fs.stat(absolute);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) throw new Error('INVALID_EVALUATION_FILE');
  return JSON.parse(await fs.readFile(absolute, 'utf8'));
}
const report = evaluateVisualFixtureRuns(await readJsonFile(referencePath), await readJsonFile(runPath));
console.log(JSON.stringify(report, null, 2));

