import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Grid, Html, OrbitControls, PerspectiveCamera } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TOUCH, Vector3 } from 'three';
import { useSceneStore } from '../scene/store';
import { Wall3D } from './three/Wall3D';
import { Opening3D } from './three/Opening3D';
import { Floor3D } from './three/Floor3D';
import { Fixture3D } from './three/Fixture3D';
import { Compass } from './Compass';
import { ZoomControls } from '../ui/ZoomControls';
import { describeById, type Selected3D } from '../scene/describe';
import type { Scene } from '../scene/schema';

function sceneCenter(scene: Scene) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const w of scene.level.walls) {
    minX = Math.min(minX, w.start.x, w.end.x);
    minY = Math.min(minY, w.start.y, w.end.y);
    maxX = Math.max(maxX, w.start.x, w.end.x);
    maxY = Math.max(maxY, w.start.y, w.end.y);
  }
  if (!Number.isFinite(minX)) {
    return { center: [0, 0, 0] as [number, number, number], radius: 240 };
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const radius = Math.hypot(maxX - minX, maxY - minY) / 2;
  // Scene (x, y) → three (-x, -y); center follows the same mapping.
  return { center: [-cx, 50, -cy] as [number, number, number], radius };
}

// Reports the screen-space heading of world-north (scene -y → three +z) so the
// overlay compass can rotate to match the current camera orbit.
function CompassTracker({ onHeading }: { onHeading: (deg: number) => void }) {
  const camera = useThree((s) => s.camera);
  const right = useRef(new Vector3());
  const up = useRef(new Vector3());
  const last = useRef(NaN);
  useFrame(() => {
    right.current.setFromMatrixColumn(camera.matrixWorld, 0);
    up.current.setFromMatrixColumn(camera.matrixWorld, 1);
    // north = (0, 0, 1); its on-screen x/y components are right.z and up.z.
    const deg = (Math.atan2(right.current.z, up.current.z) * 180) / Math.PI;
    if (Number.isNaN(last.current) || Math.abs(deg - last.current) > 0.3) {
      last.current = deg;
      onHeading(deg);
    }
  });
  return null;
}

// Exposes a dolly-zoom function (scale the camera-to-target distance) to the
// overlay +/- buttons, which live outside the Canvas.
function ZoomBridge({ api }: { api: React.MutableRefObject<((factor: number) => void) | null> }) {
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as { target: Vector3; update: () => void } | null;
  useEffect(() => {
    api.current = (factor: number) => {
      if (!controls) return;
      camera.position.sub(controls.target).multiplyScalar(factor).add(controls.target);
      controls.update();
    };
    return () => {
      api.current = null;
    };
  }, [camera, controls, api]);
  return null;
}

