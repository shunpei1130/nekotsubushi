/** Production smoke with a genuinely fresh player, real time and pointer input. */
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {STAGE_GOALS} from '../src/journey.ts';
const base=process.env.BASE_URL||'https://nekotsubushi.vercel.app';
const out='artifacts/journey/production-play';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage'],proxy:process.env.HTTPS_PROXY?{server:process.env.HTTPS_PROXY}:undefined});
const ctx=await browser.newContext({viewport:{width:390,height:844}});const p=await ctx.newPage();const errors:string[]=[];
p.on('pageerror',e=>errors.push(e.message));p.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`);});
const report:any={baseURL:base,date:new Date().toISOString(),commit:process.env.SOURCE_COMMIT,method:'Fresh anonymous browser context, no constructed records or engine manipulation. AI-operated trusted mouse input, normal clock and visible current phase. This is not human/physical-device validation.',checks:[],attempts:[],errors};
const openModes=()=>p.locator('.mode-card').evaluateAll(cards=>cards.filter(c=>c.getAttribute('aria-disabled')!=='true').map(c=>Number((c as HTMLElement).dataset.mode)));
try{
 await p.goto(base);await p.waitForFunction(()=>window.__ready);report.entryAsset=await p.locator('script[type=module][src]').last().getAttribute('src');
 if(process.env.EXPECTED_ENTRY)assert.equal(report.entryAsset,process.env.EXPECTED_ENTRY);
 assert.deepEqual(await openModes(),[1]);report.checks.push('Fresh production player has only stage 1');await p.screenshot({path:`${out}/fresh-menu.png`,fullPage:true});
 await p.locator('[data-mode="1"]').click();await p.waitForFunction(()=>window.__ready&&!!window.__game);
 for(let attempt=1;attempt<=2;attempt++){
  const r=(await p.locator('#stage').boundingBox())!,at={x:r.x+650/941*r.width,y:r.y+850/1672*r.height};
  await p.mouse.click(at.x,at.y,{delay:20});const start=Date.now();let taps=1;
  for(;;){
   const s=await p.evaluate(()=>({phase:document.querySelector('#stage')?.getAttribute('data-phase'),status:document.querySelector('#stage')?.getAttribute('data-status')}));
   if(s.status==='result')break;
   if(s.phase==='CLOSED'){await p.mouse.click(at.x,at.y,{delay:20});taps++;await p.waitForTimeout(190);}else await p.waitForTimeout(70);
   if(Date.now()-start>45000)throw Error('Real-clock run failed to finish');
  }
  await p.locator('.result-modal').waitFor();const result=await p.evaluate(()=>window.__game!.result());report.attempts.push({attempt,taps,wallMs:Date.now()-start,result});
  console.log(JSON.stringify(report.attempts.at(-1)));
  await p.screenshot({path:`${out}/stage-1-attempt-${attempt}.png`,fullPage:true});
  if(result!.count>=STAGE_GOALS[1].count&&result!.maxStreak>=STAGE_GOALS[1].maxStreak)break;
  if(attempt===2)throw Error('Normal-clock attempts did not meet the stage goal');
  await p.locator('[data-action="retry"]').click();
 }
 assert.equal(await p.locator('.stage-result').getAttribute('data-stage-passed'),'true');report.checks.push('Actual normal-clock pointer run clears stage 1');
 await p.locator('[data-action="next-stage"]').click();await p.waitForFunction(()=>window.__ready&&window.__game?.engine.mode===2);
 assert.match(await p.locator('.stage-task').innerText(),/10.*3/);report.checks.push('The newly opened stage 2 actually starts');await p.screenshot({path:`${out}/opened-stage-2.png`,fullPage:true});
 await p.locator('[data-action="menu"]').first().click();await p.waitForFunction(()=>window.__ready&&!window.__game);assert.deepEqual(await openModes(),[1,2]);
 await p.reload({waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.__ready);assert.deepEqual(await openModes(),[1,2]);report.checks.push('Reload preserves exactly stages 1 and 2');await p.screenshot({path:`${out}/after-unlock-reload.png`,fullPage:true});
 assert.deepEqual(errors,[]);report.checks.push('No public JavaScript or HTTP errors');report.passed=report.checks.length;report.failed=0;
}catch(error){report.failed=1;report.error=error instanceof Error?error.stack:String(error);process.exitCode=1;}
finally{await writeFile(`${out}/report.json`,JSON.stringify(report,null,2));await ctx.close();await browser.close();console.log(JSON.stringify({checks:report.checks,failed:report.failed,error:report.error}));}
