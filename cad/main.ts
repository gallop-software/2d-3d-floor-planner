/// <reference types="vite/client" />
import "./viewer.css";
import { BIT_LABEL, BLEED, boardShapes, boardToDXF, validateNest, type Cabinet } from "./model";
import { CAM, camBoard, type CamJob } from "./gcode";
import { createCabinet3D, type Cabinet3D } from "./view3d";
import { createToolpath3D, parseToolpath, type Toolpath, type Toolpath3D, type SimStatus, type ToolpathCanvas } from "./toolpath3d";
import { SURF, surfacingJob } from "./surfacing";
import { upper18 } from "./cabinets/upper18";
import { upper18saw } from "./cabinets/upper18saw";
// External G-code, imported RAW so it is preserved byte-for-byte — we parse a
// copy of this string for the 3D drawing and hand the original back to download.
import testGcodeRaw from "./programs/test-gcode-for-chris.gcode?raw";

// ---------- entity types ----------------------------------------------------
type Pt = [number, number];
interface Entity {
  type: "POLY" | "LINE" | "CIRCLE" | "ARC" | "TEXT";
  layer: string;
  pts?: Pt[];
  closed?: boolean;
  cx?: number; cy?: number; r?: number; a0?: number; a1?: number;
  x?: number; y?: number; h?: number; text?: string; rot?: number;
  color?: string; // per-entity override (toolpath depth shading)
  dash?: boolean; // dashed stroke (toolpath rapids)
  part?: number; // owning part (generated sheets) — click-to-toggle selection
  labelOf?: number; // label entity, drawn only while that part is selected
  hit?: boolean; // invisible click region (never drawn) — gives toolpath
  //               sheets the same inside-the-outline picking as DXF sheets
}

// click-selected parts on the current sheet (highlight + label toggles)
const selectedParts = new Set<number>();

// ---------- minimal DXF parser (R12 / common entities) ----------------------
function parseDXF(text: string): Entity[] {
  const lines = text.split(/\r\n|\r|\n/);
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    pairs.push([parseInt(lines[i].trim(), 10), lines[i + 1]]);
  }
  const ents: Entity[] = [];
  let i = 0;
  while (i < pairs.length && !(pairs[i][0] === 2 && pairs[i][1].trim() === "ENTITIES")) i++;

  function collect(): Record<number, string[]> {
    const e: Record<number, string[]> = {};
    i++; // move past the "0/ENTITYNAME"
    while (i < pairs.length && pairs[i][0] !== 0) {
      const [code, raw] = pairs[i];
      if (!(code in e)) e[code] = [];
      e[code].push(raw.trim());
      i++;
    }
    return e;
  }
  const get = (e: Record<number, string[]>, code: number, def = ""): string =>
    e[code] && e[code].length ? e[code][0] : def;
  const num = (e: Record<number, string[]>, code: number, def = 0): number => {
    const v = parseFloat(get(e, code, String(def)));
    return Number.isNaN(v) ? def : v;
  };

  while (i < pairs.length) {
    const [code, raw] = pairs[i];
    if (code !== 0) { i++; continue; }
    const type = raw.trim();
    if (type === "ENDSEC" || type === "EOF") break;

    if (type === "LINE") {
      const e = collect();
      ents.push({ type: "LINE", layer: get(e, 8, "0"),
        pts: [[num(e, 10), num(e, 20)], [num(e, 11), num(e, 21)]] });
    } else if (type === "LWPOLYLINE") {
      const e = collect();
      const xs = (e[10] || []).map(parseFloat);
      const ys = (e[20] || []).map(parseFloat);
      const pts: Pt[] = xs.map((x, k) => [x, ys[k]]);
      const closed = (parseInt(get(e, 70, "0"), 10) & 1) === 1;
      ents.push({ type: "POLY", layer: get(e, 8, "0"), pts, closed });
    } else if (type === "POLYLINE") {
      const head = collect();
      const closed = (parseInt(get(head, 70, "0"), 10) & 1) === 1;
      const layer = get(head, 8, "0");
      const pts: Pt[] = [];
      while (i < pairs.length && pairs[i][0] === 0 && pairs[i][1].trim() === "VERTEX") {
        const v = collect();
        pts.push([num(v, 10), num(v, 20)]);
      }
      if (i < pairs.length && pairs[i][0] === 0 && pairs[i][1].trim() === "SEQEND") collect();
      ents.push({ type: "POLY", layer, pts, closed });
    } else if (type === "CIRCLE") {
      const e = collect();
      ents.push({ type: "CIRCLE", layer: get(e, 8, "0"), cx: num(e, 10), cy: num(e, 20), r: num(e, 40) });
    } else if (type === "ARC") {
      const e = collect();
      ents.push({ type: "ARC", layer: get(e, 8, "0"), cx: num(e, 10), cy: num(e, 20),
        r: num(e, 40), a0: num(e, 50), a1: num(e, 51) });
    } else if (type === "TEXT" || type === "MTEXT") {
      const e = collect();
      ents.push({ type: "TEXT", layer: get(e, 8, "0"), x: num(e, 10), y: num(e, 20),
        h: num(e, 40, 1), rot: num(e, 50, 0), text: get(e, 1).replace(/\\[A-Za-z0-9.]+;?/g, "") });
    } else {
      collect(); // unknown entity — skip its codes
    }
  }
  return ents;
}

// ---------- layer colors -----------------------------------------------------
const LAYER_COLORS: Record<string, string> = {
  SHEET: "#c9a24b", BLEED: "#d6705a", PARTS: "#6fd06f", POCKET: "#b48ead",
  DRILL: "#56b6c2", LABELS: "#ffffff", RAPIDS: "#e57380", CUTS: "#6fd06f",
  PLUNGES: "#e5c07b", DEFAULT: "#8fb0d6",
};
const layerColor = (l: string): string => {
  const L = (l || "").toUpperCase();
  if (L.startsWith("POCKET")) return LAYER_COLORS.POCKET; // POCKET_<depth>_DEEP layers
  if (L.startsWith("DRILL")) return LAYER_COLORS.DRILL; // DRILL_<depth>_DEEP layers
  return LAYER_COLORS[L] || LAYER_COLORS.DEFAULT;
};

