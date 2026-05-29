import type { ThreeEvent } from '@react-three/fiber';
import { wallLength } from '../../scene/geometry';
import type { Opening, Wall } from '../../scene/schema';
import { describeOpening, SELECTED_COLOR, type Selected3D } from '../../scene/describe';
import type { UnitSystem } from '../../scene/units';

type Props = {
  opening: Opening;
  wall: Wall;
  units: UnitSystem;
  selectedId: string | null;
  onSelect: (sel: Selected3D | null) => void;
};

export function Opening3D({ opening, wall, units, selectedId, onSelect }: Props) {
  const len = wallLength(wall);
  if (len === 0) return null;
  const ux = (wall.end.x - wall.start.x) / len;
  const uy = (wall.end.y - wall.start.y) / len;
  // Scene (x, y, z) → three (-x, z, -y) — see Wall3D for the handedness note.
  const angleY = Math.atan2(uy, -ux);

  const sill = opening.type === 'window' ? (opening.sillHeight ?? 36) : 0;
  const centerAlong = opening.position;
  const cx = wall.start.x + ux * centerAlong;
  const cy = wall.start.y + uy * centerAlong;
  const centerZ = sill + opening.height / 2;
  const pos: [number, number, number] = [-cx, centerZ, -cy];

  const desc = describeOpening(opening, units);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect({ id: opening.id, ...desc, point: [e.point.x, e.point.y, e.point.z] });
  };
  const sel = selectedId === opening.id;

  if (opening.type === 'window') {
    return (
      <group position={pos} rotation={[0, angleY, 0]} onClick={onClick}>
        {/* Glass (selected → flat opaque yellow, matching every other element). */}
        <mesh>
          <boxGeometry args={[opening.width, opening.height, 0.5]} />
          {sel ? (
            <meshBasicMaterial color={SELECTED_COLOR} />
          ) : (
            <meshStandardMaterial color="#a5d8e6" transparent opacity={0.35} />
          )}
        </mesh>
      </group>
    );
  }

  if (opening.type === 'door') {
    // Door panel hinged on one side, shown ajar at ~30°.
    const hingeOffset = -opening.width / 2 + 1;
    const ajar = -Math.PI / 6;
    return (
      <group position={pos} rotation={[0, angleY, 0]} onClick={onClick}>
        <group position={[hingeOffset, 0, 0]} rotation={[0, ajar, 0]}>
          <mesh position={[opening.width / 2 - 1, 0, 0]}>
            <boxGeometry args={[opening.width - 2, opening.height, 1.5]} />
            {sel ? (
              <meshBasicMaterial color={SELECTED_COLOR} />
            ) : (
              <meshStandardMaterial color="#7c5e3f" />
            )}
          </mesh>
        </group>
      </group>
    );
  }

  // Cased opening — no visible mesh (just the gap); nothing to click in 3D.
  return null;
}
