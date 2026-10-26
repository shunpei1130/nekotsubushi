/** All coordinates are in the original 941 × 1672 art space; times are seconds. */
export const W = 941;
export const H = 1672;
export type GameStatus = 'ready' | 'playing' | 'paused' | 'result';
export type EncounterOutcome = 'PENDING' | 'SUCCESS' | 'EARLY' | 'MISS';
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const tenth = (s: number) => Math.floor((s + 1e-9) * 10) / 10;

export class GameEngine {
  readonly mode: number;
  status: GameStatus = 'ready';
  phase = 'READY';
  score = 0;
  best = 0;
  elapsed = 0;
  remaining = 0;
  hold = 0;
  success = false;
  message = '';
  catX = 0.76 * W;
  catY = 0.38 * H;
  toyX = 0.9 * W;
  toyY = 0.18 * H;
  boxX = 0.5 * W;
  cheekX = 0;
  cheekY = 0;
  cheekSide: 'left' | 'right' = 'right';
  cheekAnchorX = 737;
  cheekAnchorY = 871;
  effect = 0;
  phaseTime = 0;
  phaseDuration = 0;
  punchAt = 0;
  encounterOutcome: EncounterOutcome = 'PENDING';
  currentHat: 'banana' | 'fish' = 'banana';
  pointerId: number | null = null;
  pointerX = 0;
  pointerY = 0;
  /** Public calibration data used by both rendering and collision. */
  readonly featherOffset = { x: -40, y: 150 };
  readonly captureDistance = 0.10 * W;
  readonly toyBounds = { left: 90, right: 0.92 * W, top: 0.18 * H, bottom: 0.86 * H };
  private rng: number;
  private readonly seed: number;
  private clock = 0;
  private lastCandidate = -Infinity;
  private downClock = 0;
  private downX = 0;
  private downY = 0;
  private maxMove = 0;
  private cssScale = 1;
  private tapCandidate = false;
  private downPhase = '';
  private dragStarted = false;
  private dragWasAirborne = false;
  private dragBaseX = 0;
  private dragBaseY = 0;
  private targetToyX = this.toyX;
  private targetToyY = this.toyY;
  private springX = 0;
  private springY = 0;
  private resumeDelay = 0;
  private resumeToy = false;
  private pausedFrom: GameStatus = 'playing';

  constructor(mode: number, config: { seed?: number; best?: number } = {}) {
    if (!Number.isInteger(mode) || mode < 1 || mode > 6) throw new Error('Unknown game mode');
    this.mode = mode;
    this.seed = config.seed ?? 627041;
    this.rng = this.seed;
    this.best = Math.max(0, config.best ?? 0);
    this.reset();
  }

  private random() {
    this.rng = (Math.imul(1664525, this.rng) + 1013904223) >>> 0;
    return this.rng / 4294967296;
  }

  private enter(phase: string, duration = Infinity) {
    this.phase = phase;
    this.phaseTime = 0;
    this.phaseDuration = duration;
  }

  private closed() {
    this.enter('CLOSED', 1.4 + this.random() * 0.8);
    this.message = '目を閉じている間につんつん';
  }

  private encounter() {
    this.boxX = 0.5 * W;
    this.encounterOutcome = 'PENDING';
    this.dragStarted = false;
    this.dragWasAirborne = false;
    this.enter('APPROACH', 0.9 + this.random() * 0.6);
    this.message = '飛び込むまで待って…';
  }

