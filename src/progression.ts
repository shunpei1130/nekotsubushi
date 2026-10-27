/** Shared, browser-independent rules for records, daily courses and challenge links. */
export const RULES_VERSION = 2 as const;
export type ModeId = 1 | 2 | 3 | 4 | 5 | 6;
export type RunResult = {
  mode: ModeId; rulesVersion: typeof RULES_VERSION; success: boolean;
  count: number; maxStreak: number; specialCount: number; perfectCount: number;
  maxPerfectStreak: number; remainingMs: number | null; survivalMs: number; nearMissMs: number;
};
export type RunContext = {
  kind: 'normal' | 'daily' | 'challenge'; mode: ModeId; seed: number;
  rulesVersion: typeof RULES_VERSION; dailyDate?: string; target?: RunResult;
};
export type CheekGesture = 'right' | 'left' | 'up' | 'down' | 'inward' | 'gentle';
export type Reaction = { id: string; name: string; hint: string; mode: ModeId | null; asset: string };
const reaction = (id: string, name: string, hint: string, mode: ModeId | null): Reaction =>
  ({ id, name, hint, mode, asset: `/assets/reaction-${id}.webp` });
export const COLLECTION: readonly Reaction[] = [
  reaction('cheek-right', '右にむに〜', '右のほっぺを、そっと外へ引っぱる', 5),
  reaction('cheek-left', '左にむに〜', '左のほっぺを、そっと外へ引っぱる', 5),
  reaction('cheek-up', 'きゅっと上向き', 'ほっぺを、上へむにっと', 5),
  reaction('cheek-down', 'ぷくっと下向き', 'ほっぺを、下へむにっと', 5),
  reaction('cheek-inward', 'もちもち', 'ほっぺを、お鼻のほうへ寄せる', 5),
  reaction('cheek-gentle', 'うっとり', 'ほっぺを小さく引いて、1秒ひと休み', 5),
  reaction('streak-1', 'しらんぷり', 'ねこつんつんで、見つからずに10回連続', 1),
  reaction('streak-2', 'あれ、箱は？', '箱をずらせで、3回連続成功', 2),
  reaction('close-3', 'すんっ', '猫パンチ寸止めで、パンチの100ms以内に離す', 3),
  reaction('rhythm-4', 'ぷいっ', '帽子を3回連続、ぴったりのタイミングで', 4),
  reaction('clear-6', 'むむっ', '猫じゃらしで、15秒逃げきる', 6),
  reaction('personal-best', 'びっくり！', '一度保存した自己ベストを、もう一度超える', null),
];
const DAY = 86_400_000;
const EPOCH = Date.UTC(2026, 0, 1);
const DAILY_MODES: readonly ModeId[] = [1, 2, 3, 4, 6];
const isMode = (v: unknown): v is ModeId => Number.isInteger(v) && Number(v) >= 1 && Number(v) <= 6;
const integer = (v: unknown, max: number, min = 0): v is number => typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;

export function jstDate(date = new Date()): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date');
  return new Date(date.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}
export function isDailyDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function hash(value: string): number {
  let n = 2166136261;
  for (let i = 0; i < value.length; i++) n = Math.imul(n ^ value.charCodeAt(i), 16777619);
  return n >>> 0;
}
export function dailyForDate(date: string): RunContext {
  if (!isDailyDate(date)) throw new Error('Invalid daily date');
  const day = Math.round((Date.parse(`${date}T00:00:00.000Z`) - EPOCH) / DAY);
  const mode = DAILY_MODES[((day % DAILY_MODES.length) + DAILY_MODES.length) % DAILY_MODES.length];
  return { kind: 'daily', mode, seed: hash(`${RULES_VERSION}|daily|${date}|${mode}`), rulesVersion: RULES_VERSION, dailyDate: date };
}
export const dailyContext = (now = new Date()): RunContext => dailyForDate(jstDate(now));
export function normalContext(mode: ModeId, seed?: number): RunContext {
  if (!isMode(mode)) throw new Error('Unknown game mode');
  if (seed === undefined) {
    const values = new Uint32Array(1);
    seed = typeof globalThis.crypto !== 'undefined' ? crypto.getRandomValues(values)[0] : Math.floor(Math.random() * 0x1_0000_0000);
  }
  if (!integer(seed, 0xffff_ffff)) throw new Error('Invalid seed');
  return { kind: 'normal', mode, seed, rulesVersion: RULES_VERSION };
}
export function courseKey(context: RunContext): string {
  return context.kind === 'normal' ? `v${context.rulesVersion}:normal:${context.mode}`
    : `v${context.rulesVersion}:course:${context.mode}:${context.seed}:${context.dailyDate ?? 'free'}`;
}

