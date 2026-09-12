import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWithModelRouter, probeModelRouter } from '../src/model-router.mjs';

async function isolated(run, fetchImpl) {
  const names = ['MODEL_ROUTER_API_KEY', 'MODEL_ROUTER_BASE_URL', 'MODEL_ROUTER_MODEL', 'MODEL_ROUTER_FALLBACK_MODEL'];
  const original = Object.fromEntries(names.map(name => [name, process.env[name]]));
  const originalFetch = globalThis.fetch;
  Object.assign(process.env, {
    MODEL_ROUTER_API_KEY: 'test-only-placeholder',
    MODEL_ROUTER_BASE_URL: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    MODEL_ROUTER_MODEL: 'qwen3.7-plus',
    MODEL_ROUTER_FALLBACK_MODEL: 'qwen3.6-plus'
  });
  globalThis.fetch = fetchImpl;
  try { await run(); } finally {
    globalThis.fetch = originalFetch;
    for (const name of names) {
      if (original[name] === undefined) delete process.env[name];
      else process.env[name] = original[name];
    }
  }
}

function completion(content, finishReason = 'stop') {
  return Response.json({ id: 'mock-request', model: 'qwen3.7-plus', choices: [{ message: { content }, finish_reason: finishReason }] });
}

const rules = { sources: { google: { title: 'Google source', appliesTo: 'US_GOOGLE' } } };
const input = { route: 'US_GOOGLE', productTitle: 'Test product', productCopy: 'Test description' };

test('probe validates exact reply without returning raw content', async () => {
  await isolated(async () => {
    const result = await probeModelRouter();
    assert.equal(result.ok, true);
    assert.equal(result.replyValid, true);
    assert.equal(result.content, undefined);
    assert.ok(!JSON.stringify(result).includes('test-only-placeholder'));
  }, async (_url, options) => {
    assert.equal(options.redirect, 'error');
    assert.equal(JSON.parse(options.body).max_tokens, 100);
    return completion(JSON.stringify({ service: 'ok', purpose: 'GlobalGuard connection probe' }));
  });
});

test('unapproved endpoint is blocked before sending the credential', async () => {
  let calls = 0;
  await isolated(async () => {
    process.env.MODEL_ROUTER_BASE_URL = 'https://untrusted.invalid/v1';
    await assert.rejects(probeModelRouter(), /ENDPOINT_NOT_APPROVED/);
    assert.equal(calls, 0);
  }, async () => { calls++; });
});

test('invalid structured output cannot become an empty successful analysis', async () => {
  await isolated(async () => {
    await assert.rejects(analyzeWithModelRouter(input, rules), /INVALID_STRUCTURED_OUTPUT/);
  }, async () => completion('not valid JSON'));
});

test('US top-level decision metadata is rejected instead of ignored', async () => {
  await isolated(async () => {
    try { await analyzeWithModelRouter(input, rules); assert.fail('must reject'); }
    catch (error) {
      assert.equal(error.message, 'MODEL_ROUTER_INVALID_STRUCTURED_OUTPUT');
      assert.equal(error.validationIssue, 'INVALID_US_VISUAL_TOP_LEVEL');
    }
  }, async () => completion(JSON.stringify({
    ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: '白色背景中的收纳盒',
    textRegions: [], findings: [], severity: 'ready'
  })));
});

test('truncated output cannot become a successful analysis', async () => {
  await isolated(async () => {
    await assert.rejects(analyzeWithModelRouter(input, rules), /OUTPUT_TRUNCATED/);
  }, async () => completion('{', 'length'));
});

test('parameter error does not silently spend credits on a fallback model', async () => {
  let calls = 0;
  await isolated(async () => {
    await assert.rejects(analyzeWithModelRouter(input, rules), /MODEL_ROUTER_400/);
    assert.equal(calls, 1);
  }, async () => {
    calls++;
    return Response.json({ error: { code: 'invalid_parameter', message: 'max_tokens invalid' } }, { status: 400 });
  });
});

