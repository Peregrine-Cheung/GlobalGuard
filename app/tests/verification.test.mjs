import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { signalsForRecheck, recheckPresentation, textRegionPresentations, containFitRect, buildUsRepairProtectionPlan } from '../public/verification.mjs';
import { analyzeProduct } from '../src/rule-engine.mjs';

const rules = JSON.parse(await fs.readFile(new URL('../config/rulepacks/v1.0.0.json', import.meta.url), 'utf8'));
const base = { route: 'US_GOOGLE', image: { width: 720, height: 720 }, visualSignals: {} };

test('changed output does not assert that promotional content is absent', () => {
  const result = signalsForRecheck({ overlayText: 'BEST', hasPromotionalOverlay: true, hasSyntheticMetadata: true }, { hasBorder: true, imageChanged: true });
  assert.equal(result.hasBorder, true);
  assert.equal(result.hasPromotionalOverlay, null);
  assert.equal(result.unverifiedPreviousOverlayText, 'BEST');
  assert.equal(result.semanticVerification, 'pending');
  assert.equal(result.hasSyntheticMetadata, false);
});

test('unchanged image keeps known text during copy-only repairs', () => {
  const result = signalsForRecheck({ overlayText: 'BEST', hasPromotionalOverlay: true }, { hasBorder: false, imageChanged: false });
  assert.equal(result.overlayText, 'BEST');
  assert.equal(result.hasPromotionalOverlay, true);
});

test('no-crop reframe preserves known visual risks for recheck', () => {
  const result = signalsForRecheck({
    overlayText: 'BEST', hasPromotionalOverlay: true, hasBorder: true, borderMethod: 'sample-layout-v1'
  }, { hasBorder: false, imageChanged: true, preserveVisualContent: true });
  assert.equal(result.overlayText, 'BEST');
  assert.equal(result.hasPromotionalOverlay, true);
  assert.equal(result.hasBorder, true);
  assert.equal(result.borderMethod, 'sample-layout-v1');
  assert.equal(result.semanticVerification, 'source-content-preserved');
});

test('zero blockers with human review outstanding is not displayed as passed', () => {
  const result = recheckPresentation({ status: 'review', blockerCount: 0, reviewCount: 1 });
  assert.equal(result.passed, false);
  assert.equal(result.className, 'review');
  assert.equal(result.label, '待人工复核');
});

test('verification coverage gap is distinct from a platform violation', () => {
  const result = analyzeProduct({ ...base, requiresVisualReview: true }, rules);
  assert.equal(result.summary.status, 'review');
  assert.equal(result.summary.blockerCount, 0);
  const gap = result.risks.find(risk => risk.ruleId === 'GG-VERIFY-IMAGE-001');
  assert.equal(gap.origin, 'verification-gate');
  assert.deepEqual(gap.evidence, []);
});

test('edge color heuristic alone cannot assert a confirmed border blocker', () => {
  const result = analyzeProduct({ ...base, visualSignals: { hasBorder: true, borderMethod: 'edge-color-heuristic-v1' } }, rules);
  assert.equal(result.summary.status, 'review');
  assert.equal(result.summary.blockerCount, 0);
  assert.equal(result.risks[0].requiresHumanReview, true);
});

test('different submitted image content changes fingerprints with equal metadata', () => {
  const a = analyzeProduct({ ...base, imageDataUrl: 'data:image/png;base64,AQ==' }, rules);
  const b = analyzeProduct({ ...base, imageDataUrl: 'data:image/png;base64,Ag==' }, rules);
  assert.notEqual(a.audit.inputFingerprint, b.audit.inputFingerprint);
  assert.notEqual(a.audit.imageInputSha256, b.audit.imageInputSha256);
  assert.equal(a.audit.imageInputSha256.length, 64);
  assert.equal(a.audit.fingerprintVersion, 7);
});

test('evidence references and AI declarations are part of input identity', () => {
  const first = analyzeProduct({ ...base, route: 'CN_ADS', claimEvidenceUrl: '' }, rules);
  const second = analyzeProduct({ ...base, route: 'CN_ADS', claimEvidenceUrl: 'REPORT-001' }, rules);
  const third = analyzeProduct({ ...base, route: 'CN_ADS', claimEvidenceUrl: 'REPORT-001', aiLabelDeclared: true }, rules);
  assert.notEqual(first.audit.inputFingerprint, second.audit.inputFingerprint);
  assert.notEqual(second.audit.inputFingerprint, third.audit.inputFingerprint);
});

