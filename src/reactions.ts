/** Bounded presentation only: never changes a collision point or game clock. */
export const reactionIds = [
  'cheek-right', 'cheek-left', 'cheek-up', 'cheek-down', 'cheek-inward', 'cheek-gentle',
  'streak-1', 'streak-2', 'close-3', 'rhythm-4', 'clear-6', 'personal-best',
] as const;
export type ReactionId = typeof reactionIds[number];
export interface ReactionFrame {
  id: ReactionId | null;
  active: boolean;
  age: number;
  duration: number;
  earLeft: number;
  earRight: number;
  closeLeft: boolean;
  closeRight: boolean;
}
const isReaction = (value: string): value is ReactionId => (reactionIds as readonly string[]).includes(value);
const window = (age: number, start: number, end: number) => age >= start && age < end;

/** Six real gesture responses share the stable face and registered eyelid art. */
export function reactionFrame(value: string | null, age: number, reduced = false): ReactionFrame {
  const id = value && isReaction(value) ? value : null;
  const duration = id === 'cheek-gentle' ? .65 : .56;
  const active = !!id && Number.isFinite(age) && age >= 0 && age < duration;
  const frame: ReactionFrame = {id,active,age,duration,earLeft:0,earRight:0,closeLeft:false,closeRight:false};
  if (!active) return frame;
  const pulse = reduced ? 0 : Math.sin(Math.PI * age / duration);
  const flick = reduced ? 0 : Math.sin(Math.PI * 3 * age / duration) * pulse;
  switch (id) {
    case 'cheek-right': frame.earRight = flick; frame.closeRight = window(age,.08,.25); break;
    case 'cheek-left': frame.earLeft = -flick; frame.closeLeft = window(age,.08,.25); break;
    case 'cheek-up': frame.earLeft = frame.earRight = -pulse; frame.closeLeft = frame.closeRight = window(age,.32,.43); break;
    case 'cheek-down': frame.earLeft = frame.earRight = pulse; frame.closeLeft = frame.closeRight = window(age,.07,.27); break;
    case 'cheek-inward': frame.earLeft = -flick; frame.earRight = flick; frame.closeLeft = window(age,.07,.20); frame.closeRight = window(age,.25,.38); break;
    case 'cheek-gentle': frame.earLeft = frame.earRight = pulse*.3; frame.closeLeft = frame.closeRight = window(age,.06,.56); break;
    case 'streak-1': frame.earLeft = -flick; frame.closeLeft = window(age,.10,.30); break;
    case 'streak-2': frame.earLeft = frame.earRight = -pulse; break;
    case 'close-3': frame.earRight = pulse*.45; break;
    case 'rhythm-4': frame.earLeft = -flick; frame.earRight = flick; break;
    case 'clear-6': frame.earLeft = -pulse; frame.earRight = pulse*.4; break;
    case 'personal-best': frame.earLeft = frame.earRight = -flick; frame.closeLeft = frame.closeRight = window(age,.18,.30); break;
  }
  if(reduced){frame.earLeft=0;frame.earRight=0;}
  return frame;
}

/** A small tip-only field keeps eyes, nose and skull fixed. */
export function earReactionOffset(nx: number, ny: number, frame: ReactionFrame) {
  if (!frame.active || ny > .28) return {x:0,y:0};
  const left = Math.exp(-(((nx-.17)/.16)**2 + ((ny-.11)/.15)**2)*2);
  const right = Math.exp(-(((nx-.77)/.15)**2 + ((ny-.12)/.15)**2)*2);
  const edge = Math.max(0, 1 - ny/.28);
  return {x:(left*frame.earLeft+right*frame.earRight)*5*edge,y:(left*frame.earLeft-right*frame.earRight)*3*edge};
}
