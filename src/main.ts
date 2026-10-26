import './style.css';
import { GameEngine, W, H } from './engine';
import { GameScene } from './scene';
import { modes, asset, icons } from './data';
import { save, persist, sound } from './store';

declare global {
  interface Window {
    __ready: boolean;
    __game?: {
      engine: GameEngine;
      snapshot: () => ReturnType<GameEngine['snapshot']>;
      step: (ms: number) => ReturnType<GameEngine['snapshot']>;
      fixture: () => ReturnType<GameEngine['snapshot']>;
      visual: () => ReturnType<GameScene['visual']>;
    };
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
const fixtureMode = params.get('fixture') === 'reference' || params.get('fixture') === '1';
const testMode = params.get('test') === '1';
const seed = Number(params.get('seed') || 627041);
let engine: GameEngine | null = null;
let scene: GameScene | null = null;
let resizeObserver: ResizeObserver | null = null;
let abort: AbortController | null = null;
let generation = 0;
let scale = 1;
let lastNow = performance.now();
let recorded = false;
let previousScore = 0;
let previousPhase = '';
let modalState = '';
let loading = false;
let resultRevealsAt = 0;
window.__ready = false;

const two = (v: number) => String(v).padStart(2, '0');
const bestFor = (id: number) => (save.records[String(id)] || 0) / (id === 3 || id === 6 ? 1000 : 1);
const recordLabel = (id: number) => id === 5 ? 'いつでも・気ままに' : bestFor(id) > 0 ? `最高 ${id === 3 || id === 6 ? bestFor(id).toFixed(1) + ' 秒' : bestFor(id) + ' 回'}` : 'はじめての、ねこあそび';
const soundIcon = () => save.sound ? icons.sound : icons.muted;

function cleanup() {
  generation++;
  abort?.abort(); abort = null;
  resizeObserver?.disconnect(); resizeObserver = null;
  scene?.destroy(); scene = null;
  engine = null;
  delete window.__game;
  modalState = '';
  loading = false;
}

async function menu() {
  cleanup();
  window.__ready = false;
  document.body.className = 'menu-page';
  const menuParams = new URLSearchParams(location.search);
  menuParams.delete('mode'); menuParams.delete('fixture'); menuParams.delete('capture'); menuParams.delete('time');
  history.replaceState({}, '', location.pathname + (menuParams.size ? '?' + menuParams : ''));
  document.title = '猫つぶし｜ひとゆび、ねこあそび。';
  app.innerHTML = `<main class="menu-shell">
    <header class="menu-header">
      <span class="menu-eyebrow">ちょっと、猫とひと休み。</span>
      <div class="brand"><span class="brand-paw">${icons.paw}</span><h1>猫つぶし<span class="brand-dot">。</span></h1></div>
      <p class="menu-subtitle">ひとゆび、ねこあそび。</p>
      <button class="icon-button menu-settings" data-action="settings" aria-label="音と動きの設定">${icons.settings}</button>
    </header>
    <div class="menu-section-label"><span>今日は、どの猫とあそぶ？</span><span>6つのあそび</span></div>
    <section class="mode-grid" aria-label="ゲームを選ぶ">${modes.map(m => `
      <button class="mode-card mode-card-${m.id}" data-mode="${m.id}" aria-label="${m.name}。${m.operation}。${m.time}">
        <div class="card-art"><span class="card-number">${two(m.id)}</span><span class="card-time">${m.time}</span>
          <span class="card-art-halo"></span><img src="${asset(`thumb-${two(m.id)}`)}" alt="${m.tag}" loading="eager" decoding="async">
          <span class="card-art-paw">${icons.paw}</span>
        </div>
        <div class="card-copy"><h2>${m.id === 6 ? 'あとちょっとで<br>届くのに' : m.name}</h2><p>${m.operation}</p><span class="card-record">${recordLabel(m.id)}</span><span class="card-arrow" aria-hidden="true">›</span></div>
      </button>`).join('')}
    </section>
    <footer class="menu-footer"><span>${icons.paw}</span><p>ふわふわを、ひとりじめ。<small>登録いらず。スマホでも、パソコンでも。</small></p></footer>
    <dialog id="settings-dialog" aria-labelledby="settings-title"><form method="dialog"><button class="dialog-close" aria-label="閉じる">×</button><span class="dialog-paw">${icons.paw}</span><h2 id="settings-title">あそびの設定</h2><label class="setting-row"><span>音をならす<small>ぷに、ぽふ。小さな音で。</small></span><input type="checkbox" name="sound" ${save.sound ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label><label class="setting-row"><span>動きをひかえめに<small>大きな揺れやきらめきを減らす</small></span><input type="checkbox" name="reduced" ${save.reduced ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label><button class="primary-button" value="close">これであそぶ</button><p class="settings-footnote">記録と設定は、この端末に保存されます。</p></form></dialog>
  </main>`;
  const dialog = document.querySelector<HTMLDialogElement>('#settings-dialog')!;
  dialog.addEventListener('change', () => {
    save.sound = dialog.querySelector<HTMLInputElement>('[name="sound"]')!.checked;
    save.reduced = dialog.querySelector<HTMLInputElement>('[name="reduced"]')!.checked;
    persist();
    document.body.classList.toggle('reduced-motion', save.reduced);
  });
  await Promise.allSettled(Array.from(app.querySelectorAll('img')).map(img => img.decode()));
  await document.fonts.ready;
  window.__ready = true;
}

function hudHtml(id: number) {
  const m = modes[id - 1];
  const paw = id === 1 || id === 2 ? `<span class="title-paw">${icons.paw}</span>` : '';
  const title = `<div class="game-title">${paw}<span><em>${two(id)}</em> ${m.name}</span>${paw}</div>`;
  const score = [1, 2, 4].includes(id) ? '<div class="score-plate"><strong data-hud="score">0</strong><span>回</span></div>' : '';
  const timer = [1, 2, 4, 6].includes(id) ? '<div class="time-plate"><span>あと</span><strong data-hud="time">30</strong><span>秒</span></div>' : '';
  const hold = id === 3 ? '<div class="best-plate"><span class="crown" aria-hidden="true">♛</span> 最高 <b data-hud="best">0.0</b> 秒</div><div class="hold-value"><strong data-hud="hold">0.0</strong><span>秒</span></div>' : '';
  const special = id === 5 ? `<button class="stage-icon reset-button" data-action="reset" aria-label="ほっぺを元に戻す">${icons.reset}</button>` : id === 6 ? `<button class="stage-icon pause-button" data-action="pause" aria-label="一時停止">${icons.pause}</button>` : '';
  const desc = id === 3 ? '<span class="yellow">長押し</span>でちょっかい<br>パンチの前に離す' : m.desc;
  return `${title}${score}${timer}${hold}${special}<p class="game-description">${id === 6 ? `<span class="description-paw">${icons.paw}</span>` : ''}<span>${desc}</span></p><div class="live-feedback" data-hud="feedback" aria-live="polite"></div><div class="ready-hint" data-hud="ready">${m.ready}</div>`;
}

async function startMode(id: number) {
  cleanup();
  window.__ready = false;
  loading = true;
  const request = generation;
  const playSeed = params.has('seed') || fixtureMode || testMode ? seed : Math.floor(Math.random() * 0x100000000);
  const current = new GameEngine(id, { seed: playSeed, best: bestFor(id) });
  engine = current;
  recorded = false;
  previousScore = 0;
  previousPhase = current.phase;
  resultRevealsAt = 0;
  document.body.className = `game-page${capture ? ' capture-page' : ''}${save.reduced ? ' reduced-motion' : ''}`;
  document.title = `${modes[id - 1].name}｜猫つぶし`;
  const gameParams = new URLSearchParams(location.search);
  gameParams.set('mode', String(id));
  history.replaceState({}, '', location.pathname + '?' + gameParams);
  app.innerHTML = `<main class="game-view">
    ${capture ? '' : `<nav class="game-nav" aria-label="ゲームの操作"><button class="nav-back" data-action="menu">${icons.back}<span>メニューへ</span></button><span class="nav-brand">猫つぶし</span><div class="nav-right"><button class="icon-button" data-action="sound" aria-label="${save.sound ? '音を消す' : '音を出す'}" aria-pressed="${save.sound}">${soundIcon()}</button>${id === 6 || id === 5 ? '' : `<button class="icon-button" data-action="pause" aria-label="一時停止">${icons.pause}</button>`}</div></nav>`}
    <div class="game-viewport"><div id="stage" class="stage mode-${id}" role="application" aria-label="${modes[id - 1].name}。${modes[id - 1].operation}"><div class="hud" aria-label="ゲームの状態">${hudHtml(id)}</div></div></div>
    <div class="load-layer"><span class="loading-paw">${icons.paw}</span><p>猫がおめかし中…</p><span>ふわふわを準備しています</span></div>
    <div id="modal-host"></div>
  </main>`;
  const stage = document.querySelector<HTMLDivElement>('#stage')!;
  const viewport = document.querySelector<HTMLDivElement>('.game-viewport')!;
  const fit = () => {
    scale = capture ? 1 : Math.max(0.05, Math.min(viewport.clientWidth / W, viewport.clientHeight / H));
    stage.style.width = `${W * scale}px`;
    stage.style.height = `${H * scale}px`;
    stage.style.setProperty('--stage-scale', String(scale));
    stage.style.setProperty('--hit-size', `${44 / scale}px`);
    stage.querySelector<HTMLElement>('.hud')!.style.transform = `scale(${scale})`;
  };
  resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(viewport);
  fit();
  try {
    const readyScene = await GameScene.create(stage, current, { fixture: fixtureMode, reduced: save.reduced });
    if (generation !== request) { readyScene.destroy(); return; }
    scene = readyScene;
    await document.fonts.ready;
    if (generation !== request) return;
    if (fixtureMode) current.fixture();
    else if (params.has('time')) current.update(Number(params.get('time')) * 1000);
    if (!save.seen.includes(id)) { save.seen.push(id); persist(); }
    loading = false;
    document.querySelector('.load-layer')?.remove();
    bindInput(stage);
    window.__game = {
      engine: current,
      snapshot: () => current.snapshot(),
      step: ms => { current.update(ms); draw(); return current.snapshot(); },
      fixture: () => { current.fixture(); draw(); return current.snapshot(); },
      visual: () => readyScene.visual()
    };
    lastNow = performance.now();
    draw();
    window.__ready = true;
  } catch (error) {
    if (generation !== request) return;
    loading = false;
    const layer = document.querySelector('.load-layer')!;
    layer.innerHTML = `<span class="loading-paw">${icons.paw}</span><h2>猫が、かくれんぼ中です。</h2><p>読み込みをもう一度おためしください。</p><button class="primary-button" data-action="retry">もう一度読み込む</button><button class="text-button" data-action="menu">メニューへ</button>`;
    console.error('Game assets could not be loaded', error);
  }
}

function advance() {
  const now = performance.now();
  const dt = now - lastNow;
  lastNow = now;
  if (engine && !fixtureMode && !testMode && !loading) engine.update(Math.max(0, dt));
}

function bindInput(stage: HTMLDivElement) {
  abort = new AbortController();
  const signal = abort.signal;
  const pos = (e: PointerEvent) => {
    const r = stage.getBoundingClientRect();
    return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height };
  };
  stage.addEventListener('pointerdown', e => {
    if ((e.target as Element).closest('button') || e.button !== 0 || loading || fixtureMode) return;
    advance();
    const p = pos(e);
    if (engine?.down(p.x, p.y, e.pointerId, scale)) {
      e.preventDefault();
      stage.setPointerCapture(e.pointerId);
      sound('tap');
      draw();
    }
  }, { signal });
  stage.addEventListener('pointermove', e => {
    if (!engine || e.pointerId !== engine.pointerId) return;
    e.preventDefault(); advance();
    const p = pos(e); engine.move(p.x, p.y); draw();
  }, { signal });
  stage.addEventListener('pointerup', e => {
    if (!engine || e.pointerId !== engine.pointerId) return;
    e.preventDefault(); advance();
    const p = pos(e); engine.up(p.x, p.y);
    if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId);
    if (engine.mode === 5) sound('spring');
    draw();
  }, { signal });
  for (const name of ['pointercancel', 'lostpointercapture']) stage.addEventListener(name, e => {
    const p = e as PointerEvent;
    if (!engine || p.pointerId !== engine.pointerId) return;
    advance(); engine.cancel(); draw();
  }, { signal });
}

