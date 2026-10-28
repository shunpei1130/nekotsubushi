import { JOURNEY_VERSION, STAGE_ORDER, journeyStatus as statusForJourney, loadJourney, stageProof, type Journey, type JourneyEvidence, type JourneyStatus } from './journey';
import { COLLECTION, RULES_VERSION, compareResults, courseKey, isDailyDate, isRunResult, type ModeId, type RunContext, type RunResult } from './progression';

type StoredRun = { best: RunResult | null; last: RunResult; updatedAt: number };
export type Save = {
  schemaVersion: 2; sound: boolean; reduced: boolean; records: Record<string, number>;
  legacyRecords: Record<string, number>; clears: number; seen: number[]; unlocked: string[];
  runs: Record<string, StoredRun>; journey: Journey;
};
export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export const SAVE_KEY = 'nekotsubushi:v2';
const LEGACY_KEY = 'nekotsubushi:v1';
const reactionIds = new Set(COLLECTION.map(r => r.id));
const MAX_COURSES = 90;
const storage = (): StorageLike | null => { try { return globalThis.localStorage ?? null; } catch { return null; } };
const reducedDefault = () => { try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; } catch { return false; } };
const fresh = (reduced = reducedDefault()): Save => ({ schemaVersion: 2, sound: true, reduced, records: {}, legacyRecords: {}, clears: 0, seen: [], unlocked: [], runs: {}, journey: { version: JOURNEY_VERSION, proofs: {} } });
function nonnegative(value: unknown, max = 1_000_000): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(max, Math.floor(value)) : null;
}
function object(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value); }
function pruneRuns(value: Record<string, StoredRun>) {
  const normal = Object.entries(value).filter(([key]) => key.includes(':normal:'));
  const courses = Object.entries(value).filter(([key]) => key.includes(':course:')).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MAX_COURSES);
  return Object.fromEntries([...normal, ...courses]);
}
function validStoredKey(key: string, mode: number) {
  if (key === `v${RULES_VERSION}:normal:${mode}` && mode !== 5) return true;
  const match = key.match(/^v2:course:([12346]):(\d{1,10}):(free|\d{4}-\d{2}-\d{2})$/);
  return !!match && Number(match[1]) === mode && Number(match[2]) <= 0xffff_ffff && (match[3] === 'free' || isDailyDate(match[3]));
}
/** Load v2, or migrate v1 without writing to or deleting the old key. */
export function loadSave(source: StorageLike | null = storage(), reduced = reducedDefault()): Save {
  const result = fresh(reduced);
  let raw: unknown;
  try {
    raw = JSON.parse(source?.getItem(SAVE_KEY) ?? 'null');
    if (!object(raw) || raw.schemaVersion !== 2) raw = JSON.parse(source?.getItem(LEGACY_KEY) ?? 'null');
  } catch {
    try { raw = JSON.parse(source?.getItem(LEGACY_KEY) ?? 'null'); } catch { return result; }
  }
  if (!object(raw) || (raw.schemaVersion !== 1 && raw.schemaVersion !== 2)) return result;
  result.sound = typeof raw.sound === 'boolean' ? raw.sound : true;
  result.reduced = typeof raw.reduced === 'boolean' ? raw.reduced : reduced;
  if (Array.isArray(raw.seen)) result.seen = [...new Set(raw.seen.filter((v): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 6))];
  result.clears = nonnegative(raw.clears) ?? 0;
  if (object(raw.records)) for (const key of ['1', '2', '3', '4', '6']) {
    const value = nonnegative(raw.records[key], key === '3' ? 5200 : key === '6' ? 15_000 : 10_000);
    if (value !== null) (key === '3' ? result.legacyRecords : result.records)[key] = value;
  }
  if (raw.schemaVersion === 2) {
    if (object(raw.legacyRecords)) for (const key of ['1', '2', '3', '4', '6']) {
      const value = nonnegative(raw.legacyRecords[key]);
      if (value !== null) result.legacyRecords[key] = value;
    }
    if (Array.isArray(raw.unlocked)) result.unlocked = [...new Set(raw.unlocked.filter((v): v is string => typeof v === 'string' && reactionIds.has(v)))];
    if (object(raw.runs)) for (const [key, item] of Object.entries(raw.runs)) {
      if (!object(item) || !isRunResult(item.last) || !validStoredKey(key, item.last.mode)) continue;
      if (item.best !== null && (!isRunResult(item.best) || item.best.mode !== item.last.mode)) continue;
      if (item.best === null && (item.last.mode !== 3 || item.last.success)) continue;
      const updatedAt = nonnegative(item.updatedAt, Number.MAX_SAFE_INTEGER);
      if (updatedAt === null) continue;
      result.runs[key] = { best: item.best ? { ...item.best } : null, last: { ...item.last }, updatedAt };
    }
    result.journey = loadJourney(raw.journey);
    reconcileJourney(result);
    result.runs = pruneRuns(result.runs);
  }
  return result;
}

/** Stored detailed results are evidence; old numeric scores never imply a
 * streak, timing grade, near miss or a successful punch margin. */
