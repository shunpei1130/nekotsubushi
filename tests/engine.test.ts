import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, W } from '../src/engine.ts';

function tap(g: GameEngine, x = 650, y = 850, ms = 30) {
  g.down(x, y); g.update(ms); g.up(x, y);
}
function until(g: GameEngine, phase: string, maxMs = 8000) {
  for (let t = 0; g.phase !== phase && t < maxMs && g.status !== 'result'; t += 5) g.update(5);
  assert.equal(g.phase, phase);
}

test('all timed modes wait for their specified first operation', () => {
  for (const mode of [1, 2, 3, 4, 6]) {
    const g = new GameEngine(mode);
    g.update(10000);
    assert.equal(g.status, 'ready');
    assert.equal(g.elapsed, 0);
    assert.equal(g.down(0, 0), false);
    assert.equal(g.status, 'ready');
  }
  assert.equal(new GameEngine(5).status, 'playing');
});

test('one pointer owns input; a second pointer is never inherited', () => {
  const g = new GameEngine(1);
  assert.equal(g.down(650, 850, 10), true);
  assert.equal(g.down(650, 850, 11), false);
  g.update(25); g.up();
  assert.equal(g.score, 1);
  assert.equal(g.pointerId, null);
});

test('01 starts on release, counts once, and rejects repeat/long/moved candidates', () => {
  const g = new GameEngine(1);
  g.down(650, 850);
  assert.equal(g.status, 'ready');
  g.update(30); g.up();
  assert.equal(g.status, 'playing');
  assert.equal(g.score, 1);
  tap(g);
  assert.equal(g.score, 1);
  g.update(160); tap(g);
  assert.equal(g.score, 2);
  g.update(160); g.down(650, 850); g.update(301); g.up();
  assert.equal(g.score, 2);
  g.update(160); g.down(650, 850, 1, 0.5); g.move(675, 850); g.up();
  assert.equal(g.score, 2);
});

test('01 warning lasts 500ms and closed press can finish during open grace', () => {
  const g = new GameEngine(1);
  tap(g); until(g, 'WARNING');
  g.update(450);
  assert.equal(g.phase, 'WARNING');
  assert.equal(g.down(650, 850), true);
  g.update(60);
  assert.equal(g.phase, 'OPEN_GRACE');
  g.up();
  assert.equal(g.score, 2);
  g.update(125);
  assert.equal(g.phase, 'OPEN');
});

test('01 invalid long hold still gets caught at OPEN; caught lock preserves score', () => {
  const g = new GameEngine(1);
  tap(g); g.update(170);
  g.down(650, 850); g.move(900, 850);
  until(g, 'CAUGHT');
  assert.equal(g.score, 1);
  g.up();
  assert.equal(g.score, 1);
  g.update(1490);
  assert.equal(g.phase, 'CAUGHT');
  g.update(15);
  assert.equal(g.phase, 'CLOSED');
});

test('01 pause retains eye state, adds 400ms preparation, and never grants a tap', () => {
  const g = new GameEngine(1);
  tap(g); until(g, 'WARNING');
  g.update(100);
  const before = g.snapshot();
  g.down(650, 850); g.cancel();
  g.update(5000);
  assert.equal(g.status, 'paused');
  assert.equal(g.elapsed, before.elapsed);
  g.resume(); g.update(400);
  assert.equal(g.elapsed, before.elapsed);
  assert.equal(g.phaseTime, before.phaseTime);
  assert.equal(g.score, before.score);
  g.update(10);
  assert.ok(g.elapsed > before.elapsed);
});

test('timed games close input at exactly their limit and do not await animation', () => {
  for (const mode of [1, 2, 4]) {
    const g = new GameEngine(mode);
    tap(g, mode === 2 ? 470 : 650, mode === 2 ? 1050 : 850);
    g.update(50000);
    assert.equal(g.status, 'result');
    assert.equal(g.elapsed, mode === 4 ? 15 : 30);
    assert.equal(g.remaining, 0);
    const score = g.score;
    assert.equal(g.down(650, 850), false);
    g.up(); g.update(1000);
    assert.equal(g.score, score);
  }
});

