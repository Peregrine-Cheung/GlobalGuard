import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUsSmokePreview, runUsSmoke } from '../src/us-live-smoke.mjs';

const status = { configured: true, appUseApproved: true, provider: 'test', baseUrl: 'https://example.invalid', primaryModel: 'test-model' };
const image = { width: 420, height: 420, dataUrl: 'data:image/png;base64,AQ==' };

test('US v7 smoke preview is bounded and provider-call free', () => {
  const preview = buildUsSmokePreview(status);
  assert.equal(preview.willCallProvider, false);
  assert.equal(preview.observationPolicy, 'us-visual-facts-v7');
  assert.equal(preview.maxProviderRequests, 1);
  assert.equal(preview.fallbackDisabled, true);
  assert.equal(preview.maxCompletionTokens, 1600);
});

test('US v7 smoke makes one analyzer call with fallback disabled', async () => {
  let calls = 0;
  const result = await runUsSmoke({}, image, { status, analyze: async (_input, _rulepack, options) => {
    calls += 1;
    assert.equal(options.allowFallback, false);
    options.captureValidatedOutput({ ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: '收纳盒', textRegions: [], findings: [] });
    return { ocrStatus: 'no_text_seen', ocrText: 'NONE', textRegions: [], findings: [], telemetry: { requestId: 'mock' } };
  } });
  assert.equal(calls, 1);
  assert.equal(result.telemetry.requestId, 'mock');
  assert.equal(result.inputClassification, 'synthetic-non-sensitive');
});

test('US v7 smoke rejects missing authorization before provider work', async () => {
  let calls = 0;
  await assert.rejects(runUsSmoke({}, image, { status: { ...status, appUseApproved: false }, analyze: async () => { calls += 1; } }), /NOT_AUTHORIZED/);
  assert.equal(calls, 0);
});
