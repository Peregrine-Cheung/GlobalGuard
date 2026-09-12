import test from 'node:test';
import assert from 'node:assert/strict';
import { mapUsVisualFacts, usVisualInstructions, validateUsOcrObservation, validateUsTextRegions, validateUsVisualEnvelope } from '../src/us-visual-facts.mjs';
import { ocrPresentation } from '../public/verification.mjs';
import { analyzeProduct } from '../src/rule-engine.mjs';
import fs from 'node:fs/promises';

test('CGI, guessed dimensions and blanket retail prohibitions cannot be rule kinds', () => {
  for (const kind of ['cgi', 'image_size', 'retail_forbidden', '__proto__']) {
    assert.throws(() => mapUsVisualFacts([{ kind, description: '推测', textOrigin: 'not_applicable' }]), /INVALID_VISUAL_FACT/);
  }
});
test('physical branding is not admitted as an overlay or watermark fact', () => {
  const regions = [{ id: 'text-1', text: 'BRAND', origin: 'product', readability: 'readable', bbox: [0.2, 0.3, 0.2, 0.1] }];
  for (const kind of ['watermark', 'promotional_overlay']) {
    assert.throws(() => mapUsVisualFacts([{ kind, description: '实物品牌', textOrigin: 'product', regionId: 'text-1' }], regions), /TEXT_ORIGIN_CONFLICT/);
  }
});
test('a scene price tag retains price review without inventing a retail-photo ban', () => {
  const regions = [{ id: 'text-1', text: '19.99', origin: 'scene', readability: 'readable', bbox: [0.1, 0.7, 0.2, 0.1] }];
  const [finding] = mapUsVisualFacts([{ kind: 'price_text', description: '左下货架价签写有19.99', textOrigin: 'scene', regionId: 'text-1' }], regions);
  assert.match(finding.title, /价格文字/);
  assert.match(finding.finding, /场景实体/);
  assert.deepEqual(finding.sourceIds, ['google_image_link']);
  assert.ok(!finding.title.includes('禁止'));
  assert.equal(finding.location.regionId, 'text-1');
});
test('multiple subjects produce conditional best-practice review and no invented bundle', () => {
  const [finding] = mapUsVisualFacts([{ kind: 'multiple_products', description: '左侧还有另一个柜体', textOrigin: 'not_applicable', regionId: null }]);
  assert.match(finding.whyItMatters, /最佳实践.*不是自动违规/);
  assert.match(finding.action, /卖家确认/);
});
test('model cannot inject policy title or action through extra fields', () => {
  assert.throws(() => mapUsVisualFacts([{ kind: 'low_clarity', description: '文字模糊', textOrigin: 'not_applicable', title: '平台禁止', action: '删除商品' }]), /INVALID_VISUAL_FACT/);
  assert.deepEqual(mapUsVisualFacts([]), []);
  assert.match(usVisualInstructions(), /尺寸由程序/);
});

test('US visual response rejects model-authored top-level decision fields', () => {
  const response = {
    ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: '白色背景中的收纳盒',
    textRegions: [], findings: []
  };
  assert.equal(validateUsVisualEnvelope(response), response);
  assert.throws(() => validateUsVisualEnvelope({ ...response, severity: 'ready' }), /INVALID_US_VISUAL_TOP_LEVEL/);
  assert.throws(() => validateUsVisualEnvelope({ ...response, findings: null }), /INVALID_US_VISUAL_TOP_LEVEL/);
});

test('empty OCR is presented as unread text, never proof of no text', () => {
  assert.match(ocrPresentation('NONE'), /不代表图片没有文字/);
  assert.match(ocrPresentation(''), /未读出/);
  assert.equal(ocrPresentation('Sterilite 19.99'), 'Sterilite 19.99');
  assert.match(ocrPresentation('NONE', 'unreadable_text_seen'), /看见文字或字符.*无法可靠转写/);
  assert.match(ocrPresentation('NONE', 'no_text_seen'), /本次未看见.*不代表图片没有文字/);
});

test('OCR state separates readable, unreadable and not-seen outcomes', () => {
  assert.deepEqual(validateUsOcrObservation({
    ocrStatus: 'readable_text', ocrText: 'Sterilite', visualObservation: '蓝色收纳箱正面可见压印', facts: [],
    textRegions: [{ id: 'text-1', text: 'Sterilite', origin: 'product', readability: 'readable', bbox: [0.2, 0.3, 0.3, 0.1] }]
  }).ocrText, 'Sterilite');
  assert.deepEqual(validateUsOcrObservation({
    ocrStatus: 'unreadable_text_seen', ocrText: 'NONE', visualObservation: '盒体下方有模糊小字', facts: [],
    textRegions: [{ id: 'text-1', text: null, origin: 'product', readability: 'unreadable', bbox: [0.2, 0.3, 0.3, 0.1] }]
  }).ocrStatus, 'unreadable_text_seen');
  assert.deepEqual(validateUsOcrObservation({
    ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: '白色背景中的单个收纳盒', facts: [], textRegions: []
  }).ocrStatus, 'no_text_seen');
});

