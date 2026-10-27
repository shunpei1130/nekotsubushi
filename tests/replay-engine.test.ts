import test from 'node:test';
import assert from 'node:assert/strict';
import { GameEngine, W, type CheekGesture } from '../src/engine.ts';

function tap(g: GameEngine, x = 650, y = 850, ms = 0) {
  assert.equal(g.down(x, y), true);
  g.update(ms);
  g.up(x, y);
}

function until(g: GameEngine, phase: string) {
  for (let i = 0; i < 2000 && g.phase !== phase && g.status !== 'result'; i++) {
    const remaining = (g.phaseDuration - g.phaseTime) * 1000;
    g.update(Number.isFinite(remaining) ? Math.max(0.000001, Math.min(40, remaining + 0.000001)) : 1);
  }
  assert.equal(g.phase, phase);
}

function at(g: GameEngine, phase: string, milliseconds: number) {
  until(g, phase);
  g.update(Math.max(0, milliseconds - g.phaseTime * 1000));
}

function boxSuccess(g: GameEngine, milliseconds: number) {
  at(g, 'JUMP', milliseconds);
  assert.equal(g.down(g.boxX, 1050), true);
  g.move(735, 1050);
  g.up();
  assert.equal(g.encounterOutcome, 'SUCCESS');
}

test('poke streak counts valid releases, emits one milestone, and caught breaks only current streak', () => {
  const g = new GameEngine(1);
  for (let i = 0; i < 10; i++) {
    if (i) g.update(151);
    tap(g);
  }
  assert.equal(g.metrics.maxStreak, 10);
  assert.equal(g.metrics.streak, 10);
  assert.equal(g.events.filter(e => e.type === 'milestone' && e.tag === 'poke-streak').length, 1);
  until(g, 'OPEN');
  tap(g);
  assert.equal(g.metrics.streak, 0);
  assert.equal(g.metrics.maxStreak, 10);
  assert.equal(g.score, 10);
  assert.ok(g.events.every((event, index, events) => index === 0 || event.id > events[index - 1].id));
});

test('poke close timing begins at last 200ms and includes accepted grace releases', () => {
  for (const [when, expected] of [[299, 0], [300, 1], [499, 1]] as const) {
    const g = new GameEngine(1);
    tap(g);
    at(g, 'WARNING', when);
    tap(g);
    assert.equal(g.metrics.specialCount, expected, `warning ${when}ms`);
  }
  const g = new GameEngine(1);
  tap(g);
  at(g, 'WARNING', 490);
  g.down(650, 850);
  g.update(20);
  assert.equal(g.phase, 'OPEN_GRACE');
  g.up();
  assert.equal(g.metrics.specialCount, 1);
});

test('box grades the successful displacement boundary and misses never become success', () => {
  for (const [when, grade] of [[299, 'early'], [300, 'perfect'], [439, 'perfect'], [440, 'close'], [520, 'close']] as const) {
    const g = new GameEngine(2);
    tap(g, 470, 1050);
    boxSuccess(g, when);
    assert.equal(g.events.find(e => e.type === 'success')?.tag, grade, `jump ${when}ms`);
    assert.equal(g.metrics.perfectCount, grade === 'perfect' ? 1 : 0);
    assert.equal(g.metrics.specialCount, grade === 'close' ? 1 : 0);
  }
  const late = new GameEngine(2);
  tap(late, 470, 1050);
  at(late, 'JUMP', 521);
  late.down(late.boxX, 1050);
  late.move(735, 1050);
  late.up();
  assert.equal(late.encounterOutcome, 'MISS');
  assert.equal(late.metrics.maxStreak, 0);
});

test('box three successes unlock once and early movement breaks streak only once', () => {
  const g = new GameEngine(2);
  tap(g, 470, 1050);
  for (let i = 0; i < 3; i++) {
    if (i) until(g, 'APPROACH');
    boxSuccess(g, 350);
  }
  assert.equal(g.metrics.maxStreak, 3);
  assert.equal(g.metrics.perfectCount, 3);
  assert.equal(g.events.filter(e => e.type === 'milestone' && e.tag === 'box-streak').length, 1);
  until(g, 'APPROACH');
  g.down(g.boxX, 1050);
  g.move(735, 1050);
  g.up();
  assert.equal(g.metrics.streak, 0);
  until(g, 'REACTION');
  assert.equal(g.events.filter(e => e.type === 'timing' && e.tag === 'early').length, 1);
});

