import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../src/load-local-env.mjs';
import { analyzeWithModelRouter, modelRouterStatus } from '../src/model-router.mjs';
import { evaluateVisualFixtureRuns } from '../src/visual-model-evaluator.mjs';

const args = process.argv.slice(2);
const tenRequestMode = args.length === 2 && args.includes('--execute') && args.includes('--confirm-ten-requests');
const sixRequestMode = args.length === 2 && args.includes('--execute') && args.includes('--confirm-six-v6-requests');
if (!tenRequestMode && !sixRequestMode) {
  throw new Error('ROBUSTNESS_LIVE_EVAL_REQUIRES_EXPLICIT_REQUEST_COUNT_CONFIRMATION');
}

const TARGET_IDS = sixRequestMode
  ? new Set(['robustness-01', 'robustness-04', 'robustness-05', 'robustness-07', 'robustness-08', 'robustness-10'])
  : null;
const MAX_PROVIDER_REQUESTS = sixRequestMode ? 6 : 10;
const TOKEN_BUDGET = sixRequestMode ? 15000 : 25000;
const NEXT_REQUEST_RESERVE = 3000;
await loadLocalEnv(new URL('../.env.local', import.meta.url));
const status = modelRouterStatus();
if (!status.configured || !status.appUseApproved) throw new Error('ROBUSTNESS_LIVE_EVAL_NOT_AUTHORIZED_OR_CONFIGURED');

const truth = JSON.parse(await fs.readFile(new URL('../fixtures/visual-robustness-v1/construction-truth.json', import.meta.url), 'utf8'));
const human = JSON.parse(await fs.readFile(new URL('../fixtures/visual-robustness-v1/human-annotations.single-review-2026-09-11.json', import.meta.url), 'utf8'));
if (truth.datasetId !== human.datasetId || truth.cases.length !== 10 || human.cases.length !== 10) {
  throw new Error('ROBUSTNESS_REFERENCE_MISMATCH');
}