export function Scene3D() {
  const scene = useSceneStore((s) => s.scene);
  const units = useSceneStore((s) => s.units);
  const { center, radius } = useMemo(() => sceneCenter(scene), [scene]);
  const [heading, setHeading] = useState(0);
  const [selected, setSelected] = useState<Selected3D | null>(null);
  // Suppress selection when the click was actually an orbit/pan/pinch drag.
  const dragged = useRef(false);
  const downPt = useRef({ x: 0, y: 0 });
  const onDivPointerDown = (e: React.PointerEvent) => {
    dragged.current = false;
    downPt.current = { x: e.clientX, y: e.clientY };
  };
  const onDivPointerMove = (e: React.PointerEvent) => {
    if (Math.hypot(e.clientX - downPt.current.x, e.clientY - downPt.current.y) > 6) dragged.current = true;
  };
  // Clicking the selected element again (or empty space) clears the selection.
  const select = (sel: Selected3D | null) => {
    if (dragged.current) return;
    setSelected((prev) => (sel && prev && prev.id === sel.id ? null : sel));
  };
  const zoomApi = useRef<((factor: number) => void) | null>(null);
  // Start looking north (toward the north wall): camera sits to the south,
  // elevated, with a slight east offset. North = three +z, so the camera is at
  // the -z side looking toward +z. With the (-x, z, -y) mapping, scene +x (east)
  // lands on the right — matching the 2D plan's orientation.
  const camPos: [number, number, number] = [
    center[0] - radius * 0.5,
    radius * 1.45,
    center[2] - radius * 1.9,
  ];

  return (
    <div
      className="relative w-full h-full bg-stone-100"
      onPointerDown={onDivPointerDown}
      onPointerMove={onDivPointerMove}
    >
      <Canvas shadows={false} dpr={[1, 2]} onPointerMissed={() => select(null)}>
        <PerspectiveCamera makeDefault position={camPos} fov={45} near={1} far={5000} />
        <OrbitControls
          target={center}
          makeDefault
          enableDamping
          dampingFactor={0.12}
          rotateSpeed={0.9}
          panSpeed={1.1}
          zoomSpeed={1.1}
          screenSpacePanning
          minDistance={Math.max(12, radius * 0.2)}
          maxDistance={radius * 8}
          maxPolarAngle={Math.PI * 0.495}
          touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_PAN }}
        />

        <ambientLight intensity={0.55} />
        <directionalLight position={[radius, radius * 1.5, radius]} intensity={0.9} />
        <directionalLight position={[-radius, radius, -radius]} intensity={0.35} />

        <Grid
          args={[radius * 6, radius * 6]}
          cellSize={12}
          cellThickness={0.6}
          cellColor="#d6d3d1"
          sectionSize={12}
          sectionThickness={0}
          sectionColor="#d6d3d1"
          infiniteGrid
          fadeDistance={radius * 6}
          fadeStrength={1}
          position={[0, -0.05, 0]}
        />

        {scene.level.rooms.map((r) => (
          <Floor3D key={r.id} room={r} units={units} selectedId={selected?.id ?? null} onSelect={select} />
        ))}

        {scene.level.walls.map((w) => (
          <Wall3D
            key={w.id}
            wall={w}
            openings={scene.level.openings}
            units={units}
            selectedId={selected?.id ?? null}
            onSelect={select}
          />
        ))}

        {scene.level.openings.map((o) => {
          const wall = scene.level.walls.find((w) => w.id === o.wallId);
          if (!wall) return null;
          return (
            <Opening3D
              key={o.id}
              opening={o}
              wall={wall}
              units={units}
              selectedId={selected?.id ?? null}
              onSelect={select}
            />
          );
        })}

        {scene.level.fixtures.map((f) => (
          <Fixture3D key={f.id} fixture={f} units={units} selectedId={selected?.id ?? null} onSelect={select} />
        ))}

        <CompassTracker onHeading={setHeading} />
        <ZoomBridge api={zoomApi} />

        {/* Tooltip anchored to the clicked world point — <Html> tracks it as the camera orbits. */}
        {selected && (
          <Html position={selected.point} style={{ pointerEvents: 'none' }} zIndexRange={[50, 0]}>
            <div
              className="pointer-events-none rounded bg-stone-900/90 px-2 py-1 text-xs text-white shadow-lg"
              style={{ transform: 'translate(12px, 12px)', whiteSpace: 'nowrap' }}
            >
              {(() => {
                // Recompute live so the unit toggle updates the open tooltip.
                const desc = describeById(scene, selected.id, units) ?? selected;
                return (
                  <>
                    <div className="font-semibold">{desc.label || '(unnamed)'}</div>
                    <div className="font-mono text-stone-300">{desc.dims}</div>
                  </>
                );
              })()}
            </div>
          </Html>
        )}
      </Canvas>
      <ZoomControls onZoomIn={() => zoomApi.current?.(1 / 1.3)} onZoomOut={() => zoomApi.current?.(1.3)} />
      <Compass rotationDeg={heading} />
    </div>
  );
}
