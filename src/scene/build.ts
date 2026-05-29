// Authoring helpers — build the typed `Scene` from intuitive, EDGE/BOUNDS-based
// inputs instead of center+size. The renderer consumes the same `Scene` types,
// so these only change how scenes are *written*, never how they *draw*.
//
// Everything is in INCHES. Origin at the interior NW corner; +x east, +y south,
// +z up. See sample.ts for the layout and a worked authoring guide.

import type { Fixture, Opening, Room, Scene, Vec2, Wall } from './schema';

/** Inclusive [edge, edge] extent on one axis. Order doesn't matter. */
export type Span = [number, number];

const lo = (s: Span) => Math.min(s[0], s[1]);
const hi = (s: Span) => Math.max(s[0], s[1]);
const mid = (s: Span) => (s[0] + s[1]) / 2;
const len = (s: Span) => Math.abs(s[1] - s[0]);

// ── Scene assembler ──────────────────────────────────────────────────────────
/** Assemble a full Scene from its parts (fills units + wraps the single level). */
export function scene(opts: {
  name: string;
  ceiling: number;
  walls: Wall[];
  openings: Opening[];
  rooms: Room[];
  fixtures: Fixture[];
  units?: Scene['units'];
}): Scene {
  return {
    units: opts.units ?? 'imperial',
    level: {
      name: opts.name,
      ceilingHeight: opts.ceiling,
      walls: opts.walls,
      openings: opts.openings,
      rooms: opts.rooms,
      fixtures: opts.fixtures,
    },
  };
}

// ── Walls ──────────────────────────────────────────────────────────────────
/** A zero-thickness wall plane between two points (centerline == interior edge). */
export function wall(id: string, start: Vec2, end: Vec2, height: number): Wall {
  return { id, start, end, height };
}

// ── Openings ─────────────────────────────────────────────────────────────────
/**
 * Place an opening by the WORLD coordinate range it covers along its wall —
 * the x-range for horizontal walls, the y-range for vertical walls. The
 * "position along wall" the schema wants is derived for you.
 */
export function opening(
  id: string,
  w: Wall,
  type: Opening['type'],
  worldSpan: Span,
  height: number,
  sillHeight?: number,
): Opening {
  const dx = w.end.x - w.start.x;
  const dy = w.end.y - w.start.y;
  const wlen = Math.hypot(dx, dy) || 1;
  const ux = dx / wlen;
  const uy = dy / wlen;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const c = mid(worldSpan);
  const center: Vec2 = horizontal ? { x: c, y: w.start.y } : { x: w.start.x, y: c };
  const position = (center.x - w.start.x) * ux + (center.y - w.start.y) * uy;
  return {
    id,
    wallId: w.id,
    type,
    position,
    width: len(worldSpan),
    height,
    ...(sillHeight !== undefined ? { sillHeight } : {}),
  };
}

// ── Rooms ────────────────────────────────────────────────────────────────────
export function room(id: string, name: string, polygon: Vec2[], floorColor?: string): Room {
  return { id, name, polygon, ...(floorColor ? { floorColor } : {}) };
}

/** Rectangle polygon (CCW) from x/y edge spans — handy for rectangular rooms. */
export function rect(x: Span, y: Span): Vec2[] {
  return [
    { x: lo(x), y: lo(y) },
    { x: hi(x), y: lo(y) },
    { x: hi(x), y: hi(y) },
    { x: lo(x), y: hi(y) },
  ];
}

// ── Fixtures ───────────────────────────────────────────────────────────────
/** Box fixture from its three edge spans — no center/size math. */
export function box(
  id: string,
  label: string,
  bounds: { x: Span; y: Span; z: Span },
  color?: string,
): Fixture {
  return {
    id,
    type: 'box',
    label,
    rotation: 0,
    position: { x: mid(bounds.x), y: mid(bounds.y), z: mid(bounds.z) },
    size: { x: len(bounds.x), y: len(bounds.y), z: len(bounds.z) },
    ...(color ? { color } : {}),
  };
}

/** Extruded-polygon fixture from an absolute footprint + a vertical span. */
export function prism(
  id: string,
  label: string,
  footprint: Vec2[],
  z: Span,
  color?: string,
): Fixture {
  const xs = footprint.map((p) => p.x);
  const ys = footprint.map((p) => p.y);
  const bx: Span = [Math.min(...xs), Math.max(...xs)];
  const by: Span = [Math.min(...ys), Math.max(...ys)];
  return {
    id,
    type: 'prism',
    label,
    rotation: 0,
    position: { x: mid(bx), y: mid(by), z: mid(z) },
    size: { x: len(bx), y: len(by), z: len(z) },
    footprint,
    ...(color ? { color } : {}),
  };
}

// ── Cabinet run ──────────────────────────────────────────────────────────────
// Places boxes end-to-end along one axis, tracking a cursor, so you give each
// item's width (not coordinates). Great for a packed row of cabinets.
export type RunOpts = {
  idPrefix: string; // ids become `${idPrefix}_0`, `_1`, … (override per item if needed)
  along: 'x' | 'y'; // axis the run travels
  start: number; // leading-edge coordinate on `along`
  dir: 1 | -1; // travel direction
  band: Span; // cross-axis extent (depth against the wall)
  z: Span; // vertical extent
  color?: string;
};

type ItemOpts = { id?: string; color?: string; z?: Span };

export type Run = {
  /** Add a cabinet of the given width (along the run axis), advancing the cursor. */
  add(label: string, width: number, o?: ItemOpts): Run;
  /** Advance the cursor without placing anything (e.g. over a window or appliance gap). */
  gap(width: number): Run;
  items: Fixture[];
};

export function run(opts: RunOpts): Run {
  const items: Fixture[] = [];
  let cursor = opts.start;
  let n = 0;
  const api: Run = {
    add(label, width, o) {
      const along: Span = [cursor, cursor + opts.dir * width];
      const z = o?.z ?? opts.z;
      const bounds =
        opts.along === 'x'
          ? { x: along, y: opts.band, z }
          : { x: opts.band, y: along, z };
      items.push(box(o?.id ?? `${opts.idPrefix}_${n++}`, label, bounds, o?.color ?? opts.color));
      cursor += opts.dir * width;
      return api;
    },
    gap(width) {
      cursor += opts.dir * width;
      return api;
    },
    items,
  };
  return api;
}
