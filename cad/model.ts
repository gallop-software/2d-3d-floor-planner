// Single source of truth for cabinet CAD: a Cabinet describes every part ONCE
// (its assembled 3D box + where it nests on a board); the 3D view renders the
// boxes and the DXF cut files are generated from the same data at runtime.
//
// Target machine: Shapeoko Pro 5 / Carbide Motion (48 x 48 work area). Cut with a 1/4" bit.
// The DXF holds TRUE finished part outlines -- let your CAM apply the
// bit-radius offset (outside profile); there is NO toolpath baked in.
// POCKET_* layers are partial-depth clears (NOT through cuts) with the depth
// in the layer name itself (e.g. POCKET_5-16_DEEP), since layer names import
// into CAM operations and text labels don't; the depth is also written next
// to each pocket on the LABELS layer for the operator.

export type Span = [number, number];
export type XYZ = [number, number, number];

// ---- CNC parameters ---------------------------------------------------------
export const BIT_DIA = 8 / 25.4; // 8mm main cutting bit (~0.315") — profiles + pockets
export const BIT_LABEL = "8mm"; // human label for the main bit (8mm is ugly as inches)
export const DRILL_DIA = 0.25; // 1/4" bit, used ONLY for the shelf-pin holes (a 1/4"
//                                hole needs a 1/4" bit — the 8mm cutter can't make it)
export const DRILL_LABEL = '1/4"';
export const BLEED = 0.75; // margin kept clear of every board edge — wide enough
//                            that holding tabs on edge-nested parts anchor into
//                            solid waste (was 0.25", too thin to hold a tab)
export const GAP = 1.0; // space between parts: cutting the OUTSIDE of each
//                         part eats BIT_DIA off each side, so this leaves
//                         ~GAP - 2*BIT_DIA of solid meat between cuts.

export interface PartBox { x: Span; y: Span; z: Span }

// A blind hole drilled into the part's face-up side, in PART-LOCAL cut
// coordinates: u along the part's SHORT axis, v along its LONG axis (both
// from the outline's lower-left). holeXY() maps them onto the board per the
// nest orientation. Must match the bit diameter — the CNC plunge-drills them.
export interface Hole { u: number; v: number; dia: number; depth: number }

// board-relative (x, y) of a hole, honoring the part's nest orientation
export function holeXY(p: Part, hl: Hole): [number, number] {
  return p.nest.longAxis === "x" ? [hl.v, hl.u] : [hl.u, hl.v];
}

export interface Part {
  label: string; // shown in the 3D exploded callout AND on the DXF (keep ASCII for CAM)
  layer: string; // 3D legend group (must exist in Cabinet.layers)
  box: PartBox; // assembled position, inches (origin at cabinet's left/bottom/back)
  explode: XYZ; // direction the part flies in the exploded view
  pocket?: { inset: number; depth: number }; // pocket cleared into the FRONT (+z) face, inset from all edges
  cutout?: { insetU: number; insetV: number }; // centered THROUGH window (one-piece
  //            frames): insets along the cut axes (u = short, v = long). The
  //            window is profile-cut with holding tabs before the outer profile.
  holes?: Hole[]; // blind holes (e.g. shelf pins), drilled before any cutting
  holesFace?: "min" | "max"; // which thickness face the holes open onto (3D rendering only)
  nest: {
    board: number; // index into Cabinet.boards
    at: [number, number]; // lower-left corner on the board
    longAxis?: "x" | "y"; // which board axis the part's LONG dimension runs along (default "y")
  };
}

// Non-wood / non-cut items (knobs, hinges, pins…): they live in the 3D view
// with their own explode and label, but never appear on a board, in a DXF,
// or in the G-code.
export interface Hardware {
  label: string;
  layer: string; // 3D legend group (must exist in Cabinet.layers)
  kind: "knob"; // shape vocabulary — extend as more hardware shows up
  at: XYZ; // anchor point (knob: base center on the face it mounts to, +z out)
  explode: XYZ;
}

