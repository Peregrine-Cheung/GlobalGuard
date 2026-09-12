// Manual, single-request EU schema smoke. Preview is the default and never calls the provider.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../src/load-local-env.mjs';
import { modelRouterStatus } from '../src/model-router.mjs';
import { buildEuSmokePreview, runEuSmoke } from '../src/eu-live-smoke.mjs';

const args = process.argv.slice(2);
const allowed = new Set(['--write-preview', '--execute', '--confirm-one-request']);
if (args.some(arg => !allowed.has(arg))) throw new Error('INVALID_ARGUMENT');
const execute = args.includes('--execute');
const confirmed = args.includes('--confirm-one-request');
if (execute !== confirmed) throw new Error('EU_LIVE_SMOKE_REQUIRES_BOTH_EXECUTE_FLAGS');

await loadLocalEnv(new URL('../.env.local', import.meta.url));
const outDir = fileURLToPath(new URL('../../tmp/eu-live-smoke/', import.meta.url));
await fs.mkdir(outDir, { recursive: true });

if (!execute) {
  const preview = buildEuSmokePreview(modelRouterStatus());
  const previewPath = path.join(outDir, 'preview.json');
  await fs.writeFile(previewPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...preview, previewPath }, null, 2));
  process.exit(0);
}

const rulepack = JSON.parse(await fs.readFile(new URL('../config/rulepacks/v1.0.0.json', import.meta.url), 'utf8'));
const outputPath = path.join(outDir, `result-${Date.now()}.json`);
try {
  const result = await runEuSmoke(rulepack);
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({
    ok: true,
    outputPath,
    requestId: result.telemetry?.requestId || null,
    usage: result.telemetry?.usage || null,
    validatedFieldCount: result.euFieldFacts.length,
    notice: '单次合成数据结构冒烟通过，不代表准确率、法律正确性或平台审核通过。'
  }, null, 2));
} catch (error) {
  const failure = {
    ok: false,
    failedAt: new Date().toISOString(),
    code: String(error?.message || error).split(':')[0],
    validationIssue: error?.validationIssue || null,
    telemetry: error?.telemetry || null,
    notice: '未保存供应商原始响应正文或凭据。'
  };
  await fs.writeFile(outputPath, `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
  console.error(JSON.stringify({ ...failure, outputPath }, null, 2));
  process.exitCode = 1;
}
