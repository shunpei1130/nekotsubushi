import './style.css';
import { GameEngine, W, H } from './engine';
import { GameScene } from './scene';
import { modes, asset, icons } from './data';
import { save, persist, sound, bestResult, previousResult, recordRun, collectCheek, unlockReaction, journeyStatus, isStageUnlocked, currentStage, completeStage, type StageCompletion } from './store';
import { CHEEK_GESTURES, stageGoal, evaluateStage } from './journey';
import { COLLECTION, normalContext, dailyContext, parseChallenge, encodeChallenge, resultFromEngine, compareResults, formatResult, type RunContext, type RunResult, type ModeId } from './progression';
import { prepareShareCard, sharePrepared, shareSocial, shareLink, shareCaption, xIntent, copyChallenge, downloadShareCard, revokeShareCard, type ShareCard, type SocialNetwork } from './share';
import { isNative, nativeAsset, removeNativeAssets, openExternal, nativeLifecycle, sharingOrigin } from './native';

declare global {
  interface Window {
    __ready: boolean;
    __game?: {
      engine: GameEngine;
      snapshot: () => ReturnType<GameEngine['snapshot']>;
      step: (ms: number) => ReturnType<GameEngine['snapshot']>;
      fixture: () => ReturnType<GameEngine['snapshot']>;
      visual: () => ReturnType<GameScene['visual']>;
      context: RunContext;
      result: () => RunResult | null;
    };
  }
}

const app = document.querySelector<HTMLDivElement>('#app')!;
const params = new URLSearchParams(location.search);
const capture = params.get('capture') === '1';
const fixtureMode = params.get('fixture') === 'reference' || params.get('fixture') === '1';
const testMode = params.get('test') === '1';
const requestedSeed = Number(params.get('seed') ?? 627041);
const invalidSeed = !Number.isInteger(requestedSeed) || requestedSeed < 0 || requestedSeed > 0xffff_ffff;
const seed = invalidSeed ? 627041 : requestedSeed;
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
let runContext: RunContext | null = null;
let runResult: RunResult | null = null;
let resultRecord: ReturnType<typeof recordRun> | null = null;
let startingBest: RunResult | null = null;
let startingPrevious: RunResult | null = null;
let lastEventId = 0;
let notice = '';
let noticeUntil = 0;
let shareCard: ShareCard | null = null;
let shareJob: Promise<ShareCard | null> | null = null;
let shareGeneration = 0;
let shareOpenGeneration = 0;
let shareNetwork: SocialNetwork | null = null;
let challengeUrl = '';
let runTainted = false;
let collectionPaused = false;
let collectionScene: GameScene | null = null;
let collectionGeneration = 0;
let collectionLoading = false;
let stageCompletion: StageCompletion | null = null;
let cheekSession = new Set<import('./progression').CheekGesture>();
const PENDING_KEY = 'nekotsubushi:pending-challenge';
let pendingRun: RunContext | null = (() => {
  try { const link = sessionStorage.getItem(PENDING_KEY); return link ? parseChallenge(link).context ?? null : null; } catch { return null; }
})();
let toastTimer: ReturnType<typeof setTimeout> | undefined;
const previewRun = capture || fixtureMode || testMode || params.has('time') || params.has('seed');
window.__ready = false;

const two = (v: number) => String(v).padStart(2, '0');
const bestFor = (id: number) => id === 3 ? 0 : (save.records[String(id)] || 0) / (id === 6 ? 1000 : 1);
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const recordLabel = (id: number) => {
  if (id === 5) return `みつけた表情 ${save.unlocked.filter(s => s.startsWith('cheek-')).length} / 6`;
  const record = bestResult(normalContext(id as ModeId, 0));
  if (record) return `自己ベスト ${formatResult(record)}`;
  if (id === 3 && save.legacyRecords['3']) return `旧記録 ${(save.legacyRecords['3'] / 1000).toFixed(1)}秒・長押し`;
  return bestFor(id) > 0 ? `最高 ${id === 6 ? bestFor(id).toFixed(1) + ' 秒' : bestFor(id) + ' 回'}` : 'はじめての、ねこあそび';
};
const soundIcon = () => save.sound ? icons.sound : icons.muted;

function clearShare() {
  shareGeneration++;
  shareOpenGeneration++; shareNetwork = null;
  if (shareCard) { if (isNative()) void removeNativeAssets(shareCard); revokeShareCard(shareCard); }
  shareCard = null; shareJob = null;
  challengeUrl = '';
  const dialog = document.querySelector<HTMLDialogElement>('#share-dialog');
  if (dialog) {
    if (dialog.open) dialog.close();
    const img = dialog.querySelector<HTMLImageElement>('#share-card-preview')!;
    img.removeAttribute('src'); img.hidden = true;
    dialog.querySelector<HTMLInputElement>('#challenge-url')!.value = '';
    dialog.querySelectorAll<HTMLButtonElement>('[data-action="native-share"],[data-action="copy-challenge"],[data-action="download-card"]').forEach(button => button.disabled = true);
    dialog.querySelector<HTMLElement>('.share-status')!.textContent = '挑戦状を準備しています…';
  }
}

function collectionDialogHtml() {
  return `<dialog id="collection-dialog" class="collection-dialog" aria-labelledby="collection-title"><button class="dialog-close" data-action="close-collection" aria-label="閉じる">×</button><header><span class="menu-eyebrow">あそぶほど、いろんな顔。</span><h2 id="collection-title">ねこのきろく</h2><p class="collection-progress">みつけた表情 <strong>${save.unlocked.length}</strong> / ${COLLECTION.length}</p></header><section class="collection-grid" aria-label="表情コレクション">${COLLECTION.map(item => `<button class="collection-item ${save.unlocked.includes(item.id) ? 'is-unlocked' : 'is-locked'}" data-collection-id="${item.id}" aria-label="${item.name}。${save.unlocked.includes(item.id) ? '発見済み' : '未発見。' + item.hint}"><img src="${item.asset}" alt="" loading="lazy"><h3>${item.name}</h3><span>${save.unlocked.includes(item.id) ? 'みつけた！' : 'まだひみつ'}</span></button>`).join('')}</section><div class="collection-preview" id="collection-preview" aria-live="polite"><p>表情をタップすると、見つけ方を見られます。</p></div><button class="primary-button" data-action="close-collection">あそびにもどる</button></dialog>`;
}

