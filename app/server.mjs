import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeProduct } from "./src/rule-engine.mjs";
import { analyzeWithModelRouter, modelRouterStatus } from "./src/model-router.mjs";
import { loadLocalEnv } from "./src/load-local-env.mjs";
import { createLiveCallLimit } from "./src/live-call-limit.mjs";
import { evaluateModelContracts } from "./src/model-contract-evaluator.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
await loadLocalEnv(new URL("./.env.local", import.meta.url));
const publicDir = path.join(__dirname, "public");
const rulepack = JSON.parse(await fs.readFile(path.join(__dirname, "config", "rulepacks", "v1.0.0.json"), "utf8"));
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "127.0.0.1";
const liveCallLimit = createLiveCallLimit();
const contractReportPath = path.join(__dirname, "docs", "evidence", "model-contracts-offline-2026-09-09.json");
const humanReviewReportPath = path.join(__dirname, "docs", "evidence", "visual-fixtures-single-human-agreement-2026-09-11.json");
const robustnessReviewReportPath = path.join(__dirname, "docs", "evidence", "visual-robustness-live-v5-2026-09-11.json");
const robustnessV6RecoveryPath = path.join(__dirname, "docs", "evidence", "visual-robustness-live-v6-six-recovery-2026-09-11.json");
const robustnessV6ReviewPath = path.join(__dirname, "docs", "evidence", "visual-robustness-live-v6-six-2026-09-11.json");

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp"
};

function sendJson(res, statusCode, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "X-Frame-Options": "DENY",
    ...headers
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 18 * 1024 * 1024) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function analyzeRequest(payload) {
  const requestedLive = payload.mode === "live";
  const {
    aiFindings: _clientAiFindings,
    ocrStatus: _clientOcrStatus,
    ocrText: _clientOcrText,
    textRegions: _clientTextRegions,
    cnClaimFacts: _clientCnClaimFacts,
    euFieldFacts: _clientEuFieldFacts,
    observationPolicy: _clientObservationPolicy,
    ...trustedBaseInput
  } = payload;
  let ai = {
    status: requestedLive ? "unavailable" : "local-rules",
    message: requestedLive ? "赛事模型尚未就绪，已降级为本地可验证规则。" : "本地可验证规则模式",
    stages: []
  };
  let mergedInput = { ...trustedBaseInput, aiFindings: [], textRegions: [], cnClaimFacts: [], euFieldFacts: [] };

  if (requestedLive && modelRouterStatus().configured && !modelRouterStatus().appUseApproved) {
    ai.message = "密钥已配置；Token Plan 应用后端使用权限待赛事方确认，当前仅运行本地规则。";
  }
  if (requestedLive && modelRouterStatus().configured && modelRouterStatus().appUseApproved) {
    if (!liveCallLimit.acquire()) {
      const error = new Error("LIVE_REQUEST_LIMIT");
      error.statusCode = 429;
      throw error;
    }
    try {
      const liveResult = await analyzeWithModelRouter(payload, rulepack);
      mergedInput = {
        ...trustedBaseInput,
        ocrStatus: liveResult.ocrStatus,
        ocrText: liveResult.ocrText,
        textRegions: liveResult.textRegions,
        cnClaimFacts: liveResult.cnClaimFacts,
        euFieldFacts: liveResult.euFieldFacts,
        aiFindings: liveResult.findings
      };
      ai = {
        ...liveResult.telemetry,
        observations: {
          ocrStatus: liveResult.ocrStatus,
          ocrText: liveResult.ocrText,
          visualObservation: liveResult.visualObservation,
          textRegions: liveResult.textRegions,
          cnClaimFacts: liveResult.cnClaimFacts,
          euFieldFacts: liveResult.euFieldFacts
        }
      };
    } catch (error) {
      ai = {
        ...(error.telemetry || {}),
        status: "degraded",
        message: "赛事 Token Plan 调用失败，已保留确定性规则结果。",
        errorCode: String(error.message || error).split(":")[0],
        validationIssue: error.validationIssue || null,
        stages: error.telemetry?.stages || []
      };
    } finally {
      liveCallLimit.release();
    }
  }

  return {
    ...analyzeProduct({
      ...mergedInput,
      // This server has no fully validated semantic image verifier yet. Clients
      // cannot dismiss the coverage gap by clearing flags or claiming success.
      requiresVisualReview: ["US_GOOGLE", "CN_ADS"].includes(payload.route) && Boolean(payload.imageDataUrl),
      observationPolicy: ai.observationPolicy || null
    }, rulepack),
    ai
  };
}

