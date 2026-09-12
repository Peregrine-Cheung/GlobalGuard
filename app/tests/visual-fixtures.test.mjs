import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';

const dataRoot = new URL('../fixtures/visual-eval-v1/', import.meta.url);
const assetRoot = new URL('../public/visual-fixtures/', import.meta.url);
const truth = JSON.parse(await fs.readFile(new URL('construction-truth.json', dataRoot), 'utf8'));
const blank = JSON.parse(await fs.readFile(new URL('human-annotations.blank.json', dataRoot), 'utf8'));
const allowedStatuses = new Set(['readable_text', 'unreadable_text_seen', 'no_text_seen']);
const allowedOrigins = new Set(['overlay', 'product', 'scene', 'uncertain']);
const expectedIds = new Set(['fixture-01', 'fixture-02', 'fixture-03', 'fixture-04', 'fixture-05', 'fixture-06']);
const expectedChallenges = new Set(['no-text', 'tiny-readable', 'tiny-unreadable', 'product-label', 'scene-price-tag', 'promotional-overlay']);

test('six deterministic visual fixtures retain construction truth without claiming human gold', async () => {
  assert.equal(truth.datasetId, 'globalguard-visual-fixtures-v1');
  assert.equal(truth.coordinateSystem, 'normalized_xywh_top_left');
  assert.deepEqual(new Set(truth.cases.map((item) => item.id)), expectedIds);
  assert.deepEqual(new Set(truth.cases.map((item) => item.challenge)), expectedChallenges);
  for (const item of truth.cases) {
    assert.equal(item.labelStatus, 'synthetic-construction-truth-not-human-gold');
    assert.equal(item.labelsDerivedFrom, 'fixture-construction-spec');
    assert.equal(item.generated, true);
    assert.equal(item.merchantEvidence, false);
    assert.ok(allowedStatuses.has(item.constructionTruth.ocrStatus));
    assert.equal(item.assetPath, `/visual-fixtures/${item.filename}`);
    const bytes = await fs.readFile(new URL(item.filename, assetRoot));
    assert.equal(createHash('sha256').update(bytes).digest('hex'), item.sha256);
    const svg = bytes.toString('utf8');
    assert.match(svg, /width="720" height="720"/);
    assert.doesNotMatch(svg, /<script|<foreignObject/i);
    assert.doesNotMatch(svg, /(?:href|src)\s*=\s*["']https?:\/\//i);
    const readable = item.constructionTruth.ocrStatus === 'readable_text';
    assert.equal(item.constructionTruth.ocrText !== 'NONE', readable);
    for (const region of item.constructionTruth.textRegions) {
      assert.ok(allowedOrigins.has(region.origin));
      assert.equal(region.bbox.length, 4);
      assert.ok(region.bbox.every((value) => Number.isFinite(value) && value >= 0 && value <= 1));
      assert.ok(region.bbox[0] + region.bbox[2] <= 1.0001);
      assert.ok(region.bbox[1] + region.bbox[3] <= 1.0001);
    }
  }
});

test('blank annotation pack is independent from model output and construction answers', () => {
  assert.equal(blank.annotationStatus, 'blank-human-review-template');
  assert.equal(blank.annotator, null);
  assert.equal(blank.reviewedAt, null);
  assert.deepEqual(blank.cases.map((item) => item.id), truth.cases.map((item) => item.id));
  for (const item of blank.cases) {
    assert.equal(item.humanLabel.ocrStatus, null);
    assert.equal(item.humanLabel.ocrText, null);
    assert.deepEqual(item.humanLabel.textRegions, []);
    assert.deepEqual(item.humanLabel.visualFacts, []);
  }
  const serialized = JSON.stringify(blank).toLowerCase();
  for (const forbidden of ['requestid', 'modeloutput', 'selectedmodel', 'constructiontruth']) {
    assert.ok(!serialized.includes(forbidden));
  }
});

test('fixture set covers text visibility and origin boundaries needed for OCR review', () => {
  const byChallenge = Object.fromEntries(truth.cases.map((item) => [item.challenge, item.constructionTruth]));
  assert.equal(byChallenge['no-text'].ocrStatus, 'no_text_seen');
  assert.equal(byChallenge['tiny-readable'].ocrStatus, 'readable_text');
  assert.equal(byChallenge['tiny-unreadable'].ocrStatus, 'unreadable_text_seen');
  assert.equal(byChallenge['product-label'].textRegions[0].origin, 'product');
  assert.equal(byChallenge['scene-price-tag'].textRegions[0].origin, 'scene');
  assert.equal(byChallenge['promotional-overlay'].textRegions[0].origin, 'overlay');
});

test('public gallery exposes neutral identifiers instead of construction answers', async () => {
  const gallery = await fs.readFile(new URL('../public/visual-fixtures.html', import.meta.url), 'utf8');
  for (const challenge of expectedChallenges) assert.ok(!gallery.includes(challenge));
  for (const item of truth.cases) {
    assert.match(item.id, /^fixture-0[1-6]$/);
    assert.ok(gallery.includes(item.assetPath));
    const svg = await fs.readFile(new URL(item.filename, assetRoot), 'utf8');
    assert.ok(!svg.includes(item.challenge));
  }
});
