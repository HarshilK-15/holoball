import { GESTURE, LM, type Vec2 } from "../state/types";

export type Landmark = { x: number; y: number; z: number };
export type Hand = Landmark[];

export function palmCenter(hand: Hand): Vec2 {
  const pts = [LM.wrist, LM.indexMCP, LM.middleMCP, LM.ringMCP, LM.littleMCP];
  let x = 0;
  let y = 0;
  for (const i of pts) {
    x += hand[i].x;
    y += hand[i].y;
  }
  return { x: x / pts.length, y: y / pts.length };
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
