import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { cnAdFactsInstructions, extractCnNumericTokens, validateCnAdFacts } from '../src/cn-ad-facts.mjs';

const input = {
  productTitle: '全网最佳折叠收纳箱',
  productCopy: '用户好评率 98%，据测试报告A，收纳效率提升 30%。'
};

test('CN advertising facts retain only verbatim claims and tokens', () => {
  const result = validateCnAdFacts({
    imageTextStatus: 'readable_text', imageText: '销量第一',
    claims: [
      { id: 'claim-1', verbatim: '全网最佳', source: 'product_title', kind: 'superlative_or_ranking', numericTokens: [], referenceTokens: [] },
      { id: 'claim-2', verbatim: '用户好评率 98%', source: 'product_copy', kind: 'numeric_or_statistical', numericTokens: ['98%'], referenceTokens: [] },
      { id: 'claim-3', verbatim: '据测试报告A', source: 'product_copy', kind: 'citation_or_reference', numericTokens: [], referenceTokens: ['测试报告A'] },
      { id: 'claim-4', verbatim: '销量第一', source: 'image_text', kind: 'superlative_or_ranking', numericTokens: [], referenceTokens: [] }
    ]
  }, input);
  assert.equal(result.claims.length, 4);
  assert.deepEqual(result.claims[1].numericTokens, ['98%']);
  assert.deepEqual(result.claims[2].referenceTokens, ['测试报告A']);
});

test('CN advertising facts reject paraphrases, guessed image text and injected decisions', () => {
  assert.throws(() => validateCnAdFacts({
    imageTextStatus: 'no_text_seen', imageText: 'NONE',
    claims: [{ id: 'claim-1', verbatim: '效果行业领先', source: 'product_copy', kind: 'performance_or_effect', numericTokens: [], referenceTokens: [] }]
  }, input), /CN_CLAIM_NOT_VERBATIM/);
  assert.throws(() => validateCnAdFacts({
    imageTextStatus: 'unreadable_text_seen', imageText: '销量第一', claims: []
  }, input), /CN_IMAGE_TEXT_STATUS_CONFLICT/);
  assert.throws(() => validateCnAdFacts({
    imageTextStatus: 'no_text_seen', imageText: 'NONE', claims: [], severity: 'illegal'
  }, input), /INVALID_CN_FACTS_TOP_LEVEL/);
});

test('CN token arrays must be exact substrings and cannot invent evidence', () => {
  assert.throws(() => validateCnAdFacts({
    imageTextStatus: 'no_text_seen', imageText: 'NONE',
    claims: [{ id: 'claim-1', verbatim: '用户好评率 98%', source: 'product_copy', kind: 'numeric_or_statistical', numericTokens: ['99%'], referenceTokens: [] }]
  }, input), /INVALID_CN_NUMERIC_TOKEN/);
  assert.throws(() => validateCnAdFacts({
    imageTextStatus: 'no_text_seen', imageText: 'NONE',
    claims: [{ id: 'claim-1', verbatim: '据测试报告A', source: 'product_copy', kind: 'citation_or_reference', numericTokens: [], referenceTokens: ['权威机构B'] }]
  }, input), /INVALID_CN_REFERENCE_TOKEN/);
});

test('CN v2 requires complete ordered numeric evidence and citation tokens', () => {
  assert.deepEqual(extractCnNumericTokens('提升 30%，持续2小时，温度-10%，价格1,000元'), ['30%', '2小时', '-10%', '1,000元']);
  assert.throws(() => validateCnAdFacts({
    imageTextStatus: 'no_text_seen', imageText: 'NONE',
    claims: [{ id: 'claim-1', verbatim: '用户好评率 98%', source: 'product_copy', kind: 'numeric_or_statistical', numericTokens: [], referenceTokens: [] }]
  }, input), /CN_NUMERIC_TOKENS_INCOMPLETE/);
  assert.throws(() => validateCnAdFacts({
    imageTextStatus: 'no_text_seen', imageText: 'NONE',
    claims: [{ id: 'claim-1', verbatim: '据测试报告A', source: 'product_copy', kind: 'citation_or_reference', numericTokens: [], referenceTokens: [] }]
  }, input), /CN_REFERENCE_KIND_MISSING_TOKEN/);
  assert.throws(() => validateCnAdFacts({
    imageTextStatus: 'no_text_seen', imageText: 'NONE',
    claims: [{ id: 'claim-1', verbatim: '据测试报告A', source: 'product_copy', kind: 'citation_or_reference', numericTokens: [], referenceTokens: ['测试报告A', '测试报告A'] }]
  }, input), /DUPLICATE_CN_REFERENCE_TOKEN/);
  assert.match(cnAdFactsInstructions(), /完整列出/);
});

test('CN prompt forbids legal findings and keeps product text untrusted', () => {
  const instructions = cnAdFactsInstructions();
  assert.match(instructions, /不判断合法性/);
  assert.match(instructions, /不可信待检数据/);
  assert.match(instructions, /禁止输出ruleId/);
});

test('CN synthetic schema fixtures retain all expected accept and reject outcomes', async () => {
  const dataset = JSON.parse(await fs.readFile(new URL('../fixtures/cn-ad-facts-v2/cases.json', import.meta.url), 'utf8'));
  assert.equal(dataset.datasetType, 'synthetic-schema-conformance');
  assert.match(dataset.notice, /不代表模型准确率/);
  assert.equal(dataset.cases.length, 9);
  for (const item of dataset.cases) {
    if (item.expected === 'accept') assert.doesNotThrow(() => validateCnAdFacts(item.response, item.input), item.id);
    else assert.throws(() => validateCnAdFacts(item.response, item.input), new RegExp(item.errorPattern), item.id);
  }
});