export interface Board {
  label: string; // tab label, e.g. 'Board 1 — 3/4" ply'
  material: string; // thickness note; parts of one thickness per board
  size: [number, number]; // work area, inches (4x4 = [48, 48])
  cutThickness?: number; // ACTUAL measured stock thickness, for through-cut
  //   DEPTH only — overrides the nominal modeled thickness so real undersized
  //   sheet goods cut all the way through without grinding the spoilboard.
  //   The 3D model + part sizes still use the nominal thickness.
}

export interface DimSpec { a: XYZ; b: XYZ; off: XYZ; text: string }

export interface Cabinet {
  id: string; // url slug + download filename prefix
  name: string; // dropdown label
  info: string; // one-line description, shown by the toolbar's info button
  gap?: number; // part spacing on the boards (default GAP). Tighter layouts
  //               (e.g. saw-cut lanes) may use less — never below 2x the bit
  //               diameter if the G-code will also be run.
  layers: { name: string; color: string }[]; // 3D legend, in display order
  boards: Board[];
  parts: Part[];
  hardware?: Hardware[]; // 3D-only items, excluded from all cut outputs
  dims: DimSpec[]; // overall dimension callouts (assembled 3D view)
}

// ---- derived cut geometry ---------------------------------------------------
// A part's outline is its two largest box dimensions (the smallest is the
// material thickness); nest.longAxis picks its orientation on the board.
export function cutSize(p: Part): { w: number; h: number; thick: number } {
  const dims = [
    p.box.x[1] - p.box.x[0],
    p.box.y[1] - p.box.y[0],
    p.box.z[1] - p.box.z[0],
  ].sort((a, b) => a - b);
  const [thick, short, long] = dims;
  return p.nest.longAxis === "x" ? { w: long, h: short, thick } : { w: short, h: long, thick };
}

export const frac = (v: number): string => {
  const whole = Math.floor(v + 1e-9);
  let n = Math.round((v - whole) * 16), d = 16;
  if (n === 16) return `${whole + 1}"`;
  while (n > 0 && n % 2 === 0) { n /= 2; d /= 2; }
  if (!n) return `${whole}"`;
  return whole ? `${whole}-${n}/${d}"` : `${n}/${d}"`;
};

// ---- nest validation --------------------------------------------------------
// Keeps the "enough meat" guarantee honest as cabinets get added: every part
// inside the bleed, a full GAP between any two parts on the same board.
export function validateNest(cab: Cabinet): string[] {
  const errs: string[] = [];
  const minGap = cab.gap ?? GAP;
  cab.boards.forEach((board, bi) => {
    const rects = cab.parts
      .filter((p) => p.nest.board === bi)
      .map((p) => {
        const { w, h } = cutSize(p);
        const [x, y] = p.nest.at;
        return { p, label: p.label, x0: x, y0: y, x1: x + w, y1: y + h };
      });
    // is `inner` fully inside `outer`'s window, with a GAP of meat to the walls?
    const insideWindow = (inner: typeof rects[number], outer: typeof rects[number]) => {
      const c = outer.p.cutout;
      if (!c) return false;
      const wx0 = outer.x0 + c.insetU + minGap, wy0 = outer.y0 + c.insetV + minGap;
      const wx1 = outer.x1 - c.insetU - minGap, wy1 = outer.y1 - c.insetV - minGap;
      return inner.x0 >= wx0 - 1e-9 && inner.y0 >= wy0 - 1e-9 &&
             inner.x1 <= wx1 + 1e-9 && inner.y1 <= wy1 + 1e-9;
    };
    for (const r of rects) {
      if (r.x0 < BLEED - 1e-9 || r.y0 < BLEED - 1e-9 ||
          r.x1 > board.size[0] - BLEED + 1e-9 || r.y1 > board.size[1] - BLEED + 1e-9) {
        errs.push(`${cab.id} ${board.label}: "${r.label}" outside the bleed`);
      }
    }
    // holes: drillable with this bit, and inside their part's outline
    for (const p of cab.parts.filter((p) => p.nest.board === bi)) {
      const { w, h } = cutSize(p);
      if (p.cutout) {
        const ww = w - 2 * p.cutout.insetU, wh = h - 2 * p.cutout.insetV;
        if (ww <= 2 * BIT_DIA || wh <= 2 * BIT_DIA) {
          errs.push(`${cab.id} ${board.label}: "${p.label}" window ${ww}" x ${wh}" too small for the ${BIT_DIA}" bit`);
        }
      }
      for (const hole of p.holes ?? []) {
        if (Math.abs(hole.dia - DRILL_DIA) > 1e-9) {
          errs.push(`${cab.id} ${board.label}: "${p.label}" hole dia ${hole.dia}" != drill bit ${DRILL_DIA}" (only plunge-drilling is supported)`);
        }
        const [hx, hy] = holeXY(p, hole);
        if (hx < hole.dia / 2 || hx > w - hole.dia / 2 ||
            hy < hole.dia / 2 || hy > h - hole.dia / 2) {
          errs.push(`${cab.id} ${board.label}: "${p.label}" hole at (${hole.u}, ${hole.v}) outside the part`);
        }
      }
    }
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i], b = rects[j];
        const gap = Math.max(a.x0 - b.x1, b.x0 - a.x1, a.y0 - b.y1, b.y0 - a.y1);
        if (gap < minGap - 1e-9) {
          // nesting a part INSIDE another's window is fine (the inner part is
          // profile-cut before the window perimeter, in definition order)
          if (insideWindow(a, b) || insideWindow(b, a)) continue;
          errs.push(`${cab.id} ${board.label}: "${a.label}" vs "${b.label}" gap ${gap.toFixed(2)}" < ${minGap}"`);
        }
      }
    }
  });
  return errs;
}

