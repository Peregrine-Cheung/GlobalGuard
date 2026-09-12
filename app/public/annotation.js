import { ANNOTATION_DATASETS, createBlankAnnotationPack, validateHumanAnnotationPack } from './annotation-validation.mjs';

const requestedDataset = new URLSearchParams(location.search).get('dataset');
const datasetId = requestedDataset === 'robustness-v1'
  ? 'globalguard-visual-robustness-v1' : 'globalguard-visual-fixtures-v1';
const profile = ANNOTATION_DATASETS[datasetId];
const CASE_IDS = profile.caseIds;
const STORAGE_KEY = `globalguard-human-annotation-draft-${profile.key}`;
const list = document.querySelector('#case-list');
const template = document.querySelector('#case-template');
const annotator = document.querySelector('#annotator');
const statusMessage = document.querySelector('#status-message');
const factKinds = [
  ['promotional_overlay', '后加促销叠字'], ['watermark', '疑似水印'], ['decorative_border', '装饰边框'],
  ['price_text', '价格文字'], ['occluded_product', '商品遮挡'], ['multiple_products', '多件物品'], ['low_clarity', '清晰度不足']
];
const origins = [['overlay', '后加叠层'], ['product', '商品/包装实体'], ['scene', '场景实体'], ['uncertain', '归属不确定']];

function options(items, selected = '') {
  return items.map(([value, label]) => `<option value="${value}"${value === selected ? ' selected' : ''}>${label}</option>`).join('');
}

function addRegion(card, value = {}) {
  const container = card.querySelector('[data-list="regions"]');
  if (container.children.length >= 8) return;
  const index = container.children.length;
  const row = document.createElement('div');
  row.className = 'row region';
  row.innerHTML = `
    <label>ID<input data-key="id" readonly value="text-${index + 1}"></label>
    <label>逐字文本<input data-key="text" value="${escapeAttribute(value.text ?? '')}" placeholder="不可读时留空"></label>
    <label>归属<select data-key="origin">${options(origins, value.origin)}</select></label>
    <label>可读性<select data-key="readability"><option value="readable">可读</option><option value="unreadable"${value.readability === 'unreadable' ? ' selected' : ''}>不可读</option></select></label>
    ${['x','y','width','height'].map((key, i) => `<label>${key}<input data-box="${i}" type="number" min="0" max="1" step="0.0001" value="${value.bbox?.[i] ?? ''}"></label>`).join('')}
    <button type="button" class="draw">图上框选</button><button type="button" class="remove">删除</button>`;
  row.querySelector('.remove').addEventListener('click', () => { row.remove(); renumberRegions(card); changed(); });
  row.querySelector('.draw').addEventListener('click', () => activateDraw(card, row));
  row.querySelector('[data-key="readability"]').addEventListener('change', event => {
    const text = row.querySelector('[data-key="text"]');
    if (event.target.value === 'unreadable') text.value = '';
    text.disabled = event.target.value === 'unreadable';
    changed();
  });
  if (value.readability === 'unreadable') row.querySelector('[data-key="text"]').disabled = true;
  row.querySelectorAll('input,select').forEach(control => control.addEventListener('input', () => { renderBoxes(card); changed(); }));
  container.append(row);
  renderBoxes(card);
}

function renumberRegions(card) {
  [...card.querySelectorAll('.region')].forEach((row, index) => { row.querySelector('[data-key="id"]').value = `text-${index + 1}`; });
  renderBoxes(card);
}

function renderBoxes(card) {
  const layer = card.querySelector('.box-layer');
  layer.textContent = '';
  for (const row of card.querySelectorAll('.region')) {
    const values = [0,1,2,3].map(index => Number(row.querySelector(`[data-box="${index}"]`).value));
    if (values.some(value => !Number.isFinite(value)) || values[2] <= 0 || values[3] <= 0) continue;
    const box = document.createElement('div');
    box.className = 'annotation-box';
    box.style.cssText = `left:${values[0]*100}%;top:${values[1]*100}%;width:${values[2]*100}%;height:${values[3]*100}%`;
    const label = document.createElement('span');
    const canonicalId = row.querySelector('[data-key="id"]').value;
    label.textContent = canonicalId.replace(/^text-(\d+)$/, 'tx$1');
    box.append(label); layer.append(box);
  }
}

