import { useEffect, useMemo, useRef, useState } from 'react';
import { useSceneStore } from '../scene/store';
import { polygonCentroid, wallLength, wallNormal, wallOpeningRects, wallUnit } from '../scene/geometry';
import {
  describeById,
  describeFixture,
  describeOpening,
  describeRoom,
  describeWall,
  SELECTED_COLOR,
  type Selected2D,
} from '../scene/describe';
import { Compass } from './Compass';
import { ZoomControls } from '../ui/ZoomControls';
import type { UnitSystem } from '../scene/units';
import type { Opening, Scene, Vec2, Wall } from '../scene/schema';

const PAD = 36; // inches of padding around scene bounds

function sceneBounds(scene: Scene): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const consider = (p: Vec2) => {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  };
  for (const w of scene.level.walls) {
    consider(w.start);
    consider(w.end);
  }
  for (const r of scene.level.rooms) {
    for (const p of r.polygon) consider(p);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 360, maxY: 240 };
  return { minX: minX - PAD, minY: minY - PAD, maxX: maxX + PAD, maxY: maxY + PAD };
}

type Segment = { startAlong: number; endAlong: number };

// In plan view, doors and cased openings cut the wall line; windows do not.
function planSegments(wall: Wall, openings: Opening[]): Segment[] {
  const len = wallLength(wall);
  const cutting = wallOpeningRects(wall, openings)
    .filter((r) => r.type === 'door' || r.type === 'opening')
    .map((r) => ({ startAlong: r.along[0], endAlong: r.along[1] }))
    .sort((a, b) => a.startAlong - b.startAlong);
  const segs: Segment[] = [];
  let cursor = 0;
  for (const c of cutting) {
    if (c.startAlong > cursor) segs.push({ startAlong: cursor, endAlong: c.startAlong });
    cursor = Math.max(cursor, c.endAlong);
  }
  if (cursor < len) segs.push({ startAlong: cursor, endAlong: len });
  return segs;
}

function pointsAttr(pts: Vec2[]): string {
  return pts.map((p) => `${p.x},${p.y}`).join(' ');
}

