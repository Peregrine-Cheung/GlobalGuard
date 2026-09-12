import crypto from "node:crypto";

const EU_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE",
  "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT",
  "RO", "SK", "SI", "ES", "SE"
]);

const SEVERITY_WEIGHT = {
  blocker: 28,
  high: 18,
  medium: 10,
  warning: 6,
  info: 0
};

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function hasValue(value) {
  return clean(value).length > 0;
}

function unique(values) {
  return [...new Set(values)];
}

function makeId(route, ruleId, detail = "") {
  return crypto
    .createHash("sha1")
    .update(`${route}:${ruleId}:${detail}`)
    .digest("hex")
    .slice(0, 12);
}

function sourceView(rulepack, sourceId) {
  const source = rulepack.sources[sourceId];
  if (!source) return null;
  return { id: sourceId, ...source };
}

function riskFactory(rulepack, route, data) {
  const sources = (data.sourceIds || [])
    .map((id) => sourceView(rulepack, id))
    .filter(Boolean);

  return {
    id: makeId(route, data.ruleId, data.detail || data.title),
    ruleId: data.ruleId,
    route,
    severity: data.severity,
    category: data.category,
    title: data.title,
    finding: data.finding,
    whyItMatters: data.whyItMatters,
    action: data.action,
    applicability: data.applicability || "当前所选发布环境",
    requiresHumanReview: Boolean(data.requiresHumanReview),
    location: data.location || null,
    evidenceRegionId: data.evidenceRegionId || null,
    evidence: sources,
    origin: data.origin || "deterministic"
  };
}

function analyzeUsGoogle(input, rulepack, risks, fixes) {
  const route = "US_GOOGLE";
  const image = input.image || {};
  const signals = input.visualSignals || {};
  const rules = rulepack.rules[route];
  const width = Number(image.width || 0);
  const height = Number(image.height || 0);

  if (!width || !height) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-US-IMG-000",
      severity: "blocker",
      category: "素材完整性",
      title: "缺少可检测的商品主图",
      finding: "没有获得有效图片尺寸，无法完成发布前检查。",
      whyItMatters: "商品图片是当前发布路径的必要输入。",
      action: "上传 JPG、PNG 或 WebP 商品主图后重新检测。",
      sourceIds: ["google_image_link"]
    }));
    return;
  }

  if (width < rules.hardMinimum.width || height < rules.hardMinimum.height) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-US-IMG-001",
      severity: "blocker",
      category: "图片尺寸",
      title: "图片低于当前最低尺寸",
      finding: `当前图片为 ${width}×${height}px，家居收纳等非服饰商品至少需要 100×100px。`,
      whyItMatters: "图片可能无法用于商品展示。",
      action: "换用更高分辨率的原始图片，避免单纯放大低清素材。",
      sourceIds: ["google_image_size_transition"],
      location: { type: "whole-image" }
    }));
  } else if (width < rules.futureMinimum.width || height < rules.futureMinimum.height) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-US-IMG-002",
      severity: "warning",
      category: "未来规则准备度",
      title: "图片未达到即将执行的 500×500px 要求",
      finding: `当前图片为 ${width}×${height}px；这不是 2026 年 9 月的硬性驳回项。`,
      whyItMatters: `Google 已公布从 ${rules.futureMinimum.enforcementDate} 起执行新的最低尺寸要求。`,
      action: "在不损失清晰度的前提下换用或制作至少 500×500px 的主图。",
      sourceIds: ["google_image_size_transition"],
      applicability: `准备度提示；预计 ${rules.futureMinimum.enforcementDate} 起执行`,
      location: { type: "whole-image" }
    }));
    fixes.push({
      id: "fix-resize-720",
      type: "resize_canvas",
      label: "生成 720×720 画布草稿",
      description: "保持主体比例；扩大画布不等于提高原图清晰度，需检查输出质量。",
      automatic: true
    });
  }

  if (signals.hasBorder === true) {
    const heuristicOnly = signals.borderMethod === "edge-color-heuristic-v1";
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-US-IMG-003",
      severity: heuristicOnly ? "high" : "blocker",
      category: "图片内容",
      title: heuristicOnly ? "图像边缘疑似装饰性边框" : "主图含装饰性边框",
      finding: heuristicOnly ? "边缘颜色启发式检测到差异，可能来自背景或商品本体，尚不能确认是装饰边框。" : "检测到围绕商品图的高对比度边框。",
      requiresHumanReview: heuristicOnly,
      whyItMatters: "装饰性边框会改变商品主图的展示内容，可能导致图片不符合要求。",
      action: "移除外边框，保留商品主体和自然背景。",
      sourceIds: ["google_image_link"],
      location: { type: "border", x: 0, y: 0, width: 100, height: 100 }
    }));
    fixes.push({
      id: "fix-trim-border",
      type: "trim_border",
      label: "移除装饰边框",
      description: "演示样图可按已知布局裁剪；真实图片需人工确认边界，避免裁伤商品。",
      automatic: signals.sampleLayout === "globalguard-v1"
    });
  }

  const overlayText = clean(signals.overlayText);
  const promoMatches = rules.promotionalTerms.filter((term) => overlayText.toLowerCase().includes(term.toLowerCase()));
  if (overlayText && (promoMatches.length > 0 || signals.hasPromotionalOverlay === true)) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-US-IMG-004",
      detail: overlayText,
      severity: "blocker",
      category: "促销叠字",
      title: "商品主图含促销文字",
      finding: `识别到图片叠字“${overlayText.slice(0, 80)}”。`,
      whyItMatters: "商品主图不应叠加免邮、最佳、折扣等促销信息。",
      action: "从主图中移除促销横幅；把促销信息放入平台允许的字段。",
      sourceIds: ["google_image_link"],
      location: signals.overlayRegion || { type: "region", x: 6, y: 4, width: 88, height: 18 }
    }));
    fixes.push({
      id: "fix-remove-overlay",
      type: "remove_promotional_banner",
      label: "移除促销横幅",
      description: "对演示样图执行可验证裁剪，不伪造商品主体。",
      automatic: signals.sampleLayout === "globalguard-v1"
    });
  }

  if (signals.aiGenerated === true && signals.hasSyntheticMetadata !== true) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-US-IMG-005",
      severity: "high",
      category: "AI 来源元数据",
      title: "AI 生成图片缺少可确认的来源元数据",
      finding: "素材被声明为 AI 生成，但没有检测到已保留的生成来源元数据。",
      whyItMatters: "Google 要求 AI 生成图片保留相应 IPTC DigitalSourceType 元数据。",
      action: "从生成工具导出保留元数据的版本；上传前人工核对元数据。",
      sourceIds: ["google_image_link"],
      requiresHumanReview: true,
      location: { type: "metadata" }
    }));
  }
}

