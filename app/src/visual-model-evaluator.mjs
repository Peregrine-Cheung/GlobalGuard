const OCR_STATUSES = new Set(['readable_text', 'unreadable_text_seen', 'no_text_seen']);

function normalizedText(value) {
  return String(value ?? '').replace(/\r\n/g, '\n').trim();
}

function iou(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== 4 || b.length !== 4) return 0;
  const left = Math.max(a[0], b[0]);
  const top = Math.max(a[1], b[1]);
  const right = Math.min(a[0] + a[2], b[0] + b[2]);
  const bottom = Math.min(a[1] + a[3], b[1] + b[3]);
  const intersection = Math.max(0, right - left) * Math.max(0, bottom - top);
  const union = a[2] * a[3] + b[2] * b[3] - intersection;
  return union > 0 ? intersection / union : 0;
}

function centerDistance(a, b) {
  const ax = a[0] + a[2] / 2;
  const ay = a[1] + a[3] / 2;
  const bx = b[0] + b[2] / 2;
  const by = b[1] + b[3] / 2;
  return Math.hypot(ax - bx, ay - by);
}

function referenceCases(reference) {
  if (!reference || typeof reference !== 'object' || !Array.isArray(reference.cases)) {
    throw new Error('INVALID_VISUAL_REFERENCE');
  }
  if (reference.cases.every(item => item?.id && item.constructionTruth)) {
    return {
      cases: reference.cases.map(item => ({ id: item.id, label: item.constructionTruth })),
      evaluationKind: 'synthetic-construction-agreement',
      referenceStatus: 'synthetic-construction-truth-not-human-gold',
      rateKey: 'strictConstructionAgreementRate'
    };
  }
  let validated;
  try { validated = validateHumanAnnotationPack(reference); }
  catch { throw new Error('VISUAL_REFERENCE_MUST_BE_CONSTRUCTION_OR_COMPLETED_HUMAN_REVIEW'); }
  return {
    cases: validated.cases.map(item => ({ id: item.id, label: item.humanLabel })),
    evaluationKind: 'single-human-review-agreement',
    referenceStatus: 'completed-single-human-review-not-consensus-gold',
    rateKey: 'strictSingleHumanAgreementRate'
  };
}

function factKey(fact) {
  return `${fact?.kind ?? ''}|${fact?.textOrigin ?? ''}|${fact?.regionId ?? ''}`;
}

function compareCase(reference, run) {
  const prediction = run?.prediction;
  const requestSucceeded = Boolean(run?.telemetry?.requestId) || run?.status === 'passed';
  if (run?.status !== 'passed' || !prediction) {
    return {
      id: reference.id,
      requestSucceeded,
      contractPassed: false,
      strictAgreement: false,
      errorCode: run?.errorCode || 'MISSING_MODEL_RUN'
    };
  }
  const expected = reference.label;
  const actualRegions = Array.isArray(prediction.textRegions) ? prediction.textRegions : [];
  const expectedRegions = Array.isArray(expected.textRegions) ? expected.textRegions : [];
  const regionPairs = expectedRegions.map((region, index) => {
    const actual = actualRegions[index];
    const overlap = actual ? iou(region.bbox, actual.bbox) : 0;
    const distance = actual ? centerDistance(region.bbox, actual.bbox) : Number.POSITIVE_INFINITY;
    return {
      index,
      textMatch: Boolean(actual) && normalizedText(actual.text) === normalizedText(region.text),
      originMatch: Boolean(actual) && actual.origin === region.origin,
      readabilityMatch: Boolean(actual) && actual.readability === region.readability,
      bboxIou: Number(overlap.toFixed(4)),
      centerDistance: Number.isFinite(distance) ? Number(distance.toFixed(4)) : null,
      localizationMatch: overlap >= 0.5 || distance <= 0.04
    };
  });
  const expectedFacts = (expected.visualFacts || []).map(factKey).sort();
  const actualFacts = (prediction.findings || []).map(factKey).sort();
  const checks = {
    ocrStatus: OCR_STATUSES.has(prediction.ocrStatus) && prediction.ocrStatus === expected.ocrStatus,
    ocrText: normalizedText(prediction.ocrText) === normalizedText(expected.ocrText),
    regionCount: actualRegions.length === expectedRegions.length,
    regionSemantics: regionPairs.every(pair => pair.textMatch && pair.originMatch && pair.readabilityMatch),
    regionLocalization: regionPairs.every(pair => pair.localizationMatch),
    visualFactSet: JSON.stringify(actualFacts) === JSON.stringify(expectedFacts)
  };
  return {
    id: reference.id,
    requestSucceeded: true,
    contractPassed: true,
    strictAgreement: Object.values(checks).every(Boolean),
    checks,
    regionPairs
  };
}

export function evaluateVisualFixtureRuns(reference, runSet, { caseIds = null } = {}) {
  if (!runSet || typeof runSet !== 'object' || !Array.isArray(runSet.runs)) {
    throw new Error('INVALID_VISUAL_MODEL_RUN_SET');
  }
  const referenceSet = referenceCases(reference);
  const selectedIds = caseIds === null ? null : new Set(caseIds);
  if (selectedIds && (selectedIds.size !== caseIds.length
    || [...selectedIds].some(id => !referenceSet.cases.some(item => item.id === id)))) {
    throw new Error('INVALID_VISUAL_REFERENCE_CASE_SELECTION');
  }
  const selectedReferenceCases = selectedIds
    ? referenceSet.cases.filter(item => selectedIds.has(item.id))
    : referenceSet.cases;
  const runsById = new Map(runSet.runs.map(run => [run.id, run]));
  const cases = selectedReferenceCases.map(item => compareCase(item, runsById.get(item.id)));
  const requestSucceeded = cases.filter(item => item.requestSucceeded).length;
  const contractPassed = cases.filter(item => item.contractPassed).length;
  const strictAgreement = cases.filter(item => item.strictAgreement).length;
  return {
    schemaVersion: '1.0',
    evaluationKind: referenceSet.evaluationKind,
    datasetId: reference.datasetId,
    referenceStatus: referenceSet.referenceStatus,
    humanReviewAgreementMeasured: referenceSet.evaluationKind === 'single-human-review-agreement',
    modelAccuracyMeasured: false,
    legalCorrectnessMeasured: false,
    realMerchantPerformanceMeasured: false,
    localizationThreshold: 'ordered text region bbox IoU >= 0.50 or normalized center distance <= 0.04',
    cases,
    totals: {
      cases: cases.length,
      requestSucceeded,
      contractPassed,
      strictAgreement,
      [referenceSet.rateKey]: cases.length ? Number((strictAgreement / cases.length).toFixed(4)) : null
    },
    notice: referenceSet.evaluationKind === 'single-human-review-agreement'
      ? '该比例仅表示模型输出与一次单人人工复核标签的一致性，不是多人金标准、模型准确率、法律正确率或平台通过率。'
      : '该比例仅表示模型输出与确定性合成夹具构造规范的一致性，不是模型准确率、真实图片效果、法律正确率或平台通过率。'
  };
}
import { validateHumanAnnotationPack } from '../public/annotation-validation.mjs';
