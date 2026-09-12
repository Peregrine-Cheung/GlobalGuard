import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
if (!['--write', '--check'].includes(mode) || process.argv.length !== 3) {
  throw new Error('USE_WRITE_OR_CHECK');
}

const dataDir = fileURLToPath(new URL('../fixtures/visual-eval-v1/', import.meta.url));
const assetDir = fileURLToPath(new URL('../public/visual-fixtures/', import.meta.url));
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const round = (value) => Number(value.toFixed(4));
const box = (x, y, width, height) => [x, y, width, height].map((value) => round(value / 720));
const escapeXml = (value) => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

const cases = [
  {
    id: 'fixture-01', challenge: 'no-text', accent: '#2f7d6d',
    constructionTruth: { ocrStatus: 'no_text_seen', ocrText: 'NONE', textRegions: [], visualFacts: [] },
    draw: () => ''
  },
  {
    id: 'fixture-02', challenge: 'tiny-readable', accent: '#3569d4',
    constructionTruth: {
      ocrStatus: 'readable_text', ocrText: 'SKU BX-204',
      textRegions: [{ id: 'text-1', text: 'SKU BX-204', origin: 'product', readability: 'readable', bbox: box(292, 423, 136, 25) }],
      visualFacts: []
    },
    draw: () => '<text x="360" y="441" text-anchor="middle" font-family="Arial,sans-serif" font-size="18" font-weight="700" fill="#20313a">SKU BX-204</text>'
  },
  {
    id: 'fixture-03', challenge: 'tiny-unreadable', accent: '#7c5a9e',
    constructionTruth: {
      ocrStatus: 'unreadable_text_seen', ocrText: 'NONE',
      textRegions: [{ id: 'text-1', text: null, origin: 'product', readability: 'unreadable', bbox: box(300, 427, 120, 14) }],
      visualFacts: []
    },
    draw: () => '<g fill="#5f6670" opacity="0.58"><rect x="300" y="427" width="7" height="12"/><rect x="311" y="430" width="5" height="9"/><rect x="321" y="426" width="3" height="13"/><rect x="329" y="428" width="8" height="11"/><rect x="342" y="431" width="4" height="8"/><rect x="351" y="427" width="6" height="12"/><rect x="362" y="429" width="3" height="10"/><rect x="370" y="426" width="7" height="13"/><rect x="382" y="431" width="4" height="8"/><rect x="391" y="428" width="9" height="11"/><rect x="405" y="430" width="5" height="9"/><rect x="414" y="427" width="6" height="12"/></g>'
  },
  {
    id: 'fixture-04', challenge: 'product-label', accent: '#c66c2f',
    constructionTruth: {
      ocrStatus: 'readable_text', ocrText: 'FLEXIBOX',
      textRegions: [{ id: 'text-1', text: 'FLEXIBOX', origin: 'product', readability: 'readable', bbox: box(242, 340, 236, 66) }],
      visualFacts: []
    },
    draw: () => '<rect x="242" y="340" width="236" height="66" rx="9" fill="#f4eadc" stroke="#9d5526" stroke-width="3"/><text x="360" y="383" text-anchor="middle" font-family="Arial,sans-serif" font-size="34" font-weight="700" fill="#7e421f">FLEXIBOX</text>'
  },
  {
    id: 'fixture-05', challenge: 'scene-price-tag', accent: '#2f7d6d',
    constructionTruth: {
      ocrStatus: 'readable_text', ocrText: '$19.99\nSTORE TAG',
      textRegions: [
        { id: 'text-1', text: '$19.99', origin: 'scene', readability: 'readable', bbox: box(545, 490, 130, 58) },
        { id: 'text-2', text: 'STORE TAG', origin: 'scene', readability: 'readable', bbox: box(562, 532, 86, 20) }
      ],
      visualFacts: [{ kind: 'price_text', textOrigin: 'scene', regionId: 'text-1' }]
    },
    draw: () => '<g transform="rotate(-4 605 514)"><rect x="535" y="470" width="140" height="88" rx="6" fill="#fff7d6" stroke="#6e5d29" stroke-width="3"/><circle cx="552" cy="486" r="5" fill="none" stroke="#6e5d29" stroke-width="2"/><text x="605" y="526" text-anchor="middle" font-family="Arial,sans-serif" font-size="32" font-weight="700" fill="#2a2a2a">$19.99</text><text x="605" y="548" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#4f4f4f">STORE TAG</text></g>'
  },
  {
    id: 'fixture-06', challenge: 'promotional-overlay', accent: '#c84a3a',
    constructionTruth: {
      ocrStatus: 'readable_text', ocrText: 'SALE 50% OFF',
      textRegions: [{ id: 'text-1', text: 'SALE 50% OFF', origin: 'overlay', readability: 'readable', bbox: box(58, 45, 604, 95) }],
      visualFacts: [{ kind: 'promotional_overlay', textOrigin: 'overlay', regionId: 'text-1' }]
    },
    draw: () => '<g><rect x="58" y="45" width="604" height="95" rx="12" fill="#d83d31" opacity="0.96"/><text x="360" y="107" text-anchor="middle" font-family="Arial,sans-serif" font-size="46" font-weight="800" fill="#ffffff">SALE 50% OFF</text></g>'
  }
];

