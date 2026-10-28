/** Browser presentation regressions. Input is real; only the engine clock is stepped. */
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { seedHistoricalScript } from './journey-fixtures.ts';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, 'artifacts/improved-motion');
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173';
const reportFile = process.env.QA_REPORT_NAME ?? 'report.json';
const filter = process.env.QA_FILTER ? new RegExp(process.env.QA_FILTER) : null;
const report: any = {
  date: new Date().toISOString(), baseURL: base, browser: '',
  method: 'Real browser pointer input at 390×844. test=1 freezes game time except __game.step; presentation animation uses real render time. Videos and keyframes show entry/landing, hand retreat, punch return and cheek deformation. Constructed qualifying new journey proofs prepare an unlocked regression player.',
  checks: [], frames: {}, screenshots: [], videos: [], errors: [],
  limitations: ['Mobile viewport emulation is not a physical iPhone or Android device test.', 'Video timing includes screenshot and browser automation overhead; engine events are advanced explicitly.'],
};
let browser: Browser | undefined;
let failures = 0;

const state = (page: Page): Promise<any> => page.evaluate(() => (window as any).__game.snapshot());
const visual = (page: Page): Promise<any> => page.evaluate(() => (window as any).__game.visual());
async function step(page: Page, ms: number) {
  await page.evaluate(ms => (window as any).__game.step(ms), ms);
}
async function open(page: Page, mode: number, fixture = false) {
  await page.goto(`${base}/?mode=${mode}&test=1${fixture ? '&fixture=reference&capture=1' : ''}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (window as any).__ready && typeof (window as any).__game?.visual === 'function', undefined, { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  assert.equal((await state(page)).mode, mode);
}
async function position(page: Page, x: number, y: number) {
  const box = await page.locator('#stage').boundingBox();
  assert.ok(box && box.width > 0 && box.height > 0, 'visible game stage');
  return { x: box.x + x / 941 * box.width, y: box.y + y / 1672 * box.height };
}
async function move(page: Page, x: number, y: number, steps = 1) {
  const p = await position(page, x, y);
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
async function armReleaseProbe(page: Page) {
  await page.evaluate(() => document.querySelector('#stage')!.addEventListener('pointerup', () => {
    (window as any).__motionRelease = { state: (window as any).__game.snapshot(),
      visual: (window as any).__game.visual(), modal: !!document.querySelector('.result-modal') };
  }, { once: true }));
}
async function until(page: Page, phase: string) {
  for (let i = 0; i < 150; i++) {
    const s = await state(page);
    if (s.phase === phase) return s;
    assert.notEqual(s.status, 'result', `unexpected result before ${phase}`);
    const remaining = Number.isFinite(s.phaseDuration) ? (s.phaseDuration - s.phaseTime) * 1000 + 1 : 100;
    await step(page, Math.max(1, Math.min(120, remaining)));
  }
  throw new Error(`Phase ${phase} was not reached: ${JSON.stringify(await state(page))}`);
}
async function frame(page: Page, name: string, screenshot = true) {
  const { state: s, visual: v } = await page.evaluate(() => ({
    state: (window as any).__game.snapshot(), visual: (window as any).__game.visual(),
  }));
  report.frames[name] = { state: s, visual: v };
  if (screenshot) {
    const file = `${name}.png`;
    await page.locator('#stage').screenshot({ path: resolve(out, file) });
    report.screenshots.push(file);
  }
  return v;
}
async function check(name: string, task: () => Promise<void>) {
  if (filter && !filter.test(name)) return;
  const start = Date.now();
  try {
    await task();
    report.checks.push({ name, passed: true, elapsedMs: Date.now() - start });
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    const message = error instanceof Error ? error.stack : String(error);
    report.checks.push({ name, passed: false, elapsedMs: Date.now() - start, error: message });
    console.error(`FAIL ${name}: ${message}`);
  }
}
async function recorded(name: string, task: (page: Page) => Promise<void>) {
  const context = await browser!.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true,
    recordVideo: { dir: resolve(out, 'video'), size: { width: 390, height: 844 } } });
  await context.addInitScript(seedHistoricalScript());
  const page = await context.newPage();
  page.on('pageerror', error => report.errors.push({ mode: name, message: error.message }));
  page.on('console', message => { if (message.type() === 'error') report.errors.push({ mode: name, message: message.text() }); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push({ mode: name, url: response.url(), status: response.status() }); });
  try { await task(page); }
  finally {
    const video = page.video();
    await context.close();
    if (video) {
      const file = `video/${name}.webm`;
      await video.saveAs(resolve(out, file));
      await video.delete();
      report.videos.push(file);
    }
  }
}
function contact(v: any) {
  const c = v.cheek?.contact ?? v.cheek;
  assert.ok(Number.isFinite(c?.x) && Number.isFinite(c?.y), 'actual cheek contact is exposed');
  return { x: Number(c.x), y: Number(c.y) };
}
function near(actual: number, expected: number, tolerance: number, name: string) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${name}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

await mkdir(resolve(out, 'video'), { recursive: true });
try {
  browser = await chromium.launch({ executablePath: process.env.CHROMIUM_EXECUTABLE_PATH ?? '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  report.browser = await browser.version();

  await check('M01: caught reaction hides the scoring hand and +1', async () => {
    const context = await browser!.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
    await context.addInitScript(seedHistoricalScript());
    const page = await context.newPage();
    try {
      await open(page, 1);
      await tap(page, 650, 850);
      await until(page, 'OPEN');
      await down(page, 650, 850);
      assert.equal((await state(page)).phase, 'CAUGHT');
      const caught = await frame(page, '01-caught');
      assert.equal(caught.hand.visible, false, 'caught reaction never shows the successful tap hand');
      assert.ok(!(await page.locator('.scene-effects').innerText()).includes('+1'), 'caught reaction never shows a +1 reward');
      await page.mouse.up();
    } finally { await context.close(); }
  });

  await check('M02: real MISS and EARLY enter the layered box; SUCCESS lands on the rug', async () => {
    await recorded('mode02-entry-and-landing', async page => {
      for (const outcome of ['MISS', 'EARLY', 'SUCCESS']) {
        await open(page, 2);
        await frame(page, `02-${outcome.toLowerCase()}-ready`);
        await tap(page, 470, 1050);
        if (outcome === 'EARLY') {
          await down(page, 470, 1050);
          await move(page, 715, 1050, 5);
          await page.mouse.up();
        }
        await until(page, 'JUMP');
        if (outcome === 'SUCCESS') {
          await step(page, 40);
          await down(page, 470, 1050);
          await move(page, 715, 1050, 5);
          await page.mouse.up();
        }
        const track: any[] = [];
        for (let i = 0; i < 11; i++) {
          await step(page, 80);
          track.push({ state: await state(page), visual: await visual(page) });
          await page.waitForTimeout(50);
          if (i === 2 || i === 5 || i === 8 || i === 10) await frame(page, `02-${outcome.toLowerCase()}-${i}`);
        }
        report.frames[`02-${outcome.toLowerCase()}-track`] = track;
        const v = await visual(page), s = await state(page);
        assert.equal(s.phase, 'REACTION');
        if (outcome === 'SUCCESS') {
          assert.equal(v.box.inBox, false, 'successful swipe leaves the cat outside the box');
          near(v.cat.y + v.cat.height, 1140, 3, 'landing feet stay planted');
        } else {
          assert.equal(v.box.inBox, true, `${outcome} must visibly enter the box`);
          assert.ok(v.box.occlusion > .9, 'cat reaches the opening behind the box front');
          assert.ok(v.layers.indexOf('boxBack') < v.layers.indexOf('cat') && v.layers.indexOf('cat') < v.layers.indexOf('boxFront'), 'back/cat/front render order');
        }
        assert.ok(track.some(f => f.visual.cat.y < 420), 'visible airborne height precedes landing');
        await frame(page, `02-${outcome.toLowerCase()}-landed`);
        await page.waitForTimeout(250);
      }
    });
  });

  await check('M03: success releases through visible retreat; punch strikes and returns before result', async () => {
    await recorded('mode03-retreat-and-punch', async page => {
      await open(page, 3);
      await down(page, 470, 850);
      await step(page, 1000);
      const holding = await frame(page, '03-holding');
      assert.equal(holding.hand.visible, true);
      await armReleaseProbe(page);
      await page.mouse.up();
      const releaseFrame = await page.evaluate(() => (window as any).__motionRelease);
      report.frames['03-release-frame'] = releaseFrame;
      const released = releaseFrame.visual;
      assert.equal(released.hand.visible, true, 'release does not make the hand disappear on its first frame');
      assert.equal(releaseFrame.modal, false, 'retreat remains visible before result overlay');
      await page.waitForTimeout(80);
      const retreat = await frame(page, '03-success-retreat');
      assert.ok(retreat.hand.y > holding.hand.y, 'the hand visibly withdraws downward');
      await page.waitForFunction(() => !(window as any).__game.visual().hand.visible, undefined, { timeout: 5000 });
      const successEnd = await frame(page, '03-success-withdrawn');
      assert.equal(successEnd.hand.visible, false, 'hand is withdrawn after the release animation');

      await open(page, 3);
      await down(page, 470, 850);
      const s = await state(page);
      await step(page, s.punchAt * 1000 - 300);
      await frame(page, '03-warning');
      // Sample transforms without slow screenshot encoding advancing the animation.
      const punch = await page.evaluate(async () => {
        (window as any).__game.step(301);
        const initial = (window as any).__game.visual();
        const frames: any[] = [], started = performance.now();
        let peakPng = '';
        while (performance.now() - started < 1000) {
          const v = (window as any).__game.visual();
          frames.push({ ms: performance.now() - started, visual: v, modal: !!document.querySelector('.result-modal') });
          if (!peakPng && Math.abs(v.paw.rotation) > .55) peakPng = document.querySelector<HTMLCanvasElement>('#stage canvas')!.toDataURL('image/png');
          await new Promise<void>(done => requestAnimationFrame(() => done()));
        }
        return { initial, frames, peakPng };
      });
      const impactStart = punch.initial, track = punch.frames;
      report.frames['03-punch-start'] = { visual: impactStart };
      report.frames['03-punch-track'] = track;
      assert.equal(impactStart.hand.visible, true, 'hand remains visible at the start of the punch');
      assert.ok(track.some(f => Math.abs(f.visual.paw.rotation - impactStart.paw.rotation) > .25), 'paw strikes visibly from its shoulder');
      assert.ok(track.some(f => f.visual.hand.visible), 'hand is visible during the hit');
      assert.ok(!track.some(f => f.modal && (f.visual.hand.visible || Math.abs(f.visual.paw.rotation) > .02)), 'result overlay waits for the hand and strike to complete');
      if (punch.peakPng) {
        const file = '03-punch-impact-canvas.png';
        await writeFile(resolve(out, file), Buffer.from(punch.peakPng.split(',')[1], 'base64'));
        report.screenshots.push(file);
      }
      await page.waitForFunction(() => {
        const v = (window as any).__game.visual();
        return !v.hand.visible && Math.abs(v.paw.rotation) < .02;
      }, undefined, { timeout: 5000 });
      const returned = await frame(page, '03-punch-return');
      assert.equal(returned.hand.visible, false, 'hand retreats after punch contact');
      assert.ok(Math.abs(returned.paw.rotation) < .02, 'paw returns after the hit');
      assert.equal(await page.locator('.result-modal').count(), 1, 'result appears after visible punch');
      await page.mouse.up();
    });
  });

  await check('M03-REDUCED: essential release and punch retreat complete with reduced motion', async () => {
    const context = await browser!.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    await context.addInitScript(seedHistoricalScript());
    const page = await context.newPage();
    try {
      await open(page, 3);
      assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true);
      await down(page, 470, 850);
      await step(page, 1000);
      await armReleaseProbe(page);
      await page.mouse.up();
      const release = await page.evaluate(() => (window as any).__motionRelease);
      report.frames['03-reduced-release-frame'] = release;
      assert.equal(release.visual.hand.visible, true, 'reduced motion preserves the first retreat frame');
      await page.waitForFunction(() => !(window as any).__game.visual().hand.visible, undefined, { timeout: 5000 });
      await frame(page, '03-reduced-success-withdrawn');
      await open(page, 3);
      await down(page, 470, 850);
      const first = await page.evaluate(() => { (window as any).__game.step(6000); return {
        visual: (window as any).__game.visual(), modal: !!document.querySelector('.result-modal'),
      }; });
      report.frames['03-reduced-punch-start'] = first;
      assert.equal(first.visual.hand.visible, true, 'reduced motion preserves punch contact presentation');
      assert.equal(first.modal, false, 'reduced motion result waits for the strike');
      await page.waitForFunction(() => {
        const v = (window as any).__game.visual();
        return !v.hand.visible && Math.abs(v.paw.rotation) < .02;
      }, undefined, { timeout: 5000 });
      await frame(page, '03-reduced-punch-return');
      await page.mouse.up();
      await page.setViewportSize({ width: 941, height: 1672 });
      await open(page, 3, true);
      await frame(page, 'actual-03');
    } finally { await context.close(); }
  });

  await check('M05: multiple anchors stay attached through inward pulls and spring back', async () => {
    await recorded('mode05-anchors-and-inward-pulls', async page => {
      await open(page, 5);
      await frame(page, '05-neutral');
      const anchors = [{ x: 180, y: 850, side: 'left' }, { x: 230, y: 1050, side: 'left' }, { x: 620, y: 800, side: 'right' }, { x: 780, y: 1020, side: 'right' }];
      for (let i = 0; i < anchors.length; i++) {
        const a = anchors[i], sign = a.side === 'left' ? 1 : -1;
        await down(page, a.x, a.y);
        const start = await frame(page, `05-anchor-${i + 1}`), c0 = contact(start);
        near(c0.x, a.x, 6, 'contact follows actual pressed x');
        near(c0.y, a.y, 6, 'contact follows actual pressed y');
        assert.equal(start.hand.visible, true);
        for (let j = 1; j <= 6; j++) {
          await move(page, a.x + sign * j * 35, a.y + j * 9, 2);
          await page.waitForTimeout(45);
        }
        const pulled = await frame(page, `05-inward-${i + 1}`), c1 = contact(pulled);
        assert.ok((c1.x - c0.x) * sign > 15, 'selected material point follows the inward pull');
        assert.ok(Math.hypot(c1.x - c0.x, c1.y - c0.y) < 230, 'bounded deformation keeps the contact near its cheek');
        if (Number.isFinite(pulled.cheek?.minimumTriangleArea)) assert.ok(pulled.cheek.minimumTriangleArea > 0, 'mesh triangles retain their orientation');
        assert.equal((await state(page)).cheekSide, a.side, 'drag does not switch cheeks across the face');
        await page.mouse.up();
        await step(page, 150);
        await frame(page, `05-spring-${i + 1}`);
        await page.waitForTimeout(150);
        await step(page, 350);
        const reset = await frame(page, `05-rest-${i + 1}`, false);
        assert.equal(reset.hand.visible, false);
        const rest = await state(page);
        near(rest.cheekX, 0, .001, 'horizontal spring returns');
        near(rest.cheekY, 0, .001, 'vertical spring returns');
      }
      // Capture the real idle blink from the presented canvas in the same frame.
      // Screenshot encoding can outlast a blink, so no scene state or clock is forced.
      const blink = await page.evaluate(async () => {
        const started = performance.now();
        while (performance.now() - started < 30000) {
          const v = (window as any).__game.visual();
          if (v.eyesClosed) {
            const canvas = document.querySelector<HTMLCanvasElement>('#stage canvas')!;
            return { visual: v, state: (window as any).__game.snapshot(), png: canvas.toDataURL('image/png') };
          }
          await new Promise<void>(done => requestAnimationFrame(() => done()));
        }
        throw new Error('Natural idle blink was not presented within 30 seconds');
      });
      const file = '05-idle-blink-canvas.png';
      await writeFile(resolve(out, file), Buffer.from(blink.png.split(',')[1], 'base64'));
      report.screenshots.push(file);
      report.frames['05-idle-blink'] = { visual: blink.visual, state: blink.state,
        note: 'Same-frame presented WebGL canvas capture during a natural idle blink; DOM HUD is excluded.' };
      assert.equal(blink.state.phase, 'IDLE');
      assert.equal(blink.visual.eyesClosed, true, 'natural idle blink is actually presented');
      await page.waitForFunction(() => !(window as any).__game.visual().eyesClosed, undefined, { timeout: 3000 });
      await frame(page, '05-idle-eyes-reopened');
    });
  });

  await check('FIXTURES: six updated native-resolution reference poses', async () => {
    const context: BrowserContext = await browser!.newContext({ viewport: { width: 941, height: 1672 }, deviceScaleFactor: 1 });
    await context.addInitScript(seedHistoricalScript());
    const page = await context.newPage();
    try {
      for (let mode = 1; mode <= 6; mode++) {
        await open(page, mode, true);
        await frame(page, `actual-${String(mode).padStart(2, '0')}`);
      }
    } finally { await context.close(); }
  });
  await check('RUNTIME: no JavaScript or missing-asset errors', async () => assert.deepEqual(report.errors, []));
} finally {
  await browser?.close();
  report.passed = report.checks.filter((c: any) => c.passed).length;
  report.failed = failures;
  await writeFile(resolve(out, reportFile), JSON.stringify(report, null, 2));
}
if (failures) process.exitCode = 1;