export function Plan2D() {
  const scene = useSceneStore((s) => s.scene);
  const units = useSceneStore((s) => s.units);
  const svgRef = useRef<SVGSVGElement>(null);

  const bounds = useMemo(() => sceneBounds(scene), [scene]);
  const initialVB = useMemo(
    () => ({
      x: bounds.minX,
      y: bounds.minY,
      w: bounds.maxX - bounds.minX,
      h: bounds.maxY - bounds.minY,
    }),
    [bounds],
  );

  const [vb, setVb] = useState(initialVB);
  const [selected, setSelected] = useState<Selected2D | null>(null);
  // Distinguish a tap (select) from a drag (pan / pinch).
  const movedRef = useRef(false);
  const downPt = useRef({ x: 0, y: 0 });

  useEffect(() => {
    setVb(initialVB);
  }, [initialVB]);

  const screenToSvg = (clientX: number, clientY: number): { x: number; y: number } => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const inv = pt.matrixTransform(ctm.inverse());
    return { x: inv.x, y: inv.y };
  };

  // Native, non-passive wheel listener so preventDefault() actually fires.
  // (React registers onWheel as passive, so touchpad pinch — ctrl+wheel — would
  // otherwise zoom the whole page instead of the plan.)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      // Punchier zoom (closer to the 3D OrbitControls feel); clamp per-event so a
      // mouse wheel's large deltas don't jump too far in one notch.
      const factor = Math.min(1.4, Math.max(1 / 1.4, Math.exp(e.deltaY * 0.01)));
      const cursor = screenToSvg(e.clientX, e.clientY);
      setVb((prev) => {
        const newW = prev.w * factor;
        const newH = prev.h * factor;
        const newX = cursor.x - ((cursor.x - prev.x) / prev.w) * newW;
        const newY = cursor.y - ((cursor.y - prev.y) / prev.h) * newH;
        return { x: newX, y: newY, w: newW, h: newH };
      });
    };
    // Safari fires non-standard pinch gesture events that also page-zoom.
    const preventGesture = (e: Event) => e.preventDefault();
    svg.addEventListener('wheel', onWheelNative, { passive: false });
    svg.addEventListener('gesturestart', preventGesture);
    svg.addEventListener('gesturechange', preventGesture);
    return () => {
      svg.removeEventListener('wheel', onWheelNative);
      svg.removeEventListener('gesturestart', preventGesture);
      svg.removeEventListener('gesturechange', preventGesture);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Gestures (mouse + touch): one pointer pans, two pointers pinch-zoom + pan.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<{ cx: number; cy: number; dist: number } | null>(null);

  const readGesture = () => {
    const pts = [...pointers.current.values()];
    const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
    const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
    const dist = pts.length >= 2 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { cx, cy, dist };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    // NOTE: no setPointerCapture — it would retarget click/pointerup to the SVG
    // and break click-to-select on child elements. Pan/pinch still work because
    // child pointer events bubble up to these handlers.
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      movedRef.current = false;
      downPt.current = { x: e.clientX, y: e.clientY };
    } else {
      movedRef.current = true; // a second finger means a pinch, never a tap
    }
    gesture.current = readGesture(); // reset baseline (avoids a jump when a finger lands)
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId) || !svgRef.current) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!movedRef.current && Math.hypot(e.clientX - downPt.current.x, e.clientY - downPt.current.y) > 6) {
      movedRef.current = true;
    }
    const prev = gesture.current;
    const now = readGesture();
    gesture.current = now;
    if (!prev) return;
    const rect = svgRef.current.getBoundingClientRect();
    const pinching = pointers.current.size >= 2 && prev.dist > 0 && now.dist > 0;
    setVb((vb) => {
      // Pan by how far the pointers' centroid moved.
      let next = {
        x: vb.x - (now.cx - prev.cx) * (vb.w / rect.width),
        y: vb.y - (now.cy - prev.cy) * (vb.h / rect.height),
        w: vb.w,
        h: vb.h,
      };
      // Pinch: scale around the centroid (the point under the fingers stays put).
      if (pinching) {
        const factor = prev.dist / now.dist;
        const sx = next.x + ((now.cx - rect.left) / rect.width) * next.w;
        const sy = next.y + ((now.cy - rect.top) / rect.height) * next.h;
        const w = next.w * factor;
        const h = next.h * factor;
        next = { x: sx - ((sx - next.x) / next.w) * w, y: sy - ((sy - next.y) / next.h) * h, w, h };
      }
      return next;
    });
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    gesture.current = pointers.current.size > 0 ? readGesture() : null;
  };

  // +/- buttons zoom around the view center (wheel/pinch still zoom at the cursor).
  const zoomBy = (factor: number) => {
    setVb((prev) => {
      const cx = prev.x + prev.w / 2;
      const cy = prev.y + prev.h / 2;
      const w = prev.w * factor;
      const h = prev.h * factor;
      return { x: cx - w / 2, y: cy - h / 2, w, h };
    });
  };

  // Click/tap to select (unless it was a drag); clicking the selected element
  // again — or empty space — clears it.
  const select = (sel: Selected2D | null) => {
    if (movedRef.current) return;
    setSelected((prev) => (sel && prev && prev.id === sel.id ? null : sel));
  };

  // Project the selected element's scene anchor to screen px (accounts for the
  // viewBox + xMidYMid-meet fit), so the tooltip stays on it while panning/zooming.
  const tipPos = (() => {
    if (!selected || !svgRef.current) return null;
    const rect = svgRef.current.getBoundingClientRect();
    const scale = Math.min(rect.width / vb.w, rect.height / vb.h);
    const offX = (rect.width - vb.w * scale) / 2;
    const offY = (rect.height - vb.h * scale) / 2;
    return {
      x: rect.left + offX + (selected.sx - vb.x) * scale,
      y: rect.top + offY + (selected.sy - vb.y) * scale,
    };
  })();

  return (
    <div className="relative w-full h-full bg-stone-50">
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        className="block w-full h-full select-none cursor-grab active:cursor-grabbing"
        style={{ touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClick={() => select(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          {/* 12" (1 ft) squares only — no heavier section lines. */}
          <pattern id="grid-12" width={12} height={12} patternUnits="userSpaceOnUse">
            <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#d6d3d1" strokeWidth={0.3} />
          </pattern>
        </defs>

        <rect
          x={bounds.minX}
          y={bounds.minY}
          width={bounds.maxX - bounds.minX}
          height={bounds.maxY - bounds.minY}
          fill="url(#grid-12)"
        />

        <RoomLayer scene={scene} units={units} selectedId={selected?.id ?? null} onSelect={select} />
        <WallLayer scene={scene} units={units} selectedId={selected?.id ?? null} onSelect={select} />
        <OpeningLayer scene={scene} units={units} selectedId={selected?.id ?? null} onSelect={select} />
        <FixtureLayer scene={scene} units={units} selectedId={selected?.id ?? null} onSelect={select} />
      </svg>
      <ZoomControls onZoomIn={() => zoomBy(1 / 1.3)} onZoomOut={() => zoomBy(1.3)} />
      <Compass />
      {selected && tipPos && (() => {
        // Recompute from the element + current units so the unit toggle updates it live.
        const desc = describeById(scene, selected.id, units) ?? selected;
        return (
          <div
            className="pointer-events-none fixed z-50 rounded bg-stone-900/90 px-2 py-1 text-xs text-white shadow-lg"
            style={{ left: tipPos.x + 12, top: tipPos.y + 12 }}
          >
            <div className="font-semibold">{desc.label || '(unnamed)'}</div>
            <div className="font-mono text-stone-300">{desc.dims}</div>
          </div>
        );
      })()}
    </div>
  );
}

function RoomLayer({
  scene,
  units,
  selectedId,
  onSelect,
}: {
  scene: Scene;
  units: UnitSystem;
  selectedId: string | null;
  onSelect: (sel: Selected2D | null) => void;
}) {
  return (
    <g>
      {scene.level.rooms.map((r) => {
        const desc = describeRoom(r, units);
        const sel = selectedId === r.id;
        const c = polygonCentroid(r.polygon);
        return (
          <polygon
            key={r.id}
            points={pointsAttr(r.polygon)}
            fill={sel ? SELECTED_COLOR : (r.floorColor ?? '#f5f5f4')}
            fillOpacity={sel ? 1 : 0.55}
            stroke="none"
            onClick={(e) => {
              e.stopPropagation();
              onSelect({ id: r.id, ...desc, sx: c.x, sy: c.y });
            }}
          />
        );
      })}
    </g>
  );
}

function WallLayer({
  scene,
  units,
  selectedId,
  onSelect,
}: {
  scene: Scene;
  units: UnitSystem;
  selectedId: string | null;
  onSelect: (sel: Selected2D | null) => void;
}) {
  return (
    <g>
      {scene.level.walls.map((w) => {
        const segs = planSegments(w, scene.level.openings);
        const u = wallUnit(w);
        const desc = describeWall(w, units);
        const sel = selectedId === w.id;
        return (
          <g key={w.id}>
            {segs.map((seg, i) => {
              // Walls are planes: draw the centerline (the exact interior edge).
              const a = { x: w.start.x + u.x * seg.startAlong, y: w.start.y + u.y * seg.startAlong };
              const b = { x: w.start.x + u.x * seg.endAlong, y: w.start.y + u.y * seg.endAlong };
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke={sel ? SELECTED_COLOR : '#404040'}
                  strokeWidth={1.5}
                  strokeLinecap="square"
                />
              );
            })}
            {/* Transparent hit line over the full wall — click to select it. */}
            <line
              x1={w.start.x}
              y1={w.start.y}
              x2={w.end.x}
              y2={w.end.y}
              stroke="transparent"
              strokeWidth={10}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ id: w.id, ...desc, sx: (w.start.x + w.end.x) / 2, sy: (w.start.y + w.end.y) / 2 });
              }}
            />
          </g>
        );
      })}
    </g>
  );
}

