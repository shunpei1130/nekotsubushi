import test from 'node:test';
import assert from 'node:assert/strict';
import { boxCatPose, type BoxCatPoseInput } from '../src/choreography.ts';
import { W } from '../src/engine.ts';

const input = (patch: Partial<BoxCatPoseInput> = {}): BoxCatPoseInput => ({
  phase: 'JUMP', phaseTime: 0.3, phaseDuration: 0.6, outcome: 'SUCCESS', boxX: W * 0.75, ...patch,
});
const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-7, `${a} differs from ${b}`);
function samePlacement(a: ReturnType<typeof boxCatPose>, b: ReturnType<typeof boxCatPose>) {
  for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const) near(a[key], b[key]);
}

test('02 reference pose is on the live trajectory, without a fixture override', () => {
  const live = boxCatPose(input());
  const fixture = boxCatPose(input({ fixture: true }));
  assert.deepEqual(fixture, live);
  assert.deepEqual([live.x, live.y, live.width, live.height], [10, 300, 635, 610]);
  assert.equal(live.texture, 'jump');
  assert.equal(live.airborne, true);
});

test('02 changing an undecided airborne swipe into success never moves the cat instantly', () => {
  for (const time of [0, 0.12, 0.3, 0.49, 0.52]) {
    const pending = boxCatPose(input({ phaseTime: time, outcome: 'PENDING', boxX: W / 2 }));
    const success = boxCatPose(input({ phaseTime: time, outcome: 'SUCCESS', boxX: W * 0.75 }));
    samePlacement(pending, success);
  }
});

test('02 approach, crouch, jump and landing join at matching visible placements', () => {
  const approachEnd = boxCatPose(input({ phase: 'APPROACH', phaseTime: 1.2, phaseDuration: 1.2 }));
  const crouchStart = boxCatPose(input({ phase: 'CROUCH', phaseTime: 0 }));
  const crouchEnd = boxCatPose(input({ phase: 'CROUCH', phaseTime: 0.45 }));
  const takeoff = boxCatPose(input({ phaseTime: 0 }));
  samePlacement(approachEnd, crouchStart);
  samePlacement(crouchEnd, takeoff);
  for (const outcome of ['SUCCESS', 'EARLY', 'MISS'] as const) {
    const end = boxCatPose(input({ phaseTime: 0.6, outcome }));
    const landing = boxCatPose(input({ phase: 'REACTION', phaseTime: 0, phaseDuration: 0.45, outcome }));
    samePlacement(end, landing);
    assert.equal(landing.texture, 'jump');
  }
});

test('02 a missed or early swipe visibly enters the actual box; success stays on the rug', () => {
  for (const boxX of [W * 0.22, W / 2, W * 0.78]) {
    for (const outcome of ['EARLY', 'MISS'] as const) {
      const entered = boxCatPose(input({ phase: 'REACTION', phaseTime: 0.25, phaseDuration: 0.45, outcome, boxX }));
      assert.equal(entered.inBox, true);
      assert.equal(entered.occlusion, 1);
      near(entered.x + entered.width / 2, boxX + 60);
      assert.equal(entered.y, 650);
      assert.ok(entered.y + entered.height * 0.6 < 930 && entered.y + entered.height * 0.9 > 1000, 'source eyes stay above the rim; source feet are behind the front wall');
      assert.equal(entered.alpha, 1, 'entry remains visible before the encounter exits');
    }
  }
  for (const time of [0, 0.05, 0.10, 0.20, 0.29]) {
    const landed = boxCatPose(input({ phase: 'REACTION', phaseTime: time, phaseDuration: 0.45 }));
    assert.equal(landed.inBox, false);
    assert.equal(landed.occlusion, 0);
    near(landed.y + landed.height, 1140);
  }
});

test('02 the landing shadow stays on the floor while the cat rises and enters', () => {
  for (const outcome of ['SUCCESS', 'EARLY', 'MISS'] as const) {
    for (const phase of ['APPROACH', 'CROUCH', 'JUMP', 'REACTION']) {
      for (const phaseTime of [0, 0.15, 0.3, 0.45, 0.6]) {
        const pose = boxCatPose(input({ phase, phaseTime, phaseDuration: phase === 'REACTION' ? 0.45 : 0.6, outcome }));
        assert.equal(pose.shadowY, 1144);
        assert.ok(pose.shadowScale >= 0.54 && pose.shadowScale <= 1);
      }
    }
  }
  assert.ok(boxCatPose(input()).shadowScale < boxCatPose(input({ phaseTime: 0 })).shadowScale);
});

test('02 encounter resets are hidden by one actor fading out then in; initial ready stays visible', () => {
  for (const outcome of ['SUCCESS', 'EARLY', 'MISS'] as const) {
    const end = boxCatPose(input({ phase: 'REACTION', phaseTime: 0.45, phaseDuration: 0.45, outcome }));
    const next = boxCatPose(input({ phase: 'APPROACH', phaseTime: 0, phaseDuration: 1.1, spawnFade: true }));
    assert.equal(end.alpha, 0);
    assert.equal(next.alpha, 0);
    assert.equal(end.returnProgress, 1);
  }
  const ready = boxCatPose(input({ phase: 'APPROACH', phaseTime: 0, phaseDuration: 1.1, spawnFade: true, ready: true }));
  assert.equal(ready.alpha, 1);
  const appeared = boxCatPose(input({ phase: 'APPROACH', phaseTime: 0.12, phaseDuration: 1.1, spawnFade: true }));
  assert.equal(appeared.alpha, 1);
});
