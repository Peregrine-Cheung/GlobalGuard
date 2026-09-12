import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCnSmokePreview, runCnSmoke } from '../src/cn-live-smoke.mjs';

const status = { configured: true, appUseApproved: true, provider: 'aliyun-token-plan',
  baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', primaryModel: 'qwen3.7-plus' };

test('CN smoke preview is bounded and provider-call free', () => {
  const preview = buildCnSmokePreview(status);
  assert.equal(preview.willCallProvider, false);
  assert.equal(preview.maxProviderRequests, 1);
  assert.equal(preview.fallbackDisabled, true);
  assert.equal(preview.maxCompletionTokens, 900);
  assert.equal(preview.imageAttached, false);
  assert.ok(!JSON.stringify(preview).includes('Bearer '));
});

test('CN smoke runner uses one analyzer call with fallback disabled', async () => {
  let calls = 0;
  const raw = { imageTextStatus: 'no_text_seen', imageText: 'NONE', claims: [] };
  const result = await runCnSmoke({}, { status, async analyze(_input, _rules, options) {
    calls++; assert.equal(options.allowFallback, false); options.captureValidatedOutput(raw);
    return { cnClaimFacts: [], telemetry: { requestId: 'mock-cn' } };
  } });
  assert.equal(calls, 1);
  assert.deepEqual(result.validatedRawOutput, raw);
  assert.equal(result.boundaries.accuracyMeasured, false);
});

test('CN smoke rejects missing authorization before provider work', async () => {
  let calls = 0;
  await assert.rejects(runCnSmoke({}, { status: { ...status, configured: false }, async analyze() { calls++; } }), /NOT_AUTHORIZED/);
  assert.equal(calls, 0);
});
