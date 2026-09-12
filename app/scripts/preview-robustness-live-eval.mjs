import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../src/load-local-env.mjs';
import { modelRouterStatus } from '../src/model-router.mjs';

if (process.argv.length !== 2) throw new Error('PREVIEW_ONLY_NO_ARGUMENTS');

await loadLocalEnv(new URL('../.env.local', import.meta.url));
const status = modelRouterStatus();
const truth = JSON.parse(await fs.readFile(new URL('../fixtures/visual-robustness-v1/construction-truth.json', import.meta.url), 'utf8'));
const prior = JSON.parse(await fs.readFile(new URL('../docs/evidence/visual-fixtures-live-v5-2026-09-10.json', import.meta.url), 'utf8'));
const priorTokensPerRequest = prior.final.totalTokens / prior.final.providerResponses;
const nominalTokens = Math.round(priorTokensPerRequest * truth.cases.length / 100) * 100;
const preview = {
  schemaVersion: '1.0', mode: 'preview-only', willCallProvider: false,
  datasetId: truth.datasetId, cases: truth.cases.map(item => ({ id: item.id, filename: item.filename })),
  provider: status.provider, primaryModel: status.primaryModel,
  configured: status.configured, appUseApproved: status.appUseApproved,
  inputClassification: 'deterministic-synthetic-non-sensitive',
  executionPlan: {
    maxProviderRequests: truth.cases.length, fallbackDisabled: true, retryDisabled: true,
    scoreOnlyAfterAllRequests: true, requiredHumanReference: 'completed-single-human-review'
  },
  tokenEstimate: {
    basis: 'previous six-case qwen3.7-plus final run', priorRequests: prior.final.providerResponses,
    priorTotalTokens: prior.final.totalTokens,
    priorAverageTokensPerRequest: Number(priorTokensPerRequest.toFixed(2)),
    nominalTotalTokens: nominalTokens, planningRangeTokens: [15000, 25000], hardStopPlannedAtTokens: 25000,
    caveat: '估算不是计费承诺；图像复杂度和供应商计量可能改变实际Token。'
  },
  blockedUntil: ['人工盲标文件结构校验通过', '再次明确批准最多10次真实模型请求'],
  notice: '本文件只生成本地调用预览，不访问供应商、不消耗模型Token，也不证明模型准确率。'
};
const outputDir = fileURLToPath(new URL('../../tmp/visual-robustness-eval/', import.meta.url));
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, 'preview.json');
await fs.writeFile(outputPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ ...preview, outputPath }, null, 2));