const require = createRequire(process.env.GLOBALGUARD_QA_MODULES
  ? path.join(process.env.GLOBALGUARD_QA_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const assetDir = fileURLToPath(new URL('../public/robustness-fixtures/', import.meta.url));
const outputDir = fileURLToPath(new URL('../../tmp/visual-robustness-eval/', import.meta.url));
const pngDir = path.join(outputDir, 'rendered-png');
await fs.mkdir(pngDir, { recursive: true });
const runStartedAt = Date.now();
const checkpointPath = path.join(outputDir, `checkpoint-${sixRequestMode ? 'v6-six' : 'v5-ten'}-${runStartedAt}.json`);
const rulepack = JSON.parse(await fs.readFile(new URL('../config/rulepacks/v1.0.0.json', import.meta.url), 'utf8'));
const runs = [];
let totalTokens = 0;
async function saveCheckpoint() {
  await fs.writeFile(checkpointPath, `${JSON.stringify({
    schemaVersion: '1.0', kind: 'incremental-visual-robustness-live-checkpoint',
    provider: status.provider, selectedModel: status.primaryModel,
    observationPolicy: status.observationPolicies.US_GOOGLE,
    maxProviderRequests: MAX_PROVIDER_REQUESTS, tokenBudget: TOKEN_BUDGET,
    retryDisabled: true, fallbackDisabled: true, totalTokens, runs
  }, null, 2)}\n`, 'utf8');
}
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 });
  const selectedCases = TARGET_IDS ? truth.cases.filter(item => TARGET_IDS.has(item.id)) : truth.cases;
  if (selectedCases.length !== MAX_PROVIDER_REQUESTS) throw new Error('ROBUSTNESS_TARGET_COUNT_MISMATCH');
  for (const [index, item] of selectedCases.entries()) {
    if (totalTokens + NEXT_REQUEST_RESERVE > TOKEN_BUDGET) {
      runs.push({ id: item.id, status: 'not_attempted', errorCode: 'TOKEN_BUDGET_GUARD' });
      await saveCheckpoint();
      console.log(JSON.stringify({ progress: `${index}/${MAX_PROVIDER_REQUESTS}`, id: item.id, status: 'not_attempted', totalTokens, reason: 'TOKEN_BUDGET_GUARD' }));
      continue;
    }
    const svg = await fs.readFile(path.join(assetDir, item.filename), 'utf8');
    await page.setContent(`<style>html,body{margin:0;width:720px;height:720px;overflow:hidden}svg{display:block}</style>${svg}`);
    const pngPath = path.join(pngDir, `${item.id}.png`);
    await page.screenshot({ path: pngPath, type: 'png' });
    const bytes = await fs.readFile(pngPath);
    let validated = null;
    try {
      const result = await analyzeWithModelRouter({
        route: 'US_GOOGLE', category: 'home-storage',
        productTitle: 'Synthetic folding storage box',
        productCopy: 'Repository-owned deterministic robustness fixture.',
        image: { width: 720, height: 720, name: `${item.id}.png`, mimeType: 'image/png' },
        imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}`, visualSignals: {}
      }, rulepack, {
        allowFallback: false,
        captureValidatedOutput(value) { validated = structuredClone(value); }
      });
      const used = result.telemetry?.usage?.totalTokens || 0;
      totalTokens += used;
      runs.push({ id: item.id, status: 'passed', prediction: validated, telemetry: result.telemetry });
      await saveCheckpoint();
      console.log(JSON.stringify({ progress: `${index + 1}/${MAX_PROVIDER_REQUESTS}`, id: item.id, status: 'passed', tokens: used, totalTokens, requestId: result.telemetry?.requestId || null }));
    } catch (error) {
      const used = error?.telemetry?.usage?.totalTokens || 0;
      totalTokens += used;
      runs.push({ id: item.id, status: 'failed', errorCode: String(error?.message || error).split(':')[0], validationIssue: error?.validationIssue || null, telemetry: error?.telemetry || null });
      await saveCheckpoint();
      console.log(JSON.stringify({ progress: `${index + 1}/${MAX_PROVIDER_REQUESTS}`, id: item.id, status: 'failed', errorCode: String(error?.message || error).split(':')[0], tokens: used, totalTokens }));
    }
  }
} finally {
  await browser?.close();
}

const runSet = {
  schemaVersion: '1.0', kind: sixRequestMode
    ? 'six-request-targeted-us-visual-robustness-v6-evaluation'
    : 'ten-request-synthetic-us-visual-robustness-evaluation',
  executedAt: new Date().toISOString(), provider: status.provider, selectedModel: status.primaryModel,
  observationPolicy: status.observationPolicies.US_GOOGLE,
  maxProviderRequests: MAX_PROVIDER_REQUESTS, fallbackDisabled: true, retryDisabled: true,
  tokenBudget: TOKEN_BUDGET, nextRequestReserve: NEXT_REQUEST_RESERVE,
  inputClassification: 'deterministic-synthetic-non-sensitive', runs
};
const evaluation = evaluateVisualFixtureRuns(human, runSet, {
  caseIds: TARGET_IDS ? [...TARGET_IDS] : null
});
const evidence = { ...runSet, totalTokens, evaluation };
const outputPath = path.join(outputDir, `result-${Date.now()}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  complete: runs.every(run => run.status === 'passed'), outputPath,
  checkpointPath,
  requestsAttempted: runs.filter(run => run.status !== 'not_attempted').length,
  requestSucceeded: evaluation.totals.requestSucceeded,
  contractPassed: evaluation.totals.contractPassed,
  strictSingleHumanAgreement: evaluation.totals.strictAgreement,
  strictSingleHumanAgreementRate: evaluation.totals.strictSingleHumanAgreementRate,
  totalTokens, tokenBudget: TOKEN_BUDGET,
  notice: evaluation.notice
}, null, 2));
if (!runs.every(run => run.status === 'passed')) process.exitCode = 1;
