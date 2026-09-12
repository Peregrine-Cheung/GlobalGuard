import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { ANNOTATION_CASE_IDS, createBlankAnnotationPack, validateHumanAnnotationPack } from '../public/annotation-validation.mjs';

function completedPack() {
  const pack = createBlankAnnotationPack();
  pack.annotationStatus = 'completed-single-human-review';
  pack.annotator = 'independent-reviewer-01';
  pack.reviewedAt = '2026-09-10T12:00:00.000Z';
  for (const item of pack.cases) item.humanLabel = {
    ocrStatus: 'no_text_seen', ocrText: 'NONE', textRegions: [], visualFacts: [], notes: ''
  };
  return pack;
}

test('validates a complete six-case single-human review without promoting it to gold', () => {
  const pack = completedPack();
  pack.cases[1].humanLabel = {
    ocrStatus: 'readable_text', ocrText: 'SKU BX-204',
    textRegions: [{ id: 'text-1', text: 'SKU BX-204', origin: 'product', readability: 'readable', bbox: [0.4, 0.58, 0.2, 0.04] }],
    visualFacts: [], notes: '逐字复核'
  };
  pack.cases[2].humanLabel = {
    ocrStatus: 'unreadable_text_seen', ocrText: 'NONE',
    textRegions: [{ id: 'text-1', text: null, origin: 'uncertain', readability: 'unreadable', bbox: [0.4, 0.58, 0.2, 0.04] }],
    visualFacts: [], notes: '不猜字'
  };
  const validated = validateHumanAnnotationPack(pack);
  assert.deepEqual(validated.cases.map(item => item.id), ANNOTATION_CASE_IDS);
  assert.equal(validated.limitations.singleAnnotator, true);
  assert.equal(validated.limitations.interAnnotatorAgreementMeasured, false);
  assert.equal(validated.limitations.modelAccuracyEstablished, false);
});

test('rejects blank packs, OCR contradictions and facts without matching regions', () => {
  assert.throws(() => validateHumanAnnotationPack(createBlankAnnotationPack()), /INVALID_HUMAN_ANNOTATION_PACK/);
  const wrongText = completedPack();
  wrongText.cases[0].humanLabel.ocrStatus = 'readable_text';
  wrongText.cases[0].humanLabel.ocrText = 'TEXT';
  assert.throws(() => validateHumanAnnotationPack(wrongText), /HUMAN_OCR_TEXT_CONFLICT:fixture-01/);
  const danglingFact = completedPack();
  danglingFact.cases[0].humanLabel.visualFacts = [{ kind: 'price_text', textOrigin: 'scene', regionId: 'text-1' }];
  assert.throws(() => validateHumanAnnotationPack(danglingFact), /HUMAN_FACT_REGION_CONFLICT:fixture-01/);
});

test('blind annotation page exposes neutral IDs and no answer-bearing resources', async () => {
  const html = await fs.readFile(new URL('../public/annotation.html', import.meta.url), 'utf8');
  const js = await fs.readFile(new URL('../public/annotation.js', import.meta.url), 'utf8');
  const visible = `${html}\n${js}`;
  for (const forbidden of ['constructionTruth', 'construction-truth.json', 'modelOutput', 'tiny-readable', 'tiny-unreadable', 'product-label', 'scene-price-tag', 'promotional-overlay']) {
    assert.ok(!visible.includes(forbidden), `blind workbench leaked ${forbidden}`);
  }
  assert.match(html, /草稿仅保存在当前浏览器/);
  assert.match(js, /localStorage/);
  assert.match(js, /replace\(\/\^text-/);
  assert.match(js, /'tx\$1'/);
});
