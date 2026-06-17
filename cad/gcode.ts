import { BIT_DIA, BIT_LABEL, DRILL_DIA, DRILL_LABEL, cutSize, holeXY, type Cabinet } from "./model";

// CAM for the Shapeoko Pro 5 / Carbide Motion (GRBL): turns a Cabinet's board nest into
// G-code ready for Universal Gcode Sender. Same single source of truth —
// toolpaths are derived from the cabinet definition, never hand-edited.
//
// Setup assumed by the output:
//   - units: inches (G20), absolute (G90)
//   - X0 Y0 at the board's lower-left corner, Z0 at the TOP of the stock
//   - 1/4" upcut bit; 65mm VFD spindle (RPM set by the file's S word)
//
// Order of operations per board: POCKETS first (parts still fully captive),
// then outside PROFILES with holding tabs on the final passes so freed
// parts can't shift into the bit. Cut the tabs free with a chisel.

export const CAM = {
  bitDia: BIT_DIA, // 8mm main cutter — profiles + pockets (model.ts owns the size)
  bitLabel: BIT_LABEL, // "8mm"
  drillDia: DRILL_DIA, // 1/4" bit, plunge-drills the shelf-pin holes only
  drillLabel: DRILL_LABEL, // '1/4"'
  // shallow-and-fast: belt-driven machines like the Shapeoko cut cleanest with
  // small bites at a brisk feed (these feeds are conservative — the rigid Pro 5
  // can go faster, but this stays safe across hold-downs and thin offcuts)
  feed: 80, // cutting feed, in/min
  plunge: 20, // plunge feed, in/min
  rapidRate: 150, // only used for the time estimate
  passDepth: 0.05, // depth per pass (3/4" ply = ~15 passes)
  overcut: 0, // real sheet goods run UNDER nominal (3/4" ply is ~23/32", 1/4" is
  //             ~7/32"), so cutting to the NOMINAL thickness already passes ~1/32"
  //             past the real bottom — through-cuts go to 0.75"/0.25", not deeper
  stepoverFrac: 0.45, // pocket stepover as a fraction of bit diameter
  safeZ: 1.0, // travel between cuts at this height — clears warped stock, chips
  //             (1" not 0.75" so the travel height reads distinct from cut depth)
  retractZ: 3.0, // FULL retract at job start + end (clears clamps, fingers) —
  //               matches the Shapeoko-style lead-in/out the operator expects
  clearZ: 0.1, // rapid down to here before each plunge (then feed), so the
  //              high travel doesn't cost slow feed-down time
  tabH: 0.12, // holding tab height (left on the final passes)
  tabL: 0.4, // holding tab length (plus a bit diameter of travel)
  tabEvery: 16, // ~one tab per this many inches of edge
};

export interface ToolpathSeg { x0: number; y0: number; x1: number; y1: number; rapid: boolean; color?: string; part?: number }
export interface ToolpathLabel { x: number; y: number; text: string; rot?: number; part: number }
export interface CamJob {
  gcode: string;
  view: { segs: ToolpathSeg[]; plunges: [number, number][]; labels: ToolpathLabel[] };
  stats: { minutes: number; lines: number };
}

const F = (v: number) => v.toFixed(4).replace(/0+$/, "0"); // keep at least one decimal
const passes = (n: number, caps = false) => `${n} ${caps ? "PASS" : "pass"}${n === 1 ? "" : caps ? "ES" : "es"}`;

