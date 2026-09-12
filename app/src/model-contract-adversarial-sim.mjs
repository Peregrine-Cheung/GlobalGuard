import { validateUsVisualEnvelope, validateUsOcrObservation, mapUsVisualFacts } from './us-visual-facts.mjs';
import { validateCnAdFacts } from './cn-ad-facts.mjs';
import { EU_OFFER_FIELDS, validateEuOfferFacts } from './eu-offer-facts.mjs';

function clone(value) {
  return structuredClone(value);
}

function validateUs(response) {
  const envelope = validateUsVisualEnvelope(response);
  const ocr = validateUsOcrObservation({
    ocrStatus: envelope.ocrStatus,
    ocrText: envelope.ocrText,
    visualObservation: envelope.visualObservation,
    facts: envelope.findings,
    textRegions: envelope.textRegions
  });
  mapUsVisualFacts(envelope.findings, ocr.textRegions);
}

function usTrial(index) {
  const response = {
    ocrStatus: 'readable_text', ocrText: `SALE${index}`, visualObservation: '顶部可见促销文字',
    textRegions: [{ id: 'text-1', text: `SALE${index}`, origin: 'overlay', readability: 'readable', bbox: [0.1, 0.1, 0.3, 0.1] }],
    findings: [{ kind: 'promotional_overlay', description: '顶部促销文字', textOrigin: 'overlay', regionId: 'text-1' }]
  };
  const mutation = index % 6;
  if (mutation === 0) response.severity = 'ready';
  if (mutation === 1) response.ocrText += '\nINJECTED';
  if (mutation === 2) response.textRegions.push({ ...response.textRegions[0], id: 'text-2' });
  if (mutation === 3) response.textRegions[0].bbox = [0.9, 0.1, 0.2, 0.1];
  if (mutation === 4) delete response.findings[0].regionId;
  if (mutation === 5) response.findings[0].textOrigin = 'product';
  return { response, mutation: ['top-level-decision', 'ocr-extra-text', 'duplicate-box', 'out-of-bounds-box', 'missing-region-key', 'origin-mismatch'][mutation] };
}

function cnTrial(index) {
  const number = 80 + index;
  const input = { productTitle: '折叠收纳箱', productCopy: `据测试报告A，承重提升 ${number}%。` };
  const response = {
    imageTextStatus: 'no_text_seen', imageText: 'NONE',
    claims: [{ id: 'claim-1', verbatim: `承重提升 ${number}%`, source: 'product_copy', kind: 'numeric_or_statistical', numericTokens: [`${number}%`], referenceTokens: [] }]
  };
  const mutation = index % 6;
  if (mutation === 0) response.claims[0].verbatim = `承重行业领先 ${number}%`;
  if (mutation === 1) response.claims[0].numericTokens = [];
  if (mutation === 2) response.claims[0].numericTokens = [`${number + 1}%`];
  if (mutation === 3) response.claims.push({ ...response.claims[0], id: 'claim-2' });
  if (mutation === 4) response.legalDecision = 'compliant';
  if (mutation === 5) response.claims[0] = { id: 'claim-1', verbatim: '据测试报告A', source: 'product_copy', kind: 'citation_or_reference', numericTokens: [], referenceTokens: [] };
  return { input, response, mutation: ['paraphrase', 'numeric-omission', 'numeric-invention', 'duplicate-claim', 'decision-injection', 'citation-token-omission'][mutation] };
}

function euTrial(index) {
  const id = `BOX-${100 + index}`;
  const offerFields = Object.fromEntries(EU_OFFER_FIELDS.map(field => [field, '']));
  Object.assign(offerFields, { manufacturerName: 'Example Maker', manufacturerCountry: 'CN', productId: id });
  const offerEvidence = { sourceRef: `D-${index}`, excerpt: `制造商 Example Maker；国家 CN；型号 ${id}。` };
  const response = { fieldFacts: EU_OFFER_FIELDS.map(field => ({
    field,
    providedValue: offerFields[field] || null,
    sourceQuote: offerFields[field] ? offerFields[field] : null
  })) };
  const mutation = index % 6;
  if (mutation === 0) response.fieldFacts[6].providedValue = 'Invented EU RP';
  if (mutation === 1) response.fieldFacts[4].providedValue = `${id}-CHANGED`;
  if (mutation === 2) response.fieldFacts[4].sourceQuote = `不存在 ${id}`;
  if (mutation === 3) [response.fieldFacts[0], response.fieldFacts[1]] = [response.fieldFacts[1], response.fieldFacts[0]];
  if (mutation === 4) response.fieldFacts[0].severity = 'ready';
  if (mutation === 5) offerEvidence.sourceRef = '';
  return { input: { offerFields, offerEvidence }, response, mutation: ['missing-field-generation', 'value-change', 'quote-invention', 'field-order-drift', 'decision-injection', 'quote-without-source'][mutation] };
}

export function runAdversarialSimulation(iterationsPerRoute = 30) {
  if (!Number.isInteger(iterationsPerRoute) || iterationsPerRoute < 6 || iterationsPerRoute > 200) {
    throw new Error('INVALID_SIMULATION_ITERATION_COUNT');
  }
  const routes = [
    { route: 'US_GOOGLE', make: usTrial, validate: item => validateUs(clone(item.response)) },
    { route: 'CN_ADS', make: cnTrial, validate: item => validateCnAdFacts(clone(item.response), clone(item.input)) },
    { route: 'EU_GPSR', make: euTrial, validate: item => validateEuOfferFacts(clone(item.response), clone(item.input)) }
  ];
  const results = routes.map(({ route, make, validate }) => {
    const survivors = [];
    const errorCounts = {};
    for (let index = 0; index < iterationsPerRoute; index += 1) {
      const item = make(index);
      try {
        validate(item);
        survivors.push({ index, mutation: item.mutation });
      } catch (error) {
        errorCounts[error.message] = (errorCounts[error.message] || 0) + 1;
      }
    }
    return { route, trials: iterationsPerRoute, expectedRejects: iterationsPerRoute, rejected: iterationsPerRoute - survivors.length, survivors, errorCounts };
  });
  const totals = results.reduce((sum, item) => ({
    trials: sum.trials + item.trials,
    rejected: sum.rejected + item.rejected,
    survivors: sum.survivors + item.survivors.length
  }), { trials: 0, rejected: 0, survivors: 0 });
  return {
    suiteId: 'globalguard-adversarial-contract-simulation-v1',
    datasetType: 'deterministic-generated-contract-mutations',
    notice: '只验证已定义对抗变体被本地结构校验拒绝，不代表模型准确率、攻击覆盖率、法律正确率或生产安全认证。',
    iterationsPerRoute,
    results,
    totals,
    allExpectedMutationsRejected: totals.survivors === 0
  };
}
