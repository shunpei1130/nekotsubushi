import {Application, Assets, Graphics, MeshPlane, Rectangle, Sprite, Texture} from 'pixi.js';
import {GameEngine, W, H} from './engine';
import {asset} from './data';
import {boxCatPose, type BoxCatPose} from './choreography';
import {deformCheek} from './cheek';
import {HatChoreography, type HatFrame, type HatPose} from './hat';
import {reactionFrame,earReactionOffset,type ReactionFrame} from './reactions';
import {isNative} from './native';

// WKWebView's capacitor:// bundle is served by a URL-scheme handler. Fetches
// from Pixi's image worker cannot use that handler; native <img> decoding can.
// Keep the same source pixels and GPU meshes, without the worker fetch path.
if(isNative())Assets.setPreferences({preferWorkers:false,preferCreateImageBitmap:false,crossOrigin:null});

type Placement={x:number;y:number;w:number;h:number};
type Rig={mesh:MeshPlane;base:Float32Array;place:Placement};
const id=(n:number)=>String(n).padStart(2,'0');
const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
const smooth=(a:number,b:number,x:number)=>{const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t)};
const leases=new Map<string,{count:number;promise:Promise<Texture>}>();
const retirements=new Map<string,Promise<void>>();
function retainTexture(name:string):Promise<Texture>{
 const held=leases.get(name);if(held){held.count++;return held.promise;}
 const promise=(retirements.get(name)||Promise.resolve()).then(()=>Assets.load<Texture>(asset(name)));
 leases.set(name,{count:1,promise});return promise;
}
function releaseTexture(name:string){
 const held=leases.get(name);if(!held||--held.count>0)return;leases.delete(name);
 const pending=held.promise.then(()=>Assets.unload(asset(name))).then(()=>{if(retirements.get(name)===pending)retirements.delete(name)}).catch(()=>{});
 retirements.set(name,pending);
}