function saveResult() {
  if (!engine || recorded || fixtureMode || engine.status !== 'result') return;
  recorded = true;
  if (engine.mode !== 5) {
    const unit = engine.mode === 3 || engine.mode === 6 ? 1000 : 1;
    const record = Math.floor(engine.best * unit + 1e-6);
    save.records[String(engine.mode)] = Math.max(save.records[String(engine.mode)] || 0, record);
    if (engine.mode === 6 && engine.success) save.clears++;
    persist();
  }
}

function draw() {
  if (!engine || !scene) return;
  scene.render();
  const e = engine;
  const text = (key: string, value: string) => {
    const el = document.querySelector(`[data-hud="${key}"]`);
    if (el && el.textContent !== value) el.textContent = value;
  };
  text('score', String(e.score));
  text('time', String(Math.ceil(Math.max(0, e.remaining - 1e-9))));
  text('hold', (Math.floor(e.hold * 10 + 1e-6) / 10).toFixed(1));
  text('best', e.best.toFixed(1));
  const ready = document.querySelector<HTMLElement>('[data-hud="ready"]');
  if (ready) {
    ready.hidden = fixtureMode || e.status !== 'ready';
    ready.textContent = e.mode === 6 && e.elapsed > 0 ? '輪に触れて、つづける' : modes[e.mode - 1].ready;
  }
  const feedback = document.querySelector<HTMLElement>('[data-hud="feedback"]');
  if (feedback) {
    const show = !fixtureMode && e.status === 'playing' && ((e.mode === 1 && ['WARNING', 'OPEN', 'OPEN_GRACE', 'CAUGHT'].includes(e.phase)) || (e.mode === 2 && ['CROUCH', 'JUMP'].includes(e.phase)) || (e.mode === 3 && e.phase === 'WARNING'));
    feedback.hidden = !show;
    if (show) feedback.textContent = e.message;
  }
  document.querySelector('#stage')?.setAttribute('data-phase', e.phase);
  document.querySelector('#stage')?.setAttribute('data-status', e.status);
  if (e.score > previousScore && !fixtureMode) sound('success');
  if (['CAUGHT', 'PUNCH', 'CAPTURED'].includes(e.phase) && e.phase !== previousPhase && !fixtureMode) sound('caught');
  if (e.phase === 'PUNCH' && previousPhase !== 'PUNCH') resultRevealsAt = performance.now() + 450;
  if (e.phase === 'SUCCESS' && previousPhase !== 'SUCCESS') resultRevealsAt = performance.now() + 240;
  previousScore = e.score; previousPhase = e.phase;
  saveResult();
  const nextModal = e.status === 'paused' ? 'paused' : e.status === 'result' && performance.now() >= resultRevealsAt && scene.reactionComplete() ? 'result' : '';
  if (modalState !== nextModal) {
    modalState = nextModal;
    const host = document.querySelector('#modal-host')!;
    host.innerHTML = nextModal === 'paused' ? `<div class="modal-scrim"><section class="game-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span class="dialog-paw">${icons.paw}</span><h2 id="pause-title">ひと休み中。</h2><p>猫も、ちょっとひと息。</p><button class="primary-button" data-action="resume">つづける</button><button class="secondary-button" data-action="menu">メニューへ</button></section></div>` : nextModal === 'result' ? resultHtml(e) : '';
    host.querySelector<HTMLButtonElement>('.primary-button')?.focus({ preventScroll: true });
  }
}