async function serveStatic(req, res, pathname) {
  const relative = pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
  const filePath = path.resolve(publicDir, relative);
  const withinPublic = path.relative(publicDir, filePath);
  if (withinPublic.startsWith("..") || path.isAbsolute(withinPublic)) {
    sendJson(res, 403, { error: "FORBIDDEN" });
    return;
  }
  try {
    const data = await fs.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": CONTENT_TYPES[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": pathname === "/" || pathname.endsWith(".html") ? "no-store" : "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY"
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") sendJson(res, 404, { error: "NOT_FOUND" });
    else throw error;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    if (req.method === 'POST') {
      const origin = req.headers.origin;
      const localPort = server.address().port;
      const allowedOrigins = new Set([`http://127.0.0.1:${localPort}`, `http://localhost:${localPort}`]);
      if ((origin && !allowedOrigins.has(origin)) || req.headers['sec-fetch-site'] === 'cross-site') {
        sendJson(res, 403, { error: 'CROSS_ORIGIN_WRITE_BLOCKED', message: '请从本地工作台发起操作。' });
        return;
      }
      if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
        sendJson(res, 415, { error: 'JSON_REQUIRED', message: '接口仅接受 JSON 请求。' });
        return;
      }
    }
    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        service: "GlobalGuard",
        version: "0.1.0",
        rulepack: { id: rulepack.id, version: rulepack.version, effectiveDate: rulepack.effectiveDate },
        modelRouter: modelRouterStatus()
      });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/rulepack") {
      sendJson(res, 200, rulepack);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/validation-center") {
      const [storedText, humanReviewText, robustnessReviewText, robustnessV6RecoveryText, robustnessV6ReviewText] = await Promise.all([
        fs.readFile(contractReportPath, "utf8"),
        fs.readFile(humanReviewReportPath, "utf8"),
        fs.readFile(robustnessReviewReportPath, "utf8"),
        fs.readFile(robustnessV6RecoveryPath, "utf8"),
        fs.readFile(robustnessV6ReviewPath, "utf8")
      ]);
      const storedReport = JSON.parse(storedText);
      const humanReviewReport = JSON.parse(humanReviewText);
      const robustnessReviewReport = JSON.parse(robustnessReviewText);
      const robustnessV6Recovery = JSON.parse(robustnessV6RecoveryText);
      const robustnessV6Review = JSON.parse(robustnessV6ReviewText);
      const currentReport = await evaluateModelContracts();
      const modelStatus = modelRouterStatus();
      const humanTotals = humanReviewReport?.totals;
      const humanReviewValidated = humanReviewReport?.schemaVersion === "1.0"
        && humanReviewReport?.evaluationKind === "single-human-review-agreement"
        && humanReviewReport?.referenceStatus === "completed-single-human-review-not-consensus-gold"
        && humanReviewReport?.humanReviewAgreementMeasured === true
        && humanReviewReport?.modelAccuracyMeasured === false
        && humanReviewReport?.legalCorrectnessMeasured === false
        && humanReviewReport?.realMerchantPerformanceMeasured === false
        && Array.isArray(humanReviewReport?.cases)
        && humanTotals?.cases === humanReviewReport.cases.length
        && Number.isInteger(humanTotals?.requestSucceeded)
        && Number.isInteger(humanTotals?.contractPassed)
        && Number.isInteger(humanTotals?.strictAgreement)
        && humanTotals.requestSucceeded <= humanTotals.cases
        && humanTotals.contractPassed <= humanTotals.requestSucceeded
        && humanTotals.strictAgreement <= humanTotals.contractPassed;
      const robustnessCases = robustnessReviewReport?.cases;
      const robustnessControls = robustnessReviewReport?.executionControls;
      const robustnessEvaluation = robustnessReviewReport?.evaluation;
      const robustnessRequestIds = Array.isArray(robustnessCases)
        ? robustnessCases.map(item => item?.requestId) : [];
      const robustnessReviewValidated = robustnessReviewReport?.schemaVersion === "1.0"
        && robustnessReviewReport?.evidenceKind === "sanitized-ten-request-single-human-agreement-summary"
        && robustnessReviewReport?.datasetId === "globalguard-visual-robustness-v1"
        && robustnessReviewReport?.model === "qwen3.7-plus"
        && robustnessReviewReport?.observationPolicy === "us-visual-facts-v5"
        && robustnessControls?.maxProviderRequests === 10
        && robustnessControls?.requestsAttempted === 10
        && robustnessControls?.supplierResponses === 10
        && robustnessControls?.retryDisabled === true
        && robustnessControls?.fallbackDisabled === true
        && Number.isInteger(robustnessControls?.totalTokens)
        && robustnessControls.totalTokens <= robustnessControls.tokenBudget
        && Array.isArray(robustnessCases) && robustnessCases.length === 10
        && robustnessRequestIds.every(value => typeof value === "string" && value.length > 0)
        && new Set(robustnessRequestIds).size === robustnessCases.length
        && robustnessCases.reduce((sum, item) => sum + item.tokens, 0) === robustnessControls.totalTokens
        && robustnessEvaluation?.localStructureContractsPassed === 9
        && robustnessEvaluation?.strictSingleHumanAgreement === 3
        && robustnessEvaluation?.modelAccuracyMeasured === false
        && robustnessEvaluation?.legalCorrectnessMeasured === false
        && robustnessEvaluation?.realMerchantPerformanceMeasured === false;
      const v6Cases = robustnessV6Recovery?.cases;
      const v6Controls = robustnessV6Recovery?.executionControls;
      const v6RequestIds = Array.isArray(v6Cases) ? v6Cases.map(item => item?.requestId) : [];
      const robustnessV6RecoveryValidated = robustnessV6Recovery?.schemaVersion === "1.0"
        && robustnessV6Recovery?.evidenceKind === "telemetry-only-recovery-after-post-call-report-assembly-failure"
        && robustnessV6Recovery?.datasetId === "globalguard-visual-robustness-v1"
        && robustnessV6Recovery?.model === "qwen3.7-plus"
        && robustnessV6Recovery?.observationPolicy === "us-visual-facts-v6"
        && v6Controls?.authorizedRequests === 6
        && v6Controls?.requestsAttempted === 6
        && v6Controls?.supplierResponses === 6
        && v6Controls?.localStructureContractsPassed === 6
        && v6Controls?.retryDisabled === true
        && v6Controls?.fallbackDisabled === true
        && Number.isInteger(v6Controls?.totalTokens)
        && v6Controls.totalTokens <= v6Controls.tokenBudget
        && Array.isArray(v6Cases) && v6Cases.length === 6
        && v6RequestIds.every(value => typeof value === "string" && value.length > 0)
        && new Set(v6RequestIds).size === v6Cases.length
        && v6Cases.reduce((sum, item) => sum + item.tokens, 0) === v6Controls.totalTokens
        && v6Cases.every(item => item.localStructureContractPassed === true)
        && robustnessV6Recovery?.agreementEvaluation?.completed === false
        && robustnessV6Recovery?.agreementEvaluation?.strictSingleHumanAgreement === null
        && robustnessV6Recovery?.agreementEvaluation?.repeatCallsUsedForRecovery === false
        && robustnessV6Recovery?.remediation?.implemented === true
        && robustnessV6Recovery?.remediation?.realModelCallsDuringRemediation === 0;
      const v6ReviewCases = robustnessV6Review?.cases;
      const v6ReviewControls = robustnessV6Review?.executionControls;
      const v6ReviewEvaluation = robustnessV6Review?.evaluation;
      const v6ReviewRequestIds = Array.isArray(v6ReviewCases) ? v6ReviewCases.map(item => item?.requestId) : [];
      const robustnessV6ReviewValidated = robustnessV6Review?.schemaVersion === "1.0"
        && robustnessV6Review?.evidenceKind === "sanitized-six-request-targeted-single-human-agreement-summary"
        && robustnessV6Review?.datasetId === "globalguard-visual-robustness-v1"
        && robustnessV6Review?.model === "qwen3.7-plus"
        && robustnessV6Review?.observationPolicy === "us-visual-facts-v6"
        && v6ReviewControls?.authorizedRequests === 6
        && v6ReviewControls?.requestsAttempted === 6
        && v6ReviewControls?.supplierResponses === 6
        && v6ReviewControls?.localStructureContractsPassed === 6
        && v6ReviewControls?.retryDisabled === true
        && v6ReviewControls?.fallbackDisabled === true
        && Number.isInteger(v6ReviewControls?.totalTokens)
        && v6ReviewControls.totalTokens <= v6ReviewControls.tokenBudget
        && Array.isArray(v6ReviewCases) && v6ReviewCases.length === 6
        && v6ReviewRequestIds.every(value => typeof value === "string" && value.length > 0)
        && new Set(v6ReviewRequestIds).size === v6ReviewCases.length
        && v6ReviewCases.reduce((sum, item) => sum + item.tokens, 0) === v6ReviewControls.totalTokens
        && v6ReviewCases.every(item => Number.isInteger(item.tokens) && item.tokens > 0
          && typeof item.strictAgreement === "boolean"
          && item.checks && Object.values(item.checks).every(value => typeof value === "boolean"))
        && v6ReviewEvaluation?.selectedCases === 6
        && v6ReviewEvaluation?.strictSingleHumanAgreement === 2
        && v6ReviewEvaluation?.strictSingleHumanAgreementRate === 0.3333
        && v6ReviewEvaluation?.modelAccuracyMeasured === false
        && v6ReviewEvaluation?.legalCorrectnessMeasured === false
        && v6ReviewEvaluation?.realMerchantPerformanceMeasured === false;
      sendJson(res, 200, {
        ok: true,
        scope: "local-contract-and-human-review-verification",
        runtime: {
          service: "GlobalGuard",
          version: "0.1.0",
          rulepack: { id: rulepack.id, version: rulepack.version, effectiveDate: rulepack.effectiveDate },
          observationPolicies: modelStatus.observationPolicies
        },
        report: storedReport,
        integrity: {
          synchronized: JSON.stringify(storedReport) === JSON.stringify(currentReport),
          sha256: crypto.createHash("sha256").update(storedText).digest("hex"),
          evidenceFile: "app/docs/evidence/model-contracts-offline-2026-09-09.json"
        },
        humanReview: {
          report: humanReviewReport,
          integrity: {
            validated: humanReviewValidated,
            sha256: crypto.createHash("sha256").update(humanReviewText).digest("hex"),
            evidenceFile: "app/docs/evidence/visual-fixtures-single-human-agreement-2026-09-11.json"
          }
        },
        robustnessReview: {
          report: robustnessReviewReport,
          integrity: {
            validated: robustnessReviewValidated,
            sha256: crypto.createHash("sha256").update(robustnessReviewText).digest("hex"),
            evidenceFile: "app/docs/evidence/visual-robustness-live-v5-2026-09-11.json"
          }
        },
        robustnessV6Recovery: {
          report: robustnessV6Recovery,
          integrity: {
            validated: robustnessV6RecoveryValidated,
            sha256: crypto.createHash("sha256").update(robustnessV6RecoveryText).digest("hex"),
            evidenceFile: "app/docs/evidence/visual-robustness-live-v6-six-recovery-2026-09-11.json"
          }
        },
        robustnessV6Review: {
          report: robustnessV6Review,
          integrity: {
            validated: robustnessV6ReviewValidated,
            sha256: crypto.createHash("sha256").update(robustnessV6ReviewText).digest("hex"),
            evidenceFile: "app/docs/evidence/visual-robustness-live-v6-six-2026-09-11.json"
          }
        },
        boundaries: {
          realModelCallsInReport: 22,
          modelAccuracyMeasured: false,
          legalCorrectnessMeasured: false,
          platformApprovalClaimed: false
        }
      });
      return;
    }
    if (req.method === "POST" && ["/api/analyze", "/api/recheck"].includes(url.pathname)) {
      const payload = await readJson(req);
      if (!payload || typeof payload !== 'object' || Array.isArray(payload) || !Object.hasOwn(rulepack.routes, payload.route)
          || (payload.mode !== undefined && !['local', 'live'].includes(payload.mode))
          || (payload.imageDataUrl !== undefined && (typeof payload.imageDataUrl !== 'string'
            || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.imageDataUrl)))) {
        sendJson(res, 400, { error: 'INVALID_ANALYSIS_INPUT', message: '请提供受支持的市场、模式和本地图片数据。' });
        return;
      }
      const result = await analyzeRequest(payload);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/audit-export") {
      const payload = await readJson(req);
      const exportBody = JSON.stringify({
        exportedAt: new Date().toISOString(),
        product: payload.product || null,
        analysis: payload.analysis || null,
        recheck: payload.recheck || null,
        declaration: rulepack.disclaimer
      }, null, 2);
      res.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="globalguard-audit-${Date.now()}.json"`,
        "Content-Length": Buffer.byteLength(exportBody)
      });
      res.end(exportBody);
      return;
    }
    if (req.method === "GET") {
      await serveStatic(req, res, url.pathname);
      return;
    }
    sendJson(res, 405, { error: "METHOD_NOT_ALLOWED" });
  } catch (error) {
    const status = error.statusCode || (error.message === "PAYLOAD_TOO_LARGE" ? 413 : error instanceof SyntaxError ? 400 : 500);
    sendJson(res, status, {
      error: status === 500 ? "INTERNAL_ERROR" : error.message,
      message: status === 429 ? "模型正忙或本分钟调用次数已达上限，请稍后重试。" : status === 500 ? "服务处理失败，请查看本地终端日志。" : "请求格式不正确。"
    });
    if (status === 500) console.error(error);
  }
});

server.listen(port, host, () => {
  console.log(`GlobalGuard running at http://${host}:${server.address().port}`);
  const status = modelRouterStatus();
  console.log(`Token Plan: ${!status.configured ? "local rules mode" : status.appUseApproved ? "configured; application use approved" : "configured; application authorization pending"}`);
});
