# 2d-3d-floor-planner

A foundation for designing interior floor plans with **matched 2D and 3D views** of the same scene.

- **Single source of truth**: one typed JSON scene drives both views.
- **Precise dimensions**: all linear values stored in inches. Imperial display by default, metric toggle.
- **Chat-driven authoring**: edit `src/scene/sample.ts` (or paste JSON into the right sidebar) and both views update via HMR.
- **Not photoreal**: simple extruded walls, cut openings, primitive furniture — proportional accuracy is the bar.

## Stack

- Vite + React 18 + TypeScript
- Zustand (state) + Zod (schema validation)
- three.js via @react-three/fiber + @react-three/drei (3D)
- Plain SVG (2D plan)
- Tailwind CSS (UI chrome)

## Quick start

```bash
npm install
npm run dev
```

Open the printed URL. The app boots into the 2D plan with a starter scene:

- **Living room** 16'-0" × 14'-0"
- **Kitchen** 12'-0" × 10'-0"
- A 6'-0" cased opening between them
- Front door 36" × 80", two 48" × 48" windows with 36" sills
- Sofa and kitchen island primitives

Toggle **2D Plan / 3D View / Split** in the top bar; switch units between `ft / in` and `mm / m`.

## Editing the scene

Two ways:

1. **Edit `src/scene/sample.ts`** — typed, autocomplete, Zod-validated at runtime, HMR re-renders both views.
2. **Paste a full scene** into the right sidebar's JSON textarea and hit Apply. Zod validates and surfaces errors inline.

## Data model (in inches)

```ts
type Scene = {
  units: 'imperial' | 'metric';
  level: {
    name: string;
    ceilingHeight: number;
    walls: Wall[];        // start, end, height (zero-thickness planes)
    openings: Opening[];  // wallId, type, position along wall, width, height, sillHeight
    rooms: Room[];        // labelled floor polygon (CCW)
    fixtures: Fixture[];  // primitive box / cylinder / prism (extruded footprint)
  };
};
```

See `src/scene/schema.ts` for the full Zod schema.

## Coordinate system

- Scene: `+x` east, `+y` south, `+z` up. Inches. (This is a left-handed basis.)
- Three.js mapping: scene `(x, y, z)` → three `(-x, z, -y)`. Negating `x` converts the
  left-handed scene to three's right-handed space **without mirroring** the model.
  One conversion, applied in `Wall3D`, `Opening3D`, `Floor3D`, `Fixture3D` (and the
  scene center in `Scene3D`).
