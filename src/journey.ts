/** Stage unlocks are a separate version from score/challenge rules. */
import { isRunResult, type CheekGesture, type ModeId, type RunResult } from './progression';

export const JOURNEY_VERSION = 1 as const;
export const STAGE_ORDER: readonly ModeId[] = [1, 2, 3, 4, 5, 6];
export const CHEEK_GESTURES: readonly CheekGesture[] = ['right', 'left', 'up', 'down', 'inward', 'gentle'];
/** Calibrated independently from each mode's ranking criteria. */
export const STAGE_GOALS = {
  1: { count: 40, maxStreak: 35 },
  2: { count: 10, perfectCount: 3 },
  3: { remainingMs: 150 },
  4: { count: 13, perfectCount: 0 },
  5: { gestures: 6 },
  6: { survivalMs: 15_000, nearMissMs: 0 },
} as const;

export type JourneyEvidence = { result?: RunResult; gestures?: readonly CheekGesture[] };
export type StageProof = { kind: 'run'; result: RunResult } | { kind: 'cheeks'; gestures: CheekGesture[] };
export type Journey = { version: typeof JOURNEY_VERSION; proofs: Partial<Record<ModeId, StageProof>> };
export type StageRequirement = { label: string; current: number; target: number; met: boolean };
export type StageEvaluation = { passed: boolean; description: string; remaining: string; requirements: StageRequirement[] };
export type JourneyStatus = { cleared: ModeId[]; unlocked: ModeId[]; current: ModeId | null; allClear: boolean };

export function stageGoal(mode: ModeId): string {
  switch (mode) {
    case 1: return `30秒で${STAGE_GOALS[1].count}回、最大${STAGE_GOALS[1].maxStreak}回連続`;
    case 2: return `30秒で${STAGE_GOALS[2].count}回成功、うち「ぴったり」${STAGE_GOALS[2].perfectCount}回`;
    case 3: return `パンチの直前${STAGE_GOALS[3].remainingMs}ms以内に離す`;
    case 4: return STAGE_GOALS[4].perfectCount > 0 ? `15秒で${STAGE_GOALS[4].count}回、うち「ぴったり」${STAGE_GOALS[4].perfectCount}回` : `15秒で${STAGE_GOALS[4].count}回かぶせる`;
    case 5: return '1回のあそびで6種類のむにむにを見つける';
    case 6: return STAGE_GOALS[6].nearMissMs > 0 ? `15秒逃げきり、ひやひや時間${(STAGE_GOALS[6].nearMissMs / 1000).toFixed(1)}秒以上` : '15秒間、つかまらずに逃げきる';
  }
}

export function evaluateStage(mode: ModeId, evidence: JourneyEvidence = {}): StageEvaluation {
  const result = evidence.result;
  const valid = !!result && result.mode === mode && isRunResult(result);
  const requirements: StageRequirement[] = [];
  const requireAtLeast = (label: string, current: number, target: number) => requirements.push({ label, current, target, met: current >= target });
  if (mode === 5) {
    const gestures = new Set(evidence.gestures?.filter(gesture => CHEEK_GESTURES.includes(gesture)) ?? []);
    requireAtLeast('見つけた仕草', gestures.size, STAGE_GOALS[5].gestures);
  } else if (mode === 3) {
    const margin = valid && result.success ? result.remainingMs : null;
    requirements.push({ label: 'パンチまでの残りms', current: margin ?? 0, target: STAGE_GOALS[3].remainingMs, met: margin !== null && margin >= 1 && margin <= STAGE_GOALS[3].remainingMs });
  } else if (mode === 6) {
    requireAtLeast('逃げた時間ms', valid ? result.survivalMs : 0, STAGE_GOALS[6].survivalMs);
    if (STAGE_GOALS[6].nearMissMs > 0) requireAtLeast('ひやひや時間ms', valid ? result.nearMissMs : 0, STAGE_GOALS[6].nearMissMs);
  } else {
    requireAtLeast('回数', valid ? result.count : 0, STAGE_GOALS[mode].count);
    if (mode === 1) requireAtLeast('最大連続', valid ? result.maxStreak : 0, STAGE_GOALS[1].maxStreak);
    else if (STAGE_GOALS[mode].perfectCount > 0) requireAtLeast('ぴったり', valid ? result.perfectCount : 0, STAGE_GOALS[mode].perfectCount);
  }
  const passed = (mode === 5 || !!(valid && result.success)) && requirements.every(requirement => requirement.met);
  let remaining = '条件達成！';
  if (!passed) {
    if (mode === 3) remaining = !valid || !result.success ? 'パンチを受ける前に離そう' : `あと${Math.max(0, (result.remainingMs ?? 0) - STAGE_GOALS[3].remainingMs)}ms遅く離そう`;
    else {
      const missing = requirements.filter(requirement => !requirement.met).map(requirement => {
        const delta = Math.max(0, requirement.target - requirement.current);
        return requirement.label.endsWith('ms') ? `${requirement.label.slice(0, -2)} あと${(delta / 1000).toFixed(3)}秒` : `${requirement.label} あと${delta}${mode === 5 ? '種類' : '回'}`;
      });
      remaining = missing.join(' / ') || '最後まであそんで、条件を確定しよう';
    }
  }
  return { passed, description: stageGoal(mode), remaining, requirements };
}

export function stageProof(mode: ModeId, evidence: JourneyEvidence): StageProof | null {
  if (!evaluateStage(mode, evidence).passed) return null;
  return mode === 5
    ? { kind: 'cheeks', gestures: [...CHEEK_GESTURES] }
    : { kind: 'run', result: { ...evidence.result! } };
}

/** Malformed proofs and gaps cannot expose a later stage. */
export function journeyStatus(journey: Journey): JourneyStatus {
  const cleared: ModeId[] = [];
  for (const mode of STAGE_ORDER) {
    const proof = journey.proofs[mode];
    const evidence = proof?.kind === 'run' ? { result: proof.result } : proof?.kind === 'cheeks' ? { gestures: proof.gestures } : {};
    if (!proof || mode === 5 && proof.kind !== 'cheeks' || mode !== 5 && proof.kind !== 'run' || !evaluateStage(mode, evidence).passed) break;
    cleared.push(mode);
  }
  const current = STAGE_ORDER[cleared.length] ?? null;
  return { cleared, unlocked: STAGE_ORDER.slice(0, Math.min(STAGE_ORDER.length, cleared.length + 1)), current, allClear: current === null };
}

export function loadJourney(value: unknown): Journey {
  const journey: Journey = { version: JOURNEY_VERSION, proofs: {} };
  if (!value || typeof value !== 'object' || (value as Journey).version !== JOURNEY_VERSION) return journey;
  const proofs = (value as Journey).proofs;
  if (!proofs || typeof proofs !== 'object' || Array.isArray(proofs)) return journey;
  for (const mode of STAGE_ORDER) {
    const raw = proofs[mode];
    if (!raw || typeof raw !== 'object') continue;
    const evidence = mode === 5 && raw.kind === 'cheeks' && Array.isArray(raw.gestures) ? { gestures: raw.gestures }
      : mode !== 5 && raw.kind === 'run' ? { result: raw.result } : {};
    const proof = stageProof(mode, evidence);
    if (proof) journey.proofs[mode] = proof;
  }
  // An orphan proof could have been written by corrupt data. Keep only a
  // proven prefix; later genuine results are still retained in stored runs.
  const prefix = new Set(journeyStatus(journey).cleared);
  for (const mode of STAGE_ORDER) if (!prefix.has(mode)) delete journey.proofs[mode];
  return journey;
}
