import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { analyzeProduct } from "../src/rule-engine.mjs";

const rulepack = JSON.parse(await fs.readFile(new URL("../config/rulepacks/v1.0.0.json", import.meta.url), "utf8"));

const base = {
  category: "home-storage",
  productTitle: "FlexiNest 可折叠家居收纳箱",
  productCopy: "适用于日常家居收纳。",
  image: { width: 720, height: 720, name: "product.png" },
  visualSignals: { hasBorder: false, overlayText: "", aiGenerated: false },
  mode: "local"
};

test("US sample separates current blockers from future size readiness", () => {
  const result = analyzeProduct({
    ...base,
    route: "US_GOOGLE",
    image: { width: 420, height: 420, name: "sample.png" },
    visualSignals: {
      hasBorder: true,
      overlayText: "BEST · FREE SHIPPING",
      hasPromotionalOverlay: true,
      sampleLayout: "globalguard-v1"
    }
  }, rulepack);

  assert.equal(result.summary.blockerCount, 2);
  assert.equal(result.summary.status, "blocked");
  const sizeRisk = result.risks.find((risk) => risk.ruleId === "GG-US-IMG-002");
  assert.equal(sizeRisk.severity, "warning");
  assert.match(sizeRisk.finding, /不是 2026 年 9 月的硬性驳回项/);
  assert.ok(result.fixes.some((fix) => fix.id === "fix-remove-overlay" && fix.automatic));
});

test("US clean 720 square image passes current rulepack", () => {
  const result = analyzeProduct({ ...base, route: "US_GOOGLE" }, rulepack);
  assert.equal(result.summary.status, "ready");
  assert.equal(result.summary.totalRisks, 0);
  assert.equal(result.summary.score, 100);
});

test("CN claim engine flags context review and missing evidence separately", () => {
  const result = analyzeProduct({
    ...base,
    route: "CN_ADS",
    productCopy: "全网最佳收纳方案，用户好评率 98%。",
    claimEvidenceUrl: ""
  }, rulepack);

  assert.equal(result.summary.status, "review");
  assert.equal(result.summary.blockerCount, 0);
  assert.ok(result.risks.some((risk) => risk.ruleId === "GG-CN-ADS-001" && risk.requiresHumanReview));
  assert.ok(result.risks.some((risk) => risk.ruleId === "GG-CN-ADS-002"));
});

test("CN evidence reference removes only the missing-evidence finding", () => {
  const result = analyzeProduct({
    ...base,
    route: "CN_ADS",
    productCopy: "用户好评率 98%。",
    claimEvidenceUrl: "INTERNAL-REPORT-2026-001"
  }, rulepack);

  assert.ok(!result.risks.some((risk) => risk.ruleId === "GG-CN-ADS-002"));
});

test("CN validated facts are traceable but deterministic terms still decide risks", () => {
  const result = analyzeProduct({
    ...base,
    route: "CN_ADS",
    productCopy: "全网最佳收纳方案，用户好评率 98%。",
    claimEvidenceUrl: "",
    observationPolicy: "cn-ad-facts-v2",
    cnClaimFacts: [
      { id: 'claim-1', verbatim: '全网最佳', source: 'product_copy', kind: 'superlative_or_ranking', numericTokens: [], referenceTokens: [] },
      { id: 'claim-2', verbatim: '用户好评率 98%', source: 'product_copy', kind: 'numeric_or_statistical', numericTokens: ['98%'], referenceTokens: [] }
    ]
  }, rulepack);
  assert.deepEqual(result.risks.find(risk => risk.ruleId === 'GG-CN-ADS-001').location.claimFactIds, ['claim-1']);
  assert.deepEqual(result.risks.find(risk => risk.ruleId === 'GG-CN-ADS-002').location.claimFactIds, ['claim-2']);
  assert.equal(result.audit.observationPolicy, 'cn-ad-facts-v2');
  assert.equal(result.audit.cnClaimFacts.length, 2);
  assert.equal(result.audit.fingerprintVersion, 7);
});

test("CN ignores model-authored risk prose even when called directly", () => {
  const result = analyzeProduct({
    ...base,
    route: "CN_ADS",
    aiFindings: [{
      ruleId: 'MODEL-CN', severity: 'high', title: '模型称违法', finding: '直接删除',
      sourceIds: ['samr_advertising_guidance']
    }]
  }, rulepack);
  assert.ok(!result.risks.some(risk => risk.ruleId === 'MODEL-CN'));
});

test("CN ordinary ordinal wording is not treated as a ranking claim", () => {
  const result = analyzeProduct({
    ...base,
    route: "CN_ADS",
    productCopy: "第一次使用前请用清水擦拭，第一季度完成包装升级。"
  }, rulepack);

  assert.ok(!result.risks.some((risk) => risk.ruleId === "GG-CN-ADS-001"));
});

