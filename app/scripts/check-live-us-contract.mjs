import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLocalEnv } from '../src/load-local-env.mjs';
import { modelRouterStatus } from '../src/model-router.mjs';
import { buildUsSmokePreview, runUsSmoke } from '../src/us-live-smoke.mjs';

const args = process.argv.slice(2);
const allowed = new Set(['--execute', '--confirm-one-request']);
if (args.some(arg => !allowed.has(arg))) throw new Error('INVALID_ARGUMENT');
const execute = args.includes('--execute');
if (execute !== args.includes('--confirm-one-request')) throw new Error('US_LIVE_SMOKE_REQUIRES_BOTH_EXECUTE_FLAGS');
await loadLocalEnv(new URL('../.env.local', import.meta.url));
const outDir = fileURLToPath(new URL('../../tmp/us-live-smoke/', import.meta.url));
await fs.mkdir(outDir, { recursive: true });

if (!execute) {
  const preview = buildUsSmokePreview(modelRouterStatus());
  const previewPath = path.join(outDir, 'preview.json');
  await fs.writeFile(previewPath, `${JSON.stringify(preview, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ...preview, previewPath }, null, 2));
  process.exit(0);
}

const fixturePath = fileURLToPath(new URL('../../tmp/browser-qa/original.png', import.meta.url));
const bytes = await fs.readFile(fixturePath);
if (bytes.length > 2 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
  throw new Error('US_LIVE_SMOKE_INVALID_PNG');
}
const image = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), dataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
const rulepack = JSON.parse(await fs.readFile(new URL('../config/rulepacks/v1.0.0.json', import.meta.url), 'utf8'));
const outputPath = path.join(outDir, `result-${Date.now()}.json`);
try {
  const result = await runUsSmoke(rulepack, image);
  await fs.writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ ok: true, outputPath, requestId: result.telemetry?.requestId || null,
    usage: result.telemetry?.usage || null, textRegionCount: result.normalized.textRegions.length,
    findingCount: result.normalized.findings.length,
    notice: '单次合成图片结构冒烟通过，不代表OCR准确率、区域准确率、法律正确性或平台审核通过。' }, null, 2));
} catch (error) {
  const failure = { ok: false, failedAt: new Date().toISOString(), code: String(error?.message || error).split(':')[0],
    validationIssue: error?.validationIssue || null, telemetry: error?.telemetry || null,
    notice: '未保存供应商原始响应正文、图片Base64或凭据。' };
  await fs.writeFile(outputPath, `${JSON.stringify(failure, null, 2)}\n`, 'utf8');
  console.error(JSON.stringify({ ...failure, outputPath }, null, 2));
  process.exitCode = 1;
}
