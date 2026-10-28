/** Browser-operated real-clock calibration, not a human/device usability study. */
import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out='artifacts/unlock-play'; await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const context=await browser.newContext({viewport:{width:390,height:844},hasTouch:true});
const page=await context.newPage(); const runs:any[]=[];
const xy=async(x:number,y:number)=>{const b=(await page.locator('#stage').boundingBox())!;return{x:b.x+x/941*b.width,y:b.y+y/1672*b.height};};
const move=async(x:number,y:number)=>{const p=await xy(x,y);await page.mouse.move(p.x,p.y);};
const tap=async(x=650,y=850)=>{const p=await xy(x,y);await page.mouse.click(p.x,p.y,{delay:35});};
const phase=()=>page.locator('#stage').getAttribute('data-phase');
async function open(mode:number){await page.goto(`http://127.0.0.1:5177/?mode=${mode}`);await page.waitForFunction(()=>!!window.__game&&window.__ready);}
async function record(mode:number,strategy:string){await page.locator('.result-modal').waitFor({timeout:12000});const result=await page.evaluate(()=>window.__game!.result());runs.push({mode,strategy,result});await page.screenshot({path:`${out}/baseline-${mode}-${runs.length}.png`,fullPage:true});await writeFile(`${out}/baseline-123.json`,JSON.stringify({method:'AI browser-operated normal clock and trusted mouse. Only visible current phase observed, no fixture, step, future timing or direct game calls; not human play.',runs},null,2));console.log(JSON.stringify(runs.at(-1)));}
try {
 for(const strategy of ['cautious-260ms','rhythm-220ms']) {
  await open(1);await tap();let last='';
  while(await page.locator('#stage').getAttribute('data-status')!=='result'){
   const p=await phase();if(p!==last){console.log('poke',p);last=p;}
   if(p==='CLOSED'||strategy==='rhythm-220ms'&&p==='WARNING')await tap();
   await page.waitForTimeout(strategy==='cautious-260ms'?225:185);
  }
  await record(1,strategy);
 }
 for(const strategy of ['react-200ms-drag120ms','react-280ms-drag100ms']) {
  await open(2);await tap(470,1050);let done=false;
  while(!done){
   if(await page.locator('#stage').getAttribute('data-status')==='result')break;
   if(await phase()==='JUMP'){
    await page.waitForTimeout(strategy.startsWith('react-200')?200:280);
    if(await phase()==='JUMP'){
     await move(470,1050);await page.mouse.down();
     const start=Date.now();for(let i=1;i<=6;i++){await move(470+235*i/6,1050);await page.waitForTimeout(strategy.startsWith('react-200')?20:16);}
     await page.mouse.up();console.log('box swipe duration',Date.now()-start);
    }
    await page.waitForTimeout(450);
   }else await page.waitForTimeout(50);
  }
  await record(2,strategy);
 }
 for(const delay of [300,470,570,670]){
  await open(3);await move(470,850);await page.mouse.down();
  while(await phase()!=='WARNING'&&await page.locator('#stage').getAttribute('data-status')!=='result')await page.waitForTimeout(45);
  await page.waitForTimeout(delay);await page.mouse.up();await record(3,`release-${delay}ms-after-visible-warning`);
 }
}finally{await context.close();await browser.close();}