// ---------- elements + view state -------------------------------------------
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>("c");
const ctx = canvas.getContext("2d")!;
const readout = $<HTMLElement>("readout");
const statusEl = $<HTMLElement>("status");

let entities: Entity[] = [];
const view = { scale: 8, ox: 60, oy: 60 }; // px per inch; offset in px (screen)
let dpr = window.devicePixelRatio || 1;

function resize() {
  if (!in3D) {
    dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    draw();
  }
  current3D?.resize(); // no-op while hidden
}
window.addEventListener("resize", resize);

// world(inches, y-up) -> screen(px, y-down)
const wx = (x: number) => x * view.scale + view.ox;
const wy = (y: number) => canvas.clientHeight - y * view.scale - view.oy;
const sx2wx = (px: number) => (px - view.ox) / view.scale;
const sy2wy = (py: number) => (canvas.clientHeight - py - view.oy) / view.scale;

function bounds() {
  let minx = Infinity, miny = Infinity, maxx = -Infinity, maxy = -Infinity;
  const add = (x: number, y: number) => {
    if (x < minx) minx = x; if (y < miny) miny = y;
    if (x > maxx) maxx = x; if (y > maxy) maxy = y;
  };
  for (const e of entities) {
    if (e.pts) e.pts.forEach((p) => add(p[0], p[1]));
    if (e.type === "CIRCLE" || e.type === "ARC") { add(e.cx! - e.r!, e.cy! - e.r!); add(e.cx! + e.r!, e.cy! + e.r!); }
    if (e.type === "TEXT") add(e.x!, e.y!);
  }
  if (!isFinite(minx)) return null;
  return { minx, miny, maxx, maxy };
}

function fit() {
  const b = bounds(); if (!b) return;
  const pad = 40;
  const w = b.maxx - b.minx || 1, h = b.maxy - b.miny || 1;
  const sw = canvas.clientWidth - pad * 2, sh = canvas.clientHeight - pad * 2;
  view.scale = Math.min(sw / w, sh / h);
  view.ox = pad - b.minx * view.scale;
  view.oy = pad - b.miny * view.scale;
  draw();
}

const enabledLayers = new Set<string>();
function legendRow(name: string, color: string, onChange: (on: boolean) => void) {
  const lab = document.createElement("label");
  const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = true;
  cb.style.accentColor = color; // the checkbox IS the swatch
  cb.onchange = () => onChange(cb.checked);
  lab.append(cb, document.createTextNode(name));
  return lab;
}
function buildLegend() {
  const seen = [...new Set(entities.map((e) => (e.layer || "0").toUpperCase()))];
  enabledLayers.clear(); seen.forEach((l) => enabledLayers.add(l));
  const box = $<HTMLElement>("legend");
  box.innerHTML = "";
  seen.forEach((l) => {
    box.append(legendRow(l, layerColor(l), (on) => {
      on ? enabledLayers.add(l) : enabledLayers.delete(l);
      draw();
    }));
  });
}
function buildLegend3D(view: Cabinet3D) {
  const box = $<HTMLElement>("legend");
  box.innerHTML = "";
  view.layers.forEach(({ name, color }) => {
    box.append(legendRow(name, color, (on) => view.setLayerVisible(name, on)));
  });
}

function drawGrid() {
  const b = { minx: sx2wx(0), maxx: sx2wx(canvas.clientWidth), miny: sy2wy(canvas.clientHeight), maxy: sy2wy(0) };
  let step = 1;
  const targetPx = 26;
  while (step * view.scale < targetPx) step *= step === 1 ? 6 : 2; // 1,6,12,24...
  ctx.lineWidth = 1;
  ctx.font = "10px sans-serif";
  for (let x = Math.floor(b.minx / step) * step; x <= b.maxx; x += step) {
    const major = Math.abs(x % (step * 2)) < 1e-6;
    ctx.strokeStyle = x === 0 ? "#5a6b6c" : major ? "#333a43" : "#2a2f37";
    ctx.beginPath(); ctx.moveTo(wx(x), 0); ctx.lineTo(wx(x), canvas.clientHeight); ctx.stroke();
    ctx.fillStyle = "#5b6470"; ctx.fillText(x + '"', wx(x) + 2, canvas.clientHeight - 4);
  }
  for (let y = Math.floor(b.miny / step) * step; y <= b.maxy; y += step) {
    ctx.strokeStyle = y === 0 ? "#5a6b6c" : "#2a2f37";
    ctx.beginPath(); ctx.moveTo(0, wy(y)); ctx.lineTo(canvas.clientWidth, wy(y)); ctx.stroke();
    ctx.fillStyle = "#5b6470"; ctx.fillText(y + '"', 3, wy(y) - 2);
  }
}

