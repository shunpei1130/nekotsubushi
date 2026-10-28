import {chromium} from '@playwright/test';
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {seedHistoricalScript} from './journey-fixtures.ts';
const url=process.env.BASE_URL||'https://nekotsubushi.vercel.app';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors:string[]=[],checks:any[]=[];
await page.addInitScript(seedHistoricalScript());
let entryAsset:string|null=null;
page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')errors.push(e.text())});page.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`)});
const state=()=>page.evaluate(()=>(window as any).__game.snapshot());
const step=(ms:number)=>page.evaluate(ms=>(window as any).__game.step(ms),ms);
async function at(x:number,y:number){const r=(await page.locator('#stage').boundingBox())!;return{x:r.x+x/941*r.width,y:r.y+y/1672*r.height}}
async function down(x:number,y:number){const p=await at(x,y);await page.mouse.move(p.x,p.y);await page.mouse.down()}
async function tap(x:number,y:number){await down(x,y);await page.mouse.up()}
try{
 await page.goto(url+'/?test=1');await page.waitForFunction(()=>(window as any).__ready);assert.equal(await page.locator('[data-mode]').count(),6);entryAsset=await page.locator('script[type=module][src]').getAttribute('src');if(process.env.EXPECTED_ENTRY)assert.equal(entryAsset,process.env.EXPECTED_ENTRY,'public deployment serves the intended build');checks.push({name:'Anonymous public menu and six cards',passed:true});
 for(let mode=1;mode<=6;mode++){
  await page.locator(`[data-mode="${mode}"]`).click();await page.waitForFunction(()=>(window as any).__ready&&!!(window as any).__game);assert.equal((await state()).mode,mode);assert.equal((await state()).score,0);
  if(mode===1){await tap(650,850);assert.equal((await state()).score,1);await step(31000)}
  if(mode===2){await tap(470,1050);while((await state()).phase!=='JUMP')await step(50);await down(470,1050);const p=await at(715,1050);await page.mouse.move(p.x,p.y,{steps:5});await page.mouse.up();assert.equal((await state()).score,1);await step(31000)}
  if(mode===3){await down(470,850);await step(1000);await page.mouse.up();assert.equal((await state()).success,true)}
  if(mode===4){await tap(470,1000);assert.equal((await state()).score,1);await step(150);await tap(470,1000);assert.equal((await state()).score,1);await step(16000)}
  if(mode===5){await down(750,900);const p=await at(920,920);await page.mouse.move(p.x,p.y,{steps:5});assert.ok((await state()).cheekX>50);await page.mouse.up();await step(500);assert.equal((await state()).cheekX,0)}
  if(mode===6){await down(847,301);const p=await at(350,800);await page.mouse.move(p.x,p.y,{steps:5});await step(100);assert.ok((await state()).toyX<847);await page.mouse.up();await step(16000);assert.equal((await state()).status,'result')}
  await page.screenshot({path:`artifacts/production-mode-${mode}.png`});
  if(mode!==5){await page.locator('[data-action=retry]').click();await page.waitForFunction(()=>(window as any).__ready&&!!(window as any).__game);assert.equal((await state()).score,0)}
  await page.locator('[data-action=menu]').click();await page.locator('[data-mode="1"]').waitFor();checks.push({name:`Production mode ${mode}: input, outcome, retry and menu`,passed:true});
 }
 assert.deepEqual(errors,[]);checks.push({name:'No public JavaScript or HTTP asset errors',passed:true});
 const report={date:new Date().toISOString(),url,browser:await browser.version(),anonymous:true,entryAsset,precondition:'Constructed qualifying NEW journey proofs in localStorage prepare an already-cleared regression player. This does not verify fresh-player access; journey-browser independently verifies initial one-stage access.',checks,errors,passed:checks.length};await writeFile('artifacts/production-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await browser.close()}