test("EU non-EU manufacturer requires a real EU responsible person", () => {
  const result = analyzeProduct({
    ...base,
    route: "EU_GPSR",
    offerFields: {
      manufacturerName: "Example Manufacturer",
      manufacturerCountry: "CN",
      manufacturerPostalAddress: "Hebei, China",
      manufacturerEmail: "contact@example.invalid",
      productId: "FN-BOX-01",
      safetyInfo: ""
    }
  }, rulepack);

  assert.equal(result.summary.status, "blocked");
  assert.ok(result.risks.some((risk) => risk.ruleId === "GG-EU-GPSR-019B"));
  assert.match(result.risks.find((risk) => risk.ruleId === "GG-EU-GPSR-019B").action, /不.*自动编造|真实合规档案/);
});

test("EU field facts trace missing-field risks without letting model prose decide", () => {
  const result = analyzeProduct({
    ...base,
    route: "EU_GPSR",
    offerFields: {
      manufacturerName: "Example Manufacturer", manufacturerCountry: "CN",
      manufacturerPostalAddress: "Hebei, China", manufacturerEmail: "contact@example.invalid",
      productId: "FN-BOX-01", safetyInfo: "",
      responsiblePersonName: "", responsiblePersonPostalAddress: "", responsiblePersonEmail: ""
    },
    offerEvidence: { sourceRef: "DOSSIER-1", excerpt: "制造商 Example Manufacturer" },
    observationPolicy: "eu-offer-facts-v2",
    euFieldFacts: [
      { id: 'field-6', field: 'safetyInfo', providedValue: null, sourceRef: null, sourceQuote: null, presence: 'missing', evidenceStatus: 'missing-field' },
      { id: 'field-7', field: 'responsiblePersonName', providedValue: null, sourceRef: null, sourceQuote: null, presence: 'missing', evidenceStatus: 'missing-field' },
      { id: 'field-8', field: 'responsiblePersonPostalAddress', providedValue: null, sourceRef: null, sourceQuote: null, presence: 'missing', evidenceStatus: 'missing-field' },
      { id: 'field-9', field: 'responsiblePersonEmail', providedValue: null, sourceRef: null, sourceQuote: null, presence: 'missing', evidenceStatus: 'missing-field' }
    ],
    aiFindings: [{ ruleId: 'MODEL-EU', severity: 'high', title: '模型直接裁定', finding: '必须删除', sourceIds: ['eu_gpsr_article_19'] }]
  }, rulepack);
  assert.deepEqual(result.risks.find(risk => risk.ruleId === 'GG-EU-GPSR-019A').location.fieldFactIds, ['field-6']);
  assert.deepEqual(result.risks.find(risk => risk.ruleId === 'GG-EU-GPSR-019B').location.fieldFactIds, ['field-7', 'field-8', 'field-9']);
  assert.ok(!result.risks.some(risk => risk.ruleId === 'MODEL-EU'));
  assert.equal(result.audit.euFieldFacts.length, 4);
  assert.equal(result.audit.offerEvidence.sourceRef, 'DOSSIER-1');
  assert.ok(result.audit.offerEvidence.excerptLength > 0);
  assert.equal(result.audit.offerEvidence.excerptSha256.length, 64);
  assert.equal(result.audit.fingerprintVersion, 7);
});

test("EU complete offer information passes the scoped checklist", () => {
  const result = analyzeProduct({
    ...base,
    route: "EU_GPSR",
    offerFields: {
      manufacturerName: "Example Manufacturer",
      manufacturerCountry: "CN",
      manufacturerPostalAddress: "Hebei, China",
      manufacturerEmail: "contact@example.invalid",
      productId: "FN-BOX-01",
      safetyInfo: "Keep away from open flames.",
      responsiblePersonName: "Example EU RP",
      responsiblePersonPostalAddress: "Berlin, Germany",
      responsiblePersonEmail: "rp@example.invalid"
    }
  }, rulepack);

  assert.equal(result.summary.status, "ready");
  assert.equal(result.summary.totalRisks, 0);
});

test("model findings cannot introduce unknown evidence sources", () => {
  const result = analyzeProduct({
    ...base,
    route: "US_GOOGLE",
    aiFindings: [
      {
        ruleId: "MODEL-1",
        severity: "high",
        category: "AI 辅助观察",
        title: "未知来源结论",
        finding: "模型生成的观察",
        sourceIds: ["hallucinated_source"]
      },
      {
        ruleId: "MODEL-2",
        severity: "medium",
        category: "AI 辅助观察",
        title: "有来源的观察",
        finding: "需要人工确认",
        sourceIds: ["google_image_link"]
      },
      {
        ruleId: "MODEL-3",
        severity: "high",
        category: "AI 辅助观察",
        title: "跨路径错误来源",
        finding: "美国路径错误引用欧盟来源",
        sourceIds: ["eu_gpsr_article_19"]
      }
    ]
  }, rulepack);

  assert.ok(!result.risks.some((risk) => risk.ruleId === "MODEL-1"));
  assert.ok(result.risks.some((risk) => risk.ruleId === "MODEL-2" && risk.origin === "model-router"));
  assert.ok(!result.risks.some((risk) => risk.ruleId === "MODEL-3"));
});