function shareDialogHtml() {
  return `<dialog id="share-dialog" class="share-dialog" aria-labelledby="share-title"><button class="dialog-close" data-action="close-share" aria-label="閉じる">×</button><h2 id="share-title">この記録、超えられる？</h2><p class="share-instructions">同じ条件で、友だちとひと勝負。</p><img id="share-card-preview" alt="猫と今回の記録の共有画像" hidden><p class="share-status" role="status" aria-live="polite">共有素材を準備しています…</p><label for="challenge-url">あそべるリンク</label><input id="challenge-url" type="text" readonly autocomplete="off"><label for="share-caption">投稿用の文章</label><textarea id="share-caption" rows="3" readonly></textarea><button class="primary-button" data-action="native-share" disabled>友だちに送る</button><button class="secondary-button" data-action="copy-caption">文章をコピー</button><button class="secondary-button" data-action="copy-challenge" disabled>リンクをコピー</button><button class="secondary-button" data-action="download-card" disabled>画像を保存</button><p class="settings-footnote">共有先の選択と投稿は、ご自身で確定できます。アプリが表示されないときは素材を保存し、SNSから選んでください。</p></dialog>`;
}

function socialButtonsHtml() {
  return runTainted ? '' : `<section class="social-result" aria-label="SNSで共有"><p>この猫と記録を、シェア。</p><div class="social-buttons"><button data-action="social-share" data-network="x" aria-label="Xで共有"><span aria-hidden="true">𝕏</span>X</button><button data-action="social-share" data-network="tiktok" aria-label="TikTokで共有"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3v12a4 4 0 1 1-4-4m4-8c1 4 3 5 6 5"/></svg>TikTok</button><button data-action="social-share" data-network="instagram" aria-label="Instagramで共有"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="18" cy="6" r=".6"/></svg>Instagram</button></div></section>`;
}

function showDiscovery(ids: string[]) {
  const item = COLLECTION.find(c => c.id === ids[ids.length - 1]);
  if (!item) return;
  app.querySelector('#discovery-toast')?.remove();
  clearTimeout(toastTimer);
  app.insertAdjacentHTML('beforeend', `<aside id="discovery-toast" class="discovery-toast" role="status"><img src="${item.asset}" alt=""><div><strong>新しい表情、みつけた！</strong><span>${item.name}${ids.length > 1 ? ` ほか${ids.length - 1}つ` : ''}</span></div><button data-action="close-discovery" aria-label="通知を閉じる">×</button></aside>`);
  toastTimer = setTimeout(() => app.querySelector('#discovery-toast')?.remove(), 4500);
}

function cleanup() {
  generation++;
  clearShare();
  clearTimeout(toastTimer);
  disposeCollectionScene();
  abort?.abort(); abort = null;
  resizeObserver?.disconnect(); resizeObserver = null;
  scene?.destroy(); scene = null;
  engine = null;
  runContext = null; runResult = null; resultRecord = null;
  stageCompletion = null; cheekSession.clear();
  delete window.__game;
  modalState = '';
  loading = false;
}

async function menu() {
  cleanup();
  window.__ready = false;
  document.body.className = 'menu-page';
  const menuParams = new URLSearchParams(location.search);
  for (const key of ['mode','fixture','capture','time','challenge','daily']) menuParams.delete(key);
  history.replaceState({}, '', location.pathname + (menuParams.size ? '?' + menuParams : ''));
  document.title = '猫つぶし｜ひとゆび、ねこあそび。';
  const daily = dailyContext();
  const dailyBest = bestResult(daily);
  const journey = journeyStatus();
  app.innerHTML = `<main class="menu-shell">
    <header class="menu-header">
      <span class="menu-eyebrow">ちょっと、猫とひと休み。</span>
      <div class="brand"><span class="brand-paw">${icons.paw}</span><h1>猫つぶし<span class="brand-dot">。</span></h1></div>
      <p class="menu-subtitle">ひとゆび、ねこあそび。</p>
      <button class="icon-button menu-settings" data-action="settings" aria-label="音と動きの設定">${icons.settings}</button>
    </header>
    <section class="journey-summary journey-progress ${journey.allClear ? 'is-complete' : ''}" aria-label="ステージの進み具合"><div><span class="menu-eyebrow">ひとつクリアで、次のねこ。</span><strong>${journey.allClear ? '全6ステージ、クリア！' : `${journey.cleared.length} / 6 クリア`}</strong><p>${journey.allClear ? 'おめでとう！ どのあそびでも、さらに記録に挑めます。' : `次は ${two(journey.current!)} ${modes[journey.current! - 1].name}`}</p></div><span class="journey-paws" aria-hidden="true">${Array.from({length:6},(_,i)=>`<i class="${i < journey.cleared.length ? 'is-done' : i === journey.cleared.length ? 'is-current' : ''}">${i < journey.cleared.length ? '✓' : i+1}</i>`).join('')}</span></section>
    ${pendingRun ? `<aside class="pending-challenge"><strong>${pendingRun.kind === 'daily' ? '日替わりのお題' : '友だちの挑戦状'}をおあずかり中</strong><p>${two(pendingRun.mode)} ${modes[pendingRun.mode-1].name}。${isStageUnlocked(pendingRun.mode) ? 'あそべるようになりました！' : '先にステージをクリアして開放しよう。'}</p><button class="secondary-button" data-action="pending-challenge">${isStageUnlocked(pendingRun.mode) ? 'このお題であそぶ' : '開放までの道のりを見る'}</button></aside>` : ''}
    <button class="daily-card ${isStageUnlocked(daily.mode) ? '' : 'is-stage-locked'}" data-action="daily"><img src="${asset(`thumb-${two(daily.mode)}`)}" alt=""><span class="daily-copy"><small>${daily.dailyDate}・今日のねこチャレンジ</small><strong>${modes[daily.mode - 1].name}</strong><span>${!isStageUnlocked(daily.mode) ? `未解放・${two(daily.mode-1)}クリアであそべます` : dailyBest ? `今日のベスト ${formatResult(dailyBest)}` : 'みんな同じお題で、ひと勝負。'}</span></span><span class="daily-arrow" aria-hidden="true">›</span></button>
    <button class="collection-entry" data-action="collection"><span>${icons.paw}</span><strong>ねこのきろく</strong><span>表情 ${save.unlocked.length} / ${COLLECTION.length}</span><span aria-hidden="true">›</span></button>
    <div class="menu-section-label"><span>${journey.allClear ? '今日は、どの猫とあそぶ？' : 'クリアして、次のあそびへ。'}</span><span>${journey.unlocked.length} / 6 開放</span></div>
    <section class="mode-grid" aria-label="ゲームを選ぶ">${modes.map(m => `
      <button class="mode-card mode-card-${m.id} ${isStageUnlocked(m.id) ? journey.cleared.includes(m.id as ModeId) ? 'is-stage-cleared' : 'is-stage-current' : 'is-stage-locked'}" data-mode="${m.id}" aria-disabled="${!isStageUnlocked(m.id)}" aria-label="${m.name}。${isStageUnlocked(m.id) ? m.operation + '。クリア条件：' + stageGoal(m.id as ModeId) : '未解放。' + two(m.id-1) + 'のクリアで開放'}">
        <div class="card-art"><span class="card-number">${two(m.id)}</span><span class="card-time">${m.time}</span>
          <span class="card-art-halo"></span><img src="${asset(`thumb-${two(m.id)}`)}" alt="${m.tag}" loading="eager" decoding="async">
          <span class="card-art-paw">${icons.paw}</span>
        </div>
        <div class="card-copy"><span class="stage-card-state">${journey.cleared.includes(m.id as ModeId) ? '✓ クリア済み' : isStageUnlocked(m.id) ? 'いまのステージ' : `未解放・${two(m.id-1)}クリアで開放`}</span><h2>${m.id === 6 ? 'あとちょっとで<br>届くのに' : m.name}</h2><p>${m.operation}</p><span class="card-goal">${stageGoal(m.id as ModeId)}</span><span class="card-record">${recordLabel(m.id)}</span><span class="card-arrow" aria-hidden="true">›</span></div>
      </button>`).join('')}
    </section>
    <footer class="menu-footer"><span>${icons.paw}</span><p>ふわふわを、ひとりじめ。<small>登録いらず。スマホでも、パソコンでも。</small></p></footer>
    <dialog id="settings-dialog" aria-labelledby="settings-title"><form method="dialog"><button class="dialog-close" aria-label="閉じる">×</button><span class="dialog-paw">${icons.paw}</span><h2 id="settings-title">あそびの設定</h2><label class="setting-row"><span>音をならす<small>ぷに、ぽふ。小さな音で。</small></span><input type="checkbox" name="sound" ${save.sound ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label><label class="setting-row"><span>動きをひかえめに<small>大きな揺れやきらめきを減らす</small></span><input type="checkbox" name="reduced" ${save.reduced ? 'checked' : ''}><span class="switch" aria-hidden="true"></span></label><button class="primary-button" value="close">これであそぶ</button><p class="settings-footnote">記録と設定は、この端末に保存されます。</p></form></dialog>
  </main>${collectionDialogHtml()}<dialog id="stage-lock-dialog" aria-labelledby="stage-lock-title"></dialog>`;
  const dialog = document.querySelector<HTMLDialogElement>('#settings-dialog')!;
  dialog.addEventListener('change', () => {
    save.sound = dialog.querySelector<HTMLInputElement>('[name="sound"]')!.checked;
    save.reduced = dialog.querySelector<HTMLInputElement>('[name="reduced"]')!.checked;
    persist();
    document.body.classList.toggle('reduced-motion', save.reduced);
  });
  await Promise.allSettled(Array.from(app.querySelectorAll<HTMLImageElement>('.mode-card img,.daily-card img')).map(img => img.decode()));
  await document.fonts.ready;
  window.__ready = true;
}

