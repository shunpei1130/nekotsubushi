import test from 'node:test';
import assert from 'node:assert/strict';
import { CHEEK_GESTURES, STAGE_GOALS, evaluateStage, journeyStatus as statusForJourney, loadJourney, stageGoal, stageProof } from '../src/journey.ts';
import { completeStage, currentStage, isStageUnlocked, journeyStatus, loadSave, persist, recordRun, save, SAVE_KEY, type StorageLike } from '../src/store.ts';
import { normalContext, type ModeId, type RunResult } from '../src/progression.ts';

class MemoryStorage implements StorageLike {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const result = (mode: ModeId, values: Partial<RunResult> = {}): RunResult => ({ mode, rulesVersion: 2, success: true, count: 0, maxStreak: 0, specialCount: 0, perfectCount: 0, maxPerfectStreak: 0, remainingMs: mode === 3 ? STAGE_GOALS[3].remainingMs : null, survivalMs: 0, nearMissMs: 0, ...values });
const passing = (mode: ModeId): RunResult => mode === 1 ? result(mode, { count: STAGE_GOALS[1].count, maxStreak: STAGE_GOALS[1].maxStreak })
  : mode === 2 ? result(mode, { count: STAGE_GOALS[2].count, perfectCount: STAGE_GOALS[2].perfectCount })
  : mode === 4 ? result(mode, { count: STAGE_GOALS[4].count, perfectCount: STAGE_GOALS[4].perfectCount })
  : mode === 6 ? result(mode, { survivalMs: STAGE_GOALS[6].survivalMs, nearMissMs: STAGE_GOALS[6].nearMissMs }) : result(mode);
const stored = (best: RunResult, last: RunResult = best) => ({ best, last, updatedAt: 100 });
const oldSave = (runs: Record<string, unknown> = {}, extras: Record<string, unknown> = {}) => ({ schemaVersion: 2, sound: false, reduced: true, records: { '1': 62, '3': 4200 }, legacyRecords: { '3': 4100 }, clears: 9, seen: [1, 2, 3, 4, 5, 6], unlocked: ['cheek-right'], runs, ...extras });
function reset(source = new MemoryStorage()) {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: source });
  Object.assign(save, loadSave(source, false));
  return source;
}
function load(raw: unknown) {
  const source = new MemoryStorage(); source.setItem(SAVE_KEY, JSON.stringify(raw));
  return { source, loaded: loadSave(source, false) };
}
function pass(mode: ModeId) { return completeStage(mode, mode === 5 ? { gestures: CHEEK_GESTURES } : { result: passing(mode) }); }

test('new players have exactly one unlocked mode; seen/clears and old numeric highs do not imply stage skills', () => {
  reset(); assert.deepEqual(journeyStatus(), { cleared: [], unlocked: [1], current: 1, allClear: false });
  assert.equal(currentStage(), 1);
  assert.equal(isStageUnlocked(1), true); assert.equal(isStageUnlocked(2), false); assert.equal(isStageUnlocked(99), false);
  const { loaded } = load(oldSave());
  assert.deepEqual(journeyStatus(loaded).unlocked, [1]);
  assert.equal(loaded.records['1'], 62); assert.equal(loaded.legacyRecords['3'], 4100);
  assert.equal(loaded.clears, 9); assert.deepEqual(loaded.seen, [1, 2, 3, 4, 5, 6]);
});

test('all six descriptions explain the clear condition and count thresholds have exact boundaries', () => {
  for (const mode of [1, 2, 4] as const) {
    const good = passing(mode);
    assert.equal(evaluateStage(mode, { result: good }).passed, true);
    assert.equal(evaluateStage(mode, { result: { ...good, count: good.count - 1 } }).passed, false);
    const key = mode === 1 ? 'maxStreak' : 'perfectCount';
    if (good[key] > 0) {
      const failed = evaluateStage(mode, { result: { ...good, [key]: good[key] - 1 } });
      assert.equal(failed.passed, false); assert.match(failed.remaining, /あと1回/);
    }
    assert.equal(evaluateStage(mode, { result: { ...good, success: false } }).passed, false);
    assert.match(evaluateStage(mode, { result: { ...good, success: false } }).remaining, /最後まで/);
  }
  for (const mode of [1, 2, 3, 4, 5, 6] as const) assert.ok(stageGoal(mode).length > 9);
});

