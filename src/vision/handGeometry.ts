import { GESTURE, LM, type Vec2 } from "../state/types";

export type Landmark = { x: number; y: number; z: number };
export type Hand = Landmark[];

/**
 * Midpoint of the palm. Averaging the wrist with the knuckles evenly drags the
 * point down toward the heel of the hand, so the ball sits noticeably lower
 * than where you feel your palm to be. Weighting the knuckles higher puts it
 * where the hand looks centred.
 */
export function palmCenter(hand: Hand): Vec2 {
  const knuckles = [LM.indexMCP, LM.middleMCP, LM.ringMCP, LM.littleMCP];
  let kx = 0;
  let ky = 0;
  for (const i of knuckles) {
    kx += hand[i].x;
    ky += hand[i].y;
  }
  kx /= knuckles.length;
  ky /= knuckles.length;

  const wrist = hand[LM.wrist];
  const wristWeight = 0.3;
  return {
    x: kx * (1 - wristWeight) + wrist.x * wristWeight,
    y: ky * (1 - wristWeight) + wrist.y * wristWeight,
  };
}

/** Normalized coordinates are not square, so x needs the aspect correction. */
export function separation(a: Vec2, b: Vec2, imageAspect: number): number {
  const dx = (a.x - b.x) * imageAspect;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function pinchDistance(hand: Hand, imageAspect: number): number {
  return separation(hand[LM.thumbTip], hand[LM.indexTip], imageAspect);
}

/** Where a pinch actually happens: between the thumb and index tips. */
export function pinchPoint(hand: Hand): Vec2 {
  const thumb = hand[LM.thumbTip];
  const index = hand[LM.indexTip];
  return { x: (thumb.x + index.x) / 2, y: (thumb.y + index.y) / 2 };
}

/** 0 when the hand is open, 1 when the fingers have closed on each other. */
export function pinchStrength(pinch: number): number {
  const { pinchAnchorTight, pinchAnchorOpen } = GESTURE;
  const t = (pinchAnchorOpen - pinch) / (pinchAnchorOpen - pinchAnchorTight);
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/**
 * The point the ball should sit on. Open hand means the palm; as the fingers
 * close the anchor slides out to the pinch itself, so a pinched ball is held
 * between your fingertips rather than hovering over your palm.
 *
 * A fist is excluded on purpose. Curling the hand puts the thumb tip right
 * beside the index tip, which reads as a hard pinch, and the anchor would snap
 * to the knuckles every time you made a fist. Fists mean carry and power, not
 * pinch, so they keep the palm anchor.
 */
export function handAnchor(hand: Hand, imageAspect: number, fisted: boolean): Vec2 {
  const palm = palmCenter(hand);
  if (fisted) return palm;
  const t = pinchStrength(pinchDistance(hand, imageAspect));
  if (t <= 0) return palm;
  const tip = pinchPoint(hand);
  return {
    x: palm.x + (tip.x - palm.x) * t,
    y: palm.y + (tip.y - palm.y) * t,
  };
}

/** A finger counts as curled when its tip sits closer to the wrist than its knuckle. */
export function isFist(hand: Hand, imageAspect: number): boolean {
  const wrist = hand[LM.wrist];
  const pairs: [number, number][] = [
    [LM.indexTip, LM.indexMCP],
    [LM.middleTip, LM.middleMCP],
    [LM.ringTip, LM.ringMCP],
    [LM.littleTip, LM.littleMCP],
  ];
  let curled = 0;
  for (const [tip, mcp] of pairs) {
    const tipDist = separation(hand[tip], wrist, imageAspect);
    const mcpDist = separation(hand[mcp], wrist, imageAspect);
    if (tipDist < mcpDist * 1.08) curled += 1;
  }
  return curled >= 3;
}

/** Fist curl as a 0..1 score, used as a classifier feature. */
export function fistCurlScore(hand: Hand, imageAspect: number): number {
  const wrist = hand[LM.wrist];
  const pairs: [number, number][] = [
    [LM.indexTip, LM.indexMCP],
    [LM.middleTip, LM.middleMCP],
    [LM.ringTip, LM.ringMCP],
    [LM.littleTip, LM.littleMCP],
  ];
  let score = 0;
  for (const [tip, mcp] of pairs) {
    const tipDist = separation(hand[tip], wrist, imageAspect);
    const mcpDist = separation(hand[mcp], wrist, imageAspect);
    score += Math.max(0, Math.min(1, 1 - tipDist / (mcpDist * 1.6)));
  }
  return score / pairs.length;
}

/**
 * True when smoothing would teleport rather than glide. The clap detector needs
 * to know: a hand being re-acquired somewhere else looks exactly like an
 * enormous closing speed, and that is a false clap waiting to happen.
 */
export function isSnap(prev: Vec2 | null, next: Vec2): boolean {
  if (!prev) return true;
  return Math.hypot(next.x - prev.x, next.y - prev.y) > GESTURE.smoothingJumpCutoff;
}

/** Exponential smoothing that snaps instead of gliding on large jumps. */
export function smooth(prev: Vec2 | null, next: Vec2, factor: number): Vec2 {
  if (!prev) return next;
  const jump = Math.hypot(next.x - prev.x, next.y - prev.y);
  if (jump > GESTURE.smoothingJumpCutoff) return next;
  return {
    x: prev.x + (next.x - prev.x) * factor,
    y: prev.y + (next.y - prev.y) * factor,
  };
}

export function smoothScalar(prev: number | null, next: number, factor: number): number {
  if (prev === null) return next;
  if (Math.abs(next - prev) > GESTURE.smoothingJumpCutoff) return next;
  return prev + (next - prev) * factor;
}

export function pinchToScale(pinch: number): number {
  const { pinchMinDistance, pinchMaxDistance, scaleBase, scaleRange } = GESTURE;
  const norm = Math.max(
    0,
    Math.min(1, (pinch - pinchMinDistance) / (pinchMaxDistance - pinchMinDistance)),
  );
  return scaleBase + norm * scaleRange;
}
