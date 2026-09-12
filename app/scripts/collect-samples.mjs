// Explicit, small allowlist: no search crawling, account access or model calls.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../public/samples/', import.meta.url));
const candidates = [
  ['basket-empty', 'Plastic laundry basket.jpg', '蓝色镂空洗衣篮'],
  ['tray-deep', 'Gratnells Extra Deep Storage Tray.jpg', '深型开口收纳盒'],
  ['tray-purple', 'Gratnells School Storage Jumbo Tray in Purple.jpg', '紫色开口收纳盒'],
  ['basket-clothes', 'Clothes in laundry basket.jpg', '装有衣物的洗衣篮'],
  ['drawers-store', 'Plastic multi-drawer storage cabinets 1 2018-01-30.jpg', '货架上的抽屉式收纳柜'],
  ['basket-woven', 'Wicker basket - Slovakia (1).jpg', '编织提篮']
];
const allowedHosts = new Set(['commons.wikimedia.org', 'upload.wikimedia.org', 'thumb.wikimedia.org']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = html => String(html || '').replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&#160;|&nbsp;/g, ' ').trim();
async function download(url) {
  for (let redirect = 0; redirect < 4; redirect++) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !allowedHosts.has(parsed.hostname)) throw new Error('HOST_NOT_ALLOWED');
    const res = await fetch(parsed, { redirect: 'manual', signal: AbortSignal.timeout(25000), headers: { 'User-Agent': 'GlobalGuardResearch/0.1 (small licensed demonstration dataset)' } });
    if ([301, 302, 303, 307, 308].includes(res.status)) { url = new URL(res.headers.get('location'), parsed).href; continue; }
    if (!res.ok) throw new Error(`HTTP_${res.status}: ${parsed.pathname}`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > 8 * 1024 * 1024) throw new Error('SAMPLE_TOO_LARGE');
    return { bytes, finalUrl: parsed.href, contentType: res.headers.get('content-type') };
  }
  throw new Error('REDIRECT_LIMIT');
}
await fs.mkdir(root, { recursive: true });
const manifestPath = path.join(root, 'manifest.json');
let existing;
try { existing = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
if (existing) {
  for (const sample of existing.samples) {
    if (hash(await fs.readFile(path.join(root, `${sample.id}.jpg`))) !== sample.sha256) throw new Error(`HASH_CHANGED:${sample.id}`);
  }
  console.log('Existing collection verified; no download or overwrite.');
  process.exit(0);
}
const samples = [];
for (const [id, filename, title] of candidates) {
  const api = new URL('https://commons.wikimedia.org/w/api.php');
  api.search = new URLSearchParams({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url|size|extmetadata', iiurlwidth: '1280', iiurlheight: '1280', titles: `File:${filename}` });
  const { bytes: metadataBytes } = await download(api.href);
  const page = Object.values(JSON.parse(metadataBytes).query.pages)[0];
  const info = page.imageinfo?.[0];
  if (!info) throw new Error(`NO_IMAGE:${id}`);
  const meta = info.extmetadata;
  const license = meta.LicenseShortName?.value;
  if (!['CC0', 'CC BY-SA 4.0'].includes(license) || meta.Restrictions?.value) throw new Error(`LICENSE_REVIEW_REQUIRED:${id}`);
  const { bytes, finalUrl, contentType } = await download(info.thumburl || info.url);
  if (!contentType?.startsWith('image/jpeg') || bytes[0] !== 255 || bytes[1] !== 216) throw new Error(`NOT_JPEG:${id}`);
  const destination = path.join(root, `${id}.jpg`);
  try { await fs.writeFile(destination, bytes, { flag: 'wx' }); }
  catch (error) {
    // Resume partial downloads only if their exact bytes still match upstream.
    if (error.code !== 'EEXIST' || hash(await fs.readFile(destination)) !== hash(bytes)) throw error;
  }
  const sample = {
    id, title, filename, path: `/samples/${id}.jpg`, sourceKind: 'open-license-photograph',
    sourcePage: info.descriptionurl, commonsPageId: page.pageid,
    author: plain(meta.Artist?.value), license, licenseUrl: meta.LicenseUrl.value.replace(/^http:/, 'https:'),
    attributionRequired: meta.AttributionRequired?.value === 'true',
    originalUrl: info.url, downloadedUrl: finalUrl, acquiredAt: new Date().toISOString(),
    originalDimensions: { width: info.width, height: info.height },
    dimensions: { width: info.thumbwidth || info.width, height: info.thumbheight || info.height },
    bytes: bytes.length, sha256: hash(bytes),
    changes: '下载 Wikimedia 提供的等比例缩略图；本地未裁剪、修补、去水印或生成。',
    licenseEvidence: { artistHtml: meta.Artist.value, licenseName: license, licenseUrl: meta.LicenseUrl.value, credit: plain(meta.Credit?.value) },
    labelStatus: 'assistant-reviewed-provisional-not-human-gold',
    merchantEvidence: false, generated: false
  };
  samples.push(sample);
  console.log(JSON.stringify({ id, author: sample.author, license, dimensions: sample.dimensions, bytes: bytes.length }));
}
await fs.writeFile(manifestPath, JSON.stringify({ schemaVersion: '1.0', collectedAt: new Date().toISOString(), purpose: '家居收纳公开照片功能测试；不是商家实际SKU、效果数据或平台合规认证。', samples }, null, 2) + '\n', { flag: 'wx' });
