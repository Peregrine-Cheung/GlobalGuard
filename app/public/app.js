import { signalsForRecheck, recheckPresentation, ocrPresentation, textRegionPresentations, containFitRect, buildUsRepairProtectionPlan } from './verification.mjs';
import { readSampleLibrary, sampleProvenance, attributionText } from './sample-library.mjs';

const ROUTE_COPY = {
  US_GOOGLE: {
    context: "Google 商品主图当前要求与 2027 尺寸变更准备度。未来规则会单独标识，不冒充当前驳回项。"
  },
  CN_ADS: {
    context: "广告绝对化表达、效果数据依据与 AI 素材标识适用性。命中词语不等于自动判定违法。"
  },
  EU_GPSR: {
    context: "GPSR 第 19 条在线商品要约信息。主体和安全资料必须来自真实档案，AI 不负责猜测或补齐。"
  }
};

const STATUS_COPY = {
  blocked: { pill: "存在发布阻断", heading: "建议暂停发布", summary: "先处理阻断项，再用同一规则包独立复检。" },
  review: { pill: "需要人工复核", heading: "有条件推进", summary: "没有硬阻断，但仍有需要证据或人工判断的项目。" },
  ready: { pill: "当前规则检查通过", heading: "当前覆盖项未发现阻断", summary: "这不是平台批准或法律认证；仍应保留业务人员最终确认。" }
};

const SEVERITY_LABELS = {
  blocker: "BLOCKER",
  high: "HIGH",
  medium: "MEDIUM",
  warning: "READINESS",
  info: "INFO"
};

const state = {
  route: "US_GOOGLE",
  imageDataUrl: "",
  image: null,
  visualSignals: {},
  isSample: false,
  analysis: null,
  recheck: null,
  analysisInput: null,
  recheckInput: null,
  revision: 0,
  imageLoadId: 0,
  samples: [],
  fixedImageDataUrl: "",
  fixedImage: null,
  fixedSignals: null,
  repairPlan: null,
  repairDecision: null,
  repairMode: null,
  originalProductCopy: "",
  modelConfigured: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showToast(message, type = "") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.className = `toast show ${type}`.trim();
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => { toast.className = "toast"; }, 2800);
}

function setBusy(button, busy, label) {
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = button.querySelector("span")?.textContent || button.textContent;
  button.disabled = busy;
  const labelNode = button.querySelector("span");
  if (labelNode) labelNode.textContent = busy ? label : button.dataset.defaultLabel;
  else button.textContent = busy ? label : button.dataset.defaultLabel;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.message || body.error || `HTTP ${response.status}`);
  return body;
}

async function checkHealth() {
  try {
    const health = await fetchJson("/api/health");
    state.modelConfigured = health.modelRouter.configured;
    const status = $("#runtime-status");
    status.textContent = health.modelRouter.configured
      ? (health.modelRouter.appUseApproved ? "赛事授权已记录 · AI 模式可选" : "密钥已配置 · 应用授权待确认")
      : "本地规则模式可用";
    status.classList.toggle("live", health.modelRouter.configured && health.modelRouter.appUseApproved);
  } catch {
    $("#runtime-status").textContent = "服务连接异常";
  }
}

function updateRoute(route) {
  state.route = route;
  invalidateAnalysis();
  state.analysis = null;
  state.recheck = null;
  state.fixedImageDataUrl = "";
  state.fixedImage = null;
  state.fixedSignals = null;
  $$(".route-tab").forEach((tab) => {
    const active = tab.dataset.route === route;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  $("#route-context p").innerHTML = `<b>当前检查：</b>${ROUTE_COPY[route].context}`;
  $("#cn-fields").classList.toggle("hidden", route !== "CN_ADS");
  $("#eu-fields").classList.toggle("hidden", route !== "EU_GPSR");
  resetResults();
}

function invalidateAnalysis() {
  state.revision++;
  state.analysis = null;
  state.recheck = null;
  state.analysisInput = null;
  state.recheckInput = null;
  state.fixedImageDataUrl = '';
  state.fixedImage = null;
  state.fixedSignals = null;
  state.repairPlan = null;
  state.repairDecision = null;
  state.repairMode = null;
  resetResults();
}

function resetResults() {
  $("#result-panel").classList.add("empty");
  $("#result-empty").classList.remove("hidden");
  $("#result-content").classList.add("hidden");
  $("#risk-overlay").innerHTML = "";
  $("#risk-overlay").style.cssText = "";
}

function fileToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = dataUrl;
  });
}

async function normalizeImage(dataUrl, width, height) {
  const image = await loadImage(dataUrl);
  const canvas = document.createElement("canvas");
  canvas.width = width || image.naturalWidth;
  canvas.height = height || image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/png", 0.94), image, canvas, context };
}

function colorDistance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

function averagePixels(data, coords, width) {
  const values = [0, 0, 0];
  for (const [x, y] of coords) {
    const offset = (y * width + x) * 4;
    values[0] += data[offset];
    values[1] += data[offset + 1];
    values[2] += data[offset + 2];
  }
  return values.map((value) => value / Math.max(1, coords.length));
}

function detectBorder(canvas, context) {
  const target = document.createElement("canvas");
  target.width = 80;
  target.height = 80;
  const targetContext = target.getContext("2d", { willReadFrequently: true });
  targetContext.drawImage(canvas, 0, 0, 80, 80);
  const pixels = targetContext.getImageData(0, 0, 80, 80).data;
  const edge = [];
  const inner = [];
  for (let i = 0; i < 80; i += 2) {
    edge.push([i, 1], [i, 78], [1, i], [78, i]);
    inner.push([i, 9], [i, 70], [9, i], [70, i]);
  }
  return colorDistance(averagePixels(pixels, edge, 80), averagePixels(pixels, inner, 80)) > 48;
}

