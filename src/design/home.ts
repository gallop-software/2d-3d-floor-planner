import { box, opening, prism, rect, room, run, scene, wall, type Span } from '../scene/build';

/**
 * ═══════════════════════════ YOUR DESIGN — EDIT THIS FILE ═══════════════════════════
 * This is the one file you edit to model your home. The rest of the app (everything in
 * src/scene/* and src/views/*) is the template engine — leave it alone.
 *
 * Everything is in INCHES. Origin = interior NW corner; +x east, +y south, +z up.
 *
 *        (0,0) ┌───────────── 253" ───────────────┐ (253,0)
 *              │                                   │
 *           201"            (interior)             201"
 *     (0,131)  ├───────┐ (101,131)                 │
 *              │  SW    │  Laundry Room (8'5"×5'10")│
 *      (0,201) └───────┴───────────────────────────┘ (253,201)
 *
 * Build elements with the helpers from ../scene/build — all EDGE/BOUNDS based, no center math:
 *   box(id, label, { x:[x0,x1], y:[y0,y1], z:[z0,z1] }, color)   // a cabinet / appliance
 *   prism(id, label, [ {x,y}, … ], [z0,z1], color)               // L / diagonal footprints
 *   run({…}).add(label, width).gap(w).add(…)                     // a packed row of cabinets
 *   opening(id, wall, type, worldSpan, height, sill?)            // window / door / opening
 *   wall(id, start, end, height) · room(id, name, polygon, color) · rect(xSpan, ySpan)
 *   scene({ name, ceiling, walls, openings, rooms, fixtures })   // assemble the whole thing
 *
 * Conventions: base cabinets z=BASE (34.5" tall) 24" deep; uppers z=UP (42", top at ceiling)
 * 12" deep. The wall a fixture sits against fixes its depth band. `run` widths go along the wall;
 * `opening` worldSpan is the x-range (horizontal walls) or y-range (vertical walls) it covers.
 *
 * After editing, run:  npx tsc -b --noEmit
 * ════════════════════════════════════════════════════════════════════════════════════
 */

const HEIGHT = 94; // ceiling (7'10")
const W = 253; // interior E–W (21'1")
const D = 201; // interior N–S (16'9")
const SW_W = 101; // SW laundry pocket E–W (8'5")
const SW_N = D - 70; // its north edge, y=131 (5'10" deep)

// Colors
const FLOOR = '#efe7d5';
const SW_FLOOR = '#e3ddd0';
const CABINET = '#cdbfa6';
const UPPER = '#e7ddc6';
const APPLIANCE = '#c8ccd0'; // stainless
const HOOD = '#bfb8a8';

// Vertical presets (z spans)
const BASE: Span = [0, 34.5]; // base cabinet / counter height
const UP: Span = [52, 94]; // 42" upper, top at ceiling
const FULL: Span = [0, HEIGHT]; // floor-to-ceiling

// Depth bands against a wall (the cross-axis extent of a run/box)
const NORTH_BASE: Span = [0, 24]; // 24" deep from the north wall (y=0)
const NORTH_UP: Span = [0, 12]; // 12" deep uppers on the north wall
const EAST_BASE: Span = [229, 253]; // 24" deep from the east wall (x=253)
const EAST_UP: Span = [241, 253]; // 12" deep uppers on the east wall

// ── Walls (zero-thickness planes; centerline == interior edge) ──────────────
const wN = wall('w_n', { x: 0, y: 0 }, { x: W, y: 0 }, HEIGHT);
const wE = wall('w_e', { x: W, y: 0 }, { x: W, y: D }, HEIGHT);
const wS = wall('w_s', { x: W, y: D }, { x: 0, y: D }, HEIGHT);
const wW = wall('w_w', { x: 0, y: D }, { x: 0, y: 0 }, HEIGHT);
// SW laundry partitions (its west & south edges are the envelope)
const wSWn = wall('w_sw_n', { x: 0, y: SW_N }, { x: SW_W, y: SW_N }, HEIGHT);
const wSWe = wall('w_sw_e', { x: SW_W, y: SW_N }, { x: SW_W, y: D }, HEIGHT);

