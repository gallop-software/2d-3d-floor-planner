// Machine-safety + dimensional audit of every generated G-code job.
// Run with: npm run audit
//
// Catches the things that break bits, gouge stock, or halt GRBL mid-cut:
//   1. lines GRBL can't parse (incl. parens inside comments)
//   2. commands outside the known-safe whitelist
//   3. XY motion before Z is ever commanded (bit-drag on job start)
//   4. motion before units/absolute/spindle are established
//   5. rapids plunging into stock, or traveling with the bit at/below surface
//   6. XY travel below the safe height
//   7. cutting moves with no feed (or zero feed)
//   8. vertical descents into stock faster than the plunge feed
//   9. diagonal (XY+Z) entries into stock
//  10. cuts deeper than the material + overcut
//  11. coordinates outside the machine area
//  12. missing spindle-off / program-end, or parking the bit low
// ...plus the dimensional audit: every part's toolpath corners, window
// corners, depths, and hole positions must land exactly on the 3D plan.

import { camBoard, CAM, type CamJob } from "./gcode";
import { cutSize, holeXY, validateNest, type Cabinet } from "./model";
import { surfacingJob, SURF } from "./surfacing";
import { upper18 } from "./cabinets/upper18";
import { upper18saw } from "./cabinets/upper18saw";

const CABINETS: Cabinet[] = [upper18, upper18saw];
const ALLOWED = /^(G0|G1|G17|G20|G90|G94|M3|M5|M2)(\s|$)/;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
let totalIssues = 0;

// ---- machine-safety pass -----------------------------------------------------
interface SafetyJob { name: string; gcode: string; size: [number, number]; maxDepth: number; safeZ: number; plungeF: number }
const jobs: SafetyJob[] = [];
for (const cab of CABINETS) {
  cab.boards.forEach((b, bi) => {
    const thick = Math.max(...cab.parts.filter((p) => p.nest.board === bi).map((p) => cutSize(p).thick));
    jobs.push({ name: `${cab.id} ${b.label}`, gcode: camBoard(cab, bi).gcode, size: b.size,
      maxDepth: thick + CAM.overcut, safeZ: CAM.safeZ, plungeF: CAM.plunge });
  });
}
jobs.push({ name: "wasteboard surfacing", gcode: surfacingJob().gcode, size: SURF.area,
  maxDepth: SURF.totalDepth, safeZ: SURF.safeZ, plungeF: SURF.plunge });