function renderSvg(item) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="720" height="720" viewBox="0 0 720 720" role="img" aria-label="视觉评测${escapeXml(item.id)}" data-fixture-id="${escapeXml(item.id)}">
  <rect width="720" height="720" fill="#f5f1e8"/>
  <rect x="95" y="165" width="530" height="390" rx="34" fill="#ffffff" stroke="#d7d0c4" stroke-width="4"/>
  <ellipse cx="360" cy="536" rx="215" ry="34" fill="#c7c2ba" opacity="0.42"/>
  <path d="M195 270 L525 270 L490 500 Q360 540 230 500 Z" fill="${item.accent}" stroke="#20313a" stroke-width="7"/>
  <path d="M215 305 H505 M225 350 H495 M235 395 H485 M245 440 H475" fill="none" stroke="#ffffff" stroke-opacity="0.34" stroke-width="7"/>
  <path d="M250 270 Q360 210 470 270" fill="none" stroke="#20313a" stroke-width="18" stroke-linecap="round"/>
  ${item.draw()}
</svg>
`;
}

const rendered = cases.map((item) => {
  const svg = renderSvg(item);
  return {
    item,
    svg,
    record: {
      id: item.id,
      challenge: item.challenge,
      filename: `${item.id}.svg`,
      assetPath: `/visual-fixtures/${item.id}.svg`,
      dimensions: { width: 720, height: 720 },
      sha256: sha256(svg),
      sourceKind: 'deterministic-synthetic-svg',
      generated: true,
      merchantEvidence: false,
      labelStatus: 'synthetic-construction-truth-not-human-gold',
      labelsDerivedFrom: 'fixture-construction-spec',
      constructionTruth: item.constructionTruth
    }
  };
});

const dataset = `${JSON.stringify({
  schemaVersion: '1.0',
  datasetId: 'globalguard-visual-fixtures-v1',
  createdOn: '2026-09-08',
  coordinateSystem: 'normalized_xywh_top_left',
  notice: '确定性合成夹具的构造真值，不是人工金标准、模型准确率或真实商家数据。',
  cases: rendered.map(({ record }) => record)
}, null, 2)}\n`;
const annotationTemplate = `${JSON.stringify({
  schemaVersion: '1.0',
  datasetId: 'globalguard-visual-fixtures-v1',
  annotationStatus: 'blank-human-review-template',
  instructions: '标注者只查看SVG，不查看construction-truth.json或模型输出。完成后填写annotator、reviewedAt和每个humanLabel。',
  annotator: null,
  reviewedAt: null,
  cases: cases.map(({ id }) => ({
    id,
    humanLabel: { ocrStatus: null, ocrText: null, textRegions: [], visualFacts: [], notes: '' }
  }))
}, null, 2)}\n`;

const outputs = [
  ...rendered.map(({ item, svg }) => [assetDir, `${item.id}.svg`, svg]),
  [dataDir, 'construction-truth.json', dataset],
  [dataDir, 'human-annotations.blank.json', annotationTemplate]
];

if (mode === '--write') {
  await fs.mkdir(dataDir, { recursive: true });
  await fs.mkdir(assetDir, { recursive: true });
  for (const [directory, filename, content] of outputs) await fs.writeFile(path.join(directory, filename), content, 'utf8');
  console.log(JSON.stringify({ written: outputs.map(([, filename]) => filename), cases: cases.length }, null, 2));
} else {
  const mismatches = [];
  for (const [directory, filename, expected] of outputs) {
    let actual = null;
    try { actual = await fs.readFile(path.join(directory, filename), 'utf8'); } catch {}
    if (actual !== expected) mismatches.push(filename);
  }
  console.log(JSON.stringify({ checked: outputs.length, cases: cases.length, mismatches }, null, 2));
  if (mismatches.length) process.exitCode = 1;
}