function draw() {
  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  ctx.fillStyle = "#1a1d22"; ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);
  drawGrid();

  for (const e of entities) {
    if (e.hit) continue; // pick region only
    const L = (e.layer || "0").toUpperCase();
    if (!enabledLayers.has(L)) continue;
    if (e.labelOf !== undefined && !selectedParts.has(e.labelOf)) continue;
    const isSel = (e.part !== undefined && selectedParts.has(e.part)) || e.labelOf !== undefined;
    // label text stays white on the dark canvas; the geometry highlight is yellow
    const col = e.labelOf !== undefined ? "#ffffff" : isSel ? "#ffd84a" : e.color ?? layerColor(L);
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = isSel ? 2.5 : L === "SHEET" ? 2 : 1.5;
    ctx.setLineDash(e.dash ? [5, 4] : []);
    if ((e.type === "POLY" || e.type === "LINE") && e.pts) {
      if (!e.pts.length) continue;
      ctx.beginPath();
      ctx.moveTo(wx(e.pts[0][0]), wy(e.pts[0][1]));
      for (let k = 1; k < e.pts.length; k++) ctx.lineTo(wx(e.pts[k][0]), wy(e.pts[k][1]));
      if (e.closed) ctx.closePath();
      if (L === "PARTS") { ctx.save(); ctx.globalAlpha = 0.1; ctx.fill(); ctx.restore(); }
      ctx.stroke();
    } else if (e.type === "CIRCLE") {
      ctx.beginPath(); ctx.arc(wx(e.cx!), wy(e.cy!), e.r! * view.scale, 0, Math.PI * 2); ctx.stroke();
    } else if (e.type === "ARC") {
      // y is flipped, so swap & negate angles
      ctx.beginPath();
      ctx.arc(wx(e.cx!), wy(e.cy!), e.r! * view.scale, (-e.a1! * Math.PI) / 180, (-e.a0! * Math.PI) / 180);
      ctx.stroke();
    } else if (e.type === "TEXT") {
      const px = e.h! * view.scale; // true size; scales with zoom
      if (px < 8) continue;         // too small to read -> hide it (don't clamp & overlap)
      ctx.save();
      ctx.translate(wx(e.x!), wy(e.y!));
      if (e.rot) ctx.rotate((-e.rot * Math.PI) / 180); // DXF angle is CCW; screen y is flipped
      ctx.font = px + "px sans-serif";
      ctx.fillText(e.text!, 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

// ---------- part picking (generated sheets tag entities with their part) -----
function pointInPoly(x: number, y: number, pts: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distToSegments(x: number, y: number, pts: Pt[], closed: boolean): number {
  let best = Infinity;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[(i + 1) % pts.length];
    const dx = x1 - x0, dy = y1 - y0;
    const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / (dx * dx + dy * dy || 1)));
    best = Math.min(best, Math.hypot(x - (x0 + t * dx), y - (y0 + t * dy)));
  }
  return best;
}

function handlePick(px: number, py: number) {
  const x = sx2wx(px), y = sy2wy(py);
  const tol = 8 / view.scale; // ~8px, in inches
  // among everything under the cursor, the SMALLEST hit wins — so a part
  // nested inside another part's window picks the inner part, not the frame
  let hit: { part: number; area: number } | undefined;
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    if (e.part === undefined || e.labelOf !== undefined) continue;
    if (e.dash) continue; // rapids are travel, not the part — never a click target
    if (!enabledLayers.has((e.layer || "0").toUpperCase())) continue;
    let area: number | undefined;
    if (e.pts) {
      if (e.closed) {
        if (pointInPoly(x, y, e.pts)) {
          const xs = e.pts.map((p) => p[0]), ys = e.pts.map((p) => p[1]);
          area = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
        }
      } else if (distToSegments(x, y, e.pts, false) < tol) {
        area = 0; // touching a line is the most specific hit there is
      }
    } else if (e.type === "CIRCLE" && Math.hypot(x - e.cx!, y - e.cy!) <= e.r! + tol) {
      area = Math.PI * e.r! * e.r!;
    }
    if (area !== undefined && (!hit || area < hit.area)) hit = { part: e.part, area };
  }
  if (hit === undefined) return;
  selectedParts.has(hit.part) ? selectedParts.delete(hit.part) : selectedParts.add(hit.part);
  draw();
}

// ---------- interaction ------------------------------------------------------
let dragging = false, lastX = 0, lastY = 0, pressX = 0, pressY = 0;
canvas.addEventListener("mousedown", (e) => {
  dragging = true; lastX = e.offsetX; lastY = e.offsetY; pressX = e.offsetX; pressY = e.offsetY;
});
canvas.addEventListener("mouseup", (e) => {
  // a click (not a pan) toggles the part under the cursor
  if (Math.hypot(e.offsetX - pressX, e.offsetY - pressY) < 4) handlePick(e.offsetX, e.offsetY);
});
window.addEventListener("mouseup", () => { dragging = false; });
canvas.addEventListener("mousemove", (e) => {
  if (dragging) { view.ox += e.offsetX - lastX; view.oy -= e.offsetY - lastY; lastX = e.offsetX; lastY = e.offsetY; draw(); }
  const wxi = sx2wx(e.offsetX), wyi = sy2wy(e.offsetY);
  readout.textContent = `x ${wxi.toFixed(2)}"   y ${wyi.toFixed(2)}"   ·   scale ${view.scale.toFixed(2)} px/in`;
});
canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  const wxi = sx2wx(e.offsetX), wyi = sy2wy(e.offsetY);
  view.scale *= e.deltaY < 0 ? 1.1 : 1 / 1.1;
  view.ox = e.offsetX - wxi * view.scale;
  view.oy = canvas.clientHeight - e.offsetY - wyi * view.scale;
  draw();
}, { passive: false });

