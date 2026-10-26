/** Browser QA: real DOM navigation and pointer input; deterministic clock advancement only. */
import { chromium, webkit, type Browser, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const root = resolve(import.meta.dirname, '..');
const browserKind = process.env.BROWSER === 'webkit' ? 'webkit' : 'chromium';
const out = resolve(root, 'artifacts', browserKind === 'webkit' ? 'webkit' : '.');
const reportName = process.env.QA_REPORT ?? (process.env.QA_FILTER ? 'browser-extra-report.json' : 'browser-report.json');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const report: any = {
  date: new Date().toISOString(), baseURL: base,
  browser: '', platform: process.platform,
  method: 'Chromium with real mouse/pointer browser input; window.__game.step advances only game time. Device viewports are emulation, not physical-device certification.',
  checks: [], errors: [], screenshots: [], snapshots: {}, performance: {},
  limitations: ['Physical iPhone Safari and Android devices are not connected. Chromium device-sized viewports do not certify physical Safari behavior.'],
};
let server: ChildProcess | undefined;
let browser: Browser | undefined;
const runtimeErrors: string[] = [];
report.httpErrors = [];

async function snapshot(page: Page): Promise<any> {
  return page.evaluate(() => (window as any).__game.snapshot());
}
async function step(page: Page, ms: number) {
  await page.evaluate((value) => (window as any).__game.step(value), ms);
}
async function settle(page: Page) {
  await page.waitForFunction(() => (window as any).__ready === true && !!(window as any).__game, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
}
async function openMode(page: Page, mode: number) {
  await page.goto(`${base}/?mode=${mode}&test=1`, { waitUntil: 'networkidle' });
  await settle(page);
  assert.equal((await snapshot(page)).mode, mode);
}
async function point(page: Page, x: number, y: number) {
  const r = await page.locator('#stage').boundingBox();
  assert.ok(r && r.width > 0 && r.height > 0, 'stage is visible');
  return { x: r.x + x * r.width / 941, y: r.y + y * r.height / 1672 };
}
async function move(page: Page, x: number, y: number, steps = 1) {
  const p = await point(page, x, y);
  await page.mouse.move(p.x, p.y, { steps });
}
async function down(page: Page, x: number, y: number) {
  await move(page, x, y);
  await page.mouse.down();
}
async function tap(page: Page, x: number, y: number) {
  await down(page, x, y);
  await page.mouse.up();
}
async function screen(page: Page, file: string, stageOnly = true) {
  const path = resolve(out, file);
  if (stageOnly) await page.locator('#stage').screenshot({ path });
  else await page.screenshot({ path, fullPage: true });
  report.screenshots.push(file);
}
async function until(page: Page, target: string, maxMs = 7000) {
  let spent = 0;
  while (spent < maxMs) {
    const s = await snapshot(page);
    if (s.phase === target) return s;
    assert.notEqual(s.status, 'result', `result before ${target}`);
    const advance = Number.isFinite(s.phaseDuration) ? Math.max(1, Math.min(100, (s.phaseDuration - s.phaseTime) * 1000 + 1)) : 50;
    await step(page, advance);
    spent += advance;
  }
  throw new Error(`Did not reach ${target}: ${JSON.stringify(await snapshot(page))}`);
}
async function check(name: string, task: () => Promise<void>) {
  if (process.env.QA_FILTER && !new RegExp(process.env.QA_FILTER).test(name)) return;
  const start = Date.now();
  try {
    await task();
    report.checks.push({ name, passed: true, elapsedMs: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (error) {
    const message = error instanceof Error ? error.stack : String(error);
    report.checks.push({ name, passed: false, elapsedMs: Date.now() - start, error: message });
    console.error(`FAIL ${name}: ${message}`);
  }
}
async function ensureServer() {
  try { if ((await fetch(base)).ok) return; } catch {}
  server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', new URL(base).port || '5173'], { cwd: root, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base)).ok) return; } catch {}
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('Local preview server did not become available');
}

await mkdir(out, { recursive: true });
try {
  await ensureServer();
  if (browserKind === 'webkit') {
    const wk = join(dirname(webkit.executablePath()), 'minibrowser-wpe');
    browser = process.env.WEBKIT_QA_LIBS ? await webkit.launch({ headless: true, executablePath: join(wk, 'bin/MiniBrowser'), env: {
      ...process.env, LD_LIBRARY_PATH: `${process.env.WEBKIT_QA_LIBS}:${wk}/lib:${wk}/sys/lib`,
      WEBKIT_EXEC_PATH: `${wk}/bin`, WEBKIT_INJECTED_BUNDLE_PATH: `${wk}/lib`, WEBKIT_INSPECTOR_RESOURCES_PATH: `${wk}/share`,
    } }) : await webkit.launch({ headless: true });
    report.method = 'Playwright WebKit with mobile-sized viewports and real browser pointer input; Linux WebKit is not physical iOS Safari.';
  } else {
    browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  }
  report.browser = await browser.version();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true });
  const page = await context.newPage();
  page.on('response', (response) => { if (response.status() >= 400) report.httpErrors.push({url: response.url(), status: response.status()}); });
  page.on('pageerror', (error) => runtimeErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') runtimeErrors.push(message.text()); });

  await check('NAV-01: all six menu cards load the correct playable mode', async () => {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.locator('[data-mode="1"]').waitFor();
    assert.equal(await page.locator('[data-mode]').count(), 6);
    await screen(page, 'menu-mobile-390.png', false);
    for (let mode = 1; mode <= 6; mode++) {
      await page.locator(`[data-mode="${mode}"]`).click();
      await settle(page);
      const s = await snapshot(page);
      assert.equal(s.mode, mode);
      assert.equal(s.score, 0, 'menu click does not leak into a game score');
      assert.equal(s.status, mode === 5 ? 'playing' : 'ready');
      await page.locator('[data-action="menu"]').click();
      await page.locator('[data-mode="1"]').waitFor();
    }
  });

  await check('G01: tap score, warning/open reaction, result and replay', async () => {
    await openMode(page, 1);
    await down(page, 650, 850);
    assert.equal((await snapshot(page)).status, 'ready');
    await page.mouse.up();
    assert.equal((await snapshot(page)).score, 1);
    await screen(page, 'motion-01-contact.png');
    await until(page, 'WARNING');
    await screen(page, 'motion-01-warning.png');
    await until(page, 'OPEN');
    await down(page, 650, 850);
    assert.equal((await snapshot(page)).phase, 'CAUGHT');
    await page.mouse.up();
    assert.equal((await snapshot(page)).score, 1);
    await screen(page, 'motion-01-caught.png');
    await step(page, 31000);
    assert.equal((await snapshot(page)).status, 'result');
    await page.locator('[data-action="retry"]').click();
    await settle(page);
    assert.equal((await snapshot(page)).status, 'ready');
    assert.equal((await snapshot(page)).score, 0);
  });

  await check('G02: real box drag during jump commits immediately once', async () => {
    await openMode(page, 2);
    await tap(page, 470, 1050);
    assert.equal((await snapshot(page)).score, 0);
    await down(page, 470, 1050);
    await until(page, 'JUMP');
    await step(page, 40);
    await move(page, 735, 1050, 3);
    let s = await snapshot(page);
    assert.equal(s.phase, 'JUMP');
    assert.equal(s.encounterOutcome, 'SUCCESS');
    assert.equal(s.score, 1);
    await screen(page, 'motion-02-swipe.png');
    await move(page, 220, 1050, 2);
    await page.mouse.up();
    assert.equal((await snapshot(page)).score, 1);
    await step(page, 31000);
    assert.equal((await snapshot(page)).status, 'result');
    await page.locator('[data-action="retry"]').click();
    await settle(page);
    assert.equal((await snapshot(page)).score, 0);
  });

  await check('G03: actual hold/release records, punch fails, cancellation does not record', async () => {
    await openMode(page, 3);
    await down(page, 470, 850);
    await step(page, 1000);
    await screen(page, 'motion-03-hold.png');
    await page.mouse.up();
    let s = await snapshot(page);
    assert.equal(s.status, 'result');
    assert.equal(s.success, true);
    assert.ok(s.score >= 1 && s.score < 1.5);
    const best = s.best;
    await page.locator('[data-action="retry"]').click();
    await settle(page);
    await down(page, 470, 850);
    await step(page, 6000);
    assert.equal((await snapshot(page)).phase, 'PUNCH');
    assert.equal((await snapshot(page)).success, false);
    await screen(page, 'motion-03-punch.png');
    await page.mouse.up();
    await page.locator('[data-action="retry"]').click();
    await settle(page);
    await down(page, 470, 850);
    await step(page, 500);
    await page.locator('#stage canvas').dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'mouse', bubbles: true });
    s = await snapshot(page);
    assert.equal(s.status, 'ready');
    assert.equal(s.best, best);
    await page.mouse.up();
  });

  await check('G04: hat taps only count while bare and replay clears score', async () => {
    await openMode(page, 4);
    await tap(page, 650, 850);
    assert.equal((await snapshot(page)).score, 1);
    await screen(page, 'motion-04-putting.png');
    await step(page, 180);
    await tap(page, 650, 850);
    assert.equal((await snapshot(page)).score, 1);
    await until(page, 'BARE');
    await step(page, 160);
    await tap(page, 650, 850);
    assert.equal((await snapshot(page)).score, 2);
    await screen(page, 'motion-04-fish.png');
    await step(page, 16000);
    assert.equal((await snapshot(page)).status, 'result');
    await page.locator('[data-action="retry"]').click();
    await settle(page);
    assert.equal((await snapshot(page)).score, 0);
    assert.equal((await snapshot(page)).phase, 'BARE');
  });

  await check('G05: both cheeks drag, stay on the selected side and spring back', async () => {
    await openMode(page, 5);
    await screen(page, 'motion-05-neutral.png');
    await down(page, 650, 900);
    await move(page, 850, 950, 5);
    let s = await snapshot(page);
    assert.equal(s.phase, 'DRAGGING');
    assert.equal(s.cheekSide, 'right');
    assert.ok(s.cheekX > 60 && s.cheekX <= 0.16 * 941);
    await screen(page, 'motion-05-right.png');
    await page.mouse.up();
    await step(page, 150);
    await screen(page, 'motion-05-return.png');
    await step(page, 450);
    assert.equal((await snapshot(page)).cheekX, 0);
    await down(page, 180, 900);
    await move(page, 650, 900, 5);
    assert.equal((await snapshot(page)).cheekSide, 'left');
    await screen(page, 'motion-05-left.png');
    await page.mouse.up();
    await step(page, 500);
    s = await snapshot(page);
    assert.equal(s.cheekX, 0);
    assert.equal(s.score, 0);
    assert.equal(s.elapsed, 0);
  });

  await check('G06: ring drag moves toy, release keeps pursuit and stationary feather is caught', async () => {
    await openMode(page, 6);
    const initial = await snapshot(page);
    await down(page, initial.toyX, initial.toyY);
    assert.equal((await snapshot(page)).status, 'playing');
    await move(page, 420, initial.toyY, 3);
    await step(page, 80);
    let s = await snapshot(page);
    assert.ok(s.toyX < initial.toyX - 20);
    await screen(page, 'motion-06-drag.png');
    await page.mouse.up();
    const released = await snapshot(page);
    await step(page, 80);
    s = await snapshot(page);
    assert.ok(s.elapsed > released.elapsed, 'release does not pause clock');
    assert.ok(Math.abs(s.toyX - released.toyX) < 0.01, 'release stops toy');
    await step(page, 14000);
    s = await snapshot(page);
    assert.equal(s.status, 'result');
    assert.equal(s.phase, 'CAPTURED');
    assert.ok(s.elapsed < 15);
    await screen(page, 'motion-06-captured.png');
    await page.locator('[data-action="retry"]').click();
    await settle(page);
    assert.equal((await snapshot(page)).status, 'ready');
  });

  await check('LIFE-01: pause freezes clock, resume does not score, blur requires explicit resume', async () => {
    await openMode(page, 1);
    await tap(page, 650, 850);
    await step(page, 200);
    await page.locator('[data-action="pause"]').click();
    const paused = await snapshot(page);
    assert.equal(paused.status, 'paused');
    await step(page, 5000);
    assert.equal((await snapshot(page)).elapsed, paused.elapsed);
    await screen(page, 'pause-mobile.png', false);
    await page.locator('[data-action="resume"]').click();
    assert.equal((await snapshot(page)).score, paused.score);
    await step(page, 500);
    assert.equal((await snapshot(page)).status, 'playing');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal((await snapshot(page)).status, 'paused');
    await page.locator('[data-action="resume"]').click();
    assert.equal((await snapshot(page)).score, 1);
  });

  await check(browserKind === 'webkit' ? 'INPUT-01: real touch tap routes through Pointer Events' : 'INPUT-01: two real touch contacts retain one pointer owner without handover', async () => {
    await openMode(page, 1);
    if (browserKind === 'webkit') {
      const target = await point(page, 650, 850);
      await page.touchscreen.tap(target.x, target.y);
      assert.equal((await snapshot(page)).score, 1);
      report.limitations.push('Simultaneous touch ownership was tested via Chromium CDP; WebKit run verifies real single touch and pointer cancellation.');
      return;
    }
    const first = await point(page, 650, 850);
    const second = await point(page, 350, 850);
    const cdp = await context.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first.x, y: first.y, id: 10 }] });
    const owner = (await snapshot(page)).pointerId;
    assert.notEqual(owner, null);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: first.x, y: first.y, id: 10 }, { x: second.x, y: second.y, id: 11 }] });
    assert.equal((await snapshot(page)).pointerId, owner);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: first.x, y: first.y, id: 10 }] });
    assert.equal((await snapshot(page)).pointerId, null);
    assert.equal((await snapshot(page)).score, 1);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: second.x + 40, y: second.y, id: 11 }] });
    assert.equal((await snapshot(page)).pointerId, null, 'second finger is not inherited');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.equal((await snapshot(page)).score, 1);
    await cdp.detach();
  });

  await check('VIS-01–06: production fixtures capture exactly 941×1672', async () => {
    await page.setViewportSize({ width: 941, height: 1672 });
    for (let mode = 1; mode <= 6; mode++) {
      await page.goto(`${base}/?mode=${mode}&fixture=reference&capture=1`, { waitUntil: 'networkidle' });
      await settle(page);
      const rect = await page.locator('#stage').boundingBox();
      assert.ok(rect);
      assert.equal(Math.round(rect.width), 941);
      assert.equal(Math.round(rect.height), 1672);
      report.snapshots[String(mode).padStart(2, '0')] = await snapshot(page);
      await screen(page, `actual-${String(mode).padStart(2, '0')}.png`);
    }
  });

  await check('LAYOUT: mobile/desktop sizes preserve stage ratio and controls', async () => {
    for (const [width, height] of [[390, 844], [360, 800], [375, 667], [1440, 900], [844, 390]]) {
      await page.setViewportSize({ width, height });
      await openMode(page, 5);
      const rect = await page.locator('#stage').boundingBox();
      assert.ok(rect);
      assert.ok(Math.abs(rect.width / rect.height - 941 / 1672) < 0.002);
      assert.ok(rect.x >= -1 && rect.y >= -1 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1);
      const back = await page.locator('[data-action="menu"]').boundingBox();
      assert.ok(back && back.width >= 44 && back.height >= 44, 'navigation touch target >=44 CSS pixels');
      await screen(page, `layout-${width}x${height}.png`, false);
    }
  });

  await check('ASSET: menu images decode and no horizontal overflow is present', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    const broken = await page.locator('img').evaluateAll((imgs) => imgs.filter((img) => !(img as HTMLImageElement).complete || (img as HTMLImageElement).naturalWidth === 0).length);
    assert.equal(broken, 0);
    await page.reload({ waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-mode]').count(), 6);
    report.performance = await page.evaluate(() => ({
      resources: performance.getEntriesByType('resource').map((e: any) => ({ name: new URL(e.name).pathname, transferSize: e.transferSize, duration: Math.round(e.duration) })),
      navigation: performance.getEntriesByType('navigation').map((e: any) => ({ domContentLoadedMs: Math.round(e.domContentLoadedEventEnd), loadMs: Math.round(e.loadEventEnd) })),
    }));
  });

  await check('ASSET-01: a failed cat download displays retry and recovers to actual play', async () => {
    const failedPage = await context.newPage();
    const expected: string[] = [];
    failedPage.on('pageerror', (error) => runtimeErrors.push(error.message));
    failedPage.on('console', (message) => { if (message.type() === 'error') expected.push(message.text()); });
    await failedPage.route('**/assets/m01-cat.webp', (route) => route.abort('failed'));
    await failedPage.goto(`${base}/?mode=1&test=1`, { waitUntil: 'networkidle' });
    await failedPage.getByRole('button', { name: 'もう一度読み込む', exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await failedPage.evaluate(() => (window as any).__ready), false);
    await screen(failedPage, 'asset-download-retry.png', false);
    await failedPage.unroute('**/assets/m01-cat.webp');
    await failedPage.getByRole('button', { name: 'もう一度読み込む', exact: true }).click();
    await settle(failedPage);
    await tap(failedPage, 650, 850);
    assert.equal((await snapshot(failedPage)).score, 1);
    report.expectedAssetFailure = expected;
    await failedPage.close();
  });

  await check('SAVE-01: successful record persists; corrupt and unavailable storage remain playable', async () => {
    await openMode(page, 3);
    await down(page, 470, 850);
    await step(page, 1200);
    await page.mouse.up();
    const achieved = (await snapshot(page)).best;
    assert.ok(achieved >= 1.2);
    await page.reload({ waitUntil: 'networkidle' });
    await settle(page);
    assert.ok((await snapshot(page)).best >= achieved, 'successful best is restored');
    await page.evaluate(() => localStorage.setItem('nekotsubushi:v1', '{broken'));
    await page.goto(base, { waitUntil: 'networkidle' });
    assert.equal(await page.locator('[data-mode]').count(), 6);
    const disabled = await context.newPage();
    disabled.on('pageerror', (e) => runtimeErrors.push(e.message));
    await disabled.addInitScript(() => {
      Object.defineProperty(Storage.prototype, 'getItem', { value() { throw new DOMException('Storage disabled', 'SecurityError'); } });
      Object.defineProperty(Storage.prototype, 'setItem', { value() { throw new DOMException('Storage disabled', 'SecurityError'); } });
    });
    await openMode(disabled, 1);
    await tap(disabled, 650, 850);
    assert.equal((await snapshot(disabled)).score, 1);
    await disabled.close();
  });

  await check('CONSOLE: no uncaught JavaScript or browser console errors', async () => {
    const unique = [...new Set(runtimeErrors)];
    report.errors = unique;
    assert.deepEqual(unique, []);
  });
  await context.close();
} catch (error) {
  report.fatal = error instanceof Error ? error.stack : String(error);
  console.error(report.fatal);
} finally {
  report.passed = report.checks.filter((c: any) => c.passed).length;
  report.failed = report.checks.filter((c: any) => !c.passed).length + (report.fatal ? 1 : 0);
  await writeFile(resolve(out, reportName), JSON.stringify(report, null, 2));
  if (browser) await browser.close();
  if (server) server.kill('SIGTERM');
}
console.log(`Browser QA: ${report.passed} passed, ${report.failed} failed. Report: ${resolve(out, reportName)}`);
if (report.failed) process.exitCode = 1;
