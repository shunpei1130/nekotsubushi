import test from 'node:test';
import assert from 'node:assert/strict';
import { COLLECTION, compareResults, courseKey, dailyContext, dailyForDate, encodeChallenge, formatResult, isRunResult, jstDate, normalContext, parseChallenge, resultFromEngine, type RunResult, type ModeId } from '../src/progression.ts';

const result = (mode: ModeId, values: Partial<RunResult> = {}): RunResult => ({ mode, rulesVersion: 2, success: true, count: 0, maxStreak: 0, specialCount: 0, perfectCount: 0, maxPerfectStreak: 0, remainingMs: mode === 3 ? 200 : null, survivalMs: 0, nearMissMs: 0, ...values });

test('daily course changes at exactly Japan midnight, independent of host timezone', () => {
  const before = new Date('2026-10-26T14:59:59.999Z'), after = new Date('2026-10-26T15:00:00.000Z');
  assert.equal(jstDate(before), '2026-10-26');
  assert.equal(jstDate(after), '2026-10-27');
  assert.notEqual(dailyContext(before).seed, dailyContext(after).seed);
  assert.deepEqual(dailyContext(after), dailyForDate('2026-10-27'));
});

test('five competitive modes rotate from the epoch and a past course remains reproducible', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(day => dailyForDate(`2026-01-0${day}`).mode), [1, 2, 3, 4, 6]);
  assert.equal(dailyForDate('2026-01-06').mode, 1);
  assert.notEqual(dailyForDate('2026-01-01').seed, dailyForDate('2026-01-06').seed);
  assert.deepEqual(dailyForDate('2026-01-01'), dailyForDate('2026-01-01'));
  assert.equal(dailyForDate('2025-12-31').mode, 6);
  assert.throws(() => dailyForDate('2026-02-30'));
});

test('normal personal records share a mode key while same-course challenges share date and seed', () => {
  const a = normalContext(3, 1), b = normalContext(3, 2);
  assert.equal(courseKey(a), courseKey(b));
  assert.notEqual(courseKey({ ...a, kind: 'challenge' }), courseKey({ ...b, kind: 'challenge' }));
  const d = dailyForDate('2026-01-03');
  assert.equal(courseKey(d), courseKey({ ...d, kind: 'challenge' }));
  assert.throws(() => normalContext(1, -1));
  assert.throws(() => normalContext(1, 2 ** 32));
});

test('count records use the agreed lexicographic tie breaks rather than a mixed score', () => {
  const a = result(1, { count: 10, maxStreak: 4, specialCount: 1 });
  assert.ok(compareResults(a, result(1, { count: 9, maxStreak: 9, specialCount: 8 })) > 0);
  assert.ok(compareResults({ ...a, maxStreak: 5 }, a) > 0);
  assert.ok(compareResults({ ...a, specialCount: 2 }, a) > 0);
  const box = result(2, { count: 4, maxStreak: 3, perfectCount: 2 });
  assert.ok(compareResults(box, { ...box, perfectCount: 1 }) > 0);
  const hat = result(4, { count: 8, perfectCount: 3, maxPerfectStreak: 2 });
  assert.ok(compareResults(hat, { ...hat, perfectCount: 2, maxPerfectStreak: 2 }) > 0);
  assert.ok(compareResults(hat, { ...hat, maxPerfectStreak: 1 }) > 0);
  assert.equal(compareResults(hat, { ...hat }), 0);
});