  reset() {
    this.rng = this.seed;
    this.status = this.mode === 5 ? 'playing' : 'ready';
    this.score = this.elapsed = this.hold = this.effect = 0;
    this.success = false;
    this.message = '';
    this.remaining = this.mode === 1 || this.mode === 2 ? 30 : this.mode === 4 || this.mode === 6 ? 15 : 0;
    this.pointerId = null;
    this.tapCandidate = false;
    this.resumeDelay = 0;
    this.resumeToy = false;
    this.lastCandidate = -Infinity;
    this.clock = 0;
    this.catX = 0.76 * W;
    this.catY = 0.38 * H;
    this.toyX = this.targetToyX = 0.90 * W;
    this.toyY = this.targetToyY = 0.18 * H;
    this.boxX = 0.50 * W;
    this.cheekX = this.cheekY = 0;
    this.cheekAnchorX = 737;
    this.cheekAnchorY = 871;
    this.currentHat = 'banana';
    this.punchAt = 0;
    if (this.mode === 1) this.closed();
    if (this.mode === 2) this.encounter();
    if (this.mode === 3) this.enter('READY');
    if (this.mode === 4) this.enter('BARE');
    if (this.mode === 5) this.enter('IDLE');
    if (this.mode === 6) this.enter('READY');
  }

  private clearPointer() {
    this.pointerId = null;
    this.tapCandidate = false;
    this.dragStarted = false;
  }

  private hit(x: number, y: number) {
    if (this.mode === 1) return x >= 70 && x <= 870 && y >= 350 && y <= 1370;
    if (this.mode === 2) return Math.abs(x - this.boxX) <= Math.max(280, 22 / this.cssScale) && y >= 820 && y <= 1260;
    if (this.mode === 3) return x >= 230 && x <= 800 && y >= 600 && y <= 1400;
    if (this.mode === 4) return x >= 160 && x <= 890 && y >= 330 && y <= 1470;
    if (this.mode === 5) return y >= 700 && y <= 1130 && (x <= 280 || x >= 540);
    return Math.hypot(x - this.toyX, y - this.toyY) <= Math.max(78, 24 / this.cssScale);
  }

  /** Return true only when the caller should capture this pointer. */
  down(x: number, y: number, pointerId = 1, cssScale = 1) {
    if (this.pointerId !== null || this.status === 'paused' || this.status === 'result' || this.resumeDelay > 0) return false;
    this.cssScale = Math.max(0.05, cssScale);
    if (!this.hit(x, y)) return false;
    this.pointerId = pointerId;
    this.pointerX = this.downX = x;
    this.pointerY = this.downY = y;
    this.downClock = this.clock;
    this.downPhase = this.phase;
    this.maxMove = 0;
    this.dragStarted = false;
    this.dragBaseX = this.mode === 2 ? this.boxX : this.mode === 5 ? Math.atanh(clamp(this.cheekX / (0.16 * W), -0.999999, 0.999999)) * 0.16 * W : this.toyX;
    this.dragBaseY = this.mode === 5 ? Math.atanh(clamp(this.cheekY / (0.06 * H), -0.999999, 0.999999)) * 0.06 * H : this.toyY;
    this.tapCandidate = this.clock - this.lastCandidate >= 0.15 - 1e-9;
    if (this.tapCandidate) this.lastCandidate = this.clock;

    if (this.mode === 1 && this.status === 'playing' && this.phase === 'OPEN') this.caught();
    if (this.mode === 3) {
      this.status = 'playing';
      this.elapsed = this.hold = 0;
      this.punchAt = 3.2 + this.random() * 2;
      this.enter('HOLDING', this.punchAt - 0.65);
      this.message = '前足が上がったら、そろそろ離して';
    }
    if (this.mode === 5) {
      this.cheekSide = x < 400 ? 'left' : 'right';
      this.cheekAnchorX = clamp(x, this.cheekSide === 'left' ? 40 : 540, this.cheekSide === 'left' ? 280 : 820);
      this.cheekAnchorY = clamp(y, 760, 1100);
      this.enter('DRAGGING');
      this.message = 'むに〜';
    }
    if (this.mode === 6) {
      this.status = 'playing';
      this.resumeToy = false;
      this.enter('PLAYING');
      this.targetToyX = this.toyX;
      this.targetToyY = this.toyY;
      this.message = '指で動かして、つかまるな！';
    }
    return true;
  }

