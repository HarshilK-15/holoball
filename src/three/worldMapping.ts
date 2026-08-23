import type { Vec2 } from "../state/types";

/**
 * Normalized hand coords to world space, compensating for the aspect-fill crop
 * of the video behind the canvas. Without this the ball drifts away from the
 * hand as the window aspect changes.
 */
export function worldPosition(
  norm: Vec2,
  viewAspect: number,
  imageAspect: number,
  depth: number,
  fovRadians: number,
): { x: number; y: number } {
  const halfHeight = Math.tan(fovRadians / 2) * depth;
  const halfWidth = halfHeight * viewAspect;

  let u = norm.x;
  let v = norm.y;

  if (imageAspect > viewAspect) {
    // Video is wider than the viewport, so the sides are cropped off.
    const visible = viewAspect / imageAspect;
    u = (u - 0.5) / visible + 0.5;
  } else {
    const visible = imageAspect / viewAspect;
    v = (v - 0.5) / visible + 0.5;
  }

  return {
    x: (u - 0.5) * 2 * halfWidth,
    y: -(v - 0.5) * 2 * halfHeight,
  };
}
