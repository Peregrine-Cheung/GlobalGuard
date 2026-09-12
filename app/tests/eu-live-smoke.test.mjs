import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEuSmokePreview, runEuSmoke, EU_LIVE_SMOKE_INPUT } from '../src/eu-live-smoke.mjs';

const approvedStatus = {
  configured: true,
  appUseApproved: true,
  provider: 'aliyun-token-plan',
  baseUrl: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
  primaryModel: 'qwen3.7-plus'
};

test('EU smoke preview is synthetic, bounded and provider-call free', () => {
  const preview = buildEuSmokePreview(approvedStatus);
  assert.equal(preview.willCallProvider, false);
  assert.equal(preview.maxProviderRequests, 1);
  assert.equal(preview.fallbackDisabled, true);
  assert.equal(preview.imageAttached, false);
  assert.equal(preview.maxCompletionTokens, 1200);
  assert.match(preview.input.offerFields.manufacturerEmail, /\.invalid$/);
  const serialized = JSON.stringify(preview);
  assert.ok(!serialized.includes('MODEL_ROUTER_API_KEY'));
  assert.ok(!serialized.includes('Bearer '));
});

test('EU smoke runner makes one bounded analyzer call and preserves both evidence layers', async () => {
  let calls = 0;
  let receivedInput;
  let receivedOptions;
  const raw = {
    fieldFacts: Object.keys(EU_LIVE_SMOKE_INPUT.offerFields).map(field => ({
      field,
      providedValue: EU_LIVE_SMOKE_INPUT.offerFields[field] || null,
      sourceQuote: null
    }))
  };
  const normalized = raw.fieldFacts.map((fact, index) => ({
    id: `field-${index + 1}`,
    ...fact,
    sourceRef: null,
    presence: fact.providedValue ? 'provided' : 'missing',
    evidenceStatus: fact.providedValue ? 'source-quote-missing' : 'missing-field'
  }));
  const result = await runEuSmoke({}, {
    status: approvedStatus,
    async analyze(input, _rulepack, options) {
      calls++;
      receivedInput = input;
      receivedOptions = options;
      options.captureValidatedOutput(raw);
      return { euFieldFacts: normalized, telemetry: { requestId: 'mock-eu-smoke', usage: { totalTokens: 321 } } };
    }
  });
  assert.equal(calls, 1);
  assert.equal(receivedInput.route, 'EU_GPSR');
  assert.equal(receivedOptions.allowFallback, false);
  assert.deepEqual(result.validatedRawOutput, raw);
  assert.deepEqual(result.euFieldFacts, normalized);
  assert.equal(result.boundaries.accuracyMeasured, false);
  assert.equal(result.boundaries.legalCorrectnessProved, false);
  assert.equal(result.boundaries.platformApprovalProved, false);
});

test('EU smoke rejects missing authorization before invoking the analyzer', async () => {
  let calls = 0;
  await assert.rejects(runEuSmoke({}, {
    status: { ...approvedStatus, appUseApproved: false },
    async analyze() { calls++; }
  }), /NOT_AUTHORIZED_OR_CONFIGURED/);
  assert.equal(calls, 0);
});