function showStageLock(id: ModeId) {
  const dialog = document.querySelector<HTMLDialogElement>('#stage-lock-dialog');
  if (!dialog) return;
  const current = currentStage();
  dialog.innerHTML = `<button class="dialog-close" data-action="close-stage-lock" aria-label="閉じる">×</button><span class="menu-eyebrow">ひとつずつ、ねこのお相手。</span><h2 id="stage-lock-title">${two(id)}は、まだおあずけ。</h2><p>${two(id-1)}をクリアすると開放されます。${current ? `まずは ${two(current)} ${modes[current-1].name}から。` : ''}</p>${current ? `<div class="lock-goal"><strong>いまのクリア条件</strong><p>${stageGoal(current)}</p></div><button class="primary-button" data-action="journey-current">${two(current)}に挑戦する</button>` : ''}<button class="text-button" data-action="close-stage-lock">メニューを見る</button><p class="settings-footnote">記録や見つけた表情は、そのまま残ります。</p>`;
  dialog.showModal();
}

function rememberPending(context: RunContext | null) {
  pendingRun = context ? structuredClone(context) : null;
  try {
    if (!context) sessionStorage.removeItem(PENDING_KEY);
    else if (context.kind === 'challenge' && context.target) sessionStorage.setItem(PENDING_KEY,encodeChallenge(context,context.target,sharingOrigin()));
    else if (context.kind === 'daily' && context.dailyDate) sessionStorage.setItem(PENDING_KEY,`?daily=${context.dailyDate}&mode=${context.mode}`);
  } catch {}
}

function taskHtml(id: ModeId) {
  return `<section class="stage-task stage-goal" aria-label="クリア条件"><div><strong>${two(id)} クリア条件</strong><span data-stage="state">${journeyStatus().cleared.includes(id) ? 'クリア済み' : '次のあそびを開放しよう'}</span></div><p>${stageGoal(id)}</p><small data-stage="progress"></small>${id === 5 ? `<details class="cheek-guide"><summary>6種類の見つけ方</summary><p>右・左の頬を外へ／上へ／下へ／鼻の方へ／小さく引いて1秒待つ。離すと1種類。時間制限はありません。</p><div>${CHEEK_GESTURES.map(g=>`<span data-gesture="${g}">${({right:'右',left:'左',up:'上',down:'下',inward:'内',gentle:'そっと1秒'})[g]}</span>`).join('')}</div></details><div data-stage="cheek-clear"></div>` : ''}</section>`;
}

function hudHtml(id: number) {
  const m = modes[id - 1];
  const paw = id === 1 || id === 2 ? `<span class="title-paw">${icons.paw}</span>` : '';
  const title = `<div class="game-title">${paw}<span><em>${two(id)}</em> ${m.name}</span>${paw}</div>`;
  const score = [1, 2, 4].includes(id) ? '<div class="score-plate"><strong role="status" aria-label="成功回数 0 回" data-hud="score">0</strong><span>回</span></div>' : '';
  const timer = [1, 2, 4, 6].includes(id) ? '<div class="time-plate"><span>あと</span><strong data-hud="time">30</strong><span>秒</span></div>' : '';
  const hold = id === 3 ? `<div class="best-plate">${fixtureMode ? '<span class="crown" aria-hidden="true">♛</span> 最高 ' : '最接近 '}<b data-hud="best">—</b> 秒</div><div class="hold-value"><strong data-hud="hold">0.0</strong><span>秒</span></div>` : '';
  const special = id === 5 ? `<button class="stage-icon reset-button" data-action="reset" aria-label="ほっぺを元に戻す">${icons.reset}</button>` : id === 6 ? `<button class="stage-icon pause-button" data-action="pause" aria-label="一時停止">${icons.pause}</button>` : '';
  const desc = id === 3 ? '<span class="yellow">長押し</span>でちょっかい<br>パンチの前に離す' : m.desc;
  const progress = id === 1 || id === 2 ? '<span data-hud="streak">0 連続</span>' : id === 4 ? '<span data-hud="perfect">ぴったり 0 回</span>' : id === 6 ? '<span data-hud="near">ひやひや 0.0 秒</span>' : '';
  return `${title}${score}${timer}${hold}${special}<p class="game-description">${id === 6 ? `<span class="description-paw">${icons.paw}</span>` : ''}<span>${desc}</span></p><div class="play-records">${progress}<span data-hud="last-record"></span></div><div class="live-feedback" data-hud="feedback" aria-live="polite"></div><div class="ready-hint" data-hud="ready">${m.ready}</div>`;
}