test('punch requires success and a positive margin within the exact maximum; feedback states the gap', () => {
  const good = passing(3);
  assert.equal(evaluateStage(3, { result: good }).passed, true);
  assert.equal(evaluateStage(3, { result: { ...good, remainingMs: 1 } }).passed, true);
  assert.equal(evaluateStage(3, { result: { ...good, remainingMs: 122 } }).passed, true, 'measured 122ms attempt fits the device-latency allowance');
  const early = evaluateStage(3, { result: { ...good, remainingMs: STAGE_GOALS[3].remainingMs + 1 } });
  assert.equal(early.passed, false); assert.match(early.remaining, /あと1ms/);
  assert.equal(evaluateStage(3, { result: { ...good, remainingMs: 0 } }).passed, false);
  assert.equal(evaluateStage(3, { result: { ...good, success: false, remainingMs: null } }).passed, false);
  assert.match(evaluateStage(3, { result: { ...good, success: false, remainingMs: null } }).remaining, /受ける前/);
});

test('cheek stage needs all six distinct valid gestures, with no time limit or points', () => {
  assert.equal(evaluateStage(5, { gestures: CHEEK_GESTURES }).passed, true);
  const five = evaluateStage(5, { gestures: CHEEK_GESTURES.slice(0, 5) });
  assert.equal(five.passed, false); assert.match(five.remaining, /あと1種類/);
  assert.equal(evaluateStage(5, { gestures: [...CHEEK_GESTURES.slice(0, 5), 'right'] }).passed, false);
  assert.equal(evaluateStage(5, { gestures: ['unknown', ...CHEEK_GESTURES.slice(0, 5)] as any }).passed, false);
  assert.equal(evaluateStage(5, { result: passing(5) }).passed, false);
});

test('final mode requires a complete successful escape without forcing additional risk', () => {
  const good = passing(6);
  assert.equal(evaluateStage(6, { result: good }).passed, true);
  assert.equal(evaluateStage(6, { result: { ...good, survivalMs: 14999 } }).passed, false);
  if (STAGE_GOALS[6].nearMissMs > 0) {
    const tooSafe = evaluateStage(6, { result: { ...good, nearMissMs: STAGE_GOALS[6].nearMissMs - 1 } });
    assert.equal(tooSafe.passed, false); assert.match(tooSafe.remaining, /0.001秒/);
  } else assert.equal(evaluateStage(6, { result: { ...good, nearMissMs: 0 } }).passed, true);
  assert.equal(evaluateStage(6, { result: { ...good, success: false } }).passed, false);
});

test('invalid result mode, rules, impossible metrics and uncompleted result do not clear', () => {
  assert.equal(evaluateStage(1, { result: passing(2) }).passed, false);
  assert.equal(evaluateStage(1, { result: { ...passing(1), rulesVersion: 999 } as any }).passed, false);
  assert.equal(evaluateStage(1, { result: { ...passing(1), maxStreak: 10001 } }).passed, false);
  assert.equal(evaluateStage(1, { result: { ...passing(1), count: Infinity } }).passed, false);
  assert.equal(evaluateStage(1, {}).passed, false);
});

test('each current clear unlocks only the next stage, repeated events are idempotent and all clear is explicit', () => {
  const source = reset();
  for (const mode of [1, 2, 3, 4, 5, 6] as const) {
    const completion = pass(mode);
    assert.equal(completion.passed, true);
    assert.deepEqual(completion.newlyCleared, [mode]);
    assert.deepEqual(completion.newlyUnlocked, mode === 6 ? [] : [mode + 1]);
    assert.deepEqual(pass(mode).newlyCleared, []);
    assert.deepEqual(pass(mode).newlyUnlocked, []);
    assert.deepEqual(journeyStatus(loadSave(source)), journeyStatus());
  }
  assert.deepEqual(journeyStatus(), { cleared: [1, 2, 3, 4, 5, 6], unlocked: [1, 2, 3, 4, 5, 6], current: null, allClear: true });
});