function OpeningLayer({
  scene,
  units,
  selectedId,
  onSelect,
}: {
  scene: Scene;
  units: UnitSystem;
  selectedId: string | null;
  onSelect: (sel: Selected2D | null) => void;
}) {
  return (
    <g>
      {scene.level.openings.map((o) => {
        const wall = scene.level.walls.find((w) => w.id === o.wallId);
        if (!wall) return null;
        const len = wallLength(wall);
        if (len === 0) return null;
        const u = {
          x: (wall.end.x - wall.start.x) / len,
          y: (wall.end.y - wall.start.y) / len,
        };
        const n = wallNormal(wall);
        const startAlong = Math.max(0, o.position - o.width / 2);
        const endAlong = Math.min(len, o.position + o.width / 2);
        const a = {
          x: wall.start.x + u.x * startAlong,
          y: wall.start.y + u.y * startAlong,
        };
        const b = {
          x: wall.start.x + u.x * endAlong,
          y: wall.start.y + u.y * endAlong,
        };

        const desc = describeOpening(o, units);
        const sel = selectedId === o.id;

        let visible: React.ReactNode = null;
        if (o.type === 'window') {
          // Window: thick blue line over the wall centerline.
          visible = <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#2563eb" strokeWidth={3} strokeLinecap="butt" />;
        } else if (o.type === 'door') {
          // Door panel + swing arc. Panel hinged at "a", swings toward +n side.
          const panelEnd = { x: a.x + n.x * o.width, y: a.y + n.y * o.width };
          const arcSweepPath = `M ${a.x.toFixed(3)} ${a.y.toFixed(3)} L ${b.x.toFixed(3)} ${b.y.toFixed(3)} A ${o.width} ${o.width} 0 0 1 ${panelEnd.x.toFixed(3)} ${panelEnd.y.toFixed(3)} Z`;
          visible = (
            <>
              <path d={arcSweepPath} fill="none" stroke="#78716c" strokeWidth={0.3} strokeDasharray="0.6 0.6" />
              <line x1={a.x} y1={a.y} x2={panelEnd.x} y2={panelEnd.y} stroke="#1c1917" strokeWidth={0.4} />
            </>
          );
        }
        // Cased opening: nothing visible beyond the gap; the hit line still gives a tooltip target.

        return (
          <g key={o.id}>
            {visible}
            {/* Blue highlight line when selected. */}
            {sel && <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={SELECTED_COLOR} strokeWidth={4} strokeLinecap="butt" />}
            {/* Transparent wide hit line so the thin opening is easy to tap. */}
            <line
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="transparent"
              strokeWidth={12}
              style={{ pointerEvents: 'stroke', cursor: 'pointer' }}
              onClick={(e) => {
                e.stopPropagation();
                onSelect({ id: o.id, ...desc, sx: (a.x + b.x) / 2, sy: (a.y + b.y) / 2 });
              }}
            />
          </g>
        );
      })}
    </g>
  );
}