async function startMode(id: number, context?: RunContext) {
  if (!isStageUnlocked(id)) {
    if (context) rememberPending(context);
    await menu(); showStageLock(id as ModeId); return;
  }
  cleanup();
  window.__ready = false;
  loading = true;
  const request = generation;
  const playSeed = params.has('seed') || fixtureMode || testMode ? seed : Math.floor(Math.random() * 0x100000000);
  runContext = context ?? normalContext(id as ModeId, playSeed);
  runTainted = previewRun;
  startingBest = bestResult(runContext); startingPrevious = previousResult(runContext);
  const current = new GameEngine(id, { seed: runContext.seed, best: bestFor(id) });
  engine = current;
  recorded = false;
  previousScore = 0;
  previousPhase = current.phase;
  resultRevealsAt = 0;
  lastEventId = 0; notice = ''; noticeUntil = 0;
  document.body.className = `game-page${capture ? ' capture-page' : ''}${save.reduced ? ' reduced-motion' : ''}`;
  document.title = `${modes[id - 1].name}｜猫つぶし`;
  const gameParams = runContext.kind === 'challenge' && runContext.target
    ? new URL(encodeChallenge(runContext,runContext.target,location.origin)).searchParams
    : new URLSearchParams(location.search);
  for (const key of ['challenge','daily']) if (runContext.kind === 'normal') gameParams.delete(key);
  if (runContext.kind === 'daily') gameParams.set('daily', runContext.dailyDate!);
  gameParams.set('mode', String(id));
  history.replaceState({}, '', location.pathname + '?' + gameParams);
  app.innerHTML = `<main class="game-view">
    ${capture ? '' : `<nav class="game-nav" aria-label="ゲームの操作"><button class="nav-back" data-action="menu">${icons.back}<span>メニューへ</span></button><span class="nav-brand">猫つぶし</span><div class="nav-right"><button class="icon-button" data-action="sound" aria-label="${save.sound ? '音を消す' : '音を出す'}" aria-pressed="${save.sound}">${soundIcon()}</button>${id === 5 ? `<button class="nav-finish" data-action="finish-cheeks">おわる</button><button class="icon-button" data-action="collection" aria-label="表情コレクション">${icons.paw}</button>` : id === 6 ? '' : `<button class="icon-button" data-action="pause" aria-label="一時停止">${icons.pause}</button>`}</div></nav>`}
    ${!capture && runContext.kind !== 'normal' ? `<aside class="challenge-banner"><small>${runContext.dailyDate ? escapeHtml(runContext.dailyDate) + ' のお題' : '友だちからの挑戦状'}</small><strong>${runContext.target ? '友だちの記録 ' + escapeHtml(formatResult(runContext.target)) : '今日のねこチャレンジ'}</strong><span>同じ条件で、何度でも。</span></aside>` : ''}
    ${capture || fixtureMode ? '' : taskHtml(id as ModeId)}
    <div class="game-viewport"><div id="stage" class="stage mode-${id}" role="application" aria-label="${modes[id - 1].name}。${modes[id - 1].operation}"><div class="hud" aria-label="ゲームの状態">${hudHtml(id)}</div></div></div>
    <div class="load-layer"><span class="loading-paw">${icons.paw}</span><p>猫がおめかし中…</p><span>ふわふわを準備しています</span></div>
    <div id="modal-host"></div>
  </main>${collectionDialogHtml()}${shareDialogHtml()}`;
  const stage = document.querySelector<HTMLDivElement>('#stage')!;
  const viewport = document.querySelector<HTMLDivElement>('.game-viewport')!;
  const fit = () => {
    scale = capture ? 1 : Math.max(0.05, Math.min(viewport.clientWidth / W, viewport.clientHeight / H));
    stage.style.width = `${W * scale}px`;
    stage.style.height = `${H * scale}px`;
    stage.style.setProperty('--stage-scale', String(scale));
    stage.style.setProperty('--hit-size', `${44 / scale}px`);
    stage.querySelector<HTMLElement>('.hud')!.style.transform = `scale(${scale})`;
    scene?.resizeResolution();
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
    if (!runTainted && !save.seen.includes(id)) { save.seen.push(id); persist(); }
    loading = false;
    document.querySelector('.load-layer')?.remove();
    bindInput(stage);
    window.__game = {
      engine: current,
      snapshot: () => current.snapshot(),
      step: ms => { runTainted = true; current.update(ms); draw(); return current.snapshot(); },
      fixture: () => { runTainted = true; current.fixture(); draw(); return current.snapshot(); },
      visual: () => readyScene.visual(),
      context: structuredClone(runContext),
      result: () => runResult ? { ...runResult } : null
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
  if (engine && !fixtureMode && !testMode && !loading && !document.querySelector<HTMLDialogElement>('#collection-dialog')?.open) engine.update(Math.max(0, dt));
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
  runResult = resultFromEngine(engine.snapshot());
  if (runContext && !runTainted && engine.mode !== 5) {
    resultRecord = recordRun(runContext, runResult);
    showDiscovery(resultRecord.unlocked);
    if (resultRecord.newBest && resultRecord.previousBest) scene?.playReaction('personal-best');
    challengeUrl = shareLink(runContext, runResult);
    stageCompletion = completeStage(engine.mode as ModeId, {result:runResult});
  }
  if (runContext && !runTainted && engine.mode===5) challengeUrl=shareLink(runContext,runResult);
}

function processEvents() {
  if (!engine || !scene || fixtureMode) return;
  const milestones: Record<string, string> = { 'poke-streak':'streak-1', 'box-streak':'streak-2', 'punch-close':'close-3', 'hat-rhythm':'rhythm-4', 'escape-clear':'clear-6' };
  for (const event of engine.events) {
    if (event.id <= lastEventId) continue;
    lastEventId = event.id;
    if (event.type === 'cheek' && event.tag) {
      scene.playReaction(`cheek-${event.tag}`);
      if (CHEEK_GESTURES.includes(event.tag as import('./progression').CheekGesture)) cheekSession.add(event.tag as import('./progression').CheekGesture);
      if (!runTainted) showDiscovery(collectCheek(event.tag));
      if (!runTainted && cheekSession.size === CHEEK_GESTURES.length && !stageCompletion) stageCompletion = completeStage(5,{gestures:[...cheekSession]});
    }
    if (event.type === 'milestone' && event.tag && milestones[event.tag]) {
      const id = milestones[event.tag]; scene.playReaction(id);
      if (!runTainted) showDiscovery(unlockReaction(id));
    }
    if (event.type === 'timing' || event.type === 'success' && event.tag === 'close') {
      const labels: Record<string,string> = {early:'早め！',perfect:'ぴったり！',close:'ギリギリ！',late:'次はもう少し早く',miss:'次のジャンプを待とう'};
      if (event.tag && labels[event.tag]) {
        notice = event.tag === 'early' && (engine.mode === 4 || engine.encounterOutcome === 'EARLY') ? 'まだ待って。外れたら、もう一度！' : labels[event.tag];
        if (engine.mode === 2 && engine.encounterOutcome === 'EARLY') notice = '早かったニャ。ジャンプしてから！';
        noticeUntil = performance.now() + 850;
      }
    }
  }
}

function draw() {
  if (!engine || !scene) return;
  processEvents();
  scene.render();
  const e = engine;
  const text = (key: string, value: string) => {
    const el = document.querySelector(`[data-hud="${key}"]`);
    if (el && el.textContent !== value) el.textContent = value;
  };
  text('score', String(e.score));
  document.querySelector('[data-hud=score]')?.setAttribute('aria-label',`成功回数 ${e.score} 回`);
  text('time', String(Math.ceil(Math.max(0, e.remaining - 1e-9))));
  text('hold', (Math.floor(e.hold * 10 + 1e-6) / 10).toFixed(1));
  text('best', fixtureMode ? e.best.toFixed(1) : startingBest?.remainingMs !== null && startingBest?.remainingMs !== undefined ? (startingBest.remainingMs / 1000).toFixed(3) : '—');
  text('streak', `${e.metrics.streak} 連続`);
  text('perfect', `ぴったり ${e.metrics.perfectCount} 回`);
  text('near', `ひやひや ${(e.metrics.nearMissMs / 1000).toFixed(1)} 秒`);
  text('last-record', startingPrevious ? `前回 ${formatResult(startingPrevious)}` : '');
  const previousPill = document.querySelector<HTMLElement>('[data-hud="last-record"]');
  if (previousPill) previousPill.hidden = !startingPrevious;
  const ready = document.querySelector<HTMLElement>('[data-hud="ready"]');
  if (ready) {
    ready.hidden = fixtureMode || e.status !== 'ready';
    ready.textContent = e.mode === 6 && e.elapsed > 0 ? '輪に触れて、つづける' : modes[e.mode - 1].ready;
  }
  const feedback = document.querySelector<HTMLElement>('[data-hud="feedback"]');
  if (feedback) {
    const recent = performance.now() < noticeUntil;
    const show = !fixtureMode && e.status === 'playing' && (recent || (e.mode === 1 && ['WARNING', 'OPEN', 'OPEN_GRACE', 'CAUGHT'].includes(e.phase)) || (e.mode === 2 && ['CROUCH', 'JUMP'].includes(e.phase)) || (e.mode === 3 && e.phase === 'WARNING'));
    feedback.hidden = !show;
    if (show) feedback.textContent = recent ? notice : e.message;
  }
  document.querySelector('#stage')?.setAttribute('data-phase', e.phase);
  document.querySelector('#stage')?.setAttribute('data-status', e.status);
  if (e.score > previousScore && !fixtureMode) sound('success');
  if (['CAUGHT', 'PUNCH', 'CAPTURED'].includes(e.phase) && e.phase !== previousPhase && !fixtureMode) sound('caught');
  if (e.phase === 'PUNCH' && previousPhase !== 'PUNCH') resultRevealsAt = performance.now() + 450;
  if (e.phase === 'SUCCESS' && previousPhase !== 'SUCCESS') resultRevealsAt = performance.now() + 240;
  previousScore = e.score; previousPhase = e.phase;
  saveResult();
  drawStageTask();
  const nextModal = e.status === 'paused' ? 'paused' : e.status === 'result' && performance.now() >= resultRevealsAt && scene.reactionComplete() ? 'result' : '';
  if (modalState !== nextModal) {
    modalState = nextModal;
    const host = document.querySelector('#modal-host')!;
    host.innerHTML = nextModal === 'paused' ? `<div class="modal-scrim"><section class="game-modal" role="dialog" aria-modal="true" aria-labelledby="pause-title"><span class="dialog-paw">${icons.paw}</span><h2 id="pause-title">ひと休み中。</h2><p>猫も、ちょっとひと息。</p><button class="primary-button" data-action="resume">つづける</button><button class="secondary-button" data-action="menu">メニューへ</button></section></div>` : nextModal === 'result' ? resultHtml(e) : '';
    host.querySelector<HTMLButtonElement>('.primary-button')?.focus({ preventScroll: true });
  }
}

function drawStageTask() {
  if (!engine) return;
  const assessment = evaluateStage(engine.mode as ModeId, engine.mode === 5 ? {gestures:[...cheekSession]} : {result:resultFromEngine(engine.snapshot())});
  const progress = document.querySelector<HTMLElement>('[data-stage="progress"]');
  const message = runTainted ? 'プレビューでは開放・記録の保存はされません。' : assessment.passed ? engine.status === 'result' || engine.mode === 5 ? 'クリア！ 条件を達成しました。' : '条件到達！ 最後までリズムを保とう。' : assessment.remaining;
  if (progress && progress.textContent !== message) progress.textContent = message;
  const state = document.querySelector<HTMLElement>('[data-stage="state"]');
  const stateText = journeyStatus().cleared.includes(engine.mode as ModeId) ? '✓ クリア済み' : '次のあそびを開放しよう';
  if (state && state.textContent !== stateText) state.textContent = stateText;
  if (engine.mode === 5) {
    for (const item of document.querySelectorAll<HTMLElement>('[data-gesture]')) item.classList.toggle('is-found',cheekSession.has(item.dataset.gesture as import('./progression').CheekGesture));
    const host = document.querySelector<HTMLElement>('[data-stage="cheek-clear"]');
    if (host && stageCompletion?.passed && !host.childElementCount) host.innerHTML = `<p class="cheek-success">6種類、みつけた！ このままむにむにも楽しめます。</p><button class="primary-button" data-action="next-stage" data-next-mode="6">06 あとちょっとで届くのにへ</button>`;
  }
}

function resultHtml(e: GameEngine) {
  const result = runResult ?? resultFromEngine(e.snapshot());
  const countMode = [1, 2, 4].includes(e.mode), best = runTainted ? startingBest : bestResult(runContext!);
  const value = e.mode===5 ? String(cheekSession.size) : countMode ? String(result.count) : e.mode === 3 ? (result.remainingMs !== null ? (result.remainingMs / 1000).toFixed(3) : '—') : (result.survivalMs / 1000).toFixed(3);
  const label = e.mode===5 ? '種類' : countMode ? '回' : e.mode === 3 ? '秒前' : '秒';
  const title = e.mode===5 ? 'むにむに、おしまい。' : e.mode === 3 ? e.success ? '寸止め、成功！' : '猫パンチ、一本！' : e.mode === 6 ? e.success ? '逃げきったニャ！' : 'つかまえたニャ！' : 'いい、ひまつぶし。';
  const details = e.mode===5 ? [['今回の仕草',`${cheekSession.size} / 6 種類`],['時間制限','気ままに、むに。']] : e.mode === 1 || e.mode === 2 ? [['最大連続',`${result.maxStreak} 回`],[e.mode === 1 ? 'ギリギリ' : 'ぴったり',`${e.mode === 1 ? result.specialCount : result.perfectCount} 回`]] : e.mode === 4 ? [['ぴったり',`${result.perfectCount} 回`],['ぴったり連続',`${result.maxPerfectStreak} 回`]] : e.mode === 6 ? [['ひやひや時間',`${(result.nearMissMs / 1000).toFixed(3)} 秒`],['逃げ切り',e.success ? '成功！' : '次こそ！']] : [['残り時間',result.remainingMs !== null ? `${result.remainingMs} ms` : 'パンチの前に離そう'],['記録のねらい','小さいほど上手！']];
  const portrait = COLLECTION.find(c => c.id === resultRecord?.unlocked.at(-1))?.asset ?? asset(`thumb-${two(e.mode)}`);
  const target = runContext?.target;
  const comparison = target ? compareResults(result, target) : 0;
  return `<div class="modal-scrim"><section class="game-modal result-modal" role="dialog" aria-modal="true" aria-labelledby="result-title"><div class="result-cat"><img src="${portrait}" alt=""></div><span class="result-eyebrow">${runContext?.dailyDate ? escapeHtml(runContext.dailyDate) + ' のお題・' : ''}${two(e.mode)} ${modes[e.mode - 1].name}</span><h2 id="result-title">${title}</h2>${resultRecord?.newBest && resultRecord.previousBest ? '<span class="new-record">自己ベスト更新！</span>' : ''}<div class="result-value" data-result="own">${value}<span>${label}</span></div><div class="result-details">${details.map(([name,detail]) => `<div class="result-detail"><span>${name}</span><strong>${detail}</strong></div>`).join('')}</div><p id="result-delta" class="result-delta">${resultGap(result, startingBest)}</p><div class="result-history">${best ? `<span>${runContext?.kind === 'normal' ? '自己ベスト' : 'このお題のベスト'}：${formatResult(best)}</span>` : ''}${startingPrevious ? `<span>前回：${formatResult(startingPrevious)}</span>` : ''}</div>${target ? `<div class="result-comparison"><strong>${comparison > 0 ? '友だちの記録を超えた！' : comparison === 0 ? '友だちと同じ記録！' : 'もう一度、挑んでみよう。'}</strong><span data-result="target">友だち：${formatResult(target)}</span><span>あなた：${formatResult(result)}</span><small>${comparisonDetail(result)}</small></div>` : ''}${stageResultHtml(e.mode as ModeId, result)}<div class="result-actions">${runTainted ? '<p class="settings-footnote">プレビューの記録は保存・共有されません。</p>' : `<button class="secondary-button" data-action="share">${e.mode===5 ? "このほっぺを共有" : "この記録で、友だちに挑戦状"}</button>${socialButtonsHtml()}`}<button class="text-button" data-action="menu">メニューへ</button></div></section></div>`;
}

function comparisonDetail(result: RunResult) {
  return result.mode === 3 ? '成功して、残り時間が小さいほど上位。' : result.mode === 6 ? '生存時間が同じなら、ひやひや時間で勝負。' : result.mode === 4 ? '回数が同じなら、ぴったり回数と連続数で勝負。' : '回数が同じなら、最大連続数と特別判定で勝負。';
}

function stageResultHtml(mode: ModeId, result: RunResult) {
  const assessment = evaluateStage(mode,mode===5 ? {gestures:[...cheekSession]} : {result});
  const cleared = !runTainted && !!stageCompletion?.passed;
  const allClear = cleared && stageCompletion!.allClear;
  const next = stageCompletion?.newlyUnlocked.at(-1) ?? (mode < 6 ? mode + 1 : null);
  const hint = mode===5 ? '6種類の触り方は、ゲーム上部のガイドで見られます。' : mode === 1 ? '目が開きそうなら手を止める。速さより、途切れないリズムを。' : mode === 2 ? 'ジャンプを見てから横へ。「ぴったり」は飛んでから0.30〜0.44秒。' : mode === 3 ? '前足が上がる合図から約0.65秒でパンチ。最後の一瞬をねらおう。' : mode === 4 ? '帽子が完全に外れてから。先走り連打より、外れるリズムを。' : '羽を止めず、大きく回そう。ひやひやは猫の近くで逃げた時間。';
  return `<section class="stage-result ${cleared ? 'is-cleared' : ''}" data-stage-passed="${cleared}" aria-label="ステージ判定"><strong>${runTainted ? 'ステージ判定はプレビューです' : allClear ? '全6ステージ、クリア！' : cleared ? 'ステージ、クリア！' : '次こそ、ステージクリア！'}</strong><p>${assessment.description}</p><span>${runTainted ? 'このプレイではステージは開放されません。' : cleared ? allClear ? 'おめでとう！ すべてのねこあそびを制覇しました。' : `${two(next!)} ${modes[next!-1].name}であそべます。` : assessment.remaining}</span>${!cleared ? `<small>${hint}</small>` : ''}</section>${cleared && !allClear && next && isStageUnlocked(next) ? `<button class="primary-button" data-action="next-stage" data-next-mode="${next}">次のゲームへ · ${two(next)}</button><button class="secondary-button" data-action="retry">もう1回！</button>` : allClear ? '<button class="primary-button" data-action="menu">クリアした6つのあそびへ</button><button class="secondary-button" data-action="retry">もう1回！</button>' : '<button class="primary-button" data-action="retry">もう1回！</button>'}${pendingRun && isStageUnlocked(pendingRun.mode) ? '<button class="secondary-button" data-action="pending-challenge">おあずかり中の挑戦であそぶ</button>' : ''}`;
}

function resultGap(result: RunResult, best: RunResult | null) {
  if (result.mode === 5) return 'もう一度、気ままにむにむに。見つけた表情は残ります。';
  if (result.mode === 3 && !result.success) return '次は、パンチの合図を見て少し早めに離そう。';
  if (!best || result.mode === 3 && !best.success) return 'はじめての記録！ 次はこの記録を超えてみよう。';
  if (compareResults(result, best) > 0) return '自己ベスト更新！ その調子、もうひと勝負。';
  if (compareResults(result, best) === 0) return '自己ベストと同じ！ あと少し、攻めてみよう。';
  if (result.mode === 3) return `自己ベストまであと ${((result.remainingMs! - best.remainingMs!) / 1000).toFixed(3)} 秒。もう少しだけ、ぎりぎりへ。`;
  if (result.mode === 6) return result.survivalMs < best.survivalMs ? `自己ベストまであと ${((best.survivalMs - result.survivalMs) / 1000).toFixed(3)} 秒！` : `生存時間は同じ！ ひやひや時間をあと ${((best.nearMissMs - result.nearMissMs + 1) / 1000).toFixed(3)} 秒。`;
  return `あと ${Math.max(1, best.count - result.count + 1)} 回で自己ベスト更新！`;
}

function retryMode() {
  if (!engine || !runContext) return;
  if (!isStageUnlocked(engine.mode)) { void startMode(engine.mode,runContext); return; }
  const context = runContext.kind === 'normal' && !previewRun ? normalContext(engine.mode as ModeId) : structuredClone(runContext);
  if (!scene || loading) { void startMode(engine.mode, context); return; }
  clearShare();
  const current = new GameEngine(context.mode, {seed:context.seed,best:bestFor(context.mode)});
  runTainted = previewRun;
  engine = current; runContext = context; runResult = null; resultRecord = null;
  stageCompletion = null; cheekSession.clear();
  startingBest = bestResult(context); startingPrevious = previousResult(context);
  recorded = false; previousScore = 0; previousPhase = current.phase; lastEventId = 0;
  notice = ''; noticeUntil = 0; resultRevealsAt = 0; modalState = '';
  document.querySelector('#modal-host')!.replaceChildren();
  document.querySelector('#discovery-toast')?.remove();
  scene.reset(current);
  const activeScene = scene;
  window.__game = {engine:current,context:structuredClone(context),snapshot:()=>current.snapshot(),step:ms=>{runTainted=true;current.update(ms);draw();return current.snapshot();},fixture:()=>{runTainted=true;current.fixture();draw();return current.snapshot();},visual:()=>activeScene.visual(),result:()=>runResult ? {...runResult}:null};
  lastNow = performance.now(); window.__ready = true; draw();
}

async function openShare(network: SocialNetwork | null = null) {
  const dialog = document.querySelector<HTMLDialogElement>('#share-dialog');
  if (!dialog || runTainted || !runResult || !runContext) return;
  shareNetwork=network; const opened=++shareOpenGeneration;
  const label=network==='instagram'?'Instagram':network==='tiktok'?'TikTok':null;
  dialog.querySelector('#share-title')!.textContent=label ? `${label}でシェア` : runResult.mode===5?'このほっぺ、さわってみる？':'この記録、超えられる？';
  dialog.querySelector('.share-instructions')!.textContent=label ? `${isNative()&&network==='tiktok'?'縦動画':'猫の画像'}を用意します。共有メニューで${label}を選ぶか、保存して投稿に使えます。` : '猫の画像と、同じ条件であそべるリンクを送れます。';
  dialog.querySelector<HTMLTextAreaElement>('#share-caption')!.value=`${shareCaption(runResult)}\n${challengeUrl}`;
  if (!dialog.open) dialog.showModal();
  dialog.querySelector<HTMLInputElement>('#challenge-url')!.value = challengeUrl;
  dialog.querySelector<HTMLButtonElement>('[data-action="copy-challenge"]')!.disabled = !challengeUrl;
  dialog.querySelector<HTMLButtonElement>('[data-action="native-share"]')!.disabled = !challengeUrl;
  // Keep result/retry fast: draw the export only when the player opens sharing.
  // The native-share button remains a separate, direct user gesture.
  if (!shareJob) {
    const context = structuredClone(runContext), result = { ...runResult }, token = shareGeneration;
    const portrait = COLLECTION.find(c => c.id === resultRecord?.unlocked.at(-1))?.asset;
    shareJob = prepareShareCard(context, result, portrait).then(card => {
      if (token !== shareGeneration) { revokeShareCard(card); return null; }
      shareCard = card; return card;
    }).catch(() => null);
  }
  const card = shareCard ?? await shareJob;
  if (!dialog.isConnected || !dialog.open || opened!==shareOpenGeneration) return;
  const status = dialog.querySelector<HTMLElement>('.share-status')!;
  if (!card) { status.textContent = '画像を準備できませんでした。挑戦リンクはそのまま送れます。'; return; }
  const img = dialog.querySelector<HTMLImageElement>('#share-card-preview')!;
  img.src = card.objectUrl; img.hidden = false;
  dialog.querySelector<HTMLInputElement>('#challenge-url')!.value = card.url;
  dialog.querySelectorAll<HTMLButtonElement>('button[disabled]').forEach(button => button.disabled = false);
  if(isNative() && network==='tiktok') {
    const shareButton=dialog.querySelector<HTMLButtonElement>('[data-action="native-share"]')!;
    shareButton.disabled=true;status.textContent='5秒の縦動画を準備しています…';
    try { await nativeAsset(card,true); if(opened!==shareOpenGeneration||!dialog.open)return; status.textContent='縦動画ができました。共有先からTikTokを選んでください。';shareButton.disabled=false; }
    catch {if(opened!==shareOpenGeneration)return;status.textContent='動画を準備できませんでした。画像を保存して写真投稿に使えます。';}
  } else status.textContent = label ? `画像の用意ができました。共有先から${label}を選んでください。` : '友だちも、同じお題で遊べます。';
  dialog.querySelector<HTMLButtonElement>('[data-action="native-share"]')!.textContent=label ? `共有先から${label}を選ぶ` : '友だちに送る';
}

function openCollection() {
  disposeCollectionScene();
  const existing = document.querySelector<HTMLDialogElement>('#collection-dialog');
  existing?.remove();
  app.insertAdjacentHTML('beforeend', collectionDialogHtml());
  const dialog = document.querySelector<HTMLDialogElement>('#collection-dialog')!;
  collectionPaused = !!engine && engine.status !== 'paused' && engine.status !== 'result';
  if (collectionPaused) { advance(); engine?.pause(); }
  dialog.addEventListener('close', () => { disposeCollectionScene(); if (collectionPaused && engine?.status === 'paused') engine.resume(); collectionPaused = false; lastNow = performance.now(); draw(); }, {once:true});
  dialog.showModal();
}

function showCollectionItem(id: string) {
  disposeCollectionScene();
  const item = COLLECTION.find(c => c.id === id);
  const preview = document.querySelector('#collection-preview');
  if (!item || !preview) return;
  const unlocked = save.unlocked.includes(id);
  preview.innerHTML = `${unlocked ? `<img src="${item.asset}" alt="${item.name}">` : ''}<h3>${item.name}</h3><p>${item.hint}</p>${unlocked ? `<button class="secondary-button" data-action="play-reaction" data-reaction-id="${id}">仕草をみる</button>` : '<span>あそんで、表情をみつけよう。</span>'}`;
  preview.scrollIntoView({block:'nearest',behavior:save.reduced ? 'instant' : 'smooth'});
}

function disposeCollectionScene() {
  collectionGeneration++;
  collectionLoading = false;
  collectionScene?.destroy(); collectionScene = null;
}

async function previewReaction(id: string) {
  if (!save.unlocked.includes(id)) return;
  if (collectionScene) { collectionScene.playReaction(id); return; }
  if (collectionLoading) return;
  const preview = document.querySelector<HTMLElement>('#collection-preview');
  if (!preview) return;
  const token = collectionGeneration;
  const viewport = document.createElement('div');
  viewport.className = 'collection-live-preview';
  viewport.setAttribute('aria-label','猫の目と耳の仕草');
  viewport.style.cssText='position:relative;width:100%;aspect-ratio:941/1000;overflow:hidden;border-radius:20px;margin:12px 0;background:#f6e7ce';
  const host = document.createElement('div');
  host.style.cssText='position:absolute;width:941px;height:1672px;left:0;top:0;transform-origin:0 0';
  viewport.append(host); preview.append(viewport);
  host.style.transform = `scale(${viewport.clientWidth / 941}) translateY(-350px)`;
  collectionLoading = true;
  try {
    const next = await GameScene.create(host, new GameEngine(5), {fixture:false,reduced:save.reduced});
    if (token !== collectionGeneration || !host.isConnected) { next.destroy(); return; }
    collectionScene = next; next.playReaction(id);
    viewport.scrollIntoView({block:'nearest',behavior:save.reduced ? 'instant' : 'smooth'});
  } catch { viewport.textContent = '仕草を読み込めませんでした。表情を選び直しておためしください。'; }
  finally { if (token === collectionGeneration) collectionLoading = false; }
}

app.addEventListener('click', event => {
  const target = event.target as Element;
  const collectionItem = target.closest<HTMLButtonElement>('[data-collection-id]');
  if (collectionItem) { showCollectionItem(collectionItem.dataset.collectionId!); return; }
  const mode = target.closest<HTMLButtonElement>('[data-mode]');
  if (mode) { sound(); void startMode(Number(mode.dataset.mode)); return; }
  const button = target.closest<HTMLButtonElement>('[data-action]');
  if (!button) return;
  event.stopPropagation();
  const action = button.dataset.action;
  if(action==='social-share' && runContext && runResult && !runTainted) {
    const network=button.dataset.network as SocialNetwork;
    if(network==='x'){void openExternal(xIntent(runContext,runResult));return;}
    void openShare(network);return;
  }
  if(action==='copy-caption') {const value=document.querySelector<HTMLTextAreaElement>('#share-caption')!.value;void copyChallenge(value).then(ok=>{const status=document.querySelector('.share-status');if(status)status.textContent=ok?'投稿用の文章をコピーしました。':'文章を選択してコピーしてください。';if(!ok)document.querySelector<HTMLTextAreaElement>('#share-caption')?.select();});return;}
  if(action==='finish-cheeks' && engine?.mode===5 && engine.status==='playing') {engine.cancel();engine.success=cheekSession.size===6;engine.status='result';draw();return;}
  if (action === 'close-stage-lock') { document.querySelector<HTMLDialogElement>('#stage-lock-dialog')?.close(); return; }
  if (action === 'journey-current') { const id = currentStage(); if (id) void startMode(id); return; }
  if (action === 'next-stage') { const id = Number(button.dataset.nextMode); if (id >= 1 && id <= 6) void startMode(id); return; }
  if (action === 'pending-challenge' && pendingRun) { const context = structuredClone(pendingRun); if (isStageUnlocked(context.mode)) rememberPending(null); void startMode(context.mode,context); return; }
  if (action === 'daily') { const today = dailyContext(); void startMode(today.mode, today); return; }
  if (action === 'collection') { openCollection(); return; }
  if (action === 'close-collection') { document.querySelector<HTMLDialogElement>('#collection-dialog')?.close(); return; }
  if (action === 'close-share') { document.querySelector<HTMLDialogElement>('#share-dialog')?.close(); return; }
  if (action === 'close-discovery') { document.querySelector('#discovery-toast')?.remove(); return; }
  if (action === 'play-reaction') {
    const id = button.dataset.reactionId!;
    if (!save.unlocked.includes(id)) return;
    scene?.playReaction(id);
    void previewReaction(id);
    return;
  }
  if (action === 'share') { void openShare(); return; }
  if (action === 'native-share' && challengeUrl) {
    const job = shareCard ? shareNetwork ? shareSocial(shareCard,shareNetwork) : sharePrepared(shareCard) : typeof navigator.share === 'function' ? navigator.share({title:'猫つぶしの挑戦状',text:'この記録、超えられる？',url:challengeUrl}).then(() => 'shared' as const).catch(error => error?.name === 'AbortError' ? 'cancelled' as const : 'fallback' as const) : Promise.resolve('fallback' as const);
    void job.then(outcome => {
      const status = document.querySelector<HTMLElement>('.share-status');
      if (status) status.textContent = outcome === 'fallback' ? '下の「リンクをコピー」や「画像を保存」から送れます。' : outcome === 'cancelled' ? 'いつでも、また送れます。' : '共有操作が完了しました。投稿先でも内容をご確認ください。';
    }); return;
  }
  if (action === 'copy-challenge' && challengeUrl) {
    void copyChallenge(challengeUrl).then(ok => {
      const status = document.querySelector<HTMLElement>('.share-status');
      if (status) status.textContent = ok ? '挑戦リンクをコピーしました。' : 'リンクを長押ししてコピーしてください。';
      if (!ok) document.querySelector<HTMLInputElement>('#challenge-url')?.select();
    }); return;
  }
  if (action === 'download-card' && shareCard) { if(isNative())void shareSocial(shareCard,'instagram');else downloadShareCard(shareCard); return; }
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
  if (action === 'retry') { retryMode(); return; }
  advance();
  if (action === 'pause') engine.pause();
  if (action === 'resume') { engine.resume(); lastNow = performance.now(); }
  if (action === 'reset') { engine.reset(); lastEventId = 0; scene?.reset(engine); sound('spring'); }
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

function frame() { advance(); if (engine && scene && !loading) draw(); collectionScene?.render(); requestAnimationFrame(frame); }
requestAnimationFrame(frame);
const initialMode = Number(params.get('mode'));
const shared = parseChallenge(params);
if (shared.context) void startMode(shared.context.mode, shared.context);
else if (shared.error || invalidSeed) void menu().then(() => {
  const banner = document.createElement('aside'); banner.className = 'game-banner'; banner.setAttribute('role', 'alert');
  banner.textContent = shared.error ?? 'お題を読み込めませんでした。メニューからあそんでください。';
  document.querySelector('.menu-header')?.after(banner);
});
else if (Number.isInteger(initialMode) && initialMode >= 1 && initialMode <= 6) void startMode(initialMode);
else void menu();

void nativeLifecycle(suspend,()=>{lastNow=performance.now();},query=>{const link=parseChallenge(query);if(link.context)void startMode(link.context.mode,link.context);}).catch(()=>{});
