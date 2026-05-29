// Single source for hover-tooltip text, so 2D and 3D always label/measure the
// same element the same way (they can't drift). Each helper returns the label
// and a dimensions string; the views add the cursor position.

import { polygonArea, polygonBounds, wallLength } from './geometry';
import type { Fixture, Opening, Room, Scene, Wall } from './schema';
import { formatArea, formatLength, type UnitSystem } from './units';

export type Described = { label: string; dims: string };

/** A selected element: which one (id) + its description. */
export type Selected = Described & { id: string };

/** 2D selection anchored at a scene-space point (re-projected to screen each render). */
export type Selected2D = Selected & { sx: number; sy: number };

/** 3D selection anchored at a world-space point (tracked by <Html> as the camera moves). */
export type Selected3D = Selected & { point: [number, number, number] };

/** Highlight color for the selected element (fill or lines), both 2D and 3D. */
export const SELECTED_COLOR = '#eab308';

const OPENING_LABELS: Record<Opening['type'], string> = {
  window: 'Window',
  door: 'Door',
  opening: 'Opening',
};

export function describeFixture(f: Fixture, units: UnitSystem): Described {
  return {
    label: f.label,
    dims: `${formatLength(f.size.x, units)} × ${formatLength(f.size.y, units)} × ${formatLength(f.size.z, units)}`,
  };
}

export function describeOpening(o: Opening, units: UnitSystem): Described {
  return {
    label: OPENING_LABELS[o.type] ?? 'Opening',
    dims: `${formatLength(o.width, units)} × ${formatLength(o.height, units)}`,
  };
}

export function describeWall(w: Wall, units: UnitSystem): Described {
  return {
    label: 'Wall',
    dims: `${formatLength(wallLength(w), units)} × ${formatLength(w.height, units)}`,
  };
}

export function describeRoom(r: Room, units: UnitSystem): Described {
  const b = polygonBounds(r.polygon);
  return {
    label: r.name,
    dims: `${formatLength(b.w, units)} × ${formatLength(b.d, units)} · ${formatArea(polygonArea(r.polygon), units)}`,
  };
}

/** Look up any element by id and describe it — so a selected tooltip can be
 * recomputed live (e.g. when the unit toggle changes) instead of caching text. */
export function describeById(scene: Scene, id: string, units: UnitSystem): Described | null {
  const f = scene.level.fixtures.find((x) => x.id === id);
  if (f) return describeFixture(f, units);
  const o = scene.level.openings.find((x) => x.id === id);
  if (o) return describeOpening(o, units);
  const w = scene.level.walls.find((x) => x.id === id);
  if (w) return describeWall(w, units);
  const r = scene.level.rooms.find((x) => x.id === id);
  if (r) return describeRoom(r, units);
  return null;
}