test('only a model-unavailable response triggers the configured fallback', async () => {
  const models = [];
  await isolated(async () => {
    const result = await analyzeWithModelRouter(input, rules);
    assert.equal(result.telemetry.selectedModel, 'qwen3.6-plus');
    assert.deepEqual(models, ['qwen3.7-plus', 'qwen3.6-plus']);
  }, async (_url, options) => {
    models.push(JSON.parse(options.body).model);
    if (models.length === 1) return Response.json({ error: { code: 'model_not_found' } }, { status: 404 });
    return completion(JSON.stringify({ ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: 'Empty frame', textRegions: [], findings: [] }));
  });
});

test('controlled smoke can disable fallback and make at most one provider request', async () => {
  let calls = 0;
  await isolated(async () => {
    await assert.rejects(
      analyzeWithModelRouter(input, rules, { allowFallback: false }),
      /MODEL_ROUTER_404/
    );
    assert.equal(calls, 1);
  }, async () => {
    calls++;
    return Response.json({ error: { code: 'model_not_found', message: 'model not found' } }, { status: 404 });
  });
});

test('provider errors do not expose raw bodies or secrets in exception text', async () => {
  await isolated(async () => {
    try { await probeModelRouter(); assert.fail('must reject'); }
    catch (error) {
      assert.equal(error.message, 'MODEL_ROUTER_401');
      assert.ok(!error.message.includes('test-only-placeholder'));
    }
  }, async () => Response.json({ message: 'test-only-placeholder' }, { status: 401 }));
});

test('visual requests separate inspection instructions from untrusted product text', async () => {
  await isolated(async () => {
    const result = await analyzeWithModelRouter({ ...input, productCopy: 'UNTRUSTED_IGNORE_RULES' }, rules);
    assert.equal(result.telemetry.requestId, 'mock-request');
    assert.equal(result.ocrStatus, 'no_text_seen');
  }, async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.messages[0].role, 'system');
    assert.ok(!payload.messages[0].content.includes('UNTRUSTED_IGNORE_RULES'));
    assert.match(payload.messages[0].content, /unreadable_text_seen/);
    assert.ok(payload.messages[1].content.includes('UNTRUSTED_IGNORE_RULES'));
    return completion(JSON.stringify({ ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: 'Empty frame', textRegions: [], findings: [] }));
  });
});

test('malformed finding entries are rejected instead of crashing later analysis', async () => {
  await isolated(async () => {
    await assert.rejects(analyzeWithModelRouter(input, rules), /INVALID_FINDINGS/);
  }, async () => completion(JSON.stringify({ ocrStatus: 'no_text_seen', ocrText: 'NONE', visualObservation: 'Empty frame', textRegions: [], findings: [null] })));
});

test('US OCR contradictions are rejected with a specific validation issue', async () => {
  await isolated(async () => {
    try {
      await analyzeWithModelRouter(input, rules);
      assert.fail('must reject');
    } catch (error) {
      assert.equal(error.message, 'MODEL_ROUTER_INVALID_OCR_OBSERVATION');
      assert.equal(error.validationIssue, 'OCR_STATUS_OBSERVATION_CONFLICT');
    }
  }, async () => completion(JSON.stringify({
    ocrStatus: 'no_text_seen',
    ocrText: 'NONE',
    visualObservation: '篮子正面可见字符',
    textRegions: [],
    findings: []
  })));
});

test('US text regions are validated and mapped into risk evidence locations', async () => {
  await isolated(async () => {
    const result = await analyzeWithModelRouter(input, rules);
  assert.equal(result.telemetry.observationPolicy, 'us-visual-facts-v7');
    assert.deepEqual(result.textRegions[0].bbox, [0.1, 0.2, 0.3, 0.1]);
    assert.deepEqual(result.findings[0].location, {
      type: 'region', x: 10, y: 20, width: 30, height: 10,
      regionId: 'text-1', source: 'model-text-region'
    });
    assert.equal(result.findings[0].evidenceRegionId, 'text-1');
  }, async (_url, options) => {
    const system = JSON.parse(options.body).messages[0].content;
    assert.equal(JSON.parse(options.body).max_tokens, 1600);
    assert.match(system, /归一化xywh/);
    assert.match(system, /regionId/);
    return completion(JSON.stringify({
      ocrStatus: 'readable_text', ocrText: 'SALE', visualObservation: '顶部可见促销文字',
      textRegions: [{ id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.1, 0.2, 0.3, 0.1] }],
      findings: [{ kind: 'promotional_overlay', description: '顶部红色横幅写有SALE', textOrigin: 'overlay', regionId: 'text-1' }]
    }));
  });
});