for (const job of jobs) {
  const issues: string[] = [];
  let x = 0, y = 0, z: number | null = null; // null = unknown until the file commands Z
  let modalF: number | null = null;
  let sawG20 = false, sawG90 = false, sawM3 = false, sawM5 = false, sawM2 = false, motionStarted = false;
  let ln = 0;
  for (const line of job.gcode.split("\n")) {
    ln++;
    if (!line) continue;
    if (/^\(/.test(line)) {
      if (!/^\([^()]*\)$/.test(line)) issues.push(`L${ln} comment would break GRBL: ${line}`);
      continue;
    }
    if (!/^[A-Z][-A-Z0-9. ]*( \([^()]*\))?$/i.test(line)) { issues.push(`L${ln} unparseable: ${line}`); continue; }
    if (!ALLOWED.test(line)) { issues.push(`L${ln} non-whitelisted command: ${line}`); continue; }
    if (/NaN|Infinity|undefined/.test(line)) issues.push(`L${ln} bad number: ${line}`);
    if (/\bG20\b/.test(line)) sawG20 = true;
    if (/\bG90\b/.test(line)) sawG90 = true;
    if (/\bM3\b/.test(line)) sawM3 = true;
    if (/\bM5\b/.test(line)) sawM5 = true;
    if (/\bM2\b/.test(line)) sawM2 = true;
    const m = line.match(/^(G0|G1)\s/);
    if (!m) continue;
    const get = (w: string) => { const r = line.match(new RegExp(w + "(-?[\\d.]+)")); return r ? parseFloat(r[1]) : undefined; };
    const nx = get("X") ?? x, ny = get("Y") ?? y, nzRaw = get("Z");
    const f = get("F");
    if (f !== undefined) modalF = f;
    const xyMove = nx !== x || ny !== y;
    if (!motionStarted && (xyMove || nzRaw !== undefined)) {
      motionStarted = true;
      if (!sawG20 || !sawG90) issues.push(`L${ln} motion before G20/G90`);
      if (!sawM3) issues.push(`L${ln} motion before spindle on (M3)`);
    }
    if (xyMove && z === null) issues.push(`L${ln} XY move before any Z command (bit-drag risk): ${line}`);
    const nz = nzRaw ?? z ?? 0;
    if (m[1] === "G0" && nzRaw !== undefined && nz < 0) issues.push(`L${ln} RAPID into stock: ${line}`);
    if (m[1] === "G0" && xyMove && z !== null && Math.min(z, nz) < 0) issues.push(`L${ln} rapid XY in stock: ${line}`);
    if (m[1] === "G0" && xyMove && z !== null && Math.min(z, nz) < job.safeZ - 1e-9) issues.push(`L${ln} low XY travel (z ${Math.min(z, nz)}): ${line}`);
    if (m[1] === "G1" && modalF === null) issues.push(`L${ln} G1 with no feed ever set: ${line}`);
    if (m[1] === "G1" && modalF !== null && modalF <= 0) issues.push(`L${ln} zero/negative feed`);
    if (m[1] === "G1" && !xyMove && nzRaw !== undefined && z !== null && nz < z && nz < 0 &&
        (modalF ?? 0) > job.plungeF + 1e-9) {
      issues.push(`L${ln} plunge into stock at cutting feed F${modalF} (plunge is F${job.plungeF}): ${line}`);
    }
    if (m[1] === "G1" && xyMove && nzRaw !== undefined && z !== null && nz < z && nz < 0) issues.push(`L${ln} diagonal plunge: ${line}`);
    if (nz < -(job.maxDepth + 1e-6)) issues.push(`L${ln} TOO DEEP z ${nz} (max ${-job.maxDepth}): ${line}`);
    const margin = 1.5;
    if (nx < -margin || ny < -margin || nx > job.size[0] + margin || ny > job.size[1] + margin) issues.push(`L${ln} out of machine area: ${line}`);
    x = nx; y = ny; z = nzRaw !== undefined ? nz : z;
  }
  if (!sawM5) issues.push("no M5 (spindle never stops)");
  if (!sawM2) issues.push("no M2 (no program end)");
  if (z !== null && z < job.safeZ - 1e-9) issues.push(`ends with bit at z ${z}, below safe height`);
  totalIssues += issues.length;
  console.log(`${issues.length ? "FAIL" : "OK  "} safety  ${job.name}${issues.length ? "\n      " + issues.slice(0, 8).join("\n      ") : ""}`);
}

// ---- dimensional pass ----------------------------------------------------------
const r = CAM.bitDia / 2;
for (const cab of CABINETS) {
  const verrs = validateNest(cab);
  if (verrs.length) { totalIssues += verrs.length; console.log(`FAIL nest    ${cab.id}\n      ` + verrs.join("\n      ")); }
  else console.log(`OK   nest    ${cab.id}`);

  for (let bi = 0; bi < cab.boards.length; bi++) {
    const g: CamJob = camBoard(cab, bi);
    let x = 0, y = 0, z = CAM.safeZ;
    const visited: [number, number][] = [];
    const cutZs = new Set<string>();
    for (const line of g.gcode.split("\n")) {
      const m = line.match(/^(G0|G1)\s/);
      if (!m) continue;
      const get = (w: string) => { const mm = line.match(new RegExp(w + "(-?[\\d.]+)")); return mm ? parseFloat(mm[1]) : undefined; };
      x = get("X") ?? x; y = get("Y") ?? y; z = get("Z") ?? z;
      if (z < 0) { visited.push([x, y]); cutZs.add(z.toFixed(4)); }
    }
    const seen = (px: number, py: number) => visited.some(([vx, vy]) => near(vx, px) && near(vy, py));
    let partFails = 0;
    for (const p of cab.parts.filter((p) => p.nest.board === bi)) {
      const { w, h, thick } = cutSize(p);
      const [nx, ny] = p.nest.at;
      for (const [cx, cy] of [[nx - r, ny - r], [nx + w + r, ny - r], [nx + w + r, ny + h + r], [nx - r, ny + h + r]]) {
        if (!seen(cx, cy)) { partFails++; console.log(`      ${p.label}: outer corner (${cx}, ${cy}) never cut`); }
      }
      if (!cutZs.has((-(thick + CAM.overcut)).toFixed(4))) { partFails++; console.log(`      ${p.label}: through depth missing`); }
      if (p.cutout) {
        const { insetU, insetV } = p.cutout;
        for (const [cx, cy] of [[nx + insetU + r, ny + insetV + r], [nx + w - insetU - r, ny + h - insetV - r]]) {
          if (!seen(cx, cy)) { partFails++; console.log(`      ${p.label}: window corner never cut`); }
        }
      }
      for (const hl of p.holes ?? []) {
        const [hx, hy] = holeXY(p, hl);
        if (!seen(nx + hx, ny + hy)) { partFails++; console.log(`      ${p.label}: hole (${hl.u}, ${hl.v}) never drilled`); }
      }
    }
    totalIssues += partFails;
    console.log(`${partFails ? "FAIL" : "OK  "} dims    ${cab.id} ${cab.boards[bi].label}`);
  }
}

console.log(totalIssues ? `\n${totalIssues} PROBLEMS FOUND` : "\nALL G-CODE MACHINE-SAFE AND DIMENSIONALLY EXACT");
if (totalIssues) process.exit(1);