type EngineState = {
  mode: number; score: number; success: boolean; elapsed: number;
  metrics?: Partial<{maxStreak:number;specialCount:number;perfectCount:number;maxPerfectStreak:number;remainingMs:number|null;survivalMs:number;nearMissMs:number}>;
};
export function resultFromEngine(engine: EngineState): RunResult {
  if (!isMode(engine.mode)) throw new Error('Unknown game mode');
  const m = engine.metrics ?? {};
  const safe = (v: number | undefined, max = 10_000) => Number.isFinite(v) ? Math.max(0, Math.min(max, Math.floor(v!))) : 0;
  const survivalMs = engine.mode === 6 ? safe(m.survivalMs ?? engine.elapsed * 1000, 15_000) : 0;
  return {
    mode: engine.mode, rulesVersion: RULES_VERSION, success: engine.success,
    count: [1, 2, 4].includes(engine.mode) ? safe(engine.score) : 0,
    maxStreak: safe(m.maxStreak), specialCount: safe(m.specialCount), perfectCount: safe(m.perfectCount),
    maxPerfectStreak: safe(m.maxPerfectStreak),
    remainingMs: engine.mode === 3 && engine.success && typeof m.remainingMs === 'number' ? Math.max(1, safe(m.remainingMs, 5200)) : null,
    survivalMs, nearMissMs: engine.mode === 6 ? Math.min(survivalMs, safe(m.nearMissMs, 15_000)) : 0,
  };
}

/** A positive value means a is better; zero is a genuine tie. */
export function compareResults(a: RunResult, b: RunResult): number {
  if (a.mode !== b.mode || a.rulesVersion !== b.rulesVersion) throw new Error('Cannot compare different rules');
  const diff = (...pairs: [number, number][]) => {
    for (const [left, right] of pairs) if (left !== right) return left > right ? 1 : -1;
    return 0;
  };
  if (a.mode === 5) return 0;
  if (a.mode === 3) {
    if (a.success !== b.success) return a.success ? 1 : -1;
    return a.success ? diff([b.remainingMs ?? Infinity, a.remainingMs ?? Infinity]) : 0;
  }
  if (a.mode === 6) return diff([a.survivalMs, b.survivalMs], [a.nearMissMs, b.nearMissMs]);
  if (a.mode === 4) return diff([a.count, b.count], [a.perfectCount, b.perfectCount], [a.maxPerfectStreak, b.maxPerfectStreak]);
  return diff([a.count, b.count], [a.maxStreak, b.maxStreak], [a.mode === 2 ? a.perfectCount : a.specialCount, b.mode === 2 ? b.perfectCount : b.specialCount]);
}
export function formatResult(result: RunResult): string {
  if (result.mode === 5) return '気ままに、むに。';
  if (result.mode === 3) return result.success && result.remainingMs !== null ? `残り ${(result.remainingMs / 1000).toFixed(3)} 秒` : '猫パンチ！';
  if (result.mode === 6) return `${(result.survivalMs / 1000).toFixed(3)} 秒`;
  return `${result.count} 回`;
}

