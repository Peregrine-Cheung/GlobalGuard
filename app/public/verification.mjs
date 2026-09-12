// A pixel heuristic cannot certify the absence of text, logos or image damage.
export function signalsForRecheck(previous, { hasBorder, imageChanged, preserveVisualContent = false }) {
  return {
    ...previous,
    hasBorder: preserveVisualContent ? Boolean(previous.hasBorder) : Boolean(hasBorder),
    borderMethod: preserveVisualContent ? (previous.borderMethod || 'preserved-source-signal') : 'edge-color-heuristic-v1',
    overlayText: imageChanged && !preserveVisualContent ? '' : (previous.overlayText || ''),
    hasPromotionalOverlay: imageChanged && !preserveVisualContent ? null : previous.hasPromotionalOverlay,
    unverifiedPreviousOverlayText: previous.overlayText || '',
    semanticVerification: preserveVisualContent ? 'source-content-preserved' : 'pending',
    // Re-encoding through canvas does not preserve original embedded metadata.
    hasSyntheticMetadata: false,
    sampleLayout: ''
  };
}

export function recheckPresentation(summary) {
  if (summary.status === 'blocked') return {
    passed: false, className: 'fail', label: '未通过',
    headline: `复检仍有 ${summary.blockerCount} 个阻断项`,
    message: '复检仍有阻断，不能标记为通过'
  };
  if (summary.status === 'review' || summary.reviewCount > 0) return {
    passed: false, className: 'review', label: '待人工复核',
    headline: `没有已识别的硬阻断，仍有 ${summary.reviewCount} 项待复核`,
    message: '复检已运行，但人工复核项尚未关闭'
  };
  return {
    passed: true, className: '', label: '规则检查通过',
    headline: '本次规则检查通过（非平台批准）',
    message: '规则复检完成，请保留最终业务确认'
  };
}
export function ocrPresentation(text, status = null) {
  const value = String(text ?? '').trim();
  if (status === 'unreadable_text_seen') return '看见文字或字符，但无法可靠转写（需人工放大核对）';
  if (status === 'no_text_seen') return '本次未看见文字迹象（不代表图片没有文字）';
  if (status === 'readable_text') return value && !/^NONE$/i.test(value)
    ? value
    : '文字识别状态异常，需人工复核';
  return !value || /^NONE$/i.test(value) ? '未读出清晰文字（不代表图片没有文字）' : value;
}

export function textRegionPresentations(regions) {
  if (!Array.isArray(regions)) return [];
  const originLabels = { overlay: '后加叠层', product: '商品/包装', scene: '场景实体', uncertain: '归属待确认' };
  return regions.slice(0, 8).flatMap((region) => {
    const bbox = Array.isArray(region?.bbox) ? region.bbox.map(Number) : [];
    if (!/^text-[1-8]$/.test(region?.id || '') || bbox.length !== 4
      || bbox.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
      || bbox[2] <= 0 || bbox[3] <= 0 || bbox[0] + bbox[2] > 1.000001 || bbox[1] + bbox[3] > 1.000001
      || !Object.hasOwn(originLabels, region.origin)
      || !['readable', 'unreadable'].includes(region.readability)) return [];
    const readableText = region.readability === 'readable' ? String(region.text || '').trim() : '';
    if (region.readability === 'readable' && !readableText) return [];
    return [{
      id: region.id,
      label: `${originLabels[region.origin]} · ${readableText || '文字未读清'}`,
      x: bbox[0] * 100,
      y: bbox[1] * 100,
      width: bbox[2] * 100,
      height: bbox[3] * 100
    }];
  });
}

export function containFitRect(containerWidth, containerHeight, imageWidth, imageHeight) {
  const values = [containerWidth, containerHeight, imageWidth, imageHeight].map(Number);
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const [outerWidth, outerHeight, sourceWidth, sourceHeight] = values;
  const scale = Math.min(outerWidth / sourceWidth, outerHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return { left: (outerWidth - width) / 2, top: (outerHeight - height) / 2, width, height };
}

function boxIsContained(inner, outer, epsilon = 0.000001) {
  return inner.x + epsilon >= outer.x
    && inner.y + epsilon >= outer.y
    && inner.x + inner.width <= outer.x + outer.width + epsilon
    && inner.y + inner.height <= outer.y + outer.height + epsilon;
}

export function buildUsRepairProtectionPlan({ textRegions, risks, fixes, cropRect, operation = 'proposed-repair' } = {}) {
  const crop = cropRect || { x: 0, y: 0, width: 1, height: 1 };
  const validCrop = [crop.x, crop.y, crop.width, crop.height].every(Number.isFinite)
    && crop.x >= 0 && crop.y >= 0 && crop.width > 0 && crop.height > 0
    && crop.x + crop.width <= 1.000001 && crop.y + crop.height <= 1.000001;
  if (!validCrop) throw new TypeError('Invalid normalized crop rectangle');

  const presentations = new Map(textRegionPresentations(textRegions).map(region => [region.id, region]));
  const linkedPromotionalIds = new Set((Array.isArray(risks) ? risks : [])
    .filter(risk => ['GG-US-IMG-004', 'GG-US-VISUAL-PROMOTIONAL-OVERLAY'].includes(risk?.ruleId))
    .map(risk => risk?.location?.regionId || risk?.evidenceRegionId)
    .filter(Boolean));
  const regions = (Array.isArray(textRegions) ? textRegions : []).flatMap(region => {
    const display = presentations.get(region?.id);
    if (!display) return [];
    const item = {
      id: display.id,
      origin: region.origin,
      label: display.label,
      x: display.x,
      y: display.y,
      width: display.width,
      height: display.height,
      affectedByCrop: !boxIsContained({
        x: display.x / 100, y: display.y / 100,
        width: display.width / 100, height: display.height / 100
      }, crop)
    };
    return [item];
  });
  const fixIds = new Set((Array.isArray(fixes) ? fixes : []).map(fix => fix?.id));
  const hasRemovalIntent = fixIds.has('fix-remove-overlay') || fixIds.has('fix-trim-border');
  const removalCandidates = hasRemovalIntent
    ? regions.filter(region => region.origin === 'overlay' && linkedPromotionalIds.has(region.id))
    : [];
  const candidateIds = new Set(removalCandidates.map(region => region.id));
  const protectedRegions = regions.filter(region => !candidateIds.has(region.id));
  const blockedRegions = protectedRegions.filter(region => region.affectedByCrop);

  return {
    version: 'us-repair-protection-v1',
    operation,
    cropRect: { ...crop },
    coverage: regions.length ? 'model-regions-present' : 'model-regions-missing',
    protectedRegions,
    removalCandidates,
    blockedRegions,
    hasRemovalIntent,
    requiresConfirmation: true,
    canApply: blockedRegions.length === 0
  };
}
