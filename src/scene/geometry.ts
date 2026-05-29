import type { Opening, Vec2, Wall } from './schema';

/** Bounding-box width (x extent) and depth (y extent) of a polygon. */
export function polygonBounds(points: Vec2[]): { w: number; d: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { w: maxX - minX, d: maxY - minY };
}

export function wallLength(w: Wall): number {
  const dx = w.end.x - w.start.x;
  const dy = w.end.y - w.start.y;
  return Math.hypot(dx, dy);
}

export function wallAngle(w: Wall): number {
  return Math.atan2(w.end.y - w.start.y, w.end.x - w.start.x);
}

export function wallUnit(w: Wall): Vec2 {
  const len = wallLength(w);
  if (len === 0) return { x: 1, y: 0 };
  return { x: (w.end.x - w.start.x) / len, y: (w.end.y - w.start.y) / len };
}

export function wallNormal(w: Wall): Vec2 {
  const u = wallUnit(w);
  return { x: -u.y, y: u.x };
}

/** An opening's footprint on its wall: along-the-wall span + vertical span. */
export type WallOpeningRect = {
  type: Opening['type'];
  /** [near-edge, far-edge] distance along the wall from its start. */
  along: [number, number];
  bottom: number; // sill (windows) or 0
  top: number; // clamped to the wall height
};

/**
 * Single source of where every opening sits on a wall — used by both the 2D
 * plan (which cuts the wall line for passages) and the 3D wall (holes/notches),
 * so the two views can't disagree on an opening's position or size.
 */
export function wallOpeningRects(w: Wall, openings: Opening[]): WallOpeningRect[] {
  const len = wallLength(w);
  return openings
    .filter((o) => o.wallId === w.id)
    .map((o) => {
      const bottom = o.type === 'window' ? (o.sillHeight ?? 36) : 0;
      return {
        type: o.type,
        along: [Math.max(0, o.position - o.width / 2), Math.min(len, o.position + o.width / 2)] as [number, number],
        bottom,
        top: Math.min(w.height, bottom + o.height),
      };
    })
    .filter((r) => r.along[1] > r.along[0]);
}

export function polygonArea(points: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export function polygonCentroid(points: Vec2[]): Vec2 {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a /= 2;
  if (a === 0) {
    const sx = points.reduce((s, p) => s + p.x, 0) / points.length;
    const sy = points.reduce((s, p) => s + p.y, 0) / points.length;
    return { x: sx, y: sy };
  }
  cx /= 6 * a;
  cy /= 6 * a;
  return { x: cx, y: cy };
}

