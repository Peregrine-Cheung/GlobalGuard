import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ANNOTATION_DATASETS, createBlankAnnotationPack } from '../public/annotation-validation.mjs';

const dataRoot = new URL('../fixtures/visual-robustness-v1/', import.meta.url);
const assetRoot = new URL('../public/robustness-fixtures/', import.meta.url);
const truth = JSON.parse(await fs.readFile(new URL('construction-truth.json', dataRoot), 'utf8'));
const blank = JSON.parse(await fs.readFile(new URL('human-annotations.blank.json', dataRoot), 'utf8'));

test('ten deterministic robustness fixtures cover the declared challenge plan', async () => {
  assert.equal(truth.datasetId, 'globalguard-visual-robustness-v1');
  assert.equal(truth.cases.length, 10);
  assert.equal(truth.samplingPlan.providerRequestsPlanned, 10);
  assert.equal(truth.samplingPlan.retryDisabled, true);
  assert.equal(truth.samplingPlan.fallbackDisabled, true);
  assert.deepEqual(truth.cases.map(item => item.id), ANNOTATION_DATASETS[truth.datasetId].caseIds);
  const challenges = truth.cases.map(item => item.challenge);
  for (const expected of ['tiny-low-contrast-unreadable-strokes', 'rotated-scene-price-tag', 'blurred-unreadable-product-label', 'spaced-promotional-words', 'low-contrast-readable-label', 'vertical-rotated-scene-text', 'diagonal-watermark', 'no-text-multiple-object-control']) {
    assert.ok(challenges.includes(expected), expected);
  }
  for (const item of truth.cases) {
    const bytes = await fs.readFile(new URL(item.filename, assetRoot));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    const svg = bytes.toString('utf8');
    assert.match(svg, /width="720" height="720"/);
    assert.doesNotMatch(svg, /<script|<foreignObject/i);
    assert.doesNotMatch(svg, /(?:href|src)\s*=\s*["']https?:\/\//i);
    assert.ok(!svg.includes(item.challenge));
  }
});

test('robustness blank pack contains neutral ids and no answer-bearing fields', () => {
  const generated = createBlankAnnotationPack('globalguard-visual-robustness-v1');
  assert.equal(blank.datasetId, generated.datasetId);
  assert.deepEqual(blank.cases, generated.cases);
  assert.equal(blank.cases.length, 10);
  const serialized = JSON.stringify(blank).toLowerCase();
  for (const forbidden of ['constructiontruth', 'challenge', 'modeloutput', 'requestid']) assert.ok(!serialized.includes(forbidden));
});

test('annotation workbench switches to robustness data without leaking construction answers', async () => {
  const js = await fs.readFile(new URL('../public/annotation.js', import.meta.url), 'utf8');
  assert.match(js, /requestedDataset === 'robustness-v1'/);
  assert.match(js, /profile\.assetRoot/);
  for (const item of truth.cases) assert.ok(!js.includes(item.challenge));
});