test('punch margin is smaller-is-better, failure never beats success, survival wins before risk', () => {
  const close = result(3, { remainingMs: 80 });
  assert.ok(compareResults(close, result(3, { remainingMs: 100 })) > 0);
  assert.ok(compareResults(close, result(3, { success: false, remainingMs: null })) > 0);
  assert.equal(compareResults(result(3, { success: false, remainingMs: null }), result(3, { success: false, remainingMs: null })), 0);
  assert.equal(formatResult(close), '残り 0.080 秒');
  const escaped = result(6, { survivalMs: 15_000, nearMissMs: 100 });
  assert.ok(compareResults(escaped, result(6, { success: false, survivalMs: 14_999, nearMissMs: 8000 })) > 0);
  assert.ok(compareResults({ ...escaped, nearMissMs: 101 }, escaped) > 0);
  assert.equal(compareResults(result(5), result(5)), 0);
  assert.throws(() => compareResults(result(1), result(2)));
});

test('challenge round trip retains rules, seed, daily date and target but strips debug parameters', () => {
  const daily = dailyForDate('2026-01-03');
  const target = result(3, { remainingMs: 80 });
  const url = encodeChallenge(daily, target, 'https://example.com/?test=1&seed=12&capture=1');
  assert.ok(url.length < 2048);
  assert.equal(new URL(url).searchParams.size, 1);
  const parsed = parseChallenge(url);
  assert.deepEqual(parsed.context, { ...daily, kind: 'challenge', target });
  assert.equal(courseKey(parsed.context!), courseKey(daily));
  assert.equal(parsed.error, undefined);
});

test('challenge parser rejects wrong versions, invalid targets, dates, seeds and duplicate payloads', () => {
  const encode = (value: unknown) => `challenge=${btoa(JSON.stringify(value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')}`;
  const base = { v: 2, m: 3, s: 0, r: [1, 0, 0, 0, 0, 0, 80, 0, 0] };
  assert.match(parseChallenge(encode({ ...base, v: 999 })).error!, /ルール/);
  for (const patch of [{ s: -1 }, { s: 2 ** 32 }, { m: 5 }, { r: [1, 0, 0, 0, 0, 0, 0, 0, 0] }, { r: [1, 0, 0, 0, 0, 0, -2, 0, 0] }, { d: '2026-02-30' }, { d: '2026-01-03' }]) {
    assert.ok(parseChallenge(encode({ ...base, ...patch })).error, JSON.stringify(patch));
  }
  const query = encode(base);
  assert.ok(parseChallenge(`${query}&${query}`).error);
  assert.ok(parseChallenge('challenge=<script>').error);
  assert.ok(parseChallenge(`challenge=${'a'.repeat(1801)}`).error);
  assert.deepEqual(parseChallenge('mode=3'), {});
  assert.equal(parseChallenge('daily=2026-01-03&mode=3').context?.kind, 'daily');
  assert.ok(parseChallenge('daily=2026-01-03&mode=2').error);
  assert.ok(parseChallenge('daily=2026-01-03&daily=2026-01-04').error);
});

test('engine conversion uses explicit metrics and never turns the old hold score into a margin', () => {
  const converted = resultFromEngine({ mode: 3, score: 4.1, success: true, elapsed: 4.1, metrics: { remainingMs: 87 } });
  assert.equal(converted.remainingMs, 87);
  assert.equal(converted.count, 0);
  assert.equal(resultFromEngine({ mode: 3, score: 4.1, success: true, elapsed: 4.1 }).remainingMs, null);
  const chase = resultFromEngine({ mode: 6, score: 12.3, success: false, elapsed: 12.345, metrics: { survivalMs: 12345, nearMissMs: 3000 } });
  assert.equal(chase.survivalMs, 12345);
  assert.equal(chase.nearMissMs, 3000);
  assert.ok(isRunResult(chase));
  assert.equal(isRunResult({ ...converted, remainingMs: Infinity }), false);
  assert.equal(isRunResult({ ...chase, nearMissMs: 15000 }), false);
});

test('all twelve collectible reactions have distinct stable IDs and local production artwork paths', () => {
  assert.equal(COLLECTION.length, 12);
  assert.equal(new Set(COLLECTION.map(r => r.id)).size, 12);
  for (const reaction of COLLECTION) assert.equal(reaction.asset, `/assets/reaction-${reaction.id}.webp`);
});
