import { BLEED, GAP, type Cabinet, type Hole, type Span } from "../model";

// Upper 18" x 42" x 12" -- Woodshop Diaries-style face-frame upper.
// THE single source of truth: every part is defined once here; the 3D view
// renders these boxes and the board DXFs are generated from the same data
// (cut outlines are derived from each part's box + nest placement).
//
// Construction: 3/4" ply box (11"-deep sides), 1/4" back stapled over the
// back. The face frame is ONE SOLID 3/4" piece, 18" x 42", with a 15" x 37"
// window cut through the center -- the borders read as 1x2 stiles (1-1/2")
// and 1x3 rails (2-1/2"). Single FULL-overlay door covering the entire face:
// one solid 3/4" piece, FULL thickness everywhere (no pocket). The shaker
// look comes from a 1/4"-ply TRIM FRAME (18" x 42" ring, 14" x 38" window,
// 2" borders) cut on the 1/4" board and glued around the door's face.
//
//   1/4 back + 11 sides + 3/4 face strips = 12" deep; the door adds 3/4".

// ---- cabinet spec (inches) --------------------------------------------------
const W = 18; // overall width
const H = 42; // overall height (top at ceiling)
const PLY = 0.75; // 3/4" plywood carcass + face frame + door
const BACK_T = 0.25; // 1/4" back, stapled over the back
const FF_STILE_W = 1.5; // the frame's side borders (1x2 look)
const FF_RAIL_W = 2.5; // the frame's top/bottom borders (1x3 look)
const SIDE_D = 11.0; // side depth, so 1/4 + 11 + 3/4 = 12" overall
const D = BACK_T + SIDE_D + PLY; // 12" -- includes the face frame
const DOOR_T = 0.75;
const TRIM_INSET = 2.0; // the door trim's borders (looks like 2" stiles/rails)
const TRIM_T = 0.25; // 1/4" ply trim frame glued on the door face

const zBACK: Span = [0, BACK_T];
const zBOX: Span = [BACK_T, BACK_T + SIDE_D]; // 0.25 .. 11.25
const zFF: Span = [BACK_T + SIDE_D, D]; // 11.25 .. 12
const zDOOR: Span = [D, D + DOOR_T]; // 12 .. 12.75
const zTRIM: Span = [zDOOR[1], zDOOR[1] + TRIM_T]; // 12.75 .. 13 — on the door face
const innerX: Span = [PLY, W - PLY]; // between the sides: 16 1/2"
const doorX: Span = [0, W]; // FULL overlay — the door covers the whole face
const doorY: Span = [0, H];

// ---- nest (two 4x4 boards of 3/4", one of 1/4") ------------------------------
// Board 1: sides + door as full-height columns (11 + 11 + 18 = 40" + gaps =
// 42" of the 47.5" usable). Board 2: the one-piece face frame (18 x 42) with
// the TOP and BOTTOM panels nested INSIDE its 15 x 37 window (stood on end,
// 11 x 16.5 each, 1" meat to the window walls — they're profile-cut before
// the window perimeter because they come earlier in this array), and the
// shelf + supports beside it. Two 3/4" boards is the floor: the 3/4" parts
// total ~2400 in2, more than one board's usable 47.5 x 47.5.
const M = BLEED, G = GAP;
const X_SIDE_B = M + SIDE_D + G; // 12.25
const X_DOOR = X_SIDE_B + SIDE_D + G; // 24.25 .. 42.25
const X_STACK = M + W + G; // 19.25 -- board 2, right of the face frame
const X_TRIM = M + W + G; // 19.25 -- board 3, right of the back panel
// inside the face frame's window (window: x 1.75..16.75, y 2.75..39.75)
const X_IN_WIN = M + FF_STILE_W + G; // 2.75 -- 1" of meat off the window wall
const Y_IN_WIN = M + FF_RAIL_W + G; // 3.75

// Shelf-pin holes (Kreg-style 1/4" jig, woodshopdiaries adjustable-shelves
// method), drilled into each side's inner face: back row 2" from the back
// edge; front row 1" closer to the back than the shelf depth
// (10-1/4" shelf -> 9-1/4" from the back). Heights 15".."27" on 3" centers —
// symmetric about mid-height, so the mirrored right panel lines up no
// matter which way it's flipped off the machine.
const PIN_DIA = 0.25, PIN_DEPTH = 0.375;
const pinHoles: Hole[] = [];
for (const u of [2, 9.25]) {
  for (let v = 15; v <= 27; v += 3) pinHoles.push({ u, v, dia: PIN_DIA, depth: PIN_DEPTH });
}

