import { analyzeWithModelRouter, modelRouterStatus } from './model-router.mjs';
import { US_VISUAL_POLICY_VERSION } from './us-visual-facts.mjs';

export const US_LIVE_SMOKE_METADATA = Object.freeze({
  route: 'US_GOOGLE',
  category: 'home-storage',
  productTitle: 'Synthetic folding storage box',
  productCopy: 'Repository-owned synthetic promotional-overlay fixture.',
  fixtureId: 'browser-qa-original',
  inputClassification: 'synthetic-non-sensitive'
});

export function buildUsSmokePreview(status = modelRouterStatus()) {
  return {
    schemaVersion: '1.0', mode: 'preview', willCallProvider: false,
    route: US_LIVE_SMOKE_METADATA.route, observationPolicy: US_VISUAL_POLICY_VERSION,
    provider: status.provider, baseUrl: status.baseUrl, primaryModel: status.primaryModel,
    configured: status.configured, appUseApproved: status.appUseApproved,
    maxProviderRequests: 1, fallbackDisabled: true, imageAttached: true,
    maxCompletionTokens: 1600, inputClassification: US_LIVE_SMOKE_METADATA.inputClassification,
    fixtureId: US_LIVE_SMOKE_METADATA.fixtureId,
    executeAuthorization: ['--execute', '--confirm-one-request'],
    boundaries: { accuracyMeasured: false, legalCorrectnessProved: false, platformApprovalProved: false },
    notice: '默认只预览。执行模式最多一次供应商请求，不回退、不重试；结果只证明该次合成图片结构契约是否通过。'
  };
}

export async function runUsSmoke(rulepack, image, options = {}) {
  const status = options.status || modelRouterStatus();
  const analyze = options.analyze || analyzeWithModelRouter;
  if (!status.configured || !status.appUseApproved) throw new Error('US_LIVE_SMOKE_NOT_AUTHORIZED_OR_CONFIGURED');
  if (!image || typeof image.dataUrl !== 'string' || !image.dataUrl.startsWith('data:image/png;base64,')
      || !Number.isInteger(image.width) || !Number.isInteger(image.height)) {
    throw new Error('US_LIVE_SMOKE_INVALID_FIXTURE');
  }
  const input = {
    route: US_LIVE_SMOKE_METADATA.route,
    category: US_LIVE_SMOKE_METADATA.category,
    productTitle: US_LIVE_SMOKE_METADATA.productTitle,
    productCopy: US_LIVE_SMOKE_METADATA.productCopy,
    image: { width: image.width, height: image.height, name: 'synthetic-original.png', mimeType: 'image/png' },
    imageDataUrl: image.dataUrl,
    visualSignals: {}
  };
  let validatedRawOutput = null;
  const result = await analyze(input, rulepack, {
    allowFallback: false,
    captureValidatedOutput(value) { validatedRawOutput = structuredClone(value); }
  });
  if (!validatedRawOutput) throw new Error('US_LIVE_SMOKE_VALIDATED_OUTPUT_NOT_CAPTURED');
  return {
    schemaVersion: '1.0', kind: 'single-request-synthetic-us-visual-contract-smoke',
    executedAt: new Date().toISOString(), route: input.route,
    observationPolicy: US_VISUAL_POLICY_VERSION,
    inputClassification: US_LIVE_SMOKE_METADATA.inputClassification,
    fixtureId: US_LIVE_SMOKE_METADATA.fixtureId,
    maxProviderRequests: 1, fallbackDisabled: true, imageAttached: true,
    validatedRawOutput,
    normalized: {
      ocrStatus: result.ocrStatus,
      ocrText: result.ocrText,
      textRegions: result.textRegions,
      findings: result.findings
    },
    telemetry: result.telemetry,
    boundaries: { accuracyMeasured: false, legalCorrectnessProved: false, platformApprovalProved: false }
  };
}