// ---------- touch (mobile): 1-finger pan, 2-finger pinch-zoom, dbl-tap fit ---
type TPoint = { x: number; y: number };
const touchPt = (t: Touch): TPoint => {
  const r = canvas.getBoundingClientRect();
  return { x: t.clientX - r.left, y: t.clientY - r.top };
};
const tdist = (a: TPoint, b: TPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const tmid = (a: TPoint, b: TPoint): TPoint => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

let tLast: TPoint = { x: 0, y: 0 };
let tGap = 0;
let tMoved = false;
let tStart = 0;
let lastTap = 0;

canvas.addEventListener("touchstart", (e) => {
  if (e.touches.length === 1) {
    tLast = touchPt(e.touches[0]);
    tMoved = false;
    tStart = e.timeStamp;
  } else if (e.touches.length === 2) {
    const a = touchPt(e.touches[0]), b = touchPt(e.touches[1]);
    tGap = tdist(a, b);
    tLast = tmid(a, b);
    tMoved = true; // a pinch is never a tap
  }
  e.preventDefault();
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  if (e.touches.length === 1) {
    const p = touchPt(e.touches[0]);
    if (Math.abs(p.x - tLast.x) + Math.abs(p.y - tLast.y) > 3) tMoved = true;
    view.ox += p.x - tLast.x;
    view.oy -= p.y - tLast.y;
    tLast = p;
    draw();
  } else if (e.touches.length === 2) {
    const a = touchPt(e.touches[0]), b = touchPt(e.touches[1]);
    const gap = tdist(a, b), m = tmid(a, b);
    const wxi = sx2wx(m.x), wyi = sy2wy(m.y);
    if (tGap > 0) view.scale *= gap / tGap; // pinch zoom about the midpoint
    view.ox = m.x - wxi * view.scale;       // keep that world point under fingers
    view.oy = canvas.clientHeight - m.y - wyi * view.scale;
    tGap = gap; tLast = m;
    draw();
  }
  e.preventDefault();
}, { passive: false });

let tapTimer: ReturnType<typeof setTimeout> | undefined;
canvas.addEventListener("touchend", (e) => {
  // double-tap fits; a confirmed single tap picks the part under the finger
  if (e.touches.length === 0 && !tMoved && e.timeStamp - tStart < 250) {
    if (e.timeStamp - lastTap < 300) {
      clearTimeout(tapTimer);
      fit();
      lastTap = 0;
    } else {
      lastTap = e.timeStamp;
      const p = { ...tLast };
      tapTimer = setTimeout(() => handlePick(p.x, p.y), 300);
    }
  }
  // dropping from two fingers to one: resume panning from the remaining finger
  if (e.touches.length === 1) { tLast = touchPt(e.touches[0]); tMoved = true; }
}, { passive: false });

// ---------- loading ----------------------------------------------------------
function loadEntities(ents: Entity[]) {
  hide3D(); // any 2D content (DXF or toolpath) lands in 2D mode
  setSim3D(null); // leaving the 3D toolpath tab — stop & hide playback
  selectedParts.clear();
  entities = ents;
  buildLegend();
  fit();
}

function load(text: string, label: string) {
  try {
    loadEntities(parseDXF(text));
    setInfo(`${label} — ${entities.length} entities`);
  } catch (err) {
    statusEl.textContent = "parse error: " + (err as Error).message;
    console.error(err);
  }
}

function readFile(f: File) {
  const r = new FileReader();
  r.onload = () => load(String(r.result), f.name);
  r.readAsText(f);
}

// ---- site nav (hamburger): switch between the app's Vite pages -------------
const SITE_PAGES = [
  { label: "Floor Plan", href: "/" },
  { label: "CAD · Cabinet Cuts", href: "/cad/" },
];
(() => {
  const btn = $<HTMLButtonElement>("menuBtn");
  const list = $<HTMLElement>("menuList");
  const here = location.pathname;
  const isCurrent = (href: string) =>
    href === "/" ? here === "/" : here.startsWith(href.replace(/\/$/, ""));
  SITE_PAGES.forEach((p) => {
    const a = document.createElement("a");
    a.href = p.href; a.textContent = p.label;
    if (isCurrent(p.href)) a.className = "current";
    list.append(a);
  });
  // Move the dropdown to <body> so the toolbar's horizontal scroll/overflow
  // can never clip it; position it under the button on open (fixed coords).
  document.body.appendChild(list);
  const setOpen = (open: boolean) => {
    if (open) {
      const r = btn.getBoundingClientRect();
      list.style.top = `${r.bottom + 4}px`;
      list.style.left = `${r.left}px`;
    }
    list.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
  };
  btn.addEventListener("click", (e) => { e.stopPropagation(); setOpen(list.hidden); });
  document.addEventListener("click", (e) => {
    const t = e.target as Node;
    if (!btn.contains(t) && !list.contains(t)) setOpen(false);
  });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false); });
  window.addEventListener("resize", () => setOpen(false));
})();

// ---- toolbars: fade scroll edges (header + the sheet tab bar) ---------------
function fadeScrollEdges(bar: HTMLElement) {
  const EDGE = 28; // px width of the fade at a scrollable edge
  const update = () => {
    const left = bar.scrollLeft > 1;
    const right = bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 1;
    const mask =
      left && right
        ? `linear-gradient(to right, transparent, #000 ${EDGE}px, #000 calc(100% - ${EDGE}px), transparent)`
        : left
          ? `linear-gradient(to right, transparent, #000 ${EDGE}px)`
          : right
            ? `linear-gradient(to right, #000 calc(100% - ${EDGE}px), transparent)`
            : "";
    bar.style.setProperty("-webkit-mask-image", mask);
    bar.style.setProperty("mask-image", mask);
  };
  bar.addEventListener("scroll", update);
  window.addEventListener("resize", update);
  // tab buttons are (re)built at runtime — refresh the fade when they change
  new MutationObserver(update).observe(bar, { childList: true });
  update();
}
fadeScrollEdges(document.querySelector("header") as HTMLElement);
fadeScrollEdges($<HTMLElement>("tabs"));

// ---- cabinets, programs + sheets ---------------------------------------------
// The dropdown picks a CABINET (3D + per-board DXF/G-code sheets) or a
// standalone PROGRAM (machine job with just a G-code sheet, e.g. wasteboard
// surfacing) — everything generated from its definition.
const CABINETS: Cabinet[] = [upper18, upper18saw];

interface Program {
  program: true;
  id: string;
  name: string;
  info: string;
  size: [number, number]; // area drawn behind the toolpath
  filename: string; // download name
  job: () => CamJob;
}
const PROGRAMS: Program[] = [{
  program: true,
  id: "surfacing",
  name: "Wasteboard Surfacing",
  info: `Flatten the wasteboard — ${SURF.bitDia}" surfacing bit, ${SURF.passDepth}"/pass x ${Math.round(SURF.totalDepth / SURF.passDepth)} passes (zero Z on the HIGHEST spot)`,
  size: SURF.area,
  filename: "wasteboard_surfacing.nc",
  job: surfacingJob,
}];

