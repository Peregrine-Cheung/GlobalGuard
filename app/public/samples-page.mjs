import { readSampleLibrary } from './sample-library.mjs';
const cards = document.querySelector('#sample-cards');
function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text) node.textContent = text;
  if (className) node.className = className;
  return node;
}
try {
  const samples = await readSampleLibrary();
  cards.replaceChildren();
  for (const [index, sample] of samples.entries()) {
    const card = element('article', '', 'sample-card');
    const img = element('img');
    img.src = sample.path; img.alt = sample.title;
    const content = element('div', '', 'sample-card-content');
    content.append(element('p', `${String(index + 1).padStart(2, '0')} / ${sample.group}`, 'eyebrow'), element('h2', sample.title), element('p', sample.focus, 'sample-focus'));
    const tags = element('div', '', 'sample-tags');
    for (const observation of sample.observations) tags.append(element('span', observation));
    const credit = element('p', `照片：${sample.author} · ${sample.license}`, 'sample-credit');
    const links = element('div', '', 'sample-links');
    const load = element('a', '载入工作台 ↗', 'primary-button'); load.href = `/?sample=${encodeURIComponent(sample.id)}`;
    const source = element('a', '原始来源'); source.href = sample.sourcePage; source.target = '_blank'; source.rel = 'noreferrer';
    const license = element('a', '许可'); license.href = sample.licenseUrl; license.target = '_blank'; license.rel = 'noreferrer';
    links.append(load, source, license);
    content.append(tags, credit, element('small', `${sample.dimensions.width} × ${sample.dimensions.height} · 等比例缩略图，未做内容修改`), links);
    card.append(img, content); cards.append(card);
  }
} catch (error) { cards.textContent = `素材库未加载：${error.message}`; }