function resultHtml(e: GameEngine) {
  const countMode = [1, 2, 4].includes(e.mode);
  const value = countMode ? String(e.score) : e.mode === 3 ? (e.success ? e.score.toFixed(1) : '—') : (Math.floor(e.elapsed * 10 + 1e-6) / 10).toFixed(1);
  const label = countMode ? '回' : '秒';
  const title = e.mode === 3 ? e.success ? '寸止め、成功！' : '猫パンチ、一本！' : e.mode === 6 ? e.success ? '逃げきったニャ！' : 'つかまえたニャ！' : 'いい、ひまつぶし。';
  const caption = e.mode === 3 ? e.success ? 'おみごと。その間合い、覚えておこう。' : '次はもう少し早く、手を離してみて。' : e.mode === 6 ? e.success ? '15秒の大逃走。猫も感心しています。' : 'あとちょっと。もうひと勝負する？' : 'また、ちょっかいを出してみる？';
  return `<div class="modal-scrim"><section class="game-modal result-modal" role="dialog" aria-modal="true" aria-labelledby="result-title"><span class="dialog-paw">${icons.paw}</span><span class="result-eyebrow">${two(e.mode)} ${modes[e.mode - 1].name}</span><h2 id="result-title">${title}</h2><div class="result-value">${value}<span>${label}</span></div><div class="result-best">最高記録 <strong>${countMode ? e.best : e.best.toFixed(1)}</strong> ${label}</div><p>${caption}</p><button class="primary-button" data-action="retry">もう一回あそぶ</button><button class="secondary-button" data-action="menu">メニューへ</button></section></div>`;
}