test('failed current stages and successful locked modes cannot advance; failure does not relock a clear', () => {
  reset();
  assert.equal(completeStage(1, { result: result(1, { count: 1, maxStreak: 1 }) }).passed, false);
  for (const mode of [2, 3, 4, 5, 6] as const) {
    assert.equal(pass(mode).passed, false); assert.deepEqual(journeyStatus().unlocked, [1]);
  }
  pass(1);
  completeStage(1, { result: result(1) });
  assert.deepEqual(journeyStatus().unlocked, [1, 2]);
  assert.equal(completeStage(2, { result: passing(1) }).passed, false);
});

test('v2 migration uses same-run detailed proof and stops at the first unproven stage', () => {
  const raw = oldSave({
    'v2:normal:1': stored(passing(1)),
    'v2:normal:2': stored(result(2, { count: STAGE_GOALS[2].count, perfectCount: 0 }), result(2, { count: STAGE_GOALS[2].perfectCount, perfectCount: STAGE_GOALS[2].perfectCount })),
    'v2:normal:3': stored(passing(3)),
  });
  const before = JSON.stringify(raw);
  const { source, loaded } = load(raw);
  assert.deepEqual(journeyStatus(loaded).cleared, [1]);
  assert.deepEqual(journeyStatus(loaded).unlocked, [1, 2]);
  assert.equal(JSON.stringify(raw), before); assert.equal(source.getItem(SAVE_KEY), before);
  assert.deepEqual(loaded.unlocked, ['cheek-right']);
  assert.equal(Object.keys(loaded.runs).length, 3);
});

test('old last result qualifies even when lexicographic best lacks a required timing/streak metric', () => {
  const { loaded } = load(oldSave({
    'v2:normal:1': stored(result(1, { count: STAGE_GOALS[1].count + 10, maxStreak: 1 }), passing(1)),
    'v2:normal:2': stored(passing(2)),
  }));
  assert.deepEqual(journeyStatus(loaded).cleared, [1, 2]);
});

test('daily and challenge same-course recorded performances can migrate; challenge target alone is not a record', () => {
  const { loaded } = load(oldSave({ 'v2:course:1:987:free': stored(passing(1)) }));
  assert.deepEqual(journeyStatus(loaded).cleared, [1]);
  reset();
  const challenge = { ...normalContext(1, 987), kind: 'challenge' as const, target: passing(6) };
  recordRun(challenge, passing(1));
  assert.deepEqual(journeyStatus().cleared, []);
  assert.deepEqual(completeStage(1, { result: passing(1) }).newlyCleared, [1]);
});

test('later historical proof is retained and migrates only after preceding clears, with a new same-session cheek proof', () => {
  const { source } = load(oldSave({
    'v2:normal:2': stored(passing(2)),
    'v2:normal:3': stored(passing(3)),
    'v2:normal:4': stored(passing(4)),
    'v2:normal:6': stored(passing(6)),
  }, { unlocked: CHEEK_GESTURES.map(gesture => `cheek-${gesture}`) }));
  reset(source);
  assert.deepEqual(journeyStatus().cleared, []);
  const completion = pass(1);
  assert.deepEqual(completion.newlyCleared, [1, 2, 3, 4]);
  assert.deepEqual(completion.newlyUnlocked, [2, 3, 4, 5]);
  assert.equal(completion.allClear, false);
  assert.deepEqual(pass(5).newlyCleared, [5, 6]);
  assert.equal(journeyStatus().allClear, true);
  assert.equal(save.runs['v2:normal:2'].best?.count, STAGE_GOALS[2].count);
  assert.equal(save.unlocked.length, 6);
});

test('old cheek discoveries alone cannot skip stages; five old discoveries do not imply the sixth', () => {
  const { loaded } = load(oldSave({}, { unlocked: CHEEK_GESTURES.map(gesture => `cheek-${gesture}`) }));
  assert.deepEqual(journeyStatus(loaded).unlocked, [1]);
  const prefix = Object.fromEntries(([1, 2, 3, 4] as const).map(mode => [`v2:normal:${mode}`, stored(passing(mode))]));
  const partial = load(oldSave(prefix, { unlocked: CHEEK_GESTURES.slice(0, 5).map(gesture => `cheek-${gesture}`) })).loaded;
  assert.deepEqual(journeyStatus(partial).cleared, [1, 2, 3, 4]);
  assert.deepEqual(journeyStatus(partial).unlocked, [1, 2, 3, 4, 5]);
});

