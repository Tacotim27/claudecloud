import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Low-poly, flat-shaded figure: red hair, white shirt, black tie and trousers,
// brown shoes. World units are metres; feet on y = 0, facing +z.

// ---------------------------------------------------------------------------
// Renderer, camera, lights
// ---------------------------------------------------------------------------

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xd2d1cf);

// A long lens from straight ahead keeps the front view close to orthographic.
const camera = new THREE.PerspectiveCamera(14, innerWidth / innerHeight, 0.2, 40);

const VIEWS = {
  front: { pos: [0, 0.9, 8.4], target: [0, 0.9, 0] },
  face: { pos: [0, 1.56, 1.8], target: [0, 1.555, 0] },
  side: { pos: [8.4, 0.9, 0], target: [0, 0.9, 0] },
  back: { pos: [0, 0.9, -8.4], target: [0, 0.9, 0] },
  three: { pos: [5.2, 1.7, 6.4], target: [0, 0.9, 0] },
};

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.minDistance = 0.8;
controls.maxDistance = 16;

function setView(name) {
  const v = VIEWS[name] ?? VIEWS.front;
  camera.position.set(...v.pos);
  controls.target.set(...v.target);
  controls.update();
}
setView(new URLSearchParams(location.search).get('view'));
renderer.domElement.addEventListener('dblclick', () => setView('front'));

// Soft, nearly shadowless studio light: a strong sky/ground fill plus a gentle
// key from the upper front-left.
scene.add(new THREE.HemisphereLight(0xffffff, 0xbdbdbd, 3.4));
const key = new THREE.DirectionalLight(0xffffff, 0.6);
key.position.set(-0.2, 0.6, 1);
scene.add(key);

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const flat = (color, extra = {}) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

const SKIN = '#f5d1a8';
const mat = {
  skin: flat(SKIN),
  hand: flat(0xe2be96),
  hair: flat(0xb04642, { side: THREE.DoubleSide }),
  hairAO: flat(0xb04642, { side: THREE.DoubleSide, vertexColors: true }),
  hairShade: flat(0x7c322d, { side: THREE.DoubleSide }),
  shirt: flat(0xe9e3d4),
  shirtAO: flat(0xe9e3d4, { vertexColors: true }),
  collar: flat(0xe9e3d4, { side: THREE.DoubleSide }),
  tie: flat(0x2b2b2b),
  pants: flat(0x2a2a2a),
  band: flat(0x313133),
  loop: flat(0x242426),
  seam: flat(0x1c1c1c),
  crease: flat(0xa9a59a),
  shoe: flat(0x4f3429),
  sole: flat(0x24231f),
};

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

const V3 = (a) => new THREE.Vector3(...a);

// Point on a ring outline at angle a. a = 0 lies along the ring's u axis, a = π/2
// along v. rzF / rzB give separate extents on the +v / -v side; p > 2 squares
// the outline off (superellipse).
function ringPoint(r, a) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const e = 2 / (r.p ?? 2);
  const rz = s >= 0 ? (r.rzF ?? r.rz ?? r.rx) : (r.rzB ?? r.rz ?? r.rx);
  return [Math.sign(c) * Math.abs(c) ** e * r.rx, Math.sign(s) * Math.abs(s) ** e * rz];
}

function geometryFrom(pos) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// Pushes triangle abc, flipping it if needed so it faces along `out`.
function pushTri(pos, a, b, c, out) {
  const n = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a));
  if (n.dot(out) < 0) [b, c] = [c, b];
  pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
}

// Closed tube through cross-section rings. Each ring: { c: [x, y, z], rx, rz |
// rzF + rzB, p?, up? }. The ring plane is perpendicular to the path (or to
// `axis` when given); u = path × up and v = u × path, so an upright tube with
// up = +z has u = ±x and v = +z. Vertices sit at evenly spaced angles from
// `phase`, at explicit `angles`, or at a ring's own `shape` of [u, v] offsets.
function tube(rings, { segs = 8, phase = 0, angles = null, up = [0, 0, 1], axis = null, caps = [true, true] } = {}) {
  if (angles) segs = angles.length;
  if (rings[0].shape) segs = rings[0].shape.length;
  const n = rings.length;
  const C = rings.map((r) => V3(r.c));
  const pts = [];
  const tangents = [];
  for (let i = 0; i < n; i++) {
    const r = rings[i];
    const t = axis ? V3(axis).normalize()
      : C[Math.min(i + 1, n - 1)].clone().sub(C[Math.max(i - 1, 0)]).normalize();
    const u = new THREE.Vector3().crossVectors(t, V3(r.up ?? up)).normalize();
    const v = new THREE.Vector3().crossVectors(u, t).normalize();
    const ring = [];
    for (let k = 0; k < segs; k++) {
      const [x, z] = r.shape ? r.shape[k] : ringPoint(r, angles ? angles[k] : phase + (k / segs) * Math.PI * 2);
      ring.push(C[i].clone().addScaledVector(u, x).addScaledVector(v, z));
    }
    pts.push(ring);
    tangents.push(t);
  }

  const pos = [];
  for (let i = 0; i < n - 1; i++) {
    const mid = C[i].clone().add(C[i + 1]).multiplyScalar(0.5);
    for (let k = 0; k < segs; k++) {
      const a = pts[i][k];
      const b = pts[i][(k + 1) % segs];
      const c = pts[i + 1][(k + 1) % segs];
      const d = pts[i + 1][k];
      const out = a.clone().add(b).add(c).add(d).multiplyScalar(0.25).sub(mid);
      if (a.distanceToSquared(b) > 1e-12) pushTri(pos, a, b, c, out);
      if (c.distanceToSquared(d) > 1e-12) pushTri(pos, a, c, d, out);
    }
  }
  const cap = (i, out) => {
    if (rings[i].rx === 0) return;
    for (let k = 0; k < segs; k++) pushTri(pos, C[i], pts[i][k], pts[i][(k + 1) % segs], out);
  };
  if (caps[0]) cap(0, tangents[0].clone().negate());
  if (caps[1]) cap(n - 1, tangents[n - 1]);
  return geometryFrom(pos);
}

