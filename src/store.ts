type Save={schemaVersion:1;sound:boolean;reduced:boolean;records:Record<string,number>;clears:number;seen:number[]};
const defaults:Save={schemaVersion:1,sound:true,reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,records:{},clears:0,seen:[]};
export let save:Save={...defaults,records:{}};
try{const s=JSON.parse(localStorage.getItem('nekotsubushi:v1')||'null');if(s?.schemaVersion===1){
 save={...defaults,records:{},seen:[]};
 for(const [k,v] of Object.entries(s.records||{}))if(['1','2','3','4','6'].includes(k)&&typeof v==='number'&&Number.isFinite(v)&&v>=0)save.records[k]=Math.floor(v);
 save.sound=typeof s.sound==='boolean'?s.sound:true;save.reduced=typeof s.reduced==='boolean'?s.reduced:defaults.reduced;
 save.seen=Array.isArray(s.seen)?[...new Set<number>(s.seen.filter((v:unknown)=>typeof v==='number'&&Number.isInteger(v)&&v>=1&&v<=6))]:[];
 save.clears=typeof s.clears==='number'&&Number.isFinite(s.clears)&&s.clears>=0?Math.floor(s.clears):0;
}}catch{}
export function persist(){try{localStorage.setItem('nekotsubushi:v1',JSON.stringify(save))}catch{}}
let audio:AudioContext|undefined;
export function sound(kind:'tap'|'success'|'caught'|'spring'='tap'){
 if(!save.sound)return;try{audio??=new AudioContext();void audio.resume();const o=audio.createOscillator(),g=audio.createGain(),t=audio.currentTime;o.type='sine';o.frequency.setValueAtTime(kind==='caught'?180:kind==='spring'?450:620,t);o.frequency.exponentialRampToValueAtTime(kind==='success'?950:kind==='spring'?170:250,t+.13);g.gain.setValueAtTime(.065,t);g.gain.exponentialRampToValueAtTime(.001,t+.16);o.connect(g);g.connect(audio.destination);o.start(t);o.stop(t+.17);}catch{}
}
