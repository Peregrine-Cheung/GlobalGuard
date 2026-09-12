// Offline product demonstration recording. Provider access is disabled.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const require = createRequire(process.env.GLOBALGUARD_QA_MODULES
  ? path.join(process.env.GLOBALGUARD_QA_MODULES, 'package.json') : import.meta.url);
const { chromium } = require('playwright');
const appDir = fileURLToPath(new URL('..', import.meta.url));
const projectDir = fileURLToPath(new URL('../..', import.meta.url));
const tempDir = path.join(projectDir, 'tmp', 'submission-video');
const outputDir = path.join(projectDir, 'output', 'video');
await fs.mkdir(tempDir, { recursive: true });
await fs.mkdir(outputDir, { recursive: true });

const denyFetch = 'data:text/javascript,globalThis.fetch=async()=>{throw new Error("DEMO_EXTERNAL_REQUEST_BLOCKED")}';
const child = spawn(process.execPath, ['--import', denyFetch, 'server.mjs'], {
  cwd: appDir, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, HOST:'127.0.0.1', PORT:'0', MODEL_ROUTER_API_KEY:'demo-placeholder',
    MODEL_ROUTER_APP_USE_APPROVED:'0', MODEL_ROUTER_BASE_URL:'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }
});
const exited = once(child, 'exit');
let browser, context;

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function caption(page, value) {
  await page.evaluate(text => {
    let el=document.querySelector('#submission-caption');
    if(!el){ el=document.createElement('div'); el.id='submission-caption'; document.body.appendChild(el); }
    el.textContent=text;
    Object.assign(el.style,{position:'fixed',left:'50%',bottom:'22px',transform:'translateX(-50%)',zIndex:'99999',
      background:'rgba(8,47,54,.94)',color:'#fff',padding:'14px 24px',borderRadius:'12px',font:'700 22px Microsoft YaHei',
      boxShadow:'0 8px 32px rgba(0,0,0,.28)',maxWidth:'1050px',textAlign:'center'});
  }, value);
}

try {
  const baseUrl = await new Promise((resolve, reject) => {
    let output=''; const timer=setTimeout(()=>reject(new Error('DEMO_SERVER_TIMEOUT')),8000);
    child.on('error',reject); child.stdout.on('data',chunk=>{ output+=chunk.toString(); const m=output.match(/http:\/\/127\.0\.0\.1:\d+/); if(m){clearTimeout(timer);resolve(m[0]);} });
  });
  browser = await chromium.launch({ channel:'chrome', headless:true });
  context = await browser.newContext({ viewport:{width:1280,height:720}, recordVideo:{dir:tempDir,size:{width:1280,height:720}} });
  await context.route('**/*', route => new URL(route.request().url()).origin === baseUrl ? route.continue() : route.abort());
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  await page.goto(baseUrl); await caption(page,'GlobalGuard：跨境商品发布前图文合规工作台'); await delay(4000);
  await page.locator('#load-sample').click(); await page.locator('#image-preview-wrap:not(.hidden)').waitFor();
  await caption(page,'载入同一演示 SKU，先选择目标市场与发布路径'); await delay(3500);
  const response = page.waitForResponse(r=>r.url()===`${baseUrl}/api/analyze`);
  await page.locator('#analyze-button').click(); const before=await (await response).json();
  await page.locator('#result-content:not(.hidden)').waitFor(); await page.locator('#result-panel').scrollIntoViewIfNeeded();
  await caption(page,'本地规则先给出当前阻断、未来准备度和人工复核项'); await delay(5500);

  const regionResult=structuredClone(before);
  regionResult.analysisId='submission-video-region-evidence';
      regionResult.ai={status:'live',observationPolicy:'us-visual-facts-v7',selectedModel:'validated-offline-fixture',latencyMs:1,requestId:'offline-video-fixture',usage:{totalTokens:0},stages:[],
    observations:{ocrStatus:'readable_text',ocrText:'SALE BOX',visualObservation:'离线演示坐标夹具',textRegions:[
      {id:'text-1',text:'SALE',origin:'overlay',readability:'readable',bbox:[.1,.1,.35,.12]},
      {id:'text-2',text:'BOX',origin:'product',readability:'readable',bbox:[.35,.55,.25,.1]}]}};
  regionResult.risks=[...before.risks,{id:'video-region-risk',ruleId:'GG-US-VISUAL-PROMOTIONAL-OVERLAY',route:'US_GOOGLE',severity:'high',category:'可见事实待复核',title:'促销叠字区域',finding:'顶部促销文字区域。',whyItMatters:'发布前需核对主图要求。',action:'仅移除确认的叠加区域。',applicability:'演示',requiresHumanReview:true,evidenceRegionId:'text-1',evidence:[],origin:'model-router',location:{type:'region',x:10,y:10,width:35,height:12,regionId:'text-1',source:'model-text-region'}}];
  regionResult.summary={...before.summary,totalRisks:regionResult.risks.length,reviewCount:before.summary.reviewCount+1};
  await page.route('**/api/analyze',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(regionResult)}),{times:1});
  await page.locator('#analyze-button').click(); await page.locator('#ai-telemetry').filter({hasText:'2 个归一化区域'}).waitFor();
  await page.locator('#image-preview-wrap').scrollIntoViewIfNeeded(); await caption(page,'模型只能标出可见事实与文字区域，本地规则决定风险'); await delay(5000);
  await page.locator('#repair-guard').scrollIntoViewIfNeeded(); await caption(page,'修复前先确认候选移除区与保护区，默认保持锁定'); await delay(4500);
  await page.locator('#confirm-removal').check(); await page.locator('#confirm-protection').check();
  await page.locator('#apply-fix').click(); await page.locator('#download-fixed:not(.hidden)').waitFor();
  await page.locator('#before-after').scrollIntoViewIfNeeded(); await caption(page,'生成真实像素草稿，商品区域继续受到保护'); await delay(5000);
  const recheck=page.waitForResponse(r=>r.url()===`${baseUrl}/api/recheck`); await page.locator('#recheck-button').click(); await recheck;
  await page.locator('#recheck-result').scrollIntoViewIfNeeded(); await caption(page,'重新检测不等于自动通过，剩余问题与审计链继续保留'); await delay(5000);

  await page.locator('[data-route="CN_ADS"]').click(); await page.locator('#input-heading').scrollIntoViewIfNeeded();
  await caption(page,'中国广告路径：逐字事实与证据约束，法律语境保留人工复核'); await delay(4500);
  await page.locator('[data-route="EU_GPSR"]').click(); await caption(page,'欧盟路径：核对制造商、责任人、产品标识等9个页面字段'); await delay(4500);
  await page.goto(`${baseUrl}/validation.html`); await page.locator('#integrity-card[data-state="ready"]').waitFor();
  await caption(page,'验证中心展示结构门禁，也明确列出尚未测量的准确率与审核结果'); await delay(6000);
  await page.evaluate(()=>window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'})); await delay(3500);
  await caption(page,'GlobalGuard：可检查、可解释、可修复，并保留人工出口'); await delay(5000);

  const video = page.video(); await page.close(); await context.close(); context=null; await browser.close(); browser=null;
  const recorded = await video.path();
  const finalPath = path.join(outputDir,'GlobalGuard_复赛产品演示_v7无配音版.webm');
  await fs.copyFile(recorded,finalPath);
  console.log(JSON.stringify({ok:true,finalPath,mode:'offline-demonstration-provider-disabled'},null,2));
} finally {
  if(context) await context.close().catch(()=>{});
  if(browser) await browser.close().catch(()=>{});
  child.kill(); await exited;
}