app.addEventListener('click', event => {
  const target = event.target as Element;
  const mode = target.closest<HTMLButtonElement>('[data-mode]');
  if (mode) { sound(); void startMode(Number(mode.dataset.mode)); return; }
  const button = target.closest<HTMLButtonElement>('[data-action]');
  if (!button) return;
  event.stopPropagation();
  const action = button.dataset.action;
  if (action === 'menu') { void menu(); return; }
  if (action === 'settings') { document.querySelector<HTMLDialogElement>('#settings-dialog')?.showModal(); return; }
  if (action === 'sound') {
    save.sound = !save.sound; persist();
    button.innerHTML = soundIcon();
    button.setAttribute('aria-label', save.sound ? '音を消す' : '音を出す');
    button.setAttribute('aria-pressed', String(save.sound));
    return;
  }
  if (!engine) return;
  if (action === 'retry') { void startMode(engine.mode); return; }
  advance();
  if (action === 'pause') engine.pause();
  if (action === 'resume') { engine.resume(); lastNow = performance.now(); }
  if (action === 'reset') { engine.reset(); sound('spring'); }
  draw();
});

app.addEventListener('neko:graphicslost',()=>{
  if(!engine)return;
  loading=true;
  modalState='graphicslost';
  const host=document.querySelector('#modal-host');
  if(host)host.innerHTML='<div class="modal-scrim"><section class="game-modal" role="dialog" aria-modal="true" aria-labelledby="graphics-title"><h2 id="graphics-title">画面を、もう一度準備します。</h2><p>猫を読み込み直して、あそびを再開できます。</p><button class="primary-button" data-action="retry">もう一度読み込む</button><button class="secondary-button" data-action="menu">メニューへ</button></section></div>';
  host?.querySelector<HTMLButtonElement>('.primary-button')?.focus();
});

function suspend() {
  if (!engine || fixtureMode || loading || engine.status === 'result') return;
  advance(); engine.pause(); draw(); lastNow = performance.now();
}
window.addEventListener('blur', suspend);
document.addEventListener('visibilitychange', () => { if (document.hidden) suspend(); else lastNow = performance.now(); });
window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && engine && engine.mode !== 5) {
    if (engine.status === 'paused') engine.resume(); else engine.pause();
    lastNow = performance.now(); draw();
  }
});

function frame() { advance(); if (engine && scene && !loading) draw(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
const initialMode = Number(params.get('mode'));
if (Number.isInteger(initialMode) && initialMode >= 1 && initialMode <= 6) void startMode(initialMode);
else void menu();