async function setImage(dataUrl, name, options = {}) {
  const imageLoadId = options.imageLoadId ?? ++state.imageLoadId;
  const rawImage = await loadImage(dataUrl);
  const normalized = await normalizeImage(dataUrl, rawImage.naturalWidth, rawImage.naturalHeight);
  if (imageLoadId !== state.imageLoadId) return false;
  invalidateAnalysis();
  state.imageDataUrl = normalized.dataUrl;
  state.image = {
    name,
    width: rawImage.naturalWidth,
    height: rawImage.naturalHeight,
    mimeType: "image/png",
    ...(options.provenance ? { provenance: options.provenance } : {})
  };
  state.visualSignals = options.signals || {
    hasBorder: detectBorder(normalized.canvas, normalized.context),
    borderMethod: 'edge-color-heuristic-v1',
    overlayText: $("#overlay-text").value.trim(),
    hasPromotionalOverlay: null,
    aiGenerated: $("#ai-generated").checked,
    hasSyntheticMetadata: false,
    sampleLayout: ""
  };
  state.isSample = Boolean(options.sample);
  state.fixedImageDataUrl = "";
  state.fixedImage = null;
  state.fixedSignals = null;
  $("#image-preview").src = state.imageDataUrl;
  $("#image-preview-wrap").classList.remove("hidden");
  $("#empty-upload").classList.add("hidden");
  renderImageBadges();
  renderSampleAttribution();
  return true;
}

function renderImageBadges() {
  if (!state.image) return;
  const badges = [
    `${state.image.width}×${state.image.height}px`,
    state.isSample ? "演示 SKU" : state.image.provenance ? "公开照片 · 非商家案例" : "用户素材"
  ];
  $("#image-badges").innerHTML = badges.map((badge) => `<span>${escapeHtml(badge)}</span>`).join("");
}

async function loadSample() {
  const imageLoadId = ++state.imageLoadId;
  try {
    const response = await fetch("/assets/sample-product.svg");
    const blob = await response.blob();
    const dataUrl = await fileToDataUrl(blob);
    if (imageLoadId !== state.imageLoadId) return;
    $("#product-title").value = "FlexiNest 可折叠家居收纳箱";
    $("#product-copy").value = "全网最佳收纳方案，轻松折叠，用户好评率 98%。适用于衣柜、客厅与宿舍的日常收纳。";
    $("#overlay-text").value = "BEST · FREE SHIPPING · LIMITED OFFER";
    $("#manufacturer-name").value = "Hebei Zhengxiang Environmental Technology Co., Ltd.";
    $("#manufacturer-country").value = "CN";
    $("#manufacturer-address").value = "Hebei, China（演示占位，提交前替换为真实档案）";
    $("#manufacturer-email").value = "demo@example.invalid";
    $("#product-id").value = "FN-BOX-01";
    $("#safety-info").value = "";
    $("#responsible-name").value = "";
    $("#responsible-email").value = "";
    $("#responsible-address").value = "";
    $("#offer-source-ref").value = "";
    $("#offer-source-excerpt").value = "";
    await setImage(dataUrl, "globalguard-demo-sku.png", {
      imageLoadId,
      sample: true,
      signals: {
        hasBorder: true,
        overlayText: "BEST · FREE SHIPPING · LIMITED OFFER",
        hasPromotionalOverlay: true,
        overlayRegion: { type: "region", x: 3, y: 3, width: 94, height: 17 },
        aiGenerated: false,
        hasSyntheticMetadata: false,
        sampleLayout: "globalguard-v1"
      }
    });
    showToast("已载入同一 SKU 的三市场演示资料");
  } catch (error) {
    showToast(`样例载入失败：${error.message}`, "error");
  }
}

async function handleFiles(files) {
  const file = files?.[0];
  if (!file) return;
  if (file.size > 8 * 1024 * 1024) {
    showToast("图片超过 8 MB，请压缩后再试", "error");
    return;
  }
  try {
    const imageLoadId = ++state.imageLoadId;
    const dataUrl = await fileToDataUrl(file);
    if (!await setImage(dataUrl, file.name, { imageLoadId })) return;
    showToast("图片已加载，可开始检查");
  } catch {
    showToast("无法读取该图片格式", "error");
  }
}

function renderSampleAttribution() {
  const source = state.image?.provenance;
  const box = $('#sample-attribution');
  box.classList.toggle('hidden', !source);
  $('#download-attribution').classList.toggle('hidden', !source);
  box.textContent = '';
  if (!source) return;
  box.append(document.createTextNode(`公开照片：${source.author} · ${source.license}。仅用于测试，非商家案例。 `));
  for (const [label, href] of [['原始来源', source.sourcePage], ['许可', source.licenseUrl]]) {
    const link = document.createElement('a');
    link.textContent = `${label} ↗ `; link.href = href; link.target = '_blank'; link.rel = 'noreferrer';
    box.append(link);
  }
  box.append(document.createTextNode('导出或展示改编图时请一并保留署名和许可说明。'));
}

async function initializeSampleLibrary() {
  try {
    state.samples = await readSampleLibrary();
    const select = $('#licensed-sample');
    select.replaceChildren(...state.samples.map(sample => new Option(sample.title, sample.id)));
    select.disabled = false;
    $('#load-licensed-sample').disabled = false;
    const requested = new URLSearchParams(location.search).get('sample');
    if (requested && state.samples.some(sample => sample.id === requested)) {
      select.value = requested;
      await loadLicensedSample();
    }
  } catch { $('#licensed-sample').replaceChildren(new Option('素材库暂不可用，可自行上传', '')); }
}

