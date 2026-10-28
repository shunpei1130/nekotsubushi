/** AI-operated browser calibration: real elapsed time and trusted mouse input.
 * Not a physical-device or human playtest. Only currently visible phase/positions
 * are observed; no future timing, fixture/step or direct engine mutation. */
import {chromium,type Page} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
const out='artifacts/unlock-play';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1});
const page=await context.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
async function open(mode:number){await page.goto(`http://127.0.0.1:5177/?mode=${mode}`);await page.waitForFunction(()=>window.__ready&&!!window.__game);}
async function state(){return page.evaluate(()=>{const s=window.__game!.snapshot();return {phase:s.phase,status:s.status,score:s.score,elapsed:s.elapsed,remaining:s.remaining,success:s.success,catX:s.catX,catY:s.catY,toyX:s.toyX,toyY:s.toyY,cheekX:s.cheekX,cheekY:s.cheekY,metrics:s.metrics};});}
async function point(x:number,y:number){const r=await page.locator('#stage').boundingBox();if(!r)throw Error('missing stage');return {x:r.x+x/941*r.width,y:r.y+y/1672*r.height};}
async function move(x:number,y:number){const p=await point(x,y);await page.mouse.move(p.x,p.y);}
async function tap(x=650,y=850){await move(x,y);await page.mouse.down();await page.waitForTimeout(32);await page.mouse.up();}
const report:any={method:'AI browser-operated normal-clock trusted mouse inputs, not human/physical-device play. Observes current phase and position only. No engine timing/schedule/step/fixtures.',date:new Date().toISOString(),runs:[]};
try{
 for(const strategy of ['visual-120ms']){
  await open(4);await tap();const started=Date.now();let taps=1;let early=0;let lastPhase='';let pending=false;
  while(Date.now()-started<20000){const s=await state();if(s.status==='result')break;
   if(strategy==='blind-300ms'){await page.waitForTimeout(250);await tap();taps++;}
   else {if(s.phase==='BARE'&&!pending){pending=true;await page.waitForTimeout(strategy==='visual-200ms'?200:120);await tap();taps++;pending=false;}else await page.waitForTimeout(45);}
   if(s.phase!==lastPhase){lastPhase=s.phase;}
  }
  const s=await state();await page.waitForTimeout(700);await page.screenshot({path:join(out,`baseline-hat-${strategy}.png`),fullPage:true});report.runs.push({mode:4,strategy,taps,wallMs:Date.now()-started,result:s});console.log(JSON.stringify(report.runs.at(-1)));await writeFile(join(out,'baseline-456.json'),JSON.stringify(report,null,2));
 }
 await open(5);const gestures=[{name:'right',from:[720,880],to:[850,880],hold:150},{name:'left',from:[210,880],to:[80,880],hold:150},{name:'up',from:[720,880],to:[720,780],hold:150},{name:'down',from:[720,880],to:[720,980],hold:150},{name:'inward',from:[720,880],to:[590,880],hold:150},{name:'gentle',from:[720,880],to:[750,880],hold:1150}];
 const gestureResults=[];const cheekStart=Date.now();for(const g of gestures){await move(...g.from as [number,number]);await page.mouse.down();const p=await point(...g.to as [number,number]);await page.mouse.move(p.x,p.y,{steps:8});await page.waitForTimeout(g.hold);await page.screenshot({path:join(out,`baseline-cheek-${g.name}.png`)});await page.mouse.up();await page.waitForTimeout(520);gestureResults.push({intended:g.name,observed:(await state()).metrics.cheekGesture});}
 report.runs.push({mode:5,strategy:'six visibly guided gestures',wallMs:Date.now()-cheekStart,gestureResults,result:await state()});console.log(JSON.stringify(report.runs.at(-1)));await writeFile(join(out,'baseline-456.json'),JSON.stringify(report,null,2));
 for(const strategy of ['stationary','rectangle-2.8s','oval-3.5s','oval-2.8s']){
  await open(6);const initial=await state();await move(initial.toyX,initial.toyY);await page.mouse.down();const started=Date.now();let sampleAt=0;const samples=[];
  while(Date.now()-started<18000){const s=await state();if(s.status==='result')break;const t=(Date.now()-started)/1000;
   if(strategy==='stationary'){await page.waitForTimeout(100);}
   else if(strategy.startsWith('rectangle')){const p=(t/2.8)%1;const corners=[[860,305],[100,305],[100,1390],[860,1390],[860,305]];const k=p*4,i=Math.floor(k),f=k-i;await move(corners[i][0]+(corners[i+1][0]-corners[i][0])*f,corners[i][1]+(corners[i+1][1]-corners[i][1])*f);await page.waitForTimeout(35);}
   else {const period=strategy.includes('3.5')?3.5:2.8;const a=-Math.PI/3-t/period*2*Math.PI;await move(480+380*Math.cos(a),847+540*Math.sin(a));await page.waitForTimeout(35);}
   if(t>=sampleAt){samples.push({wall:t,state:s});sampleAt+=1;}
  }
  await page.mouse.up();const s=await state();await page.waitForTimeout(700);await page.screenshot({path:join(out,`baseline-toy-${strategy}.png`),fullPage:true});report.runs.push({mode:6,strategy,wallMs:Date.now()-started,result:s,samples});console.log(JSON.stringify(report.runs.at(-1)));await writeFile(join(out,'baseline-456.json'),JSON.stringify(report,null,2));
 }
 report.errors=errors;await writeFile(join(out,'baseline-456.json'),JSON.stringify(report,null,2));
}finally{await context.close();await browser.close();}
