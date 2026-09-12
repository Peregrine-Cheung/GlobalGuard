import { analyzeWithModelRouter, modelRouterStatus } from './model-router.mjs';
import { EU_OFFER_FACTS_POLICY_VERSION } from './eu-offer-facts.mjs';

export const EU_LIVE_SMOKE_INPUT = Object.freeze({
  route: 'EU_GPSR',
  category: 'home-storage',
  productTitle: 'Synthetic folding storage box',
  productCopy: 'Synthetic non-sensitive development fixture.',
  offerFields: Object.freeze({
    manufacturerName: 'Synthetic Hebei Demo Manufacturing Ltd.',
    manufacturerCountry: 'CN',
    manufacturerPostalAddress: 'No. 1 Demo Road, Shijiazhuang, Hebei, China',
    manufacturerEmail: 'eu-smoke-maker@example.invalid',
    productId: 'GG-EU-SMOKE-001',
    safetyInfo: 'Keep away from open flames.',
    responsiblePersonName: '',
    responsiblePersonPostalAddress: '',
    responsiblePersonEmail: ''
  }),
  offerEvidence: Object.freeze({
    sourceRef: 'SYNTHETIC-DOSSIER-EU-SMOKE-001',
    excerpt: 'Synthetic manufacturer record: Synthetic Hebei Demo Manufacturing Ltd.; country CN; postal address No. 1 Demo Road, Shijiazhuang, Hebei, China; email eu-smoke-maker@example.invalid. Product identifier: GG-EU-SMOKE-001. Safety information: Keep away from open flames.'
  })
});

function inputSnapshot() {
  return structuredClone(EU_LIVE_SMOKE_INPUT);
}

export function buildEuSmokePreview(status = modelRouterStatus()) {
  return {
    schemaVersion: '1.0',
    mode: 'preview',
    willCallProvider: false,
    route: EU_LIVE_SMOKE_INPUT.route,
    observationPolicy: EU_OFFER_FACTS_POLICY_VERSION,
    provider: status.provider,
    baseUrl: status.baseUrl,
    primaryModel: status.primaryModel,
    configured: status.configured,
    appUseApproved: status.appUseApproved,
    maxProviderRequests: 1,
    fallbackDisabled: true,
    imageAttached: false,
    maxCompletionTokens: 1200,
    inputClassification: 'synthetic-non-sensitive',
    input: inputSnapshot(),
    executeAuthorization: ['--execute', '--confirm-one-request'],
    boundaries: {
      accuracyMeasured: false,
      legalCorrectnessProved: false,
      platformApprovalProved: false,
      realMerchantEvidence: false
    },
    notice: '默认只生成预览，不调用模型。执行模式最多发起一次供应商请求，不回退、不重试；结果只证明该次结构契约是否通过。'
  };
}

export async function runEuSmoke(rulepack, options = {}) {
  const status = options.status || modelRouterStatus();
  const analyze = options.analyze || analyzeWithModelRouter;
  if (!status.configured || !status.appUseApproved) {
    throw new Error('EU_LIVE_SMOKE_NOT_AUTHORIZED_OR_CONFIGURED');
  }
  let validatedRawOutput = null;
  const result = await analyze(inputSnapshot(), rulepack, {
    allowFallback: false,
    captureValidatedOutput(value) {
      validatedRawOutput = structuredClone(value);
    }
  });
  if (!validatedRawOutput) throw new Error('EU_LIVE_SMOKE_VALIDATED_OUTPUT_NOT_CAPTURED');
  return {
    schemaVersion: '1.0',
    kind: 'single-request-synthetic-eu-contract-smoke',
    executedAt: new Date().toISOString(),
    route: EU_LIVE_SMOKE_INPUT.route,
    observationPolicy: EU_OFFER_FACTS_POLICY_VERSION,
    inputClassification: 'synthetic-non-sensitive',
    maxProviderRequests: 1,
    fallbackDisabled: true,
    imageAttached: false,
    input: inputSnapshot(),
    validatedRawOutput,
    euFieldFacts: result.euFieldFacts,
    telemetry: result.telemetry,
    boundaries: {
      accuracyMeasured: false,
      legalCorrectnessProved: false,
      platformApprovalProved: false,
      realMerchantEvidence: false
    }
  };
}
