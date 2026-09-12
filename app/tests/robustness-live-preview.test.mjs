import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('robustness live preview is bounded and provider-call free', () => {
  const result = spawnSync(process.execPath, ['scripts/preview-robustness-live-eval.mjs'], {
    cwd: new URL('../', import.meta.url), encoding: 'utf8',
    env: { ...process.env, DASHSCOPE_API_KEY: '', GLOBALGUARD_ALLOW_PROVIDER: '' }
  });
  assert.equal(result.status, 0, result.stderr);
  const preview = JSON.parse(result.stdout);
  assert.equal(preview.mode, 'preview-only');
  assert.equal(preview.willCallProvider, false);
  assert.equal(preview.executionPlan.maxProviderRequests, 10);
  assert.equal(preview.executionPlan.retryDisabled, true);
  assert.equal(preview.executionPlan.fallbackDisabled, true);
  assert.deepEqual(preview.tokenEstimate.planningRangeTokens, [15000, 25000]);
  assert.equal(preview.tokenEstimate.hardStopPlannedAtTokens, 25000);
  assert.equal(preview.cases.length, 10);
});