// A standalone 3D TOOLPATH view of an EXTERNAL G-code file. The file is the
// deliverable and is kept byte-for-byte intact: `gcode` is the raw text (used
// verbatim for download), `toolpath` is a parsed copy used only to draw it.
interface GcodeView {
  gcodeView: true;
  id: string;
  name: string;
  info: string;
  filename: string; // download name (the original file name)
  gcode: string; // the original file text, verbatim
  toolpath: Toolpath; // parsed copy, for the 3D drawing only
  canvas: ToolpathCanvas; // the stock sheet drawn under the cuts (2D + 3D)
}
// the external file doesn't state its stock size, so we draw it on a 4x4 sheet
function makeGcodeView(id: string, name: string, filename: string, raw: string,
  canvas: ToolpathCanvas = { x: [0, 48], y: [0, 48] }): GcodeView {
  const toolpath = parseToolpath(raw);
  const { stats, bounds } = toolpath;
  const w = bounds.maxx - bounds.minx, h = bounds.maxy - bounds.miny;
  const info = `${name} — external G-code, kept byte-for-byte intact. ` +
    `Toolpath ${w.toFixed(1)}" x ${h.toFixed(1)}", ${stats.depth.toFixed(3)}" deep in ` +
    `${stats.passes} ${stats.passes === 1 ? "pass" : "passes"} — ~${stats.minutes} min, ` +
    `${stats.lines} lines. Drag to orbit; download hands back the original file.`;
  return { gcodeView: true, id, name, info, filename, gcode: raw, toolpath, canvas };
}
const GVIEWS: GcodeView[] = [
  makeGcodeView("test-gcode", 'Test G-code (3D toolpath)', "Test Gcode for Chris.gcode", testGcodeRaw),
];

type Item = Cabinet | Program | GcodeView;
// order in the dropdown: cabinets, then the G-code views (so this one sits
// directly under 'Upper 18" (circular saw)'), then standalone programs
const ITEMS: Item[] = [...CABINETS, ...GVIEWS, ...PROGRAMS];
const isProgram = (i: Item): i is Program => "program" in i;
const isGcodeView = (i: Item): i is GcodeView => "gcodeView" in i;

type Sheet =
  | { label: string; kind: "3d" }
  | { label: string; kind: "dxf" | "gcode" | "camsim3d"; board: number }
  | { label: string; kind: "prog" }
  | { label: string; kind: "gview3d" | "gview2d" };

function sheetsOf(item: Item): Sheet[] {
  if (isGcodeView(item)) return [
    { label: "3D Toolpath", kind: "gview3d" },
    { label: "G-code", kind: "gview2d" },
  ];
  if (isProgram(item)) return [{ label: "Surfacing G-code", kind: "prog" }];
  return [
    { label: "3D", kind: "3d" },
    ...item.boards.flatMap((b, i): Sheet[] => [
      { label: b.label, kind: "dxf", board: i },
      { label: `${b.label.split(" - ")[0]} Sim`, kind: "camsim3d", board: i },
      { label: `${b.label.split(" - ")[0]} G-code`, kind: "gcode", board: i },
    ]),
  ];
}

// CAM jobs are deterministic per (cabinet, board) — generate once, reuse for
// the viewer and the download.
const camCache = new Map<string, CamJob>();
function camJob(cab: Cabinet, bi: number): CamJob {
  const key = `${cab.id}/${bi}`;
  let job = camCache.get(key);
  if (!job) { job = camBoard(cab, bi); camCache.set(key, job); }
  return job;
}
function programJob(p: Program): CamJob {
  let job = camCache.get(p.id);
  if (!job) { job = p.job(); camCache.set(p.id, job); }
  return job;
}

// the board's CAM G-code, parsed into a toolpath for the 3D "Sim" tab — same
// playback view the external G-code uses, just fed our own generated program
const camTpCache = new Map<string, Toolpath>();
function camToolpath(cab: Cabinet, bi: number): Toolpath {
  const key = `${cab.id}/${bi}`;
  let tp = camTpCache.get(key);
  if (!tp) { tp = parseToolpath(camJob(cab, bi).gcode); camTpCache.set(key, tp); }
  return tp;
}

const rectPts = (x: number, y: number, w: number, h: number): Pt[] =>
  [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];

// DXF board sheet, built directly from the cabinet so every entity knows its
// part (click to toggle highlight + label). The downloaded .dxf keeps its
// always-on LABELS layer for the CAM operator.
function boardEntities(cab: Cabinet, bi: number): Entity[] {
  const [w, h] = cab.boards[bi].size;
  const ents: Entity[] = [
    { type: "POLY", layer: "SHEET", closed: true, pts: rectPts(0, 0, w, h) },
    { type: "POLY", layer: "BLEED", closed: true, pts: rectPts(BLEED, BLEED, w - 2 * BLEED, h - 2 * BLEED) },
  ];
  const note = (n: { x: number; y: number; text: string; rot?: number }, part: number): Entity =>
    ({ type: "TEXT", layer: "PARTS", x: n.x, y: n.y, h: 1.2, text: n.text, rot: n.rot, labelOf: part });
  for (const s of boardShapes(cab, bi)) {
    ents.push({ type: "POLY", layer: "PARTS", closed: true, part: s.part,
      pts: rectPts(s.rect.x, s.rect.y, s.rect.w, s.rect.h) });
    if (s.pocket) {
      ents.push({ type: "POLY", layer: s.pocket.layer, closed: true, part: s.part,
        pts: rectPts(s.pocket.rect.x, s.pocket.rect.y, s.pocket.rect.w, s.pocket.rect.h) });
      ents.push(note(s.pocket.note, s.part));
    }
    if (s.cutout) {
      ents.push({ type: "POLY", layer: "PARTS", closed: true, part: s.part,
        pts: rectPts(s.cutout.rect.x, s.cutout.rect.y, s.cutout.rect.w, s.cutout.rect.h) });
      ents.push(note(s.cutout.note, s.part));
    }
    if (s.drills) {
      for (const c of s.drills.holes) {
        ents.push({ type: "CIRCLE", layer: s.drills.layer, part: s.part, cx: c.x, cy: c.y, r: c.r });
      }
      ents.push(note(s.drills.note, s.part));
    }
    ents.push(note(s.label, s.part));
  }
  return ents;
}

