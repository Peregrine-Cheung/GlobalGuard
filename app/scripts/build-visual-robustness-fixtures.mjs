import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) throw new Error('USE_WRITE_OR_CHECK');

const dataDir = fileURLToPath(new URL('../fixtures/visual-robustness-v1/', import.meta.url));
const assetDir = fileURLToPath(new URL('../public/robustness-fixtures/', import.meta.url));
const sha256 = value => createHash('sha256').update(value).digest('hex');
const round = value => Number(value.toFixed(4));
const box = (x, y, width, height) => [x, y, width, height].map(value => round(value / 720));

const cases = [
  {
    id: 'robustness-01', challenge: 'small-readable-product-code',
    truth: { ocrStatus: 'readable_text', ocrText: 'LOT A17', textRegions: [{ id: 'text-1', text: 'LOT A17', origin: 'product', readability: 'readable', bbox: box(294, 407, 132, 24) }], visualFacts: [] },
    draw: '<text x="360" y="426" text-anchor="middle" font-family="Arial,sans-serif" font-size="17" font-weight="700" fill="#27343b">LOT A17</text>'
  },
  {
    id: 'robustness-02', challenge: 'tiny-low-contrast-unreadable-strokes',
    truth: { ocrStatus: 'unreadable_text_seen', ocrText: 'NONE', textRegions: [{ id: 'text-1', text: null, origin: 'product', readability: 'unreadable', bbox: box(302, 421, 116, 12) }], visualFacts: [{ kind: 'low_clarity', textOrigin: 'not_applicable', regionId: null }] },
    draw: '<g fill="#617079" opacity="0.27"><rect x="302" y="421" width="9" height="9"/><rect x="316" y="424" width="4" height="7"/><rect x="326" y="420" width="6" height="11"/><rect x="338" y="423" width="8" height="8"/><rect x="352" y="421" width="3" height="10"/><rect x="362" y="424" width="7" height="7"/><rect x="376" y="420" width="5" height="11"/><rect x="388" y="423" width="9" height="8"/><rect x="403" y="421" width="5" height="10"/><rect x="414" y="424" width="4" height="7"/></g>'
  },
  {
    id: 'robustness-03', challenge: 'rotated-scene-price-tag',
    truth: { ocrStatus: 'readable_text', ocrText: '$24.50\nCLEARANCE', textRegions: [{ id: 'text-1', text: '$24.50', origin: 'scene', readability: 'readable', bbox: box(532, 480, 138, 52) }, { id: 'text-2', text: 'CLEARANCE', origin: 'scene', readability: 'readable', bbox: box(540, 526, 126, 22) }], visualFacts: [{ kind: 'price_text', textOrigin: 'scene', regionId: 'text-1' }] },
    draw: '<g transform="rotate(-13 602 512)"><rect x="526" y="461" width="152" height="101" rx="8" fill="#fff1a8" stroke="#645623" stroke-width="3"/><text x="602" y="516" text-anchor="middle" font-family="Arial,sans-serif" font-size="31" font-weight="800" fill="#292929">$24.50</text><text x="602" y="542" text-anchor="middle" font-family="Arial,sans-serif" font-size="13" font-weight="700" fill="#3d3d3d">CLEARANCE</text></g>'
  },
  {
    id: 'robustness-04', challenge: 'blurred-unreadable-product-label',
    truth: { ocrStatus: 'unreadable_text_seen', ocrText: 'NONE', textRegions: [{ id: 'text-1', text: null, origin: 'product', readability: 'unreadable', bbox: box(270, 360, 180, 43) }], visualFacts: [{ kind: 'low_clarity', textOrigin: 'not_applicable', regionId: null }] },
    defs: '<filter id="blur"><feGaussianBlur stdDeviation="4.2"/></filter>',
    draw: '<g filter="url(#blur)" opacity="0.72"><rect x="270" y="360" width="180" height="43" rx="4" fill="#efe9dc"/><text x="360" y="391" text-anchor="middle" font-family="Arial,sans-serif" font-size="27" font-weight="800" fill="#253238">FRAGILE</text></g>'
  },
  {
    id: 'robustness-05', challenge: 'spaced-promotional-words',
    truth: { ocrStatus: 'readable_text', ocrText: 'SALE\n50%\nOFF', textRegions: [{ id: 'text-1', text: 'SALE', origin: 'overlay', readability: 'readable', bbox: box(78, 60, 143, 58) }, { id: 'text-2', text: '50%', origin: 'overlay', readability: 'readable', bbox: box(294, 60, 132, 58) }, { id: 'text-3', text: 'OFF', origin: 'overlay', readability: 'readable', bbox: box(510, 60, 118, 58) }], visualFacts: [{ kind: 'promotional_overlay', textOrigin: 'overlay', regionId: 'text-1' }, { kind: 'promotional_overlay', textOrigin: 'overlay', regionId: 'text-2' }, { kind: 'promotional_overlay', textOrigin: 'overlay', regionId: 'text-3' }] },
    draw: '<rect x="45" y="38" width="630" height="104" rx="12" fill="#ce4338"/><g fill="#fff" font-family="Arial,sans-serif" font-size="49" font-weight="800" text-anchor="middle"><text x="150" y="105">SALE</text><text x="360" y="105">50%</text><text x="570" y="105">OFF</text></g>'
  },
  {
    id: 'robustness-06', challenge: 'low-contrast-readable-label',
    truth: { ocrStatus: 'readable_text', ocrText: 'ECO HOME', textRegions: [{ id: 'text-1', text: 'ECO HOME', origin: 'product', readability: 'readable', bbox: box(255, 355, 210, 42) }], visualFacts: [] },
    draw: '<rect x="248" y="345" width="224" height="61" rx="6" fill="#b6c7bf" opacity="0.88"/><text x="360" y="386" text-anchor="middle" font-family="Arial,sans-serif" font-size="29" font-weight="700" fill="#82958c">ECO HOME</text>'
  },
  {
    id: 'robustness-07', challenge: 'partially-occluded-unreadable-label',
    truth: { ocrStatus: 'unreadable_text_seen', ocrText: 'NONE', textRegions: [{ id: 'text-1', text: null, origin: 'product', readability: 'unreadable', bbox: box(253, 356, 214, 47) }], visualFacts: [] },
    draw: '<rect x="250" y="347" width="220" height="64" rx="5" fill="#eee5d3"/><text x="360" y="390" text-anchor="middle" font-family="Arial,sans-serif" font-size="31" font-weight="800" fill="#29363d">PREMIUM</text><path d="M320 338 L392 418 L358 437 L286 357 Z" fill="#31434c" opacity="0.96"/>'
  },
  {
    id: 'robustness-08', challenge: 'vertical-rotated-scene-text',
    truth: { ocrStatus: 'readable_text', ocrText: 'HANDLE WITH CARE', textRegions: [{ id: 'text-1', text: 'HANDLE WITH CARE', origin: 'scene', readability: 'readable', bbox: box(557, 255, 43, 238) }], visualFacts: [] },
    draw: '<g transform="rotate(90 579 374)"><rect x="460" y="351" width="238" height="46" rx="5" fill="#faf5e7" stroke="#6b5e43" stroke-width="2"/><text x="579" y="382" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="700" fill="#38342b">HANDLE WITH CARE</text></g>'
  },
  {
    id: 'robustness-09', challenge: 'diagonal-watermark',
    truth: { ocrStatus: 'readable_text', ocrText: 'SAMPLE', textRegions: [{ id: 'text-1', text: 'SAMPLE', origin: 'overlay', readability: 'readable', bbox: box(188, 285, 344, 154) }], visualFacts: [{ kind: 'watermark', textOrigin: 'overlay', regionId: 'text-1' }] },
    draw: '<g transform="rotate(-24 360 362)" opacity="0.48"><text x="360" y="389" text-anchor="middle" font-family="Arial,sans-serif" font-size="82" font-weight="900" fill="#b63434" stroke="#fff" stroke-width="2">SAMPLE</text></g>'
  },
  {
    id: 'robustness-10', challenge: 'no-text-multiple-object-control',
    truth: { ocrStatus: 'no_text_seen', ocrText: 'NONE', textRegions: [], visualFacts: [{ kind: 'multiple_products', textOrigin: 'not_applicable', regionId: null }] },
    extra: '<path d="M78 320 L238 320 L221 510 Q158 532 95 510 Z" fill="#b98b3f" stroke="#20313a" stroke-width="6"/><path d="M482 320 L642 320 L625 510 Q562 532 499 510 Z" fill="#825c9d" stroke="#20313a" stroke-width="6"/>',
    draw: ''
  }
];

