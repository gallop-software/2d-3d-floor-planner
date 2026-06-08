import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { Cabinet, Part, PartBox } from "./model";

// Generic 3D CAD drawing of a Cabinet (see model.ts). Renders each part's
// assembled box (a part with a pocket renders as a solid slab with the
// center cleared), overall dimension callouts in the assembled state, and
// per-part cut-size callouts in the exploded state.

export interface Cabinet3D {
  layers: { name: string; color: string }[];
  setLayerVisible(name: string, on: boolean): void;
  setExplode(t: number): void; // 0 assembled .. 1 exploded
  resetView(): void;
  show(): void;
  hide(): void;
  resize(): void;
}

// A pocketed slab is ONE piece of wood; the five boxes only model its volume
// (four full-thickness borders + the floor left under the cleared center).
// They render without per-box edges so no seams show — the slab's outline
// comes from pocketEdgeSegments() instead.
function pocketBoxes(p: Part): PartBox[] {
  const { inset, depth } = p.pocket!;
  const { x, y, z } = p.box;
  return [
    { x: [x[0], x[0] + inset], y, z },
    { x: [x[1] - inset, x[1]], y, z },
    { x: [x[0] + inset, x[1] - inset], y: [y[0], y[0] + inset], z },
    { x: [x[0] + inset, x[1] - inset], y: [y[1] - inset, y[1]], z },
    { x: [x[0] + inset, x[1] - inset], y: [y[0] + inset, y[1] - inset], z: [z[0], z[1] - depth] },
  ];
}

type Axis = "x" | "y" | "z";
// classify a box's axes by extent: [thickness, short, long] — the same
// convention as model.ts cutSize (u runs along short, v along long)
function axesOf(box: PartBox): [Axis, Axis, Axis] {
  const exts: [Axis, number][] = [
    ["x", box.x[1] - box.x[0]], ["y", box.y[1] - box.y[0]], ["z", box.z[1] - box.z[0]],
  ];
  exts.sort((a, b) => a[1] - b[1]);
  return [exts[0][0], exts[1][0], exts[2][0]];
}

// A one-piece frame (through window) drawn as four border boxes — seamless,
// with edge lines from cutoutEdgeSegments().
function cutoutBoxes(p: Part): PartBox[] {
  const [, s, l] = axesOf(p.box);
  const S = p.box[s], L = p.box[l];
  const { insetU, insetV } = p.cutout!;
  const mk = (sSpan: [number, number], lSpan: [number, number]): PartBox => {
    const spans = { x: p.box.x, y: p.box.y, z: p.box.z };
    return { ...spans, [s]: sSpan, [l]: lSpan } as PartBox;
  };
  return [
    mk([S[0], S[0] + insetU], L),
    mk([S[1] - insetU, S[1]], L),
    mk([S[0] + insetU, S[1] - insetU], [L[0], L[0] + insetV]),
    mk([S[0] + insetU, S[1] - insetU], [L[1] - insetV, L[1]]),
  ];
}

// Edge lines for the one-piece frame: outer box edges plus the window's rim
// on both faces and its four through corner lines.
function cutoutEdgeSegments(p: Part): THREE.Vector3[] {
  const [t, s, l] = axesOf(p.box);
  const T = p.box[t], S = p.box[s], L = p.box[l];
  const { insetU, insetV } = p.cutout!;
  const pts: THREE.Vector3[] = [];
  const pt = (tv: number, sv: number, lv: number) => {
    const o = { x: 0, y: 0, z: 0 };
    o[t] = tv; o[s] = sv; o[l] = lv;
    return new THREE.Vector3(o.x, o.y, o.z);
  };
  const seg = (a: THREE.Vector3, b: THREE.Vector3) => pts.push(a, b);
  const ring = (s0: number, s1: number, l0: number, l1: number, tv: number) => {
    seg(pt(tv, s0, l0), pt(tv, s1, l0));
    seg(pt(tv, s1, l0), pt(tv, s1, l1));
    seg(pt(tv, s1, l1), pt(tv, s0, l1));
    seg(pt(tv, s0, l1), pt(tv, s0, l0));
  };
  for (const tv of T) ring(S[0], S[1], L[0], L[1], tv);
  for (const sv of S) for (const lv of L) seg(pt(T[0], sv, lv), pt(T[1], sv, lv));
  const ws: [number, number] = [S[0] + insetU, S[1] - insetU];
  const wl: [number, number] = [L[0] + insetV, L[1] - insetV];
  for (const tv of T) ring(ws[0], ws[1], wl[0], wl[1], tv);
  for (const sv of ws) for (const lv of wl) seg(pt(T[0], sv, lv), pt(T[1], sv, lv));
  return pts;
}