function toolpathEntities(cab: Cabinet, bi: number): Entity[] {
  const job = camJob(cab, bi);
  const [w, h] = cab.boards[bi].size;
  const ents: Entity[] = [
    { type: "POLY", layer: "SHEET", closed: true, pts: rectPts(0, 0, w, h) },
  ];
  for (const s of job.view.segs) {
    ents.push({ type: "LINE", layer: s.rapid ? "RAPIDS" : "CUTS",
      pts: [[s.x0, s.y0], [s.x1, s.y1]], color: s.color, dash: s.rapid, part: s.part });
  }
  for (const [px, py] of job.view.plunges) {
    ents.push({ type: "CIRCLE", layer: "PLUNGES", cx: px, cy: py, r: 0.125 });
  }
  for (const l of job.view.labels) {
    ents.push({ type: "TEXT", layer: "CUTS", x: l.x, y: l.y, h: 1.2, text: l.text, rot: l.rot, labelOf: l.part });
  }
  // invisible part outlines, appended last so a click anywhere inside a part
  // picks it (reverse-order hit test) — same feel as the DXF sheets
  for (const s of boardShapes(cab, bi)) {
    ents.push({ type: "POLY", layer: "CUTS", closed: true, part: s.part, hit: true,
      pts: rectPts(s.rect.x, s.rect.y, s.rect.w, s.rect.h) });
  }
  return ents;
}

// standalone program (e.g. surfacing): the area outline + its toolpath
function programEntities(prog: Program): Entity[] {
  const job = programJob(prog);
  const ents: Entity[] = [
    { type: "POLY", layer: "SHEET", closed: true, pts: rectPts(0, 0, prog.size[0], prog.size[1]) },
  ];
  for (const s of job.view.segs) {
    ents.push({ type: "LINE", layer: s.rapid ? "RAPIDS" : "CUTS",
      pts: [[s.x0, s.y0], [s.x1, s.y1]], color: s.color, dash: s.rapid });
  }
  return ents;
}
// 2D top-down toolpath of an external G-code file — the SAME view as a
// cabinet's "G-code" cut sheet (depth-shaded cuts, dashed rapids, plunge
// circles, the grid + layer legend), built from the parsed copy.
function gcodeViewEntities(gv: GcodeView): Entity[] {
  const { moves, stats } = gv.toolpath;
  const depthCol = (z: number) => {
    const t = stats.depth > 0 ? Math.min(1, Math.max(0, -z / stats.depth)) : 0;
    return `hsl(${Math.round(120 - 120 * t)},70%,55%)`;
  };
  const [sx0, sx1] = gv.canvas.x, [sy0, sy1] = gv.canvas.y; // full sheet outline
  const ents: Entity[] = [
    { type: "POLY", layer: "SHEET", closed: true, pts: rectPts(sx0, sy0, sx1 - sx0, sy1 - sy0) },
  ];
  // top-down has no depth ordering, so draw DEEPEST cuts first — shallower
  // (greener) passes land on top, agreeing with the 3D view's shading
  const cuts = moves.filter((m) => !m.rapid && !m.plunge
    && (Math.abs(m.x1 - m.x0) > 1e-9 || Math.abs(m.y1 - m.y0) > 1e-9));
  cuts.sort((a, b) => Math.min(a.z0, a.z1) - Math.min(b.z0, b.z1));
  for (const mv of cuts) {
    ents.push({ type: "LINE", layer: "CUTS", pts: [[mv.x0, mv.y0], [mv.x1, mv.y1]],
      color: depthCol(Math.min(mv.z0, mv.z1)) });
  }
  for (const mv of moves) {
    if (mv.rapid) ents.push({ type: "LINE", layer: "RAPIDS", dash: true, pts: [[mv.x0, mv.y0], [mv.x1, mv.y1]] });
    else if (mv.plunge) ents.push({ type: "CIRCLE", layer: "PLUNGES", cx: mv.x1, cy: mv.y1, r: 0.06 });
  }
  return ents;
}

CABINETS.forEach((c) => {
  const errs = validateNest(c);
  if (errs.length) {
    console.warn(`nest validation failed for ${c.id}:\n` + errs.join("\n"));
    statusEl.textContent = `nest error in ${c.id} — see console`;
  }
});

let cabIdx = 0;
let sheetIdx = 0; // 0 = 3D, 1..N = boards, -1 = a dropped .dxf file
let in3D = false;
let current3D: Cabinet3D | null = null;
const views = new Map<string, Cabinet3D>();
const explodeWrap = $<HTMLElement>("explodeWrap");
const explodeSlider = $<HTMLInputElement>("explode");
const simBar = $<HTMLElement>("simBar");
const simPlay = $<HTMLButtonElement>("simPlay");
const simPrev = $<HTMLButtonElement>("simPrev");
const simNext = $<HTMLButtonElement>("simNext");
const simPlayIcon = $<HTMLElement>("simPlayIcon");
const simScrub = $<HTMLInputElement>("simScrub");
const simSpeed = $<HTMLSelectElement>("simSpeed");
const simTimeEl = $<HTMLElement>("simTime");
const simStatEl = $<HTMLElement>("simStat");
const dlBtn = $<HTMLButtonElement>("dl");
const dlLabel = $<HTMLElement>("dlLabel");
const tabsEl = $<HTMLElement>("tabs");

