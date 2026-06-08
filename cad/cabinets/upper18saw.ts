import { BLEED, type Cabinet, type Hole, type Span } from "../model";

// Upper 18" x 42" x 12" -- the CIRCULAR-SAW build of upper18: the exact same
// cabinet, but every part is a plain rectangle (no one-piece frames with
// windows, no pockets), so each piece is straight cuts with a saw + guide.
//
//   - Face frame: four pieces again -- 1x2 stiles full height, 1x3 rails
//     between them (glued + nailed, like the Woodshop Diaries original).
//   - Door: one solid full-thickness 3/4" rectangle.
//   - Door trim: FOUR 1/4"-ply strips (2" wide) framing the door face --
//     verticals full height, horizontals between them.
//   - Shelf-pin holes stay in the plan as a drilling map (hand drill + jig).
//
// Boards are 4x8 sheets (48 x 96), one per thickness. The layout is
// GUILLOTINE-style in HORIZONTAL ROWS: every part lies with its long side
// along the sheet's 4-foot width, so each long cut is a <=48" crosscut
// guided off the short edge — no 8-foot rips. A 1/2" CUTTING LANE separates
// parts instead of the CNC nest's 1" meat. The lane is the point: a saw
// kerf eats ~1/8" at every line, so the lane lets you cut each part exactly
// TO ITS OWN LINE (one edge cut, the neighbor still has its own line + kerf
// room). And at 2x the bit diameter, the same layout still machines safely
// if you ever run the G-code sheets (toolpaths fill the lane without biting
// neighbors; a 4x8 on the KL744 needs the extension kit).

// ---- cabinet spec (inches) — identical to upper18 ---------------------------
const W = 18;
const H = 42;
const PLY = 0.75;
const BACK_T = 0.25;
const FF_STILE_W = 1.5; // 1x2 stiles
const FF_RAIL_W = 2.5; // 1x3 rails
const SIDE_D = 11.0;
const D = BACK_T + SIDE_D + PLY; // 12"
const DOOR_T = 0.75;
const TRIM_W = 2.0; // door trim strips, 2" wide
const TRIM_T = 0.25;

const zBACK: Span = [0, BACK_T];
const zBOX: Span = [BACK_T, BACK_T + SIDE_D];
const zFF: Span = [BACK_T + SIDE_D, D];
const zDOOR: Span = [D, D + DOOR_T];
const zTRIM: Span = [zDOOR[1], zDOOR[1] + TRIM_T];
const innerX: Span = [PLY, W - PLY]; // 16 1/2"
const doorX: Span = [0, W];
const doorY: Span = [0, H];

// Shelf-pin holes — same map as upper18 (drill these by hand with a jig)
const PIN_DIA = 0.25, PIN_DEPTH = 0.375;
const pinHoles: Hole[] = [];
for (const u of [2, 9.25]) {
  for (let v = 15; v <= 27; v += 3) pinHoles.push({ u, v, dia: PIN_DIA, depth: PIN_DEPTH });
}

// ---- 4x8 guillotine layout, 1/2" lanes --------------------------------------
// Parts lie in HORIZONTAL ROWS with their long sides along the sheet's
// 4-foot width, so every long cut is a <=48" crosscut guided off the short
// edge (no 8-foot rips). Board 1 (3/4"), top row first:
//   row 1-2 (11" tall):  the two sides, one per row
//   row 3   (18"):       the door
//   row 4-5 (1.5"):      the face-frame stiles
//   row 6   (2.5"):      both face-frame rails, side by side
//   row 7   (11"):       top + bottom, side by side
//   row 8   (10.25"):    shelf, with the two supports stacked beside it
// Board 2 (1/4"): back, the two trim sides, then both trim top/bots.
const M = BLEED, LANE = 0.5;
const Y_SIDE_A = M; // 0.25
const Y_SIDE_B = Y_SIDE_A + 11 + LANE; // 11.75
const Y_DOOR = Y_SIDE_B + 11 + LANE; // 23.25
const Y_STILE_A = Y_DOOR + 18 + LANE; // 41.75
const Y_STILE_B = Y_STILE_A + FF_STILE_W + LANE; // 43.75
const Y_RAILS = Y_STILE_B + FF_STILE_W + LANE; // 45.75
const Y_PANELS = Y_RAILS + FF_RAIL_W + LANE; // 48.75
const Y_SHELF = Y_PANELS + 11 + LANE; // 60.25 .. 70.5
// board 2 rows
const Y_TRIM_A = M + 18 + LANE; // 18.75 — below: the 18"-tall back
const Y_TRIM_B = Y_TRIM_A + TRIM_W + LANE; // 21.25
const Y_TRIM_C = Y_TRIM_B + TRIM_W + LANE; // 23.75

