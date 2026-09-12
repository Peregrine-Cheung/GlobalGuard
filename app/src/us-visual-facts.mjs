// Human-written rule interpretations, checked against Google image_link on
// 2026-09-04. Model observations remain uncertain; no platform approval is issued.
export const US_VISUAL_POLICY_VERSION = 'us-visual-facts-v7';
export const US_VISUAL_RULES = {
  promotional_overlay: { title: '疑似后加促销内容，需确认', severity: 'high', basis: 'minimum-requirement', why: '主图要求限制促销内容；需确认这些字样是促销叠加，而不是商品固有文字。', action: '核对文字所在位置及用途，保留商品本体；仅对确认的后加内容制作修复草稿。' },
  watermark: { title: '疑似水印或叠加标识，需确认', severity: 'high', basis: 'minimum-requirement', why: '主图要求限制水印等叠加内容，商品本身固有标识需要区别判断。', action: '核对原始文件和标识归属；不自动擦除商品本体品牌、印花或标签。' },
  decorative_border: { title: '疑似图片外加边框，需确认', severity: 'medium', basis: 'minimum-requirement', why: '图片外加边框受主图规则限制；商品篮沿、盒沿和场景边缘不是同一概念。', action: '确认框线确为后加装饰后再裁切，先保护主体完整性。' },
  price_text: { title: '图片含价格文字，需确认是否适合主图', severity: 'high', basis: 'minimum-requirement', why: '主图要求限制价格信息；实物价签与后加叠字应区分记录，但实物价签不自动免除图片适用性核查。', action: '核实价签归属；优先重新拍摄明确售卖的商品，不把旧价签抄成当前售价。' },
  occluded_product: { title: '商品有遮挡，需核对主体和配件', severity: 'medium', basis: 'best-practice', why: '清晰展示售卖主体是主图最佳实践；被遮挡不自动等于违规，也不能推测看不见的结构。', action: '确认遮挡物是否包含在售卖范围；需要时补拍，不自动生成未知主体细节。' },
  multiple_products: { title: '出现多件物品，需确认售卖范围', severity: 'medium', basis: 'best-practice', why: '主图最佳实践关注实际售卖的商品及随附物；不能仅凭多件陈列断言违规或认定为套装。', action: '请卖家确认单件、套装或配件范围，必要时重新选择主图。' },
  low_clarity: { title: '局部细节难以辨认，需确认清晰度', severity: 'medium', basis: 'best-practice', why: '主体清晰度与像素尺寸不同；尺寸由程序检查，模型不据视觉猜测分辨率。', action: '对照原始大图或补拍，不能仅靠放大文件声明清晰度已改善。' }
};
export function usVisualInstructions() {
  return [
    '你只做图片可见事实观察，不做平台裁定。不得编写规则ID、来源ID、风险标题、法律解释或处理建议。',
    'findings可为空；只报告明确可见、值得人工核查的现象，不为凑条数输出问题。',
    '禁止推测照片来自AI、CGI、渲染或相机；白底、规则几何、均匀光照都不是来源证据。不要讨论生成来源或摄影真伪。',
    '不要输出像素尺寸、未来尺寸标准或日期风险；尺寸由程序测量和规则引擎处理。',
    '不要输出禁止实体店拍摄、强制纯白背景等平台结论。只描述物体、文字、遮挡与画面细节。',
    'OCR保留商品实体压印、衣物印花、标签和价签；无法辨认的字不猜测。NONE仅表示未读到清晰文字，不保证没有文字。',
    'ocrStatus只能是readable_text、unreadable_text_seen或no_text_seen。读到可可靠转写的文字时用readable_text并在ocrText原样填写；明确看见文字但无法可靠转写时用unreadable_text_seen并将ocrText写为NONE；本次没有看见文字迹象时才用no_text_seen并将ocrText写为NONE。',
    'ocrStatus为no_text_seen时，visualObservation只描述非文字事实，不要再写可见字符、标签、价签、水印、Logo、品牌或其它文字迹象。',
    'no_text_seen时不要在visualObservation中写“未见文字”“无标签”“没有Logo”等否定语句；只描述物体、颜色、背景和构图。此时findings若非空，只能是非文字观察，textOrigin必须为not_applicable且regionId必须为null。',
    '若看见成行排列的字符状笔画、矩形笔画或疑似标签文字痕迹，但任何内容都无法可靠逐字转写，必须使用unreadable_text_seen并建立readability=unreadable的区域；不得因为读不出内容就写no_text_seen。若文字区域本身明显模糊、低对比或细节无法辨认，可另报一条low_clarity并明确描述为局部现象；不要把局部问题说成整图低清晰度。',
    'textRegions最多8项，必须覆盖本次看见的文字区域，并按从上到下、同一行从左到右排序。每项使用唯一id（text-1至text-8）、原点在左上的归一化xywh坐标bbox（四个0到1的小数）、origin和readability。可读区域原样填写text；不可可靠转写的区域将text写为null，禁止猜字；不得用不同id重复同一bbox。',
    'readable_text至少包含一个readability=readable的区域；unreadable_text_seen至少包含一个区域且全部为unreadable；no_text_seen时textRegions必须为空。ocrText必须严格等于按textRegions顺序把所有readable区域的text用换行符连接后的结果，不得增加、遗漏、改写或改变顺序；没有可读区域时必须为NONE。',
    '文字分框按空间连续性，而不是只按语义短语：同一横幅中若多个词之间存在明显大空隙，应分别建立区域并在ocrText中用换行连接，例如相互分开的SALE、50%、OFF应为三个区域；货币符号与紧邻数字（如$24.50）仍是一个连续区域。每个文字类finding分别引用实际对应的regionId。',
    '区分 textOrigin：overlay=图片后加叠层；product=商品本体或实体包装文字；scene=场景价签等；uncertain=无法确定；not_applicable=非文字观察。',
    '文字类finding必须用regionId引用对应textRegions.id，且textOrigin与区域origin一致。promotional_overlay、watermark、price_text是文字类finding；decorative_border、occluded_product、multiple_products、low_clarity是非文字finding，后四类必须固定写textOrigin=not_applicable且regionId=null，即使现象靠近或覆盖某个文字区域也不得绑定该区域。',
    '商品本体压印/印花/品牌标签不因含文字而成为促销叠字或水印；场景价签用price_text，不能误写为后加叠字。',
    '只要标签主体位于商品主体外轮廓之外、呈现独立吊牌或价签形态，就属于scene，即使它贴靠、连接、倾斜或竖直摆在商品旁边；只有文字直接印刷、压印或固定在商品或包装本体表面时才属于product。价签内所有可读小字也必须逐区转写。',
    '若实体色块、贴纸、条带或其它物体明显跨过商品主体或商品标签，报告occluded_product；只能描述可见遮挡，不得猜测被遮住的文字或结构。',
    '若一条明确的promotional_overlay现象包含多个已分别建立的文字区域，必须为每个相关regionId各输出一条promotional_overlay finding；不得只引用第一个区域，也不得用一条finding同时代表多个regionId。普通overlay文字不因位置在图层上就自动等于促销内容。',
    'decorative_border只报告明确独立于中性展示容器、用于装饰整张商品图外缘的额外框线。常见的白色或浅色圆角商品展示卡片、卡片的一圈细灰描边、卡片阴影、商品投影、背景色块、画布边缘和商品自身轮廓，即使包围商品，也绝对不要报告为decorative_border。',
    `允许kind及含义：${JSON.stringify(Object.fromEntries(Object.entries(US_VISUAL_RULES).map(([key, rule]) => [key, rule.title])))}`,
    '描述使用简体中文且仅写可见位置和现象。最多4条，description不超过600字。',
    '只输出JSON：{"ocrStatus":"readable_text|unreadable_text_seen|no_text_seen","ocrText":"原文或NONE","visualObservation":"可见事实，不推测图像生成来源","textRegions":[{"id":"text-1","text":"原文或null","origin":"overlay|product|scene|uncertain","readability":"readable|unreadable","bbox":[0.1,0.2,0.3,0.1]}],"findings":[{"kind":"上述枚举","description":"可见现象及位置","textOrigin":"上述枚举","regionId":"text-1或null"}]}'
  ].join('\n');
}

