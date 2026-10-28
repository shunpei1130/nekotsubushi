/**
 * Test-only historical evidence. These are constructed records, never playtest
 * results. Production has no URL or runtime switch for bypassing stage locks.
 */
import { CHEEK_GESTURES, STAGE_GOALS, STAGE_ORDER } from '../src/journey.ts';
import { type ModeId, type RunResult } from '../src/progression.ts';

export function passingResult(mode: Exclude<ModeId, 5>): RunResult {
  const count = mode === 1 ? STAGE_GOALS[1].count : mode === 2 ? STAGE_GOALS[2].count : mode === 4 ? STAGE_GOALS[4].count : 0;
  const perfectCount = mode === 2 ? STAGE_GOALS[2].perfectCount : mode === 4 ? STAGE_GOALS[4].perfectCount : 0;
  return {
    mode, rulesVersion: 2, success: true, count,
    maxStreak: mode === 1 ? STAGE_GOALS[1].maxStreak : count,
    specialCount: 0, perfectCount, maxPerfectStreak: perfectCount,
    remainingMs: mode === 3 ? STAGE_GOALS[3].remainingMs : null,
    survivalMs: mode === 6 ? STAGE_GOALS[6].survivalMs : 0,
    nearMissMs: mode === 6 ? STAGE_GOALS[6].nearMissMs : 0,
  };
}

export function historicalSave(through: number = 6) {
  const runs: Record<string, {best:RunResult;last:RunResult;updatedAt:number}> = {};
  for (const mode of STAGE_ORDER) {
    if (mode > through || mode === 5) continue;
    const result = passingResult(mode);
    runs[`v2:normal:${mode}`] = {best:{...result},last:{...result},updatedAt:1000+mode};
  }
  return {
    schemaVersion:2, sound:false, reduced:false, records:{}, legacyRecords:{},
    clears:through>=6?1:0, seen:[],
    unlocked:through>=5?CHEEK_GESTURES.map(gesture=>`cheek-${gesture}`):[], runs,
  };
}

/** A constructed NEW-version proof prepares already-cleared regression users.
 * Old portrait totals alone never prove six gestures in a single visit. */
export function unlockedRegressionSave(through=6) {
  const value=historicalSave(through);
  const proofs:Record<string,unknown>={};
  for(const mode of STAGE_ORDER){
    if(mode>through)continue;
    proofs[mode]=mode===5?{kind:'cheeks',gestures:[...CHEEK_GESTURES]}:{kind:'run',result:passingResult(mode)};
  }
  return {...value,journey:{version:1,proofs}};
}

/** Install just once so reload genuinely reads the app's saved state. */
export const seedHistoricalScript = (through = 6) => `
  try {
    if (localStorage.getItem('nekotsubushi:v2') === null && localStorage.getItem('nekotsubushi:v1') === null) {
      const testSave = ${JSON.stringify(unlockedRegressionSave(through))};
      testSave.reduced = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      localStorage.setItem('nekotsubushi:v2', JSON.stringify(testSave));
    }
  } catch {}
`;
