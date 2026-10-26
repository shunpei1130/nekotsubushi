import { W, type EncounterOutcome } from './engine';

export interface BoxCatPoseInput {
  phase: string;
  /** Seconds within the engine phase, independent of rendering FPS. */
  phaseTime: number;
  phaseDuration: number;
  outcome: EncounterOutcome;
  boxX: number;
  /** Compatibility only: reference capture uses the same trajectory, without overrides. */
  fixture?: boolean;
  /** Keep the initial ready cat visible before the first clock-starting tap. */
  ready?: boolean;
  /** Fade a new encounter in after the previous reaction has faded fully out. */
  spawnFade?: boolean;
}

export interface BoxCatPose {
  /** Full, untrimmed 1254-square source canvas placement in 941×1672 art coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  texture: 'idle' | 'jump';
  inBox: boolean;
  /** 0→1 progress into the opening; use the actual box-front layer for occlusion. */
  occlusion: number;
  shadowX: number;
  shadowY: number;
  shadowScale: number;
  airborne: boolean;
  alpha: number;
  /** Last 150ms of a reaction: single actor fades away, never two faces crossfading. */
  returnProgress: number;
}

const clamp = (value: number, low = 0, high = 1) => Math.max(low, Math.min(high, value));
const mix = (a: number, b: number, amount: number) => a + (b - a) * amount;
const smooth = (amount: number) => {
  const t = clamp(amount);
  return t * t * (3 - 2 * t);
};
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;
const GROUND = { x: 10, y: 530, width: 635, height: 610 };
const FOOT_Y = GROUND.y + GROUND.height;
const FLOOR_Y = 1144;

/**
 * Mode 02 presentation only. It never advances an encounter, changes its outcome,
 * or awards points. All undecided/successful jumps share a path, so a successful
 * swipe at any point in the 520ms window cannot teleport the cat sideways.
 * The outcome is resolved visually during the first 220ms of REACTION.
 */
export function boxCatPose(input: BoxCatPoseInput): BoxCatPose {
  const time = Math.max(0, finite(input.phaseTime, 0));
  const boxX = finite(input.boxX, W / 2);
  const earlyOffset = input.outcome === 'EARLY' ? clamp(boxX - W / 2, -W * 0.28, W * 0.28) : 0;
  const pose: BoxCatPose = {
    ...GROUND,
    rotation: 0,
    texture: 'idle',
    inBox: false,
    occlusion: 0,
    shadowX: GROUND.x + GROUND.width * 0.52,
    shadowY: FLOOR_Y,
    shadowScale: 1,
    airborne: false,
    alpha: 1,
    returnProgress: 0,
  };

  if (input.phase === 'APPROACH') {
    const duration = Math.max(0.001, finite(input.phaseDuration, 1.2));
    const u = clamp(time / duration);
    pose.x = mix(-26, GROUND.x, smooth(u));
    // Subtle foot-planted weight changes; the tail/ears remain the renderer's rig.
    const step = Math.sin(u * Math.PI * 4) ** 2 * 4;
    pose.height = GROUND.height - step;
    pose.y = FOOT_Y - pose.height;
    pose.shadowX = pose.x + pose.width * 0.52;
    if (input.spawnFade && !input.ready) pose.alpha = smooth(time / 0.12);
    return pose;
  }

  if (input.phase === 'CROUCH') {
    const u = clamp(time / 0.45);
    const anticipation = Math.sin(u * Math.PI) ** 2;
    pose.width += 24 * anticipation;
    pose.height -= 40 * anticipation;
    pose.x -= 12 * anticipation;
    pose.y = FOOT_Y - pose.height;
    return pose;
  }

  if (input.phase === 'JUMP') {
    const u = clamp(time / 0.6);
    const lift = Math.sin(u * Math.PI);
    pose.texture = 'jump';
    pose.x += earlyOffset * smooth(u);
    // At 300ms this is exactly x10,y300,w635,h610: the normal reference pose.
    pose.y -= 230 * lift;
    pose.shadowX = pose.x + pose.width * 0.52;
    pose.shadowScale = 1 - 0.35 * lift;
    pose.airborne = u > 0 && u < 1;
    return pose;
  }

  if (input.phase === 'REACTION') {
    const duration = Math.max(0.001, finite(input.phaseDuration, 0.45));
    const reactionTime = clamp(time / duration) * 0.45;
    const entering = input.outcome !== 'SUCCESS';
    if (entering) {
      const enter = smooth(reactionTime / 0.22);
      // The source canvas has transparent space above the head. Place the eyes
      // above the near rim while keeping all four feet behind the front wall.
      const target = { x: boxX + 60 - 220, y: 650, width: 440, height: 430 };
      pose.x = mix(GROUND.x + earlyOffset, target.x, enter);
      pose.y = mix(GROUND.y, target.y, enter);
      pose.width = mix(GROUND.width, target.width, enter);
      pose.height = mix(GROUND.height, target.height, enter);
      pose.rotation = -0.025 * Math.sin(enter * Math.PI);
      pose.texture = reactionTime < 0.22 ? 'jump' : 'idle';
      pose.occlusion = enter;
      pose.inBox = enter > 0;
      pose.shadowX = mix(GROUND.x + earlyOffset + GROUND.width * 0.52, boxX + 60, enter);
      pose.shadowScale = mix(1, 0.54, enter);
    } else {
      const contact = reactionTime < 0.20 ? Math.sin(reactionTime / 0.20 * Math.PI) ** 2 : 0;
      pose.width += GROUND.width * 0.025 * contact;
      pose.height -= GROUND.height * 0.065 * contact;
      pose.x -= (pose.width - GROUND.width) / 2;
      pose.y = FOOT_Y - pose.height;
      pose.texture = reactionTime < 0.06 ? 'jump' : 'idle';
    }
    pose.returnProgress = smooth((reactionTime - 0.30) / 0.15);
    pose.alpha = 1 - pose.returnProgress;
    return pose;
  }

  return pose;
}