test('saved proof is revalidated and preserved after record pruning or newer failed runs', () => {
  const source = reset(); pass(1);
  recordRun(normalContext(1, 987), result(1));
  delete save.runs['v2:normal:1']; persist();
  const loaded = loadSave(source);
  assert.deepEqual(journeyStatus(loaded).cleared, [1]);
  assert.equal(loaded.journey.proofs[1]?.kind, 'run');
  if (loaded.journey.proofs[1]?.kind === 'run') assert.equal(loaded.journey.proofs[1].result.count, STAGE_GOALS[1].count);
});

test('malformed journey flags, orphan proofs, unsupported versions and invalid proof data never bypass the prefix', () => {
  for (const raw of [{ version: 1, cleared: [1, 2, 3, 4, 5, 6] }, { version: 9, proofs: { 1: stageProof(1, { result: passing(1) }) } }, { version: 1, proofs: { 2: stageProof(2, { result: passing(2) }) } }, { version: 1, proofs: { 1: { kind: 'run', result: passing(3) } } }, null, []]) {
    assert.deepEqual(statusForJourney(loadJourney(raw)).unlocked, [1]);
  }
  const valid = loadJourney({ version: 1, proofs: { 1: stageProof(1, { result: passing(1) }), 3: stageProof(3, { result: passing(3) }) } });
  assert.deepEqual(statusForJourney(valid).cleared, [1]); assert.equal(valid.proofs[3], undefined);
});

test('corrupt and denied storage retain playable first stage and permit in-memory advancement', () => {
  const source = new MemoryStorage(); source.setItem(SAVE_KEY, '{bad'); reset(source);
  assert.deepEqual(journeyStatus().unlocked, [1]);
  const denied: StorageLike = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); } };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: denied });
  Object.assign(save, loadSave(denied, false));
  assert.doesNotThrow(() => pass(1)); assert.deepEqual(journeyStatus().unlocked, [1, 2]);
});

test('v1 key is untouched by stage saves and legacy punch duration never migrates into a clear', () => {
  const source = new MemoryStorage();
  const original = JSON.stringify({ schemaVersion: 1, records: { 1: 100, 2: 20, 3: 5200, 4: 30, 6: 15000 }, clears: 100 });
  source.setItem('nekotsubushi:v1', original); reset(source);
  assert.deepEqual(journeyStatus().cleared, []); pass(1);
  assert.equal(source.getItem('nekotsubushi:v1'), original);
  assert.equal(save.legacyRecords['3'], 5200);
  assert.deepEqual(journeyStatus().cleared, [1]);
});


test('old and new cheek collection totals never prove six gestures in one session; explicit session proof survives reload', () => {
  const source = reset();
  for (const mode of [1, 2, 3, 4] as const) pass(mode);
  save.unlocked.push(...CHEEK_GESTURES.slice(0, 3).map(gesture => `cheek-${gesture}`)); persist();
  Object.assign(save, loadSave(source, false));
  save.unlocked.push(...CHEEK_GESTURES.slice(3).map(gesture => `cheek-${gesture}`)); persist();
  Object.assign(save, loadSave(source, false));
  assert.deepEqual(journeyStatus().cleared, [1, 2, 3, 4]);
  assert.equal(completeStage(5, { gestures: CHEEK_GESTURES.slice(3) }).passed, false);
  assert.equal(completeStage(5, { gestures: CHEEK_GESTURES }).passed, true);
  assert.deepEqual(journeyStatus(loadSave(source)).cleared, [1, 2, 3, 4, 5]);
  const historical = load(oldSave({}, { unlocked: CHEEK_GESTURES.map(gesture => `cheek-${gesture}`), journey: {version:1,proofs:{},legacyCheeks:true} }));
  Object.assign(save, historical.loaded);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: historical.source });
  persist(); Object.assign(save, loadSave(historical.source, false));
  for (const mode of [1, 2, 3] as const) pass(mode);
  assert.deepEqual(pass(4).newlyCleared, [4]);
  assert.deepEqual(journeyStatus().unlocked, [1, 2, 3, 4, 5]);
  assert.deepEqual(save.unlocked, CHEEK_GESTURES.map(gesture => `cheek-${gesture}`));
});