// ── Cabinet runs (widths go along the wall; the cursor advances automatically) ─
// North wall base run, going west from the lazy susan's west edge (x=217):
const northBase = run({ idPrefix: 'f_nb', along: 'x', start: 217, dir: -1, band: NORTH_BASE, z: BASE, color: CABINET })
  .add('B12', 12)
  .add('Sink 36"', 36)
  .add('DW 24"', 24, { color: APPLIANCE })
  .add('B24', 24)
  .add('B24', 24);

// North wall upper run, west from the corner upper's west edge (x=229):
const northUpper = run({ idPrefix: 'f_nu', along: 'x', start: 229, dir: -1, band: NORTH_UP, z: UP, color: UPPER })
  .add('Upper 18"', 18)
  .gap(48) // over the sink + window
  .add('Upper 33"', 33)
  .add('Upper 33"', 33);

// East wall base run, going south from the lazy susan's south edge (y=36):
const eastBase = run({ idPrefix: 'f_eb', along: 'y', start: 36, dir: 1, band: EAST_BASE, z: BASE, color: CABINET })
  .add('B9', 9)
  .add('Stove 30"', 30, { color: APPLIANCE })
  .add('B18', 18)
  .add('Tall 29"', 29, { z: FULL });

export const home = scene({
  name: 'Kitchen',
  ceiling: HEIGHT,

  walls: [wN, wE, wS, wW, wSWn, wSWe],

  openings: [
    opening('o_n_window_w', wN, 'window', [17, 88], 46, 33), // west window
    opening('o_n_window_e', wN, 'window', [170, 206], 36, 43.5), // east window
    opening('o_se_east', wE, 'opening', [117, 201], HEIGHT), // open SE corner (east wall)
    opening('o_se_south', wS, 'opening', [217, 253], HEIGHT), // open SE corner (south wall)
    opening('o_hall_s', wS, 'opening', [32.5, 64], 79), // laundry pass-through (south)
    opening('o_hall_n', wSWn, 'opening', [32.5, 64], 79), // laundry pass-through (room north)
  ],

  rooms: [
    // Kitchen — L-shape: full box minus the SW laundry pocket.
    room(
      'r_kitchen',
      'Kitchen',
      [
        { x: 0, y: 0 },
        { x: W, y: 0 },
        { x: W, y: D },
        { x: SW_W, y: D },
        { x: SW_W, y: SW_N },
        { x: 0, y: SW_N },
      ],
      FLOOR,
    ),
    room('r_sw', 'Laundry Room', rect([0, SW_W], [SW_N, D]), SW_FLOOR),
  ],

  fixtures: [
    // NE corner lazy susan: L-shaped base + diagonal-faced upper.
    prism(
      'f_ne_ls',
      'Lazy Susan',
      [
        { x: 217, y: 0 },
        { x: 253, y: 0 },
        { x: 253, y: 36 },
        { x: 229, y: 36 },
        { x: 229, y: 24 },
        { x: 217, y: 24 },
      ],
      BASE,
      CABINET,
    ),
    prism(
      'f_ne_ls_upper',
      'Upper Lazy Susan',
      [
        { x: 253, y: 0 },
        { x: 229, y: 0 },
        { x: 229, y: 12 },
        { x: 241, y: 24 },
        { x: 253, y: 24 },
      ],
      UP,
      UPPER,
    ),

    ...northBase.items,
    ...northUpper.items,
    ...eastBase.items,

    // East-wall uppers + vent hood (12" deep against the east wall).
    box('f_e_u21', 'Upper 21"', { x: EAST_UP, y: [24, 45], z: UP }, UPPER),
    box('f_e_hood', 'Vent Hood', { x: EAST_UP, y: [45, 75], z: [66, 94] }, HOOD),
    box('f_e_u18', 'Upper 18"', { x: EAST_UP, y: [75, 93], z: UP }, UPPER),

    // Fridges against the south wall (28" deep → y 173..201).
    box('f_s_fridge', 'Fridge', { x: [173.75, 205], y: [173, 201], z: [0, 69] }, APPLIANCE),
    box('f_s_fridge_2', 'Fridge', { x: [142.25, 173.5], y: [173, 201], z: [0, 69] }, APPLIANCE),

    // Island — two base cabinets, 4' south of the north run (y 72..96).
    box('f_island_w', 'Island 30"', { x: [102.5, 132.5], y: [72, 96], z: BASE }, CABINET),
    box('f_island_e', 'Island 18"', { x: [132.5, 150.5], y: [72, 96], z: BASE }, CABINET),
  ],
});
