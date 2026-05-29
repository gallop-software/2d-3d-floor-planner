import { useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { wallLength, wallOpeningRects } from '../../scene/geometry';
import type { Opening, Wall } from '../../scene/schema';
import { describeWall, SELECTED_COLOR, type Selected3D } from '../../scene/describe';
import type { UnitSystem } from '../../scene/units';

type Props = {
  wall: Wall;
  openings: Opening[];
  units: UnitSystem;
  selectedId: string | null;
  onSelect: (sel: Selected3D | null) => void;
};

const EPS = 0.001;

/**
 * Build the wall as one or more solid panels (local u = along the wall, v =
 * height) so each wall is a SINGLE geometry — not a patchwork of boxes:
 *   - windows (sill above floor, top below ceiling) → enclosed holes,
 *   - doors / openings that reach the floor → notches in the bottom edge,
 *   - full-height openings → split the wall into separate panels.
 */
function wallShapes(wall: Wall, openings: Opening[]): THREE.Shape[] {
  const length = wallLength(wall);
  const height = wall.height;
  // Shared opening footprints (same source the 2D plan uses).
  const cuts = wallOpeningRects(wall, openings).map((r) => ({
    a0: r.along[0],
    a1: r.along[1],
    vb: r.bottom,
    vt: r.top,
  }));

  const isFull = (o: { vb: number; vt: number }) => o.vb <= EPS && o.vt >= height - EPS;

  // Solid spans between full-height openings → one panel each.
  const full = cuts.filter(isFull).sort((p, q) => p.a0 - q.a0);
  const spans: Array<[number, number]> = [];
  let cur = 0;
  for (const f of full) {
    if (f.a0 > cur + EPS) spans.push([cur, f.a0]);
    cur = Math.max(cur, f.a1);
  }
  if (cur < length - EPS) spans.push([cur, length]);

  const shapes: THREE.Shape[] = [];
  for (const [pa, pb] of spans) {
    const within = cuts.filter((o) => !isFull(o) && o.a0 >= pa - EPS && o.a1 <= pb + EPS);
    const floorNotch = within.filter((o) => o.vb <= EPS).sort((p, q) => p.a0 - q.a0); // header above
    const ceilNotch = within.filter((o) => o.vb > EPS && o.vt >= height - EPS).sort((p, q) => p.a0 - q.a0);
    const holes = within.filter((o) => o.vb > EPS && o.vt < height - EPS); // enclosed windows

    const s = new THREE.Shape();
    s.moveTo(pa, 0);
    for (const o of floorNotch) {
      s.lineTo(o.a0, 0);
      s.lineTo(o.a0, o.vt);
      s.lineTo(o.a1, o.vt);
      s.lineTo(o.a1, 0);
    }
    s.lineTo(pb, 0);
    s.lineTo(pb, height);
    for (const o of [...ceilNotch].reverse()) {
      s.lineTo(o.a1, height);
      s.lineTo(o.a1, o.vb);
      s.lineTo(o.a0, o.vb);
      s.lineTo(o.a0, height);
    }
    s.lineTo(pa, height);
    s.closePath();

    for (const o of holes) {
      const h = new THREE.Path();
      h.moveTo(o.a0, o.vb);
      h.lineTo(o.a1, o.vb);
      h.lineTo(o.a1, o.vt);
      h.lineTo(o.a0, o.vt);
      h.closePath();
      s.holes.push(h);
    }
    shapes.push(s);
  }
  return shapes;
}

export function Wall3D({ wall, openings, units, selectedId, onSelect }: Props) {
  const len = wallLength(wall);

  // One flat (zero-thickness) plane per panel. Built in local (u, v); the group
  // orients it in world space.
  const geoms = useMemo(() => {
    if (len === 0) return [];
    return wallShapes(wall, openings).map((shape) => new THREE.ShapeGeometry(shape));
  }, [wall, openings, len]);

  if (len === 0) return null;

  const ux = (wall.end.x - wall.start.x) / len;
  const uy = (wall.end.y - wall.start.y) / len;
  // Scene is left-handed (x east, y south, z up); three is right-handed. Rotating
  // local +x → wall direction and local +z → wall normal (see also Fixture3D).
  const angleY = Math.atan2(uy, -ux);

  const desc = describeWall(wall, units);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect({ id: wall.id, ...desc, point: [e.point.x, e.point.y, e.point.z] });
  };
  // Walls have no fill (edges only), so selection changes the edge color. When
  // selected, draw the yellow lines without depth testing and last (renderOrder)
  // so they sit cleanly on top of any coincident edge (e.g. a shared corner)
  // instead of z-fighting it.
  const sel = selectedId === wall.id;
  const edgeColor = sel ? SELECTED_COLOR : '#404040';

  return (
    <group position={[-wall.start.x, 0, -wall.start.y]} rotation={[0, angleY, 0]}>
      {geoms.map((g, i) => (
        <mesh key={i} geometry={g} onClick={onClick}>
          {/* Invisible fill — kept only for click hit-testing; just the edge lines show. */}
          <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
          <Edges color={edgeColor} threshold={15} depthTest={!sel} renderOrder={sel ? 1 : 0} />
        </mesh>
      ))}
    </group>
  );
}
