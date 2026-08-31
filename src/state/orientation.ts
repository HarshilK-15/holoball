import { LM } from "./types";

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const IDENTITY: Quat = { x: 0, y: 0, z: 0, w: 1 };

/**
 * MediaPipe world landmarks run x right, y down, z toward the camera. The
 * preview is mirrored and Three.js runs y up, so x and y both flip. Two sign
 * changes is a rotation by pi about z, which is a proper rotation, so the basis
 * built from transformed points stays right-handed and no handedness fix is
 * needed. If an axis ever reads inverted, flip signs in PAIRS: flipping one
 * turns this into a reflection and the rotation comes out mirrored.
 */
const AXIS = { x: -1, y: -1, z: 1 } as const;

export const mul = (a: Quat, b: Quat): Quat => ({
  x: a.x * b.w + a.w * b.x + a.y * b.z - a.z * b.y,
  y: a.y * b.w + a.w * b.y + a.z * b.x - a.x * b.z,
  z: a.z * b.w + a.w * b.z + a.x * b.y - a.y * b.x,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
});

/** Inverse of a unit quaternion. */
export const conj = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });

export function normalize(q: Quat): Quat {
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  return { x: q.x / l, y: q.y / l, z: q.z / l, w: q.w / l };
}

/** Shortest-arc interpolation. Negates one end when they point opposite ways. */
export function slerp(a: Quat, b: Quat, t: number): Quat {
  let dot = a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
  let e = b;
  if (dot < 0) {
    e = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
    dot = -dot;
  }
  if (dot > 0.9995) {
    return normalize({
      x: a.x + (e.x - a.x) * t,
      y: a.y + (e.y - a.y) * t,
      z: a.z + (e.z - a.z) * t,
      w: a.w + (e.w - a.w) * t,
    });
  }
  const theta = Math.acos(dot);
  const s = Math.sin(theta);
  const ka = Math.sin((1 - t) * theta) / s;
  const kb = Math.sin(t * theta) / s;
  return {
    x: a.x * ka + e.x * kb,
    y: a.y * ka + e.y * kb,
    z: a.z * ka + e.z * kb,
    w: a.w * ka + e.w * kb,
  };
}

export function fromAxisAngle(axis: Vec3, angle: number): Quat {
  const l = Math.hypot(axis.x, axis.y, axis.z);
  if (l < 1e-9) return { ...IDENTITY };
  const h = angle / 2;
  const s = Math.sin(h) / l;
  return { x: axis.x * s, y: axis.y * s, z: axis.z * s, w: Math.cos(h) };
}

/** Rotation vector: direction is the axis, length is the angle in radians. */
export function toAxisAngle(q: Quat): Vec3 {
  const n = normalize(q);
  const s = Math.hypot(n.x, n.y, n.z);
  if (s < 1e-9) return { x: 0, y: 0, z: 0 };
  // Signed so the result is always the short way round rather than the long one.
  const angle = 2 * Math.atan2(s, Math.abs(n.w)) * (n.w < 0 ? -1 : 1);
  return { x: (n.x / s) * angle, y: (n.y / s) * angle, z: (n.z / s) * angle };
}

/** Columns are the local x, y and z axes expressed in world coordinates. */
function fromBasis(sx: Vec3, fy: Vec3, nz: Vec3): Quat {
  const m00 = sx.x, m01 = fy.x, m02 = nz.x;
  const m10 = sx.y, m11 = fy.y, m12 = nz.y;
  const m20 = sx.z, m21 = fy.z, m22 = nz.z;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return normalize({ w: 0.25 / s, x: (m21 - m12) * s, y: (m02 - m20) * s, z: (m10 - m01) * s });
  }
  if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    return normalize({ w: (m21 - m12) / s, x: 0.25 * s, y: (m01 + m10) / s, z: (m02 + m20) / s });
  }
  if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    return normalize({ w: (m02 - m20) / s, x: (m01 + m10) / s, y: 0.25 * s, z: (m12 + m21) / s });
  }
  const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
  return normalize({ w: (m10 - m01) / s, x: (m02 + m20) / s, y: (m12 + m21) / s, z: 0.25 * s });
}

const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
function unit(v: Vec3): Vec3 | null {
  const l = Math.hypot(v.x, v.y, v.z);
  if (l < 1e-6) return null;
  return { x: v.x / l, y: v.y / l, z: v.z / l };
}

/**
 * The hand's orientation, from MediaPipe's metric 3D landmarks.
 *
 * Two spans define it: along the hand from the wrist to the middle knuckle, and
 * across it from the index knuckle to the little one. Gram-Schmidt makes them
 * orthonormal and the cross product supplies the third axis, so the result is a
 * genuine rotation rather than a skewed frame.
 *
 * This is what the old single-angle version could not see. An in-plane angle
 * measured off flat image coordinates is blind to pronation, the palm rolling
 * over about the forearm, because that motion barely moves the wrist-to-knuckle
 * line on screen. Here it rotates the whole basis, so it reads exactly.
 */
export function handOrientation(world: Vec3[] | undefined): Quat | null {
  if (!world || world.length <= LM.littleMCP) return null;
  const p = (i: number): Vec3 => ({
    x: world[i].x * AXIS.x,
    y: world[i].y * AXIS.y,
    z: world[i].z * AXIS.z,
  });

  const forward = unit(sub(p(LM.middleMCP), p(LM.wrist)));
  if (!forward) return null;
  const across = sub(p(LM.indexMCP), p(LM.littleMCP));
  const projected = sub(across, {
    x: forward.x * dot(across, forward),
    y: forward.y * dot(across, forward),
    z: forward.z * dot(across, forward),
  });
  const side = unit(projected);
  if (!side) return null;
  return fromBasis(side, forward, cross(side, forward));
}
