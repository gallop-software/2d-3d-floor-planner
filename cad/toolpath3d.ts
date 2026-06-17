import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Cabinet3D } from "./view3d";

// 3D drawing of an EXTERNAL G-code file's toolpath. This is read-only: the
// original file is never touched — main.ts hands us a copy of its text, we
// parse it into line moves, and draw them. The toolpath lies on the table's
// X-Y plane with the tool's Z pointing up, a translucent block of stock under
// it (top at Z0), and the cuts shaded by depth (green = shallow, red = deep).
//
// Supported: modal G0/G1 motion, modal X/Y/Z words, G20/G21 units, absolute
// (G90) coordinates — which covers Vectric/GRBL style 2.5D pocketing and
// profiling. Arcs (G2/G3) and incremental mode aren't emitted by these jobs;
// if they ever appear they're simply skipped, never mis-drawn.

export interface ToolpathMove {
  x0: number; y0: number; z0: number;
  x1: number; y1: number; z1: number;
  rapid: boolean;
  plunge: boolean; // a straight feed down into the stock (no X/Y)
  feed: number;    // commanded feed (in/min); 0 for rapids — used to pace the sim
}

// an M6 tool change parsed from the G-code: which move it precedes + a short
// bit label pulled from the M6 line's comment (or "Tool N" if unlabeled)
export interface ToolChange { atMove: number; label: string; }

// What the machine is doing at the current playhead — drives the live readout
// so the lead-in (safe-Z lift -> rapid -> plunge) and cutting are legible.
export interface SimStatus {
  phase: "rapid" | "plunge" | "cut" | "end" | "toolchange" | "start" | "idle";
  x: number; y: number; z: number; // table coords (inches) at the playhead
  feed: number; // commanded feed (in/min), 0 for rapids
  tool: string; // the bit currently loaded (e.g. "8mm", "1/4\"")
}

// A 3D toolpath view extends the cabinet view with playback: setSim(0..1)
// reveals the path up to that fraction of run-time, parks the bit there, and
// reports what the machine is doing at that instant.
export interface Toolpath3D extends Cabinet3D {
  setSim(t: number): SimStatus;
  // nearest move boundary in dir (+1 next / -1 prev) from t, as a 0..1 fraction
  stepSim(t: number, dir: 1 | -1): number;
  simMinutes: number; // estimated run time, for the playback readout
}

// the bit is colored by what it's doing, so the phase is obvious at a glance
const PHASE_COLOR: Record<"rapid" | "plunge" | "cut" | "toolchange", string> = {
  rapid: "#9aa3ad", plunge: "#e5c07b", cut: "#ff3b30", toolchange: "#4ea1ff",
};

export interface Toolpath {
  moves: ToolpathMove[];
  toolChanges: ToolChange[]; // M6 events (first one = the initial bit)
  // bounds of the CUTTING region only (rapids to the home corner / retract
  // height are excluded so the view frames the work, not the empty travel)
  bounds: { minx: number; miny: number; minz: number; maxx: number; maxy: number; maxz: number };
  stats: { lines: number; minutes: number; passes: number; depth: number; cutLen: number };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

// pull a short bit label out of an M6 line's comment, e.g. "8mm" or "1/4\"";
// fall back to "Tool N" when there's no comment (some posts, like the Vectric
// reference file, write a bare "M6 T202")
function bitLabel(rawLine: string): string {
  const comment = rawLine.match(/\(([^)]*)\)/)?.[1] ?? "";
  const size = comment.match(/(\d+\/\d+\s?"|\d+(?:\.\d+)?\s?mm|\d*\.?\d+\s?")/);
  if (size) return size[1].replace(/\s+/g, "");
  const t = rawLine.match(/\bT(\d+)/i)?.[1];
  return t ? `Tool ${t}` : "tool";
}

