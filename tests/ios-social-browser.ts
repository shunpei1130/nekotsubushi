/** Mobile WebKit/Chromium integration. Native simulator tests live in ios/. */
import {chromium,webkit,type Page} from '@playwright/test';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {seedHistoricalScript} from './journey-fixtures.ts';
const kind=process.env.BROWSER==='webkit'?'webkit':'chromium';
const base=process.env.BASE_URL||'http://127.0.0.1:5180';
const proxy=base.startsWith('https://')&&process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined;
const out=`artifacts/ios-web/${kind}`;await mkdir(out,{recursive:true});
const wk=join(dirname(webkit.executablePath()),'minibrowser-wpe');
const browser=kind==='webkit'?await webkit.launch({headless:true,proxy,...(process.env.WEBKIT_QA_LIBS?{executablePath:join(wk,'bin/MiniBrowser'),env:{...process.env,LD_LIBRARY_PATH:`${process.env.WEBKIT_QA_LIBS}:${wk}/lib:${wk}/sys/lib`,WEBKIT_EXEC_PATH:join(wk,'bin'),WEBKIT_INJECTED_BUNDLE_PATH:join(wk,'lib'),WEBKIT_INSPECTOR_RESOURCES_PATH:join(wk,'share')}}:{})}):await chromium.launch({headless:true,proxy,executablePath:process.env.CI?undefined:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const errors:string[]=[],checks:any[]=[];let entry:string|null=null;
async function check(name:string,run:()=>Promise<void>){const start=Date.now();try{await run();checks.push({name,passed:true,ms:Date.now()-start});console.log('PASS '+name);}catch(e){checks.push({name,passed:false,error:e instanceof Error?e.stack:String(e)});console.error('FAIL '+name+': '+e);}}
async function using(run:(p:Page)=>Promise<void>,viewport={width:393,height:852}){
 const ctx=await browser.newContext({viewport,isMobile:true,hasTouch:true,deviceScaleFactor:1,acceptDownloads:true});
 await ctx.addInitScript(seedHistoricalScript());
 await ctx.addInitScript(`Object.defineProperty(navigator,'share',{value:undefined,configurable:true});Object.defineProperty(navigator,'clipboard',{value:{writeText:async text=>{window.__copiedText=text}},configurable:true});`);
 const p=await ctx.newPage();p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)errors.push(`${r.status()} ${r.url()}`)});
 try{await run(p);}finally{await ctx.close();}
}
async function open(p:Page,mode:number){await p.goto(`${base}/?mode=${mode}`,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__ready&&!!window.__game);entry??=await p.locator('script[type=module][src]').last().getAttribute('src');}
async function visibleShareButton(p:Page){
 await p.waitForFunction(()=>{const i=document.querySelector<HTMLImageElement>('#share-card-preview');return i?.complete&&i.naturalWidth>0});
 const b=await p.locator('[data-action=native-share]').boundingBox(),d=await p.locator('#share-dialog').boundingBox();
 assert.ok(b&&d&&b.y>=d.y&&b.y+b.height<=d.y+d.height,'Sharing must be visible before scrolling through optional caption fields');
}
async function end(p:Page,mode:number){
 if(mode===5){await p.locator('[data-action=finish-cheeks]').tap();}
 else await p.evaluate(()=>{const e=window.__game!.engine;e.status='result';e.success=true;e.score=[1,2,4].includes(e.mode)?3:0;e.phase=e.mode===3?'SUCCESS':e.mode===6?'CLEAR':'FINISHED';Object.assign(e.metrics,{maxStreak:[1,2].includes(e.mode)?3:0,remainingMs:e.mode===3?109:null,survivalMs:e.mode===6?15000:0,nearMissMs:0});});
 await p.locator('.result-modal').waitFor();
}
try{
 for(let mode=1;mode<=6;mode++)await check(`G${mode}: three social buttons, real PNG, caption, fallback and retry`,async()=>using(async p=>{
  await open(p,mode);await end(p,mode);
  assert.equal(await p.locator('.social-buttons button').count(),3);assert.equal(await p.locator('.result-modal').innerText().then(s=>s.includes('${')),false);
  for(const button of await p.locator('.social-buttons button').all()){const b=await button.boundingBox();assert.ok(b&&b.width>=44&&b.height>=44);}
  await p.locator('[data-network=instagram]').tap();await p.locator('#share-card-preview:not([hidden])').waitFor();
  assert.match(await p.locator('#share-title').innerText(),/Instagram/);
  const dimensions=await p.locator('#share-card-preview').evaluate((i:HTMLImageElement)=>[i.naturalWidth,i.naturalHeight]);assert.deepEqual(dimensions,[1080,1350]);
  await visibleShareButton(p);
  const url=new URL(await p.locator('#challenge-url').inputValue());assert.equal(url.origin,new URL(base).origin);assert.equal(url.searchParams.has('challenge'),mode!==5);
  await p.locator('[data-action=copy-caption]').tap();assert.match(await p.evaluate(()=>(window as any).__copiedText),/猫つぶし/);
  const download=p.waitForEvent('download');await p.locator('[data-action=download-card]').tap();assert.match((await download).suggestedFilename(),/\.png$/);
  await p.screenshot({path:`${out}/mode-${mode}-instagram.png`});
  await p.locator('[data-action=close-share]').tap();await p.locator('[data-network=tiktok]').tap();await p.locator('#share-card-preview:not([hidden])').waitFor();assert.match(await p.locator('#share-title').innerText(),/TikTok/);
  await p.locator('[data-action=native-share]').tap();assert.match(await p.locator('.share-status').innerText(),/保存|コピー/);
  await p.locator('[data-action=close-share]').tap();await p.locator('[data-action=retry]').tap();await p.waitForFunction(()=>window.__game!.engine.score===0&&window.__game!.engine.status!=='result');
 }));
 await check('X composer URL is correct and opened only by the user gesture',async()=>using(async p=>{
  await p.context().route('https://x.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>QA composer stub; no external post</h1>'}));
  await open(p,3);await end(p,3);const popup=p.waitForEvent('popup');await p.locator('[data-network=x]').tap();const target=await popup;await target.waitForLoadState('domcontentloaded');const url=new URL(target.url());assert.equal(url.pathname,'/intent/tweet');assert.match(url.searchParams.get('text')!,/0.109/);assert.ok(url.searchParams.get('url')!.includes('challenge='));await target.close();
 }));
 await check('small iPhone, landscape and iPad retain visible stage and scrollable sharing',async()=>{
  for(const viewport of [{width:320,height:568},{width:852,height:393},{width:768,height:1024}])await using(async p=>{await open(p,5);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const b=await p.locator('#stage').boundingBox();assert.ok(b&&b.height>100&&b.y+b.height<=viewport.height+1);await end(p,5);await p.locator('[data-network=instagram]').tap();await p.locator('#share-card-preview:not([hidden])').waitFor();if(viewport.height>viewport.width)await visibleShareButton(p);await p.locator('[data-action=copy-caption]').tap();await p.screenshot({path:`${out}/share-${viewport.width}x${viewport.height}.png`});},viewport);
 });
 await check('native file-share user gesture and cancel branches preserve the result',async()=>using(async p=>{
  await p.evaluate(()=>{}).catch(()=>{});
  await p.addInitScript(`Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});Object.defineProperty(navigator,'share',{value:async data=>{window.__fileShare={types:data.files.map(f=>f.type),active:navigator.userActivation?.isActive};throw new DOMException('cancel','AbortError')},configurable:true});`);
  await open(p,4);await end(p,4);await p.locator('[data-network=instagram]').tap();await p.locator('#share-card-preview:not([hidden])').waitFor();await p.locator('[data-action=native-share]').tap();await p.waitForFunction(()=>!!(window as any).__fileShare);assert.deepEqual(await p.evaluate(()=>(window as any).__fileShare.types),['image/png']);assert.match(await p.locator('.share-status').innerText(),/いつでも/);
 }));
 await check('no JS or HTTP errors',async()=>assert.deepEqual(errors,[]));
}finally{
 const report={date:new Date().toISOString(),browser:kind,browserVersion:browser.version(),base,entry,checks,errors,passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,method:'Mobile browser emulation. Competitive result states are injected integration fixtures; cheek finish, buttons, generated PNGs, downloads and user gestures are real browser operations. X uses a local route stub and no post is sent. Actual iOS app tests run separately in Xcode Simulator.'};await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await browser.close();if(report.failed)process.exitCode=1;
}