// Linear interpolation in a table of rows [y, ...values] sorted by y.
function lerpTable(table, y) {
  if (y <= table[0][0]) return table[0].slice(1);
  for (let i = 0; i < table.length - 1; i++) {
    const [y0, ...a] = table[i];
    const [y1, ...b] = table[i + 1];
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0);
      return a.map((v, j) => v + (b[j] - v) * t);
    }
  }
  return table[table.length - 1].slice(1);
}

// Upright loft from a table of rows [y, rx, rzF, rzB, centre z?].
function loft(table, p, opts) {
  const rings = table.map(([y, rx, rzF, rzB, zc = 0]) => ({ c: [0, y, zc], rx, rzF, rzB, p }));
  return tube(rings, { axis: [0, 1, 0], ...opts });
}

// z of the flat front face of a loft with `segs` sides (phase π/segs) at height y.
function frontFaceZ(table, p, y, segs = 8) {
  const [rx, rzF, , zc = 0] = lerpTable(table, y);
  return zc + ringPoint({ rx, rzF, p }, Math.PI / 2 - Math.PI / segs)[1];
}

// Bakes a grey per-vertex multiplier from f(x, y, z) into the geometry, used
// to darken creases the way ambient occlusion would.
function occlude(geometry, f) {
  const p = geometry.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) col.fill(f(p.getX(i), p.getY(i), p.getZ(i)), i * 3, i * 3 + 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geometry;
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
// 0 below a, 1 between b and c, 0 above d, linear ramps between.
const band = (y, a, b, c, d) => Math.min(clamp01((y - a) / (b - a)), clamp01((d - y) / (d - c)));

function mesh(geometry, material, parent) {
  const m = new THREE.Mesh(geometry, material);
  parent.add(m);
  return m;
}

const OCT = Math.PI / 8; // phase that puts a flat face, not an edge, at the front

// ---------------------------------------------------------------------------
// Shoes
// ---------------------------------------------------------------------------

// Shoe ring: a hexagon with a flat bottom at y0, vertical sides and bevelled
// top corners reaching y1.
function shoeRing(z, w, y0, y1, bevel) {
  const cy = (y0 + y1) / 2;
  const pts = [[w, y0], [w, y1 - bevel], [w - bevel, y1], [-w + bevel, y1], [-w, y1 - bevel], [-w, y0]];
  return { c: [0, cy, z], shape: pts.map(([x, y]) => [x, y - cy]) };
}

function buildShoe(s) {
  const g = new THREE.Group();
  const spring = (z) => Math.max(0, z - 0.1) * 0.15; // toe lifts off the ground
  const ring = (z, w, y0, y1, bevel) => shoeRing(z, w, y0 + spring(z), y1 + spring(z), bevel);
  // [z, half width, bottom, top, bevel], heel → toe
  const upper = [
    [-0.074, 0.025, 0.012, 0.070, 0.010],
    [-0.060, 0.033, 0.012, 0.100, 0.014],
    [0.000, 0.039, 0.012, 0.118, 0.015],
    [0.050, 0.042, 0.012, 0.086, 0.018],
    [0.110, 0.043, 0.012, 0.064, 0.017],
    [0.150, 0.040, 0.012, 0.058, 0.016],
    [0.168, 0.030, 0.014, 0.045, 0.012],
    [0.174, 0.019, 0.018, 0.036, 0.008],
  ].map((r) => ring(...r));
  mesh(tube(upper, { up: [0, 1, 0] }), mat.shoe, g);

  const sole = [
    [-0.077, 0.027, 0.000, 0.014, 0.003],
    [-0.062, 0.036, 0.000, 0.014, 0.003],
    [-0.045, 0.041, 0.000, 0.013, 0.003],
    [0.050, 0.045, 0.000, 0.013, 0.003],
    [0.110, 0.046, 0.000, 0.013, 0.003],
    [0.150, 0.043, 0.000, 0.013, 0.003],
    [0.170, 0.033, 0.001, 0.015, 0.003],
    [0.178, 0.021, 0.003, 0.018, 0.003],
  ].map((r) => ring(...r));
  mesh(tube(sole, { up: [0, 1, 0] }), mat.sole, g);

  g.position.set(s * 0.068, 0, -0.004);
  g.rotation.y = s * 0.12;
  return g;
}

// ---------------------------------------------------------------------------
// Trousers
// ---------------------------------------------------------------------------

function buildLeg(s) {
  // [y, centre x, rx, rz]
  const rings = [
    [0.112, -0.068, 0.043, 0.050],
    [0.250, -0.068, 0.046, 0.052],
    [0.400, -0.072, 0.053, 0.058],
    [0.480, -0.072, 0.052, 0.058],
    [0.600, -0.073, 0.057, 0.065],
    [0.725, -0.077, 0.066, 0.074],
    [0.830, -0.080, 0.075, 0.081],
    [0.900, -0.079, 0.077, 0.084],
    [0.960, -0.068, 0.065, 0.082],
    [1.020, -0.054, 0.053, 0.078],
  ].map(([y, x, rx, rz]) => ({ c: [s * x, y, 0.004], rx, rz }));
  return tube(rings, { segs: 8, phase: Math.PI / 2, axis: [0, 1, 0] });
}

// Pelvis rows [y, rx, rzF, rzB]; the bottom ring pinches to the crotch and the
// second (widest) ring is bent in buildTrousers.
const PELVIS = [
  [0.868, 0.030, 0.050, 0.056],
  [0.906, 0.160, 0.097, 0.097],
  [0.940, 0.153, 0.094, 0.095],
  [0.985, 0.140, 0.095, 0.096],
  [1.031, 0.118, 0.090, 0.090],
  [1.045, 0.110, 0.088, 0.088],
  [1.060, 0.104, 0.087, 0.087],
];
const PELVIS_P = 2.4;
const PELVIS_SEGS = 12;

function buildTrousers() {
  const g = new THREE.Group();
  mesh(buildLeg(-1), mat.pants, g);
  mesh(buildLeg(1), mat.pants, g);
  // The widest ring dips toward the sides, where it disappears into the legs,
  // leaving a V between the thighs at the front.
  const pelvis = loft(PELVIS, PELVIS_P, { segs: PELVIS_SEGS, phase: Math.PI / PELVIS_SEGS });
  const pp = pelvis.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    if (Math.abs(pp.getY(i) - PELVIS[1][0]) < 1e-6) pp.setY(i, PELVIS[1][0] - 0.05 * (Math.abs(pp.getX(i)) / 0.155) ** 1.6);
  }
  mesh(pelvis, mat.pants, g);

  // Waistband with a bevelled top edge
  const BAND = [
    [1.036, 0.106, 0.090, 0.090],
    [1.040, 0.111, 0.094, 0.094],
    [1.068, 0.110, 0.093, 0.093],
    [1.076, 0.100, 0.085, 0.085],
  ];
  mesh(loft(BAND, PELVIS_P, { segs: 8, phase: OCT }), mat.band, g);

  // Belt loops sit flat on the band's faces: [face start angle, end angle, t]
  const bandRing = { rx: 0.110, rzF: 0.093, rzB: 0.093, p: PELVIS_P };
  const loops = [
    [OCT, 3 * OCT, 0.73], [7 * OCT, 5 * OCT, 0.73], // front, either side of the fly
    [-3 * OCT, -5 * OCT, 0.5], [-OCT, -3 * OCT, 0.5], [-5 * OCT, -7 * OCT, 0.5], // back
  ];
  for (const [a0, a1, t] of loops) {
    const p0 = ringPoint(bandRing, a0);
    const p1 = ringPoint(bandRing, a1);
    const x = p0[0] + (p1[0] - p0[0]) * t;
    const z = p0[1] + (p1[1] - p0[1]) * t;
    const loop = mesh(new THREE.BoxGeometry(0.009, 0.038, 0.005), mat.loop, g);
    loop.position.set(x, 1.053, z);
    // Face normal: perpendicular to the edge p0 → p1 in the xz plane, pointing out.
    const nx = p1[1] - p0[1];
    const nz = -(p1[0] - p0[0]);
    const flip = nx * x + nz * z < 0 ? -1 : 1;
    loop.rotation.y = Math.atan2(nx * flip, nz * flip);
  }

  // Fly: a narrow seam with a rounded foot, on the pelvis front face
  const pt = (x, y) => new THREE.Vector3(x, y, frontFaceZ(PELVIS, PELVIS_P, y, PELVIS_SEGS) + 0.0004);
  const xl = -0.011;
  const xr = 0.012;
  const yb = 0.912;
  // Sampled densely so the seam follows the curve of the hips.
  const fly = new THREE.CurvePath();
  const seg = (a, b) => fly.add(new THREE.LineCurve3(a, b));
  for (let y = 1.04; y > yb + 0.009; y -= 0.01) seg(pt(xl, y), pt(xl, Math.max(y - 0.01, yb + 0.008)));
  fly.add(new THREE.QuadraticBezierCurve3(pt(xl, yb + 0.008), pt(xl, yb), pt(0, yb - 0.003)));
  fly.add(new THREE.QuadraticBezierCurve3(pt(0, yb - 0.003), pt(xr, yb), pt(xr, yb + 0.008)));
  for (let y = yb + 0.008; y < 1.039; y += 0.01) seg(pt(xr, y), pt(xr, Math.min(y + 0.01, 1.04)));
  mesh(new THREE.TubeGeometry(fly, 120, 0.001, 4), mat.seam, g);
  return g;
}

