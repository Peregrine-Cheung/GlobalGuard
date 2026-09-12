import fs from 'node:fs/promises';
import { validateUsVisualEnvelope, validateUsOcrObservation, mapUsVisualFacts, US_VISUAL_POLICY_VERSION } from './us-visual-facts.mjs';
import { validateCnAdFacts, CN_AD_FACTS_POLICY_VERSION } from './cn-ad-facts.mjs';
import { validateEuOfferFacts, EU_OFFER_FACTS_POLICY_VERSION } from './eu-offer-facts.mjs';

const policyVersions = {
  US_GOOGLE: US_VISUAL_POLICY_VERSION,
  CN_ADS: CN_AD_FACTS_POLICY_VERSION,
  EU_GPSR: EU_OFFER_FACTS_POLICY_VERSION
};

function validateCase(route, item) {
  if (route === 'US_GOOGLE') {
    const response = validateUsVisualEnvelope(item.response);
    const ocr = validateUsOcrObservation({
      ocrStatus: response.ocrStatus,
      ocrText: response.ocrText,
      visualObservation: response.visualObservation,
      facts: response.findings,
      textRegions: response.textRegions
    });
    mapUsVisualFacts(response.findings, ocr.textRegions);
    return;
  }
  if (route === 'CN_ADS') {
    validateCnAdFacts(item.response, item.input);
    return;
  }
  if (route === 'EU_GPSR') {
    validateEuOfferFacts(item.response, item.input);
    return;
  }
  throw new Error(`UNKNOWN_CONTRACT_ROUTE:${route}`);
}

export async function evaluateModelContracts() {
  const manifestUrl = new URL('../fixtures/model-contracts-v1/manifest.json', import.meta.url);
  const manifest = JSON.parse(await fs.readFile(manifestUrl, 'utf8'));
  const policies = [];
  for (const policy of manifest.policies) {
    if (policyVersions[policy.route] !== policy.policyVersion) {
      throw new Error(`POLICY_VERSION_DRIFT:${policy.route}`);
    }
    const fixtureUrl = new URL(`../fixtures/${policy.fixture}`, import.meta.url);
    const dataset = JSON.parse(await fs.readFile(fixtureUrl, 'utf8'));
    const failures = [];
    let acceptPathsPassed = 0;
    let rejectPathsPassed = 0;
    for (const item of dataset.cases) {
      let error = null;
      try { validateCase(policy.route, item); }
      catch (caught) { error = caught; }
      const passed = item.expected === 'accept'
        ? error === null
        : Boolean(error && new RegExp(item.errorPattern).test(error.message));
      if (passed && item.expected === 'accept') acceptPathsPassed += 1;
      if (passed && item.expected === 'reject') rejectPathsPassed += 1;
      if (!passed) failures.push({
        id: item.id,
        expected: item.expected,
        expectedError: item.errorPattern || null,
        actualError: error?.message || null
      });
    }
    policies.push({
      route: policy.route,
      policyVersion: policy.policyVersion,
      fixture: policy.fixture,
      modelMayReturn: policy.modelMayReturn,
      decisionOwner: policy.decisionOwner,
      cases: dataset.cases.length,
      expectedAccept: dataset.cases.filter(item => item.expected === 'accept').length,
      expectedReject: dataset.cases.filter(item => item.expected === 'reject').length,
      acceptPathsPassed,
      rejectPathsPassed,
      passed: dataset.cases.length - failures.length,
      failures
    });
  }
  const totalCases = policies.reduce((sum, policy) => sum + policy.cases, 0);
  const totalPassed = policies.reduce((sum, policy) => sum + policy.passed, 0);
  return {
    suiteId: manifest.suiteId,
    datasetType: manifest.datasetType,
    notice: manifest.notice,
    modelAccuracyMeasured: false,
    legalCorrectnessMeasured: false,
    policies,
    totals: {
      policies: policies.length,
      cases: totalCases,
      passed: totalPassed,
      failed: totalCases - totalPassed,
      allPassed: totalCases === totalPassed
    }
  };
}