async function loadLicensedSample() {
  const sample = state.samples.find(item => item.id === $('#licensed-sample').value);
  if (!sample) return;
  const imageLoadId = ++state.imageLoadId;
  const button = $('#load-licensed-sample');
  button.disabled = true;
  try {
    const response = await fetch(sample.path);
    if (!response.ok) throw new Error('本地照片读取失败');
    const dataUrl = await fileToDataUrl(await response.blob());
    if (imageLoadId !== state.imageLoadId) return;
    // No label answers or old seller records enter the model input.
    $('#overlay-text').value = '';
    $('#ai-generated').checked = false;
    $('#ai-label-declared').checked = false;
    $('#claim-evidence').value = '';
    $$('#eu-fields input, #eu-fields textarea').forEach(input => { input.value = ''; });
    if (!await setImage(dataUrl, `${sample.id}.png`, { imageLoadId, provenance: sampleProvenance(sample) })) return;
    $('#product-title').value = sample.title;
    $('#product-copy').value = sample.copy;
    showToast('已载入公开照片；描述为测试编写，未发起模型调用');
  } catch (error) { showToast(`照片载入失败：${error.message}`, 'error'); }
  finally { button.disabled = false; }
}

function downloadAttribution() {
  const source = state.image?.provenance;
  if (!source) return;
  const changes = state.fixedImageDataUrl && state.fixedImageDataUrl !== state.imageDataUrl
    ? ' 工作台生成 720×720 白底等比例排版草稿，未裁剪原始主体；不是去水印或合规认证。' : '';
  const url = URL.createObjectURL(new Blob([attributionText(source, changes)], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url; link.download = `globalguard-${source.sampleId}-attribution.txt`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function offerFields() {
  return {
    manufacturerName: $("#manufacturer-name").value,
    manufacturerCountry: $("#manufacturer-country").value,
    manufacturerPostalAddress: $("#manufacturer-address").value,
    manufacturerEmail: $("#manufacturer-email").value,
    productId: $("#product-id").value,
    safetyInfo: $("#safety-info").value,
    responsiblePersonName: $("#responsible-name").value,
    responsiblePersonEmail: $("#responsible-email").value,
    responsiblePersonPostalAddress: $("#responsible-address").value
  };
}

function buildPayload({ fixed = false } = {}) {
  const signals = fixed && state.fixedSignals ? state.fixedSignals : {
    ...state.visualSignals,
    overlayText: $("#overlay-text").value.trim(),
    aiGenerated: $("#ai-generated").checked
  };
  return {
    route: state.route,
    category: "home-storage",
    productTitle: $("#product-title").value.trim(),
    productCopy: $("#product-copy").value.trim(),
    image: fixed && state.fixedImage ? state.fixedImage : state.image,
    imageDataUrl: fixed && state.fixedImageDataUrl ? state.fixedImageDataUrl : state.imageDataUrl,
    visualSignals: signals,
    claimEvidenceUrl: $("#claim-evidence").value.trim(),
    aiLabelDeclared: $("#ai-label-declared").checked,
    offerFields: offerFields(),
    offerEvidence: {
      sourceRef: $("#offer-source-ref").value.trim(),
      excerpt: $("#offer-source-excerpt").value
    },
    mode: $("#analysis-mode").value
  };
}

function validateInput() {
  if (!state.image) return "请先上传商品主图或载入演示 SKU";
  if (!$("#product-title").value.trim()) return "请填写商品标题";
  return "";
}

async function runAnalysis() {
  const error = validateInput();
  if (error) {
    showToast(error, "error");
    return;
  }
  const button = $("#analyze-button");
  invalidateAnalysis();
  const revision = state.revision;
  setBusy(button, true, "正在路由并核对规则…");
  state.recheck = null;
  state.fixedImageDataUrl = "";
  state.fixedImage = null;
  state.fixedSignals = null;
  state.originalProductCopy = $("#product-copy").value;
  try {
    const payload = buildPayload();
    const result = await fetchJson("/api/analyze", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (revision !== state.revision) return;
    state.analysisInput = payload;
    state.analysis = result;
    renderResults(state.analysis);
    $("#result-panel").scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (err) {
    showToast(`检查失败：${err.message}`, "error");
  } finally {
    setBusy(button, false, "");
  }
}

function renderResults(result) {
  $("#result-panel").classList.remove("empty");
  $("#result-empty").classList.add("hidden");
  $("#result-content").classList.remove("hidden");
  $("#analysis-id").textContent = `ID ${result.analysisId.slice(0, 8)} · ${result.rulepack.version}`;
  $("#result-title").textContent = result.routeLabel;
  const status = STATUS_COPY[result.summary.status];
  $("#score-ring").style.setProperty("--score", result.summary.score);
  $("#score-value").textContent = result.summary.score;
  const pill = $("#status-pill");
  pill.className = `status-pill ${result.summary.status}`;
  pill.textContent = status.pill;
  $("#score-heading").textContent = status.heading;
  $("#score-summary").textContent = status.summary;
  $("#metric-blockers").textContent = result.summary.blockerCount;
  $("#metric-review").textContent = result.summary.reviewCount;
  $("#metric-evidence").textContent = result.summary.evidenceCount;
  $("#risk-count").textContent = `${result.summary.totalRisks} 项`;
  renderAiTelemetry(result.ai);
  renderRisks(result.risks);
  renderFixes(result.fixes, result);
  renderRiskOverlay(result, state.repairPlan);
  $("#recheck-section").classList.add("hidden");
  $("#recheck-result").classList.add("hidden");
  $("#audit-chain").textContent = `已记录检测 · ${result.audit.inputFingerprint}`;
}

function renderAiTelemetry(ai) {
  const box = $("#ai-telemetry");
  box.className = `ai-telemetry ${ai.status || ""}`;
  if (ai.status === "live") {
    const models = (ai.stages || []).map((stage) => stage.model.split("/").pop()).join(" → ");
    box.innerHTML = `<div class="ai-summary-row"><span><strong>真实 Token Plan 调用</strong> · ${escapeHtml(models)}</span><span>${Number(ai.latencyMs || 0)} ms</span></div>${renderModelObservations(ai)}`;
  } else if (ai.status === "degraded") {
    box.innerHTML = `<span><strong>安全降级</strong> · ${escapeHtml(ai.message)}</span><span>${escapeHtml(ai.errorCode || "")}</span>`;
  } else if (ai.status === "unavailable") {
    box.innerHTML = `<span><strong>本地规则兜底</strong> · ${escapeHtml(ai.message)}</span><span>结果可复现</span>`;
  } else {
    box.innerHTML = "<span><strong>确定性规则</strong> · 当前未调用生成模型</span><span>结果可复现</span>";
  }
}

function renderModelObservations(ai) {
  if (ai?.status !== 'live' || !ai.observations) return '';
  if (Array.isArray(ai.observations.euFieldFacts)) {
    const fieldLabels = {
      manufacturerName: '制造商名称', manufacturerCountry: '制造商国家代码',
      manufacturerPostalAddress: '制造商邮政地址', manufacturerEmail: '制造商电子地址',
      productId: '产品型号/标识符', safetyInfo: '警告或安全信息',
      responsiblePersonName: '欧盟责任人名称', responsiblePersonPostalAddress: '欧盟责任人邮政地址',
      responsiblePersonEmail: '欧盟责任人电子地址'
    };
    const evidenceLabels = {
      'exact-quote-match': '档案逐字匹配', 'source-quote-missing': '未定位到原文',
      'no-source-reference': '未提供档案编号', 'missing-field': '页面未提供'
    };
    const rows = ai.observations.euFieldFacts.map(fact => `<li><span>${escapeHtml(fieldLabels[fact.field] || fact.field)} · ${escapeHtml(evidenceLabels[fact.evidenceStatus] || fact.evidenceStatus)}</span><b>${fact.providedValue ? escapeHtml(fact.providedValue) : '未提供'}</b>${fact.sourceQuote ? `<small>档案原文：${escapeHtml(fact.sourceQuote)}</small>` : ''}${fact.sourceRef ? `<small>来源引用：${escapeHtml(fact.sourceRef)}</small>` : ''}</li>`).join('');
    return `<div class="ai-observations"><b>页面字段事实与档案引用（不含法律判断）</b><ul class="claim-fact-list">${rows}</ul><small>缺失值保持为空；模型没有补全制造商、欧盟责任人、地址、邮箱、产品标识或安全信息。风险和发布动作由本地规则及人工复核决定。<br>请求 ${escapeHtml(ai.requestId || '未返回编号')} · Token ${escapeHtml(ai.usage?.totalTokens ?? '未返回')} · 观察策略 ${escapeHtml(ai.observationPolicy || '历史版本')}</small></div>`;
  }
  if (Array.isArray(ai.observations.cnClaimFacts)) {
    const sourceLabels = { product_title: '商品标题', product_copy: '商品文案', image_text: '图片文字' };
    const kindLabels = {
      superlative_or_ranking: '最高级/排名表述', numeric_or_statistical: '数值/统计表述',
      performance_or_effect: '效果表述', testimonial_or_endorsement: '评价/背书表述',
      citation_or_reference: '引证表述', general_product_statement: '一般商品表述'
    };
    const rows = ai.observations.cnClaimFacts.map(fact => `<li><span>${escapeHtml(sourceLabels[fact.source] || fact.source)} · ${escapeHtml(kindLabels[fact.kind] || fact.kind)}</span><b>${escapeHtml(fact.verbatim)}</b>${fact.numericTokens?.length ? `<small>数值原文：${escapeHtml(fact.numericTokens.join('、'))}</small>` : ''}${fact.referenceTokens?.length ? `<small>引证原文：${escapeHtml(fact.referenceTokens.join('、'))}</small>` : ''}</li>`).join('');
    return `<div class="ai-observations"><b>模型逐字事实（不含法律判断）</b>${rows ? `<ul class="claim-fact-list">${rows}</ul>` : '<p>本次没有提取到广告主张。</p>'}<small>这些内容只证明原文片段被结构化提取；风险、证据缺口和处理动作由本地规则及人工复核决定。<br>请求 ${escapeHtml(ai.requestId || '未返回编号')} · Token ${escapeHtml(ai.usage?.totalTokens ?? '未返回')} · 观察策略 ${escapeHtml(ai.observationPolicy || '历史版本')}</small></div>`;
  }
  const regionCount = textRegionPresentations(ai.observations.textRegions).length;
  const regionCopy = regionCount
    ? `<b>文字证据区域</b><p>已返回 ${regionCount} 个归一化区域；蓝色框表示 OCR 位置，橙色框表示关联风险位置。</p>`
    : '<b>文字证据区域</b><p>本次没有可显示的文字区域。</p>';
  return `<div class="ai-observations"><b>模型本次文字识别</b><p>${escapeHtml(ocrPresentation(ai.observations.ocrText, ai.observations.ocrStatus))}</p>${regionCopy}<b>本次视觉观察（辅助判断）</b><p>${escapeHtml(ai.observations.visualObservation || '未返回观察')}</p><small>位置和 OCR 都可能偏差；“未看见”也不能证明图片没有文字。<br>请求 ${escapeHtml(ai.requestId || '未返回编号')} · Token ${escapeHtml(ai.usage?.totalTokens ?? '未返回')} · 观察策略 ${escapeHtml(ai.observationPolicy || '历史版本')}</small></div>`;
}

function renderRisks(risks) {
  const list = $("#risk-list");
  if (!risks.length) {
    list.innerHTML = `<div class="ready-card"><span>✓</span><h4>当前规则包未发现发布阻断</h4><p>结果不替代最终人工确认，审计链已记录本次输入和规则版本。</p></div>`;
    return;
  }
  list.innerHTML = risks.map((risk) => {
    const links = risk.evidence.map((source) =>
      `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.publisher)} ↗</a>`
    ).join("");
    return `
      <article class="risk-card ${escapeHtml(risk.severity)}">
        <div class="risk-head">
          <span class="severity">${SEVERITY_LABELS[risk.severity] || "RISK"}</span>
          <h4>${escapeHtml(risk.title)}</h4>
          <span class="risk-rule">${escapeHtml(risk.ruleId)}</span>
        </div>
        ${risk.origin === 'model-router' ? '<span class="human-review">AI 辅助观察 · 不是已确认的平台裁定</span>' : ''}
        <p class="risk-finding">${escapeHtml(risk.finding)}</p>
        <div class="risk-details">
          <div><span>WHY IT MATTERS</span><p>${escapeHtml(risk.whyItMatters)}</p></div>
          <div><span>NEXT ACTION</span><p>${escapeHtml(risk.action)}</p></div>
        </div>
        <div class="evidence-links">${links}</div>
        ${risk.requiresHumanReview ? '<span class="human-review">需要人工确认适用性或证据</span>' : ""}
      </article>`;
  }).join("");
}

function positionRiskOverlay() {
  const overlay = $("#risk-overlay");
  const wrap = $("#image-preview-wrap");
  const rect = containFitRect(wrap.clientWidth, wrap.clientHeight, state.image?.width, state.image?.height);
  if (!rect) {
    overlay.style.cssText = "";
    return;
  }
  Object.assign(overlay.style, {
    inset: 'auto', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px`
  });
}

function renderRiskOverlay(result, repairPlan = null) {
  const overlay = $("#risk-overlay");
  const risks = Array.isArray(result?.risks) ? result.risks : [];
  const visualRisks = risks.filter((risk) => ["border", "region"].includes(risk.location?.type));
  const linkedRegionIds = new Set(visualRisks.map((risk) => risk.location?.regionId).filter(Boolean));
  const riskBoxes = visualRisks.map((risk) => {
    const location = risk.location;
    if (location.type === "border") return `<span class="hotspot border" data-label="${escapeHtml(risk.category)}"></span>`;
    return `<span class="hotspot" data-label="${escapeHtml(risk.category)}" style="left:${location.x}%;top:${location.y}%;width:${location.width}%;height:${location.height}%"></span>`;
  });
  const evidenceBoxes = textRegionPresentations(result?.ai?.observations?.textRegions)
    .filter((region) => !linkedRegionIds.has(region.id) && !repairPlan?.protectedRegions.some(item => item.id === region.id))
    .map((region) => `<span class="hotspot evidence-region" data-label="${escapeHtml(region.label)}" style="left:${region.x}%;top:${region.y}%;width:${region.width}%;height:${region.height}%"></span>`);
  const protectionBoxes = (repairPlan?.protectedRegions || []).map((region) => `<span class="hotspot protection-region ${region.affectedByCrop ? 'blocked' : ''}" data-label="${escapeHtml(region.affectedByCrop ? `阻断保护 · ${region.label}` : `保护 · ${region.label}`)}" style="left:${region.x}%;top:${region.y}%;width:${region.width}%;height:${region.height}%"></span>`);
  overlay.innerHTML = [...riskBoxes, ...evidenceBoxes, ...protectionBoxes].join("");
  requestAnimationFrame(positionRiskOverlay);
}

function proposedUsCropRect() {
  if (!state.isSample) return { x: 0, y: 0, width: 1, height: 1 };
  const width = state.image?.width || 1;
  const height = state.image?.height || 1;
  return { x: 13 / width, y: 84 / height, width: (width - 26) / width, height: (height - 98) / height };
}

function updateRepairButtonState() {
  if (state.route !== 'US_GOOGLE' || !state.repairPlan) return;
  const removalConfirmed = !state.repairPlan.hasRemovalIntent || $('#confirm-removal').checked;
  const protectionConfirmed = $('#confirm-protection').checked;
  $('#apply-fix').disabled = !state.repairPlan.canApply || !removalConfirmed || !protectionConfirmed;
}

function renderRepairGuard(result, fixes, { safeReframe = false } = {}) {
  const guard = $('#repair-guard');
  const removalField = $('#confirm-removal-field');
  const removalCheck = $('#confirm-removal');
  const protectionCheck = $('#confirm-protection');
  const safeReframeButton = $('#use-safe-reframe');
  state.repairDecision = null;
  state.repairMode = safeReframe ? 'safe-reframe-no-crop' : 'proposed-repair';
  const plannedFixes = safeReframe ? fixes.filter(fix => fix?.id === 'fix-resize-720') : fixes;
  state.repairPlan = buildUsRepairProtectionPlan({
    textRegions: result?.ai?.observations?.textRegions,
    risks: result?.risks,
    fixes: plannedFixes,
    cropRect: safeReframe ? { x: 0, y: 0, width: 1, height: 1 } : proposedUsCropRect(),
    operation: state.repairMode
  });
  const plan = state.repairPlan;
  removalCheck.checked = false;
  protectionCheck.checked = false;
  guard.classList.remove('hidden');
  guard.classList.toggle('blocked', !plan.canApply);
  removalField.classList.toggle('hidden', !plan.hasRemovalIntent);
  removalCheck.disabled = !plan.canApply;
  protectionCheck.disabled = !plan.canApply;
  safeReframeButton.classList.toggle('hidden', plan.canApply || safeReframe);

  $('#repair-guard-status').textContent = safeReframe
    ? '不裁剪安全替代 · 等待主体确认'
    : plan.canApply
    ? '等待操作者核对后生成草稿'
    : `自动修复已阻断 · ${plan.blockedRegions.length} 个保护区会受影响`;
  $('#repair-guard-summary').textContent = safeReframe
    ? `替代动作保留完整源图，不移除促销文字或边框；${plan.protectedRegions.length} 个已观察文字区全部转为保护区。复检会继续保留原有视觉风险。`
    : plan.coverage === 'model-regions-present'
    ? `已把 ${plan.protectedRegions.length} 个商品/场景/未确认文字区设为保护区；${plan.removalCandidates.length} 个与促销风险绑定的叠层区仅列为候选移除。区域来自模型观察，仍可能漏检。`
    : '本次没有可用的模型文字区域，无法证明商品、包装或场景文字未被漏检；系统不会把“未检测到”当成安全。';
  $('#confirm-protection-copy').textContent = safeReframe
    ? '我确认本次只把完整源图等比例放入白底画布，不清除促销内容；输出仍需继续处理和复检。'
    : plan.coverage === 'model-regions-present'
    ? '我已核对绿色保护区、未框出的商品主体和裁剪边界，确认售卖主体不会被裁伤。'
    : '我已人工查看完整原图、商品主体和裁剪边界，并接受本次区域覆盖缺失仍需后续复检。';

  const regionRows = [
    ...plan.protectedRegions.map(region => `<div class="repair-region-item ${region.affectedByCrop ? 'blocked' : ''}"><span>${escapeHtml(region.label)}</span><em>${region.affectedByCrop ? '触及裁剪区 · 已阻断' : '保护'}</em></div>`),
    ...plan.removalCandidates.map(region => `<div class="repair-region-item removal"><span>${escapeHtml(region.label)}</span><em>${region.affectedByCrop ? '候选移除' : '保留在画面内'}</em></div>`)
  ];
  if (!regionRows.length) regionRows.push('<div class="repair-region-item blocked"><span>没有可用区域证据</span><em>人工覆盖</em></div>');
  $('#repair-region-list').innerHTML = regionRows.join('');
  const blocker = $('#repair-guard-blocker');
  blocker.classList.toggle('hidden', plan.canApply);
  blocker.textContent = plan.canApply ? '' : '保护区与拟裁剪边界相交。此处不提供勾选绕过；请换用不裁剪的处理方式或交由人工逐区编辑。';
  if (safeReframe) $('#apply-fix').innerHTML = '生成不裁剪安全替代草稿 <span>↗</span>';
  updateRepairButtonState();
}

function renderFixes(fixes, result) {
  const section = $("#fix-section");
  const button = $("#apply-fix");
  if (!fixes.length) {
    section.classList.add("hidden");
    state.repairPlan = null;
    state.repairMode = null;
    return;
  }
  section.classList.remove("hidden");
  $("#fix-list").innerHTML = fixes.map((fix) => `
    <div class="fix-item">
      <i>✓</i>
      <div><b>${escapeHtml(fix.label)}</b><p>${escapeHtml(fix.description)}</p></div>
      <em class="${fix.automatic ? "" : "manual"}">${fix.automatic ? (state.route === 'US_GOOGLE' ? '确认后执行' : '可自动执行') : "需业务确认"}</em>
    </div>`).join("");
  $("#before-after").classList.add("hidden");
  $("#download-fixed").classList.add("hidden");
  if (state.route === "US_GOOGLE") {
    button.innerHTML = "执行可验证的最小修复 <span>↗</span>";
    renderRepairGuard(result, fixes);
  } else if (state.route === "CN_ADS") {
    $('#repair-guard').classList.add('hidden');
    state.repairPlan = null;
    state.repairMode = null;
    button.innerHTML = "生成不含虚构主张的安全草稿 <span>↗</span>";
    button.disabled = false;
  } else {
    $('#repair-guard').classList.add('hidden');
    state.repairPlan = null;
    state.repairMode = null;
    button.innerHTML = "返回左侧补齐真实信息 <span>↗</span>";
    button.disabled = false;
  }
}

function drawContained(context, image, canvasWidth, canvasHeight, padding = 34) {
  const maxWidth = canvasWidth - padding * 2;
  const maxHeight = canvasHeight - padding * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (canvasWidth - width) / 2, (canvasHeight - height) / 2, width, height);
}

async function createFixedUsImage() {
  const source = await loadImage(state.imageDataUrl);
  const cropCanvas = document.createElement("canvas");
  let cropX = 0;
  let cropY = 0;
  let cropWidth = source.naturalWidth;
  let cropHeight = source.naturalHeight;
  if (state.isSample && state.repairMode !== 'safe-reframe-no-crop') {
    cropX = 13;
    cropY = 84;
    cropWidth = source.naturalWidth - 26;
    cropHeight = source.naturalHeight - 98;
  }
  // Unknown user images are not blindly cropped: an edge can be the product.
  cropCanvas.width = cropWidth;
  cropCanvas.height = cropHeight;
  cropCanvas.getContext("2d").drawImage(source, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);

  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 720;
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, 720, 720);
  drawContained(context, cropCanvas, 720, 720, 34);
  return canvas.toDataURL("image/png", 0.94);
}

function safeClaimRewrite(copy) {
  let result = copy;
  const replacements = [
    [/全网最佳(?:收纳方案)?[，,、]?/g, "面向日常家居收纳设计，"],
    [/用户好评率\s*\d+(?:\.\d+)?%[。,.，]?/g, ""],
    [/国家级|最高级|顶级|行业第一|全网第一|绝对|永久|100%|百分之百/g, ""]
  ];
  for (const [pattern, replacement] of replacements) result = result.replace(pattern, replacement);
  return result.replace(/，{2,}/g, "，").replace(/^\s*[，,。]/, "").trim();
}

async function applyFix() {
  if (!state.analysis) return;
  const button = $("#apply-fix");
  const revision = state.revision;
  button.disabled = true;
  try {
    if (state.route === "US_GOOGLE") {
      const removalConfirmed = !state.repairPlan?.hasRemovalIntent || $('#confirm-removal').checked;
      if (!state.repairPlan?.canApply || !removalConfirmed || !$('#confirm-protection').checked) {
        showToast(state.repairPlan?.canApply ? '请先完成修复前区域核对' : '保护区会受影响，自动修复已阻断', 'error');
        return;
      }
      state.repairDecision = {
        version: 'browser-repair-decision-v1',
        analysisId: state.analysis.analysisId,
        confirmedAt: new Date().toISOString(),
        repairMode: state.repairMode,
        confirmationScope: 'local-operator-check-without-identity-attestation',
        confirmations: { removalCandidateReviewed: removalConfirmed, protectionAndSubjectReviewed: true },
        protectionPlan: state.repairPlan
      };
      const fixedImageDataUrl = await createFixedUsImage();
      if (revision !== state.revision) return;
      state.fixedImageDataUrl = fixedImageDataUrl;
      state.fixedImage = { ...state.image, name: `fixed-${state.image.name}`, width: 720, height: 720, mimeType: "image/png" };
      if (state.image.provenance) state.fixedImage.provenance = {
        ...state.image.provenance,
        changes: `${state.image.provenance.changes} ${state.isSample && state.repairMode !== 'safe-reframe-no-crop' ? '按已知演示布局裁去外框和顶部促销区后，' : '未裁剪源图，'}工作台生成 720×720 白底等比例排版草稿。`,
        derivativeLicense: state.image.provenance.license === 'CC BY-SA 4.0' ? 'CC BY-SA 4.0' : null
      };
      // Signals will be re-extracted from the output when Recheck is requested.
      state.fixedSignals = null;
      $("#before-image").src = state.imageDataUrl;
      $("#after-image").src = state.fixedImageDataUrl;
      $("#before-after").classList.remove("hidden");
      $("#download-fixed").classList.remove("hidden");
      showToast(state.repairMode === 'safe-reframe-no-crop'
        ? '已生成不裁剪草稿；促销文字和边框风险仍然保留'
        : '已生成图片草稿；文字残留和主体完整性仍需复核');
    } else if (state.route === "CN_ADS") {
      const currentCopy = $("#product-copy").value;
      const rewritten = safeClaimRewrite(currentCopy);
      if (rewritten === currentCopy) {
        showToast("没有可安全自动删除的表述，请人工核对证据", "error");
        return;
      }
      $("#product-copy").value = rewritten;
      state.fixedImageDataUrl = state.imageDataUrl;
      state.fixedImage = { ...state.image };
      state.fixedSignals = { ...state.visualSignals };
      showToast("已生成删除无依据主张的草稿，未新增任何商品事实");
    } else {
      $("#eu-fields").scrollIntoView({ behavior: "smooth", block: "center" });
      showToast("请从真实档案补齐标记字段；系统不会代填主体信息");
      return;
    }
    $("#recheck-section").classList.remove("hidden");
    $("#audit-chain").textContent = `已记录检测 → 修复待复检 · ${state.analysis.audit.inputFingerprint}`;
  } catch (error) {
    showToast(`修复失败：${error.message}`, "error");
  } finally {
    if (state.route === 'US_GOOGLE') updateRepairButtonState();
    else button.disabled = false;
  }
}

async function runRecheck() {
  if (!state.analysis) return;
  const revision = state.revision;
  const button = $("#recheck-button");
  setBusy(button, true, "正在独立复检…");
  try {
    if (state.fixedImageDataUrl) {
      const inspected = await normalizeImage(state.fixedImageDataUrl);
      if (revision !== state.revision) return;
      state.fixedImage = { ...state.fixedImage, width: inspected.canvas.width, height: inspected.canvas.height };
      state.fixedSignals = signalsForRecheck(state.analysisInput.visualSignals, {
        hasBorder: detectBorder(inspected.canvas, inspected.context),
        imageChanged: state.fixedImageDataUrl !== state.analysisInput.imageDataUrl,
        preserveVisualContent: state.repairMode === 'safe-reframe-no-crop'
      });
    }
    const payload = { ...buildPayload({ fixed: true }), previousAnalysisId: state.analysis.analysisId };
    const result = await fetchJson("/api/recheck", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (revision !== state.revision) return;
    state.recheck = result;
    state.recheckInput = payload;
    const presentation = recheckPresentation(result.summary);
    const box = $("#recheck-result");
    box.className = `recheck-result ${presentation.className}`.trim();
    box.innerHTML = `
      <b>${escapeHtml(presentation.headline)}</b>
      <p>新分析 ID ${escapeHtml(result.analysisId.slice(0, 8))} · 规则包 ${escapeHtml(result.rulepack.version)}</p>
      <p>原图与复检图的内容指纹${result.audit.imageInputSha256 === state.analysis.audit.imageInputSha256 ? '相同（图片未改变）' : '不同（图片已改变）'}；指纹变化不代表已合规。</p>
      ${renderModelObservations(result.ai)}
      <div class="recheck-risk-list">${result.risks.map(risk => `<p><b>${escapeHtml(risk.title)}</b>${escapeHtml(risk.finding)}</p>`).join('')}</div>`;
    box.classList.remove("hidden");
    $("#audit-chain").textContent = `检测 → 修复 → 复检${presentation.label} · ${result.audit.inputFingerprint}`;
    showToast(presentation.message, presentation.passed ? "" : "error");
  } catch (err) {
    showToast(`复检失败：${err.message}`, "error");
  } finally {
    setBusy(button, false, "");
  }
}

function exportAudit() {
  if (!state.analysis) {
    showToast("请先完成一次检查", "error");
    return;
  }
  const body = {
    schemaVersion: "1.3",
    exportedAt: new Date().toISOString(),
    product: {
      title: state.analysisInput.productTitle,
      category: "home-storage",
      route: state.route,
      image: state.image,
      fixedImage: state.fixedImage
    },
    analysis: state.analysis,
    recheck: state.recheck,
    repairDecision: state.repairDecision,
    inputSnapshots: [state.analysisInput, state.recheckInput].filter(Boolean).map(({ imageDataUrl, offerEvidence, ...input }) => ({
      ...input,
      offerEvidence: offerEvidence ? {
        sourceRef: offerEvidence.sourceRef || '',
        excerptIncluded: false,
        excerptLength: String(offerEvidence.excerpt || '').length
      } : undefined
    })),
    integrityNotice: "图片和档案原文未嵌入导出文件；内容指纹及档案原文摘要保存在 audit 中。父分析编号是客户端声明，不是签名或外部认证。",
    declaration: "风险辅助，不构成法律意见；高风险结论保留人工复核出口。"
  };
  const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `globalguard-audit-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showToast("审计记录已导出");
}

function downloadFixedImage() {
  if (!state.fixedImageDataUrl) return;
  const link = document.createElement('a');
  link.href = state.fixedImageDataUrl;
  link.download = 'globalguard-image-draft.png';
  link.click();
  showToast(state.image?.provenance ? '草稿待复核；对外使用请同时下载并保留素材署名说明' : '已下载待复核图片草稿，不代表平台批准');
}

function setupDropzone() {
  const dropzone = $("#dropzone");
  ["dragenter", "dragover"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("dragging");
  }));
  ["dragleave", "drop"].forEach((eventName) => dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("dragging");
  }));
  dropzone.addEventListener("drop", (event) => handleFiles(event.dataTransfer.files));
  dropzone.addEventListener("keydown", (event) => {
    if (["Enter", " "].includes(event.key)) $("#image-input").click();
  });
}

function bindEvents() {
  $$('.input-panel input:not([type="file"]), .input-panel textarea, #analysis-mode').forEach(field => {
    field.addEventListener('input', invalidateAnalysis);
  });
  $$(".route-tab").forEach((tab) => tab.addEventListener("click", () => updateRoute(tab.dataset.route)));
  $("#load-sample").addEventListener("click", loadSample);
  $('#load-licensed-sample').addEventListener('click', loadLicensedSample);
  $('#download-attribution').addEventListener('click', downloadAttribution);
  $("#choose-image").addEventListener("click", (event) => { event.stopPropagation(); $("#image-input").click(); });
  $("#replace-image").addEventListener("click", (event) => { event.stopPropagation(); $("#image-input").click(); });
  $("#dropzone").addEventListener("click", (event) => {
    if (!event.target.closest("button") && !state.image) $("#image-input").click();
  });
  $("#image-input").addEventListener("change", (event) => handleFiles(event.target.files));
  $("#overlay-text").addEventListener("input", () => {
    state.visualSignals.overlayText = $("#overlay-text").value.trim();
    // User-entered text is not necessarily promotional; let scoped terms match.
    state.visualSignals.hasPromotionalOverlay = null;
  });
  $("#ai-generated").addEventListener("change", () => { state.visualSignals.aiGenerated = $("#ai-generated").checked; });
  $("#analysis-mode").addEventListener("change", () => {
    if ($("#analysis-mode").value === "live" && !state.modelConfigured) {
      showToast("尚未配置密钥；服务会明确降级为本地规则，不伪造 AI 调用");
    }
  });
  $("#analyze-button").addEventListener("click", runAnalysis);
  $("#apply-fix").addEventListener("click", applyFix);
  $('#use-safe-reframe').addEventListener('click', () => {
    if (!state.analysis || state.route !== 'US_GOOGLE') return;
    renderRepairGuard(state.analysis, state.analysis.fixes || [], { safeReframe: true });
    renderRiskOverlay(state.analysis, state.repairPlan);
  });
  $('#confirm-removal').addEventListener('change', updateRepairButtonState);
  $('#confirm-protection').addEventListener('change', updateRepairButtonState);
  $("#recheck-button").addEventListener("click", runRecheck);
  $("#export-audit").addEventListener("click", exportAudit);
  $("#download-fixed").addEventListener("click", downloadFixedImage);
  window.addEventListener('resize', () => {
    if (state.analysis) requestAnimationFrame(positionRiskOverlay);
  });
  setupDropzone();
}

bindEvents();
checkHealth();
initializeSampleLibrary();