// Edge lines for a solid slab with a milled pocket: the 12 outer slab edges,
// plus the pocket's rim (front face), floor rectangle, and the four short
// wall lines between them. No internal seams.
function pocketEdgeSegments(p: Part): THREE.Vector3[] {
  const { x, y, z } = p.box;
  const { inset, depth } = p.pocket!;
  const pts: THREE.Vector3[] = [];
  const seg = (a: [number, number, number], b: [number, number, number]) =>
    pts.push(new THREE.Vector3(...a), new THREE.Vector3(...b));
  const ring = (x0: number, x1: number, y0: number, y1: number, zz: number) => {
    seg([x0, y0, zz], [x1, y0, zz]);
    seg([x1, y0, zz], [x1, y1, zz]);
    seg([x1, y1, zz], [x0, y1, zz]);
    seg([x0, y1, zz], [x0, y0, zz]);
  };
  // outer slab: front + back rings and the four through edges
  ring(x[0], x[1], y[0], y[1], z[0]);
  ring(x[0], x[1], y[0], y[1], z[1]);
  for (const xx of x) for (const yy of y) seg([xx, yy, z[0]], [xx, yy, z[1]]);
  // pocket: rim at the front face, floor at z1 - depth, four wall lines
  const px = [x[0] + inset, x[1] - inset] as const;
  const py = [y[0] + inset, y[1] - inset] as const;
  const zf = z[1] - depth;
  ring(px[0], px[1], py[0], py[1], z[1]);
  ring(px[0], px[1], py[0], py[1], zf);
  for (const xx of px) for (const yy of py) seg([xx, yy, z[1]], [xx, yy, zf]);
  return pts;
}