function activateDraw(card, row) {
  const stage = card.querySelector('.image-stage');
  stage.classList.add('drawing');
  statusMessage.className = 'status';
  statusMessage.textContent = '请在图片上按住并拖拽文字区域；松开后会自动填写归一化坐标。';
  let start = null;
  const point = event => {
    const rect = stage.getBoundingClientRect();
    return [Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height))];
  };
  const cleanup = () => { stage.classList.remove('drawing'); stage.removeEventListener('pointerdown', down); window.removeEventListener('pointerup', up); start = null; };
  const down = event => { event.preventDefault(); start = point(event); window.addEventListener('pointerup', up, { once: true }); };
  const up = event => {
    if (!start) return cleanup();
    const end = point(event);
    const box = [Math.min(start[0], end[0]), Math.min(start[1], end[1]), Math.abs(end[0] - start[0]), Math.abs(end[1] - start[1])];
    if (box[2] >= 0.005 && box[3] >= 0.005) {
      box.forEach((value, index) => { row.querySelector(`[data-box="${index}"]`).value = value.toFixed(4); });
      renderBoxes(card); changed();
    }
    cleanup();
  };
  stage.addEventListener('pointerdown', down);
}

function addFact(card, value = {}) {
  const container = card.querySelector('[data-list="facts"]');
  if (container.children.length >= 4) return;
  const row = document.createElement('div');
  row.className = 'row fact';
  row.innerHTML = `
    <label>事实类型<select data-key="kind">${options(factKinds, value.kind)}</select></label>
    <label>文字归属<select data-key="textOrigin"><option value="not_applicable">非文字</option>${options(origins, value.textOrigin)}</select></label>
    <label>区域ID<input data-key="regionId" value="${escapeAttribute(value.regionId ?? '')}" placeholder="如 text-1"></label>
    <button type="button" class="remove">删除</button>`;
  row.querySelector('.remove').addEventListener('click', () => { row.remove(); changed(); });
  row.querySelectorAll('input,select').forEach(control => control.addEventListener('input', changed));
  container.append(row);
}