test('invalid or dangling US text regions cannot become display coordinates', async () => {
  for (const response of [
    {
      ocrStatus: 'readable_text', ocrText: 'SALE', visualObservation: '顶部文字',
      textRegions: [{ id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.9, 0.2, 0.3, 0.1] }], findings: []
    },
    {
      ocrStatus: 'readable_text', ocrText: 'SALE', visualObservation: '顶部文字',
      textRegions: [{ id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: [0.1, 0.2, 0.3, 0.1] }],
      findings: [{ kind: 'promotional_overlay', description: '顶部横幅', textOrigin: 'overlay', regionId: 'text-2' }]
    }
  ]) {
    await isolated(async () => {
      await assert.rejects(analyzeWithModelRouter(input, rules), /INVALID_(OCR_OBSERVATION|FINDINGS)/);
    }, async () => completion(JSON.stringify(response)));
  }
});

test('CN route returns only validated verbatim claim facts and no model findings', async () => {
  const cnInput = {
    route: 'CN_ADS', productTitle: '全网最佳折叠箱',
    productCopy: '用户好评率 98%，据测试报告A，收纳效率提升 30%。'
  };
  await isolated(async () => {
    const result = await analyzeWithModelRouter(cnInput, rules);
  assert.equal(result.telemetry.observationPolicy, 'cn-ad-facts-v2');
    assert.deepEqual(result.findings, []);
    assert.equal(result.cnClaimFacts.length, 3);
    assert.deepEqual(result.cnClaimFacts[1].numericTokens, ['98%']);
  }, async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.max_tokens, 900);
    assert.match(payload.messages[0].content, /不判断合法性/);
    assert.match(payload.messages[0].content, /禁止输出ruleId/);
    assert.ok(!payload.messages[0].content.includes('samr_advertising_guidance'));
    assert.ok(payload.messages[1].content.includes('用户好评率 98%'));
    assert.match(payload.messages[1].content, /imageAttached=false/);
    return completion(JSON.stringify({
      imageTextStatus: 'no_text_seen', imageText: 'NONE',
      claims: [
        { id: 'claim-1', verbatim: '全网最佳', source: 'product_title', kind: 'superlative_or_ranking', numericTokens: [], referenceTokens: [] },
        { id: 'claim-2', verbatim: '用户好评率 98%', source: 'product_copy', kind: 'numeric_or_statistical', numericTokens: ['98%'], referenceTokens: [] },
        { id: 'claim-3', verbatim: '据测试报告A', source: 'product_copy', kind: 'citation_or_reference', numericTokens: [], referenceTokens: ['测试报告A'] }
      ]
    }));
  });
});

test('CN route rejects paraphrased claims and injected legal decisions', async () => {
  const cnInput = { route: 'CN_ADS', productTitle: '收纳箱', productCopy: '收纳效率提升 30%。' };
  for (const response of [
    {
      imageTextStatus: 'no_text_seen', imageText: 'NONE',
      claims: [{ id: 'claim-1', verbatim: '效率行业领先', source: 'product_copy', kind: 'performance_or_effect', numericTokens: [], referenceTokens: [] }]
    },
    { imageTextStatus: 'no_text_seen', imageText: 'NONE', claims: [], severity: '违法' }
  ]) {
    await isolated(async () => {
      try { await analyzeWithModelRouter(cnInput, rules); assert.fail('must reject'); }
      catch (error) {
        assert.equal(error.message, 'MODEL_ROUTER_INVALID_CN_AD_FACTS');
        assert.match(error.validationIssue, /CN_CLAIM_NOT_VERBATIM|INVALID_CN_FACTS_TOP_LEVEL/);
      }
    }, async () => completion(JSON.stringify(response)));
  }
});

