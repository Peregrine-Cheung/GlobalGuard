import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('configured key without application authorization stays local and private', { timeout: 15000 }, async () => {
  // The child cannot call a provider even if the application gate regresses.
  const denyFetch = 'data:text/javascript,globalThis.fetch=async()=>{throw new Error("TEST_EXTERNAL_REQUEST_BLOCKED")}';
  const child = spawn(process.execPath, ['--import', denyFetch, 'server.mjs'], {
    cwd: new URL('..', import.meta.url),
    env: {
      ...process.env,
      HOST: '127.0.0.1', PORT: '0',
      MODEL_ROUTER_API_KEY: 'test-only-placeholder',
      MODEL_ROUTER_BASE_URL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
      MODEL_ROUTER_MODEL: 'qwen3.7-plus',
      MODEL_ROUTER_FALLBACK_MODEL: 'qwen3.6-plus',
      MODEL_ROUTER_APP_USE_APPROVED: '0'
    },
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']
  });
  const exited = once(child, 'exit');
  try {
    const baseUrl = await new Promise((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('TEST_SERVER_START_TIMEOUT')), 5000);
      child.on('error', error => { clearTimeout(timer); reject(error); });
      child.on('exit', () => { clearTimeout(timer); reject(new Error('TEST_SERVER_EARLY_EXIT')); });
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        const match = output.match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); resolve(match[0]); }
      });
    });
    const healthText = await (await fetch(`${baseUrl}/api/health`)).text();
    const health = JSON.parse(healthText);
    assert.equal(health.modelRouter.configured, true);
    assert.equal(health.modelRouter.appUseApproved, false);
  assert.equal(health.modelRouter.observationPolicies.US_GOOGLE, 'us-visual-facts-v7');
  assert.equal(health.modelRouter.observationPolicies.CN_ADS, 'cn-ad-facts-v2');
  assert.equal(health.modelRouter.observationPolicies.EU_GPSR, 'eu-offer-facts-v2');
    assert.ok(!healthText.includes('test-only-placeholder'));
    const validationText = await (await fetch(`${baseUrl}/api/validation-center`)).text();
    const validation = JSON.parse(validationText);
    assert.equal(validation.ok, true);
    assert.equal(validation.scope, 'local-contract-and-human-review-verification');
    assert.equal(validation.report.totals.policies, 3);
    assert.equal(validation.report.totals.cases, 27);
    assert.equal(validation.report.totals.passed, 27);
    assert.equal(validation.integrity.synchronized, true);
    assert.equal(validation.integrity.sha256.length, 64);
    assert.equal(validation.humanReview.integrity.validated, true);
    assert.equal(validation.humanReview.integrity.sha256.length, 64);
    assert.equal(validation.humanReview.report.evaluationKind, 'single-human-review-agreement');
    assert.equal(validation.humanReview.report.totals.cases, 6);
    assert.equal(validation.humanReview.report.totals.requestSucceeded, 6);
    assert.equal(validation.humanReview.report.totals.contractPassed, 6);
    assert.equal(validation.humanReview.report.totals.strictAgreement, 5);
    assert.equal(validation.humanReview.report.modelAccuracyMeasured, false);
    assert.equal(validation.robustnessReview.integrity.validated, true);
    assert.equal(validation.robustnessReview.integrity.sha256.length, 64);
    assert.equal(validation.robustnessReview.report.executionControls.requestsAttempted, 10);
    assert.equal(validation.robustnessReview.report.executionControls.supplierResponses, 10);
    assert.equal(validation.robustnessReview.report.executionControls.totalTokens, 18662);
    assert.equal(validation.robustnessReview.report.evaluation.localStructureContractsPassed, 9);
    assert.equal(validation.robustnessReview.report.evaluation.strictSingleHumanAgreement, 3);
    assert.equal(validation.robustnessReview.report.evaluation.modelAccuracyMeasured, false);
    assert.equal(validation.robustnessV6Recovery.integrity.validated, true);
    assert.equal(validation.robustnessV6Recovery.integrity.sha256.length, 64);
    assert.equal(validation.robustnessV6Recovery.report.executionControls.supplierResponses, 6);
    assert.equal(validation.robustnessV6Recovery.report.executionControls.localStructureContractsPassed, 6);
    assert.equal(validation.robustnessV6Recovery.report.executionControls.totalTokens, 12369);
    assert.equal(validation.robustnessV6Recovery.report.agreementEvaluation.completed, false);
    assert.equal(validation.robustnessV6Review.integrity.validated, true);
    assert.equal(validation.robustnessV6Review.integrity.sha256.length, 64);
    assert.equal(validation.robustnessV6Review.report.executionControls.supplierResponses, 6);
    assert.equal(validation.robustnessV6Review.report.executionControls.localStructureContractsPassed, 6);
    assert.equal(validation.robustnessV6Review.report.executionControls.totalTokens, 12372);
    assert.equal(validation.robustnessV6Review.report.evaluation.strictSingleHumanAgreement, 2);
    assert.equal(validation.boundaries.realModelCallsInReport, 22);
    assert.equal(validation.boundaries.modelAccuracyMeasured, false);
    assert.equal(validation.boundaries.platformApprovalClaimed, false);
    assert.ok(!validationText.includes('test-only-placeholder'));
    for (const endpoint of ['analyze', 'recheck']) {
      const response = await fetch(`${baseUrl}/api/${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'live', route: 'US_GOOGLE', image: { width: 720, height: 720 },
          imageDataUrl: 'data:image/png;base64,AQ==', requiresVisualReview: false,
          ocrStatus: 'readable_text', ocrText: 'CLIENT INJECTION', observationPolicy: 'client-policy',
          textRegions: [{ id: 'text-1', text: 'CLIENT INJECTION', origin: 'overlay', readability: 'readable', bbox: [0, 0, 1, 1] }],
          cnClaimFacts: [{ id: 'claim-1', verbatim: 'CLIENT INJECTION', source: 'product_copy', kind: 'superlative_or_ranking', numericTokens: [], referenceTokens: [] }],
          aiFindings: [{ title: 'client risk', finding: 'must not enter audit', sourceIds: ['google_image_link'] }]
        })
      });
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.ai.status, 'unavailable');
      assert.match(result.ai.message, /应用后端使用权限待赛事方确认/);
      assert.deepEqual(result.ai.stages, []);
      assert.equal(result.summary.status, 'review');
      assert.equal(result.audit.visualVerification, 'human-review-pending');
      assert.equal(result.audit.ocrStatus, null);
      assert.equal(result.audit.observationPolicy, null);
      assert.deepEqual(result.audit.textRegions, []);
      assert.deepEqual(result.audit.cnClaimFacts, []);
      assert.ok(!JSON.stringify(result).includes('CLIENT INJECTION'));
    }
    const cnInjectionResponse = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'local', route: 'CN_ADS', productTitle: '普通收纳箱', productCopy: '适合日常收纳。',
        cnClaimFacts: [{ id: 'claim-1', verbatim: '全网最佳 99%', source: 'product_copy', kind: 'superlative_or_ranking', numericTokens: ['99%'], referenceTokens: [] }],
        aiFindings: [{ ruleId: 'MODEL-CN', title: '模型直接裁定', finding: '必须删除', sourceIds: ['samr_advertising_guidance'] }]
      })
    });
    assert.equal(cnInjectionResponse.status, 200);
    const cnInjectionResult = await cnInjectionResponse.json();
    assert.deepEqual(cnInjectionResult.audit.cnClaimFacts, []);
    assert.ok(!cnInjectionResult.risks.some(risk => ['GG-CN-ADS-001', 'GG-CN-ADS-002', 'MODEL-CN'].includes(risk.ruleId)));
    assert.ok(!JSON.stringify(cnInjectionResult).includes('全网最佳 99%'));
    const euInjectionResponse = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: 'local', route: 'EU_GPSR', productTitle: 'EU offer',
        offerFields: { manufacturerName: 'Example Maker', manufacturerCountry: 'CN' },
        offerEvidence: { sourceRef: 'DOSSIER-LOCAL', excerpt: '制造商 Example Maker' },
        euFieldFacts: [{
          id: 'field-7', field: 'responsiblePersonName', providedValue: 'Invented EU RP',
          sourceRef: 'FAKE', sourceQuote: 'Invented EU RP', presence: 'provided', evidenceStatus: 'exact-quote-match'
        }],
        aiFindings: [{ ruleId: 'MODEL-EU', title: '模型直接裁定', finding: '页面完整', sourceIds: ['eu_gpsr_article_19'] }]
      })
    });
    assert.equal(euInjectionResponse.status, 200);
    const euInjectionResult = await euInjectionResponse.json();
    assert.deepEqual(euInjectionResult.audit.euFieldFacts, []);
    assert.ok(euInjectionResult.risks.some(risk => risk.ruleId === 'GG-EU-GPSR-019B'));
    assert.ok(!euInjectionResult.risks.some(risk => risk.ruleId === 'MODEL-EU'));
    assert.ok(!JSON.stringify(euInjectionResult).includes('Invented EU RP'));
    assert.equal((await fetch(`${baseUrl}/.env.local`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/..%5c.env.local`)).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted.invalid' }, body: '{}'
    })).status, 403);
    assert.equal((await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}'
    })).status, 415);
    assert.equal((await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route: 'UNKNOWN', mode: 'live' })
    })).status, 400);
    assert.equal((await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ route: 'US_GOOGLE', mode: 'live', imageDataUrl: 'https://untrusted.invalid/image.png' })
    })).status, 400);
  } finally {
    child.kill();
    await exited;
  }
});