test('box pause preserves phase, displacement and next seeded encounter', () => {
  const a = new GameEngine(2, { seed: 71 });
  const b = new GameEngine(2, { seed: 71 });
  for (const g of [a, b]) {
    tap(g, 470, 1050);
    at(g, 'JUMP', 200);
    g.down(g.boxX, 1050);
    g.move(510, 1050);
  }
  const before = a.snapshot();
  a.pause();
  a.update(5000);
  a.resume();
  assert.equal(a.phase, before.phase);
  assert.equal(a.phaseTime, before.phaseTime);
  assert.equal(a.boxX, before.boxX);
  // Releasing both gestures makes the same pending encounter miss.
  a.down(a.boxX, 1050);
  a.up();
  b.up();
  until(a, 'APPROACH');
  until(b, 'APPROACH');
  assert.equal(a.phaseDuration, b.phaseDuration);
  assert.equal(a.metrics.streak, b.metrics.streak);
});

test('punch remaining milliseconds reward later success without reroll on tiny tap or cancel', () => {
  const g = new GameEngine(3, { seed: 93 });
  const deadline = g.punchAt;
  tap(g, 470, 850, 100);
  assert.equal(g.punchAt, deadline);
  assert.equal(g.metrics.remainingMs, null);
  g.down(470, 850);
  g.update(500);
  g.cancel();
  assert.equal(g.punchAt, deadline);
  g.down(470, 850);
  g.update((deadline - 0.08) * 1000);
  g.up();
  assert.equal(g.success, true);
  assert.equal(g.metrics.remainingMs, 80);
  assert.equal(g.events.filter(e => e.type === 'milestone' && e.tag === 'punch-close').length, 1);
  g.reset();
  assert.equal(g.punchAt, deadline);
  assert.equal(g.metrics.remainingMs, null);
  assert.equal(g.events.length, 0);
  g.down(470, 850);
  g.update(deadline * 1000);
  assert.equal(g.phase, 'PUNCH');
  assert.equal(g.metrics.remainingMs, null);
});

test('hat first placement has no rhythm grade, then exact 180ms is perfect and 181ms is late', () => {
  for (const [delay, perfect] of [[180, true], [181, false]] as const) {
    const g = new GameEngine(4);
    tap(g);
    assert.equal(g.metrics.perfectCount, 0);
    at(g, 'BARE', delay);
    tap(g);
    assert.equal(g.metrics.perfectCount, perfect ? 1 : 0);
    assert.equal(g.metrics.perfectStreak, perfect ? 1 : 0);
  }
});

test('hat perfect streak unlocks once and invalid wearing tap resets it without queueing', () => {
  const g = new GameEngine(4);
  tap(g);
  for (let i = 0; i < 3; i++) {
    at(g, 'BARE', 80);
    tap(g);
  }
  assert.equal(g.metrics.perfectCount, 3);
  assert.equal(g.metrics.maxPerfectStreak, 3);
  assert.equal(g.events.filter(e => e.type === 'milestone' && e.tag === 'hat-rhythm').length, 1);
  at(g, 'WEARING', 180);
  tap(g);
  assert.equal(g.metrics.perfectStreak, 0);
  assert.equal(g.score, 4);
  until(g, 'BARE');
  assert.equal(g.score, 4);
});