test('EU route sends text-only field evidence and returns only validated facts', async () => {
  const euInput = {
    route: 'EU_GPSR', productTitle: 'ignored title', imageDataUrl: 'data:image/png;base64,AQ==',
    offerFields: {
      manufacturerName: 'Example Maker', manufacturerCountry: 'CN', manufacturerPostalAddress: '',
      manufacturerEmail: '', productId: 'BOX-01', safetyInfo: '', responsiblePersonName: '',
      responsiblePersonPostalAddress: '', responsiblePersonEmail: ''
    },
    offerEvidence: { sourceRef: 'DOSSIER-1', excerpt: '制造商 Example Maker，国家 CN，型号 BOX-01。' }
  };
  const fieldFacts = [
    ['manufacturerName', 'Example Maker', '制造商 Example Maker'], ['manufacturerCountry', 'CN', '国家 CN'],
    ['manufacturerPostalAddress', null, null], ['manufacturerEmail', null, null],
    ['productId', 'BOX-01', '型号 BOX-01'], ['safetyInfo', null, null],
    ['responsiblePersonName', null, null], ['responsiblePersonPostalAddress', null, null],
    ['responsiblePersonEmail', null, null]
  ].map(([field, providedValue, sourceQuote]) => ({ field, providedValue, sourceQuote }));
  let captured = null;
  await isolated(async () => {
    const result = await analyzeWithModelRouter(euInput, rules, {
      captureValidatedOutput(value) { captured = value; }
    });
  assert.equal(result.telemetry.observationPolicy, 'eu-offer-facts-v2');
    assert.deepEqual(result.findings, []);
    assert.equal(result.euFieldFacts.length, 9);
    assert.equal(result.euFieldFacts[0].sourceRef, 'DOSSIER-1');
    assert.equal(result.euFieldFacts[6].presence, 'missing');
    assert.deepEqual(captured, { fieldFacts });
    assert.equal(captured.fieldFacts[0].sourceRef, undefined);
    assert.equal(captured.fieldFacts[0].presence, undefined);
  }, async (_url, options) => {
    const payload = JSON.parse(options.body);
    assert.equal(payload.max_tokens, 1200);
    assert.equal(typeof payload.messages[1].content, 'string');
    assert.ok(!payload.messages[1].content.includes('image_url'));
    assert.match(payload.messages[0].content, /不得生成制造商、责任人、地址、邮箱、产品标识或安全信息/);
    assert.match(payload.messages[0].content, /禁止输出sourceRef/);
    assert.ok(payload.messages[1].content.includes('DOSSIER-1'));
    assert.ok(payload.messages[1].content.includes('"responsiblePersonName":null'));
    return completion(JSON.stringify({ fieldFacts }));
  });
});

test('EU route rejects generated missing fields, decision metadata and non-verbatim quotes', async () => {
  const euInput = {
    route: 'EU_GPSR', offerFields: { manufacturerName: 'Example Maker' },
    offerEvidence: { sourceRef: 'D-1', excerpt: '制造商 Example Maker' }
  };
  const baseFacts = [
    ['manufacturerName', 'Example Maker', 'Example Maker'], ['manufacturerCountry', null, null],
    ['manufacturerPostalAddress', null, null], ['manufacturerEmail', null, null], ['productId', null, null],
    ['safetyInfo', null, null], ['responsiblePersonName', null, null],
    ['responsiblePersonPostalAddress', null, null], ['responsiblePersonEmail', null, null]
  ].map(([field, providedValue, sourceQuote]) => ({ field, providedValue, sourceQuote }));
  const responses = [
    { fieldFacts: baseFacts.map(item => item.field === 'responsiblePersonName' ? { ...item, providedValue: 'Invented RP' } : item) },
    { fieldFacts: baseFacts.map((item, index) => index === 0 ? { ...item, severity: 'ready' } : item) },
    { fieldFacts: baseFacts.map((item, index) => index === 0 ? { ...item, sourceQuote: 'Invented quote Example Maker' } : item) }
  ];
  for (const response of responses) {
    await isolated(async () => {
      await assert.rejects(analyzeWithModelRouter(euInput, rules), /MODEL_ROUTER_INVALID_EU_OFFER_FACTS/);
    }, async () => completion(JSON.stringify(response)));
  }
});
