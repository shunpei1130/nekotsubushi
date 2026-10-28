import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { seedHistoricalScript } from './journey-fixtures.ts';

const base = process.env.BASE_URL || 'http://127.0.0.1:5174';
const out = 'artifacts/hat-motion';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.addInitScript(seedHistoricalScript());
const report: any = { date: new Date().toISOString(), baseURL: base, checks: [], frames: {}, errors: [],
  method: 'Real pointer input; deterministic engine clock; hat fall uses actual presentation frames. Constructed new journey proofs prepare an unlocked regression player. Mobile viewport is emulation.' };
page.on('pageerror', e => report.errors.push(e.message));
page.on('console', e => { if (e.type() === 'error') report.errors.push(e.text()); });
page.on('response', r => { if (r.status() >= 400) report.errors.push(`HTTP ${r.status()} ${r.url()}`); });
const state = () => page.evaluate(() => (window as any).__game.snapshot());
const visual = () => page.evaluate(() => (window as any).__game.visual());
const step = (ms: number) => page.evaluate(v => (window as any).__game.step(v), ms);
let stageRect: { x: number; y: number; width: number; height: number } | null = null;
async function open(mode: number, fixture = false) {
  await page.goto(`${base}/?mode=${mode}&test=1${fixture ? '&fixture=reference&capture=1' : ''}`);
  await page.waitForFunction(() => (window as any).__ready && !!(window as any).__game);
  await page.evaluate(() => document.fonts.ready);
}
async function tap(x: number, y: number) {
  const r = stageRect ||= (await page.locator('#stage').boundingBox())!;
  await page.mouse.click(r.x + x / 941 * r.width, r.y + y / 1672 * r.height);
}
async function shot(name: string) {
  report.frames[name] = { state: await state(), visual: await visual() };
  await page.locator('#stage').screenshot({ path: `${out}/${name}.png` });
}
try {
  await open(4);
  let h = (await visual()).hats;
  assert.ok(h.floor.banana.visible && h.floor.fish.visible && !h.head.visible);
  await tap(470, 1000); await step(100);
  h = (await visual()).hats;
  assert.equal(h.worn, 'banana'); assert.equal(h.floor.banana.visible, false); assert.equal(h.floor.fish.visible, true);
  // Observe the boundary and release in the event task, avoiding a sequence of
  // automation round trips that can outlast the entire short drop.
  const removal = await page.evaluate(() => {
    const g = (window as any).__game, s = g.snapshot();
    g.step((s.phaseDuration - s.phaseTime) * 1000 + 1);
    const phase = g.snapshot().phase; g.step(110);
    document.querySelector('#stage')!.addEventListener('pointerup', () => {
      (window as any).__hatFastTap = g.visual().hats;
    }, { once: true });
    return { phase, after: g.snapshot().phase, hats: g.visual().hats };
  });
  assert.equal(removal.phase, 'REMOVING'); assert.equal(removal.after, 'BARE');
  assert.ok(removal.hats.falling.some((d: any) => d.kind === 'banana'));
  // A new real tap takes the other physical prop without deleting this drop.
  await tap(470, 1000);
  h = await page.evaluate(() => (window as any).__hatFastTap);
  assert.equal(h.worn, 'fish'); assert.equal(h.floor.fish.visible, false);
  assert.ok(h.falling.some((d: any) => d.kind === 'banana'));
  await step(100);
  await page.waitForFunction(() => {
    const h = (window as any).__game.visual().hats;
    return h.floor.banana.visible && !h.falling.length;
  }, undefined, { timeout: 10000 });
  await shot('fish-worn-banana-landed');
  report.checks.push({ name: 'Fast next tap preserves detached banana; fish has no floor duplicate', passed: true });
  const fish = await state();
  await step((fish.phaseDuration - fish.phaseTime) * 1000 + 1); await step(110);
  await page.waitForFunction(() => {
    const h = (window as any).__game.visual().hats;
    return h.floor.banana.visible && h.floor.fish.visible && !h.falling.length && !h.head.visible;
  }, undefined, { timeout: 10000 });
  await shot('both-hats-landed');
  report.checks.push({ name: 'Both removed hats settle and persist on the floor', passed: true });
  await step(16000); await page.locator('[data-action=retry]').click();
  await page.waitForFunction(() => (window as any).__ready && (window as any).__game.snapshot().status === 'ready');
  assert.equal((await state()).score, 0);
  h = (await visual()).hats;
  assert.ok(h.floor.banana.visible && h.floor.fish.visible && !h.falling.length && !h.head.visible);
  report.checks.push({ name: 'Retry resets physical hat states and score', passed: true });
  await page.setViewportSize({ width: 941, height: 1672 });
  await open(4, true); h = (await visual()).hats;
  assert.equal(h.worn, 'banana'); assert.ok(h.floor.fish.visible && !h.floor.banana.visible && !h.falling.length);
  await page.locator('#stage').screenshot({ path: 'artifacts/actual-04.png' });
  report.checks.push({ name: 'Native reference pose retains banana on head and fish on left floor', passed: true });
  assert.deepEqual(report.errors, []);
  report.checks.push({ name: 'No JavaScript, console or missing-asset errors', passed: true });
} catch (e) { report.failed = String(e); throw e; }
finally {
  report.passed = report.checks.length;
  await writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  await browser.close();
  console.log(JSON.stringify({ passed: report.passed, failed: report.failed || false, errors: report.errors }));
}
