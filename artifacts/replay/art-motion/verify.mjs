import {chromium} from '@playwright/test';
import {mkdir,writeFile,rename} from 'node:fs/promises';
import assert from 'node:assert/strict';
const base=process.env.BASE_URL||'http://127.0.0.1:5173';const out='artifacts/replay/art-motion';await mkdir(out,{recursive:true});
const report={date:new Date().toISOString(),base,checks:[],errors:[],method:'Production GameScene; real mouse input; deterministic engine clock only for keyframe/round boundaries. Eye keyframes freeze the presentation after a real observed blink. Separate gesture-choreography.webm uses normal game/presentation clocks. Chromium390x844; referencefixtures941x1672.'};
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
const remaining=process.env.ART_QA_REMAINING==='1';if(remaining)report.priorEvidence='partial-report.json';
const cases=[['right',650,850,790,850,30],['left',150,850,30,850,30],['up',650,850,650,760,30],['down',650,850,650,950,30],['inward',650,850,530,850,30],['gentle',650,850,685,850,1100]];
async function ready(p){await p.waitForFunction(()=>window.__ready&&!!window.__game);await p.locator('#stage').waitFor({state:'visible'});await p.evaluate(()=>document.fonts.ready)}
async function open(mode,extra=''){await page.goto(`${base}/?mode=${mode}&test=1${extra}`,{waitUntil:'networkidle'});await ready(page)}
async function point(p,x,y){const r=await p.locator('#stage').boundingBox();assert.ok(r);return{x:r.x+x*r.width/941,y:r.y+y*r.height/1672}}
async function press(p,x,y){const q=await point(p,x,y);await p.mouse.move(q.x,q.y);await p.mouse.down()}
async function gesture(p,c,deterministic){const[name,x,y,xx,yy,time]=c;await press(p,x,y);const q=await point(p,xx,yy);await p.mouse.move(q.x,q.y);if(deterministic)await p.evaluate(ms=>window.__game.step(ms),time);else await p.waitForTimeout(name==='gentle'?1150:130);await p.mouse.up()}
async function check(name,fn){try{const info=await fn();report.checks.push({name,passed:true,...info});console.log('PASS '+name)}catch(e){report.checks.push({name,passed:false,error:String(e.stack||e)});console.log('FAIL '+name+' '+e.message)}}
try{
await open(5);report.entryScript=await page.locator('script[type=module]').first().getAttribute('src');
for(const c of remaining?[]:cases)await check('gesture-'+c[0],async()=>{
 await page.locator('[data-action=reset]').click();await gesture(page,c,true);
 await page.waitForFunction(name=>{const r=window.__game.visual().reaction;return r?.id==='cheek-'+name&&r.active&&(name==='right'?r.rightEyeClosed:name==='left'||name==='inward'?r.leftEyeClosed:r.leftEyeClosed&&r.rightEyeClosed)},c[0],{timeout:15000});
 await page.evaluate(()=>Object.defineProperty(document,'hidden',{configurable:true,get:()=>true}));const snap=await page.evaluate(()=>({s:window.__game.snapshot(),v:window.__game.visual()}));assert.equal(snap.s.metrics.cheekGesture,c[0]);
 await page.locator('#stage').screenshot({path:`${out}/gesture-${c[0]}.png`});await page.evaluate(()=>delete document.hidden);return {reaction:snap.v.reaction};
});
for(let mode=remaining?2:1;mode<=6;mode++)await check('warm-reset-'+mode,async()=>{
 await open(mode);await page.locator('#stage canvas').evaluate((c,token)=>c.dataset.resetToken=token,String(mode));
 if(mode===5){await gesture(page,cases[0],true);await page.locator('[data-action=reset]').click()}
 else {const xy=mode===2?[470,1050]:mode===3?[461,853]:mode===6?[847,301]:[650,850];await press(page,...xy);if(mode!==3&&mode!==6)await page.mouse.up();await page.evaluate(ms=>window.__game.step(ms),mode===3?6000:mode===1||mode===2?31000:16000);if(mode===3||mode===6)await page.mouse.up();await page.locator('[data-action=retry]').waitFor({state:'visible',timeout:30000});await page.locator('[data-action=retry]').click();await ready(page)}
 const snapshot=await page.evaluate(()=>({s:window.__game.snapshot(),v:window.__game.visual(),token:document.querySelector('#stage canvas').dataset.resetToken}));assert.equal(snapshot.token,String(mode));assert.equal(snapshot.s.score,0);assert.equal(snapshot.s.pointerId,null);assert.equal(snapshot.v.reaction.active,false);assert.equal(snapshot.s.status,mode===5?'playing':'ready');if(mode===4){assert.deepEqual(snapshot.v.hats.falling,[]);assert.equal(snapshot.v.hats.head.visible,false)}return {sameCanvas:true,status:snapshot.s.status};
});
await page.setViewportSize({width:941,height:1672});for(let mode=1;mode<=6;mode++)await check('reference-fixture-'+mode,async()=>{await open(mode,'&fixture=reference&capture=1');const v=await page.evaluate(()=>window.__game.visual());assert.equal(v.reaction.active,false);assert.equal(v.reaction.id,null);await page.locator('#stage').screenshot({path:`${out}/reference-${String(mode).padStart(2,'0')}.png`});return{reactionInactive:true}});
await context.close();
await check('normal-clock-gesture-video',async()=>{const c=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,recordVideo:{dir:out,size:{width:390,height:844}}});const p=await c.newPage();p.on('pageerror',e=>report.errors.push(e.message));await p.goto(base+'/?mode=5',{waitUntil:'networkidle'});await ready(p);const gestures=[];for(const g of cases){await p.locator('[data-action=reset]').click();await gesture(p,g,false);await p.waitForTimeout(1050);const actual=await p.evaluate(()=>window.__game.snapshot().metrics.cheekGesture);assert.equal(actual,g[0]);gestures.push({name:g[0],passed:true});console.log('PASS normal-clock-'+g[0])}report.normalClockGestures=gestures;const file=await p.video().path();await c.close();await rename(file,out+'/gesture-choreography.webm');return{video:'gesture-choreography.webm'}});
}finally{await browser.close();report.passed=report.checks.filter(x=>x.passed).length;report.failed=report.checks.filter(x=>!x.passed).length;await writeFile(out+'/report.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,errors:report.errors}));if(report.failed||report.errors.length)process.exitCode=1;}