export function camBoard(cab: Cabinet, boardIdx: number): CamJob {
  const board = cab.boards[boardIdx];
  const parts = cab.parts.filter((p) => p.nest.board === boardIdx);
  const r = CAM.bitDia / 2; // 8mm main cutter radius (profiles + pockets)
  const step = CAM.bitDia * CAM.stepoverFrac;
  // shelf-pin holes need the 1/4" bit, so a board that has them runs the drill
  // bit first, then a mid-program tool change to the 8mm cutter
  const drillParts = parts.filter((p) => p.holes?.length);
  const hasDrill = drillParts.length > 0;
  const MAIN = { n: 1, label: CAM.bitLabel };    // 8mm cutter
  const DRILL = { n: 2, label: CAM.drillLabel }; // 1/4" drill
  // through-cut depth uses the board's ACTUAL stock thickness when given
  // (real sheet goods run under nominal), else the modeled part thickness
  const cutThick = (p: typeof parts[number]) => board.cutThickness ?? cutSize(p).thick;
  const maxDepth = Math.max(...parts.map(cutThick)) + CAM.overcut;

  const lines: string[] = [];
  const segs: ToolpathSeg[] = [];
  const plunges: [number, number][] = [];
  const labels: ToolpathLabel[] = [];
  let cutLen = 0, plungeLen = 0, rapidLen = 0;
  let curPart: number | undefined; // tags emitted view segments with their part
  const cur = { x: 0, y: 0, z: CAM.safeZ };

  const depthColor = (z: number) => {
    const t = Math.min(1, -z / maxDepth);
    return `hsl(${Math.round(120 - 120 * t)},70%,55%)`;
  };

  const move = (rapid: boolean, x = cur.x, y = cur.y, z = cur.z, f?: number) => {
    const dx = x - cur.x, dy = y - cur.y, dz = z - cur.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 1e-9) return;
    const words = [rapid ? "G0" : "G1"];
    if (Math.abs(dx) > 1e-9) words.push(`X${F(x)}`);
    if (Math.abs(dy) > 1e-9) words.push(`Y${F(y)}`);
    if (Math.abs(dz) > 1e-9) words.push(`Z${F(z)}`);
    if (!rapid && f) words.push(`F${f}`);
    lines.push(words.join(" "));
    if (Math.abs(dx) > 1e-9 || Math.abs(dy) > 1e-9) {
      // XY motion — draw it (cuts shaded by depth, rapids dashed)
      segs.push({ x0: cur.x, y0: cur.y, x1: x, y1: y, rapid,
        color: rapid ? undefined : depthColor(Math.min(z, cur.z)), part: curPart });
    } else if (!rapid && dz < 0 && cur.z > 0 && z <= 0) {
      plunges.push([x, y]); // a straight plunge into the stock
    }
    if (rapid) rapidLen += dist;
    else if (Math.abs(dz) > 1e-9 && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) plungeLen += dist;
    else cutLen += dist;
    cur.x = x; cur.y = y; cur.z = z;
  };
  // GRBL ends a comment at the FIRST ")" — any paren inside the text would
  // leave garbage on the line and halt the job. Swap them for brackets.
  const comment = (s: string) => lines.push(`( ${s.replace(/\(/g, "[").replace(/\)/g, "]")} )`);

  // a Shapeoko bit change (same shape as the reference Carbide G-code): lift +
  // full retract, spindle off, M6 so the operator swaps the bit and the
  // BitSetter re-probes Z, spindle back on, then dwell to reach speed.
  const changeBit = (tool: { n: number; label: string }) => {
    move(true, cur.x, cur.y, CAM.safeZ); // lift clear of the work
    lines.push(`G0 Z${F(CAM.retractZ)}`); // full retract
    lines.push("M5"); // spindle off for the swap
    lines.push(`M6 T${tool.n} ( change to ${tool.label} bit - BitSetter re-sets Z )`);
    lines.push("M3 S18000 ( VFD spindle - this S word sets the RPM )");
    lines.push("G4 P3 ( dwell - let the spindle reach speed before cutting )");
    cur.z = CAM.retractZ;
  };

  // split the total depth into equal passes near CAM.passDepth (a soft
  // target) — avoids a wasted final lap that only removes a few hundredths
  const passDepths = (total: number): number[] => {
    const n = Math.max(1, Math.round(total / CAM.passDepth));
    return Array.from({ length: n }, (_, i) => (-(i + 1) * total) / n);
  };

  // ---- preamble ---------------------------------------------------------------
  comment(`${cab.name} - ${board.label} - generated from cad/cabinets/${cab.id}.ts`);
  comment(`Shapeoko Pro 5 / Carbide Motion (GRBL) - inches - X0 Y0 at board lower-left, Z0 at stock TOP`);
  comment(`load each bit when prompted - the BitSetter sets Z on every M6 tool change`);
  comment(`standing at the machine front: X+ runs RIGHT, Y+ runs AWAY from you -`);
  comment(`zero on the board corner nearest you on the left; all cuts go up-right`);
  comment(hasDrill
    ? `${CAM.bitLabel} bit: profiles + pockets; ${CAM.drillLabel} bit: shelf-pin holes (bit change mid-program)`
    : `${CAM.bitLabel} bit: profiles + pockets`);
  comment(`feed ${CAM.feed} ipm - plunge ${CAM.plunge} ipm - ~${CAM.passDepth}"/pass target`);
  comment(`toolpaths are PRE-OFFSET for the ${CAM.bitLabel} bit - outside of profiles, inside`);
  comment("of windows/pockets - run as-is, do NOT apply cutter compensation");
  comment(`tabs ${CAM.tabH}" tall x ${CAM.tabL}" long on through cuts - chisel free`);
  // depth summary up front, so the file says what it cuts before it cuts it
  comment("CUT DEPTHS ON THIS BOARD:");
  for (const t of [...new Set(parts.map(cutThick))]) {
    const total = t + CAM.overcut;
    comment(`  PROFILES (${F(t)} stock): through at Z-${F(total)} in ${passes(passDepths(total).length)}`);
  }
  for (const p of parts) {
    if (!p.pocket) continue;
    comment(`  POCKET (${p.label}): Z-${F(p.pocket.depth)} in ${passes(passDepths(p.pocket.depth).length)} - NOT through`);
  }
  for (const p of parts) {
    if (!p.holes?.length) continue;
    comment(`  DRILL (${p.label}): ${p.holes.length} holes ${F(p.holes[0].dia)}" dia x Z-${F(p.holes[0].depth)} - ${CAM.drillLabel} bit, NOT through`);
  }
  // Shapeoko / Carbide Motion lead-in (mirrors the Test G-code's start):
  // select the FIRST tool (the drill bit when this board has shelf-pin holes,
  // else the main cutter), set modes, run the BitSetter tool change, FULL-
  // retract before any XY, travel to the work origin, then start the spindle.
  const firstTool = hasDrill ? DRILL : MAIN;
  lines.push(`T${firstTool.n}`, "G17", "G20", "G90");
  lines.push(`M6 T${firstTool.n} ( load ${firstTool.label} bit - BitSetter sets Z )`);
  lines.push(`G0 Z${F(CAM.retractZ)}`); // always lift first - never start with an XY move
  lines.push("G0 X0 Y0");
  lines.push("M3 S18000 ( VFD spindle - this S word sets the RPM )");
  lines.push("G4 P3 ( dwell - let the spindle reach speed before cutting )");
  cur.z = CAM.retractZ; // machine is now retracted at the origin

  // ---- drilling first (the sheet is fully intact and rigid) -------------------
  for (const p of parts) {
    if (!p.holes?.length) continue;
    const [x0, y0] = p.nest.at;
    curPart = cab.parts.indexOf(p);
    comment(`DRILL ${p.holes.length} x ${F(p.holes[0].dia)}" holes - ${p.label}`);
    move(true, cur.x, cur.y, CAM.safeZ);
    for (const hole of p.holes) {
      const [hx, hy] = holeXY(p, hole);
      move(true, x0 + hx, y0 + hy); // travel at full safe height
      move(true, cur.x, cur.y, CAM.clearZ); // rapid down to just above the stock
      move(false, cur.x, cur.y, -hole.depth, CAM.plunge);
      move(true, cur.x, cur.y, CAM.safeZ); // full retract before moving on
    }
  }

  // ---- bit change: 1/4" drill -> 8mm cutter (only when this board drilled) ----
  if (hasDrill) {
    comment(`BIT CHANGE: swap the ${DRILL.label} drill for the ${MAIN.label} cutter (pockets + profiles)`);
    changeBit(MAIN);
  }

  // ---- pockets next (parts still held by the full sheet) ----------------------
  for (const p of parts) {
    if (!p.pocket) continue;
    curPart = cab.parts.indexOf(p);
    const { w, h } = cutSize(p);
    const { inset, depth } = p.pocket;
    const [px, py] = [p.nest.at[0] + inset, p.nest.at[1] + inset];
    const [pw, ph] = [w - 2 * inset, h - 2 * inset];
    // tool boundary stays a bit radius inside the pocket walls
    const bx = px + r, by = py + r, bw = pw - 2 * r, bh = ph - 2 * r;
    comment(`POCKET ${p.label} - clear ${F(depth)} deep`);
    if (bw <= 0 || bh <= 0) { comment("pocket smaller than the bit - SKIPPED"); continue; }
    labels.push({ x: px + 0.5, y: py + ph - 1.6, part: curPart!,
      text: `POCKET ${F(depth)}" DEEP (${passes(passDepths(depth).length, true)}, NOT THRU)` });
    const maxInset = Math.min(bw, bh) / 2;
    const insets: number[] = [];
    for (let o = 0; o < maxInset - 1e-9; o += step) insets.push(o);
    insets.push(maxInset);
    insets.reverse(); // innermost ring first, spiral outward
    for (const z of passDepths(depth)) {
      const o0 = insets[0];
      move(true, bx + o0, by + o0, CAM.safeZ);
      move(true, bx + o0, by + o0, CAM.clearZ); // rapid down, then feed
      move(false, bx + o0, by + o0, z, CAM.plunge);
      for (const o of insets) {
        const [x0, y0, x1, y1] = [bx + o, by + o, bx + bw - o, by + bh - o];
        move(false, x0, y0, z, CAM.feed); // step outward to this ring
        move(false, x1, y0, z);
        move(false, x1, y1, z);
        move(false, x0, y1, z);
        move(false, x0, y0, z);
      }
      move(true, cur.x, cur.y, CAM.safeZ);
    }
  }

  // ---- outside profiles with holding tabs -------------------------------------
  for (const p of parts) {
    curPart = cab.parts.indexOf(p);
    const { w, h } = cutSize(p);
    const thick = cutThick(p); // through-cut to the real stock thickness
    const [x, y] = p.nest.at;
    {
      const total = thick + CAM.overcut;
      const text = `${p.label} - THRU ${F(total)}" DEEP (${passes(passDepths(total).length, true)})`;
      // tall, narrow part: run the label bottom-to-top, like the DXF sheets
      if (h > w * 1.5 && w < 8) labels.push({ x: x + w / 2 - 0.6, y: y + 2, text, rot: 90, part: curPart! });
      else labels.push({ x: x + 0.5, y: y + h / 2, text, part: curPart! });
    }
    if (p.cutout) {
      // through window first, while the part is still attached to the sheet;
      // the tool runs a bit radius INSIDE the opening, tabs hold the offcut
      const { insetU, insetV } = p.cutout;
      comment(`WINDOW ${p.label} - cut through (tabbed offcut)`);
      tabbedProfile(x + insetU + r, y + insetV + r, x + w - insetU - r, y + h - insetV - r, thick);
    }
    // tool center runs a bit radius OUTSIDE the finished outline
    comment(`PROFILE ${p.label} - through at ${F(thick + CAM.overcut)}`);
    tabbedProfile(x - r, y - r, x + w + r, y + h + r, thick);
  }

  // one rectangular profile cut, multi-pass with holding tabs on the final
  // passes (works for outer profiles and inner windows alike — pass the
  // tool-center rectangle)
  function tabbedProfile(x0: number, y0: number, x1: number, y1: number, thick: number) {
    const zTab = -(thick - CAM.tabH);
    const corners: [number, number][] = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    // tab spans per edge: ~one per CAM.tabEvery inches on edges 4"+
    const edgeTabs: [number, number][][] = corners.slice(0, 4).map((a, i) => {
      const b = corners[i + 1];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 4) return [];
      const n = Math.max(1, Math.floor(len / CAM.tabEvery));
      const span = CAM.tabL + CAM.bitDia;
      return Array.from({ length: n }, (_, k) => {
        const mid = (len * (k + 1)) / (n + 1);
        return [mid - span / 2, mid + span / 2] as [number, number];
      });
    });
    move(true, cur.x, cur.y, CAM.safeZ);
    move(true, x0, y0, CAM.safeZ);
    move(true, x0, y0, CAM.clearZ); // rapid down, then feed the first pass
    for (const z of passDepths(thick + CAM.overcut)) {
      move(false, x0, y0, z, CAM.plunge);
      for (let i = 0; i < 4; i++) {
        const a = corners[i], b = corners[i + 1];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
        const at = (d: number): [number, number] => [a[0] + ux * d, a[1] + uy * d];
        if (z < zTab) {
          for (const [t0, t1] of edgeTabs[i]) {
            move(false, ...at(t0), z, CAM.feed);
            move(false, cur.x, cur.y, zTab); // ride up over the tab
            move(false, ...at(t1), zTab, CAM.feed);
            move(false, cur.x, cur.y, z, CAM.plunge); // back down — at plunge feed
          }
        }
        move(false, b[0], b[1], z, CAM.feed);
      }
    }
    move(true, cur.x, cur.y, CAM.safeZ);
  }

  // ---- end (mirrors the Test G-code's tail) -----------------------------------
  curPart = undefined;
  move(true, cur.x, cur.y, CAM.safeZ); // lift clear of the work
  lines.push("M5"); // spindle off
  lines.push(`G0 Z${F(CAM.retractZ)}`); // full retract
  lines.push("G0 X0 Y0", "M2"); // home + end of program

  const minutes = Math.round(cutLen / CAM.feed + plungeLen / CAM.plunge + rapidLen / CAM.rapidRate);
  comment(`est. ${minutes} min (${Math.round(cutLen)}" of cutting)`);
  // move the estimate comment up into the header, above the depth summary
  const est = lines.pop()!;
  lines.splice(lines.findIndex((l) => l.startsWith("( CUT DEPTHS")), 0, est);

  return { gcode: lines.join("\n") + "\n", view: { segs, plunges, labels }, stats: { minutes, lines: lines.length } };
}