  move(x: number, y: number) {
    if (this.pointerId === null || this.status === 'paused' || this.status === 'result') return;
    this.pointerX = x;
    this.pointerY = y;
    const dx = x - this.downX, dy = y - this.downY;
    this.maxMove = Math.max(this.maxMove, Math.hypot(dx, dy) * this.cssScale);
    if (this.maxMove > 12) this.tapCandidate = false;
    if (this.mode === 2 && this.status === 'playing' && this.encounterOutcome === 'PENDING') {
      if (!this.dragStarted && Math.abs(dx) * this.cssScale >= 12 && Math.abs(dx) >= Math.abs(dy)) {
        this.dragStarted = true;
        this.dragWasAirborne = this.phase === 'JUMP';
        if (!this.dragWasAirborne) {
          this.encounterOutcome = 'EARLY';
          this.message = '早かったニャ';
        }
      }
      if (this.dragStarted) {
        this.boxX = clamp(this.dragBaseX + dx, 0.22 * W, 0.78 * W);
        if (this.dragWasAirborne && this.phase === 'JUMP' && this.phaseTime <= 0.52 + 1e-9 && Math.abs(this.boxX - 0.5 * W) >= 0.22 * W - 1e-9) {
          this.encounterOutcome = 'SUCCESS';
          this.boxX = 0.5 * W + Math.sign(dx) * 0.25 * W;
          this.score++;
          this.effect = 0.65;
          this.message = 'スカッ！';
        }
      }
    } else if (this.mode === 2 && this.encounterOutcome === 'EARLY' && this.dragStarted) {
      this.boxX = clamp(this.dragBaseX + dx, 0.22 * W, 0.78 * W);
    } else if (this.mode === 5) {
      // Soft saturation bounds the mesh without any discontinuity near its limit.
      this.cheekX = 0.16 * W * Math.tanh((this.dragBaseX + dx) / (0.16 * W));
      this.cheekY = 0.06 * H * Math.tanh((this.dragBaseY + dy) / (0.06 * H));
    } else if (this.mode === 6) {
      this.targetToyX = clamp(this.dragBaseX + dx, this.toyBounds.left, this.toyBounds.right);
      this.targetToyY = clamp(this.dragBaseY + dy, this.toyBounds.top, this.toyBounds.bottom);
    }
  }

  up(x = this.pointerX, y = this.pointerY) {
    if (this.pointerId === null) return false;
    this.move(x, y);
    const tap = this.tapCandidate && this.clock - this.downClock <= 0.3 + 1e-9 && this.maxMove <= 12;
    const pressedPhase = this.downPhase;
    this.clearPointer();
    if (this.status === 'paused' || this.status === 'result') return false;
    if (this.mode === 1) {
      if (tap && (pressedPhase === 'CLOSED' || pressedPhase === 'WARNING') && ['CLOSED', 'WARNING', 'OPEN_GRACE'].includes(this.phase)) {
        this.status = 'playing';
        this.score++;
        this.effect = 0.32;
        this.message = '+1';
        return true;
      }
    } else if (this.mode === 2) {
      if (this.status === 'ready' && tap) {
        this.status = 'playing';
        return true;
      }
      if (this.encounterOutcome === 'PENDING' && this.dragWasAirborne) this.encounterOutcome = 'MISS';
    } else if (this.mode === 3 && this.status === 'playing') {
      if (this.hold < 0.2 - 1e-9) {
        this.status = 'ready';
        this.elapsed = this.hold = 0;
        this.enter('READY');
      } else if (this.hold < this.punchAt) {
        this.score = tenth(this.hold);
        this.best = Math.max(this.best, this.score);
        this.success = true;
        this.enter('SUCCESS');
        this.status = 'result';
        this.effect = 0.6;
        this.message = '寸止め成功！';
        return true;
      }
    } else if (this.mode === 4) {
      if (tap && pressedPhase === 'BARE' && this.phase === 'BARE') {
        this.status = 'playing';
        this.score++;
        this.currentHat = this.score % 2 ? 'banana' : 'fish';
        this.enter('PUTTING_ON', 0.08);
        this.effect = 0.6;
        this.message = '+1';
        return true;
      }
    } else if (this.mode === 5) {
      this.springBack();
    } else if (this.mode === 6) {
      // Releasing stops the wand but does not stop the game clock or cat.
      this.targetToyX = this.toyX;
      this.targetToyY = this.toyY;
    }
    return false;
  }

