import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

// Optional local QA tooling, not a runtime dependency or cloud test.
const require = createRequire(process.env.GLOBALGUARD_QA_MODULES
  ? path.join(process.env.GLOBALGUARD_QA_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const appDir = fileURLToPath(new URL('..', import.meta.url));
const outputDir = fileURLToPath(new URL('../../tmp/browser-qa/', import.meta.url));
await fs.mkdir(outputDir, { recursive: true });
const denyFetch = 'data:text/javascript,globalThis.fetch=async()=>{throw new Error("QA_EXTERNAL_REQUEST_BLOCKED")}';
const child = spawn(process.execPath, ['--import', denyFetch, 'server.mjs'], {
  cwd: appDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env, HOST: '127.0.0.1', PORT: '0',
    MODEL_ROUTER_API_KEY: 'qa-only-placeholder', MODEL_ROUTER_APP_USE_APPROVED: '0',
    MODEL_ROUTER_BASE_URL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    MODEL_ROUTER_MODEL: 'qwen3.7-plus', MODEL_ROUTER_FALLBACK_MODEL: 'qwen3.6-plus'
  }
});
const exited = once(child, 'exit');
let browser;
const checks = [];
try {
  const baseUrl = await new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error('QA_SERVER_START_TIMEOUT')), 8000);
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', () => { clearTimeout(timer); reject(new Error('QA_SERVER_EARLY_EXIT')); });
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) { clearTimeout(timer); resolve(match[0]); }
    });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  await context.route('**/*', route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.setDefaultTimeout(10000);
  await page.goto(baseUrl);
  await page.locator('#runtime-status').filter({ hasText: '应用授权待确认' }).waitFor();
  await page.locator('#load-sample').click();
  await page.locator('#image-preview-wrap:not(.hidden)').waitFor();
  const originalDataUrl = await page.locator('#image-preview').getAttribute('src');
  await fs.writeFile(path.join(outputDir, 'original.png'), Buffer.from(originalDataUrl.split(',')[1], 'base64'));

  const analyze = async () => {
    const response = page.waitForResponse(r => r.url() === `${baseUrl}/api/analyze`);
    await page.locator('#analyze-button').click();
    const result = await (await response).json();
    await page.locator('#result-content:not(.hidden)').waitFor();
    return result;
  };
  const before = await analyze();
  assert.equal(before.summary.blockerCount, 2);
  assert.equal(before.audit.visualVerification, 'human-review-pending');
  checks.push('US sample: two known blockers and an explicit coverage gap');
  const regionResult = structuredClone(before);
  regionResult.analysisId = 'qa-region-evidence-analysis';
  regionResult.ai = {
      status: 'live', observationPolicy: 'us-visual-facts-v7', selectedModel: 'qa-structured-fixture',
    latencyMs: 1, requestId: 'qa-region-response', usage: { totalTokens: 0 },
    stages: [{ model: 'qa-structured-fixture', purpose: 'browser QA', latencyMs: 1, fallback: false, requestId: 'qa-region-response', ok: true }],
    observations: {
      ocrStatus: 'readable_text', ocrText: 'SALE BOX', visualObservation: '浏览器本地坐标渲染夹具',
      textRegions: [
        { id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.1, 0.1, 0.35, 0.12] },
        { id: 'text-2', text: 'BOX', origin: 'product', readability: 'readable', bbox: [0.35, 0.55, 0.25, 0.1] }
      ]
    }
  };
  regionResult.risks = [...before.risks, {
    id: 'qa-region-risk', ruleId: 'GG-US-VISUAL-PROMOTIONAL-OVERLAY', route: 'US_GOOGLE', severity: 'high',
    category: '可见事实待复核', title: '坐标渲染测试', finding: '仅用于隔离浏览器测试。',
    whyItMatters: '验证模型区域能绑定到风险框。', action: '不形成真实平台结论。', applicability: '浏览器 QA',
    requiresHumanReview: true, evidenceRegionId: 'text-1', evidence: [], origin: 'model-router',
    location: { type: 'region', x: 10, y: 10, width: 35, height: 12, regionId: 'text-1', source: 'model-text-region' }
  }];
  regionResult.summary = { ...before.summary, totalRisks: regionResult.risks.length, reviewCount: before.summary.reviewCount + 1 };
  await page.route('**/api/analyze', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(regionResult) }), { times: 1 });
  await page.locator('#analyze-button').click();
  await page.locator('#ai-telemetry').filter({ hasText: '已返回 2 个归一化区域' }).waitFor();
  assert.equal(await page.locator('#risk-overlay .evidence-region').count(), 0);
  assert.equal(await page.locator('#risk-overlay .protection-region').count(), 1);
  assert.equal(await page.locator('#risk-overlay .hotspot[data-label="可见事实待复核"]').count(), 1);
  const [previewBox, overlayBox] = await Promise.all([
    page.locator('#image-preview').boundingBox(), page.locator('#risk-overlay').boundingBox()
  ]);
  assert.ok(previewBox && overlayBox && overlayBox.width <= previewBox.width + 1 && overlayBox.height <= previewBox.height + 1);
  await page.locator('#image-preview-wrap').screenshot({ path: path.join(outputDir, 'region-evidence.png') });
  assert.equal(await page.locator('#apply-fix').isDisabled(), true);
  assert.match(await page.locator('#repair-guard').innerText(), /1 个商品\/场景\/未确认文字区设为保护区/);
  assert.match(await page.locator('#repair-region-list').innerText(), /商品\/包装 · BOX/);
  await page.locator('#repair-guard').screenshot({ path: path.join(outputDir, 'repair-guard.png') });
  await page.locator('#confirm-removal').check();
  assert.equal(await page.locator('#apply-fix').isDisabled(), true);
  await page.locator('#confirm-protection').check();
  assert.equal(await page.locator('#apply-fix').isEnabled(), true);
  checks.push('Validated OCR regions render as risk and protection masks; repair stays locked until both confirmations');
  await page.locator('#apply-fix').click();
  await page.locator('#download-fixed:not(.hidden)').waitFor();
  const recheckResponse = page.waitForResponse(r => r.url() === `${baseUrl}/api/recheck`);
  await page.locator('#recheck-button').click();
  const after = await (await recheckResponse).json();
  assert.equal(after.summary.status, 'review');
  assert.notEqual(after.audit.imageInputSha256, before.audit.imageInputSha256);
  await page.locator('#recheck-result.review').waitFor();
  assert.match(await page.locator('#audit-chain').innerText(), /待人工复核/);
  checks.push('US output: fresh image fingerprint and review status, not a false pass');
  const imageDownload = page.waitForEvent('download');
  await page.locator('#download-fixed').click();
  const imagePath = path.join(outputDir, 'image-draft.png');
  await (await imageDownload).saveAs(imagePath);
  const png = await fs.readFile(imagePath);
  assert.equal(png.readUInt32BE(16), 720);
  assert.equal(png.readUInt32BE(20), 720);
  const auditDownload = page.waitForEvent('download');
  await page.locator('#export-audit').click();
  const auditPath = path.join(outputDir, 'audit.json');
  await (await auditDownload).saveAs(auditPath);
  const audit = JSON.parse(await fs.readFile(auditPath, 'utf8'));
  assert.equal(audit.schemaVersion, '1.3');
  assert.equal(audit.inputSnapshots.length, 2);
  assert.equal(audit.recheck.audit.declaredParentAnalysisId, audit.analysis.analysisId);
  assert.equal(audit.repairDecision.analysisId, audit.analysis.analysisId);
  assert.equal(audit.repairDecision.confirmationScope, 'local-operator-check-without-identity-attestation');
  assert.deepEqual(audit.repairDecision.protectionPlan.protectedRegions.map(region => region.id), ['text-2']);
  assert.ok(!JSON.stringify(audit).includes('qa-only-placeholder'));
  checks.push('PNG and audit downloads are valid and contain bound input snapshots');
  const blockedRegionResult = structuredClone(regionResult);
  blockedRegionResult.analysisId = 'qa-blocked-protection-analysis';
  blockedRegionResult.ai.observations.textRegions[1].bbox = [0.35, 0.05, 0.25, 0.1];
  await page.route('**/api/analyze', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(blockedRegionResult) }), { times: 1 });
  await page.locator('#analyze-button').click();
  await page.locator('#repair-guard.blocked').waitFor();
  assert.match(await page.locator('#repair-guard-blocker').innerText(), /不提供勾选绕过/);
  assert.equal(await page.locator('#confirm-removal').isDisabled(), true);
  assert.equal(await page.locator('#confirm-protection').isDisabled(), true);
  assert.equal(await page.locator('#apply-fix').isDisabled(), true);
  await page.locator('#repair-guard').screenshot({ path: path.join(outputDir, 'repair-guard-blocked.png') });
  checks.push('A protected product region touching the crop hard-blocks repair with no checkbox override');
  await page.locator('#use-safe-reframe').click();
  await page.locator('#repair-guard:not(.blocked)').waitFor();
  assert.match(await page.locator('#repair-guard').innerText(), /保留完整源图，不移除促销文字或边框/);
  assert.equal(await page.locator('#confirm-removal-field').evaluate(el => el.classList.contains('hidden')), true);
  assert.equal(await page.locator('#confirm-protection').isEnabled(), true);
  assert.equal(await page.locator('#apply-fix').isDisabled(), true);
  await page.locator('#confirm-protection').check();
  await page.locator('#apply-fix').click();
  await page.locator('#download-fixed:not(.hidden)').waitFor();
  const safeRecheckResponse = page.waitForResponse(r => r.url() === `${baseUrl}/api/recheck`);
  await page.locator('#recheck-button').click();
  const safeAfter = await (await safeRecheckResponse).json();
  assert.ok(safeAfter.risks.some(risk => risk.ruleId === 'GG-US-IMG-004'));
  assert.ok(safeAfter.risks.some(risk => risk.ruleId === 'GG-US-IMG-003'));
  const safeAuditDownload = page.waitForEvent('download');
  await page.locator('#export-audit').click();
  const safeAuditPath = path.join(outputDir, 'safe-reframe-audit.json');
  await (await safeAuditDownload).saveAs(safeAuditPath);
  const safeAudit = JSON.parse(await fs.readFile(safeAuditPath, 'utf8'));
  assert.equal(safeAudit.repairDecision.repairMode, 'safe-reframe-no-crop');
  assert.equal(safeAudit.repairDecision.protectionPlan.operation, 'safe-reframe-no-crop');
  assert.equal(safeAudit.repairDecision.protectionPlan.hasRemovalIntent, false);
  await page.locator('#before-after').screenshot({ path: path.join(outputDir, 'safe-reframe.png') });
  checks.push('No-crop fallback preserves the full source and keeps promotional text and border risks in recheck');
  await page.locator('#toast').evaluate(el => el.classList.remove('show'));
  await page.locator('#result-panel').screenshot({ path: path.join(outputDir, 'desktop-us.png') });
  await page.locator('#product-title').fill('Edited product title');
  assert.ok(await page.locator('#result-content').evaluate(el => el.classList.contains('hidden')));
  checks.push('Editing a field invalidates the previous result and exports');

  await page.locator('[data-route="CN_ADS"]').click();
  const cnBefore = await analyze();
  assert.equal(cnBefore.summary.status, 'review');
  assert.ok(cnBefore.risks.some(r => r.ruleId === 'GG-CN-ADS-002'));
  const cnFactsResult = structuredClone(cnBefore);
  cnFactsResult.analysisId = 'qa-cn-claim-facts-analysis';
  cnFactsResult.ai = {
      status: 'live', observationPolicy: 'cn-ad-facts-v2', selectedModel: 'qa-structured-fixture',
    latencyMs: 1, requestId: 'qa-cn-facts-response', usage: { totalTokens: 0 },
    stages: [{ model: 'qa-structured-fixture', purpose: 'browser QA', latencyMs: 1, fallback: false, requestId: 'qa-cn-facts-response', ok: true }],
    observations: {
      ocrStatus: 'no_text_seen', ocrText: 'NONE', textRegions: [],
      visualObservation: '只提取逐字广告事实；未生成法律结论。',
      cnClaimFacts: [
        { id: 'claim-1', verbatim: '全网最佳', source: 'product_copy', kind: 'superlative_or_ranking', numericTokens: [], referenceTokens: [] },
        { id: 'claim-2', verbatim: '用户好评率 98%', source: 'product_copy', kind: 'numeric_or_statistical', numericTokens: ['98%'], referenceTokens: [] }
      ]
    }
  };
  await page.route('**/api/analyze', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cnFactsResult) }), { times: 1 });
  await page.locator('#analyze-button').click();
  await page.locator('#ai-telemetry').filter({ hasText: '模型逐字事实（不含法律判断）' }).waitFor();
  assert.equal(await page.locator('.claim-fact-list li').count(), 2);
  assert.match(await page.locator('.claim-fact-list').innerText(), /数值原文：98%/);
  await page.locator('#ai-telemetry').screenshot({ path: path.join(outputDir, 'cn-claim-facts.png') });
  checks.push('CN live-shaped fixture renders verbatim claim facts without model-authored legal findings');
  await page.locator('#apply-fix').click();
  assert.ok(!(await page.locator('#product-copy').inputValue()).includes('98%'));
  const cnResponse = page.waitForResponse(r => r.url() === `${baseUrl}/api/recheck`);
  await page.locator('#recheck-button').click();
  const cnAfter = await (await cnResponse).json();
  assert.equal(cnAfter.audit.imageInputSha256, cnBefore.audit.imageInputSha256);
  assert.equal(cnAfter.summary.status, 'review');
  checks.push('CN copy repair removes sample numeric claim but unchanged image still needs review');

  await page.locator('[data-route="EU_GPSR"]').click();
  const eu = await analyze();
  assert.ok(eu.risks.some(r => r.ruleId === 'GG-EU-GPSR-019B'));
  await page.locator('#offer-source-ref').fill('DOSSIER-QA-001');
  await page.locator('#offer-source-excerpt').fill('制造商 Hebei Zhengxiang Environmental Technology Co., Ltd.，国家 CN，型号 FN-BOX-01。档案私密备注 QA-DO-NOT-EXPORT。');
  const euFactsResult = structuredClone(eu);
  euFactsResult.analysisId = 'qa-eu-field-facts-analysis';
  euFactsResult.ai = {
      status: 'live', observationPolicy: 'eu-offer-facts-v2', selectedModel: 'qa-structured-fixture',
    latencyMs: 1, requestId: 'qa-eu-facts-response', usage: { totalTokens: 0 },
    stages: [{ model: 'qa-structured-fixture', purpose: 'browser QA', latencyMs: 1, fallback: false, requestId: 'qa-eu-facts-response', ok: true }],
    observations: {
      euFieldFacts: [
        ['manufacturerName', 'Hebei Zhengxiang Environmental Technology Co., Ltd.', '制造商 Hebei Zhengxiang Environmental Technology Co., Ltd.'],
        ['manufacturerCountry', 'CN', '国家 CN'],
        ['manufacturerPostalAddress', 'Hebei, China（演示占位，提交前替换为真实档案）', null],
        ['manufacturerEmail', 'demo@example.invalid', null],
        ['productId', 'FN-BOX-01', '型号 FN-BOX-01'],
        ['safetyInfo', null, null], ['responsiblePersonName', null, null],
        ['responsiblePersonPostalAddress', null, null], ['responsiblePersonEmail', null, null]
      ].map(([field, providedValue, sourceQuote], index) => ({
        id: `field-${index + 1}`, field, providedValue,
        sourceRef: sourceQuote ? 'DOSSIER-QA-001' : null, sourceQuote,
        presence: providedValue ? 'provided' : 'missing',
        evidenceStatus: !providedValue ? 'missing-field' : sourceQuote ? 'exact-quote-match' : 'source-quote-missing'
      }))
    }
  };
  await page.route('**/api/analyze', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(euFactsResult) }), { times: 1 });
  await page.locator('#analyze-button').click();
  await page.locator('#ai-telemetry').filter({ hasText: '页面字段事实与档案引用（不含法律判断）' }).waitFor();
  assert.equal(await page.locator('.claim-fact-list li').count(), 9);
  assert.match(await page.locator('.claim-fact-list').innerText(), /欧盟责任人名称 · 页面未提供\s+未提供/);
  assert.match(await page.locator('#ai-telemetry').innerText(), /模型没有补全制造商/);
  await page.locator('#ai-telemetry').screenshot({ path: path.join(outputDir, 'eu-field-facts.png') });
  const euAuditDownload = page.waitForEvent('download');
  await page.locator('#export-audit').click();
  const euAuditPath = path.join(outputDir, 'eu-field-facts-audit.json');
  await (await euAuditDownload).saveAs(euAuditPath);
  const euAudit = JSON.parse(await fs.readFile(euAuditPath, 'utf8'));
  assert.equal(euAudit.inputSnapshots[0].offerEvidence.sourceRef, 'DOSSIER-QA-001');
  assert.equal(euAudit.inputSnapshots[0].offerEvidence.excerptIncluded, false);
  assert.ok(euAudit.inputSnapshots[0].offerEvidence.excerptLength > 0);
  assert.ok(!JSON.stringify(euAudit).includes('QA-DO-NOT-EXPORT'));
  checks.push('EU live-shaped fixture renders nine field facts, preserves missing values, and redacts dossier text from export');
  await page.locator('#apply-fix').click();
  assert.equal(await page.locator('#responsible-name').inputValue(), '');
  checks.push('EU missing responsible person remains unfilled');
  await page.locator('#image-input').setInputFiles(imagePath);
  await page.waitForFunction(() => document.querySelector('#image-badges').textContent.includes('用户素材'));
  assert.ok(await page.locator('#result-content').evaluate(el => el.classList.contains('hidden')));
  checks.push('Actual PNG file upload replaces the image and invalidates old results');
  await page.locator('[data-route="US_GOOGLE"]').click();
  let releaseRequest;
  const release = new Promise(resolve => { releaseRequest = resolve; });
  let sawRequest;
  const intercepted = new Promise(resolve => { sawRequest = resolve; });
  await page.route('**/api/analyze', async route => { sawRequest(); await release; await route.continue(); }, { times: 1 });
  await page.locator('#analyze-button').click();
  await intercepted;
  await page.locator('#product-title').fill('Changed during in-flight request');
  const lateResponse = page.waitForResponse(r => r.url() === `${baseUrl}/api/analyze`);
  releaseRequest();
  await lateResponse;
  await page.waitForFunction(() => !document.querySelector('#analyze-button').disabled);
  assert.ok(await page.locator('#result-content').evaluate(el => el.classList.contains('hidden')));
  checks.push('A late response cannot restore a report for superseded input');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#toast').evaluate(el => el.classList.remove('show'));
  await page.screenshot({ path: path.join(outputDir, 'mobile.png'), fullPage: true });
  await page.goto(baseUrl);
  await page.evaluate(() => { document.documentElement.style.scrollBehavior = 'auto'; window.scrollTo({ top: 0, behavior: 'instant' }); });
  await page.screenshot({ path: path.join(outputDir, 'mobile-top.png') });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  checks.push('390px mobile viewport has no horizontal overflow');
  await page.goto(`${baseUrl}/samples.html`);
  await page.waitForFunction(() => document.querySelectorAll('.sample-card').length === 6);
  await page.waitForFunction(() => [...document.querySelectorAll('.sample-card img')].every(img => img.complete && img.naturalWidth > 0));
  const localManifest = JSON.parse(await fs.readFile(path.join(appDir, 'public/samples/manifest.json'), 'utf8'));
  const decodedSizes = await page.locator('.sample-card img').evaluateAll(images => images.map(img => [img.naturalWidth, img.naturalHeight]));
  assert.deepEqual(decodedSizes, localManifest.samples.map(s => [s.dimensions.width, s.dimensions.height]));
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await page.screenshot({ path: path.join(outputDir, 'sample-library-mobile.png'), fullPage: true });
  await page.screenshot({ path: path.join(outputDir, 'sample-library-mobile-top.png') });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: path.join(outputDir, 'sample-library-desktop.png'), fullPage: true });
  checks.push('Six source-linked photographs render on desktop and mobile without overflow');

  await page.goto(`${baseUrl}/?sample=tray-deep`);
  await page.waitForFunction(() => document.querySelector('#image-badges').textContent.includes('公开照片'));
  assert.equal(await page.locator('#overlay-text').inputValue(), '');
  assert.equal(await page.locator('#manufacturer-name').inputValue(), '');
  const photo = await analyze();
  assert.equal(photo.ai.status, 'local-rules');
  assert.equal(photo.summary.status, 'review');
  assert.equal(photo.audit.image.provenance.sampleId, 'tray-deep');
  assert.equal(photo.fixes.length, 0);
  assert.ok(await page.locator('#fix-section').evaluate(el => el.classList.contains('hidden')));
  const creditDownload = page.waitForEvent('download');
  await page.locator('#download-attribution').click();
  const creditPath = path.join(outputDir, 'sample-attribution.txt');
  await (await creditDownload).saveAs(creditPath);
  const credit = await fs.readFile(creditPath, 'utf8');
  assert.ok(credit.includes('Gratnells') && credit.includes('CC BY-SA 4.0') && credit.includes('转为 PNG'));
  const photoAuditDownload = page.waitForEvent('download');
  await page.locator('#export-audit').click();
  const photoAuditPath = path.join(outputDir, 'sample-audit.json');
  await (await photoAuditDownload).saveAs(photoAuditPath);
  const photoAudit = JSON.parse(await fs.readFile(photoAuditPath, 'utf8'));
  assert.equal(photoAudit.product.fixedImage, null);
  assert.equal(photoAudit.inputSnapshots[0].image.provenance.author, 'Gratnells');
  checks.push('Licensed photo keeps review without fabricated fixes; attribution and audit retain source license');

  await page.locator('.sample-picker summary').click();
  await page.locator('#licensed-sample').selectOption('basket-clothes');
  await page.locator('#load-licensed-sample').click();
  await page.waitForFunction(() => document.querySelector('#product-title').value === '装有衣物的洗衣篮');
  assert.ok(await page.locator('#result-content').evaluate(el => el.classList.contains('hidden')));
  assert.ok((await page.locator('#sample-attribution').innerText()).includes('Santeri'));
  await page.locator('#image-input').setInputFiles(imagePath);
  await page.waitForFunction(() => document.querySelector('#image-badges').textContent.includes('用户素材'));
  assert.ok(await page.locator('#sample-attribution').evaluate(el => el.classList.contains('hidden')));
  checks.push('Switching source clears the old report; uploading own image removes stale attribution');

  await page.goto(`${baseUrl}/validation.html`);
  await page.locator('#integrity-card[data-state="ready"]').waitFor();
  assert.equal(await page.locator('.policy-card').count(), 3);
  assert.equal(await page.locator('#metric-cases').innerText(), '27');
  assert.equal(await page.locator('#metric-passed').innerText(), '27/27');
  assert.equal(await page.locator('#metric-live').innerText(), '22');
  assert.equal(await page.locator('#human-cases').innerText(), '6');
  assert.equal(await page.locator('#human-requests').innerText(), '6/6');
  assert.equal(await page.locator('#human-contracts').innerText(), '6/6');
  assert.equal(await page.locator('#human-agreement').innerText(), '5/6');
  assert.equal(await page.locator('#human-case-grid .human-case-card').count(), 6);
  assert.equal(await page.locator('#human-case-grid .human-case-card.mismatch').count(), 1);
  assert.equal(await page.locator('#robustness-cases').innerText(), '10');
  assert.equal(await page.locator('#robustness-requests').innerText(), '10/10');
  assert.equal(await page.locator('#robustness-contracts').innerText(), '9/10');
  assert.equal(await page.locator('#robustness-agreement').innerText(), '3/10');
  assert.equal(await page.locator('#robustness-tokens').innerText(), '18,662');
  assert.equal(await page.locator('#robustness-case-grid .human-case-card').count(), 10);
  assert.equal(await page.locator('#robustness-case-grid .human-case-card.mismatch').count(), 7);
  assert.equal(await page.locator('#v6-requests').innerText(), '6/6');
  assert.equal(await page.locator('#v6-contracts').innerText(), '6/6');
  assert.equal(await page.locator('#v6-tokens').innerText(), '12,372');
  assert.equal(await page.locator('#v6-agreement').innerText(), '2/6');
  assert.match(await page.locator('#known-mismatch').innerText(), /fixture-03[\s\S]*不可可靠转写文字痕迹/);
  assert.match(await page.locator('.boundary-section').innerText(), /模型准确率\s+未测量/);
  assert.match(await page.locator('#evidence-hash').innerText(), /^[a-f0-9]{64}$/);
  assert.match(await page.locator('#human-evidence-hash').innerText(), /^[a-f0-9]{64}$/);
  assert.match(await page.locator('#robustness-evidence-hash').innerText(), /^[a-f0-9]{64}$/);
  assert.match(await page.locator('#v6-evidence-hash').innerText(), /^[a-f0-9]{64}$/);
  assert.match(await page.locator('#v6-recovery-evidence-hash').innerText(), /^[a-f0-9]{64}$/);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(outputDir, 'validation-center-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(outputDir, 'validation-center-mobile.png'), fullPage: true });
  checks.push('Local validation center renders synchronized contracts, v5 and v6 comparisons, both v6 attempts, token use, known failures and explicit unmeasured boundaries');

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${baseUrl}/annotation.html`);
  await page.waitForFunction(() => document.querySelectorAll('.case-card').length === 6);
  await page.waitForFunction(() => [...document.querySelectorAll('.case-card img')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator('.case-card').count(), 6);
  assert.equal(await page.locator('body').innerText().then(text => /constructionTruth|tiny-readable|modelOutput/.test(text)), false);
  await page.locator('#annotator').fill('qa-independent-reviewer');
  for (const select of await page.locator('[data-field="ocrStatus"]').all()) await select.selectOption('no_text_seen');
  const readableCard = page.locator('[data-id="fixture-02"]');
  await readableCard.locator('[data-field="ocrStatus"]').selectOption('readable_text');
  await readableCard.locator('[data-field="ocrText"]').fill('SKU BX-204');
  await readableCard.locator('[data-action="add-region"]').click();
  await readableCard.locator('[data-key="text"]').fill('SKU BX-204');
  await readableCard.locator('[data-key="origin"]').selectOption('product');
  await readableCard.locator('.draw').click();
  const stageBox = await readableCard.locator('.image-stage').boundingBox();
  await page.mouse.move(stageBox.x + stageBox.width * .38, stageBox.y + stageBox.height * .55);
  await page.mouse.down();
  await page.mouse.move(stageBox.x + stageBox.width * .62, stageBox.y + stageBox.height * .65);
  await page.mouse.up();
  assert.ok(Number(await readableCard.locator('[data-box="2"]').inputValue()) > 0);
  assert.equal(await readableCard.locator('.annotation-box').count(), 1);
  assert.equal(await readableCard.locator('.annotation-box span').innerText(), 'tx1');
  assert.equal(await readableCard.locator('[data-key="id"]').inputValue(), 'text-1');
  assert.equal(await page.locator('#progress-count').innerText(), '6 / 6');
  await page.locator('#validate-button').click();
  await page.locator('#status-message.ok').waitFor();
  await page.screenshot({ path: path.join(outputDir, 'annotation-workbench-desktop.png'), fullPage: true });
  checks.push('Blind annotation workbench loads six neutral fixtures, supports graphical region drawing, and validates a complete local draft');
  const annotationDownload = page.waitForEvent('download');
  await page.locator('#export-button').click();
  const annotationPath = path.join(outputDir, 'human-annotations-qa.json');
  await (await annotationDownload).saveAs(annotationPath);
  const annotation = JSON.parse(await fs.readFile(annotationPath, 'utf8'));
  assert.equal(annotation.annotationStatus, 'completed-single-human-review');
  assert.equal(annotation.cases.length, 6);
  assert.equal(annotation.limitations.interAnnotatorAgreementMeasured, false);
  assert.equal(annotation.limitations.modelAccuracyEstablished, false);
  checks.push('Annotation export is structurally complete and retains single-review limitations');
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(outputDir, 'annotation-workbench-mobile.png'), fullPage: true });
  checks.push('Blind annotation workbench has no horizontal overflow at 390px');

  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`${baseUrl}/annotation.html?dataset=robustness-v1`);
  await page.waitForFunction(() => document.querySelectorAll('.case-card').length === 10);
  await page.waitForFunction(() => [...document.querySelectorAll('.case-card img')].every(img => img.complete && img.naturalWidth > 0));
  assert.equal(await page.locator('.case-card').count(), 10);
  assert.equal(await page.locator('#progress-count').innerText(), '0 / 10');
  assert.match(await page.locator('h1').innerText(), /鲁棒性十图/);
  assert.equal(await page.locator('body').innerText().then(text => /small-readable-product-code|blurred-unreadable|constructionTruth|modelOutput/.test(text)), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(outputDir, 'robustness-annotation-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
  await page.screenshot({ path: path.join(outputDir, 'robustness-annotation-mobile.png'), fullPage: true });
  checks.push('Robustness blind workbench loads ten neutral fixtures with no answer leakage or horizontal overflow');
  assert.deepEqual(pageErrors, []);
  const report = {
    checkedAt: new Date().toISOString(), browser: await browser.version(),
    mode: 'isolated local QA; placeholder credential; provider fetch disabled',
    checks, pageErrors, beforeStatus: before.summary.status, afterStatus: after.summary.status,
    imageSize: [720, 720], artifacts: ['desktop-us.png', 'region-evidence.png', 'repair-guard.png', 'repair-guard-blocked.png', 'safe-reframe.png', 'safe-reframe-audit.json', 'cn-claim-facts.png', 'eu-field-facts.png', 'eu-field-facts-audit.json', 'mobile.png', 'mobile-top.png', 'image-draft.png', 'audit.json', 'sample-library-desktop.png', 'sample-library-mobile.png', 'sample-library-mobile-top.png', 'sample-attribution.txt', 'sample-audit.json', 'validation-center-desktop.png', 'validation-center-mobile.png', 'annotation-workbench-desktop.png', 'human-annotations-qa.json', 'annotation-workbench-mobile.png', 'robustness-annotation-desktop.png', 'robustness-annotation-mobile.png']
  };
  await fs.writeFile(path.join(outputDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  try { await browser?.close(); } finally { child.kill(); await exited; }
}
