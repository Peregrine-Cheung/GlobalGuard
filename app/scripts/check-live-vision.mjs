import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { loadLocalEnv } from '../src/load-local-env.mjs';
import { modelRouterStatus } from '../src/model-router.mjs';

// Manual, capped two-image backend acceptance check. Uses only repository-owned
// synthetic fixtures, never accepts an arbitrary path or the authorization email.
await loadLocalEnv(new URL('../.env.local', import.meta.url));
const status = modelRouterStatus();
if (!status.configured || !status.appUseApproved) throw new Error('LIVE_TEST_REQUIRES_KEY_AND_APPLICATION_AUTHORIZATION');
const appDir = fileURLToPath(new URL('..', import.meta.url));
const caseSelector = process.argv[2] || 'both';
if (!['both', 'original', 'draft'].includes(caseSelector)) throw new Error('ONLY_SYNTHETIC_CASE_NAMES_ALLOWED');
const cases = [
  { id: 'original', file: new URL('../../tmp/browser-qa/original.png', import.meta.url), endpoint: 'analyze' },
  { id: 'draft', file: new URL('../../tmp/browser-qa/image-draft.png', import.meta.url), endpoint: 'recheck' }
].filter(item => caseSelector === 'both' || item.id === caseSelector);
const prepared = await Promise.all(cases.map(async item => {
  const bytes = await fs.readFile(item.file);
  if (bytes.length > 2 * 1024 * 1024 || bytes.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('INVALID_LOCAL_TEST_FIXTURE');
  return { ...item, width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}` };
}));
const outputDir = fileURLToPath(new URL('../../tmp/live-vision/', import.meta.url));
await fs.mkdir(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `result-${Date.now()}.json`);
const child = spawn(process.execPath, ['server.mjs'], {
  cwd: appDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HOST: '127.0.0.1', PORT: '0' }
});
const exited = once(child, 'exit');
const report = { startedAt: new Date().toISOString(), fixtureType: 'synthetic', applicationBackend: true, cases: [], overall: 'pending' };
try {
  const baseUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('LOCAL_SERVER_START_TIMEOUT')), 8000);
    child.on('error', () => { clearTimeout(timer); reject(new Error('LOCAL_SERVER_START_FAILED')); });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('LOCAL_SERVER_EARLY_EXIT')); });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  for (const item of prepared) {
    const response = await fetch(`${baseUrl}/api/${item.endpoint}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(100000),
      body: JSON.stringify({
        mode: 'live', route: 'US_GOOGLE', category: 'home-storage',
        productTitle: '可折叠家居收纳箱', productCopy: '本地合成演示素材，非真实商家样本。',
        image: { width: item.width, height: item.height, name: `${item.id}.png`, mimeType: 'image/png' },
        imageDataUrl: item.imageDataUrl,
        visualSignals: {},
        previousAnalysisId: report.cases[0]?.result.analysisId || ''
      })
    });
    const result = await response.json();
    report.cases.push({ id: item.id, result });
    await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
    if (!response.ok || result.ai?.status !== 'live') throw new Error(`LIVE_CASE_FAILED_${item.id}`);
    console.log(JSON.stringify({ case: item.id, ai: result.ai, risks: result.risks.map(r => ({ title: r.title, finding: r.finding, origin: r.origin })), status: result.summary.status }, null, 2));
  }
  report.overall = 'all_selected_real_backend_responses_received';
} catch (error) {
  report.overall = 'failed';
  report.failure = /^LIVE_CASE_FAILED_|^LOCAL_SERVER_/.test(error.message || '') ? error.message : 'LIVE_TEST_FAILED';
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(outputPath, JSON.stringify(report, null, 2));
  console.log(`LOCAL_REPORT: ${outputPath}`);
  child.kill();
  await exited;
}