  private caught() {
    this.tapCandidate = false;
    this.enter('CAUGHT', 1.5);
    this.effect = 0.45;
    this.message = '見つかったニャ！';
  }

  private springBack() {
    this.springX = this.cheekX;
    this.springY = this.cheekY;
    this.enter('SPRING_BACK', 0.45);
    this.message = '';
  }

  cancel() {
    if (this.mode === 3) {
      if (this.status === 'result') { this.clearPointer(); return; }
      this.clearPointer();
      this.status = 'ready';
      this.hold = this.elapsed = 0;
      this.enter('READY');
      this.message = '長押しでちょっかい';
    } else if (this.mode === 5) {
      this.clearPointer();
      this.springBack();
    } else {
      this.pause();
    }
  }

  pause() {
    if (this.mode === 3 || this.mode === 5) { this.cancel(); return; }
    if (this.status === 'paused' || this.status === 'result') { this.clearPointer(); return; }
    if (this.mode === 2 && this.pointerId !== null && this.encounterOutcome === 'PENDING') this.encounter();
    this.clearPointer();
    this.pausedFrom = this.status;
    this.status = 'paused';
    if (this.mode === 6) {
      this.targetToyX = this.toyX;
      this.targetToyY = this.toyY;
    }
  }

  resume() {
    if (this.status !== 'paused') return;
    if (this.mode === 6) {
      this.status = 'ready';
      this.resumeToy = true;
      this.message = '輪に触れてつづける';
    } else {
      this.status = this.pausedFrom;
      if (this.mode === 1 && this.status === 'playing') this.resumeDelay = 0.4;
    }
  }

  private finish(success = true) {
    this.success = success;
    if (this.mode === 6) this.score = tenth(this.elapsed);
    this.best = Math.max(this.best, this.score);
    this.status = 'result';
    this.clearPointer();
    this.message = this.mode === 6 ? success ? '逃げきったニャ！' : 'つかまえたニャ！' : 'おつかれさまニャ！';
    if (this.mode === 6) this.phase = success ? 'CLEAR' : 'CAPTURED';
  }

  /** Caller supplies performance.now() deltas after removing background time. */
  update(dtMs: number) {
    if (!Number.isFinite(dtMs) || dtMs <= 0 || this.status === 'paused' || this.status === 'result') return;
    let dt = dtMs / 1000;
    this.clock += dt;
    if (this.resumeDelay > 0) {
      const used = Math.min(this.resumeDelay, dt);
      this.resumeDelay -= used;
      dt -= used;
    }
    // Short integration steps make collision and boundary ordering independent of render FPS.
    while (dt > 1e-9 && this.status === 'playing') {
      const budget = this.mode === 1 || this.mode === 2 ? 30 : this.mode === 4 || this.mode === 6 ? 15 : Infinity;
      const step = Math.min(dt, 0.008, Math.max(0, budget - this.elapsed));
      if (step <= 1e-9) { this.remaining = 0; this.finish(true); break; }
      this.effect = Math.max(0, this.effect - step);
      if (this.mode !== 5) this.elapsed += step;
      this.phaseTime += step;
      this.remaining = Number.isFinite(budget) ? Math.max(0, budget - this.elapsed) : 0;
      if (this.mode === 1) this.stepEyes();
      if (this.mode === 2) this.stepBox();
      if (this.mode === 3) this.stepPunch();
      if (this.mode === 4) this.stepHat();
      if (this.mode === 5) this.stepCheeks();
      if (this.mode === 6) this.stepToy(step);
      if (this.status === 'playing' && Number.isFinite(budget) && this.elapsed >= budget - 1e-9) {
        this.elapsed = budget;
        this.remaining = 0;
        this.finish(true);
      }
      dt -= step;
    }
  }