function reconcileJourney(state: Save): ModeId[] {
  const added: ModeId[] = [];
  for (const mode of STAGE_ORDER) {
    const status = statusForJourney(state.journey);
    if (status.cleared.includes(mode)) continue;
    if (status.current !== mode) break;
    let proof = null;
    if (mode === 5) {
      // Old collection totals have no same-session proof. Keep expressions,
      // but require a new six-gesture session before progressing to stage 6.
      break;
    } else {
      for (const run of Object.values(state.runs)) {
        const candidates = [run.best, run.last];
        for (const result of candidates) {
          if (result?.mode !== mode) continue;
          proof = stageProof(mode, { result });
          if (proof) break;
        }
        if (proof) break;
      }
    }
    if (!proof) break;
    state.journey.proofs[mode] = proof;
    added.push(mode);
  }
  return added;
}
export function journeyStatus(state: Save = save): JourneyStatus { return statusForJourney(state.journey); }
export function isStageUnlocked(mode: number, state: Save = save): boolean { return journeyStatus(state).unlocked.includes(mode as ModeId); }
export function currentStage(state: Save = save): ModeId | null { return journeyStatus(state).current; }
export type StageCompletion = { passed: boolean; newlyCleared: ModeId[]; newlyUnlocked: ModeId[]; allClear: boolean };
/** Call once a genuine completed run (or session of cheek gestures) is known.
 * Repeated frame/event calls are harmless; a locked stage cannot skip ahead. */
export function completeStage(mode: ModeId, evidence: JourneyEvidence): StageCompletion {
  const before = journeyStatus();
  const proof = stageProof(mode, evidence);
  const permitted = before.unlocked.includes(mode);
  const newlyCleared: ModeId[] = [];
  if (permitted && proof && before.current === mode) {
    save.journey.proofs[mode] = proof;
    newlyCleared.push(mode, ...reconcileJourney(save));
    persist();
  }
  const after = journeyStatus();
  return { passed: permitted && proof !== null, newlyCleared, newlyUnlocked: after.unlocked.filter(stage => !before.unlocked.includes(stage)), allClear: after.allClear };
}

export let save: Save = loadSave();
export function persist() { try { storage()?.setItem(SAVE_KEY, JSON.stringify(save)); } catch {} }
function clone(result: RunResult | undefined | null): RunResult | null { return result ? { ...result } : null; }
function legacyBest(context: RunContext): RunResult | null {
  const value = save.records[String(context.mode)];
  if (context.kind !== 'normal' || context.mode === 3 || context.mode === 5 || !value) return null;
  return { mode: context.mode, rulesVersion: RULES_VERSION, success: context.mode !== 6 || value >= 15_000,
    count: context.mode === 6 ? 0 : value, maxStreak: 0, specialCount: 0, perfectCount: 0, maxPerfectStreak: 0,
    remainingMs: null, survivalMs: context.mode === 6 ? value : 0, nearMissMs: 0 };
}
export function bestResult(context: RunContext): RunResult | null { return clone(save.runs[courseKey(context)]?.best ?? legacyBest(context)); }
export function previousResult(context: RunContext): RunResult | null { return clone(save.runs[courseKey(context)]?.last); }
function addUnlocks(ids: string[]): string[] {
  const added: string[] = [];
  for (const id of ids) if (reactionIds.has(id) && !save.unlocked.includes(id)) { save.unlocked.push(id); added.push(id); }
  return added;
}
export function unlockReaction(id: string): string[] { const added = addUnlocks([id]); if (added.length) persist(); return added; }
export function collectCheek(gesture: string): string[] { return unlockReaction(`cheek-${gesture}`); }
export function recordRun(context: RunContext, result: RunResult): { previousBest: RunResult | null; newBest: boolean; previous: RunResult | null; unlocked: string[] } {
  if (!isRunResult(result) || result.mode !== context.mode || result.rulesVersion !== context.rulesVersion || result.mode === 5) throw new Error('Invalid record');
  const previousBest = bestResult(context), previous = previousResult(context);
  const eligible = result.mode !== 3 || result.success;
  const newBest = eligible && (!previousBest || compareResults(result, previousBest) > 0);
  const best = newBest ? result : previousBest;
  const updatedAt = Math.max(Date.now(), ...Object.values(save.runs).map(run => run.updatedAt + 1));
  save.runs[courseKey(context)] = { best: best ? { ...best } : null, last: { ...result }, updatedAt };
  save.runs = pruneRuns(save.runs);
  if (context.kind === 'normal' && ![3, 5].includes(result.mode)) {
    const value = result.mode === 6 ? result.survivalMs : result.count;
    save.records[String(result.mode)] = Math.max(save.records[String(result.mode)] ?? 0, value);
  }
  if (result.mode === 6 && result.success) save.clears++;
  const ids: string[] = [];
  if (result.mode === 1 && result.maxStreak >= 10) ids.push('streak-1');
  if (result.mode === 2 && result.maxStreak >= 3) ids.push('streak-2');
  if (result.mode === 3 && result.success && result.remainingMs !== null && result.remainingMs <= 100) ids.push('close-3');
  if (result.mode === 4 && result.maxPerfectStreak >= 3) ids.push('rhythm-4');
  if (result.mode === 6 && result.success && result.survivalMs === 15_000) ids.push('clear-6');
  if (newBest && previousBest && (previousBest.mode !== 3 || previousBest.success)) ids.push('personal-best');
  const unlocked = addUnlocks(ids);
  persist();
  return { previousBest, newBest, previous, unlocked };
}

let audio: AudioContext | undefined;
export function sound(kind: 'tap' | 'success' | 'caught' | 'spring' = 'tap') {
  if (!save.sound) return;
  try {
    audio ??= new AudioContext(); void audio.resume();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime;
    o.type = 'sine'; o.frequency.setValueAtTime(kind === 'caught' ? 180 : kind === 'spring' ? 450 : 620, t);
    o.frequency.exponentialRampToValueAtTime(kind === 'success' ? 950 : kind === 'spring' ? 170 : 250, t + .13);
    g.gain.setValueAtTime(.065, t); g.gain.exponentialRampToValueAtTime(.001, t + .16);
    o.connect(g); g.connect(audio.destination); o.start(t); o.stop(t + .17);
  } catch {}
}