test('six cheek gestures are resolved from bounded displacement exactly once per release', () => {
  const cases: [number, number, number, number, number, CheekGesture][] = [
    [650, 900, 100, 0, 0, 'right'], [150, 900, -100, 0, 0, 'left'],
    [650, 900, 0, -80, 0, 'up'], [650, 900, 0, 80, 0, 'down'],
    [650, 900, -100, 0, 0, 'inward'], [650, 900, 30, 0, 1000, 'gentle'],
  ];
  for (const [x, y, dx, dy, ms, gesture] of cases) {
    const g = new GameEngine(5);
    g.down(x, y);
    g.move(x + dx, y + dy);
    g.update(ms);
    g.up();
    g.up();
    assert.equal(g.metrics.cheekGesture, gesture);
    assert.equal(g.events.filter(e => e.type === 'cheek').length, 1);
    g.update(450);
    assert.equal(g.cheekX, 0);
    assert.equal(g.cheekY, 0);
    assert.equal(g.score, 0);
  }
  const cancelled = new GameEngine(5);
  cancelled.down(650, 900);
  cancelled.move(750, 900);
  cancelled.cancel();
  assert.equal(cancelled.events.length, 0, 'pointer cancellation is not an intentional discovery');
});

test('feather close time follows swept distance and clips at contact rather than rewarding the whole frame', () => {
  const near = new GameEngine(6);
  near.catX = near.toyX + near.featherOffset.x - 150;
  near.catY = near.toyY + near.featherOffset.y;
  near.down(near.toyX, near.toyY);
  near.update(8);
  assert.equal(near.metrics.nearMissMs, 8);
  assert.equal(near.metrics.survivalMs, 8);
  near.pause();
  near.update(10000);
  assert.equal(near.metrics.nearMissMs, 8);

  const contact = new GameEngine(6);
  contact.catX = contact.toyX + contact.featherOffset.x - (contact.captureDistance + 1);
  contact.catY = contact.toyY + contact.featherOffset.y;
  contact.down(contact.toyX, contact.toyY);
  contact.update(8);
  assert.equal(contact.status, 'result');
  assert.ok(contact.metrics.survivalMs > 0 && contact.metrics.survivalMs < 8);
  assert.ok(contact.metrics.nearMissMs <= contact.metrics.survivalMs);
  const before = contact.metrics.nearMissMs;
  contact.update(10000);
  assert.equal(contact.metrics.nearMissMs, before);
});

test('feather can clear through real movement and equal survival leaves close time as a useful skill measure', () => {
  const play = (speed: number) => {
    const g = new GameEngine(6);
    g.down(g.toyX, g.toyY);
    const top = g.toyY;
    const points = [[g.toyX, top], [90, top], [90, g.toyBounds.bottom], [g.toyBounds.right, g.toyBounds.bottom], [g.toyBounds.right, top], [90, top]];
    let segment = 0, travelled = 0;
    const length = () => Math.hypot(points[segment + 1][0] - points[segment][0], points[segment + 1][1] - points[segment][1]);
    for (let frame = 0; frame < 1000 && g.status === 'playing'; frame++) {
      travelled += speed * 0.016;
      while (travelled > length()) {
        travelled -= length();
        segment++;
        if (segment === points.length - 1) segment = 1;
      }
      const t = travelled / length();
      g.move(points[segment][0] + (points[segment + 1][0] - points[segment][0]) * t, points[segment][1] + (points[segment + 1][1] - points[segment][1]) * t);
      g.update(16);
    }
    assert.equal(g.phase, 'CLEAR');
    assert.equal(g.metrics.survivalMs, 15000);
    assert.equal(g.events.filter(e => e.type === 'milestone' && e.tag === 'escape-clear').length, 1);
    assert.ok(g.metrics.nearMissMs > 0 && g.metrics.nearMissMs < 15000);
    return g.metrics.nearMissMs;
  };
  assert.ok(play(900) > play(1100), 'closer pursuit earns a longer close-time record at the same 15 second clear');
});

test('snapshots own their metric copy and reference fixture/reset cannot leak achievement events', () => {
  const g = new GameEngine(1);
  tap(g);
  const old = g.snapshot();
  g.update(151);
  tap(g);
  assert.equal(old.metrics.streak, 1);
  assert.equal(g.metrics.streak, 2);
  g.fixture();
  assert.equal(g.events.length, 0);
  assert.equal(g.metrics.maxStreak, 0);
  g.reset();
  tap(g);
  assert.equal(g.metrics.streak, 1);
  assert.equal(g.events.length, 1);
  assert.ok(g.toyBounds.right <= W);
});