  private stepEyes() {
    if (this.phaseTime < this.phaseDuration - 1e-9) return;
    const overflow = this.phaseTime - this.phaseDuration;
    if (this.phase === 'CLOSED') { this.enter('WARNING', 0.5); this.message = 'そろそろ目を開けそう…'; }
    else if (this.phase === 'WARNING') this.enter('OPEN_GRACE', 0.12);
    else if (this.phase === 'OPEN_GRACE') {
      this.enter('OPEN', 0.88 + this.random() * 0.4);
      this.message = '目が開いた！ 手を止めて';
      if (this.pointerId !== null) this.caught();
    } else if (this.phase === 'OPEN' || this.phase === 'CAUGHT') this.closed();
    this.phaseTime += overflow;
  }

  private stepBox() {
    if (this.phase === 'JUMP' && this.phaseTime > 0.52 && this.encounterOutcome === 'PENDING') this.encounterOutcome = 'MISS';
    if (this.phaseTime < this.phaseDuration - 1e-9) return;
    const overflow = this.phaseTime - this.phaseDuration;
    if (this.phase === 'APPROACH') { this.enter('CROUCH', 0.45); this.message = '構えた…'; }
    else if (this.phase === 'CROUCH') { this.enter('JUMP', 0.6); this.message = this.encounterOutcome === 'EARLY' ? '早かったニャ' : 'いま！ 箱をスワイプ'; }
    else if (this.phase === 'JUMP') {
      if (this.encounterOutcome === 'PENDING') this.encounterOutcome = 'MISS';
      this.enter('REACTION', 0.45);
      this.message = this.encounterOutcome === 'SUCCESS' ? 'スカッ！' : '入れたニャ';
    } else if (this.phase === 'REACTION') { this.clearPointer(); this.encounter(); }
    this.phaseTime += overflow;
  }

  private stepPunch() {
    this.hold = this.elapsed;
    if (this.hold >= this.punchAt - 1e-9) {
      this.hold = this.punchAt;
      this.enter('PUNCH');
      this.status = 'result';
      this.success = false;
      this.score = 0;
      this.effect = 0.7;
      this.message = '猫パンチ！ 次は少し早めに';
      this.clearPointer();
    } else if (this.hold >= this.punchAt - 0.65 - 1e-9 && this.phase !== 'WARNING') {
      this.enter('WARNING', 0.65);
      this.phaseTime = this.hold - (this.punchAt - 0.65);
      this.message = 'パンチが来る！ 離して！';
    }
  }

  private stepHat() {
    if (this.phaseTime < this.phaseDuration - 1e-9) return;
    const overflow = this.phaseTime - this.phaseDuration;
    if (this.phase === 'PUTTING_ON') this.enter('WEARING', 0.42 + this.random() * 0.5);
    else if (this.phase === 'WEARING') { this.enter('REMOVING', 0.1); this.message = 'いやニャ〜'; }
    else if (this.phase === 'REMOVING') { this.enter('BARE'); this.message = 'いま！ またかぶせて'; }
    this.phaseTime += overflow;
  }

  private stepCheeks() {
    if (this.phase !== 'SPRING_BACK') return;
    const t = clamp(this.phaseTime / 0.45, 0, 1);
    // A single small overshoot; completely settled at 450ms, independent of FPS.
    const curve = (1 - t) ** 2 * Math.cos(t * Math.PI * 1.15);
    this.cheekX = this.springX * curve;
    this.cheekY = this.springY * curve;
    if (t === 1) { this.cheekX = this.cheekY = 0; this.enter('IDLE'); }
  }