export function isRunResult(value: unknown): value is RunResult {
  if (!value || typeof value !== 'object') return false;
  const r = value as RunResult;
  if (!isMode(r.mode) || r.rulesVersion !== RULES_VERSION || typeof r.success !== 'boolean') return false;
  if (![r.count, r.maxStreak, r.specialCount, r.perfectCount, r.maxPerfectStreak].every(v => integer(v, 10_000))) return false;
  if (r.maxStreak > r.count || r.specialCount > r.count || r.perfectCount > r.count || r.maxPerfectStreak > r.perfectCount) return false;
  if (!integer(r.survivalMs, 15_000) || !integer(r.nearMissMs, r.survivalMs)) return false;
  if (r.mode === 3) return r.success ? integer(r.remainingMs, 5200, 1) : r.remainingMs === null;
  return r.remainingMs === null;
}

function packResult(r: RunResult) {
  return [r.success ? 1 : 0, r.count, r.maxStreak, r.specialCount, r.perfectCount, r.maxPerfectStreak, r.remainingMs, r.survivalMs, r.nearMissMs];
}
function unpackResult(value: unknown, mode: ModeId): RunResult | null {
  if (!Array.isArray(value) || value.length !== 9 || (value[0] !== 0 && value[0] !== 1)) return null;
  const r: RunResult = { mode, rulesVersion: RULES_VERSION, success: value[0] === 1, count: value[1], maxStreak: value[2], specialCount: value[3], perfectCount: value[4], maxPerfectStreak: value[5], remainingMs: value[6], survivalMs: value[7], nearMissMs: value[8] };
  return isRunResult(r) ? r : null;
}
export function encodeChallenge(context: RunContext, result: RunResult, origin = globalThis.location?.origin ?? 'https://nekotsubushi.vercel.app'): string {
  if (context.mode === 5 || context.mode !== result.mode || !isRunResult(result) || context.rulesVersion !== RULES_VERSION || !integer(context.seed, 0xffff_ffff)) throw new Error('Invalid challenge');
  if (context.dailyDate) {
    const daily = dailyForDate(context.dailyDate);
    if (daily.mode !== context.mode || daily.seed !== context.seed) throw new Error('Invalid daily course');
  }
  const data = { v: RULES_VERSION, m: context.mode, s: context.seed, ...(context.dailyDate ? { d: context.dailyDate } : {}), r: packResult(result) };
  const encoded = btoa(JSON.stringify(data)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
  const url = new URL('/', origin);
  url.searchParams.set('challenge', encoded);
  if (url.href.length > 2048) throw new Error('Challenge link is too long');
  return url.href;
}
export function parseChallenge(input: URLSearchParams | string): { context?: RunContext; error?: string } {
  try {
    const params = typeof input === 'string' ? (input.startsWith('http:') || input.startsWith('https:') ? new URL(input).searchParams : new URLSearchParams(input)) : input;
    if (!params.has('challenge')) {
      if (!params.has('daily')) return {};
      if (params.getAll('daily').length !== 1) throw new Error('invalid');
      const daily = dailyForDate(params.get('daily')!);
      if (params.has('mode') && params.get('mode') !== String(daily.mode)) throw new Error('invalid');
      return { context: daily };
    }
    const values = params.getAll('challenge');
    const token = values[0];
    if (values.length !== 1 || token.length > 1800 || !/^[A-Za-z0-9_-]+$/.test(token)) throw new Error('invalid');
    const data = JSON.parse(atob(token.replaceAll('-', '+').replaceAll('_', '/')));
    if (!data || data.v !== RULES_VERSION) return { error: 'この挑戦は別のルール版です。メニューからあそんでください。' };
    if (!isMode(data.m) || data.m === 5 || !integer(data.s, 0xffff_ffff)) throw new Error('invalid');
    const target = unpackResult(data.r, data.m);
    if (!target) throw new Error('invalid');
    if (data.d !== undefined) {
      if (!isDailyDate(data.d)) throw new Error('invalid');
      const daily = dailyForDate(data.d);
      if (daily.mode !== data.m || daily.seed !== data.s) throw new Error('invalid');
    }
    return { context: { kind: 'challenge', rulesVersion: RULES_VERSION, mode: data.m, seed: data.s, ...(data.d ? { dailyDate: data.d } : {}), target } };
  } catch {
    return { error: '挑戦状を読み込めませんでした。リンクを確かめるか、メニューからあそんでください。' };
  }
}
