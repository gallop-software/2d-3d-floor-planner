import { useMemo } from 'react';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import type { Fixture } from '../../scene/schema';
import { describeFixture, SELECTED_COLOR, type Selected3D } from '../../scene/describe';
import type { UnitSystem } from '../../scene/units';

type Props = {
  fixture: Fixture;
  units: UnitSystem;
  selectedId: string | null;
  onSelect: (sel: Selected3D | null) => void;
};

export function Fixture3D({ fixture, units, selectedId, onSelect }: Props) {
  const desc = describeFixture(fixture, units);
  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect({ id: fixture.id, ...desc, point: [e.point.x, e.point.y, e.point.z] });
  };
  // When selected, paint the object a flat, opaque, UNLIT yellow so the highlight
  // looks identical on every object (no per-face lighting, no transparency blend).
  const sel = selectedId === fixture.id;
  const material = sel ? (
    <meshBasicMaterial color={SELECTED_COLOR} side={THREE.DoubleSide} />
  ) : (
    <meshStandardMaterial color={fixture.color ?? '#a8a29e'} side={THREE.DoubleSide} />
  );

  // For a prism: extrude the footprint polygon. Scene (x, y) → three (-x, -y),
  // so build the shape as (-x, y) and extrude +z; rotating the mesh -90° about X
  // turns the +z extrude into +y (up) and maps shape-y → three -z.
  const prismGeom = useMemo(() => {
    if (fixture.type !== 'prism' || !fixture.footprint || fixture.footprint.length < 3) return null;
    const shape = new THREE.Shape();
    const f = fixture.footprint;
    shape.moveTo(-f[0].x, f[0].y);
    for (let i = 1; i < f.length; i++) shape.lineTo(-f[i].x, f[i].y);
    shape.closePath();
    return new THREE.ExtrudeGeometry(shape, { depth: fixture.size.z, bevelEnabled: false });
  }, [fixture]);

  // Scene (x, y, z) → three (-x, z, -y). Rotation about scene-z maps to three y,
  // sign flipped by the reflection.
  const pos: [number, number, number] = [-fixture.position.x, fixture.position.z, -fixture.position.y];
  const rotY = -(fixture.rotation * Math.PI) / 180;

  if (prismGeom) {
    const height = fixture.size.z;
    return (
      <mesh
        geometry={prismGeom}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, fixture.position.z - height / 2, 0]}
        onClick={onClick}
      >
        {material}
        <Edges color="#44403c" threshold={15} />
      </mesh>
    );
  }

  if (fixture.type === 'cylinder') {
    const radius = Math.max(fixture.size.x, fixture.size.y) / 2;
    return (
      <mesh position={pos} rotation={[0, rotY, 0]} onClick={onClick}>
        <cylinderGeometry args={[radius, radius, fixture.size.z, 24]} />
        {material}
        <Edges color="#44403c" threshold={15} />
      </mesh>
    );
  }

  // Default: box. Scene size (x, y, z) maps to three (x, z, y).
  return (
    <mesh position={pos} rotation={[0, rotY, 0]} onClick={onClick}>
      <boxGeometry args={[fixture.size.x, fixture.size.z, fixture.size.y]} />
      {material}
      <Edges color="#44403c" threshold={15} />
    </mesh>
  );
}