  private stepToy(dt: number) {
    const previousToyX = this.toyX, previousToyY = this.toyY;
    const dx = this.targetToyX - this.toyX, dy = this.targetToyY - this.toyY;
    const d = Math.hypot(dx, dy), move = Math.min(d, 2.5 * W * dt);
    if (d > 0) { this.toyX += dx / d * move; this.toyY += dy / d * move; }
    const fx = this.toyX + this.featherOffset.x, fy = this.toyY + this.featherOffset.y;
    const px = this.catX, py = this.catY;
    const cx = fx - px, cy = fy - py, cd = Math.hypot(cx, cy);
    const catMove = Math.min(cd, (0.55 + 0.30 * this.elapsed / 15) * W * dt);
    if (cd > 0) { this.catX += cx / cd * catMove; this.catY += cy / cd * catMove; }
    // Relative swept segment detects contact even if toy crosses a paw in one step.
    const ax = previousToyX + this.featherOffset.x - px;
    const ay = previousToyY + this.featherOffset.y - py;
    const bx = fx - this.catX, by = fy - this.catY;
    const vx = bx - ax, vy = by - ay;
    const aa = vx * vx + vy * vy;
    const bb = 2 * (ax * vx + ay * vy);
    const cc = ax * ax + ay * ay - this.captureDistance ** 2;
    let contact = Infinity;
    if (cc <= 0) contact = 0;
    else if (aa > 0) {
      const disc = bb * bb - 4 * aa * cc;
      if (disc >= 0) {
        const t = (-bb - Math.sqrt(disc)) / (2 * aa);
        if (t >= 0 && t <= 1) contact = t;
      }
    }
    if (contact !== Infinity) {
      const contactTime = this.elapsed - dt + dt * contact;
      if (contactTime < 15 - 1e-9) {
        this.elapsed = contactTime;
        this.remaining = 15 - contactTime;
        this.effect = 0.7;
        this.finish(false);
      }
    } else if (cd < W * 0.22) {
      this.message = 'おしい！';
    }
  }

  /** Reference pose injected into the same live renderer, never a screenshot substitute. */
  fixture() {
    this.reset();
    this.status = 'playing';
    this.effect = 0.25;
    if (this.mode === 1) { this.elapsed = 12; this.remaining = 18; this.score = 12; this.phase = 'CLOSED'; this.message = '+1'; this.pointerX = 687; this.pointerY = 752; }
    if (this.mode === 2) { this.elapsed = 18; this.remaining = 12; this.score = 7; this.phase = 'JUMP'; this.phaseDuration = 0.6; this.phaseTime = 0.3; this.encounterOutcome = 'SUCCESS'; this.boxX = 0.75 * W; this.message = 'スカッ！'; }
    if (this.mode === 3) { this.elapsed = this.hold = 2.8; this.best = 4.2; this.punchAt = 3.2; this.phase = 'WARNING'; this.phaseTime = 0.25; this.phaseDuration = 0.65; this.pointerX = 461; this.pointerY = 853; }
    if (this.mode === 4) { this.elapsed = 6; this.remaining = 9; this.score = 8; this.phase = 'WEARING'; this.phaseDuration = 0.7; this.currentHat = 'banana'; this.message = '+1'; }
    if (this.mode === 5) { this.phase = 'DRAGGING'; this.cheekSide = 'right'; this.cheekX = 0.16 * W; this.cheekY = 0; this.pointerX = 0.94 * W; this.pointerY = 0.52 * H; this.message = 'むに〜'; }
    if (this.mode === 6) { this.elapsed = 9; this.remaining = 6; this.phase = 'PLAYING'; this.message = 'おしい！'; }
    return this;
  }

  snapshot() {
    return { mode: this.mode, status: this.status, phase: this.phase, score: this.score, best: this.best, elapsed: this.elapsed, remaining: this.remaining, hold: this.hold, success: this.success, boxX: this.boxX, encounterOutcome: this.encounterOutcome, catX: this.catX, catY: this.catY, toyX: this.toyX, toyY: this.toyY, cheekX: this.cheekX, cheekY: this.cheekY, cheekSide: this.cheekSide, cheekAnchorX: this.cheekAnchorX, cheekAnchorY: this.cheekAnchorY, currentHat: this.currentHat, phaseTime: this.phaseTime, phaseDuration: this.phaseDuration, punchAt: this.punchAt, effect: this.effect, pointerId: this.pointerId, message: this.message };
  }
}