// ---------------------------------------------------------------------------
// Shirt, collar, tie
// ---------------------------------------------------------------------------

// Torso rows [y, rx, rzF, rzB, centre z]
const TORSO = [
  [1.020, 0.090, 0.076, 0.076, 0.000],
  [1.066, 0.095, 0.080, 0.080, 0.000],
  [1.079, 0.105, 0.088, 0.086, 0.000],
  [1.097, 0.110, 0.092, 0.090, 0.000],
  [1.132, 0.100, 0.087, 0.086, 0.000],
  [1.222, 0.112, 0.099, 0.090, 0.000],
  [1.262, 0.121, 0.107, 0.092, 0.000],
  [1.322, 0.132, 0.097, 0.094, -0.002],
  [1.362, 0.137, 0.084, 0.086, -0.005],
  [1.384, 0.130, 0.068, 0.072, -0.006],
  [1.401, 0.098, 0.054, 0.058, -0.005],
  [1.414, 0.050, 0.044, 0.046, -0.004],
];
const TORSO_P = 2.4;
// Ten sides: two broad front panels meeting in a ridge under the tie, narrow
// diagonals and flat sides.
const TORSO_ANGLES = [12, 42, 90, 138, 168, 192, 222, 270, 318, 348].map((d) => (d * Math.PI) / 180);
const torsoFrontZ = (y) => {
  const [rx, rzF, , zc] = lerpTable(TORSO, y);
  return zc + rzF;
};