// ---- info button: the per-sheet description lives in its tooltip; a click
// (works on touch, where tooltips don't) shows it in a small popover.
const infoBtn = $<HTMLButtonElement>("info");
const infoPop = document.createElement("div");
infoPop.className = "info-pop";
infoPop.hidden = true;
document.body.appendChild(infoPop);
function setInfo(text: string) {
  infoBtn.title = text;
  infoPop.hidden = true;
}
infoBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  if (!infoPop.hidden) { infoPop.hidden = true; return; }
  infoPop.textContent = infoBtn.title;
  const r = infoBtn.getBoundingClientRect();
  infoPop.style.top = `${r.bottom + 6}px`;
  infoPop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 348))}px`;
  infoPop.hidden = false;
});
document.addEventListener("click", () => { infoPop.hidden = true; });

explodeSlider.addEventListener("input", () =>
  current3D?.setExplode(Number(explodeSlider.value) / 100));

// Show a 3D view (cabinet OR toolpath). Both implement Cabinet3D, so the same
// machinery — caching, legend, fit/reset — drives either. `withExplode` gates
// the explode slider, which only makes sense for an assembled cabinet.
function showView3D(id: string, make: () => Cabinet3D, info: string, withExplode: boolean): Cabinet3D {
  let v = views.get(id);
  if (!v) { v = make(); views.set(id, v); }
  if (current3D && current3D !== v) current3D.hide();
  current3D = v;
  in3D = true;
  canvas.style.display = "none";
  readout.style.display = "none";
  explodeWrap.hidden = !withExplode;
  v.layers.forEach((l) => v!.setLayerVisible(l.name, true)); // match the fresh legend
  buildLegend3D(v);
  if (withExplode) v.setExplode(Number(explodeSlider.value) / 100);
  v.show();
  setInfo(info);
  return v;
}

function show3D(cab: Cabinet) {
  showView3D(cab.id, () => createCabinet3D(cab, $<HTMLElement>("wrap")), cab.info, true);
}

function hide3D() {
  if (!in3D) return;
  in3D = false;
  current3D?.hide();
  canvas.style.display = "";
  readout.style.display = "";
  explodeWrap.hidden = true;
  resize(); // the 2D canvas was 0-sized while hidden
}

// ---- 3D toolpath playback (Play / scrub / speed) ---------------------------
// Drives the active toolpath view's setSim(0..1). simT is the fraction of the
// run revealed; at rest it sits at 1 (whole path shown) and Play restarts it.
const PLAY_ICON = '<path d="M4 3l9 5-9 5z"/>';
const PAUSE_ICON = '<path d="M4 3h3v10H4zM9 3h3v10H9z"/>';
const FULL_PLAY_SEC = 16; // wall-clock seconds to play the whole path at 1x
let sim3d: Toolpath3D | null = null;
let simT = 1;
let simPlaying = false;
let simRaf = 0;
let simLastTs = 0;

function fmtSimStatus(st: SimStatus | undefined): string {
  if (!st || st.phase === "idle") return "";
  // signed Z always shown: +above the stock (travel/retract), -cutting into it
  const z = `Z ${st.z >= 0 ? "+" : ""}${st.z.toFixed(3)}"`;
  const bit = st.tool ? `${st.tool} · ` : ""; // active bit, shown throughout
  if (st.phase === "start") return `START · ${bit}${z}`;
  if (st.phase === "toolchange") return `TOOL CHANGE → load ${st.tool} bit · retract ${z}`;
  if (st.phase === "end") return `END · ${bit}parked at home · ${z} (retracted)`;
  const label = st.phase === "rapid" ? "RAPID" : st.phase === "plunge" ? "PLUNGE" : "CUT";
  const rate = st.feed > 0 ? `${st.feed} ipm` : "rapid travel";
  return `${bit}${label} · ${z} · ${rate}`;
}
function applySim() {
  const st = sim3d?.setSim(simT);
  simScrub.value = String(Math.round(simT * 1000));
  simTimeEl.textContent = `${Math.round(simT * 100)}%`;
  simStatEl.textContent = fmtSimStatus(st);
}
function setSimPlaying(on: boolean) {
  if (on && !sim3d) return;
  if (on && simT >= 1) simT = 0; // finished/at-rest -> restart from the top
  simPlaying = on;
  simPlayIcon.innerHTML = on ? PAUSE_ICON : PLAY_ICON;
  simPlay.setAttribute("aria-label", on ? "Pause simulation" : "Play simulation");
  if (on) { simLastTs = 0; simRaf = requestAnimationFrame(simTick); }
  else if (simRaf) { cancelAnimationFrame(simRaf); simRaf = 0; }
}
function simTick(ts: number) {
  const dt = simLastTs ? (ts - simLastTs) / 1000 : 0;
  simLastTs = ts;
  simT = Math.min(1, simT + (dt * Number(simSpeed.value)) / FULL_PLAY_SEC);
  applySim();
  if (simT >= 1) { setSimPlaying(false); return; }
  if (simPlaying) simRaf = requestAnimationFrame(simTick);
}
// Attach playback to a toolpath view (or null to hide + stop). Resets to the
// full path at rest, so the tab opens looking complete; Play restarts it.
function setSim3D(view: Toolpath3D | null) {
  setSimPlaying(false);
  sim3d = view;
  simBar.hidden = !view;
  if (view) { simT = 1; applySim(); }
}
simPlay.addEventListener("click", () => setSimPlaying(!simPlaying));
simScrub.addEventListener("input", () => {
  setSimPlaying(false);
  simT = Number(simScrub.value) / 1000;
  applySim();
});

// step one toolpath move at a time (stepping pauses playback)
function simStep(dir: 1 | -1) {
  if (!sim3d) return;
  setSimPlaying(false);
  simT = sim3d.stepSim(simT, dir);
  applySim();
}
// press = one step; press-and-hold = scan continuously (350ms delay, then ~14/s)
function holdToRepeat(btn: HTMLButtonElement, fn: () => void) {
  let delay: ReturnType<typeof setTimeout>, repeat: ReturnType<typeof setInterval>;
  const stop = () => { clearTimeout(delay); clearInterval(repeat); };
  btn.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    fn();
    delay = setTimeout(() => { repeat = setInterval(fn, 70); }, 350);
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, stop));
}
holdToRepeat(simPrev, () => simStep(-1));
holdToRepeat(simNext, () => simStep(1));

const cabSel = $<HTMLSelectElement>("page");
ITEMS.forEach((c, idx) => {
  const o = document.createElement("option");
  o.value = String(idx); o.textContent = c.name;
  cabSel.append(o);
});