function renderSvg(item, index) {
  const colors = ['#397a70', '#596f7a', '#bc6d35', '#507a8a', '#b54d3f', '#648274', '#805f45', '#3f6e9b', '#6f658f', '#4e7868'];
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720" role="img" aria-label="视觉鲁棒性评测 ${item.id}" data-fixture-id="${item.id}">
  <defs>${item.defs || ''}</defs>
  <rect width="720" height="720" fill="#f4f0e8"/>
  <rect x="82" y="156" width="556" height="416" rx="34" fill="#fff" stroke="#d4cdc1" stroke-width="4"/>
  <ellipse cx="360" cy="539" rx="222" ry="31" fill="#aaa59d" opacity="0.33"/>
  ${item.extra || `<path d="M190 274 L530 274 L491 502 Q360 540 229 502 Z" fill="${colors[index]}" stroke="#20313a" stroke-width="7"/><path d="M250 274 Q360 214 470 274" fill="none" stroke="#20313a" stroke-width="18" stroke-linecap="round"/><path d="M215 310 H505 M225 350 H495 M235 440 H485" stroke="#fff" stroke-opacity="0.25" stroke-width="6"/>`}
  ${item.draw}
</svg>
`;
}

const rendered = cases.map((item, index) => {
  const svg = renderSvg(item, index);
  return { item, svg, record: {
    id: item.id, challenge: item.challenge, filename: `${item.id}.svg`,
    assetPath: `/robustness-fixtures/${item.id}.svg`, dimensions: { width: 720, height: 720 },
    sha256: sha256(svg), sourceKind: 'deterministic-synthetic-svg', generated: true,
    merchantEvidence: false, labelStatus: 'synthetic-construction-truth-not-human-gold',
    labelsDerivedFrom: 'fixture-construction-spec', constructionTruth: item.truth
  } };
});

const datasetId = 'globalguard-visual-robustness-v1';
const truth = `${JSON.stringify({
  schemaVersion: '1.0', datasetId, createdOn: '2026-09-11',
  coordinateSystem: 'normalized_xywh_top_left',
  samplingPlan: { cases: 10, neutralBlindReviewRequired: true, providerRequestsPlanned: 10, retryDisabled: true, fallbackDisabled: true },
  notice: '确定性鲁棒性挑战集的构造真值，不是人工金标准、模型准确率或真实商家数据。',
  cases: rendered.map(({ record }) => record)
}, null, 2)}\n`;
const blank = `${JSON.stringify({
  schemaVersion: '1.0', datasetId, annotationStatus: 'blank-human-review-template',
  instructions: '标注者只查看SVG，不查看任何答案文件或模型结果；完成后填写annotator、reviewedAt和每个humanLabel。',
  annotator: null, reviewedAt: null,
  cases: cases.map(({ id }) => ({ id, humanLabel: { ocrStatus: null, ocrText: null, textRegions: [], visualFacts: [], notes: '' } }))
}, null, 2)}\n`;

const outputs = [
  ...rendered.map(({ item, svg }) => [assetDir, `${item.id}.svg`, svg]),
  [dataDir, 'construction-truth.json', truth],
  [dataDir, 'human-annotations.blank.json', blank]
];

if (mode === '--write') {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(assetDir, { recursive: true });
  for (const [directory, filename, content] of outputs) await fs.writeFile(path.join(directory, filename), content, 'utf8');
  console.log(JSON.stringify({ datasetId, written: outputs.map(([, filename]) => filename), cases: cases.length }, null, 2));
} else {
  const mismatches = [];
  for (const [directory, filename, expected] of outputs) {
    let actual = null;
    try { actual = await fs.readFile(path.join(directory, filename), 'utf8'); } catch {}
    if (actual !== expected) mismatches.push(filename);
  }
  console.log(JSON.stringify({ datasetId, checked: outputs.length, cases: cases.length, mismatches }, null, 2));
  if (mismatches.length) process.exitCode = 1;
}
