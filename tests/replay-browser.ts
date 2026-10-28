/** Retention/replay QA: trusted browser input, real clock for saved/shared results. */
import { chromium, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';
import { historicalSave, seedHistoricalScript } from './journey-fixtures.ts';

const root = resolve(import.meta.dirname, '..');
const kind = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const out = resolve(process.env.QA_OUTPUT || join(root, 'artifacts/replay', kind));
const checks: Array<{name:string;passed:boolean;elapsedMs:number;error?:string}> = [];
const errors: string[] = [];
const screenshots: string[] = [];
const measurements: Record<string, unknown> = {};
let browser: Browser;
let server: ChildProcess | undefined;
let entryAsset: string | null = null;

async function serve() {
  const url = new URL(base);
  if(!['127.0.0.1','localhost'].includes(url.hostname))return;
  try { if ((await fetch(base)).ok) return; } catch {}
  server = spawn(process.execPath, [join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--strictPort','--port',url.port || '5173'], {cwd:root,stdio:'ignore'});
  for (let i=0;i<100;i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise(done=>setTimeout(done,100));
  }
  throw new Error('Vite did not become available');
}

async function context(viewport={width:390,height:844},withJourney=true): Promise<BrowserContext> {
  const ctx = await browser.newContext({viewport,deviceScaleFactor:1,hasTouch:true,acceptDownloads:true});
  // Regression setup uses constructed, qualifying historical records. This is
  // not a production unlock override or evidence of difficulty playtesting.
  if(withJourney)await ctx.addInitScript(seedHistoricalScript());
  ctx.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {if(message.type()==='error') errors.push(message.text());});
    page.on('response', response => {if(response.status()>=400)errors.push(`HTTP ${response.status()} ${response.url()}`);});
  });
  return ctx;
}
async function usingPage(task:(page:Page,ctx:BrowserContext)=>Promise<void>,viewport?:{width:number;height:number},withJourney=true) {
  const ctx=await context(viewport,withJourney);
  try {await task(await ctx.newPage(),ctx);} finally {await ctx.close();}
}
async function ready(page:Page,game=true) {
  await page.waitForFunction(game ? ()=>(window as any).__ready&&!!(window as any).__game : ()=>(window as any).__ready,{},{timeout:30000});
  await page.evaluate(()=>document.fonts.ready);
  if(entryAsset===null) {
    entryAsset=await page.locator('script[type="module"][src]').last().getAttribute('src');
    if(process.env.EXPECTED_ENTRY)assert.equal(entryAsset,process.env.EXPECTED_ENTRY,'browser is testing the intended production build');
  }
}
async function open(page:Page,mode:number,debug=true,extra='') {
  await page.goto(`${base}/?mode=${mode}${debug?'&test=1':''}${extra}`,{waitUntil:'networkidle'});
  await ready(page);
}
const state=(page:Page)=>page.evaluate(()=>(window as any).__game.snapshot());
const runContext=(page:Page)=>page.evaluate(()=>(window as any).__game.context || (window as any).__game.snapshot().context);
const step=(page:Page,ms:number)=>page.evaluate(ms=>(window as any).__game.step(ms),ms);
async function xy(page:Page,x:number,y:number) {
  const rect=await page.locator('#stage').boundingBox();assert.ok(rect);
  return {x:rect.x+x/941*rect.width,y:rect.y+y/1672*rect.height};
}
async function move(page:Page,x:number,y:number,steps=1) {const p=await xy(page,x,y);await page.mouse.move(p.x,p.y,{steps});}
async function down(page:Page,x:number,y:number) {await move(page,x,y);await page.mouse.down();}
async function tap(page:Page,x=650,y=850) {await down(page,x,y);await page.mouse.up();}
async function until(page:Page,phase:string,max=10000) {
  let elapsed=0;
  while(elapsed<max) {
    const s=await state(page);if(s.phase===phase)return s;
    assert.notEqual(s.status,'result',`result before ${phase}`);
    const advance=Math.min(max-elapsed,Number.isFinite(s.phaseDuration)?Math.max(1,Math.ceil((s.phaseDuration-s.phaseTime)*1000)+1):50);
    await step(page,advance);elapsed+=advance;
  }
  throw new Error(`phase ${phase} not reached`);
}
async function result(page:Page) {await page.locator('.result-modal').waitFor({timeout:15000});}
async function realPunch(page:Page,holdMs=500) {
  await down(page,470,850);await page.waitForTimeout(holdMs);await page.mouse.up();
  await result(page);assert.equal((await state(page)).success,true,'real-clock release succeeds');
}
async function screenshot(page:Page,name:string) {
  await page.screenshot({path:join(out,name),fullPage:true});screenshots.push(name);
}
async function check(name:string,task:()=>Promise<void>) {
  if(process.env.QA_FILTER&&!new RegExp(process.env.QA_FILTER).test(name))return;
  const started=Date.now();
  try {await task();checks.push({name,passed:true,elapsedMs:Date.now()-started});console.log(`PASS ${name}`);}
  catch(error) {const detail=error instanceof Error?error.stack:String(error);checks.push({name,passed:false,elapsedMs:Date.now()-started,error:detail});console.error(`FAIL ${name}: ${detail}`);}
}
async function stubFallback(ctx:BrowserContext) {
  // Plain JS avoids tsx's __name helpers leaking into Playwright-serialized callbacks.
  await ctx.addInitScript(`
    Object.defineProperty(navigator,'share',{value:undefined,configurable:true});
    Object.defineProperty(navigator,'canShare',{value:undefined,configurable:true});
    Object.defineProperty(navigator,'clipboard',{value:{writeText:async(text)=>{window.__copiedChallenge=text;}},configurable:true});
  `);
}
async function challengeUrl(page:Page) {
  await page.locator('[data-action="share"]').click();
  const field=page.locator('#challenge-url');await field.waitFor();
  const url=await field.inputValue();assert.equal(new URL(url).origin,new URL(base).origin);
  assert.ok(url.length<=2048);assert.ok(!/[?&](test|fixture|capture|time)=/.test(url));
  return url;
}