function analyzeCnAds(input, rulepack, risks, fixes) {
  const route = "CN_ADS";
  const rules = rulepack.rules[route];
  const signals = input.visualSignals || {};
  const claimFacts = Array.isArray(input.cnClaimFacts) ? input.cnClaimFacts.slice(0, 12) : [];
  const content = [input.productTitle, input.productCopy, signals.overlayText, input.ocrText, ...claimFacts.map(fact => fact?.verbatim)]
    .map(clean)
    .filter(Boolean)
    .join("\n");
  const absoluteMatches = unique(rules.absoluteTerms.filter((term) => content.includes(term)));
  const absoluteFactIds = claimFacts
    .filter(fact => absoluteMatches.some(term => clean(fact?.verbatim).includes(term)))
    .map(fact => fact.id);

  if (absoluteMatches.length) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-CN-ADS-001",
      detail: absoluteMatches.join("|"),
      severity: "high",
      category: "广告表述",
      title: "发现可能构成绝对化表达的词语",
      finding: `命中：${absoluteMatches.join("、")}。系统不能脱离语境直接判定违法。`,
      whyItMatters: "绝对化用语需结合使用语境、事实依据、消费者影响及法定例外判断。",
      action: "删除无法证明的绝对结论，改写为可验证的商品事实；高风险文案交由人工复核。",
      sourceIds: ["samr_advertising_guidance"],
      requiresHumanReview: true,
      location: { type: "text", matches: absoluteMatches, claimFactIds: absoluteFactIds }
    }));
    fixes.push({
      id: "fix-cn-claims",
      type: "rewrite_claims",
      label: "生成证据约束型改写",
      description: "只保留可验证的商品事实，不自动生成排名或功效结论。",
      automatic: false,
      requiresConfirmation: true
    });
  }

  const containsEvidenceClaim = rules.evidenceTerms.some((term) => content.includes(term));
  const containsNumber = /\d+(?:\.\d+)?\s*(?:%|倍|万|亿|人|次)/.test(content);
  const evidenceFactIds = claimFacts
    .filter(fact => rules.evidenceTerms.some(term => clean(fact?.verbatim).includes(term))
      || /\d+(?:\.\d+)?\s*(?:%|倍|万|亿|人|次)/.test(clean(fact?.verbatim)))
    .map(fact => fact.id);
  if ((containsEvidenceClaim || containsNumber) && !hasValue(input.claimEvidenceUrl)) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-CN-ADS-002",
      severity: "high",
      category: "引用与数据依据",
      title: "效果或数据型表述缺少可追溯依据",
      finding: "文案包含数据、效果或市场表现表述，但未提供证据链接或内部证据编号。",
      whyItMatters: "不可核验、剪裁或失真的引用内容可能构成虚假或引人误解的广告。",
      action: "补充原始报告、统计口径、时间范围和适用条件；无法提供时删除该表述。",
      sourceIds: ["samr_citation_guidance_2026"],
      requiresHumanReview: true,
      location: { type: "text", claimFactIds: evidenceFactIds }
    }));
  }

  if (signals.aiGenerated === true && input.aiLabelDeclared !== true) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-CN-AI-001",
      severity: "medium",
      category: "生成合成内容标识",
      title: "AI 生成素材的标识状态未声明",
      finding: "素材被标记为 AI 生成，但尚未记录显式/隐式标识及传播链路信息。",
      whyItMatters: "标识义务需要结合服务提供、内容传播和用户声明等主体及场景判断。",
      action: "记录生成工具、导出元数据、发布平台和标识方式，并交由人工确认适用义务。",
      sourceIds: ["cac_ai_labeling"],
      requiresHumanReview: true,
      location: { type: "metadata" }
    }));
  }
}