// Thin darker line along a polyline, standing in for the contact shadow that
// outlines the collar in the reference.
function edgeLine(points, material, parent, radius = 0.0011) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => V3(p)), false, 'catmullrom', 0.1);
  mesh(new THREE.TubeGeometry(curve, points.length * 6, radius, 4), material, parent);
}

function buildShirt() {
  const g = new THREE.Group();
  // The flanks under the arms and the shoulders round the collar sit in shadow.
  const torso = loft(TORSO, TORSO_P, { angles: TORSO_ANGLES });
  occlude(torso, (x, y) => {
    const side = clamp01((Math.abs(x) / lerpTable(TORSO, y)[0] - 0.78) / 0.2);
    const nearNeck = clamp01((y - 1.35) / 0.04) * clamp01(1.2 - Math.abs(x) / 0.1);
    return (1 - 0.32 * side * band(y, 1.09, 1.15, 1.29, 1.35)) * (1 - (x > 0 ? 0.3 : 0.18) * nearNeck);
  });
  mesh(torso, mat.shirtAO, g);

  // Folded collar, one strip per side running from the nape round to the
  // point. Stations: [fold edge against the neck, outer edge]
  const stations = [
    [[0.000, 1.447, -0.042], [0.000, 1.412, -0.054]],
    [[-0.030, 1.447, -0.031], [-0.042, 1.411, -0.040]],
    [[-0.042, 1.446, -0.003], [-0.058, 1.405, -0.002]],
    [[-0.035, 1.440, 0.026], [-0.057, 1.399, 0.044]],
    [[-0.016, 1.406, 0.049], [-0.032, 1.366, 0.079]],
  ];
  for (const s of [-1, 1]) {
    const P = stations.map(([a, b]) => [V3([s * a[0], a[1], a[2]]), V3([s * b[0], b[1], b[2]])]);
    const pos = [];
    const centre = new THREE.Vector3(0, 1.40, -0.004);
    for (let i = 0; i < P.length - 1; i++) {
      const [a, b] = P[i];
      const [c, d] = P[i + 1];
      const out = a.clone().add(b).add(c).add(d).multiplyScalar(0.25).sub(centre);
      out.y = Math.abs(out.y) + 0.03;
      pushTri(pos, a, b, d, out);
      pushTri(pos, a, d, c, out);
    }
    mesh(geometryFrom(pos), mat.collar, g);

    // Stand under the fold, visible behind the neck
    const stand = [];
    for (let i = 0; i < 3; i++) {
      const [a] = P[i];
      const [c] = P[i + 1];
      const lo = (v) => v.clone().setY(1.392);
      pushTri(stand, a, lo(a), lo(c), a.clone().sub(centre).setY(0));
      pushTri(stand, a, lo(c), c, a.clone().sub(centre).setY(0));
    }
    mesh(geometryFrom(stand), mat.collar, g);

    edgeLine(P.map(([, b]) => b.toArray()), mat.crease, g);
    edgeLine([P[4][1].toArray(), P[4][0].toArray()], mat.crease, g);
  }
  return g;
}

function buildTie() {
  const g = new THREE.Group();
  // Knot: a six-sided nugget, widest a third of the way down.
  const knot = [
    [1.405, 0.012, 0.008],
    [1.395, 0.0195, 0.012],
    [1.374, 0.0110, 0.009],
  ].map(([y, rx, rz]) => ({ c: [0, y, 0.059], rx, rz }));
  mesh(tube(knot, { segs: 6, axis: [0, -1, 0] }), mat.tie, g);

  // Blade sampled densely so it follows every fold of the shirt front.
  const WIDTH = [[1.105, 0.0245], [1.13, 0.024], [1.25, 0.019], [1.34, 0.0135], [1.378, 0.0112]];
  const blade = [];
  for (let y = 1.378; y > 1.104; y -= 0.012) blade.push(Math.max(y, 1.105));
  blade.push(1.105, 1.079);
  const rings = [...new Set(blade)].map((y) => {
    const z = Math.max(torsoFrontZ(y), 0.066) + 0.003;
    const rx = y < 1.1 ? 0 : lerpTable(WIDTH, y)[0];
    return { c: [0, y, z], rx, rzF: 0.003, rzB: 0.002 };
  });
  mesh(tube(rings, { segs: 4 }), mat.tie, g);
  return g;
}

