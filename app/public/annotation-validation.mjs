export const ANNOTATION_CASE_IDS = Object.freeze([
  'fixture-01', 'fixture-02', 'fixture-03', 'fixture-04', 'fixture-05', 'fixture-06'
]);

export const ANNOTATION_DATASETS = Object.freeze({
  'globalguard-visual-fixtures-v1': Object.freeze({
    key: 'baseline-v1', caseIds: ANNOTATION_CASE_IDS, assetRoot: '/visual-fixtures/', label: '基础六图'
  }),
  'globalguard-visual-robustness-v1': Object.freeze({
    key: 'robustness-v1',
    caseIds: Object.freeze(Array.from({ length: 10 }, (_, index) => `robustness-${String(index + 1).padStart(2, '0')}`)),
    assetRoot: '/robustness-fixtures/', label: '鲁棒性十图'
  })
});

const OCR_STATUSES = new Set(['readable_text', 'unreadable_text_seen', 'no_text_seen']);
const ORIGINS = new Set(['overlay', 'product', 'scene', 'uncertain']);
const READABILITIES = new Set(['readable', 'unreadable']);
const FACT_KINDS = new Set([
  'promotional_overlay', 'watermark', 'decorative_border', 'price_text',
  'occluded_product', 'multiple_products', 'low_clarity'
]);

function fail(code, caseId = null) {
  const error = new Error(caseId ? `${code}:${caseId}` : code);
  error.code = code;
  error.caseId = caseId;
  throw error;
}

function exactKeys(value, keys) {
  const actual = value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value) : [];
  return actual.length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function normalizeRegion(region, index, caseId) {
  if (!exactKeys(region, ['id', 'text', 'origin', 'readability', 'bbox'])
      || region.id !== `text-${index + 1}` || !ORIGINS.has(region.origin)
      || !READABILITIES.has(region.readability) || !Array.isArray(region.bbox) || region.bbox.length !== 4
      || region.bbox.some(value => !Number.isFinite(value) || value < 0 || value > 1)
      || region.bbox[2] <= 0 || region.bbox[3] <= 0
      || region.bbox[0] + region.bbox[2] > 1.000001 || region.bbox[1] + region.bbox[3] > 1.000001) {
    fail('INVALID_HUMAN_TEXT_REGION', caseId);
  }
  const text = typeof region.text === 'string' ? region.text.trim() : '';
  if ((region.readability === 'readable' && (!text || /^NONE$/i.test(text)))
      || (region.readability === 'unreadable' && region.text !== null)) fail('HUMAN_REGION_READABILITY_CONFLICT', caseId);
  return { ...region, text: region.readability === 'readable' ? text : null, bbox: region.bbox.map(Number) };
}

function normalizeLabel(label, caseId) {
  if (!exactKeys(label, ['ocrStatus', 'ocrText', 'textRegions', 'visualFacts', 'notes'])
      || !OCR_STATUSES.has(label.ocrStatus) || typeof label.ocrText !== 'string'
      || !Array.isArray(label.textRegions) || label.textRegions.length > 8
      || !Array.isArray(label.visualFacts) || label.visualFacts.length > 4
      || typeof label.notes !== 'string' || label.notes.length > 1000) fail('INVALID_HUMAN_LABEL', caseId);
  const regions = label.textRegions.map((region, index) => normalizeRegion(region, index, caseId));
  const readable = regions.filter(region => region.readability === 'readable');
  const expectedText = readable.map(region => region.text).join('\n');
  const ocrText = label.ocrText.trim();
  if (label.ocrStatus === 'readable_text' && (!readable.length || ocrText !== expectedText)) {
    fail('HUMAN_OCR_TEXT_CONFLICT', caseId);
  }
  if (label.ocrStatus === 'unreadable_text_seen'
      && (!regions.length || readable.length || ocrText !== 'NONE')) fail('HUMAN_OCR_TEXT_CONFLICT', caseId);
  if (label.ocrStatus === 'no_text_seen'
      && (regions.length || ocrText !== 'NONE')) fail('HUMAN_OCR_TEXT_CONFLICT', caseId);
  const byId = new Map(regions.map(region => [region.id, region]));
  const facts = label.visualFacts.map(fact => {
    if (!exactKeys(fact, ['kind', 'textOrigin', 'regionId']) || !FACT_KINDS.has(fact.kind)) {
      fail('INVALID_HUMAN_VISUAL_FACT', caseId);
    }
    const textKind = ['promotional_overlay', 'watermark', 'price_text'].includes(fact.kind);
    if (textKind) {
      const region = byId.get(fact.regionId);
      if (!region || fact.textOrigin !== region.origin) fail('HUMAN_FACT_REGION_CONFLICT', caseId);
    } else if (fact.textOrigin !== 'not_applicable' || fact.regionId !== null) {
      fail('HUMAN_FACT_REGION_CONFLICT', caseId);
    }
    return fact;
  });
  return { ocrStatus: label.ocrStatus, ocrText, textRegions: regions, visualFacts: facts, notes: label.notes.trim() };
}

export function createBlankAnnotationPack(datasetId = 'globalguard-visual-fixtures-v1') {
  const profile = ANNOTATION_DATASETS[datasetId];
  if (!profile) fail('UNKNOWN_ANNOTATION_DATASET');
  return {
    schemaVersion: '1.0', datasetId,
    annotationStatus: 'blank-human-review-template', annotator: null, reviewedAt: null,
    cases: profile.caseIds.map(id => ({
      id, humanLabel: { ocrStatus: null, ocrText: null, textRegions: [], visualFacts: [], notes: '' }
    }))
  };
}

export function validateHumanAnnotationPack(pack) {
  const profile = ANNOTATION_DATASETS[pack?.datasetId];
  if (!pack || typeof pack !== 'object' || pack.schemaVersion !== '1.0'
      || !profile
      || pack.annotationStatus !== 'completed-single-human-review'
      || typeof pack.annotator !== 'string' || !pack.annotator.trim() || pack.annotator.trim().length > 100
      || typeof pack.reviewedAt !== 'string' || !Number.isFinite(Date.parse(pack.reviewedAt))
      || !Array.isArray(pack.cases) || pack.cases.length !== profile.caseIds.length) fail('INVALID_HUMAN_ANNOTATION_PACK');
  const ids = pack.cases.map(item => item?.id);
  if (new Set(ids).size !== ids.length || ids.some((id, index) => id !== profile.caseIds[index])) {
    fail('HUMAN_CASE_ORDER_MISMATCH');
  }
  return {
    schemaVersion: '1.0', datasetId: pack.datasetId,
    annotationStatus: 'completed-single-human-review',
    annotator: pack.annotator.trim(), reviewedAt: new Date(pack.reviewedAt).toISOString(),
    cases: pack.cases.map(item => ({ id: item.id, humanLabel: normalizeLabel(item.humanLabel, item.id) })),
    limitations: {
      singleAnnotator: true, interAnnotatorAgreementMeasured: false,
      modelAccuracyEstablished: false, legalCorrectnessEstablished: false
    }
  };
}
