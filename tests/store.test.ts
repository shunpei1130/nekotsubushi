import test from 'node:test';
import assert from 'node:assert/strict';
import { bestResult, collectCheek, loadSave, persist, previousResult, recordRun, save, SAVE_KEY, unlockReaction, type StorageLike } from '../src/store.ts';
import { courseKey, dailyForDate, normalContext, type ModeId, type RunResult } from '../src/progression.ts';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const result = (mode: ModeId, values: Partial<RunResult> = {}): RunResult => ({ mode, rulesVersion: 2, success: true, count: 0, maxStreak: 0, specialCount: 0, perfectCount: 0, maxPerfectStreak: 0, remainingMs: mode === 3 ? 200 : null, survivalMs: 0, nearMissMs: 0, ...values });
function reset(source = new MemoryStorage()) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: source });
  Object.assign(save, loadSave(source, false));
  return source;
}

test('v1 migration preserves settings and old records, keeping old punch duration distinct and untouched', () => {
  const source = new MemoryStorage();
  const original = JSON.stringify({ schemaVersion: 1, sound: false, reduced: true, records: { 1: 42, 2: 8, 3: 4200, 4: 10, 6: 15000 }, clears: 7, seen: [1, 3, 6] });
  source.setItem('nekotsubushi:v1', original);
  reset(source);
  assert.equal(save.schemaVersion, 2);
  assert.equal(save.sound, false);
  assert.equal(save.reduced, true);
  assert.equal(save.records['1'], 42);
  assert.equal(save.records['3'], undefined);
  assert.equal(save.legacyRecords['3'], 4200);
  assert.equal(bestResult(normalContext(3, 1)), null);
  assert.equal(bestResult(normalContext(1, 1))?.count, 42);
  assert.equal(bestResult(normalContext(6, 1))?.survivalMs, 15000);
  persist();
  assert.equal(source.getItem('nekotsubushi:v1'), original);
  assert.equal(JSON.parse(source.getItem(SAVE_KEY)!).schemaVersion, 2);
});

test('corrupt/unsupported v2 falls back to intact v1 and malformed saves remain playable', () => {
  const source = new MemoryStorage();
  source.setItem(SAVE_KEY, '{broken');
  source.setItem('nekotsubushi:v1', JSON.stringify({ schemaVersion: 1, records: { 1: 12 } }));
  assert.equal(loadSave(source).records['1'], 12);
  source.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 999 }));
  assert.equal(loadSave(source).records['1'], 12);
  source.setItem('nekotsubushi:v1', '{broken');
  assert.deepEqual(loadSave(source).records, {});
  const denied: StorageLike = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  assert.equal(loadSave(denied, true).reduced, true);
  reset(denied as MemoryStorage);
  assert.doesNotThrow(() => recordRun(normalContext(1, 2), result(1, { count: 1, maxStreak: 1 })));
});

test('last run, previous best and new best are captured before updating; ties do not update', () => {
  reset();
  const context = normalContext(1, 10);
  const first = recordRun(context, result(1, { count: 5, maxStreak: 3 }));
  assert.equal(first.previousBest, null);
  assert.equal(first.previous, null);
  assert.equal(first.newBest, true);
  assert.deepEqual(first.unlocked, []);
  const improved = recordRun(normalContext(1, 20), result(1, { count: 5, maxStreak: 4 }));
  assert.equal(improved.previousBest?.maxStreak, 3);
  assert.equal(improved.previous?.maxStreak, 3);
  assert.equal(improved.newBest, true);
  assert.deepEqual(improved.unlocked, ['personal-best']);
  assert.equal(recordRun(context, result(1, { count: 5, maxStreak: 4 })).newBest, false);
  assert.equal(bestResult(context)?.maxStreak, 4);
  assert.equal(previousResult(context)?.maxStreak, 4);
  const copy = bestResult(context)!;
  copy.count = 999;
  assert.equal(bestResult(context)?.count, 5);
});

test('punch failure is a previous attempt, never a best, and success compares smaller margins', () => {
  reset();
  const context = normalContext(3, 10);
  assert.equal(recordRun(context, result(3, { success: false, remainingMs: null })).newBest, false);
  assert.equal(bestResult(context), null);
  assert.equal(previousResult(context)?.success, false);
  const first = recordRun(context, result(3, { remainingMs: 180 }));
  assert.equal(first.newBest, true);
  assert.deepEqual(first.unlocked, []);
  const closer = recordRun(context, result(3, { remainingMs: 80 }));
  assert.equal(closer.previousBest?.remainingMs, 180);
  assert.deepEqual(closer.unlocked, ['close-3', 'personal-best']);
  recordRun(context, result(3, { success: false, remainingMs: null }));
  assert.equal(bestResult(context)?.remainingMs, 80);
  assert.equal(save.records['3'], undefined);
});

