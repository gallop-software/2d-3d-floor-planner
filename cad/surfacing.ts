import type { CamJob, ToolpathSeg } from "./gcode";

// Wasteboard surfacing for the BobsCNC KL744: flatten the spoilboard with a
// large surfacing bit. NOT a cabinet — no parts, no 3D — just one G-code
// program in the dropdown.
//
// The whole point of the parameters: a 2" fly cutter hitting a high spot at
// full depth would stall or kick, so every pass is VERY shallow (0.02") and
// the feed stays moderate. Zero Z on the HIGHEST point of the wasteboard
// (find it with a straightedge), so the first pass skims and nothing slams.

export const SURF = {
  bitDia: 2.0, // surfacing / fly cutter
  area: [48, 48] as [number, number], // the KL744 work area to flatten
  stepover: 1.5, // 75% of the bit — no ridges between lanes
  passDepth: 0.02, // VERY shallow — gentle on any high spot
  totalDepth: 0.04, // total material removed (2 passes); raise if it doesn't clean up
  feed: 60, // in/min
  plunge: 10, // in/min — big bit, gentle entry
  safeZ: 0.75,
};

const F = (v: number) => v.toFixed(4).replace(/0+$/, "0");

export function surfacingJob(): CamJob {
  const [w, h] = SURF.area;
  const lines: string[] = [];
  const segs: ToolpathSeg[] = [];
  let cutLen = 0, plungeLen = 0, rapidLen = 0;
  const cur = { x: 0, y: 0, z: SURF.safeZ };

  const move = (rapid: boolean, x = cur.x, y = cur.y, z = cur.z, f?: number, color?: string) => {
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
      segs.push({ x0: cur.x, y0: cur.y, x1: x, y1: y, rapid, color: rapid ? undefined : color });
    }
    if (rapid) rapidLen += dist;
    else if (Math.abs(dz) > 1e-9 && Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) plungeLen += dist;
    else cutLen += dist;
    cur.x = x; cur.y = y; cur.z = z;
  };
  const comment = (s: string) => lines.push(`( ${s.replace(/\(/g, "[").replace(/\)/g, "]")} )`);

  const passes = Math.max(1, Math.round(SURF.totalDepth / SURF.passDepth));
  comment(`WASTEBOARD SURFACING - ${F(w)} x ${F(h)} area - generated from cad/surfacing.ts`);
  comment(`BobsCNC KL744 / GRBL - inches - ${F(SURF.bitDia)}" SURFACING BIT`);
  comment(`zero Z on the HIGHEST point of the wasteboard - X0 Y0 at front-left of the area`);
  comment(`${F(SURF.passDepth)}"/pass x ${passes} passes = ${F(SURF.totalDepth)}" total - shallow so high spots don't slam the bit`);
  comment(`feed ${SURF.feed} ipm - stepover ${F(SURF.stepover)}" [75% of the bit]`);
  lines.push("G20 G90 G94", "G17");
  lines.push("M3 S12000 ( surfacing bit - run the router SLOW )");
  // ALWAYS lift first: the machine's Z is wherever the operator left it
  lines.push(`G0 Z${F(SURF.safeZ)}`);

  for (let pi = 1; pi <= passes; pi++) {
    const z = -((SURF.totalDepth * pi) / passes);
    const color = `hsl(120, 60%, ${62 - pi * 12}%)`; // deeper pass = darker green
    comment(`PASS ${pi} of ${passes} at Z${F(z)}`);
    move(true, 0, 0, SURF.safeZ);
    move(true, 0, 0, 0.1);
    move(false, 0, 0, z, SURF.plunge);
    // serpentine raster: long lines along X, stepping Y by the stepover
    let dir = 1;
    for (let y = 0; ; y += SURF.stepover) {
      const yy = Math.min(y, h);
      move(false, cur.x, yy, z, SURF.feed, color); // step over
      move(false, dir > 0 ? w : 0, cur.y, z, SURF.feed, color); // the long line
      dir = -dir;
      if (yy >= h - 1e-9) break;
    }
    // finishing perimeter ring at this depth
    move(false, cur.x, h, z, SURF.feed, color);
    move(false, 0, h, z, SURF.feed, color);
    move(false, 0, 0, z, SURF.feed, color);
    move(false, w, 0, z, SURF.feed, color);
    move(false, w, h, z, SURF.feed, color);
    move(false, 0, h, z, SURF.feed, color);
    move(true, cur.x, cur.y, SURF.safeZ);
  }

  move(true, cur.x, cur.y, SURF.safeZ);
  lines.push("M5", "G0 X0 Y0", "M2");

  const minutes = Math.round(cutLen / SURF.feed + plungeLen / SURF.plunge + rapidLen / 150);
  comment(`est. ${minutes} min [${Math.round(cutLen)}" of surfacing]`);
  const est = lines.pop()!;
  lines.splice(5, 0, est);

  return { gcode: lines.join("\n") + "\n", view: { segs, plunges: [], labels: [] }, stats: { minutes, lines: lines.length } };
}