// ---------------------------------------------------------------------------
// Arms and hands
// ---------------------------------------------------------------------------

function buildHand() {
  // Left hand hanging from the wrist, palm toward the thigh (+x), thumb on the
  // forward edge (+z). The right hand is a mirror.
  const g = new THREE.Group();
  const palm = [
    [0.004, 0.000, 0.012, 0.019],
    [-0.024, 0.002, 0.0135, 0.025],
    [-0.062, 0.003, 0.0125, 0.027],
    [-0.074, 0.006, 0.010, 0.025],
  ].map(([y, x, rx, rz]) => ({ c: [x, y, 0], rx, rz, p: 2.6 }));
  mesh(tube(palm, { segs: 8, phase: OCT, axis: [0, -1, 0] }), mat.hand, g);

  // Fingers: [z offset, length]
  for (const [z, len] of [[0.0175, 0.068], [0.006, 0.074], [-0.006, 0.070], [-0.017, 0.060]]) {
    const path = [
      [0.004, -0.066, z],
      [0.008, -0.066 - len * 0.42, z],
      [0.017, -0.066 - len * 0.76, z * 0.96],
      [0.030, -0.066 - len * 0.93, z * 0.9],
    ];
    const r = [0.0068, 0.0066, 0.0060, 0.0044];
    const rings = path.map((c, i) => ({ c, rx: r[i], rz: r[i] * 0.95 }));
    mesh(tube(rings, { segs: 6, up: [0, 0, 1] }), mat.hand, g);
  }

  const thumb = [
    [0.006, -0.010, 0.018, 0.0105],
    [0.014, -0.034, 0.026, 0.0095],
    [0.020, -0.058, 0.026, 0.008],
    [0.024, -0.075, 0.022, 0.0058],
  ].map(([x, y, z, r]) => ({ c: [x, y, z], rx: r, rz: r }));
  mesh(tube(thumb, { segs: 6, up: [1, 0, 0] }), mat.hand, g);
  return g;
}

function buildArm(s) {
  const g = new THREE.Group();
  // Sleeve path [x, y, z, r]: a pinch and bulge make the elbow fold, and the
  // sleeve blouses over the cuff before tucking into it.
  const sleeve = [
    [-0.128, 1.386, -0.006, 0.000],
    [-0.131, 1.376, -0.006, 0.020],
    [-0.134, 1.352, -0.006, 0.028],
    [-0.136, 1.322, -0.006, 0.033],
    [-0.138, 1.290, -0.006, 0.036],
    [-0.146, 1.175, -0.004, 0.038],
    [-0.153, 1.122, -0.001, 0.035],
    [-0.157, 1.100, 0.001, 0.041],
    [-0.165, 1.060, 0.004, 0.039],
    [-0.180, 0.975, 0.008, 0.036],
    [-0.184, 0.953, 0.009, 0.0375],
    [-0.186, 0.938, 0.009, 0.026],
  ].map(([x, y, z, r]) => ({ c: [s * x, y, z], rx: r, rz: r * 1.08 }));
  // Ring vertex angles (0 = outward on the left arm, mirrored on the right):
  // a broad face toward the front and outside, a narrow one facing the body.
  const angles = [0, 30, 95, 145, 190, 235, 285, 330].map((d) => ((s < 0 ? d : 180 - d) * Math.PI) / 180);
  if (s > 0) angles.reverse();

  // The inside of the sleeve, facing the body, is shaded.
  const axisX = (y) => lerpTable(sleeve.map((r) => [r.c[1], r.c[0]]).reverse(), y)[0];
  const sleeveGeo = occlude(tube(sleeve, { angles }), (x, y) => {
    const inner = clamp01(((x - axisX(y)) * -s / 0.036 - 0.2) / 0.6);
    return 1 - 0.42 * inner * band(y, 0.98, 1.06, 1.3, 1.37);
  });
  mesh(sleeveGeo, mat.shirtAO, g);

  const cuff = [
    [-0.186, 0.949, 0.009, 0.0300],
    [-0.192, 0.887, 0.010, 0.0288],
  ].map(([x, y, z, r]) => ({ c: [s * x, y, z], rx: r, rz: r * 1.08, p: 2.6 }));
  mesh(tube(cuff, { angles }), mat.shirt, g);

  const wrist = [
    [-0.192, 0.905, 0.010, 0.017],
    [-0.195, 0.878, 0.010, 0.017],
  ].map(([x, y, z, r]) => ({ c: [s * x, y, z], rx: r, rz: r * 1.2 }));
  mesh(tube(wrist, { segs: 6 }), mat.skin, g);

  const hand = buildHand();
  hand.position.set(s * 0.202, 0.884, 0.008);
  hand.rotation.set(0, 0.85, -0.02);
  if (s > 0) {
    hand.scale.x = -1;
    hand.rotation.set(0, -0.85, 0.02);
  }
  g.add(hand);
  return g;
}

// ---------------------------------------------------------------------------
// Head, face, neck
// ---------------------------------------------------------------------------