export const upper18saw: Cabinet = {
  id: "upper18saw",
  name: 'Upper 18" (circular saw)',
  info: 'Upper 18" x 42" x 12" - circular-saw build: every part a plain rectangle, one 4x8 per thickness, 1/2" cutting lanes',
  gap: LANE, // saw lanes instead of CNC meat (still 2x the bit dia — G-code safe)
  layers: [
    { name: "BOX", color: "#dcc89c" },
    { name: "SUPPORTS", color: "#c9ab72" },
    { name: "SHELF", color: "#cfc08e" },
    { name: "BACK", color: "#efe7d0" },
    { name: "FACE FRAME", color: "#a8b6bf" },
    { name: "DOOR", color: "#8ea4b0" },
    { name: "HARDWARE", color: "#3f464e" },
    { name: "DIMS", color: "#6b7280" },
  ],
  boards: [
    { label: 'Board 1 - 3/4" ply 4x8', material: '3/4" ply', size: [48, 96] },
    { label: 'Board 2 - 1/4" ply 4x8', material: '1/4" ply', size: [48, 96] },
  ],
  parts: [
    // ---- rows 1-2: the two sides, lying long-side along the 4' width
    { label: 'SIDE - 11" x 42" (3/4" PLY)', layer: "BOX", explode: [-9, 0, 0],
      box: { x: [0, PLY], y: [0, H], z: zBOX },
      holes: pinHoles, holesFace: "max",
      nest: { board: 0, at: [M, Y_SIDE_A], longAxis: "x" } },
    { label: 'SIDE - 11" x 42" (3/4" PLY)', layer: "BOX", explode: [9, 0, 0],
      box: { x: [W - PLY, W], y: [0, H], z: zBOX },
      holes: pinHoles, holesFace: "min",
      nest: { board: 0, at: [M, Y_SIDE_B], longAxis: "x" } },

    // ---- row 7: top + bottom side by side
    { label: 'TOP - 16-1/2" x 11"', layer: "BOX", explode: [0, 9, 0],
      box: { x: innerX, y: [H - PLY, H], z: zBOX },
      nest: { board: 0, at: [M, Y_PANELS], longAxis: "x" } },
    { label: 'BOTTOM - 16-1/2" x 11"', layer: "BOX", explode: [0, -4.5, 0],
      box: { x: innerX, y: [1.5, 1.5 + PLY], z: zBOX },
      nest: { board: 0, at: [M + 16.5 + LANE, Y_PANELS], longAxis: "x" } },

    // ---- row 8: shelf, with the supports stacked beside it
    { label: 'ADJ SHELF - 16-1/2" x 10-1/4"', layer: "SHELF", explode: [0, 0, 2.5],
      box: { x: innerX, y: [21, 21 + PLY], z: [zBOX[0] + 0.25, zBOX[1] - 0.5] },
      nest: { board: 0, at: [M, Y_SHELF], longAxis: "x" } },
    { label: 'TOP SUPPORT - 16-1/2" x 3-1/2"', layer: "SUPPORTS", explode: [0, 4.5, 0],
      box: { x: innerX, y: [H - PLY - 3.5, H - PLY], z: [zBOX[0], zBOX[0] + PLY] },
      nest: { board: 0, at: [M + 16.5 + LANE, Y_SHELF], longAxis: "x" } },
    { label: 'BOTTOM SUPPORT - 16-1/2" x 1-1/2"', layer: "SUPPORTS", explode: [0, -8.5, 0],
      box: { x: innerX, y: [0, 1.5], z: [zBOX[0], zBOX[0] + PLY] },
      nest: { board: 0, at: [M + 16.5 + LANE, Y_SHELF + 3.5 + LANE], longAxis: "x" } },

    // ---- row 3: the door
    { label: 'DOOR - 18" x 42" (FULL OVERLAY, SOLID 3/4")', layer: "DOOR", explode: [0, 0, 17],
      box: { x: doorX, y: doorY, z: zDOOR },
      nest: { board: 0, at: [M, Y_DOOR], longAxis: "x" } },

    // ---- row 6: both face-frame rails side by side
    { label: 'FACE FRAME RAIL (1x3) - 15" x 2-1/2"', layer: "FACE FRAME", explode: [0, 2.5, 8],
      box: { x: [FF_STILE_W, W - FF_STILE_W], y: [H - FF_RAIL_W, H], z: zFF },
      nest: { board: 0, at: [M, Y_RAILS], longAxis: "x" } },
    { label: 'FACE FRAME RAIL (1x3) - 15" x 2-1/2"', layer: "FACE FRAME", explode: [0, -2.5, 8],
      box: { x: [FF_STILE_W, W - FF_STILE_W], y: [0, FF_RAIL_W], z: zFF },
      nest: { board: 0, at: [M + 15 + LANE, Y_RAILS], longAxis: "x" } },

    // ---- rows 4-5: the face-frame stiles
    { label: 'FACE FRAME STILE (1x2) - 42" x 1-1/2"', layer: "FACE FRAME", explode: [-2.5, 0, 8],
      box: { x: [0, FF_STILE_W], y: [0, H], z: zFF },
      nest: { board: 0, at: [M, Y_STILE_A], longAxis: "x" } },
    { label: 'FACE FRAME STILE (1x2) - 42" x 1-1/2"', layer: "FACE FRAME", explode: [2.5, 0, 8],
      box: { x: [W - FF_STILE_W, W], y: [0, H], z: zFF },
      nest: { board: 0, at: [M, Y_STILE_B], longAxis: "x" } },

    // ---- door trim: four 1/4" strips framing the door face (board 2 rows)
    { label: 'DOOR TRIM SIDE - 42" x 2" (1/4" PLY)', layer: "DOOR", explode: [-1.5, 0, 24],
      box: { x: [0, TRIM_W], y: doorY, z: zTRIM },
      nest: { board: 1, at: [M, Y_TRIM_A], longAxis: "x" } },
    { label: 'DOOR TRIM SIDE - 42" x 2" (1/4" PLY)', layer: "DOOR", explode: [1.5, 0, 24],
      box: { x: [W - TRIM_W, W], y: doorY, z: zTRIM },
      nest: { board: 1, at: [M, Y_TRIM_B], longAxis: "x" } },
    { label: 'DOOR TRIM TOP/BOT - 14" x 2" (1/4" PLY)', layer: "DOOR", explode: [0, 1.5, 24],
      box: { x: [TRIM_W, W - TRIM_W], y: [H - TRIM_W, H], z: zTRIM },
      nest: { board: 1, at: [M, Y_TRIM_C], longAxis: "x" } },
    { label: 'DOOR TRIM TOP/BOT - 14" x 2" (1/4" PLY)', layer: "DOOR", explode: [0, -1.5, 24],
      box: { x: [TRIM_W, W - TRIM_W], y: [0, TRIM_W], z: zTRIM },
      nest: { board: 1, at: [M + 14 + LANE, Y_TRIM_C], longAxis: "x" } },

    // ---- back: 1/4" ply, stapled over the back (row 1 of board 2)
    { label: '1/4" BACK - 18" x 42" (STAPLED OVER)', layer: "BACK", explode: [0, 0, -9],
      box: { x: [0, W], y: [0, H], z: zBACK },
      nest: { board: 1, at: [M, M], longAxis: "x" } },
  ],
  hardware: [
    { label: "DOOR KNOB (HARDWARE - NOT CUT)", layer: "HARDWARE", kind: "knob",
      at: [doorX[1] - 1, doorY[0] + 2, zTRIM[1]], explode: [0, 0, 31] },
  ],
  dims: [
    { a: [0, H, zDOOR[0]], b: [W, H, zDOOR[0]], off: [0, 4.2, 0], text: '18"' },
    { a: [0, 0, zDOOR[0]], b: [0, H, zDOOR[0]], off: [-2.4, 0, 0], text: '42"' },
    { a: [W, H, 0], b: [W, H, D], off: [1.6, 1.6, 0], text: '12" incl. face frame' },
    { a: [W, H, 0], b: [W, H, zTRIM[1]], off: [3.4, 3.4, 0], text: '13" incl. door + trim' },
  ],
};
