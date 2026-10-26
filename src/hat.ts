export type HatKind = 'banana' | 'fish';

export interface HatPose {
  /** Position of source pixel (800,750), in the logical 941×1672 stage. */
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
}

export interface HatFrame {
  worn: HatKind | null;
  head: { kind: HatKind; visible: boolean; pose: HatPose };
  floor: Record<HatKind, { visible: boolean; pose: HatPose }>;
  falling: { kind: HatKind; progress: number; pose: HatPose }[];
}

interface HatInput {
  phase: string;
  phaseTime: number;
  currentHat: HatKind;
  score: number;
  status: string;
}

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const ease = (v: number) => { const t = clamp(v); return t * t * (3 - 2 * t); };
const mix = (a: number, b: number, t: number) => a + (b - a) * t;
const at = (x: number, y: number, width: number, height: number): HatPose => ({
  x: x + 800 * width / 1536,
  y: y + 750 * height / 1024,
  width, height, rotation: 0,
});

export const hatFloorPose = (kind: HatKind): HatPose => kind === 'fish'
  ? at(-45, 902, 292, 220)
  : at(630, 1125, 292, 220);

export const hatHeadPose = (kind: HatKind): HatPose => kind === 'fish'
  ? at(245, 235, 525, 405)
  : at(275, 235, 555, 420);

function between(from: HatPose, to: HatPose, t: number): HatPose {
  return {
    x: mix(from.x, to.x, t), y: mix(from.y, to.y, t),
    width: mix(from.width, to.width, t), height: mix(from.height, to.height, t),
    rotation: mix(from.rotation, to.rotation, t),
  };
}

/**
 * Two physical props, independent of the scoring state. A detached banana can
 * finish its flight while the next tap takes the fish from the floor. Sampling
 * never advances the game clock or grants an extra hat/point.
 */
export class HatChoreography {
  private worn: HatKind | null = null;
  private releasedScore = -1;
  private lastScore = 0;
  private drops = new Map<HatKind, { started: number; from: HatPose }>();

  sample(input: HatInput, presentationTime: number): HatFrame {
    const now = Math.max(0, presentationTime);
    if (input.score < this.lastScore || (input.status === 'ready' && input.phase === 'BARE' && input.score === 0)) {
      this.worn = null;
      this.drops.clear();
      this.releasedScore = -1;
    }
    this.lastScore = input.score;

    const onHead = input.phase === 'PUTTING_ON' || input.phase === 'WEARING';
    // A large deterministic game-clock step may skip the 100ms REMOVING phase.
    // Retain the physical hat and start its flight on the first rendered BARE.
    if ((input.phase === 'REMOVING' || input.phase === 'BARE') && this.worn && this.releasedScore !== input.score) {
      this.drops.set(this.worn, { started: now, from: hatHeadPose(this.worn) });
      this.worn = null;
      this.releasedScore = input.score;
    }
    if (onHead) {
      if (this.worn && this.worn !== input.currentHat) {
        this.drops.set(this.worn, { started: now, from: hatHeadPose(this.worn) });
      }
      this.worn = input.currentHat;
      // Taking an already settled/in-flight prop cannot leave a duplicate below.
      this.drops.delete(input.currentHat);
    }

    const falling: HatFrame['falling'] = [];
    for (const [kind, drop] of this.drops) {
      const age = Math.max(0, now - drop.started);
      if (age >= 0.56) { this.drops.delete(kind); continue; }
      const target = hatFloorPose(kind);
      const flight = clamp(age / 0.44);
      const pose = between(drop.from, target, ease(flight));
      if (age < 0.44) {
        // A short upward toss followed by gravity, then one small plush bounce.
        pose.y = mix(drop.from.y, target.y, flight * flight) - 75 * Math.sin(Math.PI * flight);
        pose.rotation = (kind === 'banana' ? 0.5 : -0.5) * Math.sin(Math.PI * flight);
      } else {
        const settle = clamp((age - 0.44) / 0.12);
        pose.y -= 17 * Math.sin(Math.PI * settle) * (1 - settle);
      }
      falling.push({ kind, pose, progress: clamp(age / 0.56) });
    }

    let headPose = hatHeadPose(input.currentHat);
    if (input.phase === 'PUTTING_ON') {
      const lift = ease(input.phaseTime / 0.08);
      headPose = between(hatFloorPose(input.currentHat), headPose, lift);
      headPose.y -= 70 * Math.sin(Math.PI * lift);
    }
    return {
      worn: this.worn,
      head: { kind: input.currentHat, visible: onHead, pose: headPose },
      floor: {
        banana: { visible: this.worn !== 'banana' && !this.drops.has('banana'), pose: hatFloorPose('banana') },
        fish: { visible: this.worn !== 'fish' && !this.drops.has('fish'), pose: hatFloorPose('fish') },
      },
      falling,
    };
  }
}
