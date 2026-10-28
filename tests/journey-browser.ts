/**
 * Stage journey integration QA. Constructed historical saves and injected final
 * engine metrics are deterministic integration fixtures, NOT skill playtests.
 * Cheek gestures and the fresh-player input check use trusted browser pointers
 * and elapsed time. Difficulty calibration is recorded separately.
 */
import { chromium, webkit, type Browser, type BrowserContext, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { CHEEK_GESTURES, STAGE_GOALS, STAGE_ORDER, stageGoal } from '../src/journey.ts';
import { encodeChallenge, normalContext, type ModeId, type RunResult } from '../src/progression.ts';
import { historicalSave, passingResult, unlockedRegressionSave } from './journey-fixtures.ts';

const kind=process.env.BROWSER==='webkit'?'webkit':'chromium';
const base=process.env.BASE_URL||'http://127.0.0.1:5176';
const out=resolve(process.env.QA_OUTPUT||`artifacts/journey/${kind}`);
const checks:Array<{name:string;passed:boolean;elapsedMs:number;error?:string}>=[];
const errors:string[]=[];
const screenshots:string[]=[];
let browser:Browser|undefined;
let entryAsset:string|null=null;
let server:ChildProcess|undefined;

async function serve(){
  const url=new URL(base);if(!['127.0.0.1','localhost'].includes(url.hostname))return;
  try{if((await fetch(base)).ok)return;}catch{}
  const root=resolve(import.meta.dirname,'..');
  server=spawn(process.execPath,[join(root,'node_modules/vite/bin/vite.js'),'--host','127.0.0.1','--strictPort','--port',url.port||'5176'],{cwd:root,stdio:'ignore'});
  for(let i=0;i<100;i++){try{if((await fetch(base)).ok)return;}catch{}await new Promise(done=>setTimeout(done,100));}
  throw new Error('Vite did not become available');
}

async function context(value?:unknown,viewport={width:390,height:844}) {
  const ctx=await browser!.newContext({viewport,hasTouch:true,deviceScaleFactor:1});
  if(value!==undefined)await ctx.addInitScript(`try{if(!sessionStorage.getItem('journey-qa-seeded')){localStorage.setItem('nekotsubushi:v2',${JSON.stringify(typeof value==='string'?value:JSON.stringify(value))});sessionStorage.setItem('journey-qa-seeded','1');}}catch{}`);
  ctx.on('page',page=>{
    page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    page.on('response',response=>{if(response.status()>=400)errors.push(`HTTP ${response.status()} ${response.url()}`);});
  });
  return ctx;
}
async function using(value:unknown,task:(page:Page,ctx:BrowserContext)=>Promise<void>,viewport?:{width:number;height:number}) {
  const ctx=await context(value,viewport);
  const page=await ctx.newPage();
  try{await task(page,ctx);}catch(error){await shot(page,`failure-${screenshots.length}.png`).catch(()=>{});throw error;}finally{await ctx.close();}
}
async function ready(page:Page,game=false) {
  await page.waitForFunction(game?()=>!!(window as any).__ready&&!!(window as any).__game:()=>!!(window as any).__ready,{},{timeout:30000});
  await page.evaluate(()=>document.fonts.ready);
  const entry=await page.locator('script[type=module][src]').last().getAttribute('src');
  entryAsset??=entry;
  if(process.env.EXPECTED_ENTRY)assert.equal(entry,process.env.EXPECTED_ENTRY);
}
async function menu(page:Page){await page.goto(base,{waitUntil:'domcontentloaded'});await ready(page);}
async function unlocked(page:Page) {
  return page.locator('.mode-card[data-mode]').evaluateAll(cards=>cards.filter(card=>card.getAttribute('aria-disabled')!=='true').map(card=>Number((card as HTMLElement).dataset.mode)));
}
async function expectUnlocked(page:Page,through:number){assert.deepEqual(await unlocked(page),STAGE_ORDER.slice(0,Math.min(6,through)));}
async function shot(page:Page,name:string){await page.screenshot({path:join(out,name),fullPage:true});screenshots.push(name);}
async function check(name:string,task:()=>Promise<void>){
  if(process.env.QA_FILTER&&!new RegExp(process.env.QA_FILTER).test(name))return;
  const start=Date.now();
  try{await task();checks.push({name,passed:true,elapsedMs:Date.now()-start});console.log(`PASS ${name}`);}
  catch(error){const detail=error instanceof Error?error.stack:String(error);checks.push({name,passed:false,elapsedMs:Date.now()-start,error:detail});console.error(`FAIL ${name}: ${detail}`);}
}
async function point(page:Page,x:number,y:number){const r=await page.locator('#stage').boundingBox();assert.ok(r);return{x:r.x+x/941*r.width,y:r.y+y/1672*r.height};}
async function down(page:Page,x:number,y:number){const p=await point(page,x,y);await page.mouse.move(p.x,p.y);await page.mouse.down();}
async function tap(page:Page,x=650,y=850){await down(page,x,y);await page.mouse.up();}
async function gesture(page:Page,id:typeof CHEEK_GESTURES[number]){
  const g={right:[750,900,920,900],left:[200,900,30,900],up:[750,900,750,800],down:[750,900,750,1000],inward:[750,900,650,900],gentle:[750,900,780,900]}[id];
  await down(page,g[0],g[1]);const end=await point(page,g[2],g[3]);await page.mouse.move(end.x,end.y,{steps:3});
  if(id==='gentle')await page.waitForTimeout(1100);
  await page.mouse.up();await page.waitForTimeout(700);
}
async function injectCompletedResult(page:Page,result:RunResult){
  // Deliberate QA state injection. This does not measure a person's ability or
  // bypass production routing; the real result->save->unlock->UI path follows.
  await page.evaluate(r=>{
    const e=(window as any).__game.engine;
    e.score=r.count;e.success=r.success;e.status='result';
    e.elapsed=e.mode===1||e.mode===2?30:e.mode===4||e.mode===6?15:4;
    e.remaining=0;e.phase=e.mode===3?(r.success?'SUCCESS':'PUNCH'):e.mode===6?(r.success?'CLEAR':'CAPTURED'):'FINISHED';
    Object.assign(e.metrics,{maxStreak:r.maxStreak,streak:r.maxStreak,specialCount:r.specialCount,perfectCount:r.perfectCount,maxPerfectStreak:r.maxPerfectStreak,perfectStreak:r.maxPerfectStreak,remainingMs:r.remainingMs,survivalMs:r.survivalMs,nearMissMs:r.nearMissMs});
  },result);
  await page.locator('.result-modal').waitFor();
}
async function start(page:Page,mode:ModeId){await page.locator(`[data-mode="${mode}"]`).click();await ready(page,true);assert.equal(await page.evaluate(()=>(window as any).__game.engine.mode),mode);}
async function back(page:Page){
  const modal=page.locator('.game-modal [data-action="menu"]');
  if(await modal.count())await modal.first().click();else await page.locator('[data-action="menu"]').first().click();
  await ready(page);
}

await mkdir(out,{recursive:true});
try{
  await serve();
  const local=['127.0.0.1','localhost'].includes(new URL(base).hostname);
  const proxy=!local&&process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined;
  if(kind==='webkit'){
    const wk=join(dirname(webkit.executablePath()),'minibrowser-wpe');
    browser=await webkit.launch({headless:true,proxy,...(process.env.WEBKIT_QA_LIBS?{executablePath:join(wk,'bin/MiniBrowser'),env:{...process.env,LD_LIBRARY_PATH:`${process.env.WEBKIT_QA_LIBS}:${wk}/lib:${wk}/sys/lib`,WEBKIT_EXEC_PATH:join(wk,'bin'),WEBKIT_INJECTED_BUNDLE_PATH:join(wk,'lib'),WEBKIT_INSPECTOR_RESOURCES_PATH:join(wk,'share')}}:{})});
  }else browser=await chromium.launch({headless:true,proxy,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH||(!process.env.CI&&existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox','--disable-dev-shm-usage']});

  await check('FRESH: one stage only, visible conditions and locked-card guidance',async()=>{
    await using(undefined,async page=>{
      await menu(page);await expectUnlocked(page,1);await shot(page,'fresh-menu-mobile.png');
      await page.locator('[data-mode="6"]').click({force:true});await page.locator('#stage-lock-dialog[open]').waitFor();
      assert.match(await page.locator('#stage-lock-dialog').innerText(),/クリア|解放/);
      await shot(page,'locked-card-guidance.png');
      await page.locator('#stage-lock-dialog [data-action="journey-current"]').click();await ready(page,true);
      assert.equal(await page.evaluate(()=>(window as any).__game.engine.mode),1);
      assert.ok((await page.locator('.stage-task').innerText()).includes(stageGoal(1)));
      await tap(page);await page.waitForTimeout(200);await tap(page);
      assert.ok(await page.evaluate(()=>(window as any).__game.engine.score)>=2,'normal-clock pointer input works for the initial game');
      await back(page);await expectUnlocked(page,1);await page.reload({waitUntil:'domcontentloaded'});await ready(page);await expectUnlocked(page,1);
    });
  });

  await check('ROUTES: debug, fixture, direct, friend and daily links cannot jump locked stages',async()=>{
    const challenge=encodeChallenge(normalContext(6,9876),passingResult(6),base);
    const routes=['?mode=2','?mode=2&test=1','?mode=2&fixture=reference','?mode=2&capture=1','?mode=2&time=12','?mode=2&seed=42','?daily=2026-01-02&mode=2',new URL(challenge).search];
    await using(undefined,async page=>{
      for(const query of routes){
        await page.goto(`${base}/${query}`,{waitUntil:'domcontentloaded'});await ready(page);
        assert.equal(await page.locator('#stage').count(),0,`${query}: no locked game canvas`);
        assert.equal(await page.evaluate(()=>!!(window as any).__game),false,`${query}: no engine`);
        await expectUnlocked(page,1);
        assert.match(await page.locator('body').innerText(),/クリア|解放/);
      }
      await shot(page,'locked-challenge-link.png');
    });
  });

  await check('MIGRATION: exact old same-run evidence opens only its continuous prefix',async()=>{
    for(let cleared=0;cleared<=4;cleared++){
      await using(historicalSave(cleared),async page=>{
        await menu(page);await expectUnlocked(page,cleared+1);
        await start(page,(cleared+1) as ModeId);await back(page);
        const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nekotsubushi:v2')||'{}'));
        assert.equal(Object.keys(saved.journey.proofs).length,cleared);
        await page.reload({waitUntil:'domcontentloaded'});await ready(page);await expectUnlocked(page,cleared+1);
      });
    }
    await using(historicalSave(),async page=>{
      await menu(page);await expectUnlocked(page,5);
      await start(page,5);await back(page);
      const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nekotsubushi:v2')||'{}'));
      assert.equal(saved.unlocked.filter((id:string)=>id.startsWith('cheek-')).length,6);
      assert.equal(saved.runs['v2:normal:6'].best.survivalMs,15000,'later records are retained without skipping stage five');
      await page.reload({waitUntil:'domcontentloaded'});await ready(page);await expectUnlocked(page,5);
    });
    await using(unlockedRegressionSave(),async page=>{
      await menu(page);await expectUnlocked(page,6);assert.match(await page.locator('.journey-summary').innerText(),/全.*クリア|6.*6/);
      await shot(page,'all-clear-from-new-proofs.png');
      await page.reload({waitUntil:'domcontentloaded'});await ready(page);await expectUnlocked(page,6);
    });
  });

  await check('MIGRATION: v1 totals, missing first stage, corrupt proofs and unsupported data never grant access',async()=>{
    const old={schemaVersion:1,sound:false,reduced:true,records:{'1':999,'2':999,'3':5200,'4':999,'6':15000},clears:999,seen:[1,2,3,4,5,6]};
    await using(undefined,async(page,ctx)=>{
      await ctx.addInitScript(value=>localStorage.setItem('nekotsubushi:v1',JSON.stringify(value)),old);
      await menu(page);await expectUnlocked(page,1);await start(page,1);
      // An already-seen v1 player need not cause a write just by viewing a
      // stage. A real settings change explicitly persists the migrated save.
      await page.locator('[data-action="sound"]').click();await back(page);
      const kept=await page.evaluate(()=>({old:JSON.parse(localStorage.getItem('nekotsubushi:v1')||'null'),next:JSON.parse(localStorage.getItem('nekotsubushi:v2')||'null')}));
      assert.deepEqual(kept.old,old);assert.equal(kept.next.records['1'],999);assert.equal(kept.next.legacyRecords['3'],5200);assert.equal(kept.next.clears,999);
    });
    const gap=historicalSave();delete gap.runs['v2:normal:1'];
    await using(gap,async page=>{await menu(page);await expectUnlocked(page,1);});
    for(const value of ['{broken',{schemaVersion:999},{schemaVersion:2,journey:{version:1,cleared:[1,2,3,4,5,6],proofs:{'6':{kind:'run',result:passingResult(6)}}}},{schemaVersion:2,journey:{version:999,proofs:{'1':{kind:'run',result:passingResult(1)}}}}]){
      await using(value,async page=>{await menu(page);await expectUnlocked(page,1);});
    }
  });

  await check('COMPLETION: exact boundary pass/fail, next stage, repeated result, reload and all clear',async()=>{
    await using(undefined,async page=>{
      await menu(page);await start(page,1);
      for(const mode of STAGE_ORDER){
        if(mode===5){
          for(const id of CHEEK_GESTURES)await gesture(page,id);
          await page.locator('[data-stage="cheek-clear"]').waitFor();
          await page.locator('[data-action="next-stage"]').click();await ready(page,true);
          assert.equal(await page.evaluate(()=>(window as any).__game.engine.mode),6);continue;
        }
        const pass=passingResult(mode);
        const fail={...pass};
        if(mode===1||mode===2)fail.count--;
        if(mode===3)fail.remainingMs=(fail.remainingMs??0)+1;
        if(mode===4){if(STAGE_GOALS[4].perfectCount>0)fail.perfectCount--;else fail.count--;}
        if(mode===6){if(STAGE_GOALS[6].nearMissMs>0)fail.nearMissMs--;else fail.survivalMs--;}
        // Keep each fixture internally valid while missing exactly one goal.
        fail.maxStreak=Math.min(fail.maxStreak,fail.count);fail.maxPerfectStreak=Math.min(fail.maxPerfectStreak,fail.perfectCount);
        await injectCompletedResult(page,fail);
        assert.match(await page.locator('.stage-result').innerText(),/あと|次|条件|クリア/);
        assert.equal(await page.locator('[data-action="next-stage"]').count(),0,'one below the boundary does not open the next stage');
        await page.locator('[data-action="retry"]').click();await ready(page,true);
        await injectCompletedResult(page,pass);
        assert.match(await page.locator('.stage-result').innerText(),/クリア|解放/);
        const first=await page.evaluate(()=>JSON.parse(localStorage.getItem('nekotsubushi:v2')||'{}').journey);
        await page.waitForTimeout(300);
        const repeated=await page.evaluate(()=>JSON.parse(localStorage.getItem('nekotsubushi:v2')||'{}').journey);
        assert.deepEqual(repeated,first,'rendering repeated result events remains idempotent');
        await shot(page,`stage-${mode}-clear.png`);
        if(mode<6){await page.locator('[data-action="next-stage"]').click();await ready(page,true);assert.equal(await page.evaluate(()=>(window as any).__game.engine.mode),mode+1);}
        else{assert.match(await page.locator('.result-modal').innerText(),/全.*クリア/);await back(page);await expectUnlocked(page,6);await page.reload({waitUntil:'domcontentloaded'});await ready(page);await expectUnlocked(page,6);}
      }
    });
  });

  await check('DEBUG: accelerated result never saves a clear or unlocks another stage',async()=>{
    await using(undefined,async page=>{
      await page.goto(`${base}/?mode=1&test=1`);await ready(page,true);
      await tap(page);await page.evaluate(()=>(window as any).__game.step(31000));await page.locator('.result-modal').waitFor();
      const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nekotsubushi:v2')||'{}'));
      assert.equal(Object.keys(saved.journey?.proofs||{}).length,0);
      await back(page);await expectUnlocked(page,1);
    });
  });

  await check('CHEEK SESSION: discoveries across separate visits do not clear the single-session task',async()=>{
    await using(historicalSave(4),async page=>{
      await menu(page);await expectUnlocked(page,5);await start(page,5);
      for(const id of CHEEK_GESTURES.slice(0,3))await gesture(page,id);
      await back(page);await page.reload({waitUntil:'domcontentloaded'});await ready(page);await expectUnlocked(page,5);
      await start(page,5);
      for(const id of CHEEK_GESTURES.slice(3))await gesture(page,id);
      await back(page);await page.reload({waitUntil:'domcontentloaded'});await ready(page);await expectUnlocked(page,5);
      const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('nekotsubushi:v2')||'{}'));
      assert.equal(saved.unlocked.filter((id:string)=>id.startsWith('cheek-')).length,6,'all portraits remain collected');
      assert.equal(saved.journey.proofs['5'],undefined,'collection totals are not a new single-session proof');
      await shot(page,'six-portraits-still-stage-five.png');
    });
  });

  await check('PENDING FRIEND: a locked invitation keeps its course and opens after the preceding clear',async()=>{
    await using(undefined,async page=>{
      const link=encodeChallenge(normalContext(2,9876),passingResult(2),base);
      await page.goto(link,{waitUntil:'domcontentloaded'});await ready(page);await expectUnlocked(page,1);
      await page.locator('#stage-lock-dialog [data-action="journey-current"]').click();await ready(page,true);
      await injectCompletedResult(page,passingResult(1));
      await page.locator('[data-action="pending-challenge"]').click();await ready(page,true);
      const context=await page.evaluate(()=>(window as any).__game.context);
      assert.equal(context.mode,2);assert.equal(context.kind,'challenge');assert.equal(context.seed,9876);
      const fail={...passingResult(2),count:STAGE_GOALS[2].count-1,maxStreak:STAGE_GOALS[2].count-1};
      await injectCompletedResult(page,fail);await page.locator('[data-action="retry"]').click();await ready(page,true);
      assert.deepEqual(await page.evaluate(()=>(window as any).__game.context),context,'friend retry keeps exactly the original conditions');
      assert.ok(new URL(page.url()).searchParams.has('challenge'),'resumed invitation restores its canonical challenge URL');
      await page.reload({waitUntil:'domcontentloaded'});await ready(page,true);
      assert.deepEqual(await page.evaluate(()=>(window as any).__game.context),context,'resumed invitation retains kind, seed and target after reload');
      await injectCompletedResult(page,passingResult(2));await back(page);await expectUnlocked(page,3);
    });
  });

  await check('LAYOUT: desktop, landscape and denied storage retain one initial game',async()=>{
    await using(undefined,async page=>{
      await menu(page);await expectUnlocked(page,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot(page,'fresh-menu-desktop.png');
      await page.setViewportSize({width:844,height:390});await start(page,1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot(page,'stage-one-landscape.png');
    },{width:1280,height:900});
    await using(undefined,async(page,ctx)=>{
      await ctx.addInitScript(`Storage.prototype.getItem=()=>{throw new DOMException('Storage unavailable','SecurityError')};Storage.prototype.setItem=()=>{throw new DOMException('Storage unavailable','QuotaExceededError')};`);
      await menu(page);await expectUnlocked(page,1);await start(page,1);await tap(page);assert.equal(await page.evaluate(()=>(window as any).__game.engine.score),1);
      await back(page);await expectUnlocked(page,1);
    });
  });

  await check('ERRORS: no JavaScript, HTTP asset or console errors',async()=>assert.deepEqual(errors,[]));
}catch(error){checks.push({name:'Browser setup',passed:false,elapsedMs:0,error:error instanceof Error?error.stack:String(error)});}
finally{
  const report={date:new Date().toISOString(),baseURL:base,browser:kind,browserVersion:browser?await browser.version():null,entryAsset,goals:STAGE_GOALS,checks,errors,screenshots,passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed).length,method:'Constructed historical-save fixtures and injected finished-engine results verify deterministic boundaries and UI/store wiring. Fresh game input and six cheek gestures use trusted Playwright pointer input and real elapsed time. These fixtures are not human playtest evidence.',limitations:['390px mobile, desktop and landscape viewports are emulated. Linux WebKit is not a physical iPhone. Difficulty calibration is in a separate playtest report.']};
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));await browser?.close();server?.kill();
  console.log(JSON.stringify({report:join(out,'report.json'),passed:report.passed,failed:report.failed}));if(report.failed)process.exitCode=1;
}