// Head rows [y, rx, rzF, rzB, centre z]
const HEAD = [
  [1.431, 0.010, 0.010, 0.010, 0.068],
  [1.456, 0.036, 0.031, 0.036, 0.049],
  [1.476, 0.050, 0.061, 0.072, 0.023],
  [1.500, 0.066, 0.078, 0.088, 0.008],
  [1.530, 0.069, 0.086, 0.100, 0.002],
  [1.600, 0.070, 0.088, 0.108, -0.002],
  [1.650, 0.059, 0.077, 0.097, -0.012],
  [1.680, 0.030, 0.045, 0.060, -0.018],
  [1.690, 0.000, 0.000, 0.000, -0.018],
];
const HEAD_P = 2.6;

// Point on the head surface at height y and angle a (0 = +x, π/2 = front),
// pushed `off` metres outward.
function headPoint(y, a, off = 0) {
  const [rx, rzF, rzB, zc] = lerpTable(HEAD, y);
  const [x, z] = ringPoint({ rx: rx + off, rzF: rzF + off, rzB: rzB + off, p: HEAD_P }, a);
  return [x, y, zc + z];
}

// The face texture covers x ∈ [-0.08, 0.08], y ∈ [1.38, 1.68], projected from
// the front onto the head and neck.
const FACE = { x0: -0.08, x1: 0.08, y0: 1.38, y1: 1.68 };

function faceTexture() {
  const k = 6400; // px per metre
  const cv = document.createElement('canvas');
  cv.width = Math.round((FACE.x1 - FACE.x0) * k);
  cv.height = Math.round((FACE.y1 - FACE.y0) * k);
  const g = cv.getContext('2d');
  const X = (x) => (x - FACE.x0) * k;
  const Y = (y) => (FACE.y1 - y) * k;
  const moveTo = (x, y) => g.moveTo(X(x), Y(y));
  const lineTo = (x, y) => g.lineTo(X(x), Y(y));
  const quad = (cx, cy, x, y) => g.quadraticCurveTo(X(cx), Y(cy), X(x), Y(y));
  const fillPoly = (style, pts) => {
    g.fillStyle = style;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? lineTo(x, y) : moveTo(x, y)));
    g.closePath();
    g.fill();
  };
  const stroke = (style, width, path) => {
    g.strokeStyle = style;
    g.lineWidth = width * k;
    g.beginPath();
    path();
    g.stroke();
  };

  g.fillStyle = SKIN;
  g.fillRect(0, 0, cv.width, cv.height);
  g.lineCap = 'round';
  g.lineJoin = 'round';

  // Shadow the jaw throws on the neck
  fillPoly('#d2a781', [[0, 1.418], [0.04, 1.446], [0.04, 1.38], [0, 1.38]]); // far side of the neck
  fillPoly('#b98f6b', [[-0.040, 1.462], [-0.036, 1.4545], [0, 1.4295], [0.036, 1.4545], [0.040, 1.462], [0.040, 1.446], [0, 1.418], [-0.040, 1.446]]);

  // Nose: the shadowed plane right of the bridge and the underside
  fillPoly('#d1a580', [[0.0003, 1.528], [-0.009, 1.5045], [0.001, 1.4965], [0.0135, 1.5065]]);

  // Mouth
  stroke('#b98668', 0.0021, () => {
    moveTo(-0.0177, 1.4815);
    quad(0, 1.4787, 0.0177, 1.4815);
  });

  for (const s of [-1, 1]) {
    const ex = (x) => s * x;
    // Brow, mostly under the fringe
    stroke('#7a3029', 0.0026, () => {
      moveTo(ex(0.0225), 1.5712);
      quad(ex(0.0420), 1.5745, ex(0.0612), 1.5672);
    });

    const eye = () => {
      g.beginPath();
      moveTo(ex(0.0193), 1.5405);
      quad(ex(0.0398), 1.5592, ex(0.0612), 1.5415);
      quad(ex(0.0398), 1.5205, ex(0.0193), 1.5405);
      g.closePath();
    };
    eye();
    g.fillStyle = '#ffffff';
    g.fill();

    g.save();
    eye();
    g.clip();
    const ix = X(ex(0.0395));
    const iy = Y(1.5395);
    const ir = 0.0099 * k;
    const disc = (style, r, dy = 0) => {
      g.fillStyle = style;
      g.beginPath();
      g.arc(ix, iy + dy, r, 0, Math.PI * 2);
      g.fill();
    };
    disc('#5c390d', ir);
    disc('#9a6824', ir * 0.86);
    disc('#ad7a2e', ir * 0.55, ir * 0.3);
    g.fillStyle = 'rgba(70, 40, 20, 0.22)'; // shadow of the upper lid
    g.fillRect(X(-0.07), Y(1.5545), 0.14 * k, 0.0055 * k);
    g.restore();

    // Upper lid: a filled crescent, heaviest toward the outer corner, with a flick
    g.fillStyle = '#140e0c';
    g.beginPath();
    moveTo(ex(0.0190), 1.5398);
    quad(ex(0.0390), 1.5632, ex(0.0628), 1.5430);
    lineTo(ex(0.0672), 1.5392);
    lineTo(ex(0.0612), 1.5398);
    quad(ex(0.0400), 1.5542, ex(0.0205), 1.5390);
    g.closePath();
    g.fill();
    // Lower lid and crease hints
    stroke('rgba(150, 100, 75, 0.55)', 0.0009, () => {
      moveTo(ex(0.0585), 1.5405);
      quad(ex(0.0398), 1.5248, ex(0.0240), 1.5390);
    });
    stroke('rgba(170, 120, 92, 0.7)', 0.0009, () => {
      moveTo(ex(0.0262), 1.5522);
      quad(ex(0.0400), 1.5600, ex(0.0565), 1.5520);
    });
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return tex;
}