test('02 moving before takeoff locks EARLY, even when retried airborne', () => {
  const g = new GameEngine(2);
  tap(g, 470, 1050);
  g.down(470, 1050, 1, 0.5); g.move(730, 1050);
  assert.equal(g.encounterOutcome, 'EARLY');
  g.up(); until(g, 'JUMP');
  g.down(g.boxX, 1050, 1, 0.5); g.move(250, 1050); g.up();
  assert.equal(g.score, 0);
  assert.equal(g.encounterOutcome, 'EARLY');
});

test('02 placing finger early is allowed, then correct airborne swipe commits once immediately', () => {
  const g = new GameEngine(2);
  tap(g, 470, 1050);
  g.down(470, 1050, 1, 0.5);
  until(g, 'JUMP');
  g.update(50); g.move(730, 1050);
  assert.equal(g.phase, 'JUMP');
  assert.equal(g.encounterOutcome, 'SUCCESS');
  assert.equal(g.score, 1);
  assert.equal(g.boxX, 0.75 * W);
  g.move(200, 1050); g.up();
  assert.equal(g.score, 1);
  g.update(700);
  assert.equal(g.score, 1);
});

test('02 late distance cannot be turned into success and cancel preserves unresolved encounter', () => {
  const g = new GameEngine(2);
  tap(g, 470, 1050); until(g, 'JUMP');
  g.down(470, 1050); g.update(530); g.move(730, 1050); g.up();
  assert.equal(g.encounterOutcome, 'MISS');
  assert.equal(g.score, 0);
  const h = new GameEngine(2);
  tap(h, 470, 1050); until(h, 'JUMP');
  h.down(470, 1050); h.move(500, 1050);
  const elapsed = h.elapsed;
  const phaseTime = h.phaseTime;
  const boxX = h.boxX;
  h.cancel(); h.resume();
  assert.equal(h.phase, 'JUMP');
  assert.equal(h.phaseTime, phaseTime);
  assert.equal(h.boxX, boxX);
  assert.equal(h.elapsed, elapsed);
  assert.equal(h.score, 0);
});

test('03 only successful release records; tiny taps/cancel/punch never change best', () => {
  const g = new GameEngine(3, { best: 4.2 });
  tap(g, 470, 850, 100);
  assert.equal(g.status, 'ready');
  assert.equal(g.best, 4.2);
  g.down(470, 850); g.update(2800);
  assert.equal(g.best, 4.2);
  g.cancel();
  assert.equal(g.status, 'ready');
  assert.equal(g.hold, 0);
  assert.equal(g.best, 4.2);
  g.down(470, 850); g.update(1000); g.up();
  assert.equal(g.phase, 'SUCCESS');
  assert.equal(g.score, 1);
  assert.equal(g.best, 4.2);
  g.reset(); g.down(470, 850); g.update(6000);
  assert.equal(g.phase, 'PUNCH');
  assert.equal(g.best, 4.2);
  g.up();
  assert.equal(g.success, false);
});

test('03 punch deadline is drawn once and warning is exactly the final 650ms', () => {
  const g = new GameEngine(3, { seed: 10 });
  g.down(470, 850);
  const deadline = g.punchAt;
  assert.ok(deadline >= 3.2 && deadline <= 5.2);
  g.update((deadline - 0.651) * 1000);
  assert.equal(g.phase, 'HOLDING');
  g.move(600, 850); g.update(2);
  assert.equal(g.phase, 'WARNING');
  assert.equal(g.punchAt, deadline);
  g.update(650);
  assert.equal(g.phase, 'PUNCH');
});

test('04 first release commits once; wearing/removing taps are neither points nor queued', () => {
  const g = new GameEngine(4);
  tap(g);
  assert.equal(g.score, 1);
  assert.equal(g.phase, 'PUTTING_ON');
  g.update(80);
  assert.equal(g.phase, 'WEARING');
  g.update(160); tap(g);
  assert.equal(g.score, 1);
  until(g, 'REMOVING');
  g.update(20); tap(g);
  assert.equal(g.score, 1);
  until(g, 'BARE');
  g.update(200);
  assert.equal(g.score, 1);
  tap(g);
  assert.equal(g.score, 2);
});