/** Shared production scene: independent clean plates, skeletal props and local fur meshes. */
export class GameScene {
 private app!:Application;
 private textures:Record<string,Texture>={};
 private rig!:Rig;
 private cat!:MeshPlane;
 private props:Record<string,Sprite>={};
 private fx=new Graphics();
 private shadow=new Graphics();
 private effectText!:HTMLDivElement;
 private destroyed=false;
 private contextLost=false;
 private host:HTMLElement;
 private engine:GameEngine;
 private options:{fixture:boolean;reduced:boolean};
 private idleClock=0;
 private presentationClock=0;
 private wallTime=performance.now();
 private _texture='';
 private acquired:string[]=[];
 private bodyOffset={x:0,y:0};
 private raisedPaw=0;
 private releasedPaw=0;
 private previousPhase='';
 private phaseEntered=0;
 private boxPose:BoxCatPose|null=null;
 private cheekContact={x:737,y:871,strength:1};
 private hatMotion=new HatChoreography();
 private hatFrame:HatFrame|null=null;
 private reactionId:string|null=null;
 private reactionStarted=0;
 private lastReactionEvent=0;
 private reactionState:ReactionFrame=reactionFrame(null,Infinity);
 private constructor(host:HTMLElement,engine:GameEngine,options:{fixture:boolean;reduced:boolean}){this.host=host;this.engine=engine;this.options=options}
 static async create(host:HTMLElement,engine:GameEngine,options:{fixture:boolean;reduced:boolean}){
  const scene=new GameScene(host,engine,options);try{await scene.init();return scene}catch(error){scene.destroy();throw error}
 }
 private async init(){
  const m=this.engine.mode,n=id(m);
  const names=[`m${n}-background`,`m${n}-cat`];
  if(m===1)names.push('m01-cat-open','m03-hand');
  if(m===2)names.push('m02-cat-idle','m02-box-open','m02-box-back','m02-box-front');
  if(m===3)names.push('m03-body','m03-paw','m03-hand');
  if(m===4)names.push('m04-banana','m04-fish');
  if(m===5)names.push('m05-hand-clean','m05-blink');
  if(m===6)names.push('m06-cat-idle','m06-wand');
  this.acquired=names;
  await Promise.all(names.map(async name=>{this.textures[name]=await retainTexture(name)}));
  this.app=new Application();
  // Keep the original logical stage and mesh, while drawing only the pixels
  // the display can show. Native reference captures retain full resolution.
  const density=this.resolutionForDisplay();
  await this.app.init({width:W,height:H,resolution:density,autoDensity:true,autoStart:false,antialias:true,backgroundAlpha:0,preference:'webgl',preserveDrawingBuffer:true});
  const canvas=this.app.canvas;canvas.style.cssText='position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';canvas.setAttribute('aria-hidden','true');
  canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();this.contextLost=true;this.engine.pause();this.host.dispatchEvent(new CustomEvent('neko:graphicslost',{bubbles:true}));});
  this.host.prepend(canvas);
  const bg=new Sprite(this.textures[`m${n}-background`]);bg.width=W;bg.height=H;this.app.stage.addChild(bg,this.shadow);
  if(m===2){
   this.props.ghost=new Sprite(this.textures['m02-box-open']);
   this.props.boxBack=new Sprite(this.textures['m02-box-back']);
   this.app.stage.addChild(this.props.ghost,this.props.boxBack);
  }
  if(m===4){
   this.props.floorBanana=new Sprite(this.textures['m04-banana']);
   this.props.floorFish=new Sprite(this.textures['m04-fish']);
   this.app.stage.addChild(this.props.floorBanana,this.props.floorFish);
  }
  const placements:Record<number,Placement>={1:{x:-17,y:159,w:914,h:1375},2:{x:10,y:300,w:635,h:610},3:{x:0,y:-3,w:941,h:1532},4:{x:155,y:353,w:753,h:866},5:{x:0,y:0,w:941,h:1672},6:{x:29,y:516,w:790,h:830}};
  const texture=this.textures[`m${n}-cat`];
  this.cat=new MeshPlane({texture,verticesX:33,verticesY:43});this.cat.autoResize=false;
  const place=placements[m];this.cat.position.set(place.x,place.y);this.cat.scale.set(place.w/texture.width,place.h/texture.height);
  this.rig={mesh:this.cat,base:new Float32Array(this.cat.geometry.positions),place};
  this.app.stage.addChild(this.cat);
  const prop=(name:string,key=name)=>{const s=new Sprite(this.textures[name]);this.app.stage.addChild(s);this.props[key]=s;return s};
  if(m===1)prop('m03-hand','hand');
  if(m===2)prop('m02-box-front','boxFront');
  if(m===3){prop('m03-paw','paw');prop('m03-hand','hand')}
  if(m===4){prop('m04-banana','hat');prop('m04-banana','fallBanana');prop('m04-fish','fallFish')}
  if(m===5){
   prop('m05-blink','blink');
   // These are crops of the existing aligned eyelid painting, not new eyes or
   // face replacements. Both retain the original nose, pupils and skull below.
   for(const [key,frame] of [['reactionLeftEye',new Rectangle(0,460,345,235)],['reactionRightEye',new Rectangle(395,565,340,220)]] as const){
    const eyelid=new Sprite(new Texture({source:this.textures['m05-blink'].source,frame}));
    eyelid.visible=false;this.app.stage.addChild(eyelid);this.props[key]=eyelid;
   }
   prop('m05-hand-clean','hand');
  }
  if(m===6)prop('m06-wand','wand');
  this.app.stage.addChild(this.fx);
  this.effectText=document.createElement('div');this.effectText.className='scene-effects';this.effectText.style.cssText='position:absolute;inset:0;pointer-events:none';this.host.append(this.effectText);
  this.render();
 }
 private resolutionForDisplay(){
  const width=this.host.getBoundingClientRect().width||this.host.clientWidth;
  return this.options.fixture?1:Math.min(1,Math.max(.35,width*(globalThis.devicePixelRatio||1)/W));
 }
 resizeResolution(){
  if(this.destroyed||this.contextLost||!this.app?.renderer)return;
  const density=this.resolutionForDisplay();
  if(Math.abs(this.app.renderer.resolution-density)>.005)this.app.renderer.resize(W,H,density);
 }
 /** Reuse decoded textures and WebGL resources for an immediate same-mode retry. */
 reset(engine:GameEngine){
  if(this.destroyed||this.contextLost)throw new Error('Scene must be recreated after graphics loss');
  if(engine.mode!==this.engine.mode)throw new Error('A scene can only reset to the same game mode');
  this.engine=engine;
  this.idleClock=0;this.presentationClock=0;this.wallTime=performance.now();
  this.bodyOffset={x:0,y:0};this.raisedPaw=0;this.releasedPaw=0;
  this.previousPhase='';this.phaseEntered=0;this.boxPose=null;
  this.hatMotion=new HatChoreography();this.hatFrame=null;
  this.cheekContact={x:737,y:871,strength:1};
  this.reactionId=null;this.reactionStarted=0;this.lastReactionEvent=0;
  this.reactionState=reactionFrame(null,Infinity);
  for(const prop of Object.values(this.props)){
   prop.visible=false;prop.alpha=1;prop.rotation=0;
   prop.pivot.set(0,0);prop.position.set(0,0);prop.scale.set(1);
  }
  this.cat.pivot.set(0,0);this.cat.alpha=1;this.cat.rotation=0;
  this.rig.mesh.geometry.positions.set(this.rig.base);
  this.effectText.replaceChildren();this.fx.clear();this.shadow.clear();
  this.render();
 }
 playReaction(id:string){
  if(this.options.fixture||!reactionFrame(id,0).active)return;
  this.reactionId=id;this.reactionStarted=this.presentationClock;
 }
 private texture(name:string){if(this._texture!==name){this._texture=name;this.cat.texture=this.textures[name]}}
 private fit(sprite:Sprite,x:number,y:number,w:number,h:number){sprite.position.set(x,y);sprite.width=w;sprite.height=h;sprite.visible=true}
 private ring(x:number,y:number,r:number,color=0xfff4ab,alpha=1){this.fx.circle(x,y,r).stroke({width:8,color,alpha});this.fx.circle(x,y,r+24).stroke({width:5,color,alpha:alpha*.65})}
 private rays(x:number,y:number,color=0xffda39){for(let i=0;i<3;i++){const a=-1.2+i*.65;this.fx.moveTo(x+Math.cos(a)*65,y+Math.sin(a)*65).lineTo(x+Math.cos(a)*91,y+Math.sin(a)*91).stroke({color:0xffffff,width:14});this.fx.moveTo(x+Math.cos(a)*65,y+Math.sin(a)*65).lineTo(x+Math.cos(a)*91,y+Math.sin(a)*91).stroke({color,width:8})}}
 private label(text:string,x:number,y:number,size=60,color='#4a2514'){const e=document.createElement('div');e.textContent=text;e.style.cssText=`position:absolute;left:${x/W*100}%;top:${y/H*100}%;font-size:${size}px;color:${color};font-weight:900;line-height:1;white-space:nowrap;-webkit-text-stroke:9px white;paint-order:stroke fill;text-shadow:0 3px 5px #7b422321;transform:rotate(-8deg)`;this.effectText.append(e)}
 render(){
  if(this.destroyed||this.contextLost)return;
  const e=this.engine,m=e.mode,p=this.rig.place;
  const now=performance.now();
  if(!this.options.fixture&&e.status!=='paused'&&!document.hidden){
   const delta=Math.max(0,now-this.wallTime)/1000;
   // Keep short reaction keyframes visible after a long render stall. This
   // clock stays active for reduced motion; only idle animation is optional.
   this.presentationClock+=Math.min(.05,delta);
   if(!this.options.reduced)this.idleClock+=Math.min(.05,delta);
  }
  this.wallTime=now;
  if(!this.options.fixture){
   const events=(e as GameEngine & {events?:readonly {id:number;type:string;tag?:string}[]}).events??[];
   for(const event of events)if(event.id>this.lastReactionEvent){
    this.lastReactionEvent=event.id;
    if(event.type==='cheek'&&event.tag)this.playReaction(`cheek-${event.tag}`);
    else if(event.type==='milestone'&&event.tag)this.playReaction(event.tag);
   }
  }
  this.reactionState=reactionFrame(this.reactionId,this.presentationClock-this.reactionStarted,this.options.reduced);
  const real=this.idleClock;
  if(this.previousPhase!==e.phase){
   if(e.phase==='SUCCESS'||e.phase==='PUNCH')this.releasedPaw=this.raisedPaw;
   this.previousPhase=e.phase;this.phaseEntered=this.presentationClock;
  }
  const phaseAge=this.options.fixture?0:Math.max(0,this.presentationClock-this.phaseEntered);
  const breath=Math.sin(real*2.1)*2.2;
  this.fx.clear();this.shadow.clear();this.effectText.replaceChildren();
  this.cat.position.set(p.x,p.y);this.cat.scale.set(p.w/this.cat.texture.width,p.h/this.cat.texture.height);this.cat.alpha=1;this.cat.rotation=0;
  let tx=0,ty=0,press=0;
  if(m===1){
   const opened=['OPEN_GRACE','OPEN','CAUGHT'].includes(e.phase);this.texture(opened?'m01-cat-open':'m01-cat');
   press=e.effect>0?Math.sin(Math.min(1,e.effect/.35)*Math.PI)*-18:0;
   if(this.options.fixture)press=-12;
   const contact=(e.effect>0&&['CLOSED','WARNING','OPEN_GRACE'].includes(e.phase))||this.options.fixture;
   const hand=this.props.hand;hand.visible=contact;
   if(contact){hand.pivot.set(460,790);hand.position.set(682,751);hand.scale.set(.72);hand.rotation=-.47;this.ring(682,751,49,0xfffae8,.75);this.rays(698,744);this.label('+1',782,710,89,'#ff8e18')}
   if(e.phase==='WARNING'){this.rays(750,330);this.label('…？',775,310,48)}
   if(opened){this.label(e.phase==='CAUGHT'?'見つかった！':'じーっ…',600,315,54);this.rays(760,320)}
   this.fx.moveTo(770,350).quadraticCurveTo(825,289,879,350).quadraticCurveTo(825,411,770,350).fill(0xfffcf2).stroke({width:15,color:0xfffcf2});
   this.fx.moveTo(770,350).quadraticCurveTo(825,289,879,350).quadraticCurveTo(825,411,770,350).stroke({width:8,color:0x4a2514});
   this.fx.circle(825,350,24).fill(0x4a2514).circle(833,341,7).fill(0xfffcf2);
   this.shadow.ellipse(476,1411,310,40).fill({color:0x392818,alpha:.15});
  }
  if(m===2){
   const reacting=e.phase==='REACTION';
   const pose=boxCatPose({phase:e.phase,phaseTime:e.phaseTime,phaseDuration:e.phaseDuration,outcome:e.encounterOutcome,boxX:e.boxX,ready:e.status==='ready',spawnFade:e.elapsed-e.phaseTime>.1});
   this.boxPose=pose;
   this.texture(pose.texture==='jump'?'m02-cat':'m02-cat-idle');
   this.cat.position.set(pose.x,pose.y);this.cat.scale.set(pose.width/this.cat.texture.width,pose.height/this.cat.texture.height);this.cat.rotation=pose.rotation;this.cat.alpha=pose.alpha;
   this.shadow.ellipse(pose.shadowX,pose.shadowY,205*pose.shadowScale,30*pose.shadowScale).fill({color:0x63492c,alpha:(.13+.05*pose.shadowScale)*pose.alpha});
   const offset=e.boxX-W*.5;
   this.fit(this.props.boxBack,250+offset,839,620,350);
   this.fit(this.props.boxFront,250+offset,839,620,350);
   this.fit(this.props.ghost,250,839,620,350);this.props.ghost.alpha=.22;this.props.ghost.visible=e.encounterOutcome==='SUCCESS';
   if(e.encounterOutcome==='SUCCESS'){
    this.label('スカッ！',620,407,80);
    this.fx.moveTo(380,987).bezierCurveTo(570,1047,650,1065,818,1018).stroke({color:0x9fccff,width:25,alpha:.55});
    this.fx.moveTo(380,987).bezierCurveTo(570,1047,650,1065,818,1018).stroke({color:0xffffff,width:13});
    this.fx.moveTo(786,998).lineTo(831,1012).lineTo(804,1047).stroke({color:0xffffff,width:14});
   }else if(e.phase==='CROUCH'){this.rays(570,720);this.label('いくニャ…',580,530,44)}
   else if(e.encounterOutcome==='EARLY')this.label('早かったニャ',480,600,51);
   else if(reacting)this.label('すぽっ',500,730,60);
  }
  if(m===3){
   this.texture('m03-body');
   const warning=e.phase==='WARNING'||this.options.fixture,punch=e.phase==='PUNCH';
   const strike=punch?Math.sin(Math.PI*clamp(phaseAge/.42,0,1)):0;
   const raised=this.options.fixture?1:warning?smooth(0,.14,e.phaseTime):punch?1:e.phase==='SUCCESS'?this.releasedPaw*(1-smooth(.08,.34,phaseAge)):e.status==='playing'?.25:0;
   this.raisedPaw=raised;
   const paw=this.props.paw;
   // Pivot at the actual shoulder, not the transparent canvas origin.
   paw.pivot.set(860,1220);paw.position.set(983-strike*15,1171-strike*20+(1-raised)*130);
   paw.scale.set(.8*(1+strike*.2));paw.rotation=-strike*.65+(1-raised)*.17;paw.visible=true;
   const retreat=punch?smooth(.10,.38,phaseAge):e.phase==='SUCCESS'?smooth(0,.24,phaseAge):0;
   // Extend the wrist below the viewport while holding the nail contact fixed;
   // the isolated source ends slightly above its canvas's lower edge.
   const hand=this.props.hand;this.fit(hand,retreat*65,-76.31+retreat*940,941,1789.04);hand.visible=e.status==='playing'||((punch||e.phase==='SUCCESS')&&retreat<1)||this.options.fixture;
   if(hand.visible&&retreat<.05){this.ring(463,833,49);if(warning){this.rays(810,420);this.label('！',817,355,80,'#ffdf3e')}}
   this.shadow.ellipse(472,1230,370,30).fill({color:0x4a2514,alpha:.12});
  }
  if(m===4){
   this.cat.rotation=0;this.cat.pivot.set(0,0);
   const hats=this.hatMotion.sample(e,this.presentationClock);this.hatFrame=hats;
   const placeHat=(sprite:Sprite,pose:HatPose)=>{
    sprite.pivot.set(800,750);sprite.position.set(pose.x,pose.y);
    sprite.scale.set(pose.width/sprite.texture.width,pose.height/sprite.texture.height);
    sprite.rotation=pose.rotation;
   };
   const hat=this.props.hat;hat.texture=this.textures[hats.head.kind==='fish'?'m04-fish':'m04-banana'];
   placeHat(hat,hats.head.pose);hat.visible=hats.head.visible;
   placeHat(this.props.floorBanana,hats.floor.banana.pose);this.props.floorBanana.visible=hats.floor.banana.visible;
   placeHat(this.props.floorFish,hats.floor.fish.pose);this.props.floorFish.visible=hats.floor.fish.visible;
   this.props.fallBanana.visible=false;this.props.fallFish.visible=false;
   for(const drop of hats.falling){
    const sprite=drop.kind==='banana'?this.props.fallBanana:this.props.fallFish;
    placeHat(sprite,drop.pose);sprite.visible=true;
    this.shadow.ellipse(drop.pose.x,drop.kind==='banana'?1325:1125,65+drop.progress*30,9+drop.progress*5).fill({color:0x4a2514,alpha:.08+.07*drop.progress});
   }
   this.shadow.ellipse(515,1193,299,27).fill({color:0x4a2514,alpha:.13});
   this.ring(470,1394,43,0xfff7c3,.95);this.fx.circle(470,1394,103).stroke({width:7,color:0xffffe0,alpha:.8});
   if(e.effect>0||this.options.fixture){this.label('+1',635,318,76,'#ffd630');for(const [x,y] of [[591,285],[645,244],[727,382]]){this.fx.star(x,y,4,26,7).fill(0xffed60)}}
  }
  if(m===5){
   tx=e.cheekX;ty=e.cheekY;
   const blink=this.props.blink,cycle=real%5.4;
   this.fit(blink,p.x,p.y+breath*.87,p.w,p.h);blink.visible=e.phase==='IDLE'&&cycle>4.7&&cycle<4.82;
   const reaction=this.reactionState;
   const left=this.props.reactionLeftEye,right=this.props.reactionRightEye;
   this.fit(left,p.x,p.y+460*p.h/1672+breath*.87,345*p.w/941,235*p.h/1672);
   this.fit(right,p.x+395*p.w/941,p.y+565*p.h/1672+breath*.87,340*p.w/941,220*p.h/1672);
   left.visible=reaction.active&&reaction.closeLeft;
   right.visible=reaction.active&&reaction.closeRight;
   if(left.visible||right.visible)blink.visible=false;
   const pulling=Math.abs(tx)+Math.abs(ty)>1;
   this.props.hand.visible=e.phase==='DRAGGING';
   if(pulling&&e.phase==='SPRING_BACK')this.label('ぷるん',713,680,43);
  }
  if(m===6){
   this.texture('m06-cat');
   const dx=e.catX-715.16,dy=e.catY-635.36;
   // The body follows behind the target paw, with a bounded shoulder reach.
   const reachX=clamp(dx,-58,58),reachY=clamp(dy,-62,62);
   this.bodyOffset.x=dx-reachX;this.bodyOffset.y=dy-reachY;
   this.cat.position.set(p.x+this.bodyOffset.x,p.y+this.bodyOffset.y);
   this.shadow.ellipse(450+this.bodyOffset.x,1299+this.bodyOffset.y,225,50).fill({color:0x6c4931,alpha:.17});
   const wand=this.props.wand;
   // Generated master connector (855,360) → the same logical control anchor as input.
   this.fit(wand,e.toyX-855*.32,e.toyY-360*.32,1224*.32,1285*.32);
   this.ring(e.toyX,e.toyY,38,0xf4ffff,.95);this.fx.circle(e.toyX,e.toyY,66).fill({color:0x95e6ff,alpha:.2});
   const distance=Math.hypot(e.catX-(e.toyX-40),e.catY-(e.toyY+150));
   if(distance<240||this.options.fixture){this.label('おしい！',545+dx*.15,530+dy*.15,46);this.rays(e.catX-65,e.catY+10)}
   if(e.pointerId!==null||this.options.fixture){this.fx.moveTo(e.toyX-390,e.toyY+25).bezierCurveTo(e.toyX-230,e.toyY-95,e.toyX-140,e.toyY-60,e.toyX,e.toyY).stroke({color:0x93cfff,width:22,alpha:.35});this.fx.moveTo(e.toyX-390,e.toyY+25).bezierCurveTo(e.toyX-230,e.toyY-95,e.toyX-140,e.toyY-60,e.toyX,e.toyY).stroke({color:0xeaffff,width:12,alpha:.92})}
  }
  // One stable UV master. Independent cheek falloff leaves eyes, nose and skull fixed.
  const {base,mesh}=this.rig,vertices=mesh.geometry.positions;
  const tw=mesh.texture.width,th=mesh.texture.height;
  if(m===5){
   const contact=deformCheek(base,vertices,{textureWidth:tw,textureHeight:th,stageWidth:W,stageHeight:H,side:e.cheekSide,anchorX:e.cheekAnchorX,anchorY:e.cheekAnchorY,dx:tx,dy:ty,verticesX:33,verticesY:43});
   const contactBreath=real?breath*Math.sin(Math.PI*clamp((e.cheekAnchorY/H-.1)/.88,0,1)):0;
   this.cheekContact={x:contact.contactX,y:contact.contactY+contactBreath,strength:contact.strength};
  }
  for(let i=0;i<vertices.length;i+=2){
   const x=base[i],y=base[i+1],nx=x/tw,ny=y/th;
   let dx=0,dy=0;
   if(m===4){
    const head=1-smooth(.40,.67,ny);dy+=35*head;
    if(e.phase==='REMOVING')dx+=Math.sin(e.phaseTime*85)*30*head;
   }
   if(m===1){const f=Math.exp(-(((nx-.75)/.18)**2+((ny-.43)/.15)**2)*2);dx=press*f;dy=press*.12*f;
    // Tail and ear tips have their own attached influence fields.
    if(real){dx+=Math.sin(real*2.5)*8*Math.exp(-(((nx-.09)/.12)**2+((ny-.57)/.25)**2));dy+=Math.sin(real*2.9)*3*Math.exp(-(((nx-.78)/.15)**2+((ny-.10)/.1)**2))}
   }
   if(m===6){
    const arm=smooth(.66,.85,nx)*(1-smooth(.24,.55,ny));
    dx+=(e.catX-715.16-this.bodyOffset.x+10)*tw/p.w*arm;
    dy+=(e.catY-635.36-this.bodyOffset.y-45)*th/p.h*arm;
    if(real){
     const tail=Math.exp(-(((nx-.15)/.2)**2+((ny-.14)/.22)**2));
     dx+=Math.sin(real*3.1)*8*tail;
     const leftPaw=Math.exp(-(((nx-.43)/.13)**2+((ny-.55)/.16)**2));
     dy+=Math.sin(real*4.5)*5*leftPaw;
    }
   }
   if(real&&m!==2&&m!==6){dy+=breath*Math.sin(Math.PI*clamp((ny-.1)/.88,0,1));}
   if(!this.options.fixture&&this.reactionState.active){
    const ear=earReactionOffset(nx,ny,this.reactionState);
    dx+=ear.x*tw/p.w;dy+=ear.y*th/p.h;
   }
   vertices[i]=(m===5?vertices[i]:x)+dx;vertices[i+1]=(m===5?vertices[i+1]:y)+dy;
  }
  if(m===5&&this.props.hand.visible){
   const hand=this.props.hand,{x,y}=this.cheekContact;
   hand.pivot.set(460,350);hand.scale.set((e.cheekSide==='left'?-1:1)*530/1536,530/1536);hand.position.set(x,y);hand.rotation=0;
   this.ring(x,y,37);this.label('むに〜',e.cheekSide==='left'?115:756,610,58);
  }
  mesh.geometry.getBuffer('aPosition').update();
  this.app.renderer.render(this.app.stage);
 }
 visual(){
  const hand=this.props.hand,paw=this.props.paw;
  return{mode:this.engine.mode,cat:{x:this.cat.x,y:this.cat.y,width:this.cat.width,height:this.cat.height,alpha:this.cat.alpha},box:this.boxPose?{...this.boxPose,opening:{x:572.9167+this.engine.boxX-W*.5,y:919.3223}}:null,hand:hand?{visible:hand.visible,x:hand.x,y:hand.y}:null,paw:paw?{x:paw.x,y:paw.y,rotation:paw.rotation}:null,cheek:{...this.cheekContact,contact:{x:this.cheekContact.x,y:this.cheekContact.y}},hats:this.hatFrame,eyesClosed:this.props.blink?.visible??false,reaction:{...this.reactionState,leftEyeClosed:this.props.reactionLeftEye?.visible??false,rightEyeClosed:this.props.reactionRightEye?.visible??false},layers:this.engine.mode===2?['background','shadow','ghost','boxBack','cat','boxFront','effects']:[]};
 }
 reactionComplete(){
  if(this.engine.mode!==3)return true;
  const duration=this.engine.phase==='PUNCH'?.42:this.engine.phase==='SUCCESS'?.24:0;
  return this.presentationClock-this.phaseEntered>=duration;
 }
 destroy(){if(this.destroyed)return;this.destroyed=true;this.effectText?.remove();if(this.app?.renderer)this.app.destroy(true,{children:true,texture:false,textureSource:false});for(const name of this.acquired)releaseTexture(name);this.acquired=[];}
}
