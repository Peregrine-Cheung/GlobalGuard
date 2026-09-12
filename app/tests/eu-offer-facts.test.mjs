import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { EU_OFFER_FIELDS, euOfferFactsInstructions, validateEuOfferFacts } from '../src/eu-offer-facts.mjs';

const offerFields = {
  manufacturerName: '河北示例制造有限公司', manufacturerCountry: 'CN',
  manufacturerPostalAddress: '河北省石家庄市示例路1号', manufacturerEmail: 'maker@example.invalid',
  productId: 'BOX-01', safetyInfo: '远离明火', responsiblePersonName: '',
  responsiblePersonPostalAddress: '', responsiblePersonEmail: ''
};
const offerEvidence = {
  sourceRef: 'DOSSIER-2026-001',
  excerpt: '制造商：河北示例制造有限公司；地址：河北省石家庄市示例路1号；邮箱：maker@example.invalid；型号：BOX-01；警示：远离明火。'
};

function completeResponse(overrides = {}) {
  return {
    fieldFacts: EU_OFFER_FIELDS.map(field => ({
      field,
      providedValue: offerFields[field] || null,
      sourceQuote: offerFields[field] && offerEvidence.excerpt.includes(offerFields[field]) ? offerFields[field] : null,
      ...(overrides[field] || {})
    }))
  };
}

test('EU field facts echo provided values and attach only exact source quotes', () => {
  const facts = validateEuOfferFacts(completeResponse(), { offerFields, offerEvidence });
  assert.equal(facts.length, 9);
  assert.equal(facts.find(fact => fact.field === 'manufacturerName').evidenceStatus, 'exact-quote-match');
  assert.equal(facts.find(fact => fact.field === 'responsiblePersonName').presence, 'missing');
  assert.equal(facts.find(fact => fact.field === 'responsiblePersonName').sourceRef, null);
});

test('EU field facts reject generated missing identities and changed values', () => {
  assert.throws(() => validateEuOfferFacts(completeResponse({ responsiblePersonName: {
    providedValue: 'Invented EU RP', sourceQuote: null
  } }), { offerFields, offerEvidence }), /EU_MISSING_FIELD_WAS_GENERATED/);
  assert.throws(() => validateEuOfferFacts(completeResponse({ manufacturerEmail: {
    providedValue: 'other@example.invalid', sourceQuote: null
  } }), { offerFields, offerEvidence }), /EU_FIELD_VALUE_MISMATCH/);
});

test('EU source quotes must be contiguous dossier text containing the exact value', () => {
  assert.throws(() => validateEuOfferFacts(completeResponse({ productId: {
    sourceQuote: '不存在的型号 BOX-01'
  } }), { offerFields, offerEvidence }), /EU_SOURCE_QUOTE_NOT_VERBATIM/);
  const changedEvidence = { ...offerEvidence, excerpt: `${offerEvidence.excerpt} 另有不相关档案段落。` };
  assert.throws(() => validateEuOfferFacts(completeResponse({ productId: {
    sourceQuote: '另有不相关档案段落。'
  } }), { offerFields, offerEvidence: changedEvidence }), /EU_SOURCE_QUOTE_VALUE_MISMATCH/);
  const caseChangedEvidence = { ...offerEvidence, excerpt: `${offerEvidence.excerpt} 型号：box-01。` };
  assert.throws(() => validateEuOfferFacts(completeResponse({ productId: {
    sourceQuote: '型号：box-01'
  } }), { offerFields, offerEvidence: caseChangedEvidence }), /EU_SOURCE_QUOTE_VALUE_MISMATCH/);
});

test('EU schema rejects missing fields and model-authored decision metadata', () => {
  assert.throws(() => validateEuOfferFacts({ fieldFacts: completeResponse().fieldFacts.slice(1) }, { offerFields, offerEvidence }), /INVALID_EU_FACTS_TOP_LEVEL/);
  const injected = completeResponse();
  injected.fieldFacts[0].severity = 'blocker';
  assert.throws(() => validateEuOfferFacts(injected, { offerFields, offerEvidence }), /INVALID_EU_FIELD_FACT/);
  assert.match(euOfferFactsInstructions(), /不得生成制造商、责任人、地址、邮箱、产品标识或安全信息/);
  assert.match(euOfferFactsInstructions(), /禁止输出sourceRef/);
});

test('EU v2 enforces field order, source references and minimal quote bounds', () => {
  const reordered = completeResponse();
  [reordered.fieldFacts[0], reordered.fieldFacts[1]] = [reordered.fieldFacts[1], reordered.fieldFacts[0]];
  assert.throws(() => validateEuOfferFacts(reordered, { offerFields, offerEvidence }), /EU_FIELD_ORDER_MISMATCH/);
  assert.throws(() => validateEuOfferFacts(completeResponse({ manufacturerName: {
    sourceQuote: '河北示例制造有限公司'
  } }), { offerFields, offerEvidence: { sourceRef: '', excerpt: offerEvidence.excerpt } }), /EU_QUOTE_WITHOUT_SOURCE_REF/);
  const longValue = 'A'.repeat(241);
  const longFields = { ...offerFields, manufacturerName: longValue };
  const longEvidence = { sourceRef: 'D-LONG', excerpt: longValue };
  assert.throws(() => validateEuOfferFacts(completeResponse({ manufacturerName: {
    providedValue: longValue, sourceQuote: longValue
  } }), { offerFields: longFields, offerEvidence: longEvidence }), /EU_SOURCE_QUOTE_NOT_VERBATIM/);
  assert.match(euOfferFactsInstructions(), /最长240字符/);
});

test('EU synthetic schema fixtures retain expected outcomes', async () => {
  const dataset = JSON.parse(await fs.readFile(new URL('../fixtures/eu-offer-facts-v2/cases.json', import.meta.url), 'utf8'));
  assert.equal(dataset.datasetType, 'synthetic-schema-conformance');
  assert.match(dataset.notice, /不代表模型准确率/);
  assert.equal(dataset.cases.length, 9);
  for (const item of dataset.cases) {
    if (item.expected === 'accept') assert.doesNotThrow(() => validateEuOfferFacts(item.response, item.input), item.id);
    else assert.throws(() => validateEuOfferFacts(item.response, item.input), new RegExp(item.errorPattern), item.id);
  }
});
