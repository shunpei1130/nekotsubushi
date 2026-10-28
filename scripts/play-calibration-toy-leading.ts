/** Real-clock trusted CDP mouse stream. Queued transport avoids per-event RPC waits. */
import {chromium} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
const out='artifacts/unlock-play';await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:'/usr/bin/chromium',args:['--no-sandbox','--disable-dev-shm-usage']});
const ctx=await browser.newContext({viewport:{width:390,height:844}});const page=await ctx.newPage();const cdp=await ctx.newCDPSession(page);
const report:any={sourceCommit:'88b87303b83b4269adba07fb1390ad75cceaa20b',method:'AI-operated normal-clock trusted CDP mouse stream, cached screen coordinates and continuous geometric route; not a human/physical-device playtest. No future timings/engine changes/fixture/step. Protocol packets are sent at wall-clock intervals without waiting for each renderer acknowledgement.',runs:[]};
try{
for(const period of [1100,1300]){
 await page.goto('http://127.0.0.1:5177/?mode=6');await page.waitForFunction(()=>window.__ready&&!!window.__game);
 const r=(await page.locator('#stage').boundingBox())!;const xy=(x:number,y:number)=>({x:r.x+x/941*r.width,y:r.y+y/1672*r.height});
 const at=xy(846.9,300.96);await cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',...at});
 const pending:Promise<any>[]=[];const started=Date.now();
 pending.push(cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',buttons:1,clickCount:1,...at}));
 let sent=0;
 while(Date.now()-started<15500){
  const elapsed=(Date.now()-started)/1000;let distance=240+elapsed*period;
  const corners=[[846.9,300.96],[90,300.96],[90,1437.92],[865.72,1437.92],[865.72,300.96],[90,300.96]];
  let i=0;let length=()=>Math.hypot(corners[i+1][0]-corners[i][0],corners[i+1][1]-corners[i][1]);
  while(distance>length()){distance-=length();i++;if(i===corners.length-1)i=1;}const f=distance/length();
  const point=xy(corners[i][0]+(corners[i+1][0]-corners[i][0])*f,corners[i][1]+(corners[i+1][1]-corners[i][1])*f);
  pending.push(cdp.send('Input.dispatchMouseEvent',{type:'mouseMoved',button:'left',buttons:1,...point}));sent++;
  await new Promise(done=>setTimeout(done,33));
 }
 await Promise.allSettled(pending);await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',buttons:0,clickCount:1,...xy(846.9,300.96)});
 await page.waitForTimeout(600);const state=await page.evaluate(()=>{const s=window.__game!.snapshot();return{status:s.status,phase:s.phase,elapsed:s.elapsed,metrics:s.metrics,success:s.success,toyX:s.toyX,toyY:s.toyY,catX:s.catX,catY:s.catY};});
 report.runs.push({mode:6,strategy:`continuous-perimeter-${period}pxs-initial240px-target`,wallMs:Date.now()-started,events:sent,result:state});
 await page.screenshot({path:`${out}/baseline-stream-toy-${period}pxs.png`,fullPage:true});await writeFile(`${out}/baseline-toy-stream-leading.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report.runs.at(-1)));
 if(state.success)break;
}
}finally{await ctx.close();await browser.close();}