function FixtureLayer({
  scene,
  units,
  selectedId,
  onSelect,
}: {
  scene: Scene;
  units: UnitSystem;
  selectedId: string | null;
  onSelect: (sel: Selected2D | null) => void;
}) {
  // Draw lower-mounted fixtures first so uppers sit on top (and win hover where
  // they overlap a base; the base's exposed front strip stays hoverable).
  const ordered = [...scene.level.fixtures].sort(
    (a, b) => a.position.z - a.size.z / 2 - (b.position.z - b.size.z / 2),
  );
  return (
    <g>
      {ordered.map((f) => {
        const desc = describeFixture(f, units);
        const sel = selectedId === f.id;
        // Upper cabinets are mounted high — show them dashed (plan convention).
        const isUpper = f.position.z - f.size.z / 2 > 30;
        // Selection tints the fill blue; the border stays its normal color.
        const fill = sel ? SELECTED_COLOR : (f.color ?? '#a8a29e');
        const fillOpacity = sel ? 1 : 0.4;
        const stroke = isUpper ? '#6b7b8a' : '#44403c';
        const dash = isUpper ? '2.5 1.5' : undefined;
        const clickProps = {
          style: { cursor: 'pointer' as const },
          onClick: (e: React.MouseEvent) => {
            e.stopPropagation();
            onSelect({ id: f.id, ...desc, sx: f.position.x, sy: f.position.y });
          },
        };

        if (f.type === 'prism' && f.footprint && f.footprint.length >= 3) {
          // Single extruded shape — render its footprint polygon directly.
          return (
            <polygon
              key={f.id}
              points={pointsAttr(f.footprint)}
              fill={fill}
              fillOpacity={fillOpacity}
              stroke={stroke}
              strokeWidth={0.3}
              strokeDasharray={dash}
              {...clickProps}
            />
          );
        }
        const hx = f.size.x / 2;
        const hy = f.size.y / 2;
        const rad = (f.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const corners = [
          { x: -hx, y: -hy },
          { x: hx, y: -hy },
          { x: hx, y: hy },
          { x: -hx, y: hy },
        ].map((p) => ({
          x: f.position.x + p.x * cos - p.y * sin,
          y: f.position.y + p.x * sin + p.y * cos,
        }));
        return (
          <polygon
            key={f.id}
            points={pointsAttr(corners)}
            fill={fill}
            fillOpacity={fillOpacity}
            stroke={stroke}
            strokeWidth={0.3}
            strokeDasharray={dash}
            {...clickProps}
          />
        );
      })}
    </g>
  );
}