export function parseToolpath(text: string): Toolpath {
  const moves: ToolpathMove[] = [];
  let x = 0, y = 0, z = 0;
  let unit = 1;            // 1 = inches (G20), 1/25.4 = mm (G21) -> inches
  let motion: 0 | 1 | null = null; // modal G0 (rapid) / G1 (feed)
  let feed = 0;            // modal feed, in/min
  let lines = 0;
  let cutLen = 0, rapidLen = 0, minutes = 0;
  const cutZ = new Set<number>(); // distinct cutting depths -> pass count
  let minx = Infinity, miny = Infinity, minz = Infinity;
  let maxx = -Infinity, maxy = -Infinity, maxz = -Infinity;
  const grow = (px: number, py: number, pz: number) => {
    if (px < minx) minx = px; if (py < miny) miny = py; if (pz < minz) minz = pz;
    if (px > maxx) maxx = px; if (py > maxy) maxy = py; if (pz > maxz) maxz = pz;
  };

  const toolChanges: ToolChange[] = [];
  const tok = /([A-Za-z])(-?\d*\.?\d+)/g;
  for (const raw of text.split(/\r?\n/)) {
    // a tool change (M6) — record it BEFORE the comment is stripped, since the
    // bit label lives in the comment. atMove = the next move's index.
    if (/\bM0?6\b/i.test(raw.replace(/\([^)]*\)/g, " "))) {
      toolChanges.push({ atMove: moves.length, label: bitLabel(raw) });
    }
    // drop ( ... ) and ; comments; blank/comment-only lines aren't moves
    const s = raw.replace(/\([^)]*\)/g, "").replace(/;.*/, "").trim();
    if (!s) continue;
    lines++;
    let nx = x, ny = y, nz = z, hasMove = false;
    tok.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = tok.exec(s))) {
      const L = m[1].toUpperCase();
      const v = parseFloat(m[2]);
      if (L === "G") {
        if (v === 0) motion = 0;
        else if (v === 1) motion = 1;
        else if (v === 20) unit = 1;
        else if (v === 21) unit = 1 / 25.4;
        // G2/G3/G17/G90/... : nothing to set for a straight-line preview
      } else if (L === "X") { nx = v * unit; hasMove = true; }
      else if (L === "Y") { ny = v * unit; hasMove = true; }
      else if (L === "Z") { nz = v * unit; hasMove = true; }
      else if (L === "F") feed = v * unit;
      // M / S / T / N ... : ignored
    }
    if (!hasMove || motion === null) continue;
    const dx = nx - x, dy = ny - y, dz = nz - z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > 1e-9) {
      const rapid = motion === 0;
      const flat = Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9;
      const plunge = !rapid && flat && dz < 0;
      moves.push({ x0: x, y0: y, z0: z, x1: nx, y1: ny, z1: nz, rapid, plunge, feed: rapid ? 0 : feed });
      if (rapid) {
        rapidLen += dist;
      } else {
        cutLen += dist;
        if (feed > 0) minutes += dist / feed;
        // bounds + pass set track the actual cutting only
        grow(x, y, z); grow(nx, ny, nz);
        if (nz < -1e-9) cutZ.add(r4(nz));
      }
    }
    x = nx; y = ny; z = nz;
  }
  minutes += rapidLen / 150; // rapids don't carry a feed; assume 150 ipm
  if (!isFinite(minx)) { minx = miny = minz = 0; maxx = maxy = maxz = 0; }

  return {
    moves,
    toolChanges,
    bounds: { minx, miny, minz, maxx, maxy, maxz },
    stats: {
      lines,
      minutes: Math.max(1, Math.round(minutes)),
      passes: cutZ.size,
      depth: Math.max(0, -minz),
      cutLen: Math.round(cutLen),
    },
  };
}

// shallow -> green (120deg), deep -> red (0deg)
function depthColor(z: number, depth: number, out: THREE.Color): THREE.Color {
  const t = depth > 0 ? Math.min(1, Math.max(0, -z / depth)) : 0;
  return out.setHSL((120 - 120 * t) / 360, 0.7, 0.55);
}

// canvas: the full stock sheet to draw under the cuts (table coords). Without
// it the stock is sized to the cut extents; with it the whole sheet is shown.
export interface ToolpathCanvas { x: [number, number]; y: [number, number]; }