export function createCabinet3D(cab: Cabinet, wrap: HTMLElement): Cabinet3D {
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
  const sun = new THREE.DirectionalLight(0xffffff, 0.7);
  sun.position.set(-40, 60, 50);
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0xffffff, 0.3);
  fill.position.set(45, 15, -30);
  scene.add(fill);

  // center the root on the cabinet's assembled bounding box
  const bb = new THREE.Box3();
  for (const p of cab.parts) {
    bb.expandByPoint(new THREE.Vector3(p.box.x[0], p.box.y[0], p.box.z[0]));
    bb.expandByPoint(new THREE.Vector3(p.box.x[1], p.box.y[1], p.box.z[1]));
  }
  const center = bb.getCenter(new THREE.Vector3());
  const diag = bb.getSize(new THREE.Vector3()).length();

  const root = new THREE.Group();
  root.position.copy(center).negate();
  scene.add(root);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 2000);
  const HOME_POS = new THREE.Vector3(-58, 26, 68).normalize().multiplyScalar(diag * 1.95);
  const HOME_TGT = new THREE.Vector3(0, 1, 0);
  camera.position.copy(HOME_POS);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(HOME_TGT);
  controls.update();

  const layerColor = new Map(cab.layers.map((l) => [l.name, l.color]));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x30353b });
  const matCache = new Map<string, THREE.MeshLambertMaterial>();
  const material = (color: string) => {
    let m = matCache.get(color);
    if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); }
    return m;
  };

  // ---- build the parts -------------------------------------------------------
  const layerGroups = new Map<string, THREE.Group>();
  const layerGroup = (name: string) => {
    let g = layerGroups.get(name);
    if (!g) { g = new THREE.Group(); layerGroups.set(name, g); root.add(g); }
    return g;
  };
  const exploded: { group: THREE.Group; offset: THREE.Vector3 }[] = [];
  const partLabels: { obj: CSS2DObject; layer: string; part: number }[] = [];
  const pickMeshes: THREE.Mesh[] = []; // every part mesh, tagged for raycasting

  cab.parts.forEach((part, pi) => {
    const g = new THREE.Group();
    const color = layerColor.get(part.layer) ?? "#cccccc";
    const addPartMesh = (mesh: THREE.Mesh) => {
      mesh.userData.part = pi;
      mesh.userData.layerName = part.layer;
      mesh.userData.baseMat = mesh.material;
      pickMeshes.push(mesh);
      g.add(mesh);
    };
    const isOnePiece = Boolean(part.pocket || part.cutout);
    const boxes = part.pocket ? pocketBoxes(part) : part.cutout ? cutoutBoxes(part) : [part.box];
    for (const b of boxes) {
      const geo = new THREE.BoxGeometry(b.x[1] - b.x[0], b.y[1] - b.y[0], b.z[1] - b.z[0]);
      const mesh = new THREE.Mesh(geo, material(color));
      mesh.position.set((b.x[0] + b.x[1]) / 2, (b.y[0] + b.y[1]) / 2, (b.z[0] + b.z[1]) / 2);
      // a pocketed/windowed part is one solid piece — no seam lines between its boxes
      if (!isOnePiece) mesh.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat));
      addPartMesh(mesh);
    }
    if (part.pocket) {
      g.add(new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pocketEdgeSegments(part)), edgeMat));
    }
    if (part.cutout) {
      g.add(new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(cutoutEdgeSegments(part)), edgeMat));
    }
    if (part.holes?.length) {
      // map cut coords (u along the short axis, v along the long axis — same
      // convention as model.ts cutSize) back onto the assembled box, on the
      // face the holes open onto
      const { x, y, z } = part.box;
      const exts: ["x" | "y" | "z", number][] = [
        ["x", x[1] - x[0]], ["y", y[1] - y[0]], ["z", z[1] - z[0]],
      ];
      exts.sort((a, b) => a[1] - b[1]);
      const [tAxis, sAxis, lAxis] = [exts[0][0], exts[1][0], exts[2][0]];
      const span = (a: "x" | "y" | "z") => part.box[a];
      const faceCoord = part.holesFace === "min"
        ? span(tAxis)[0] - 0.02
        : span(tAxis)[1] + 0.02;
      const holeGeo = new THREE.CylinderGeometry(
        part.holes[0].dia / 2, part.holes[0].dia / 2, 0.04, 12);
      const holeMat = material("#33383e");
      for (const hole of part.holes) {
        const disk = new THREE.Mesh(holeGeo, holeMat);
        const pos = { x: 0, y: 0, z: 0 };
        pos[sAxis] = span(sAxis)[0] + hole.u;
        pos[lAxis] = span(lAxis)[0] + hole.v;
        pos[tAxis] = faceCoord;
        if (tAxis === "x") disk.rotation.z = Math.PI / 2;
        else if (tAxis === "z") disk.rotation.x = Math.PI / 2;
        disk.position.set(pos.x, pos.y, pos.z);
        g.add(disk); // cosmetic — not pickable, not highlighted
      }
    }
    const div = document.createElement("div");
    div.className = "part-label";
    div.textContent = part.label;
    const label = new CSS2DObject(div);
    label.position.set(
      (part.box.x[0] + part.box.x[1]) / 2,
      part.box.y[1] + 1.4,
      (part.box.z[0] + part.box.z[1]) / 2,
    );
    g.add(label);
    partLabels.push({ obj: label, layer: part.layer, part: pi });

    exploded.push({ group: g, offset: new THREE.Vector3(...part.explode) });
    layerGroup(part.layer).add(g);
  });

  // ---- hardware: 3D-only items (never on a board / DXF / G-code) --------------
  (cab.hardware ?? []).forEach((hw, hi) => {
    const idx = cab.parts.length + hi; // selection ids continue past the parts
    const g = new THREE.Group();
    const color = layerColor.get(hw.layer) ?? "#3f464e";
    // kind "knob": a 0.9"-dia x 1.1" cylinder sticking out +z from its anchor
    const knobGeo = new THREE.CylinderGeometry(0.45, 0.45, 1.1, 20);
    const mesh = new THREE.Mesh(knobGeo, material(color));
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(hw.at[0], hw.at[1], hw.at[2] + 0.55);
    mesh.userData.part = idx;
    mesh.userData.layerName = hw.layer;
    mesh.userData.baseMat = mesh.material;
    pickMeshes.push(mesh);
    g.add(mesh);

    const div = document.createElement("div");
    div.className = "part-label";
    div.textContent = hw.label;
    const label = new CSS2DObject(div);
    label.position.set(hw.at[0], hw.at[1] + 1.8, hw.at[2]);
    g.add(label);
    partLabels.push({ obj: label, layer: hw.layer, part: idx });

    exploded.push({ group: g, offset: new THREE.Vector3(...hw.explode) });
    layerGroup(hw.layer).add(g);
  });

  // ---- overall dimensions (assembled state), architectural style --------------
  const dimMat = new THREE.LineBasicMaterial({ color: 0x4b5563 });
  const dimLabels: CSS2DObject[] = [];
  const dimsGroup = layerGroup("DIMS");

  for (const d of cab.dims) {
    const a = new THREE.Vector3(...d.a), b = new THREE.Vector3(...d.b), o = new THREE.Vector3(...d.off);
    const nrm = o.clone().normalize();
    const a2 = a.clone().add(o), b2 = b.clone().add(o);
    const dir = b2.clone().sub(a2).normalize();
    const tick = dir.clone().add(nrm).normalize().multiplyScalar(0.55);
    const pts = [
      // extension lines, from just off the part to a hair past the dim line
      a.clone().addScaledVector(nrm, 0.3), a2.clone().addScaledVector(nrm, 0.5),
      b.clone().addScaledVector(nrm, 0.3), b2.clone().addScaledVector(nrm, 0.5),
      // the dimension line, run a touch past each tick
      a2.clone().addScaledVector(dir, -0.4), b2.clone().addScaledVector(dir, 0.4),
      // tick slashes
      a2.clone().sub(tick), a2.clone().add(tick),
      b2.clone().sub(tick), b2.clone().add(tick),
    ];
    dimsGroup.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), dimMat));
    const div = document.createElement("div");
    div.className = "dim-label";
    div.textContent = d.text;
    const label = new CSS2DObject(div);
    label.position.copy(a2.clone().add(b2).multiplyScalar(0.5).addScaledVector(nrm, 0.9));
    dimsGroup.add(label);
    dimLabels.push(label);
  }

  // ---- state -------------------------------------------------------------------
  let explodeT = 0;
  const layerOn = new Map<string, boolean>(cab.layers.map((l) => [l.name, true]));
  const selected = new Set<number>(); // clicked parts: highlighted + labeled

  function updateVisibility() {
    for (const [name, g] of layerGroups) g.visible = layerOn.get(name) !== false;
    dimsGroup.visible = (layerOn.get("DIMS") !== false) && explodeT <= 0.15;
    for (const l of dimLabels) l.visible = dimsGroup.visible;
    for (const { obj, layer, part } of partLabels) {
      obj.visible = (layerOn.get(layer) !== false) && selected.has(part);
    }
  }

  function render() {
    renderer.render(scene, camera);
    css2d.render(scene, camera);
  }
  controls.addEventListener("change", render);

  // ---- click a part to toggle highlight + label --------------------------------
  const highlightMat = new THREE.MeshLambertMaterial({ color: "#ffd84a" });
  function togglePart(pi: number) {
    selected.has(pi) ? selected.delete(pi) : selected.add(pi);
    for (const mesh of pickMeshes) {
      if (mesh.userData.part !== pi) continue;
      mesh.material = selected.has(pi) ? highlightMat : mesh.userData.baseMat;
    }
    updateVisibility();
    render();
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let downX = 0, downY = 0;
  renderer.domElement.addEventListener("pointerdown", (e) => { downX = e.clientX; downY = e.clientY; });
  renderer.domElement.addEventListener("pointerup", (e) => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) return; // a drag, not a click
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    // skip parts on hidden layers (the raycaster ignores ancestor visibility)
    const hit = raycaster.intersectObjects(pickMeshes, false)
      .find((h) => layerOn.get(h.object.userData.layerName as string) !== false);
    if (hit) togglePart(hit.object.userData.part as number);
  });

  updateVisibility();

  return {
    layers: cab.layers,
    setLayerVisible(name, on) {
      layerOn.set(name, on);
      updateVisibility();
      render();
    },
    setExplode(t) {
      explodeT = t;
      for (const { group, offset } of exploded) group.position.copy(offset).multiplyScalar(t);
      updateVisibility();
      render();
    },
    resetView() {
      camera.position.copy(HOME_POS);
      controls.target.copy(HOME_TGT);
      controls.update();
      render();
    },
    show() {
      el.classList.add("on");
      this.resize();
    },
    hide() {
      el.classList.remove("on");
    },
    resize() {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return; // hidden — nothing to size against
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      css2d.setSize(w, h);
      render();
    },
  };
}
