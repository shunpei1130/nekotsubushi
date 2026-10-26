/** Actual Playwright WebKit smoke with native trusted touch input, not synthetic DOM events. */
import { webkit, devices, type Browser, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const base = process.env.BASE_URL || 'http://127.0.0.1:5173';
const out = resolve(import.meta.dirname, '../artifacts');
const reportFile = process.env.QA_REPORT || 'webkit-report.json';
const report: any = {
  date: new Date().toISOString(), baseURL: base, browser: 'WebKit', viewport: { width: 390, height: 844 },
  method: 'Playwright 1.56.1 WebKit 26.0, iPhone 13 mobile/touch context. Native WebKit Input.dispatchTouchEvent produces trusted touch PointerEvents. Deterministic game time uses __game.step; game state is never directly changed.',
  checks: [], screenshots: [], errors: [], snapshots: {},
  limitations: ['This is Linux WebKit with an iPhone viewport/user agent, not a physical iPhone or shipping iOS Safari. Physical-device certification remains outstanding.'],
  environment: { customExecutable: process.env.WEBKIT_EXECUTABLE_PATH || null },
};
let browser: Browser | undefined;
let page: Page;
let touchId = 10;
let active: { x: number; y: number; id: number } | null = null;
const errors: string[] = [];

async function snapshot() { return page.evaluate(() => (window as any).__game.snapshot()); }
async function step(ms: number) { await page.evaluate(v => (window as any).__game.step(v), ms); }
async function settle() {
  await page.waitForFunction(() => (window as any).__ready && !!(window as any).__game, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.evaluate(() => {
    (window as any).__webkitTouches = [];
    document.querySelector('#stage')!.addEventListener('pointerdown', e => {
      const p = e as PointerEvent;
      (window as any).__webkitTouches.push({ type: p.type, isTrusted: p.isTrusted, pointerType: p.pointerType });
    });
  });
}
async function open(mode: number) {
  active = null;
  await page.goto(`${base}/?mode=${mode}&test=1`, { waitUntil: 'networkidle' });
  await settle();
  assert.equal((await snapshot()).mode, mode);
}
async function point(x: number, y: number) {
  const r = await page.locator('#stage').boundingBox();
  assert.ok(r);
  return { x: Math.round(r.x + x / 941 * r.width), y: Math.round(r.y + y / 1672 * r.height) };
}
async function nativeTouch(type: string, p: { x: number; y: number; id: number }) {
  // WebKit has no public Playwright touch-drag API. The pinned in-process connection
  // exposes the real browser protocol session; no event is dispatched through JS/DOM.
  const impl = (page as any)._connection.toImpl(page);
  await impl.delegate._pageProxySession.send('Input.dispatchTouchEvent', { type, touchPoints: [p] });
}
async function down(x: number, y: number) {
  active = { ...await point(x, y), id: ++touchId };
  await nativeTouch('touchStart', active);
}
async function move(x: number, y: number) {
  assert.ok(active);
  active = { ...await point(x, y), id: active.id };
  await nativeTouch('touchMove', active);
}
async function up() {
  assert.ok(active);
  await nativeTouch('touchEnd', active);
  active = null;
}
async function tap(x: number, y: number) {
  const p = await point(x, y);
  await page.touchscreen.tap(p.x, p.y);
}
async function shot(name: string, full = false) {
  const file = `webkit-${name}.png`;
  if (full) await page.screenshot({ path: resolve(out, file), fullPage: true });
  else await page.locator('#stage').screenshot({ path: resolve(out, file) });
  report.screenshots.push(file);
}
async function check(name: string, task: () => Promise<void>) {
  if (process.env.QA_FILTER && !new RegExp(process.env.QA_FILTER).test(name)) return;
  const t = Date.now();
  try { await task(); report.checks.push({ name, passed: true, elapsedMs: Date.now() - t }); console.log(`PASS ${name}`); }
  catch (e) { report.checks.push({ name, passed: false, error: e instanceof Error ? e.stack : String(e), elapsedMs: Date.now() - t }); console.error(`FAIL ${name}: ${e}`); }
}
async function until(phase: string) {
  for (let n = 0; n < 140; n++) { if ((await snapshot()).phase === phase) return; await step(50); }
  throw new Error(`Phase ${phase} not reached: ${JSON.stringify(await snapshot())}`);
}
await mkdir(out, { recursive: true });
try {
  browser = await webkit.launch({ headless: true, ...(process.env.WEBKIT_EXECUTABLE_PATH ? { executablePath: process.env.WEBKIT_EXECUTABLE_PATH } : {}) });
  report.version = browser.version();
  const context = await browser.newContext({ ...devices['iPhone 13'], viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
  page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', e => { if (e.type() === 'error') errors.push(e.text()); });
  page.on('response', response => { if (response.status() >= 400 && new URL(response.url()).origin === new URL(base).origin) errors.push(`HTTP ${response.status()} ${new URL(response.url()).pathname}`); });

  await check('WK-NAV: six thumbnails decode; trusted touch opens every mode with no input leak', async () => {
    await page.goto(`${base}/?test=1`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => (window as any).__ready);
    assert.equal(await page.locator('[data-mode]').count(), 6);
    assert.equal(await page.locator('img').evaluateAll(imgs => imgs.filter(i => !(i as HTMLImageElement).complete || !(i as HTMLImageElement).naturalWidth).length), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    report.environment = { ...report.environment, ...await page.evaluate(() => ({ userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints, touchEventAvailable: 'ontouchstart' in window, devicePixelRatio, width: innerWidth, height: innerHeight })) };
    await shot('menu-mobile', true);
    for (let mode = 1; mode <= 6; mode++) {
      await page.locator(`[data-mode="${mode}"]`).tap();
      await settle();
      const state = await snapshot();
      assert.equal(state.mode, mode);
      assert.equal(state.score, 0);
      assert.equal(state.status, mode === 5 ? 'playing' : 'ready');
      assert.equal(await page.locator('#stage canvas').count(), 1);
      const r = await page.locator('#stage').boundingBox();
      assert.ok(r && r.x >= 0 && r.y >= 0 && r.x + r.width <= 391 && r.y + r.height <= 845);
      assert.ok(Math.abs(r.width / r.height - 941 / 1672) < 0.002);
      await shot(`mode-${mode}-ready`);
      await page.locator('[data-action="menu"]').tap();
      await page.locator('[data-mode="1"]').waitFor();
    }
  });

  await check('WK-G01: native touch tap scores and 30-second result replays', async () => {
    await open(1); await tap(650, 850);
    assert.equal((await snapshot()).score, 1);
    const events = await page.evaluate(() => (window as any).__webkitTouches);
    assert.ok(events.some((e: any) => e.isTrusted && e.pointerType === 'touch'));
    report.nativeTouchEvidence = events;
    await shot('mode-1-touch'); await step(31000);
    assert.equal((await snapshot()).status, 'result');
    await page.locator('[data-action="retry"]').tap(); await settle();
    assert.equal((await snapshot()).status, 'ready');
    assert.equal((await snapshot()).score, 0);
  });

  await check('WK-G02: native touch swipe during jump moves the box and scores', async () => {
    await open(2); await tap(470, 1050);
    await down(470, 1050); await until('JUMP'); await step(40); await move(735, 1050);
    const state = await snapshot();
    assert.equal(state.encounterOutcome, 'SUCCESS'); assert.equal(state.score, 1);
    await shot('mode-2-swipe'); await up();
    await step(31000); assert.equal((await snapshot()).status, 'result');
    await page.locator('[data-action="retry"]').tap(); await settle();
    assert.equal((await snapshot()).score, 0);
  });

  await check('WK-G03: native touch hold/release succeeds; held-through punch fails', async () => {
    await open(3); await down(470, 850); await step(1000);
    assert.equal((await snapshot()).status, 'playing'); await shot('mode-3-hold'); await up();
    let state = await snapshot(); assert.equal(state.success, true); assert.ok(state.score >= 1);
    await page.locator('[data-action="retry"]').tap(); await settle();
    await down(470, 850); await step(6000); state = await snapshot();
    assert.equal(state.phase, 'PUNCH'); assert.equal(state.success, false);
    await up(); await page.locator('[data-action="retry"]').tap(); await settle();
    assert.equal((await snapshot()).status, 'ready');
  });

  await check('WK-G04: native tap puts on hat and ignores taps while worn', async () => {
    await open(4); await tap(650, 850); assert.equal((await snapshot()).score, 1);
    await step(180); await tap(650, 850); assert.equal((await snapshot()).score, 1);
    await until('BARE'); await step(160); await tap(650, 850);
    assert.equal((await snapshot()).score, 2); await shot('mode-4-hat');
    await step(16000); assert.equal((await snapshot()).status, 'result');
    await page.locator('[data-action="retry"]').tap(); await settle();
    assert.equal((await snapshot()).score, 0);
  });

  await check('WK-G05: native touch drags both cheeks; release and reset restore face', async () => {
    await open(5); await down(650, 900); await move(850, 950);
    let state = await snapshot(); assert.equal(state.phase, 'DRAGGING'); assert.equal(state.cheekSide, 'right'); assert.ok(state.cheekX > 60);
    await shot('mode-5-right'); await up(); await step(600);
    assert.equal((await snapshot()).cheekX, 0);
    await down(180, 900); await move(70, 930); state = await snapshot();
    assert.equal(state.cheekSide, 'left'); assert.ok(state.cheekX < -20);
    await shot('mode-5-left'); await up();
    await page.locator('[data-action="reset"]').tap(); state = await snapshot();
    assert.equal(state.cheekX, 0); assert.equal(state.elapsed, 0); assert.equal(state.score, 0);
  });

  await check('WK-G06: native touch moves feather; release keeps pursuit; capture retries', async () => {
    await open(6); const first = await snapshot();
    await down(first.toyX, first.toyY); await move(420, first.toyY); await step(80);
    assert.ok((await snapshot()).toyX < first.toyX - 20); await shot('mode-6-drag');
    await up(); const released = await snapshot(); await step(80);
    assert.ok((await snapshot()).elapsed > released.elapsed);
    await step(14000); const state = await snapshot();
    assert.equal(state.status, 'result'); assert.equal(state.phase, 'CAPTURED');
    await page.locator('[data-action="retry"]').tap(); await settle();
    assert.equal((await snapshot()).status, 'ready');
  });

  await check('WK-LIFE: pause freezes; resume and menu touches do not leak', async () => {
    await open(1); await tap(650, 850); await step(200);
    await page.locator('[data-action="pause"]').tap(); const paused = await snapshot();
    assert.equal(paused.status, 'paused'); await step(5000);
    assert.equal((await snapshot()).elapsed, paused.elapsed); await shot('paused', true);
    await page.locator('[data-action="resume"]').tap(); assert.equal((await snapshot()).score, 1);
    await step(200); assert.equal((await snapshot()).status, 'playing');
    await page.locator('[data-action="menu"]').tap(); await page.locator('[data-mode="1"]').tap(); await settle();
    assert.equal((await snapshot()).score, 0); assert.equal((await snapshot()).status, 'ready');
  });

  await check('WK-LAYOUT: iPhone viewport and landscape preserve stage and 44px navigation', async () => {
    for (const [width, height] of [[390, 844], [375, 667], [844, 390]]) {
      await page.setViewportSize({ width, height }); await open(5);
      const stage = await page.locator('#stage').boundingBox(); const back = await page.locator('[data-action="menu"]').boundingBox();
      assert.ok(stage && stage.x >= -1 && stage.y >= -1 && stage.x + stage.width <= width + 1 && stage.y + stage.height <= height + 1);
      assert.ok(back && back.width >= 44 && back.height >= 44);
      assert.ok(Math.abs(stage.width / stage.height - 941 / 1672) < 0.002);
      await shot(`layout-${width}x${height}`, true);
    }
  });

  await check('WK-CONSOLE: no uncaught JS, console or local asset HTTP errors', async () => {
    report.errors = [...new Set(errors)]; assert.deepEqual(report.errors, []);
  });
  await context.close();
} catch (e) { report.fatal = e instanceof Error ? e.stack : String(e); console.error(report.fatal); }
finally {
  report.passed = report.checks.filter((c: any) => c.passed).length;
  report.failed = report.checks.filter((c: any) => !c.passed).length + (report.fatal ? 1 : 0);
  await writeFile(resolve(out, reportFile), JSON.stringify(report, null, 2));
  await browser?.close();
}
console.log(`WebKit smoke: ${report.passed} passed, ${report.failed} failed. artifacts/${reportFile}`);
if (report.failed) process.exitCode = 1;