function analyzeEuGpsr(input, rulepack, risks, fixes) {
  const route = "EU_GPSR";
  const fields = input.offerFields || {};
  const fieldFacts = Array.isArray(input.euFieldFacts) ? input.euFieldFacts.slice(0, 9) : [];
  const rules = rulepack.rules[route];
  const labels = {
    manufacturerName: "制造商名称",
    manufacturerPostalAddress: "制造商邮政地址",
    manufacturerEmail: "制造商电子地址",
    productId: "产品类型/标识符",
    safetyInfo: "适用的警告或安全信息",
    responsiblePersonName: "欧盟责任人名称",
    responsiblePersonPostalAddress: "欧盟责任人邮政地址",
    responsiblePersonEmail: "欧盟责任人电子地址"
  };

  const missingBase = rules.requiredOfferFields.filter((field) => !hasValue(fields[field]));
  if (missingBase.length) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-EU-GPSR-019A",
      detail: missingBase.join("|"),
      severity: "high",
      category: "在线要约信息",
      title: "商品页面缺少 GPSR 基础信息",
      finding: `缺少：${missingBase.map((field) => labels[field]).join("、")}。`,
      whyItMatters: "面向欧盟消费者的在线商品要约应清晰、可见地展示规定信息。",
      action: "由业务人员补齐真实主体和产品资料；系统不自动编造企业或安全信息。",
      sourceIds: ["eu_gpsr_article_19"],
      requiresHumanReview: true,
      location: {
        type: "offer-fields",
        fields: missingBase,
        fieldFactIds: fieldFacts.filter(fact => missingBase.includes(fact?.field)).map(fact => fact.id)
      }
    }));
  }

  const manufacturerCountry = clean(fields.manufacturerCountry).toUpperCase();
  const outsideEu = manufacturerCountry && !EU_COUNTRIES.has(manufacturerCountry);
  if (outsideEu) {
    const missingResponsible = rules.responsiblePersonFields.filter((field) => !hasValue(fields[field]));
    if (missingResponsible.length) {
      risks.push(riskFactory(rulepack, route, {
        ruleId: "GG-EU-GPSR-019B",
        detail: missingResponsible.join("|"),
        severity: "blocker",
        category: "欧盟责任人",
        title: "非欧盟制造商缺少欧盟责任人信息",
        finding: `制造商国家/地区为 ${manufacturerCountry}，缺少：${missingResponsible.map((field) => labels[field]).join("、")}。`,
        whyItMatters: "制造商不在欧盟时，在线要约需展示欧盟责任人的名称、邮政地址和电子地址。",
        action: "从真实合规档案中补齐欧盟责任人信息；未确认前不要发布。",
        sourceIds: ["eu_gpsr_article_19"],
        requiresHumanReview: true,
        location: {
          type: "offer-fields",
          fields: missingResponsible,
          fieldFactIds: fieldFacts.filter(fact => missingResponsible.includes(fact?.field)).map(fact => fact.id)
        }
      }));
    }
  }

  if (missingBase.length || risks.some((risk) => risk.ruleId === "GG-EU-GPSR-019B")) {
    fixes.push({
      id: "fix-eu-information",
      type: "supply_verified_information",
      label: "打开缺失信息清单",
      description: "仅接受真实档案信息，不使用生成模型补全主体身份。",
      automatic: false,
      requiresConfirmation: true
    });
  }
}