// ---- per-board shapes ---------------------------------------------------------
// The structured geometry of one board: what the DXF writer emits and what the
// interactive 2D viewer renders (tagged with the owning part for selection).
const LABEL_H = 1.2; // inches

export interface ShapeNote { x: number; y: number; text: string; rot?: number }
export interface BoardShape {
  part: number; // index into Cabinet.parts
  rect: { x: number; y: number; w: number; h: number }; // finished outline
  label: ShapeNote;
  pocket?: { rect: { x: number; y: number; w: number; h: number }; layer: string; note: ShapeNote };
  cutout?: { rect: { x: number; y: number; w: number; h: number }; note: ShapeNote }; // through window (PARTS layer)
  drills?: { holes: { x: number; y: number; r: number }[]; layer: string; note: ShapeNote };
}

// depth rides in the layer name (CAM imports layers, not text): DRILL_3-8_DEEP
const depthLayer = (prefix: string, depth: number): string =>
  `${prefix}_${frac(depth).replace('"', "").replace("/", "-")}_DEEP`;

export function boardShapes(cab: Cabinet, boardIdx: number): BoardShape[] {
  const out: BoardShape[] = [];
  cab.parts.forEach((p, pi) => {
    if (p.nest.board !== boardIdx) return;
    const { w: pw, h: ph } = cutSize(p);
    const [x0, y0] = p.nest.at;
    // tall, narrow part: run the label bottom-to-top up the part
    const label: ShapeNote = ph > pw * 1.5 && pw < 8
      ? { x: x0 + pw / 2 - LABEL_H / 2, y: y0 + 2, text: p.label, rot: 90 }
      : { x: x0 + 0.5, y: y0 + ph / 2, text: p.label };
    const shape: BoardShape = { part: pi, rect: { x: x0, y: y0, w: pw, h: ph }, label };
    if (p.pocket) {
      const { inset, depth } = p.pocket;
      shape.pocket = {
        rect: { x: x0 + inset, y: y0 + inset, w: pw - 2 * inset, h: ph - 2 * inset },
        layer: depthLayer("POCKET", depth),
        note: { x: x0 + inset + 0.5, y: y0 + inset + 0.5, text: `POCKET - CLEAR ${frac(depth)} DEEP (NOT THROUGH)` },
      };
    }
    if (p.cutout) {
      const { insetU, insetV } = p.cutout;
      shape.cutout = {
        rect: { x: x0 + insetU, y: y0 + insetV, w: pw - 2 * insetU, h: ph - 2 * insetV },
        note: { x: x0 + insetU + 0.5, y: y0 + insetV + 0.5, text: "WINDOW - CUT THROUGH (TABBED OFFCUT)" },
      };
    }
    if (p.holes?.length) {
      const h0 = p.holes[0];
      shape.drills = {
        holes: p.holes.map((hl) => {
          const [hx, hy] = holeXY(p, hl);
          return { x: x0 + hx, y: y0 + hy, r: hl.dia / 2 };
        }),
        layer: depthLayer("DRILL", h0.depth),
        note: { x: x0 + 0.5, y: y0 + ph / 2 - 2, text: `${p.holes.length} SHELF-PIN HOLES - ${frac(h0.dia)} DIA x ${frac(h0.depth)} DEEP` },
      };
    }
    out.push(shape);
  });
  return out;
}

