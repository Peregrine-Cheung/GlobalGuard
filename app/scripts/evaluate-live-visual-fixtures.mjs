import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../src/load-local-env.mjs';
import { analyzeWithModelRouter, modelRouterStatus } from '../src/model-router.mjs';
import { evaluateVisualFixtureRuns } from '../src/visual-model-evaluator.mjs';

const args = process.argv.slice(2);
const allowed = new Set(['--execute', '--confirm-six-requests']);
const casesArg = args.find(arg => arg.startsWith('--cases='));
if (args.some(arg => !allowed.has(arg) && arg !== casesArg)) throw new Error('INVALID_ARGUMENT');
const execute = args.includes('--execute');
if (execute !== args.includes('--confirm-six-requests')) {
  throw new Error('VISUAL_LIVE_EVAL_REQUIRES_BOTH_EXECUTE_FLAGS');
}

await loadLocalEnv(new URL('../.env.local', import.meta.url));
const status = modelRouterStatus();
const truth = JSON.parse(await fs.readFile(new URL('../fixtures/visual-eval-v1/construction-truth.json', import.meta.url), 'utf8'));
const selectedIds = casesArg ? casesArg.slice('--cases='.length).split(',').filter(Boolean) : truth.cases.map(item => item.id);
if (!selectedIds.length || new Set(selectedIds).size !== selectedIds.length
    || selectedIds.some(id => !truth.cases.some(item => item.id === id))) throw new Error('INVALID_CASE_SELECTION');
const selectedCases = truth.cases.filter(item => selectedIds.includes(item.id));
const preview = {
  schemaVersion: '1.0',
  mode: execute ? 'execute' : 'preview',
  willCallProvider: execute,
  provider: status.provider,
  baseUrl: status.baseUrl,
  primaryModel: status.primaryModel,
  configured: status.configured,
  appUseApproved: status.appUseApproved,
  datasetId: truth.datasetId,
  inputClassification: 'deterministic-synthetic-non-sensitive',
  cases: selectedCases.map(item => ({ id: item.id, filename: item.filename })),
  maxProviderRequests: selectedCases.length,
  fallbackDisabled: true,
  retryDisabled: true,
  scoring: 'synthetic-construction-agreement-not-model-accuracy',
  executeAuthorization: ['--execute', '--confirm-six-requests', casesArg || '(all six cases)'],
  notice: '执行模式逐图最多一次请求；失败不重试、不回退。构造真值仅在全部模型请求结束后进入本地计分。'
};

const outputDir = fileURLToPath(new URL('../../tmp/visual-live-eval/', import.meta.url));
await fs.mkdir(outputDir, { recursive: true });
if (!execute) {
  const outputPath = path.join(outputDir, 'preview.json');
  await fs.writeFile(outputPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...preview, outputPath }, null, 2));
  process.exit(0);
}
if (!status.configured || !status.appUseApproved) throw new Error('VISUAL_LIVE_EVAL_NOT_AUTHORIZED_OR_CONFIGURED');

const require = createRequire(process.env.GLOBALGUARD_QA_MODULES
  ? path.join(process.env.GLOBALGUARD_QA_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const assetDir = fileURLToPath(new URL('../public/visual-fixtures/', import.meta.url));
const pngDir = path.join(outputDir, 'rendered-png');
await fs.mkdir(pngDir, { recursive: true });
const rulepack = JSON.parse(await fs.readFile(new URL('../config/rulepacks/v1.0.0.json', import.meta.url), 'utf8'));
const runs = [];
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 720, height: 720 }, deviceScaleFactor: 1 });
  for (const item of selectedCases) {
    const svg = await fs.readFile(path.join(assetDir, item.filename), 'utf8');
    await page.setContent(`<style>html,body{margin:0;width:720px;height:720px;overflow:hidden}svg{display:block}</style>${svg}`);
    const pngPath = path.join(pngDir, `${item.id}.png`);
    await page.screenshot({ path: pngPath, type: 'png' });
    const bytes = await fs.readFile(pngPath);
    let validated = null;
    try {
      const result = await analyzeWithModelRouter({
        route: 'US_GOOGLE',
        category: 'home-storage',
        productTitle: 'Synthetic folding storage box',
        productCopy: 'Repository-owned deterministic visual evaluation fixture.',
        image: { width: 720, height: 720, name: `${item.id}.png`, mimeType: 'image/png' },
        imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        visualSignals: {}
      }, rulepack, {
        allowFallback: false,
        captureValidatedOutput(value) { validated = structuredClone(value); }
      });
      runs.push({
        id: item.id,
        status: 'passed',
        prediction: validated,
        telemetry: result.telemetry
      });
    } catch (error) {
      runs.push({
        id: item.id,
        status: 'failed',
        errorCode: String(error?.message || error).split(':')[0],
        validationIssue: error?.validationIssue || null,
        telemetry: error?.telemetry || null
      });
    }
  }
} finally {
  await browser?.close();
}

const runSet = {
  schemaVersion: '1.0',
  kind: 'six-request-synthetic-us-visual-evaluation',
  executedAt: new Date().toISOString(),
  provider: status.provider,
  selectedModel: status.primaryModel,
  observationPolicy: status.observationPolicies.US_GOOGLE,
  maxProviderRequests: selectedCases.length,
  fallbackDisabled: true,
  retryDisabled: true,
  inputClassification: 'deterministic-synthetic-non-sensitive',
  runs
};
const selectedReference = { ...truth, cases: truth.cases.filter(item => selectedIds.includes(item.id)) };
const evaluation = evaluateVisualFixtureRuns(selectedReference, runSet);
const totalTokens = runs.reduce((sum, run) => sum + (run.telemetry?.usage?.totalTokens || 0), 0);
const evidence = { ...runSet, totalTokens, evaluation };
const outputPath = path.join(outputDir, `result-${Date.now()}.json`);
await fs.writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({
  ok: evaluation.totals.requestSucceeded === selectedCases.length,
  outputPath,
  requestsAttempted: runs.length,
  requestSucceeded: evaluation.totals.requestSucceeded,
  contractPassed: evaluation.totals.contractPassed,
  strictConstructionAgreement: evaluation.totals.strictAgreement,
  strictConstructionAgreementRate: evaluation.totals.strictConstructionAgreementRate,
  totalTokens,
  requestIds: runs.map(run => run.telemetry?.requestId || null),
  notice: evaluation.notice
}, null, 2));
if (evaluation.totals.requestSucceeded !== selectedCases.length) process.exitCode = 1;
