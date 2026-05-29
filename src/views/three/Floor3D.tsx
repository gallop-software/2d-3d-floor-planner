import { useMemo } from 'react';
import * as THREE from 'three';
import type { ThreeEvent } from '@react-three/fiber';
import type { Room } from '../../scene/schema';
import { describeRoom, SELECTED_COLOR, type Selected3D } from '../../scene/describe';
import type { UnitSystem } from '../../scene/units';

type Props = {
  room: Room;
  /** Vertical position of the floor surface (default 0). */
  y?: number;
  color?: string;
  units: UnitSystem;
  selectedId: string | null;
  onSelect: (sel: Selected3D | null) => void;
};

export function Floor3D({ room, y = 0, color, units, selectedId, onSelect }: Props) {
  const geom = useMemo(() => {
    const shape = new THREE.Shape();
    // Scene (x, y) → three (-x, -y). Build shape in XY then rotate flat.
    const pts = room.polygon;
    if (pts.length === 0) return null;
    shape.moveTo(-pts[0].x, -pts[0].y);
    for (let i = 1; i < pts.length; i++) {
      shape.lineTo(-pts[i].x, -pts[i].y);
    }
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }, [room.polygon]);

  if (!geom) return null;

  const desc = describeRoom(room, units);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect({ id: room.id, ...desc, point: [e.point.x, e.point.y, e.point.z] });
  };

  return (
    <mesh geometry={geom} rotation={[Math.PI / 2, 0, 0]} position={[0, y, 0]} onClick={onClick}>
      {selectedId === room.id ? (
        <meshBasicMaterial color={SELECTED_COLOR} side={THREE.DoubleSide} />
      ) : (
        <meshStandardMaterial color={color ?? room.floorColor ?? '#e9dcc1'} side={THREE.DoubleSide} />
      )}
    </mesh>
  );
}
