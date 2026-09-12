import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVisualFixtureRuns } from '../src/visual-model-evaluator.mjs';

const reference = {
  datasetId: 'synthetic-test',
  cases: [
    { id: 'a', constructionTruth: { ocrStatus: 'no_text_seen', ocrText: 'NONE', textRegions: [], visualFacts: [] } },
    { id: 'b', constructionTruth: {
      ocrStatus: 'readable_text', ocrText: 'SALE',
      textRegions: [{ id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.1, 0.1, 0.4, 0.2] }],
      visualFacts: [{ kind: 'promotional_overlay', textOrigin: 'overlay', regionId: 'text-1' }]
    } }
  ]
};

test('reports strict construction agreement without claiming model accuracy', () => {
  const report = evaluateVisualFixtureRuns(reference, { runs: [
    { id: 'a', status: 'passed', prediction: { ocrStatus: 'no_text_seen', ocrText: 'NONE', textRegions: [], findings: [] } },
    { id: 'b', status: 'passed', prediction: {
      ocrStatus: 'readable_text', ocrText: 'SALE',
      textRegions: [{ id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.11, 0.1, 0.39, 0.2] }],
      findings: [{ kind: 'promotional_overlay', textOrigin: 'overlay', regionId: 'text-1', description: '顶部促销叠字' }]
    } }
  ] });
  assert.equal(report.evaluationKind, 'synthetic-construction-agreement');
  assert.equal(report.modelAccuracyMeasured, false);
  assert.equal(report.totals.strictAgreement, 2);
  assert.equal(report.totals.strictConstructionAgreementRate, 1);
});

test('separates request failure, semantic mismatch and weak localization', () => {
  const report = evaluateVisualFixtureRuns(reference, { runs: [
    { id: 'a', status: 'failed', errorCode: 'MODEL_ROUTER_INVALID_OCR_OBSERVATION', telemetry: { requestId: 'req-a' } },
    { id: 'b', status: 'passed', prediction: {
      ocrStatus: 'readable_text', ocrText: 'SALE',
      textRegions: [{ id: 'text-1', text: 'SALE', origin: 'product', readability: 'readable', bbox: [0.8, 0.8, 0.1, 0.1] }],
      findings: []
    } }
  ] });
  assert.equal(report.totals.requestSucceeded, 2);
  assert.equal(report.totals.contractPassed, 1);
  assert.equal(report.totals.strictAgreement, 0);
  assert.equal(report.cases[1].checks.ocrText, true);
  assert.equal(report.cases[1].checks.regionSemantics, false);
  assert.equal(report.cases[1].checks.regionLocalization, false);
  assert.equal(report.cases[1].checks.visualFactSet, false);
});

test('rejects a blank human template or malformed run set as a reference', () => {
  assert.throws(() => evaluateVisualFixtureRuns({ cases: [{ id: 'a', humanLabel: {} }] }, { runs: [] }),
    /VISUAL_REFERENCE_MUST_BE_CONSTRUCTION_OR_COMPLETED_HUMAN_REVIEW/);
  assert.throws(() => evaluateVisualFixtureRuns(reference, {}), /INVALID_VISUAL_MODEL_RUN_SET/);
});

test('compares a completed human review while retaining single-review limitations', () => {
  const human = {
    schemaVersion: '1.0', datasetId: 'globalguard-visual-fixtures-v1',
    annotationStatus: 'completed-single-human-review', annotator: 'reviewer', reviewedAt: '2026-09-10T12:00:00Z',
    cases: ['fixture-01','fixture-02','fixture-03','fixture-04','fixture-05','fixture-06'].map(id => ({
      id, humanLabel: { ocrStatus: 'no_text_seen', ocrText: 'NONE', textRegions: [], visualFacts: [], notes: '' }
    }))
  };
  const runSet = { runs: human.cases.map(item => ({ id: item.id, status: 'passed', prediction: {
    ocrStatus: 'no_text_seen', ocrText: 'NONE', textRegions: [], findings: []
  } })) };
  const report = evaluateVisualFixtureRuns(human, runSet);
  assert.equal(report.evaluationKind, 'single-human-review-agreement');
  assert.equal(report.humanReviewAgreementMeasured, true);
  assert.equal(report.modelAccuracyMeasured, false);
  assert.equal(report.totals.strictSingleHumanAgreementRate, 1);
  assert.equal(report.totals.strictConstructionAgreementRate, undefined);

  const subset = evaluateVisualFixtureRuns(human, { runs: runSet.runs.slice(0, 2) }, {
    caseIds: ['fixture-01', 'fixture-02']
  });
  assert.equal(subset.totals.cases, 2);
  assert.equal(subset.totals.strictAgreement, 2);
  assert.throws(() => evaluateVisualFixtureRuns(human, runSet, {
    caseIds: ['fixture-01', 'missing-case']
  }), /INVALID_VISUAL_REFERENCE_CASE_SELECTION/);
});