export const upper18: Cabinet = {
  id: "upper18",
  name: 'Upper 18" (cnc)',
  info: 'Upper 18" x 42" x 12" - 3/4" ply, one-piece face frame (15" x 37" window), full-thickness door + 1/4" trim frame',
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
    { label: 'Board 1 - 3/4" ply', material: '3/4" ply', size: [48, 48] },
    { label: 'Board 2 - 3/4" ply', material: '3/4" ply', size: [48, 48] },
    { label: 'Board 3 - 1/4" ply', material: '1/4" ply', size: [48, 48] },
  ],
  parts: [
    // ---- box (3/4" ply). The top is flush with the top of the sides; the
    // bottom SITS ON the 1-1/2" bottom support, so it isn't flush underneath.
    // Both supports sit vertically against the BACK (they're the cleats you
    // screw through into the wall studs).
    { label: 'SIDE - 11" x 42" (3/4" PLY)', layer: "BOX", explode: [-9, 0, 0],
      box: { x: [0, PLY], y: [0, H], z: zBOX },
      holes: pinHoles, holesFace: "max", // pins open onto the inner (+x) face
      nest: { board: 0, at: [M, M] } },
    { label: 'SIDE - 11" x 42" (3/4" PLY)', layer: "BOX", explode: [9, 0, 0],
      box: { x: [W - PLY, W], y: [0, H], z: zBOX },
      holes: pinHoles, holesFace: "min", // mirrored: inner face is -x
      nest: { board: 0, at: [X_SIDE_B, M] } },
    // top + bottom nest INSIDE the face frame's window, stood on end
    { label: 'TOP - 16-1/2" x 11"', layer: "BOX", explode: [0, 9, 0],
      box: { x: innerX, y: [H - PLY, H], z: zBOX },
      nest: { board: 1, at: [X_IN_WIN, Y_IN_WIN] } },
    { label: 'BOTTOM - 16-1/2" x 11"', layer: "BOX", explode: [0, -4.5, 0],
      box: { x: innerX, y: [1.5, 1.5 + PLY], z: zBOX },
      nest: { board: 1, at: [X_IN_WIN, Y_IN_WIN + 16.5 + G] } },
    { label: 'ADJ SHELF - 16-1/2" x 10-1/4"', layer: "SHELF", explode: [0, 0, 2.5],
      box: { x: innerX, y: [21, 21 + PLY], z: [zBOX[0] + 0.25, zBOX[1] - 0.5] },
      nest: { board: 1, at: [X_STACK, M], longAxis: "x" } },
    { label: 'TOP SUPPORT - 16-1/2" x 3-1/2"', layer: "SUPPORTS", explode: [0, 4.5, 0],
      box: { x: innerX, y: [H - PLY - 3.5, H - PLY], z: [zBOX[0], zBOX[0] + PLY] },
      nest: { board: 1, at: [X_STACK, M + 10.25 + G], longAxis: "x" } },
    { label: 'BOTTOM SUPPORT - 16-1/2" x 1-1/2"', layer: "SUPPORTS", explode: [0, -8.5, 0],
      box: { x: innerX, y: [0, 1.5], z: [zBOX[0], zBOX[0] + PLY] },
      nest: { board: 1, at: [X_STACK, M + 10.25 + G + 3.5 + G], longAxis: "x" } },

    // ---- face frame: ONE solid piece, the 15" x 37" window cut through —
    // its borders read as 1x2 stiles and 1x3 rails, flush with the box edges
    { label: 'FACE FRAME - 18" x 42" (ONE PIECE, 15" x 37" WINDOW)', layer: "FACE FRAME", explode: [0, 0, 8],
      box: { x: [0, W], y: [0, H], z: zFF },
      cutout: { insetU: FF_STILE_W, insetV: FF_RAIL_W },
      nest: { board: 1, at: [M, M] } },

    // ---- door: ONE solid 3/4" piece; the CNC clears the center box
    { label: 'DOOR - 18" x 42" (FULL OVERLAY, SOLID 3/4")', layer: "DOOR", explode: [0, 0, 17],
      box: { x: doorX, y: doorY, z: zDOOR },
      nest: { board: 0, at: [X_DOOR, M] } },
    // 1/4" trim frame glued around the door's face — the shaker profile is
    // ADDED instead of pocketed, so the door stays full 3/4" everywhere
    { label: 'DOOR TRIM - 18" x 42" (1/4" PLY, 14" x 38" WINDOW)', layer: "DOOR", explode: [0, 0, 24],
      box: { x: doorX, y: doorY, z: zTRIM },
      cutout: { insetU: TRIM_INSET, insetV: TRIM_INSET },
      nest: { board: 2, at: [X_TRIM, M] } },

    // ---- back: 1/4" ply, stapled over the back (its own board -- thickness
    // can never mix with the 3/4" parts on one sheet)
    { label: '1/4" BACK - 18" x 42" (STAPLED OVER)', layer: "BACK", explode: [0, 0, -9],
      box: { x: [0, W], y: [0, H], z: zBACK },
      nest: { board: 2, at: [M, M] } },
  ],
  // 3D-only items — in the drawing and the exploded view, never in cut plans
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