export function validateUsVisualEnvelope(parsed) {
  const keys = ['ocrStatus', 'ocrText', 'visualObservation', 'textRegions', 'findings'];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
      || Object.keys(parsed).length !== keys.length
      || !keys.every(key => Object.hasOwn(parsed, key))
      || !Array.isArray(parsed.textRegions) || !Array.isArray(parsed.findings)) {
    throw new Error('INVALID_US_VISUAL_TOP_LEVEL');
  }
  return parsed;
}

export function validateUsTextRegions(textRegions) {
  if (!Array.isArray(textRegions) || textRegions.length > 8) throw new Error('INVALID_TEXT_REGIONS');
  const origins = ['overlay', 'product', 'scene', 'uncertain'];
  const readabilities = ['readable', 'unreadable'];
  const ids = new Set();
  const boxes = new Set();
  return textRegions.map((region) => {
    if (!exactKeys(region, ['id', 'text', 'origin', 'readability', 'bbox'])
      || typeof region.id !== 'string' || !/^text-[1-8]$/.test(region.id) || ids.has(region.id)
      || !origins.includes(region.origin) || !readabilities.includes(region.readability)
      || !Array.isArray(region.bbox) || region.bbox.length !== 4
      || region.bbox.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
      || region.bbox[2] <= 0 || region.bbox[3] <= 0
      || region.bbox[0] + region.bbox[2] > 1.000001 || region.bbox[1] + region.bbox[3] > 1.000001) {
      throw new Error('INVALID_TEXT_REGION');
    }
    const boxIdentity = region.bbox.map(value => Number(value).toFixed(6)).join(':');
    if (boxes.has(boxIdentity)) throw new Error('DUPLICATE_TEXT_REGION_BOX');
    const readableText = typeof region.text === 'string' ? region.text.trim() : '';
    if (region.readability === 'readable' && (!readableText || /^NONE$/i.test(readableText) || readableText.length > 200)) {
      throw new Error('TEXT_REGION_READABILITY_CONFLICT');
    }
    if (region.readability === 'unreadable' && region.text !== null) throw new Error('TEXT_REGION_READABILITY_CONFLICT');
    ids.add(region.id);
    boxes.add(boxIdentity);
    return {
      id: region.id,
      text: region.readability === 'readable' ? readableText : null,
      origin: region.origin,
      readability: region.readability,
      bbox: region.bbox.map((value) => Number(value.toFixed(6)))
    };
  });
}