test('05 local deformation is bounded, side stays fixed, spring settles, and new drag interrupts smoothly', () => {
  const g = new GameEngine(5);
  assert.equal(g.down(400, 300), false);
  g.down(650, 900); g.move(-5000, 900);
  assert.equal(g.cheekSide, 'right');
  assert.ok(Math.abs(g.cheekX) <= 0.16 * W);
  g.up(); g.update(100);
  const x = g.cheekX;
  g.down(650, 900);
  assert.equal(g.cheekX, x);
  g.move(650.001, 900);
  assert.ok(Math.abs(g.cheekX - x) < 0.002, 'interrupting spring must not jump when dragging resumes');
  g.up(); g.update(450);
  assert.equal(g.phase, 'IDLE');
  assert.equal(g.cheekX, 0);
  assert.equal(g.cheekY, 0);
  assert.equal(g.elapsed, 0);
  assert.equal(g.score, 0);
  g.down(150, 900); g.move(80, 950); g.cancel(); g.update(500);
  assert.equal(g.cheekX, 0);
});

test('06 first ring press starts immediately, does not warp, and movement respects speed cap', () => {
  const g = new GameEngine(6);
  const x = g.toyX, y = g.toyY;
  assert.equal(g.down(x + 30, y), true);
  assert.equal(g.status, 'playing');
  assert.equal(g.toyX, x);
  g.move(200, 1000); g.update(10);
  assert.ok(Math.hypot(g.toyX - x, g.toyY - y) <= 2.5 * W * 0.01 + 1e-6);
  g.up();
  const stopped = [g.toyX, g.toyY];
  const elapsed = g.elapsed;
  g.update(10);
  assert.deepEqual([g.toyX, g.toyY], stopped);
  assert.ok(g.elapsed > elapsed);
});

test('06 cancellation freezes pose; resume waits for a fresh ring press', () => {
  const g = new GameEngine(6);
  g.down(g.toyX, g.toyY); g.update(10); g.cancel();
  const before = g.snapshot();
  g.update(5000);
  assert.equal(g.status, 'paused');
  assert.equal(g.elapsed, before.elapsed);
  g.resume(); g.update(5000);
  assert.equal(g.status, 'ready');
  assert.equal(g.elapsed, before.elapsed);
  assert.equal(g.catX, before.catX);
  assert.equal(g.toyX, before.toyX);
  g.down(g.toyX, g.toyY); g.update(10);
  assert.ok(g.elapsed > before.elapsed);
});

test('06 catches a stationary feather at every control boundary, not the ring or rod', () => {
  for (const sx of ['left', 'right'] as const) for (const sy of ['top', 'bottom'] as const) {
    const g = new GameEngine(6);
    g.toyX = g.toyBounds[sx]; g.toyY = g.toyBounds[sy];
    g.down(g.toyX, g.toyY); g.up(); g.update(14000);
    assert.equal(g.status, 'result');
    assert.equal(g.phase, 'CAPTURED');
    assert.equal(g.success, false);
    assert.ok(g.elapsed < 8);
  }
  const g = new GameEngine(6);
  // A paw at the ring starts 155px from feather; it must not instantly capture.
  g.catX = g.toyX; g.catY = g.toyY;
  g.down(g.toyX, g.toyY); g.update(10);
  assert.equal(g.status, 'playing');
});

test('reference fixtures use production fields and seeded runs are deterministic', () => {
  for (const mode of [1, 2, 3, 4, 5, 6]) {
    const a = new GameEngine(mode, { seed: 7 });
    const b = new GameEngine(mode, { seed: 7 });
    assert.deepEqual(a.snapshot(), b.snapshot());
    a.fixture();
    assert.equal(a.status, 'playing');
    if (mode === 3) { assert.equal(a.hold, 2.8); assert.equal(a.best, 4.2); }
    if (mode === 5) assert.equal(a.cheekX, 0.16 * W);
  }
});