export function createToolpath3D(tp: Toolpath, wrap: HTMLElement, canvas?: ToolpathCanvas): Toolpath3D {
  const el = document.createElement("div");
  el.className = "view3d";
  wrap.appendChild(el);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setClearColor(0xffffff);
  el.appendChild(renderer.domElement);

  const css2d = new CSS2DRenderer();
  css2d.domElement.className = "labels2d";
  el.appendChild(css2d.domElement);

  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8b2a4, 1.1));
  const sun = new THREE.DirectionalLight(0xffffff, 0.6);
  sun.position.set(-40, 60, 50);
  scene.add(sun);

  // table coords (x right, y away, z up) -> three (x, z up, y) so Z points up
  const TX = (x: number, y: number, z: number) => new THREE.Vector3(x, z, y);

  const b = tp.bounds;
  const depth = tp.stats.depth;
  const top = Math.max(0, b.maxz);          // stock top (Z0 = top of stock)
  const bot = Math.min(0, b.minz);          // deepest cut
  // stock/canvas extent: the full sheet if given, else just around the cuts
  const cv = canvas ?? { x: [b.minx, b.maxx] as [number, number], y: [b.miny, b.maxy] as [number, number] };
  const w = Math.max(cv.x[1] - cv.x[0], 1e-3);
  const h = Math.max(cv.y[1] - cv.y[0], 1e-3);
  const cx = (cv.x[0] + cv.x[1]) / 2;
  const cy = (cv.y[0] + cv.y[1]) / 2;
  // the cut region (for sizing the bit/markers + dimension callouts) — keep
  // these tied to the actual cuts so they stay legible on a big empty sheet
  const cutW = Math.max(b.maxx - b.minx, 1e-3);

  // center the scene on the middle of the stock block
  const center = TX(cx, cy, (top + bot) / 2);
  const root = new THREE.Group();
  root.position.copy(center).negate();
  scene.add(root);

  const layerGroups = new Map<string, THREE.Group>();
  const layerGroup = (name: string) => {
    let g = layerGroups.get(name);
    if (!g) { g = new THREE.Group(); layerGroups.set(name, g); root.add(g); }
    return g;
  };

  // ---- stock block: translucent slab, top at Z0 down to the deepest cut -----
  {
    const g = layerGroup("STOCK");
    const sh = Math.max(top - bot, 0.02);
    const geo = new THREE.BoxGeometry(w, sh, h);
    const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
      color: "#cdb88a", transparent: true, opacity: 0.18, depthWrite: false,
    }));
    mesh.position.copy(TX(cx, cy, (top + bot) / 2));
    g.add(mesh);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo),
      new THREE.LineBasicMaterial({ color: 0xb9a26b }));
    edges.position.copy(mesh.position);
    g.add(edges);
  }

  // ---- playback timeline -----------------------------------------------------
  // Real cut time dwarfs the lead-in (a 13-hour raster vs a fraction of a
  // second of travel), so a strictly time-proportional scrub would bury the
  // pre-cut moves in <0.02% of the bar. Instead we PHASE-WEIGHT the timeline:
  // the travel + plunge "setup" moves get a fixed share so the safe-Z lift,
  // rapid-over and plunge-in are actually watchable and scrubbable, and the
  // cuts share the rest in proportion. So the scrub is paced for legibility,
  // not a wall clock (simMinutes still reports the true estimate).
  const RAPID_IPM = 200;
  const NONCUT_SHARE = 0.35; // fraction of the scrub reserved for travel/plunge
  const realDur = tp.moves.map((mv) =>
    Math.hypot(mv.x1 - mv.x0, mv.y1 - mv.y0, mv.z1 - mv.z0) /
    (mv.rapid ? RAPID_IPM : (mv.feed > 0 ? mv.feed : 45)));
  let cutTotal = 0, nonTotal = 0;
  tp.moves.forEach((mv, i) => { mv.rapid || mv.plunge ? (nonTotal += realDur[i]) : (cutTotal += realDur[i]); });
  const weighted = cutTotal > 0 && nonTotal > 0;
  const moveEnd: number[] = []; // cumulative end time per move (scrub units)
  let runTime = 0;
  tp.moves.forEach((mv, i) => {
    runTime += !weighted ? realDur[i]
      : (mv.rapid || mv.plunge)
        ? (realDur[i] / nonTotal) * NONCUT_SHARE
        : (realDur[i] / cutTotal) * (1 - NONCUT_SHARE);
    moveEnd.push(runTime);
  });
  const realMinutes = Math.max(1, Math.round(cutTotal + nonTotal));

  // ---- cuts: depth-shaded line segments (vertex colors) ---------------------
  let cutGeo: THREE.BufferGeometry | null = null;
  const cutEnd: number[] = []; // cumulative end time per drawn cut segment
  {
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    tp.moves.forEach((mv, i) => {
      if (mv.rapid || mv.plunge) return;              // plunges drawn as markers
      const a = TX(mv.x0, mv.y0, mv.z0), bpt = TX(mv.x1, mv.y1, mv.z1);
      depthColor(Math.min(mv.z0, mv.z1), depth, c);
      pos.push(a.x, a.y, a.z, bpt.x, bpt.y, bpt.z);
      col.push(c.r, c.g, c.b, c.r, c.g, c.b);
      cutEnd.push(moveEnd[i]);
    });
    if (pos.length) {
      cutGeo = new THREE.BufferGeometry();
      cutGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      cutGeo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
      layerGroup("CUTS").add(new THREE.LineSegments(cutGeo,
        new THREE.LineBasicMaterial({ vertexColors: true })));
    }
  }

  // ---- rapids: dashed gray travel -------------------------------------------
  let rapidGeo: THREE.BufferGeometry | null = null;
  const rapidEnd: number[] = [];
  {
    const pos: number[] = [];
    tp.moves.forEach((mv, i) => {
      if (!mv.rapid) return;
      const a = TX(mv.x0, mv.y0, mv.z0), bpt = TX(mv.x1, mv.y1, mv.z1);
      pos.push(a.x, a.y, a.z, bpt.x, bpt.y, bpt.z);
      rapidEnd.push(moveEnd[i]);
    });
    if (pos.length) {
      rapidGeo = new THREE.BufferGeometry();
      rapidGeo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const seg = new THREE.LineSegments(rapidGeo,
        new THREE.LineDashedMaterial({ color: 0xe07a86, dashSize: 0.18, gapSize: 0.12 }));
      seg.computeLineDistances();
      layerGroup("RAPIDS").add(seg);
    }
  }

  // ---- plunges: a marker where the bit feeds straight into the stock --------
  {
    const g = layerGroup("PLUNGES");
    const geo = new THREE.SphereGeometry(Math.max(0.03, cutW * 0.0025), 10, 8);
    const mat = new THREE.MeshLambertMaterial({ color: "#e5c07b" });
    for (const mv of tp.moves) {
      if (!mv.plunge) continue;
      const s = new THREE.Mesh(geo, mat);
      s.position.copy(TX(mv.x1, mv.y1, mv.z1));
      g.add(s);
    }
  }

  // ---- the bit: a marker that rides the toolpath during playback ------------
  // bright, oversized, and drawn on top (depthTest off) so it's always visible
  // against the cuts — the clearest progress cue for a flood-fill pocket
  const bit = new THREE.Mesh(
    new THREE.SphereGeometry(Math.max(0.16, w * 0.01), 18, 14), // sized to the sheet so it reads at the overview scale
    new THREE.MeshBasicMaterial({ color: "#ff3b30", depthTest: false }));
  bit.renderOrder = 999;
  bit.visible = false;
  root.add(bit);

  // ---- active segment: the move in progress, drawn from its start to the bit
  // so a long rapid/cut GROWS behind the ball instead of popping in whole when
  // the move finishes. Dashed (like the rapids) for travel, solid for cuts.
  const scratch = new THREE.Color();
  const activeRapid = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineDashedMaterial({ color: 0xe07a86, dashSize: 0.18, gapSize: 0.12 }));
  activeRapid.visible = false;
  layerGroup("RAPIDS").add(activeRapid);
  const activeCutMat = new THREE.LineBasicMaterial({ color: 0x6fd06f });
  const activeCut = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), activeCutMat);
  activeCut.visible = false;
  layerGroup("CUTS").add(activeCut);
  // set the active line's two endpoints (start of move -> the bit), in 3D space
  const setActive = (line: THREE.Line, sx: number, sy: number, sz: number) => {
    const p = line.geometry.attributes.position as THREE.BufferAttribute;
    p.setXYZ(0, sx, sz, sy); // table (x,y,z) -> three (x, z up, y)
    p.setXYZ(1, bit.position.x, bit.position.y, bit.position.z);
    p.needsUpdate = true;
  };

  // ---- overall dimension callouts (their own toggleable layer) --------------
  const dimLabels: CSS2DObject[] = [];
  {
    const g = layerGroup("DIMS");
    const add = (p: THREE.Vector3, text: string) => {
      const div = document.createElement("div");
      div.className = "dim-label";
      div.textContent = text;
      const o = new CSS2DObject(div);
      o.position.copy(p);
      g.add(o); dimLabels.push(o);
    };
    // dimension the CUT region (not the sheet) so the numbers stay meaningful
    const ccx = (b.minx + b.maxx) / 2, ccy = (b.miny + b.maxy) / 2;
    add(TX(ccx, b.miny - 0.6, top), `${(b.maxx - b.minx).toFixed(1)}"`);
    add(TX(b.minx - 0.6, ccy, top), `${(b.maxy - b.miny).toFixed(1)}"`);
    add(TX(b.maxx + 0.4, b.maxy + 0.4, (top + bot) / 2),
      `${depth.toFixed(3)}" deep · ${tp.stats.passes} ${tp.stats.passes === 1 ? "pass" : "passes"}`);
  }

  // ---- camera ----------------------------------------------------------------
  const diag = Math.hypot(w, h, top - bot);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 4000);
  const HOME_POS = new THREE.Vector3(-40, 55, 60).normalize().multiplyScalar(diag * 1.2);
  const HOME_TGT = new THREE.Vector3(0, 0, 0);
  camera.position.copy(HOME_POS);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME_TGT);
  controls.update();

  function render() {
    renderer.render(scene, camera);
    css2d.render(scene, camera);
  }
  controls.addEventListener("change", render);

  const layerOn = new Map<string, boolean>();
  const LAYERS = [
    { name: "CUTS", color: "#6fd06f" },
    { name: "RAPIDS", color: "#e07a86" },
    { name: "PLUNGES", color: "#e5c07b" },
    { name: "STOCK", color: "#cdb88a" },
    { name: "DIMS", color: "#6b7280" },
  ];
  LAYERS.forEach((l) => layerOn.set(l.name, true));

  function updateVisibility() {
    for (const [name, g] of layerGroups) g.visible = layerOn.get(name) !== false;
    const dimsOn = layerOn.get("DIMS") !== false;
    for (const o of dimLabels) o.visible = dimsOn;
  }
  updateVisibility();

  // how many leading segments have finished by time `t` (segments are stored
  // in run order, so their end-times are sorted — binary-search the cutoff)
  const revealed = (ends: number[], t: number): number => {
    let lo = 0, hi = ends.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (ends[m] <= t) lo = m + 1; else hi = m; }
    return lo;
  };

  // tool tracking: the bit loaded at a move = the last change at/before it;
  // a mid-program change "happens" on the retract before and approach after M6
  const initialTool = tp.toolChanges[0]?.label ?? "";
  const midChanges = tp.toolChanges.filter((c) => c.atMove > 0);
  const toolAt = (i: number): string => {
    let label = initialTool;
    for (const c of tp.toolChanges) { if (c.atMove <= i) label = c.label; else break; }
    return label;
  };
  const changeAt = (i: number): ToolChange | undefined =>
    midChanges.find((c) => i === c.atMove - 1 || i === c.atMove);

  const toolpath3d: Toolpath3D = {
    layers: LAYERS,
    simMinutes: realMinutes,
    setLayerVisible(name, on) { layerOn.set(name, on); updateVisibility(); render(); },
    setExplode() { /* toolpaths don't explode — no-op */ },
    setSim(t) {
      const tc = Math.min(1, Math.max(0, t));
      const playT = tc * runTime;
      // reveal whole finished segments on each layer
      if (cutGeo) cutGeo.setDrawRange(0, revealed(cutEnd, playT) * 2);
      if (rapidGeo) rapidGeo.setDrawRange(0, revealed(rapidEnd, playT) * 2);
      // park the bit on the move in progress (interpolated); at the very end
      // leave it where the program leaves the real tool — retracted, at home
      const bitMat = bit.material as THREE.MeshBasicMaterial;
      let status: SimStatus = { phase: "idle", x: 0, y: 0, z: 0, feed: 0, tool: initialTool };
      activeRapid.visible = false;
      activeCut.visible = false;
      if (!tp.moves.length) {
        bit.visible = false;
      } else if (tc <= 0) {
        // at the very start: park the bit where the program begins so the
        // readout always shows a Z (the machine's zero before the first move)
        const m0 = tp.moves[0];
        bit.position.set(m0.x0, m0.z0, m0.y0);
        bitMat.color.set(PHASE_COLOR.rapid);
        bit.visible = true;
        status = { phase: "start", x: m0.x0, y: m0.y0, z: m0.z0, feed: 0, tool: initialTool };
      } else if (tc >= 1) {
        const last = tp.moves[tp.moves.length - 1];
        bit.position.set(last.x1, last.z1, last.y1);
        bitMat.color.set(PHASE_COLOR.rapid);
        bit.visible = true;
        status = { phase: "end", x: last.x1, y: last.y1, z: last.z1, feed: 0, tool: toolAt(tp.moves.length - 1) };
      } else {
        const i = Math.min(revealed(moveEnd, playT), tp.moves.length - 1);
        const mv = tp.moves[i];
        const t0 = i > 0 ? moveEnd[i - 1] : 0;
        const f = moveEnd[i] > t0 ? (playT - t0) / (moveEnd[i] - t0) : 0;
        const x = mv.x0 + (mv.x1 - mv.x0) * f;
        const y = mv.y0 + (mv.y1 - mv.y0) * f;
        const z = mv.z0 + (mv.z1 - mv.z0) * f;
        bit.position.set(x, z, y);
        bit.visible = true;
        const phase = mv.rapid ? "rapid" : mv.plunge ? "plunge" : "cut";
        // grow the in-progress segment from its start up to the bit
        if (phase === "rapid") {
          setActive(activeRapid, mv.x0, mv.y0, mv.z0);
          activeRapid.computeLineDistances(); // re-dash for the new length
          activeRapid.visible = true;
        } else if (phase === "cut") {
          setActive(activeCut, mv.x0, mv.y0, mv.z0);
          activeCutMat.color.copy(depthColor(Math.min(mv.z0, mv.z1), depth, scratch));
          activeCut.visible = true;
        } // plunge is a straight drop — the bit itself shows it
        const change = changeAt(i); // a bit swap is happening around here
        if (change) {
          // park the marker at the FULL-retract height (where the M6 actually
          // fires) so it's clearly clear of the work during the swap
          const parkZ = tp.moves[change.atMove - 1]?.z1 ?? z;
          bit.position.set(x, parkZ, y);
          activeRapid.visible = false; activeCut.visible = false;
          bitMat.color.set(PHASE_COLOR.toolchange);
          status = { phase: "toolchange", x, y, z: parkZ, feed: 0, tool: change.label };
        } else {
          bitMat.color.set(PHASE_COLOR[phase]);
          status = { phase, x, y, z, feed: mv.feed, tool: toolAt(i) };
        }
      }
      render();
      return status;
    },
    stepSim(t, dir) {
      if (!moveEnd.length) return t;
      const cur = Math.min(1, Math.max(0, t)) * runTime;
      if (dir > 0) {
        const i = revealed(moveEnd, cur + 1e-9); // first boundary past cur
        return (i >= moveEnd.length ? runTime : moveEnd[i]) / runTime;
      }
      const i = revealed(moveEnd, cur - 1e-9); // boundary just before cur
      return (i <= 0 ? 0 : moveEnd[i - 1]) / runTime;
    },
    resetView() {
      camera.position.copy(HOME_POS);
      controls.target.copy(HOME_TGT);
      controls.update();
      render();
    },
    show() { el.classList.add("on"); this.resize(); },
    hide() { el.classList.remove("on"); },
    resize() {
      const cw = el.clientWidth, ch = el.clientHeight;
      if (!cw || !ch) return;
      camera.aspect = cw / ch;
      camera.updateProjectionMatrix();
      renderer.setSize(cw, ch);
      css2d.setSize(cw, ch);
      render();
    },
  };
  return toolpath3d;
}