// ---- DXF writer (R12 ASCII, inches, 1:1) ------------------------------------
// Layers: SHEET (work area), BLEED (keep-out), PARTS (through cuts),
// POCKET_*/DRILL_* (partial-depth ops, depth in the layer name), LABELS.

function dxfPoly(pts: [number, number][], layer: string, closed = true): string[] {
  const out = ["0", "POLYLINE", "8", layer, "66", "1", "70", closed ? "1" : "0"];
  for (const [x, y] of pts) {
    out.push("0", "VERTEX", "8", layer, "10", x.toFixed(4), "20", y.toFixed(4));
  }
  out.push("0", "SEQEND");
  return out;
}

function dxfCircle(x: number, y: number, r: number, layer: string): string[] {
  return ["0", "CIRCLE", "8", layer, "10", x.toFixed(4), "20", y.toFixed(4), "40", r.toFixed(4)];
}

function dxfText(x: number, y: number, h: number, value: string, layer: string, rot = 0): string[] {
  const out = ["0", "TEXT", "8", layer, "10", x.toFixed(4), "20", y.toFixed(4), "40", h.toFixed(4)];
  if (rot) out.push("50", rot.toFixed(4));
  out.push("1", value);
  return out;
}

const rect = (x: number, y: number, w: number, h: number): [number, number][] =>
  [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

export function boardToDXF(cab: Cabinet, boardIdx: number): string {
  const board = cab.boards[boardIdx];
  const [w, h] = board.size;
  const body = ["0", "SECTION", "2", "ENTITIES"];
  body.push(...dxfPoly(rect(0, 0, w, h), "SHEET"));
  body.push(...dxfPoly(rect(BLEED, BLEED, w - 2 * BLEED, h - 2 * BLEED), "BLEED"));

  const note = (n: ShapeNote) => dxfText(n.x, n.y, LABEL_H, n.text, "LABELS", n.rot ?? 0);
  for (const s of boardShapes(cab, boardIdx)) {
    body.push(...dxfPoly(rect(s.rect.x, s.rect.y, s.rect.w, s.rect.h), "PARTS"));
    if (s.pocket) {
      // map this layer to a pocket/clear op at that depth, NOT a through profile
      body.push(...dxfPoly(rect(s.pocket.rect.x, s.pocket.rect.y, s.pocket.rect.w, s.pocket.rect.h), s.pocket.layer));
      body.push(...note(s.pocket.note));
    }
    if (s.cutout) {
      // a through window — same PARTS layer as any other through profile
      body.push(...dxfPoly(rect(s.cutout.rect.x, s.cutout.rect.y, s.cutout.rect.w, s.cutout.rect.h), "PARTS"));
      body.push(...note(s.cutout.note));
    }
    if (s.drills) {
      // blind drill points (shelf pins etc.) — plunge-drill, NOT through
      for (const hole of s.drills.holes) body.push(...dxfCircle(hole.x, hole.y, hole.r, s.drills.layer));
      body.push(...note(s.drills.note));
    }
    body.push(...note(s.label));
  }
  body.push("0", "ENDSEC", "0", "EOF");
  return body.join("\n") + "\n";
}