function addValidatedAiFindings(input, rulepack, risks) {
  if (input.route !== 'US_GOOGLE') return;
  const findings = Array.isArray(input.aiFindings) ? input.aiFindings : [];
  for (const finding of findings.slice(0, 8)) {
    if (!finding || typeof finding !== 'object') continue;
    const sourceIds = Array.isArray(finding.sourceIds)
      ? finding.sourceIds.filter((id) => rulepack.sources[id]?.appliesTo === input.route)
      : [];
    if (!finding.title || !finding.finding || sourceIds.length === 0) continue;
    const severity = ['high', 'medium', 'warning'].includes(finding.severity) ? finding.severity : "medium";
    const location = finding.location;
    const regionNumbers = location?.type === 'region'
      ? [location.x, location.y, location.width, location.height]
      : [];
    const safeRegion = regionNumbers.length === 4
      && regionNumbers.every(Number.isFinite)
      && location.x >= 0 && location.y >= 0 && location.width > 0 && location.height > 0
      && location.x + location.width <= 100.0001 && location.y + location.height <= 100.0001
      && /^text-[1-8]$/.test(location.regionId || '')
      && location.source === 'model-text-region'
      ? {
          type: 'region', x: location.x, y: location.y, width: location.width, height: location.height,
          regionId: location.regionId, source: 'model-text-region'
        }
      : null;
    risks.push(riskFactory(rulepack, input.route, {
      ruleId: clean(finding.ruleId) || "GG-AI-OBSERVATION",
      detail: clean(finding.finding),
      severity,
      category: clean(finding.category) || "AI 辅助观察",
      title: clean(finding.title),
      finding: clean(finding.finding),
      whyItMatters: clean(finding.whyItMatters) || "该观察需要结合确定性规则和人工判断。",
      action: clean(finding.action) || "人工复核后决定是否修改。",
      sourceIds,
      location: safeRegion,
      evidenceRegionId: safeRegion && finding.evidenceRegionId === safeRegion.regionId ? safeRegion.regionId : null,
      requiresHumanReview: true,
      origin: "model-router"
    }));
  }
}