test('daily and friend challenge share only identical courses; normal and other seeds stay separate', () => {
  reset();
  const daily = dailyForDate('2026-01-01');
  recordRun(daily, result(1, { count: 8, maxStreak: 4 }));
  assert.equal(bestResult({ ...daily, kind: 'challenge' })?.count, 8);
  assert.equal(bestResult({ ...daily, kind: 'challenge', seed: daily.seed + 1 }), null);
  assert.equal(bestResult(normalContext(1, daily.seed)), null);
  assert.equal(save.records['1'], undefined);
});

test('reaction unlocks are one-time, have exact thresholds, and survive persistence', () => {
  const source = reset();
  assert.deepEqual(collectCheek('right'), ['cheek-right']);
  assert.deepEqual(collectCheek('right'), []);
  assert.deepEqual(collectCheek('<script>'), []);
  assert.deepEqual(unlockReaction('unknown'), []);
  const a = recordRun(normalContext(1, 1), result(1, { count: 10, maxStreak: 10 }));
  assert.deepEqual(a.unlocked, ['streak-1']);
  assert.deepEqual(recordRun(normalContext(2, 1), result(2, { count: 3, maxStreak: 3 })).unlocked, ['streak-2']);
  assert.deepEqual(recordRun(normalContext(4, 1), result(4, { count: 4, perfectCount: 3, maxPerfectStreak: 3 })).unlocked, ['rhythm-4']);
  assert.deepEqual(recordRun(normalContext(6, 1), result(6, { survivalMs: 15000, nearMissMs: 200 })).unlocked, ['clear-6']);
  assert.equal(save.clears, 1);
  const loaded = loadSave(source);
  assert.deepEqual(loaded.unlocked, save.unlocked);
  assert.equal(loaded.runs[courseKey(normalContext(6, 1))].best?.nearMissMs, 200);
});

test('course history keeps the latest ninety while preserving all normal-mode bests', () => {
  reset();
  const context = normalContext(1, 1);
  recordRun(context, result(1, { count: 4, maxStreak: 4 }));
  for (let seed = 0; seed < 95; seed++) recordRun({ ...context, kind: 'challenge', seed }, result(1, { count: 1, maxStreak: 1 }));
  assert.equal(Object.keys(save.runs).filter(key => key.includes(':course:')).length, 90);
  assert.equal(bestResult(context)?.count, 4);
  assert.equal(bestResult({ ...context, kind: 'challenge', seed: 0 }), null);
  assert.equal(bestResult({ ...context, kind: 'challenge', seed: 94 })?.count, 1);
});

test('v2 loading drops invalid records, unknown unlocks and forged keys', () => {
  const source = new MemoryStorage();
  source.setItem(SAVE_KEY, JSON.stringify({ schemaVersion: 2, records: { 1: -1, 3: 4100, 6: Infinity }, seen: [1, 1, 8, '3'], unlocked: ['cheek-right', 'cheek-right', 'unknown'], runs: {
    'v2:normal:1': { best: result(1, { count: 2, maxStreak: 3 }), last: result(1), updatedAt: 1 },
    'v2:normal:2': { best: result(1), last: result(1), updatedAt: 1 },
    'v2:normal:3': { best: null, last: result(3, { success: false, remainingMs: null }), updatedAt: 1 },
  } }));
  const loaded = loadSave(source);
  assert.deepEqual(loaded.seen, [1]);
  assert.deepEqual(loaded.unlocked, ['cheek-right']);
  assert.deepEqual(Object.keys(loaded.runs), ['v2:normal:3']);
  assert.equal(loaded.legacyRecords['3'], 4100);
});

test('real completed engines produce valid persistable results in every competitive mode', async () => {
  reset();
  const { GameEngine } = await import('../src/engine.ts');
  const { resultFromEngine, isRunResult } = await import('../src/progression.ts');
  for (const mode of [1, 2, 3, 4, 6] as const) {
    const game = new GameEngine(mode, { seed: 123 });
    const x = mode === 2 ? 470 : mode === 6 ? game.toyX : 650;
    const y = mode === 2 ? 1050 : mode === 6 ? game.toyY : 850;
    game.down(x, y);
    if (mode === 3) game.update((game.punchAt - .08) * 1000);
    game.up();
    if (mode !== 3) game.update(31000);
    assert.equal(game.status, 'result');
    const converted = resultFromEngine(game.snapshot());
    assert.ok(isRunResult(converted), `mode ${mode} result validates`);
    assert.doesNotThrow(() => recordRun(normalContext(mode, 123), converted));
  }
  assert.equal(bestResult(normalContext(3, 123))?.remainingMs, 80);
});