await mkdir(out,{recursive:true});
try {
  await serve();
  const local=['127.0.0.1','localhost'].includes(new URL(base).hostname);
  const proxy=!local&&process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined;
  if(kind==='webkit') {
    const wk=join(dirname(webkit.executablePath()),'minibrowser-wpe');
    const executable=process.env.WEBKIT_EXECUTABLE_PATH;
    browser=await webkit.launch({headless:true,proxy,...(executable?{executablePath:executable}:{}),...(process.env.WEBKIT_QA_LIBS?{executablePath:join(wk,'bin/MiniBrowser'),env:{...process.env,LD_LIBRARY_PATH:`${process.env.WEBKIT_QA_LIBS}:${wk}/lib:${wk}/sys/lib`,WEBKIT_EXEC_PATH:join(wk,'bin'),WEBKIT_INJECTED_BUNDLE_PATH:join(wk,'lib'),WEBKIT_INSPECTOR_RESOURCES_PATH:join(wk,'share')}}:{})});
  } else {
    const executable=process.env.CHROMIUM_EXECUTABLE_PATH||(!process.env.CI&&existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined);
    browser=await chromium.launch({headless:true,proxy,...(executable?{executablePath:executable}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
  }

  await check('UI: six modes, daily entry, twelve reactions and desktop layout',async()=>{
    await usingPage(async page=>{
      await page.goto(`${base}/?test=1`);await ready(page,false);
      entryAsset=await page.locator('script[type="module"][src]').last().getAttribute('src');
      if(process.env.EXPECTED_ENTRY)assert.equal(entryAsset,process.env.EXPECTED_ENTRY,'browser is testing the intended production build');
      assert.equal(await page.locator('[data-mode]').count(),6);
      await page.locator('.daily-card').waitFor();await screenshot(page,'menu-mobile.png');
      await page.locator('[data-action="collection"]').click();
      assert.equal(await page.locator('[data-collection-id]').count(),12);
      await screenshot(page,'collection-mobile.png');
      await page.locator('[data-action="close-collection"]').first().click();
      assert.equal(await page.locator('#collection-dialog').evaluate(dialog=>(dialog as HTMLDialogElement).open),false);
      for(let mode=1;mode<=6;mode++) {
        await page.locator(`[data-mode="${mode}"]`).click();await ready(page);
        assert.equal((await state(page)).mode,mode);
        if(mode===1) {
          const canvas=page.locator('#stage canvas');
          const initial=await canvas.evaluate(node=>({buffer:(node as HTMLCanvasElement).width,display:node.getBoundingClientRect().width,dpr:devicePixelRatio}));
          assert.ok(Math.abs(initial.buffer-initial.display*initial.dpr)<=1,'mobile render buffer follows displayed device pixels');
          await page.setViewportSize({width:500,height:844});
          await page.waitForFunction(old=>{const c=document.querySelector('#stage canvas') as HTMLCanvasElement;return !!c&&c.width!==old;},initial.buffer);
          const resized=await canvas.evaluate(node=>({buffer:(node as HTMLCanvasElement).width,display:node.getBoundingClientRect().width,dpr:devicePixelRatio}));
          assert.ok(Math.abs(resized.buffer-Math.min(941,Math.max(941*.35,resized.display*resized.dpr)))<=1,'resize updates the render buffer');
          measurements.renderBuffer={initial,resized};
          await page.setViewportSize({width:390,height:844});
        }
        await page.locator('[data-action="menu"]').click();await ready(page,false);
      }
      await page.goto(`${base}/?mode=3&fixture=reference&capture=1&test=1`);await ready(page);
      assert.equal(await page.locator('#stage canvas').evaluate(node=>(node as HTMLCanvasElement).width),941,'reference captures retain native resolution');
    });
    await usingPage(async page=>{
      await page.goto(base);await ready(page,false);await screenshot(page,'menu-desktop.png');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'desktop has no horizontal overflow');
    },{width:1280,height:900});
  });

  await check('METRICS: poke streak and caught reset, box perfect, hat rhythm',async()=>{
    await usingPage(async page=>{
      await open(page,1);await tap(page);await step(page,160);await tap(page);
      assert.equal((await state(page)).metrics.streak,2);
      await until(page,'OPEN');await tap(page);
      let s=await state(page);assert.equal(s.metrics.streak,0);assert.equal(s.metrics.maxStreak,2);
      await open(page,2);await tap(page,470,1050);await until(page,'JUMP');await step(page,340);
      await down(page,470,1050);await move(page,735,1050);await page.mouse.up();
      s=await state(page);assert.equal(s.score,1);assert.equal(s.metrics.perfectCount,1);assert.equal(s.metrics.maxStreak,1);
      await open(page,4);await tap(page,470,1000);
      for(let i=0;i<3;i++){await until(page,'BARE');await tap(page,470,1000);}
      s=await state(page);assert.equal(s.metrics.perfectCount,3);assert.equal(s.metrics.maxPerfectStreak,3);
      await screenshot(page,'hat-rhythm.png');
    });
  });

  await check('METRICS: punch remaining time and feather near-miss without debug persistence',async()=>{
    await usingPage(async page=>{
      await open(page,3);const storage=await page.evaluate(()=>localStorage.getItem('nekotsubushi:v2'));
      await down(page,470,850);const start=await state(page);await step(page,(start.punchAt-.08)*1000);await page.mouse.up();
      const s=await state(page);assert.equal(s.success,true);assert.ok(s.metrics.remainingMs>=79&&s.metrics.remainingMs<=81);
      await result(page);assert.equal(await page.locator('[data-action="share"]:visible').count(),0,'debug results cannot be shared');
      assert.equal(await page.evaluate(()=>localStorage.getItem('nekotsubushi:v2')),storage,'debug result does not persist');
      await screenshot(page,'punch-close.png');
      await open(page,6);await down(page,847,301);await step(page,16000);await page.mouse.up();
      const toy=await state(page);assert.equal(toy.status,'result');assert.ok(toy.metrics.survivalMs>0);assert.ok(toy.metrics.nearMissMs>0);
      assert.ok(toy.metrics.nearMissMs<=toy.metrics.survivalMs);
    });
  });

  await check('COLLECTION: real cheek gesture unlocks, previews and survives reload',async()=>{
    await usingPage(async(page,ctx)=>{
      // Open stage five with genuine qualifying earlier-stage test records,
      // leaving cheek discoveries empty so this still tests new collection.
      await ctx.addInitScript(seedHistoricalScript(4));
      await open(page,5,false);await down(page,750,900);await move(page,920,900);await page.mouse.up();
      await page.waitForFunction(()=>JSON.parse(localStorage.getItem('nekotsubushi:v2')||'{}').unlocked?.includes('cheek-right'));
      await page.waitForTimeout(500);await screenshot(page,'cheek-discovery.png');
      const gestures=[
        {id:'left',x:200,y:900,toX:30,toY:900},
        {id:'up',x:750,y:900,toX:750,toY:800},
        {id:'down',x:750,y:900,toX:750,toY:1000},
        {id:'inward',x:750,y:900,toX:650,toY:900},
        {id:'gentle',x:750,y:900,toX:780,toY:900},
      ];
      for(const gesture of gestures) {
        await page.locator('[data-action="reset"]').click();
        await down(page,gesture.x,gesture.y);await move(page,gesture.toX,gesture.toY);
        if(gesture.id==='gentle')await page.waitForTimeout(1100);
        await page.mouse.up();
        await page.waitForFunction(id=>JSON.parse(localStorage.getItem('nekotsubushi:v2')||'{}').unlocked?.includes(`cheek-${id}`),gesture.id);
      }
      await page.locator('[data-action="menu"]').click();await ready(page,false);
      await page.locator('[data-action="collection"]').click();
      const card=page.locator('[data-collection-id="cheek-right"]');await card.waitFor();
      assert.ok((await card.getAttribute('class'))?.includes('is-unlocked'),'discovered reaction is visible');
      await card.click();await page.locator('[data-action="play-reaction"]').click();
      await page.locator('.collection-live-preview canvas').waitFor();
      const layout=await page.locator('#collection-preview').evaluate(node=>{
        const parent=node.getBoundingClientRect();
        const canvas=node.querySelector('canvas')!.getBoundingClientRect();
        const hint=node.querySelector('p')!.getBoundingClientRect();
        return {containerWidth:parent.width,canvasWidth:canvas.width,hintWidth:hint.width};
      });
      measurements.collectionLayout=layout;
      assert.ok(layout.canvasWidth>=layout.containerWidth*.8,'live preview uses a readable full-width layout');
      assert.ok(layout.hintWidth>=120,'hint text retains space for at least ten Japanese characters');
      await page.locator('.collection-live-preview').scrollIntoViewIfNeeded();
      await page.locator('.collection-live-preview').screenshot({path:join(out,'collection-live-preview.png')});screenshots.push('collection-live-preview.png');
      await screenshot(page,'collection-unlocked.png');
      await page.reload({waitUntil:'domcontentloaded',timeout:60000});await ready(page,false);await page.locator('[data-action="collection"]').click();
      assert.ok((await page.locator('[data-collection-id="cheek-right"]').getAttribute('class'))?.includes('is-unlocked'));
      measurements.collectionReload={previewOpenDuringReload:true,waitUntil:'domcontentloaded',appReady:true,persistenceVerified:true};
      await page.locator('[data-collection-id="cheek-right"]').click();await page.locator('[data-action="play-reaction"]').click();
      await page.locator('.collection-live-preview canvas').waitFor();
      await page.locator('[data-action="close-collection"]').first().click();
      await page.waitForFunction(()=>!document.querySelector('.collection-live-preview canvas'));
    },undefined,false);
  });

  await check('DAILY: Japan midnight changes next course, retry retains the started course',async()=>{
    await usingPage(async page=>{
      await page.clock.setFixedTime(new Date('2026-10-26T14:59:59Z'));
      await page.goto(`${base}/?test=1`);await ready(page,false);
      await page.locator('[data-action="daily"]').click();await ready(page);
      const old=await runContext(page);assert.equal(old.kind,'daily');assert.equal(old.dailyDate,'2026-10-26');
      await page.clock.setFixedTime(new Date('2026-10-26T15:00:01Z'));
      if(old.mode===6)await down(page,847,301);else if(old.mode===3)await down(page,470,850);else await tap(page,470,1000);
      await step(page,31000);await page.mouse.up();await result(page);
      await page.locator('[data-action="retry"]').click();await ready(page);
      assert.deepEqual(await runContext(page),old,'retry keeps the original course after midnight');
      await page.locator('[data-action="menu"]').click();await ready(page,false);
      await page.locator('[data-action="daily"]').click();await ready(page);
      const next=await runContext(page);assert.equal(next.dailyDate,'2026-10-27');assert.notEqual(next.mode,old.mode);
      measurements.daily={before:old,after:next};await screenshot(page,'daily-course.png');
    });
  });

  await check('SAVE: v1 remains intact, preserved old records and concrete new best delta',async()=>{
    await usingPage(async(page,ctx)=>{
      const old={schemaVersion:1,sound:false,reduced:false,records:{'1':12,'2':7,'3':4200,'4':8,'6':15000},clears:1,seen:[1,2,3,4,5,6]};
      await ctx.addInitScript(value=>localStorage.setItem('nekotsubushi:v1',JSON.stringify(value)),old);
      // Reach stage three using explicit historical same-run evidence for 1/2.
      // Pure v1 migration with insufficient evidence is tested by journey QA.
      const migrated={...historicalSave(2),records:{'1':12,'2':7,'4':8,'6':15000},legacyRecords:{'3':4200}};
      await ctx.addInitScript(value=>{if(localStorage.getItem('nekotsubushi:v2')===null)localStorage.setItem('nekotsubushi:v2',JSON.stringify(value));},migrated);
      await open(page,3,false);await realPunch(page,500);
      const firstRemaining=(await state(page)).metrics.remainingMs;
      let saved=await page.evaluate(()=>({old:localStorage.getItem('nekotsubushi:v1'),next:JSON.parse(localStorage.getItem('nekotsubushi:v2')||'null')}));
      assert.deepEqual(JSON.parse(saved.old!),old);assert.equal(saved.next.schemaVersion,2);assert.equal(saved.next.legacyRecords['3'],4200);
      assert.equal(saved.next.records['1'],12);assert.equal(saved.next.records['6'],15000);
      await page.locator('[data-action="retry"]').click();await ready(page);await down(page,470,850);
      const targetRemaining=Math.min(1800,Math.max(1000,firstRemaining-1000));
      await page.waitForFunction(remaining=>{const s=(window as any).__game.snapshot();return s.status==='result'||s.hold>=s.punchAt-remaining/1000;},targetRemaining,{polling:10,timeout:8000});
      await page.mouse.up();await result(page);assert.equal((await state(page)).success,true);
      const improvedRemaining=(await state(page)).metrics.remainingMs;
      assert.ok(improvedRemaining<firstRemaining,'the second successful release strictly improves the record');
      measurements.newBest={firstRemaining,targetRemaining,improvedRemaining};
      assert.match(await page.locator('.result-modal').innerText(),/新記録|更新/);
      await page.locator('#result-delta').waitFor();assert.ok((await page.locator('#result-delta').innerText()).trim().length>0);
      await screenshot(page,'new-best.png');
    },undefined,false);
  });

  await check('SOCIAL: real result, copied same-course link, PNG and friend reply',async()=>{
    const owner=await context();const friend=await context();
    try {
      await stubFallback(owner);await stubFallback(friend);
      const a=await owner.newPage();await open(a,3,false);await realPunch(a,500);
      const sourceContext=await runContext(a),sourceState=await state(a);const link=await challengeUrl(a);
      await a.locator('[data-action="copy-challenge"]').click();
      await a.waitForFunction(value=>(window as any).__copiedChallenge===value,link);
      assert.equal(await a.evaluate(()=>(window as any).__copiedChallenge),link);
      const downloadPromise=a.waitForEvent('download');await a.locator('[data-action="download-card"]').click();
      const download=await downloadPromise;assert.match(download.suggestedFilename(),/\.png$/i);
      const png=await readFile((await download.path())!);assert.equal(png.subarray(1,4).toString(),'PNG');
      assert.equal(png.readUInt32BE(16),1080);assert.equal(png.readUInt32BE(20),1350);
      await download.saveAs(join(out,'challenge-card.png'));screenshots.push('challenge-card.png');
      const b=await friend.newPage();await b.goto(link);await ready(b);
      await b.locator('.challenge-banner').waitFor();const targetContext=await runContext(b);
      assert.equal(targetContext.kind,'challenge');assert.equal(targetContext.seed,sourceContext.seed);assert.equal(targetContext.mode,3);
      await realPunch(b,1000);const targetState=await state(b);
      assert.equal(targetState.punchAt,sourceState.punchAt,'friend receives the same punch deadline');
      assert.ok(targetState.metrics.remainingMs<sourceState.metrics.remainingMs,'longer valid hold beats the target');
      await b.locator('[data-result="target"]').waitFor();await b.locator('[data-result="own"]').waitFor();
      await screenshot(b,'friend-comparison.png');
      const reply=await challengeUrl(b);assert.notEqual(reply,link);measurements.social={sourceContext,targetContext,link,reply};
    } finally {await owner.close();await friend.close();}
  });

  await check('RETRY: twenty real rounds keep one canvas and reuse essential textures',async()=>{
    await usingPage(async page=>{
      await open(page,3,false);await realPunch(page,250);
      await page.evaluate(()=>(window as any).__initialCanvas=document.querySelector('#stage canvas'));
      const essentialRequests:string[]=[];
      page.on('request',request=>{if(/\/assets\/(m03-|mplus-rounded)/.test(request.url()))essentialRequests.push(request.url());});
      const durations:number[]=[];
      for(let i=0;i<20;i++) {
        const start=Date.now();await page.locator('[data-action="retry"]').click();await ready(page);durations.push(Date.now()-start);
        assert.equal(await page.evaluate(()=>(window as any).__initialCanvas===document.querySelector('#stage canvas')),true,'same canvas reused');
        assert.equal(await page.locator('#stage canvas').count(),1);
        assert.equal((await state(page)).score,0);await realPunch(page,250);
      }
      assert.deepEqual(essentialRequests,[],'warm retry makes no essential texture requests');
      measurements.retry={rounds:20,readyMilliseconds:durations,essentialTextureRequests:essentialRequests.length};
      await screenshot(page,'retry-round-20.png');
    });
  });

  await check('LINKS: unsupported rules and malformed challenges show an explanation',async()=>{
    await usingPage(async page=>{
      const unsupported=btoa(JSON.stringify({v:999})).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
      await page.goto(`${base}/?challenge=${unsupported}`);await ready(page,false);
      assert.equal(await page.locator('[data-mode]').count(),6);
      assert.match(await page.locator('body').innerText(),/別のルール版/);
      assert.equal(await page.locator('#stage').count(),0,'unsupported rules do not silently start another course');
      await page.goto(`${base}/?challenge=not_valid_json`);await ready(page,false);
      assert.match(await page.locator('body').innerText(),/読み込めません/);
      assert.equal(await page.locator('#stage').count(),0);
      await page.goto(`${base}/?mode=1&seed=abc`);await ready(page,false);
      assert.equal(await page.locator('[data-mode]').count(),6);
      assert.match(await page.locator('body').innerText(),/読み込めません/);
      assert.equal(await page.locator('#stage').count(),0,'invalid seed returns to an explained menu');
    });
  });

  await check('STORAGE: unavailable local storage still permits initial game input and replay',async()=>{
    await usingPage(async(page,ctx)=>{
      await ctx.addInitScript(`
        Storage.prototype.getItem=()=>{throw new DOMException('Storage unavailable','SecurityError');};
        Storage.prototype.setItem=()=>{throw new DOMException('Storage unavailable','QuotaExceededError');};
      `);
      await open(page,1,false);await tap(page);await step(page,31000);await result(page);
      await page.locator('[data-action="retry"]').click();await ready(page);
      assert.equal((await state(page)).status,'ready');await tap(page);await step(page,31000);await result(page);
      assert.match(await page.locator('.result-modal').innerText(),/回/);
    },undefined,false);
  });

  await check('SHARE: cancelling the native sheet keeps the result and permits retry',async()=>{
    await usingPage(async(page,ctx)=>{
      await ctx.addInitScript(`
        Object.defineProperty(navigator,'canShare',{value:()=>true,configurable:true});
        Object.defineProperty(navigator,'share',{value:async()=>{window.__shareCancelled=true;throw new DOMException('User cancelled','AbortError');},configurable:true});
      `);
      await open(page,3,false);await realPunch(page,300);await challengeUrl(page);
      await page.locator('[data-action="native-share"]').click();
      await page.waitForFunction(()=>(window as any).__shareCancelled===true);
      assert.equal((await state(page)).status,'result');
      await page.locator('[data-action="close-share"]').first().click();
      await page.locator('[data-action="retry"]').click();await ready(page);
      assert.equal((await state(page)).status,'ready');
    });
  });

  await check('ERRORS: no JavaScript, asset HTTP or console errors',async()=>assert.deepEqual(errors,[]));
} catch(error) {
  checks.push({name:'Browser setup',passed:false,elapsedMs:0,error:error instanceof Error?error.stack:String(error)});
  console.error(error);
} finally {
  const report={date:new Date().toISOString(),baseURL:base,entryAsset,browser:kind,browserVersion:browser! ? await browser.version():null,checks,errors,screenshots,measurements,passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,method:'Trusted Playwright mouse pointer input. Metric and denied-storage checks use __game.step; persisted, shared and collection flows use real pointer input and real elapsed time. Constructed qualifying historical records prepare already-unlocked regression contexts; fresh-player gating is covered by journey-browser. Viewports are emulated.',limitations:['Physical iPhone Safari and Android are not connected. Linux WebKit and Chromium viewport emulation are not physical-device certification. OS share-sheet UI is unavailable in headless browsers; fallback share is exercised.']};
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));
  if(browser!)await browser.close();server?.kill();
  console.log(JSON.stringify({report:join(out,'report.json'),passed:report.passed,failed:report.failed}));
  if(report.failed)process.exitCode=1;
}
