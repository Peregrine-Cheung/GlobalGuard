import { analyzeWithModelRouter, modelRouterStatus } from './model-router.mjs';
import { CN_AD_FACTS_POLICY_VERSION } from './cn-ad-facts.mjs';

export const CN_LIVE_SMOKE_INPUT = Object.freeze({
  route: 'CN_ADS',
  category: 'home-storage',
  productTitle: '全网最佳折叠收纳箱',
  productCopy: '合成测试文案：用户好评率98%，据测试报告A，收纳效率提升30%。',
  visualSignals: Object.freeze({})
});

function snapshot() {
  return structuredClone(CN_LIVE_SMOKE_INPUT);
}

export function buildCnSmokePreview(status = modelRouterStatus()) {
  return {
    schemaVersion: '1.0', mode: 'preview', willCallProvider: false,
    route: CN_LIVE_SMOKE_INPUT.route, observationPolicy: CN_AD_FACTS_POLICY_VERSION,
    provider: status.provider, baseUrl: status.baseUrl, primaryModel: status.primaryModel,
    configured: status.configured, appUseApproved: status.appUseApproved,
    maxProviderRequests: 1, fallbackDisabled: true, imageAttached: false,
    maxCompletionTokens: 900, inputClassification: 'synthetic-non-sensitive',
    input: snapshot(), executeAuthorization: ['--execute', '--confirm-one-request'],
    boundaries: { accuracyMeasured: false, legalCorrectnessProved: false, platformApprovalProved: false },
    notice: '默认只预览。执行模式最多一次供应商请求，不回退、不重试；结果只证明该次逐字事实结构是否通过。'
  };
}

export async function runCnSmoke(rulepack, options = {}) {
  const status = options.status || modelRouterStatus();
  const analyze = options.analyze || analyzeWithModelRouter;
  if (!status.configured || !status.appUseApproved) throw new Error('CN_LIVE_SMOKE_NOT_AUTHORIZED_OR_CONFIGURED');
  let validatedRawOutput = null;
  const result = await analyze(snapshot(), rulepack, {
    allowFallback: false,
    captureValidatedOutput(value) { validatedRawOutput = structuredClone(value); }
  });
  if (!validatedRawOutput) throw new Error('CN_LIVE_SMOKE_VALIDATED_OUTPUT_NOT_CAPTURED');
  return {
    schemaVersion: '1.0', kind: 'single-request-synthetic-cn-contract-smoke',
    executedAt: new Date().toISOString(), route: CN_LIVE_SMOKE_INPUT.route,
    observationPolicy: CN_AD_FACTS_POLICY_VERSION, inputClassification: 'synthetic-non-sensitive',
    maxProviderRequests: 1, fallbackDisabled: true, imageAttached: false,
    input: snapshot(), validatedRawOutput, cnClaimFacts: result.cnClaimFacts,
    telemetry: result.telemetry,
    boundaries: { accuracyMeasured: false, legalCorrectnessProved: false, platformApprovalProved: false }
  };
}