test('contradictory OCR state cannot pass as a successful visual analysis', () => {
  assert.throws(() => validateUsOcrObservation({
    ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: '篮子正面可见字符', facts: [], textRegions: []
  }), /OCR_STATUS_OBSERVATION_CONFLICT/);
  assert.throws(() => validateUsOcrObservation({
    ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: '一个收纳篮',
    facts: [{ kind: 'price_text', description: '货架价签', textOrigin: 'scene' }], textRegions: []
  }), /OCR_STATUS_FACT_CONFLICT/);
  assert.throws(() => validateUsOcrObservation({
    ocrStatus: 'readable_text', ocrText: 'NONE', visualObservation: '一个收纳篮', facts: [], textRegions: []
  }), /OCR_STATUS_TEXT_CONFLICT/);
});

test('text region validator rejects guessed text, invalid bounds and OCR conflicts', () => {
  assert.throws(() => validateUsTextRegions([
    { id: 'text-1', text: 'GUESS', origin: 'product', readability: 'unreadable', bbox: [0.1, 0.1, 0.2, 0.1] }
  ]), /TEXT_REGION_READABILITY_CONFLICT/);
  assert.throws(() => validateUsTextRegions([
    { id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.9, 0.1, 0.2, 0.1] }
  ]), /INVALID_TEXT_REGION/);
  assert.throws(() => validateUsOcrObservation({
    ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: '白色背景中的收纳盒', facts: [],
    textRegions: [{ id: 'text-1', text: null, origin: 'uncertain', readability: 'unreadable', bbox: [0.1, 0.1, 0.2, 0.1] }]
  }), /OCR_STATUS_REGION_CONFLICT/);
});

test('US v7 binds OCR exactly to ordered readable regions and rejects duplicate boxes', () => {
  const regions = [
    { id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.1, 0.1, 0.2, 0.1] },
    { id: 'text-2', text: 'LIMITED', origin: 'overlay', readability: 'readable', bbox: [0.1, 0.25, 0.3, 0.1] }
  ];
  assert.equal(validateUsOcrObservation({
    ocrStatus: 'readable_text', ocrText: 'SALE\nLIMITED', visualObservation: '顶部两行促销文字', facts: [], textRegions: regions
  }).ocrText, 'SALE\nLIMITED');
  assert.throws(() => validateUsOcrObservation({
    ocrStatus: 'readable_text', ocrText: 'SALE LIMITED', visualObservation: '顶部两行促销文字', facts: [], textRegions: regions
  }), /OCR_STATUS_REGION_CONFLICT/);
  assert.throws(() => validateUsTextRegions([
    regions[0], { ...regions[0], id: 'text-2' }
  ]), /DUPLICATE_TEXT_REGION_BOX/);
  assert.throws(() => mapUsVisualFacts([
    { kind: 'multiple_products', description: '两件商品', textOrigin: 'not_applicable' }
  ]), /INVALID_VISUAL_FACT/);
  assert.match(usVisualInstructions(), /严格等于/);
  assert.match(usVisualInstructions(), /SALE、50%、OFF应为三个区域/);
  assert.match(usVisualInstructions(), /绝对不要报告为decorative_border/);
  assert.match(usVisualInstructions(), /报告occluded_product/);
  assert.match(usVisualInstructions(), /可另报一条low_clarity/);
  assert.match(usVisualInstructions(), /后四类必须固定写textOrigin=not_applicable且regionId=null/);
  assert.match(usVisualInstructions(), /商品主体外轮廓之外/);
  assert.match(usVisualInstructions(), /不得只引用第一个区域/);
  for (const kind of ['decorative_border', 'occluded_product', 'multiple_products', 'low_clarity']) {
    assert.throws(() => mapUsVisualFacts([
      { kind, description: '可见现象', textOrigin: 'product', regionId: 'text-1' }
    ], [{ id: 'text-1', text: 'MARK', origin: 'product', readability: 'readable', bbox: [0.2, 0.2, 0.2, 0.1] }]), /NON_TEXT_FACT_BINDING_CONFLICT/);
  }
});

test('visual mapping strategy is bound into the audit fingerprint', async () => {
  const rulepack = JSON.parse(await fs.readFile(new URL('../config/rulepacks/v1.0.0.json', import.meta.url), 'utf8'));
  const input = { route: 'US_GOOGLE', productTitle: 'test', image: { width: 1280, height: 853 }, requiresVisualReview: true };
  const old = analyzeProduct(input, rulepack);
  const current = analyzeProduct({ ...input, observationPolicy: 'us-visual-facts-v7', ocrStatus: 'no_text_seen', textRegions: [] }, rulepack);
  assert.notEqual(old.audit.inputFingerprint, current.audit.inputFingerprint);
  assert.equal(current.audit.observationPolicy, 'us-visual-facts-v7');
  assert.equal(current.audit.ocrStatus, 'no_text_seen');
  assert.equal(current.audit.fingerprintVersion, 7);
  assert.equal(current.summary.status, 'review');
});