function comparableText(value) {
  return String(value ?? '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function exactKeys(value, keys) {
  const allowed = new Set(keys);
  return value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === keys.length
    && Object.keys(value).every(key => allowed.has(key))
    && keys.every(key => Object.hasOwn(value, key));
}

export function validateUsOcrObservation({ ocrStatus, ocrText, visualObservation, facts, textRegions }) {
  const statuses = ['readable_text', 'unreadable_text_seen', 'no_text_seen'];
  if (!statuses.includes(ocrStatus)) throw new Error('INVALID_OCR_STATUS');
  if (typeof ocrText !== 'string' || ocrText.length > 2000
      || typeof visualObservation !== 'string' || !visualObservation.trim() || visualObservation.length > 1200) {
    throw new Error('INVALID_OCR_OBSERVATION');
  }
  const normalizedText = ocrText.trim();
  const hasReadableText = Boolean(normalizedText) && !/^NONE$/i.test(normalizedText);
  if (ocrStatus === 'readable_text' && !hasReadableText) throw new Error('OCR_STATUS_TEXT_CONFLICT');
  if (ocrStatus !== 'readable_text' && hasReadableText) throw new Error('OCR_STATUS_TEXT_CONFLICT');
  const normalizedRegions = validateUsTextRegions(textRegions);
  const readableRegions = normalizedRegions.filter((region) => region.readability === 'readable');
  const expectedOcrText = readableRegions.map(region => region.text).join('\n');
  if (ocrStatus === 'readable_text' && (!readableRegions.length
    || normalizedText !== expectedOcrText)) {
    throw new Error('OCR_STATUS_REGION_CONFLICT');
  }
  if (ocrStatus === 'unreadable_text_seen'
    && (!normalizedRegions.length || readableRegions.length)) throw new Error('OCR_STATUS_REGION_CONFLICT');
  if (ocrStatus === 'no_text_seen' && normalizedRegions.length) throw new Error('OCR_STATUS_REGION_CONFLICT');

  if (ocrStatus === 'no_text_seen') {
    const textOriginFact = Array.isArray(facts) && facts.some((fact) =>
      fact && typeof fact === 'object' && fact.textOrigin && fact.textOrigin !== 'not_applicable');
    if (textOriginFact) throw new Error('OCR_STATUS_FACT_CONFLICT');
    const textSignal = /(文字|字符|字样|文本|标签|价签|水印|logo|标识|品牌)|(text|letters?|characters?|label|price\s*tag|watermark|logo|brand(?:ing)?)/i;
    if (textSignal.test(visualObservation)) throw new Error('OCR_STATUS_OBSERVATION_CONFLICT');
  }

  return {
    ocrStatus,
    ocrText: hasReadableText ? normalizedText : 'NONE',
    visualObservation: visualObservation.trim(),
    textRegions: normalizedRegions
  };
}

export function mapUsVisualFacts(facts, textRegions = []) {
  if (!Array.isArray(facts) || facts.length > 4) throw new Error('FACTS_MUST_BE_CAPPED_ARRAY');
  const origins = ['overlay', 'product', 'scene', 'uncertain', 'not_applicable'];
  const regionsById = new Map(validateUsTextRegions(textRegions).map((region) => [region.id, region]));
  return facts.map(fact => {
    if (!exactKeys(fact, ['kind', 'description', 'textOrigin', 'regionId'])
      || !Object.hasOwn(US_VISUAL_RULES, fact.kind)
      || typeof fact.description !== 'string' || !fact.description.trim() || fact.description.length > 600
      || !origins.includes(fact.textOrigin)
    ) throw new Error('INVALID_VISUAL_FACT');
    const regionId = fact.regionId ?? null;
    if (['decorative_border', 'occluded_product', 'multiple_products', 'low_clarity'].includes(fact.kind)
      && (fact.textOrigin !== 'not_applicable' || regionId !== null)) {
      throw new Error('NON_TEXT_FACT_BINDING_CONFLICT');
    }
    if (['promotional_overlay', 'watermark'].includes(fact.kind) && !['overlay', 'uncertain'].includes(fact.textOrigin)) throw new Error('TEXT_ORIGIN_CONFLICT');
    if (fact.kind === 'price_text' && fact.textOrigin === 'not_applicable') throw new Error('PRICE_ORIGIN_MISSING');
    if (regionId !== null && typeof regionId !== 'string') throw new Error('INVALID_TEXT_REGION_REFERENCE');
    if (fact.textOrigin === 'not_applicable' && regionId !== null) throw new Error('TEXT_REGION_REFERENCE_CONFLICT');
    if (fact.textOrigin !== 'not_applicable' && regionId === null) throw new Error('TEXT_REGION_REFERENCE_MISSING');
    const region = regionId === null ? null : regionsById.get(regionId);
    if (regionId !== null && !region) throw new Error('UNKNOWN_TEXT_REGION_REFERENCE');
    if (region && region.origin !== fact.textOrigin) throw new Error('TEXT_REGION_ORIGIN_CONFLICT');
    const rule = US_VISUAL_RULES[fact.kind];
    const originLabel = { overlay: '后加叠层', product: '商品/包装实体', scene: '场景实体', uncertain: '归属未确定', not_applicable: '非文字' }[fact.textOrigin];
    return {
      ruleId: `GG-US-VISUAL-${fact.kind.toUpperCase().replaceAll('_', '-')}`,
      severity: rule.severity, category: '可见事实待复核', title: rule.title,
      finding: `模型观察（${originLabel}）：${fact.description.trim()}`,
      whyItMatters: `${rule.basis === 'minimum-requirement' ? '最低要求相关核查' : '最佳实践核查，不是自动违规裁定'}：${rule.why}`,
      action: rule.action, sourceIds: ['google_image_link'],
      ...(region ? {
        evidenceRegionId: region.id,
        location: {
          type: 'region',
          x: Number((region.bbox[0] * 100).toFixed(4)),
          y: Number((region.bbox[1] * 100).toFixed(4)),
          width: Number((region.bbox[2] * 100).toFixed(4)),
          height: Number((region.bbox[3] * 100).toFixed(4)),
          regionId: region.id,
          source: 'model-text-region'
        }
      } : {})
    };
  });
}