test('normalized text regions become safe percentage boxes', () => {
  assert.deepEqual(textRegionPresentations([
    { id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.1, 0.2, 0.3, 0.1] },
    { id: 'text-2', text: null, origin: 'product', readability: 'unreadable', bbox: [0.2, 0.5, 0.4, 0.05] }
  ]), [
    { id: 'text-1', label: '后加叠层 · SALE', x: 10, y: 20, width: 30, height: 10 },
    { id: 'text-2', label: '商品/包装 · 文字未读清', x: 20, y: 50, width: 40, height: 5 }
  ]);
  assert.deepEqual(textRegionPresentations([{ id: 'text-1', text: 'BAD', origin: 'overlay', readability: 'readable', bbox: [0.9, 0, 0.2, 0.1] }]), []);
});

test('contain-fit overlay follows the displayed image instead of letterbox space', () => {
  assert.deepEqual(containFitRect(400, 400, 800, 400), { left: 0, top: 100, width: 400, height: 200 });
  assert.deepEqual(containFitRect(300, 500, 300, 600), { left: 25, top: 0, width: 250, height: 500 });
  assert.equal(containFitRect(0, 400, 800, 400), null);
});

test('repair protection permits a linked overlay crop while preserving product text', () => {
  const plan = buildUsRepairProtectionPlan({
    cropRect: { x: 13 / 420, y: 84 / 420, width: 394 / 420, height: 322 / 420 },
    textRegions: [
      { id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.1, 0.1, 0.35, 0.12] },
      { id: 'text-2', text: 'BOX', origin: 'product', readability: 'readable', bbox: [0.35, 0.55, 0.25, 0.1] }
    ],
    risks: [{ ruleId: 'GG-US-VISUAL-PROMOTIONAL-OVERLAY', evidenceRegionId: 'text-1' }],
    fixes: [{ id: 'fix-remove-overlay' }]
  });
  assert.equal(plan.coverage, 'model-regions-present');
  assert.deepEqual(plan.removalCandidates.map(region => region.id), ['text-1']);
  assert.deepEqual(plan.protectedRegions.map(region => region.id), ['text-2']);
  assert.equal(plan.removalCandidates[0].affectedByCrop, true);
  assert.equal(plan.blockedRegions.length, 0);
  assert.equal(plan.canApply, true);
});

test('repair protection blocks a crop that would touch product or unlinked text', () => {
  const plan = buildUsRepairProtectionPlan({
    cropRect: { x: 0.03, y: 0.2, width: 0.94, height: 0.76 },
    textRegions: [
      { id: 'text-1', text: 'BRAND', origin: 'product', readability: 'readable', bbox: [0.2, 0.05, 0.2, 0.1] },
      { id: 'text-2', text: null, origin: 'overlay', readability: 'unreadable', bbox: [0.7, 0.92, 0.2, 0.07] }
    ],
    risks: [], fixes: [{ id: 'fix-trim-border' }]
  });
  assert.deepEqual(plan.blockedRegions.map(region => region.id), ['text-1', 'text-2']);
  assert.equal(plan.canApply, false);
});

test('missing region coverage remains explicit and requires human confirmation', () => {
  const plan = buildUsRepairProtectionPlan({ fixes: [{ id: 'fix-resize-720' }] });
  assert.equal(plan.coverage, 'model-regions-missing');
  assert.equal(plan.requiresConfirmation, true);
  assert.equal(plan.canApply, true);
});

test('safe reframe treats every observed region as protected and removes no pixels', () => {
  const plan = buildUsRepairProtectionPlan({
    operation: 'safe-reframe-no-crop',
    cropRect: { x: 0, y: 0, width: 1, height: 1 },
    textRegions: [{ id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.1, 0.1, 0.35, 0.12] }],
    risks: [{ ruleId: 'GG-US-VISUAL-PROMOTIONAL-OVERLAY', evidenceRegionId: 'text-1' }],
    fixes: [{ id: 'fix-resize-720' }]
  });
  assert.equal(plan.hasRemovalIntent, false);
  assert.deepEqual(plan.removalCandidates, []);
  assert.deepEqual(plan.protectedRegions.map(region => region.id), ['text-1']);
  assert.equal(plan.canApply, true);
});