function escapeAttribute(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function render(pack = createBlankAnnotationPack(datasetId)) {
  list.textContent = '';
  annotator.value = pack.annotator || '';
  for (const [index, id] of CASE_IDS.entries()) {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = id;
    card.querySelector('img').src = `${profile.assetRoot}${id}.svg`;
    card.querySelector('img').alt = `视觉盲标夹具 ${index + 1}`;
    card.querySelector('strong').textContent = `夹具 ${index + 1}`;
    const label = pack.cases?.find(item => item.id === id)?.humanLabel || {};
    card.querySelector('[data-field="ocrStatus"]').value = label.ocrStatus || '';
    card.querySelector('[data-field="ocrText"]').value = label.ocrText || '';
    card.querySelector('[data-field="notes"]').value = label.notes || '';
    for (const region of label.textRegions || []) addRegion(card, region);
    for (const fact of label.visualFacts || []) addFact(card, fact);
    card.querySelector('[data-action="add-region"]').addEventListener('click', () => { addRegion(card); changed(); });
    card.querySelector('[data-action="add-fact"]').addEventListener('click', () => { addFact(card); changed(); });
    card.querySelectorAll('[data-field]').forEach(control => control.addEventListener('input', changed));
    card.querySelector('[data-field="ocrStatus"]').addEventListener('change', event => {
      const text = card.querySelector('[data-field="ocrText"]');
      if (event.target.value !== 'readable_text') text.value = 'NONE';
      else if (text.value === 'NONE') text.value = '';
      changed();
    });
    list.append(card);
  }
  updateProgress();
}

function collectRegion(row) {
  const readability = row.querySelector('[data-key="readability"]').value;
  return {
    id: row.querySelector('[data-key="id"]').value,
    text: readability === 'readable' ? row.querySelector('[data-key="text"]').value : null,
    origin: row.querySelector('[data-key="origin"]').value,
    readability,
    bbox: [0,1,2,3].map(index => Number(row.querySelector(`[data-box="${index}"]`).value))
  };
}

function collectPack(completed = false) {
  return {
    schemaVersion: '1.0', datasetId,
    annotationStatus: completed ? 'completed-single-human-review' : 'blank-human-review-template',
    annotator: annotator.value.trim() || null,
    reviewedAt: completed ? new Date().toISOString() : null,
    cases: [...document.querySelectorAll('.case-card')].map(card => ({
      id: card.dataset.id,
      humanLabel: {
        ocrStatus: card.querySelector('[data-field="ocrStatus"]').value || null,
        ocrText: card.querySelector('[data-field="ocrText"]').value || null,
        textRegions: [...card.querySelectorAll('.region')].map(collectRegion),
        visualFacts: [...card.querySelectorAll('.fact')].map(row => ({
          kind: row.querySelector('[data-key="kind"]').value,
          textOrigin: row.querySelector('[data-key="textOrigin"]').value,
          regionId: row.querySelector('[data-key="regionId"]').value.trim() || null
        })),
        notes: card.querySelector('[data-field="notes"]').value
      }
    }))
  };
}

function updateProgress() {
  const completed = [...document.querySelectorAll('[data-field="ocrStatus"]')].filter(item => item.value).length;
  document.querySelector('#progress-count').textContent = `${completed} / ${CASE_IDS.length}`;
  document.querySelector('#progress-bar').style.width = `${completed / CASE_IDS.length * 100}%`;
}

function changed() {
  updateProgress();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(collectPack(false)));
  statusMessage.className = 'status';
  statusMessage.textContent = '草稿已保存在当前浏览器，尚未完成完整性校验。';
}

function validateCurrent() {
  try {
    const pack = validateHumanAnnotationPack(collectPack(true));
    statusMessage.className = 'status ok';
    statusMessage.textContent = `${CASE_IDS.length}张标注结构完整，可以导出。该结果仍只是单人人工复核标签。`;
    return pack;
  } catch (error) {
    statusMessage.className = 'status error';
    statusMessage.textContent = `校验未通过：${error.code || error.message}${error.caseId ? `（${error.caseId}）` : ''}`;
    document.querySelector(`[data-id="${error.caseId}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return null;
  }
}

document.querySelector('#validate-button').addEventListener('click', validateCurrent);
document.querySelector('#export-button').addEventListener('click', () => {
  const pack = validateCurrent();
  if (!pack) return;
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(pack, null, 2)}\n`], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `globalguard-human-annotations-${Date.now()}.json`; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
document.querySelector('#import-file').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    if (file.size > 1024 * 1024) throw new Error('FILE_TOO_LARGE');
    const imported = JSON.parse(await file.text());
    if (imported.datasetId !== datasetId || !Array.isArray(imported.cases)) throw new Error('WRONG_DATASET');
    render(imported); changed();
  } catch (error) {
    statusMessage.className = 'status error'; statusMessage.textContent = `导入失败：${error.message}`;
  } finally { event.target.value = ''; }
});
document.querySelector('#reset-button').addEventListener('click', () => {
  if (!confirm('只清空当前浏览器中的盲标草稿？此操作不会删除已下载文件。')) return;
  localStorage.removeItem(STORAGE_KEY); render(); changed();
});
annotator.addEventListener('input', changed);

let initial = null;
try { initial = JSON.parse(localStorage.getItem(STORAGE_KEY)); } catch {}
document.title = `GlobalGuard · ${profile.label}人工盲标`;
document.querySelector('#dataset-label').textContent = profile.label;
document.querySelector('#case-count-label').textContent = `${CASE_IDS.length}张`;
document.querySelector('#case-list').setAttribute('aria-label', `${profile.label}盲标图片`);
render(initial?.datasetId === datasetId ? initial : createBlankAnnotationPack(datasetId));