// Planar UVs from the front for triangles facing forward; everything else
// samples a plain-skin corner of the face texture.
function frontUVs(geometry, minNz = 0.1) {
  const p = geometry.attributes.position;
  const uv = new Float32Array(p.count * 2);
  const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const n = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    v.forEach((w, j) => w.fromBufferAttribute(p, i + j));
    n.crossVectors(v[1].clone().sub(v[0]), v[2].clone().sub(v[0])).normalize();
    const front = n.z > minNz;
    v.forEach((w, j) => {
      uv[(i + j) * 2] = front ? (w.x - FACE.x0) / (FACE.x1 - FACE.x0) : 0.004;
      uv[(i + j) * 2 + 1] = front ? (w.y - FACE.y0) / (FACE.y1 - FACE.y0) : 0.996;
    });
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geometry;
}

function buildHead() {
  const g = new THREE.Group();
  const faceMat = flat(0xffffff, { map: faceTexture() });
  mesh(frontUVs(loft(HEAD, HEAD_P, { segs: 12, phase: Math.PI / 12 })), faceMat, g);

  // Nose: a shallow wedge standing off the face
  const zf = headPoint(1.502, Math.PI / 2)[2];
  const P = [
    [0, 1.526, zf - 0.002],
    [0, 1.5015, zf + 0.011],
    [-0.0085, 1.5005, zf - 0.001],
    [0.0085, 1.5005, zf - 0.001],
    [0, 1.4955, zf + 0.001],
  ].map((v) => V3(v));
  const pos = [];
  const out = new THREE.Vector3(0, 0, 1);
  for (const [i, j, l] of [[0, 2, 1], [0, 1, 3], [1, 2, 4], [1, 4, 3]]) pushTri(pos, P[i], P[j], P[l], out);
  mesh(frontUVs(geometryFrom(pos), -1), faceMat, g);

  const neck = [
    [1.370, 0.035, 0.034, 0.036, -0.004],
    [1.470, 0.032, 0.031, 0.033, -0.002],
  ];
  mesh(frontUVs(loft(neck, 2, { segs: 8, phase: Math.PI / 2 })), faceMat, g);
  return g;
}

// ---------------------------------------------------------------------------
// Hair
// ---------------------------------------------------------------------------

// Hair shell rows [y, rx, rzF, rzB, centre z]. Below the fringe its front is
// folded back behind the face, so the shell frames it.
const HAIR = [
  [1.450, 0.072, 0.050, 0.082, -0.018],
  [1.482, 0.085, 0.078, 0.104, -0.012],
  [1.520, 0.092, 0.096, 0.115, -0.010],
  [1.555, 0.100, 0.105, 0.121, -0.008],
  [1.587, 0.104, 0.108, 0.124, -0.006],
  [1.620, 0.099, 0.107, 0.124, -0.006],
  [1.640, 0.093, 0.102, 0.119, -0.008],
  [1.658, 0.083, 0.094, 0.111, -0.010],
  [1.676, 0.067, 0.080, 0.095, -0.011],
  [1.690, 0.045, 0.056, 0.066, -0.012],
  [1.699, 0.000, 0.000, 0.000, -0.012],
];
const HAIR_P = 2.1;

function hairPoint(y, a, off = 0) {
  const [rx, rzF, rzB, zc] = lerpTable(HAIR, y);
  const [x, z] = ringPoint({ rx: rx + off, rzF: rzF + off, rzB: rzB + off, p: HAIR_P }, a);
  return [x, y, zc + z];
}

// How far forward the shell may reach at (x, y): below the fringe it is folded
// back behind the face, easing off toward the temples so the sides stay full.
function shellFrontLimit(x, y) {
  const fold = lerpTable([[1.450, -0.004], [1.49, 0.024], [1.53, 0.034], [1.600, 0.034], [1.630, 0.12]], y)[0];
  return fold + Math.max(0, Math.abs(x) - 0.064) * 10;
}

// A tapered blade of hair with a diamond cross-section along `points`;
// `out` is the direction the blade's face looks.
function lock(points, widths, thick, out) {
  const rings = points.map((c, i) => ({ c, rx: widths[i] / 2, rzF: thick, rzB: thick * 0.4, up: out }));
  return tube(rings, { segs: 4 });
}

