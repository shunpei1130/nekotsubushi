/** Repeated normal-clock trials; prerequisite records are actual baseline runs. */
import {chromium} from '@playwright/test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/unlock-play';await mkdir(out,{recursive:true});
const past=JSON.parse(await readFile(`${out}/baseline-123-fast.json`,'utf8'));
const recorded=[past.runs.find((r:any)=>r.mode===1&&r.result.count===45),past.runs.find((r:any)=>r.mode===2&&r.result.count===11)].map(r=>r.result);
const runs=Object.fromEntries(recorded.map(r=>[`v2:normal:${r.mode}`,{best:r,last:r,updatedAt:1}]));
const source={schemaVersion:2,sound:false,reduced:false,records:{},legacyRecords:{},seen:[],unlocked:[],clears:0,runs};
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:390,height:844}});
await ctx.addInitScript(value=>{if(!localStorage.getItem('nekotsubushi:v2'))localStorage.setItem('nekotsubushi:v2',JSON.stringify(value));},source);
const p=await ctx.newPage();const report:any={method:'AI browser-operated trusted mouse, real elapsed clock, current visible WARNING only. Prerequisite stages 1/2 are seeded using the actual recorded qualifying baseline runs, not fabricated scores. No future deadline/step/fixture/engine mutation. Not human/physical-device play.',entry:null,goalMs:150,trials:[]};
try{
for(const delay of [380,420,420,450,450,520]){
 await p.goto('http://127.0.0.1:5180/?mode=3');await p.waitForFunction(()=>window.__ready&&!!window.__game);
 report.entry=await p.locator('script[type=module][src]').last().getAttribute('src');
 const r=(await p.locator('#stage').boundingBox())!;await p.mouse.move(r.x+470/941*r.width,r.y+850/1672*r.height);await p.mouse.down();
 await p.waitForFunction(()=>document.querySelector('#stage')?.getAttribute('data-phase')==='WARNING');
 const observed=Date.now();await p.waitForTimeout(delay);await p.mouse.up();const observationToReleaseMs=Date.now()-observed;
 await p.locator('.result-modal').waitFor();const result=await p.evaluate(()=>window.__game!.result());const passed=await p.locator('.stage-result').getAttribute('data-stage-passed');
 report.trials.push({requestedWaitMs:delay,observationToReleaseMs,result,stagePassed:passed==='true'});
 await p.screenshot({path:`${out}/final-punch-${report.trials.length}.png`,fullPage:true});console.log(JSON.stringify(report.trials.at(-1)));
 await writeFile(`${out}/final-punch-trials.json`,JSON.stringify(report,null,2));
}
}finally{await ctx.close();await browser.close();}
