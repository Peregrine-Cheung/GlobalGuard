import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { analyzeProduct } from "../src/rule-engine.mjs";

const rulepack = JSON.parse(await fs.readFile(new URL("../config/rulepacks/v1.0.0.json", import.meta.url), "utf8"));
const dataset = JSON.parse(await fs.readFile(new URL("../fixtures/evaluation-cases.json", import.meta.url), "utf8"));

const base = {
  category: "home-storage",
  productTitle: "FlexiNest storage box",
  productCopy: "Suitable for daily home storage.",
  image: { name: "case.png", width: 720, height: 720, mimeType: "image/png" },
  visualSignals: { hasBorder: false, overlayText: "", hasPromotionalOverlay: false, aiGenerated: false, hasSyntheticMetadata: false },
  claimEvidenceUrl: "",
  aiLabelDeclared: false,
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
  },
  mode: "local"
};

let truePositive = 0;
let falsePositive = 0;
let falseNegative = 0;
let exactMatches = 0;
let statusMatches = 0;
const failures = [];
const startedAt = performance.now();

for (const item of dataset.cases) {
  const input = {
    ...base,
    ...item,
    image: { ...base.image, ...(item.image || {}) },
    visualSignals: { ...base.visualSignals, ...(item.visualSignals || {}) },
    offerFields: { ...base.offerFields, ...(item.offerFields || {}) }
  };
  delete input.expectedRuleIds;
  delete input.expectedStatus;
  delete input.label;
  delete input.id;

  const result = analyzeProduct(input, rulepack);
  const actualIds = [...new Set(result.risks.map((risk) => risk.ruleId))].sort();
  const expectedIds = [...new Set(item.expectedRuleIds)].sort();
  const actualSet = new Set(actualIds);
  const expectedSet = new Set(expectedIds);
  truePositive += actualIds.filter((id) => expectedSet.has(id)).length;
  falsePositive += actualIds.filter((id) => !expectedSet.has(id)).length;
  falseNegative += expectedIds.filter((id) => !actualSet.has(id)).length;
  const exact = JSON.stringify(actualIds) === JSON.stringify(expectedIds);
  const statusMatch = result.summary.status === item.expectedStatus;
  if (exact) exactMatches += 1;
  if (statusMatch) statusMatches += 1;
  if (!exact || !statusMatch) {
    failures.push({
      id: item.id,
      label: item.label,
      expectedStatus: item.expectedStatus,
      actualStatus: result.summary.status,
      expectedRuleIds: expectedIds,
      actualRuleIds: actualIds
    });
  }
}

const elapsedMs = performance.now() - startedAt;
const precision = truePositive / Math.max(1, truePositive + falsePositive);
const recall = truePositive / Math.max(1, truePositive + falseNegative);
const report = {
  datasetId: dataset.datasetId,
  datasetType: dataset.datasetType,
  notice: dataset.notice,
  rulepack: `${rulepack.id}@${rulepack.version}`,
  cases: dataset.cases.length,
  exactRuleMatch: `${exactMatches}/${dataset.cases.length}`,
  statusMatch: `${statusMatches}/${dataset.cases.length}`,
  regressionPrecision: Number(precision.toFixed(4)),
  regressionRecall: Number(recall.toFixed(4)),
  elapsedMs: Number(elapsedMs.toFixed(3)),
  failures
};

console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