function buildTabs(item: Item) {
  tabsEl.innerHTML = "";
  sheetsOf(item).forEach((s, si) => {
    const b = document.createElement("button");
    b.textContent = s.label;
    b.addEventListener("click", () => goTo(cabIdx, si));
    tabsEl.append(b);
  });
}

function markActiveTab() {
  [...tabsEl.children].forEach((b, si) => b.classList.toggle("active", si === sheetIdx));
}

function goTo(ci: number, si: number) {
  if (ci < 0 || ci >= ITEMS.length) return;
  const item = ITEMS[ci];
  if (ci !== cabIdx || !tabsEl.children.length) { cabIdx = ci; buildTabs(item); }
  const sheets = sheetsOf(item);
  if (si < 0 || si >= sheets.length) si = 0;
  sheetIdx = si;
  cabSel.value = String(ci);
  markActiveTab();
  const sheet = sheets[si];
  dlBtn.hidden = sheet.kind === "3d";
  setSim3D(null); // playback bar is only for the 3D toolpath tab (below)
  if (sheet.kind === "3d") {
    show3D(item as Cabinet);
  } else if (sheet.kind === "gview3d") {
    const gv = item as GcodeView;
    dlLabel.textContent = "Download G-code";
    const v = showView3D(gv.id, () => createToolpath3D(gv.toolpath, $<HTMLElement>("wrap"), gv.canvas), gv.info, false);
    setSim3D(v as Toolpath3D);
  } else if (sheet.kind === "gview2d") {
    const gv = item as GcodeView;
    dlLabel.textContent = "Download G-code";
    loadEntities(gcodeViewEntities(gv));
    setInfo(gv.info);
  } else if (sheet.kind === "camsim3d") {
    const cab = item as Cabinet;
    dlLabel.textContent = "Download G-code";
    const job = camJob(cab, sheet.board);
    const [bw, bh] = cab.boards[sheet.board].size; // show the full sheet as the canvas
    const v = showView3D(`${cab.id}-cam3d-${sheet.board}`,
      () => createToolpath3D(camToolpath(cab, sheet.board), $<HTMLElement>("wrap"), { x: [0, bw], y: [0, bh] }),
      `${cab.name} — ${cab.boards[sheet.board].label} — 3D cut animation, ~${job.stats.minutes} min @ ${CAM.feed} ipm — press play`,
      false);
    setSim3D(v as Toolpath3D);
  } else if (sheet.kind === "prog") {
    const prog = item as Program;
    dlLabel.textContent = "Download G-code";
    const job = programJob(prog);
    loadEntities(programEntities(prog));
    setInfo(`${prog.info} — ~${job.stats.minutes} min, ${job.stats.lines} lines`);
  } else if (sheet.kind === "dxf") {
    const cab = item as Cabinet;
    dlLabel.textContent = "Download DXF";
    loadEntities(boardEntities(cab, sheet.board));
    setInfo(`${cab.name} — ${sheet.label} — ${BIT_LABEL} bit — click a part to label it`);
  } else {
    const cab = item as Cabinet;
    dlLabel.textContent = "Download G-code";
    const job = camJob(cab, sheet.board);
    loadEntities(toolpathEntities(cab, sheet.board));
    setInfo(`${cab.name} — ${sheet.label} — ${BIT_LABEL} bit, ~${job.stats.minutes} min @ ${CAM.feed} ipm, ${job.stats.lines} lines — click a part to label it`);
  }
  history.replaceState(null, "", `?cab=${encodeURIComponent(item.id)}&sheet=${si}`);
}

cabSel.addEventListener("change", (e) => goTo(parseInt((e.target as HTMLSelectElement).value, 10), 0));
$<HTMLButtonElement>("prev").addEventListener("click", () => goTo(cabIdx, Math.max(0, sheetIdx - 1)));
$<HTMLButtonElement>("next").addEventListener("click", () =>
  goTo(cabIdx, Math.min(sheetsOf(ITEMS[cabIdx]).length - 1, sheetIdx + 1)));
$<HTMLButtonElement>("fit").addEventListener("click", () => (in3D ? current3D?.resetView() : fit()));

// download the current sheet — DXF for CAM, or G-code straight into UGS
dlBtn.addEventListener("click", () => {
  const item = ITEMS[cabIdx];
  const sheet = sheetsOf(item)[sheetIdx];
  if (!sheet || sheet.kind === "3d") return;
  const file = isGcodeView(item)
    ? { text: item.gcode, name: item.filename, mime: "text/plain" }
    : sheet.kind === "prog"
    ? { text: programJob(item as Program).gcode, name: (item as Program).filename, mime: "text/plain" }
    : sheet.kind === "dxf"
      ? { text: boardToDXF(item as Cabinet, sheet.board), name: `${item.id}_board${sheet.board + 1}.dxf`, mime: "application/dxf" }
      : { text: camJob(item as Cabinet, sheet.board).gcode, name: `${item.id}_board${sheet.board + 1}.nc`, mime: "text/plain" };
  const blob = new Blob([file.text], { type: file.mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  URL.revokeObjectURL(a.href);
});

// startup: honor ?cab=&sheet=, else the first cabinet's 3D sheet
{
  const q = new URLSearchParams(location.search);
  const ci = Math.max(0, ITEMS.findIndex((c) => c.id === q.get("cab")));
  const si = parseInt(q.get("sheet") ?? "0", 10) || 0;
  goTo(ci, si);
}

// drag & drop
const drop = $<HTMLElement>("drop");
const wrapEl = $<HTMLElement>("wrap");
(["dragenter", "dragover"] as const).forEach((ev) =>
  wrapEl.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("on"); }));
(["dragleave", "drop"] as const).forEach((ev) =>
  wrapEl.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("on"); }));
wrapEl.addEventListener("drop", (e) => {
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) {
    readFile(f);
    sheetIdx = -1; // viewing a dropped file — no sheet tab is active
    markActiveTab();
    dlBtn.hidden = true;
  }
});

resize();