export function analyzeProduct(input, rulepack) {
  const route = input.route;
  if (!rulepack.routes[route]) {
    throw new Error(`Unsupported route: ${route}`);
  }

  const risks = [];
  const fixes = [];
  if (route === "US_GOOGLE") analyzeUsGoogle(input, rulepack, risks, fixes);
  if (route === "CN_ADS") analyzeCnAds(input, rulepack, risks, fixes);
  if (route === "EU_GPSR") analyzeEuGpsr(input, rulepack, risks, fixes);
  addValidatedAiFindings(input, rulepack, risks);

  if (input.requiresVisualReview === true) {
    risks.push(riskFactory(rulepack, route, {
      ruleId: "GG-VERIFY-IMAGE-001",
      severity: "info",
      category: "检测覆盖范围",
      title: "图片语义与修复质量尚需复核",
      finding: "尺寸和边缘检查不能确认残留叠字、徽章、水印或商品主体是否受损；旧标记清空不代表图片已无风险。",
      whyItMatters: "这是系统验证能力的边界，不是新增平台规则，也不是已判定的违规。",
      action: "检查实际输出图中的文字、装饰和商品完整性；有模型辅助观察时也保留人工确认。",
      sourceIds: [],
      requiresHumanReview: true,
      origin: "verification-gate"
    }));
  }

  const dedupedRisks = [...new Map(risks.map((risk) => [`${risk.ruleId}:${risk.finding}`, risk])).values()];
  const dedupedFixes = [...new Map(fixes.map((fix) => [fix.id, fix])).values()];
  const score = Math.max(0, 100 - dedupedRisks.reduce((sum, risk) => sum + SEVERITY_WEIGHT[risk.severity], 0));
  const blockerCount = dedupedRisks.filter((risk) => risk.severity === "blocker").length;
  const reviewCount = dedupedRisks.filter((risk) => risk.requiresHumanReview).length;
  const evidenceCount = unique(dedupedRisks.flatMap((risk) => risk.evidence.map((source) => source.url))).length;
  const status = blockerCount > 0 ? "blocked" : reviewCount > 0 ? "review" : "ready";

  return {
    analysisId: crypto.randomUUID(),
    analyzedAt: new Date().toISOString(),
    route,
    routeLabel: rulepack.routes[route].label,
    rulepack: {
      id: rulepack.id,
      version: rulepack.version,
      effectiveDate: rulepack.effectiveDate,
      disclaimer: rulepack.disclaimer
    },
    summary: {
      score,
      status,
      totalRisks: dedupedRisks.length,
      blockerCount,
      reviewCount,
      evidenceCount
    },
    risks: dedupedRisks,
    fixes: dedupedFixes,
    audit: {
      productTitle: clean(input.productTitle) || "未命名商品",
      category: clean(input.category) || "home-storage",
      image: input.image || null,
      mode: input.mode || "local",
      fingerprintVersion: 7,
      observationPolicy: input.observationPolicy || null,
      ocrStatus: input.ocrStatus || null,
      textRegions: Array.isArray(input.textRegions) ? input.textRegions : [],
      cnClaimFacts: Array.isArray(input.cnClaimFacts) ? input.cnClaimFacts : [],
      euFieldFacts: Array.isArray(input.euFieldFacts) ? input.euFieldFacts : [],
      offerEvidence: input.offerEvidence && typeof input.offerEvidence === 'object' ? {
        sourceRef: clean(input.offerEvidence.sourceRef) || null,
        excerptSha256: typeof input.offerEvidence.excerpt === 'string' && input.offerEvidence.excerpt
          ? crypto.createHash("sha256").update(input.offerEvidence.excerpt).digest("hex") : null,
        excerptLength: typeof input.offerEvidence.excerpt === 'string' ? input.offerEvidence.excerpt.length : 0
      } : null,
      imageInputSha256: input.imageDataUrl ? crypto.createHash("sha256").update(input.imageDataUrl).digest("hex") : null,
      imageHashEncoding: "SHA-256 of the submitted image data URL (UTF-8)",
      declaredParentAnalysisId: clean(input.previousAnalysisId) || null,
      visualVerification: input.requiresVisualReview ? "human-review-pending" : "rule-inputs-only",
      inputFingerprint: crypto
        .createHash("sha256")
        .update(JSON.stringify({
          route,
          title: input.productTitle,
          copy: input.productCopy,
          image: input.image,
          imageDataUrl: input.imageDataUrl,
          signals: input.visualSignals,
          offerFields: input.offerFields,
          offerEvidence: input.offerEvidence,
          claimEvidenceUrl: input.claimEvidenceUrl,
          aiLabelDeclared: input.aiLabelDeclared,
          ocrText: input.ocrText,
          ocrStatus: input.ocrStatus,
          textRegions: input.textRegions,
          cnClaimFacts: input.cnClaimFacts,
          euFieldFacts: input.euFieldFacts,
          aiFindings: input.aiFindings,
          observationPolicy: input.observationPolicy || null,
          requiresVisualReview: input.requiresVisualReview,
          mode: input.mode,
          rulepack: `${rulepack.id}@${rulepack.version}`
        }))
        .digest("hex")
        .slice(0, 16)
    }
  };
}

export const internals = { EU_COUNTRIES, SEVERITY_WEIGHT };
