/** Real-clock trusted browser input with cached coordinates; not human play. */
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/unlock-play';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844}});const page=await context.newPage();
const report:any={sourceCommit:'88b87303b83b4269adba07fb1390ad75cceaa20b',method:'AI browser-operated trusted mouse, normal clock. Current phase only, cached coordinates, no future deadlines/fixtures/steps/engine changes. Not a human or physical-device usability study.',runs:[]};
async function open(mode:number){await page.goto(`http://127.0.0.1:5177/?mode=${mode}`);await page.waitForFunction(()=>window.__ready&&!!window.__game);const b=(await page.locator('#stage').boundingBox())!;return(x:number,y:number)=>({x:b.x+x/941*b.width,y:b.y+y/1672*b.height});}
const phase=()=>page.evaluate(()=>({phase:document.querySelector('#stage')?.getAttribute('data-phase'),status:document.querySelector('#stage')?.getAttribute('data-status')}));
async function record(mode:number,strategy:string,extra:any={}){await page.locator('.result-modal').waitFor({timeout:15000});const result=await page.evaluate(()=>window.__game!.result());report.runs.push({mode,strategy,result,...extra});await page.screenshot({path:`${out}/baseline-fast-${mode}-${report.runs.length}.png`,fullPage:true});await writeFile(`${out}/baseline-123-fast.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report.runs.at(-1)));}
try{
 for(const cadence of [220,150]){
  const xy=await open(1),at=xy(650,850);await page.mouse.click(at.x,at.y,{delay:20});let inputs=1;const started=Date.now();
  for(;;){const s=await phase();if(s.status==='result')break;if(s.phase==='CLOSED'){await page.mouse.click(at.x,at.y,{delay:20});inputs++;}await page.waitForTimeout(cadence);}
  await record(1,`closed-only-${cadence}ms-cadence`,{inputs,wallMs:Date.now()-started});
 }
 for(const reaction of [100,190]){
  const xy=await open(2),a=xy(470,1050),b=xy(730,1050);await page.mouse.click(a.x,a.y,{delay:20});const timings=[];
  while((await phase()).status!=='result'){
   await page.waitForFunction(()=>['JUMP','result'].includes(document.querySelector('#stage')?.getAttribute('data-phase')??'')||document.querySelector('#stage')?.getAttribute('data-status')==='result');
   if((await phase()).status==='result')break;
   await page.waitForTimeout(reaction);const start=Date.now();await page.mouse.move(a.x,a.y);await page.mouse.down();await page.mouse.move(b.x,b.y);await page.mouse.up();timings.push(Date.now()-start);
   await page.waitForFunction(()=>document.querySelector('#stage')?.getAttribute('data-phase')!=='JUMP');
  }
  await record(2,`${reaction}ms-reaction-one-swipe`,{swipeApiWallMs:timings});
 }
 for(const delay of [300,450,520,670]){
  const xy=await open(3),a=xy(470,850);await page.mouse.move(a.x,a.y);await page.mouse.down();
  await page.waitForFunction(()=>document.querySelector('#stage')?.getAttribute('data-phase')==='WARNING');
  await page.waitForTimeout(delay);await page.mouse.up();await record(3,`${delay}ms-after-visible-warning`);
 }
}finally{await context.close();await browser.close();}
