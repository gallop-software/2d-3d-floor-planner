# 2D/3D Floor Planner — guide for AI edits

A template that renders a matched **2D plan** and **3D model** of an interior from one typed scene.
Buyers use AI to model their own home by editing **one file**. Not photoreal; proportional accuracy
is the bar.

## The one rule: edit only `src/design/home.ts`

That file *is* the design (rooms, walls, windows, doors, cabinets, appliances). Everything else is
the **template engine** — do not modify it when changing a layout:

- `src/scene/schema.ts` — Zod schema + types (the contract).
- `src/scene/build.ts` — the authoring DSL you use from `home.ts`. **Reference it; don't change it.**
- `src/scene/{geometry,units,store}.ts` — math, unit formatting, state.
- `src/views/**` — the 2D/3D renderers.

Both views read the same scene, so editing `home.ts` updates both via HMR. The store is the only
engine file that imports from `src/design/`.

## Coordinates

- Inches. Origin at the interior **NW corner**; **+x east, +y south, +z up**.
- Walls are **zero-thickness planes** (no `thickness` field); the centerline == the exact interior
  edge. 3D renders each wall as one flat (double-sided) plane with openings cut out.
- three.js mapping `(x,y,z) → (-x, z, -y)` is handled in the engine; you never deal with it.

## Authoring API (`src/scene/build.ts`)

All **edge/bounds based — no center math**:

```ts
scene({ name, ceiling, walls, openings, rooms, fixtures })    // assemble the whole design
box(id, label, { x:[x0,x1], y:[y0,y1], z:[z0,z1] }, color)    // cabinet / appliance
prism(id, label, [ {x,y}, … ], [z0,z1], color)                // L / diagonal footprints
run({ idPrefix, along:'x'|'y', start, dir:1|-1, band:[d0,d1], z:[z0,z1], color })
   .add(label, width, { color?, z?, id? }).gap(width)         // a packed row; cursor auto-advances
opening(id, wall, type, worldSpan, height, sill?)             // window | door | opening
wall(id, start, end, height) · room(id, name, polygon, color) · rect(xSpan, ySpan)
```

Conventions in `home.ts`: base cabinets `z=BASE` (34.5" tall) 24" deep; uppers `z=UP` (42", top at
ceiling) 12" deep; the wall a fixture sits against fixes its depth `band`. `run` widths go **along**
the wall. `opening` `worldSpan` is the x-range (horizontal walls) or y-range (vertical walls) the
opening covers — `position` is derived. Reuse the color + `BASE`/`UP`/`FULL` + depth-band constants
at the top of `home.ts`. Prefer appending to an existing `run`, or a `box`/`prism` with explicit
edge spans. As a home grows, you can split into `src/design/*` modules that `home.ts` composes.

## Selection (click / tap)

Click or tap any element (wall, opening, room, fixture) in **either** view to select it: its lines turn
blue and a tooltip shows label + dimensions (fixtures W×D×H; rooms W×D + area; walls length×height;
openings W×H). Clicking empty space clears the selection. Tooltip text + the highlight color live in
`src/scene/describe.ts`; this is automatic for any element you add.

## Guardrails / commands

Types + Zod are the safety net. After any edit:

- `npx tsc -b --noEmit` — type-check (run this every time).
- `npm run dev` — dev server with HMR.
- `npm run build` — production build.
