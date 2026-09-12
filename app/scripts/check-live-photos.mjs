// Manual, bounded real-photo experiment; never run automatically in CI.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { loadLocalEnv } from '../src/load-local-env.mjs';
import { modelRouterStatus } from '../src/model-router.mjs';
const appDir = fileURLToPath(new URL('..', import.meta.url));
const allowed = ['tray-deep', 'basket-clothes', 'drawers-store'];
const args = process.argv.slice(2);
if (args.some(a => a !== '--execute' && !/^--case=(tray-deep|basket-clothes|drawers-store)$/.test(a))) throw new Error('INVALID_ARGUMENT');
const selected = args.find(a => a.startsWith('--case='))?.slice(7);
const ids = selected ? [selected] : allowed;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await fs.readFile(new URL('../public/samples/manifest.json', import.meta.url), 'utf8'));
const prepared = await Promise.all(ids.map(async id => {
  const item = manifest.samples.find(s => s.id === id);
  if (!item || item.generated || item.merchantEvidence) throw new Error('INVALID_PHOTO');
  const bytes = await fs.readFile(new URL(`../public/samples/${id}.jpg`, import.meta.url));
  if (sha(bytes) !== item.sha256 || bytes.length > 2 * 1024 * 1024 || bytes[0] !== 255 || bytes[1] !== 216) throw new Error('PHOTO_INTEGRITY_FAILED');
  return { item, imageDataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}` };
}));
if (!args.includes('--execute')) {
  console.log(JSON.stringify({ dryRun: true, cases: ids, maxApplicationRequests: ids.length, notice: '使用 --execute 才调用模型；不读取人工预期标签，不发送私人文件。模型回退可能额外消耗额度。' }));
  process.exit(0);
}
await loadLocalEnv(new URL('../.env.local', import.meta.url));
if (!modelRouterStatus().configured || !modelRouterStatus().appUseApproved) throw new Error('LIVE_TEST_NOT_AUTHORIZED_OR_CONFIGURED');
const outDir = fileURLToPath(new URL('../../tmp/live-photos/', import.meta.url));
await fs.mkdir(outDir, { recursive: true });
const outputPath = path.join(outDir, `photos-${Date.now()}.json`);
const report = {
  schemaVersion: '1.0', startedAt: new Date().toISOString(), kind: 'open-license-real-photo-development-check',
  modelRouterSha256: sha(await fs.readFile(new URL('../src/model-router.mjs', import.meta.url))),
  visualPolicySha256: sha(await fs.readFile(new URL('../src/us-visual-facts.mjs', import.meta.url))),
  rulepackSha256: sha(await fs.readFile(new URL('../config/rulepacks/v1.0.0.json', import.meta.url))),
  gitHead: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', windowsHide: true }).trim(),
  notice: '开发检查不是独立人工评测或准确率。每次新上下文，无预期标签。原始 JPEG 直达应用后端，与UI转PNG不是同一次请求。',
  plannedCases: ids, cases: [], overall: 'pending'
};
const serverArgs = process.allowedNodeEnvironmentFlags.has('--use-env-proxy')
  && (process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY)
  ? ['--use-env-proxy', 'server.mjs']
  : ['server.mjs'];
const child = spawn(process.execPath, serverArgs, {
  cwd: appDir,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HOST: '127.0.0.1', PORT: '0' }
});
const exited = once(child, 'exit');
try {
  const baseUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('LOCAL_SERVER_TIMEOUT')), 8000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('LOCAL_SERVER_FAILED')); });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('LOCAL_SERVER_EXIT')); });
    child.stdout.on('data', data => {
      output += data.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  for (const { item, imageDataUrl } of prepared) {
    const input = {
      mode: 'live', route: 'US_GOOGLE', category: 'home-storage', productTitle: item.title,
      productCopy: '公开许可照片的家居收纳测试，不提供隐藏卖家档案或检测结论。',
      image: { name: `${item.id}.jpg`, ...item.dimensions, mimeType: 'image/jpeg' },
      imageDataUrl, visualSignals: {}
    };
    const response = await fetch(`${baseUrl}/api/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(95000) });
    const result = await response.json();
    const { imageDataUrl: excluded, ...inputSnapshot } = input;
    report.cases.push({ id: item.id, sourceSha256: item.sha256, inputSnapshot, httpStatus: response.status, result });
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ id: item.id, status: result.summary?.status, ai: result.ai, risks: result.risks?.map(r => ({ origin: r.origin, ruleId: r.ruleId, title: r.title, finding: r.finding })) }, null, 2));
    if (!response.ok || result.ai?.status !== 'live') throw new Error('LIVE_CASE_FAILED');
  }
  report.overall = 'selected_backend_responses_received_not_quality_pass';
} catch (error) {
  report.overall = 'failed';
  report.failure = /^(LOCAL_SERVER|LIVE_CASE)/.test(error.message) ? error.message : 'LIVE_PHOTO_CHECK_FAILED';
  console.error(report.failure); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(`LOCAL_REPORT: ${outputPath}`);
  child.kill(); await exited;
}