function buildHair() {
  const g = new THREE.Group();

  // Shell: folded triangles low down sit in the shadow behind the jaw.
  const shell = loft(HAIR, HAIR_P, { segs: 16, phase: Math.PI / 2, caps: [false, false] });
  const p = shell.attributes.position.array;
  const lit = [];
  const shaded = [];
  for (let i = 0; i < p.length; i += 9) {
    let folded = false;
    for (let j = i; j < i + 9; j += 3) {
      const lim = shellFrontLimit(p[j], p[j + 1]);
      if (p[j + 2] > lim) {
        p[j + 2] = lim;
        folded = true;
      }
    }
    const low = p[i + 1] + p[i + 4] + p[i + 7] < 3 * 1.5;
    (folded && low ? shaded : lit).push(...p.slice(i, i + 9));
  }
  // The sides of the head turn away from the light.
  const litGeo = occlude(geometryFrom(lit), (x, y) => {
    const side = clamp01((Math.abs(x) / Math.max(lerpTable(HAIR, y)[0], 0.01) - 0.72) / 0.28);
    return 1 - 0.36 * side;
  });
  mesh(litGeo, mat.hairAO, g);
  mesh(geometryFrom(shaded), mat.hairShade, g);

  // Fringe: one sheet laid over the front of the shell from the crown, then
  // falling over the forehead to a zig-zag of pointed strands. Columns run
  // [angle, end y, tip?] from the left temple to the right, alternating notch
  // and strand tip; tip columns stand proud so each strand has a ridge.
  const COLS = [
    [2.90, 1.605, false],
    [2.72, 1.556, true],
    [2.35, 1.584, false],
    [2.13, 1.568, true],
    [1.91, 1.594, false],
    [1.72, 1.543, true],
    [1.60, 1.581, false],
    [1.50, 1.546, true],
    [1.46, 1.581, false],
    [1.32, 1.565, true],
    [1.17, 1.588, false],
    [0.95, 1.568, true],
    [0.79, 1.581, false],
    [0.48, 1.552, true],
    [0.25, 1.605, false],
  ];
  const rows = COLS.map(([a, yEnd, tip]) => {
    const lift = tip ? 1 : 0;
    const sweep = (a - Math.PI / 2) * 0.14;
    const crownA = Math.PI / 2 + (a - Math.PI / 2) * 0.55;
    return [
      hairPoint(1.6975, crownA, 0.001),
      hairPoint(1.684, Math.PI / 2 + (a - Math.PI / 2) * 0.8, 0.001 + lift * 0.002),
      hairPoint(1.662, a, 0.001 + lift * 0.003),
      hairPoint(1.642, a, 0.001 + lift * 0.004),
      hairPoint(1.620, a, 0.001 + lift * 0.004),
      headPoint(1.600, a + sweep * 0.4, 0.016 + lift * 0.005),
      headPoint(yEnd, a + (tip ? sweep : sweep * 0.6), 0.006),
    ].map(V3);
  });
  const cols = rows.length;
  const sheet = [];
  const fwd = new THREE.Vector3(0, 0.2, 1);
  for (let k = 0; k < cols - 1; k++) {
    for (let r = 0; r < rows[k].length - 1; r++) {
      const a = rows[k][r];
      const b = rows[k + 1][r];
      const c = rows[k + 1][r + 1];
      const d = rows[k][r + 1];
      pushTri(sheet, a, b, c, fwd);
      pushTri(sheet, a, c, d, fwd);
    }
  }
  mesh(geometryFrom(sheet), mat.hair, g);

  // Side locks: rooted on the shell at the temple, framing the face and
  // ending in points on the collar.
  for (const s of [-1, 1]) {
    const root = hairPoint(1.662, Math.PI / 2 - s * 1.06, 0.001);
    const pts = [
      root,
      [-0.086, 1.615, 0.050],
      [-0.087, 1.565, 0.056],
      [-0.083, 1.527, 0.057],
      [-0.077, 1.487, 0.059],
      [-0.071, 1.448, 0.063],
      [-0.063, 1.410, 0.069],
      [-0.0555, 1.371, 0.075],
    ].map(([x, y, z], i) => (i ? [s * x, y, z] : [x, y, z]));
    const sideLock = lock(pts, [0.012, 0.028, 0.031, 0.029, 0.027, 0.024, 0.015, 0], 0.008, [s * 0.2, 0, 1]);
    occlude(sideLock, (x) => 1 - 0.34 * clamp01((Math.abs(x) - 0.078) / 0.02));
    mesh(sideLock, mat.hairAO, g);
  }

  // Braid down the back
  let y = 1.47;
  for (let i = 0; i < 8; i++) {
    const h = 0.042;
    const side = i % 2 ? 1 : -1;
    const rings = [
      [0.004, 0.006],
      [-h * 0.3, 0.019],
      [-h * 0.75, 0.016],
      [-h - 0.004, 0.004],
    ].map(([yy, r]) => ({ c: [0, yy, 0], rx: r, rzF: r * 0.75, rzB: r * 0.75 }));
    const lobe = mesh(tube(rings, { segs: 6, axis: [0, -1, 0] }), mat.hair, g);
    lobe.rotation.z = side * 0.32;
    lobe.position.set(side * 0.005, y, -0.112 + Math.min(i, 3) * 0.002);
    y -= h * 0.8;
  }
  const tuft = [
    [y + 0.004, 0.007],
    [y - 0.02, 0.016],
    [y - 0.05, 0.0],
  ].map(([yy, r]) => ({ c: [0, yy, -0.106], rx: r, rzF: r * 0.7, rzB: r * 0.7 }));
  mesh(tube(tuft, { segs: 6, axis: [0, -1, 0] }), mat.hair, g);
  return g;
}

// ---------------------------------------------------------------------------
// Assemble and run
// ---------------------------------------------------------------------------

const figure = new THREE.Group();
figure.add(buildShoe(-1), buildShoe(1));
figure.add(buildTrousers());
figure.add(buildShirt());
figure.add(buildTie());
figure.add(buildArm(-1), buildArm(1));
figure.add(buildHead());
figure.add(buildHair());
scene.add(figure);

const hint = document.getElementById('hint');
controls.addEventListener('start', () => { hint.style.opacity = '0'; });

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
});
