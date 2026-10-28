import test,{afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {sharingOrigin,wasCancelled,bundledAssetURL} from '../src/native.ts';
import {path as pixiPath} from 'pixi.js';
import {shareLink,shareCaption,xIntent,shareSocial,type ShareCard} from '../src/share.ts';
import {normalContext,type RunResult} from '../src/progression.ts';
const locationDescriptor=Object.getOwnPropertyDescriptor(globalThis,'location');
const navigatorDescriptor=Object.getOwnPropertyDescriptor(globalThis,'navigator');
const result=(mode:RunResult['mode']):RunResult=>({mode,rulesVersion:2,success:true,count:[1,2,4].includes(mode)?12:0,maxStreak:0,specialCount:0,perfectCount:0,maxPerfectStreak:0,remainingMs:mode===3?109:null,survivalMs:mode===6?15000:0,nearMissMs:0});
const file=new File(['cat'],'cat.png',{type:'image/png'});
const card:ShareCard={url:'https://nekotsubushi.vercel.app/?mode=5',blob:file,file,objectUrl:'blob:card',text:'猫のほっぺ'};
afterEach(()=>{for(const [key,descriptor] of [['location',locationDescriptor],['navigator',navigatorDescriptor]] as const){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else Reflect.deleteProperty(globalThis,key);}});
test('Pixi resolves bundled textures under the actual Capacitor host',()=>{
  for(const base of ['capacitor://localhost/','https://nekotsubushi.vercel.app/']){
    const url=bundledAssetURL('/assets/m01-cat.webp',base);
    assert.equal(pixiPath.toAbsolute(url,base),base+'assets/m01-cat.webp');
  }
});
test('native origins always export an HTTPS playable public URL',()=>{
  assert.equal(sharingOrigin('capacitor://localhost'),'https://nekotsubushi.vercel.app');
  assert.equal(sharingOrigin('null'),'https://nekotsubushi.vercel.app');
  assert.equal(sharingOrigin('http://127.0.0.1:5180'),'http://127.0.0.1:5180');
  Object.defineProperty(globalThis,'location',{configurable:true,value:{origin:'capacitor://localhost'}});
  for(const mode of [1,2,3,4,6] as const){const url=new URL(shareLink(normalContext(mode,1),result(mode)));assert.equal(url.origin,'https://nekotsubushi.vercel.app');assert.ok(url.searchParams.has('challenge'));}
});
test('cheek sharing has no invented score or unsupported challenge token',()=>{
  const link=new URL(shareLink(normalContext(5,1),result(5)));
  assert.equal(link.searchParams.get('mode'),'5');assert.equal(link.searchParams.has('challenge'),false);
  assert.match(shareCaption(result(5)),/ほっぺ|もちもち/);assert.doesNotMatch(shareCaption(result(5)),/0 回|最高|超えられる/);
});
test('X intent correctly encodes Japanese text and exactly one playable link',()=>{
  const url=new URL(xIntent(normalContext(3,42),result(3)));
  assert.equal(url.origin,'https://x.com');assert.equal(url.pathname,'/intent/tweet');
  assert.match(url.searchParams.get('text')!,/0.109/);assert.match(url.searchParams.get('url')!,/challenge=/);
});
test('Instagram and TikTok use image files rather than silently sending a URL-only share',async()=>{
  for(const target of ['instagram','tiktok'] as const){let payload:ShareData|undefined;
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{canShare:()=>true,share:async(value:ShareData)=>{payload=value;}}});
    assert.equal(await shareSocial(card,target),'shared');assert.deepEqual(payload?.files,[file]);assert.equal(payload?.url,undefined);
  }
});
test('unsupported file sharing offers the export fallback without pretending to post',async()=>{
  let calls=0;Object.defineProperty(globalThis,'navigator',{configurable:true,value:{canShare:()=>false,share:async()=>{calls++;}}});
  assert.equal(await shareSocial(card,'instagram'),'fallback');assert.equal(calls,0);
});
test('native and web cancellation are recognized without treating failures as cancellation',()=>{
  assert.equal(wasCancelled(new Error('Share canceled')),true);assert.equal(wasCancelled(new DOMException('Cancelled','AbortError')),true);assert.equal(wasCancelled(new Error('Disk full')),false);
});
