import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(process.env.GLOBALGUARD_QA_MODULES
  ? path.join(process.env.GLOBALGUARD_QA_MODULES, 'package.json')
  : import.meta.url);
const { chromium } = require('playwright');
const appDir = fileURLToPath(new URL('..', import.meta.url));
const projectDir = fileURLToPath(new URL('../..', import.meta.url));
const videoPath = path.join(projectDir, 'output', 'video', 'GlobalGuard_复赛产品演示_v7无配音版.webm');
const frameDir = path.join(projectDir, 'tmp', 'submission-video-v7', 'frames');
await fs.mkdir(frameDir, { recursive: true });

const { size } = await fs.stat(videoPath);
const server = createServer((request, response) => {
  if (request.url !== '/video.webm') {
    response.writeHead(404).end();
    return;
  }
  const range = request.headers.range;
  if (!range) {
    response.writeHead(200, { 'Content-Type': 'video/webm', 'Content-Length': size, 'Accept-Ranges': 'bytes' });
    createReadStream(videoPath).pipe(response);
    return;
  }
  const match = /^bytes=(\d+)-(\d*)$/.exec(range);
  if (!match) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return;
  }
  const start = Number(match[1]);
  const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
  response.writeHead(206, {
    'Content-Type': 'video/webm',
    'Content-Length': end - start + 1,
    'Content-Range': `bytes ${start}-${end}/${size}`,
    'Accept-Ranges': 'bytes',
  });
  createReadStream(videoPath, { start, end }).pipe(response);
});
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const address = server.address();
const videoUrl = `http://127.0.0.1:${address.port}/video.webm`;

const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await page.setContent(`<style>html,body{margin:0;background:#000}video{display:block;width:1280px;height:720px}</style><video src="${videoUrl}"></video>`);
  const video = page.locator('video');
  await video.evaluate((element) => new Promise((resolve, reject) => {
    if (element.readyState >= 1) return resolve();
    element.addEventListener('loadedmetadata', resolve, { once: true });
    element.addEventListener('error', () => reject(new Error('VIDEO_DECODE_FAILED')), { once: true });
  }));
  const metadata = await video.evaluate((element) => ({
    duration: element.duration,
    width: element.videoWidth,
    height: element.videoHeight,
    readyState: element.readyState,
    networkState: element.networkState,
  }));
  const sampleSeconds = [5, 32, Math.max(0, Math.min(65, metadata.duration - 0.5))];
  const frames = [];
  for (const second of sampleSeconds) {
    await video.evaluate((element, target) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`VIDEO_SEEK_TIMEOUT_${target}`)), 8000);
      element.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
      element.currentTime = target;
    }), second);
    await page.waitForTimeout(300);
    const name = `frame-${String(Math.round(second)).padStart(2, '0')}.png`;
    const output = path.join(frameDir, name);
    await video.screenshot({ path: output });
    frames.push(output);
  }
  console.log(JSON.stringify({ ok: true, videoPath, metadata, sampleSeconds, frames }, null, 2));
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
