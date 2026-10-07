import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Seeded randomness so the city is the same on every load
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2088);
const range = (a, b) => a + (b - a) * rand();
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;

// City layout (world units ≈ metres)
const BLOCK = 14;              // block footprint
const STREET = 6;              // street width
const PITCH = BLOCK + STREET;  // block centre to block centre
const N = 4;                   // blocks from centre to edge (city is (2N+1)²)
const HALF = (N + 0.5) * PITCH;
const CURB = 0.3;              // sidewalk height

const NEON = [0xff2bd6, 0x00f0ff, 0xfff200, 0x8a5cff, 0xff3860, 0x39ff88, 0xff8a00];
const hdr = (hex, k) => new THREE.Color(hex).multiplyScalar(k); // >1 feeds bloom

// ---------------------------------------------------------------------------
// Renderer, scene, camera
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const FOG = 0x1d0b35;
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(FOG, 0.0052);

const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.3, 2000);
camera.position.set(105, 62, 120);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 20, 0);
controls.enableDamping = true;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.3;
controls.maxPolarAngle = Math.PI * 0.495;
controls.minDistance = 8;
controls.maxDistance = 280;

const timeUniform = { value: 0 };
const updaters = []; // (t, dt) => void, run every frame

// ---------------------------------------------------------------------------
// Sky, moon, stars
// ---------------------------------------------------------------------------
scene.add(new THREE.Mesh(
  new THREE.SphereGeometry(900, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      fogCol: { value: new THREE.Color(FOG) },
      glow: { value: new THREE.Color(0xa0146c) },
      mid: { value: new THREE.Color(0x2b0c55) },
      top: { value: new THREE.Color(0x030110) },
    },
    vertexShader: /* glsl */`
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 fogCol, glow, mid, top;
      varying vec3 vDir;
      void main() {
        float h = vDir.y;
        vec3 c = mix(fogCol, glow, smoothstep(-0.03, 0.1, h));
        c = mix(c, mid, smoothstep(0.1, 0.38, h));
        c = mix(c, top, smoothstep(0.3, 0.85, h));
        gl_FragColor = vec4(c, 1.0);
      }`,
  }),
));

const moon = new THREE.Mesh(
  new THREE.IcosahedronGeometry(46, 1),
  new THREE.MeshStandardMaterial({
    color: 0xffd9f4, emissive: 0xff5fc8, emissiveIntensity: 0.55,
    flatShading: true, roughness: 1, fog: false,
  }),
);
moon.position.set(-260, 210, -620);
scene.add(moon);

{
  const count = 1400;
  const pos = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const theta = rand() * Math.PI * 2;
    const y = range(0.12, 1);
    const r = Math.sqrt(1 - y * y);
    pos.set([Math.cos(theta) * r * 850, y * 850, Math.sin(theta) * r * 850], i * 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  scene.add(new THREE.Points(geo, new THREE.PointsMaterial({
    color: 0xd8c8ff, size: 1.6, sizeAttenuation: false, fog: false,
  })));
}

// ---------------------------------------------------------------------------
// Lights: two coloured key lights pick out the low-poly facets
// ---------------------------------------------------------------------------
scene.add(new THREE.HemisphereLight(0x5a3cff, 0x12051c, 0.9));
const magentaKey = new THREE.DirectionalLight(0xff5fd2, 1.1);
magentaKey.position.set(-120, 160, -220);
scene.add(magentaKey);
const cyanKey = new THREE.DirectionalLight(0x00d9ff, 0.8);
cyanKey.position.set(160, 70, 120);
scene.add(cyanKey);

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
const unitBox = new THREE.BoxGeometry(1, 1, 1);

// Collects many boxes that share a material and turns them into one InstancedMesh.
class BoxBatch {
  constructor(material) { this.material = material; this.items = []; }
  add(x, y, z, sx, sy, sz, ry = 0, color = null) {
    this.items.push({ x, y, z, sx, sy, sz, ry, color });
  }
  build() {
    if (!this.items.length) return null;
    const mesh = new THREE.InstancedMesh(unitBox, this.material, this.items.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    const p = new THREE.Vector3(), s = new THREE.Vector3();
    const anyColor = this.items.some((it) => it.color);
    const white = new THREE.Color(1, 1, 1);
    this.items.forEach((it, i) => {
      q.setFromEuler(e.set(0, it.ry, 0));
      mesh.setMatrixAt(i, m.compose(p.set(it.x, it.y, it.z), q, s.set(it.sx, it.sy, it.sz)));
      if (anyColor) mesh.setColorAt(i, it.color || white);
    });
    mesh.computeBoundingSphere();
    scene.add(mesh);
    return mesh;
  }
}

const neonMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
const batches = {
  neon: new BoxBatch(neonMat),
  sidewalk: new BoxBatch(new THREE.MeshStandardMaterial({ color: 0x1b1828, roughness: 0.9, flatShading: true })),
  metal: new BoxBatch(new THREE.MeshStandardMaterial({ color: 0x3a3550, roughness: 0.6, metalness: 0.5, flatShading: true })),
  dark: new BoxBatch(new THREE.MeshStandardMaterial({ color: 0x14111f, roughness: 0.8, flatShading: true })),
};

// A vertical gradient used as alpha for light beams (bright at the source).
function gradientTexture(stops) {
  const c = document.createElement('canvas');
  c.width = 4; c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  stops.forEach(([at, col]) => grad.addColorStop(at, col));
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 128);
  return new THREE.CanvasTexture(c);
}
// Cylinder UVs run v = 0 at the bottom; CanvasTexture flips Y, so canvas-bottom = v 0.
const beamAlpha = gradientTexture([[0, '#000'], [0.3, '#444'], [1, '#fff']]);

function beamMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, alphaMap: beamAlpha, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
}

// ---------------------------------------------------------------------------
// Procedural textures: lit windows and neon signs
// ---------------------------------------------------------------------------
const WIN_COLS = 8, WIN_ROWS = 16, WIN_CELL = 1.1; // one texture tile covers 8.8 × 17.6 m

function windowTexture(litRatio) {
  const c = document.createElement('canvas');
  c.width = WIN_COLS * 16; c.height = WIN_ROWS * 16;
  const g = c.getContext('2d');
  g.fillStyle = '#000';
  g.fillRect(0, 0, c.width, c.height);
  const tints = ['#ffcf8a', '#ffcf8a', '#ffe9c4', '#7ff6ff', '#ff7ae6', '#b59bff'];
  for (let r = 0; r < WIN_ROWS; r++) {
    const rowTint = pick(tints);
    for (let col = 0; col < WIN_COLS; col++) {
      if (!chance(litRatio)) continue;
      g.globalAlpha = range(0.35, 1);
      g.fillStyle = chance(0.7) ? rowTint : pick(tints);
      g.fillRect(col * 16 + 3, r * 16 + 4, 10, 8);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  return tex;
}
const windowTextures = [0.2, 0.3, 0.4, 0.5, 0.6].map(windowTexture);

const FONT = '"Hiragino Sans", "Yu Gothic", "Noto Sans CJK JP", "Arial Black", Impact, sans-serif';
const VERTICAL_WORDS = ['ネオン', 'サイバー', 'ラーメン', '酒場', '電脳', '未来', '夜市', 'ホテル', '喫茶', '東京', 'BAR', 'HOTEL', 'OPEN'];
const SHOP_WORDS = ['NOODLES', 'CYBERWARE', 'PACHINKO', 'KARAOKE', 'DATA//BANK', 'RAMEN 24H', 'SUSHI', 'ARCADE', 'CLINIC', 'NOVA', 'ZEN-TEK', 'LIQUOR', 'IMPLANTS', 'クラブ'];

function signTexture(text, hex, vertical) {
  const color = '#' + new THREE.Color(hex).getHexString();
  const c = document.createElement('canvas');
  c.width = vertical ? 128 : 512;
  c.height = vertical ? 512 : 128;
  const g = c.getContext('2d');
  g.fillStyle = '#0a0612';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = color; g.lineWidth = 6;
  g.shadowColor = color; g.shadowBlur = 14;
  g.strokeRect(8, 8, c.width - 16, c.height - 16);
  g.fillStyle = '#ffffff';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if (vertical) {
    const chars = [...text];
    const step = Math.min(100, 440 / chars.length);
    g.font = `bold ${Math.floor(step * 0.8)}px ${FONT}`;
    chars.forEach((ch, i) => g.fillText(ch, 64, 256 + (i - (chars.length - 1) / 2) * step));
  } else {
    g.font = `bold 64px ${FONT}`;
    const w = g.measureText(text).width;
    if (w > 440) g.font = `bold ${Math.floor(64 * 440 / w)}px ${FONT}`;
    g.fillText(text, 256, 68);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

const signMaterials = new Map();
function signMaterial(text, hex, vertical) {
  const key = `${text}|${hex}|${vertical}`;
  if (!signMaterials.has(key)) {
    signMaterials.set(key, new THREE.MeshBasicMaterial({
      map: signTexture(text, hex, vertical), color: hdr(hex, 1.6).lerp(new THREE.Color(1.6, 1.6, 1.6), 0.35),
      side: THREE.DoubleSide,
    }));
  }
  return signMaterials.get(key);
}

// Animated advertising screens.
function billboardMaterial(a, b) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: timeUniform,
      uA: { value: hdr(a, 1.4) },
      uB: { value: hdr(b, 1.4) },
      uSeed: { value: rand() * 100 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`
      uniform float uTime, uSeed;
      uniform vec3 uA, uB;
      varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vec2 uv = vUv;
        float t = uTime * 0.7 + uSeed;
        float scene = floor(t / 4.0);
        float mode = hash(scene + uSeed);
        vec3 col;
        if (mode < 0.33) {
          float s = 0.5 + 0.5 * sin(uv.x * 7.0 + uv.y * 3.0 - t * 2.5);
          col = mix(uA, uB, s);
        } else if (mode < 0.66) {
          vec2 p = (uv - 0.5) * vec2(2.0, 1.0);
          float r = length(p);
          col = mix(uB, uA, 0.5 + 0.5 * sin(r * 18.0 - t * 4.0)) * smoothstep(0.9, 0.2, r);
          col += uA * smoothstep(0.2, 0.17, abs(r - 0.32)) * 1.5;
        } else {
          float bars = step(0.5, fract(uv.x * 10.0));
          float h = hash(floor(uv.x * 10.0) + floor(t * 3.0));
          col = mix(uA * 0.15, mix(uA, uB, uv.y), step(uv.y, h) * bars);
        }
        col *= 0.85 + 0.15 * sin(uv.y * 240.0 - t * 30.0);          // scanlines
        float edge = step(uv.x, 0.025) + step(0.975, uv.x) + step(uv.y, 0.05) + step(0.95, uv.y);
        col = mix(col, uB * 1.4, clamp(edge, 0.0, 1.0));
        col *= 0.35 + 0.65 * step(0.03, hash(floor(t * 12.0) + uSeed)); // glitch flicker
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

// ---------------------------------------------------------------------------
// Ground, streets, sidewalks, street lights
// ---------------------------------------------------------------------------
{
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(2400, 2400),
    new THREE.MeshStandardMaterial({ color: 0x0a0812, roughness: 0.35, metalness: 0.7 }),
  );
  ground.rotation.x = -Math.PI / 2;
  scene.add(ground);

  const laneColor = hdr(0xfff200, 1.2);
  const curbColor = hdr(0x00f0ff, 1.5);
  for (let i = -N - 1; i <= N; i++) {
    const s = (i + 0.5) * PITCH; // street centre line
    for (let a = -HALF; a < HALF; a += 4) {
      // skip dashes inside intersections
      const local = (a + 2 + HALF) % PITCH; // 0 = centre of an intersection
      if (local < STREET / 2 + 1 || local > PITCH - STREET / 2 - 1) continue;
      batches.neon.add(a + 2, 0.02, s, 1.6, 0.04, 0.14, 0, laneColor);
      batches.neon.add(s, 0.02, a + 2, 0.14, 0.04, 1.6, 0, laneColor);
    }
  }

  for (let bi = -N; bi <= N; bi++) {
    for (let bj = -N; bj <= N; bj++) {
      const cx = bi * PITCH, cz = bj * PITCH;
      batches.sidewalk.add(cx, CURB / 2, cz, BLOCK, CURB, BLOCK);
      // glowing curb edge
      const e = BLOCK / 2;
      batches.neon.add(cx, CURB, cz + e, BLOCK, 0.05, 0.08, 0, curbColor);
      batches.neon.add(cx, CURB, cz - e, BLOCK, 0.05, 0.08, 0, curbColor);
      batches.neon.add(cx + e, CURB, cz, 0.08, 0.05, BLOCK, 0, curbColor);
      batches.neon.add(cx - e, CURB, cz, 0.08, 0.05, BLOCK, 0, curbColor);
      // street lights along each side
      for (const off of [-4.5, 4.5]) {
        for (const [x, z, ry] of [
          [cx + off, cz + e - 0.4, 0], [cx + off, cz - e + 0.4, Math.PI],
          [cx + e - 0.4, cz + off, Math.PI / 2], [cx - e + 0.4, cz + off, -Math.PI / 2],
        ]) {
          batches.metal.add(x, CURB + 2.5, z, 0.14, 5, 0.14);
          const nx = Math.sin(ry), nz = Math.cos(ry);
          batches.metal.add(x + nx * 0.6, CURB + 5, z + nz * 0.6, 0.12 + Math.abs(nx), 0.1, 0.12 + Math.abs(nz));
          batches.neon.add(x + nx * 1.0, CURB + 4.92, z + nz * 1.0, 0.25 + Math.abs(nx) * 0.4, 0.06, 0.25 + Math.abs(nz) * 0.4, 0, hdr(0xffb36b, 2.2));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------
const facadeTints = [0x181428, 0x1d1830, 0x221a2c, 0x141a2a, 0x201626];
const roofMat = new THREE.MeshStandardMaterial({ color: 0x100d1a, roughness: 0.9, flatShading: true });
const blinkMats = [0, 1, 2].map(() => new THREE.MeshBasicMaterial({ color: hdr(0xff2030, 3) }));
const blinkGeo = new THREE.OctahedronGeometry(0.22, 0);
const searchlights = [];

updaters.push((t) => {
  blinkMats.forEach((m, i) => {
    const on = Math.sin(t * 2.4 + i * 2.1) > 0.55;
    m.color.copy(on ? hdr(0xff2030, 3) : hdr(0x300006, 1));
  });
});

function facadeMaterial(repeatX, repeatY) {
  const tex = pick(windowTextures).clone();
  tex.repeat.set(repeatX, repeatY);
  tex.offset.set(Math.floor(rand() * WIN_COLS) / WIN_COLS, Math.floor(rand() * WIN_ROWS) / WIN_ROWS);
  return new THREE.MeshStandardMaterial({
    color: pick(facadeTints), roughness: 0.75, metalness: 0.3, flatShading: true,
    emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: range(0.9, 1.4),
  });
}

// Faces 0..3 = +z, -z, +x, -x. Returns where a plane facing outward sits on that face.
function facade(face, x, z, w, d) {
  return [
    { x, z: z + d / 2, ry: 0, span: w },
    { x, z: z - d / 2, ry: Math.PI, span: w },
    { x: x + w / 2, z, ry: Math.PI / 2, span: d },
    { x: x - w / 2, z, ry: -Math.PI / 2, span: d },
  ][face];
}

function addPlane(w, h, material, x, y, z, ry) {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
  mesh.position.set(x, y, z);
  mesh.rotation.y = ry;
  scene.add(mesh);
  return mesh;
}

function neonBandsBox(x, z, w, d, y0, h) {
  if (chance(0.65)) {
    const col = hdr(pick(NEON), 2.2);
    batches.neon.add(x, y0 + h - 0.25, z, w + 0.16, 0.18, d + 0.16, 0, col);
    if (h > 18 && chance(0.5)) {
      for (let y = y0 + 6; y < y0 + h - 4; y += range(6, 10)) {
        batches.neon.add(x, y, z, w + 0.12, 0.1, d + 0.12, 0, col);
      }
    }
  }
  if (chance(0.25)) {
    const col = hdr(pick(NEON), 2.2);
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      batches.neon.add(x + sx * w / 2, y0 + h / 2, z + sz * d / 2, 0.14, h, 0.14, 0, col);
    }
  }
}

function roofClutter(x, z, w, d, top) {
  const units = Math.floor(range(1, 4));
  for (let i = 0; i < units; i++) {
    batches.metal.add(x + range(-w, w) * 0.3, top + 0.4, z + range(-d, d) * 0.3, range(0.8, 1.8), 0.8, range(0.8, 1.4));
  }
  batches.dark.add(x, top + 0.2, z, w * 0.98, 0.4, d * 0.98); // parapet slab
  if (chance(0.55)) {
    const ax = x + range(-w, w) * 0.3, az = z + range(-d, d) * 0.3;
    const ah = range(3, 9);
    batches.metal.add(ax, top + ah / 2, az, 0.12, ah, 0.12);
    batches.metal.add(ax, top + ah * 0.6, az, 1.0, 0.08, 0.08);
    const light = new THREE.Mesh(blinkGeo, pick(blinkMats));
    light.position.set(ax, top + ah + 0.15, az);
    scene.add(light);
  }
}

function signsOnBox(x, z, w, d, y0, h) {
  // Street-level shop sign
  if (chance(0.7)) {
    const f = facade(Math.floor(rand() * 4), x, z, w, d);
    const sw = Math.min(f.span * 0.8, 6), sh = sw / 4;
    const hex = pick(NEON);
    addPlane(sw, sh, signMaterial(pick(SHOP_WORDS), hex, false),
      f.x + Math.sin(f.ry) * 0.06, y0 + 3.2, f.z + Math.cos(f.ry) * 0.06, f.ry);
    // awning with a glowing front edge
    const ax = Math.abs(Math.sin(f.ry)), az = Math.abs(Math.cos(f.ry));
    const nx = Math.sin(f.ry), nz = Math.cos(f.ry);
    batches.dark.add(f.x + nx * 0.6, y0 + 2.3, f.z + nz * 0.6, az * sw + ax * 1.2, 0.1, ax * sw + az * 1.2);
    batches.neon.add(f.x + nx * 1.2, y0 + 2.25, f.z + nz * 1.2, az * sw + ax * 0.06, 0.06, ax * sw + az * 0.06, 0, hdr(hex, 2));
  }
  // Tall vertical sign sticking out of the facade
  if (h > 9 && chance(0.55)) {
    const f = facade(Math.floor(rand() * 4), x, z, w, d);
    const sh = range(4, 7), sw = sh / 4;
    const lat = range(-0.35, 0.35) * f.span;
    const nx = Math.sin(f.ry), nz = Math.cos(f.ry);
    const tx = Math.cos(f.ry), tz = -Math.sin(f.ry);
    const y = range(y0 + 5, Math.min(y0 + h - sh / 2 - 1, y0 + 22));
    const px = f.x + nx * (sw / 2 + 0.15) + tx * lat;
    const pz = f.z + nz * (sw / 2 + 0.15) + tz * lat;
    const mat = signMaterial(pick(VERTICAL_WORDS), pick(NEON), true);
    addPlane(sw, sh, mat, px, y, pz, f.ry + Math.PI / 2);
    const alongZ = Math.abs(nz) > 0.5; // bracket runs out from the wall along the facade normal
    batches.metal.add(px, y + sh / 2 + 0.1, pz, alongZ ? 0.08 : sw + 0.3, 0.12, alongZ ? sw + 0.3 : 0.08);
  }
  // Big animated billboard near the top
  if (h > 16 && chance(0.3)) {
    const f = facade(Math.floor(rand() * 4), x, z, w, d);
    const bw = f.span * 0.85, bh = bw * 0.5;
    addPlane(bw, bh, billboardMaterial(pick(NEON), pick(NEON)),
      f.x + Math.sin(f.ry) * 0.08, y0 + h - bh / 2 - 1.5, f.z + Math.cos(f.ry) * 0.08, f.ry);
  }
}

function boxBuilding(x, z, w, d, h, y0 = CURB, withSigns = true) {
  const side = facadeMaterial((w + d) / 2 / (WIN_COLS * WIN_CELL), h / (WIN_ROWS * WIN_CELL));
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [side, side, roofMat, roofMat, side, side]);
  mesh.position.set(x, y0 + h / 2, z);
  scene.add(mesh);
  neonBandsBox(x, z, w, d, y0, h);
  if (withSigns) signsOnBox(x, z, w, d, y0, h);
  return side;
}

function prismBuilding(x, z, r, h, sides, taper) {
  const side = facadeMaterial((2 * Math.PI * r) / (WIN_COLS * WIN_CELL), h / (WIN_ROWS * WIN_CELL));
  const mesh = new THREE.Mesh(
    new THREE.CylinderGeometry(r * taper, r, h, sides, 1),
    [side, roofMat, roofMat],
  );
  mesh.position.set(x, CURB + h / 2, z);
  if (sides === 4) mesh.rotation.y = Math.PI / 4;
  scene.add(mesh);
  const col = hdr(pick(NEON), 2.2);
  const ringMat = new THREE.MeshBasicMaterial({ color: col });
  const rings = taper < 1 ? [1] : [0.25, 0.5, 0.75, 1];
  for (const k of rings) {
    if (k < 1 && !chance(0.6)) continue;
    const rr = r * (1 - (1 - taper) * k) + 0.08;
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(rr, rr, k === 1 ? 0.25 : 0.12, sides, 1, true), ringMat);
    ring.position.set(x, CURB + h * k - (k === 1 ? 0.15 : 0), z);
    ring.rotation.y = mesh.rotation.y;
    scene.add(ring);
  }
  const top = CURB + h;
  if (chance(0.6)) {
    const sh = range(4, 12);
    const spire = new THREE.Mesh(new THREE.ConeGeometry(r * taper * 0.4, sh, sides), roofMat);
    spire.position.set(x, top + sh / 2, z);
    scene.add(spire);
    const light = new THREE.Mesh(blinkGeo, pick(blinkMats));
    light.position.set(x, top + sh + 0.2, z);
    scene.add(light);
  }
  // Street-level sign on a box plinth so prisms still feel inhabited
  if (chance(0.5)) {
    const hex = pick(NEON);
    const front = sides === 4 ? r * Math.SQRT1_2 : r; // closest point of the base to +z
    addPlane(4, 1, signMaterial(pick(SHOP_WORDS), hex, false), x, CURB + 3, z + front + 0.25, 0);
  }
}

function searchlight(x, y, z, color) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  const tilt = new THREE.Group();
  tilt.rotation.z = range(0.25, 0.5);
  const len = 140;
  const geo = new THREE.CylinderGeometry(6, 0.2, len, 18, 1, true);
  geo.translate(0, len / 2, 0);    // narrow end at the lamp
  tilt.add(new THREE.Mesh(geo, beamMaterial(color, 0.11)));
  pivot.add(tilt);
  batches.metal.add(x, y - 0.3, z, 1.4, 0.8, 1.4);
  scene.add(pivot);
  const speed = range(0.15, 0.35) * (chance(0.5) ? 1 : -1);
  const phase = rand() * Math.PI * 2;
  updaters.push((t) => {
    pivot.rotation.y = phase + t * speed;
    tilt.rotation.z = 0.35 + Math.sin(t * 0.4 + phase) * 0.15;
  });
}

// --- Megatower at the centre
function megatower() {
  const tiers = [
    { s: 13, h: 6 },
    { s: 11, h: 34 },
    { s: 8.5, h: 26 },
    { s: 6, h: 18 },
  ];
  let y = CURB;
  tiers.forEach((tier, i) => {
    boxBuilding(0, 0, tier.s, tier.s, tier.h, y, i === 0);
    batches.neon.add(0, y + tier.h, 0, tier.s + 0.3, 0.3, tier.s + 0.3, 0, hdr(i % 2 ? 0xff2bd6 : 0x00f0ff, 2.6));
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      batches.neon.add(sx * tier.s / 2, y + tier.h / 2, sz * tier.s / 2, 0.18, tier.h, 0.18, 0, hdr(0xff2bd6, 2.4));
    }
    y += tier.h;
  });
  // Giant vertical logo signs on two faces of the main shaft
  addPlane(3.2, 22, signMaterial('アラサカ', 0xff3860, true), 0, CURB + 26, 5.52, 0);
  addPlane(3.2, 22, signMaterial('電脳都市', 0x00f0ff, true), 5.52, CURB + 26, 0, Math.PI / 2);
  addPlane(9, 4.5, billboardMaterial(0xff2bd6, 0x00f0ff), 0, CURB + 52, -4.27, Math.PI);
  addPlane(9, 4.5, billboardMaterial(0xfff200, 0xff3860), -4.27, CURB + 52, 0, -Math.PI / 2);

  // Spire + rotating crown rings
  const spireH = 24;
  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 2.2, spireH, 6), roofMat);
  spire.position.set(0, y + spireH / 2, 0);
  scene.add(spire);
  const beacon = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), new THREE.MeshBasicMaterial({ color: hdr(0xff2bd6, 4) }));
  beacon.position.set(0, y + spireH + 0.6, 0);
  scene.add(beacon);

  const ringA = new THREE.Mesh(new THREE.TorusGeometry(7, 0.25, 4, 24), new THREE.MeshBasicMaterial({ color: hdr(0x00f0ff, 2.5) }));
  const ringB = new THREE.Mesh(new THREE.TorusGeometry(5, 0.2, 4, 20), new THREE.MeshBasicMaterial({ color: hdr(0xff2bd6, 2.5) }));
  ringA.position.set(0, y + 5, 0);
  ringB.position.set(0, y + 11, 0);
  scene.add(ringA, ringB);
  updaters.push((t) => {
    ringA.rotation.set(Math.PI / 2 + Math.sin(t * 0.5) * 0.2, 0, t * 0.6);
    ringB.rotation.set(Math.PI / 2 + Math.cos(t * 0.7) * 0.3, 0, -t * 0.9);
    beacon.rotation.y = t * 2;
  });

  // Searchlights on the podium corners
  searchlight(6, CURB + 6.2, 6, 0x9fdcff);
  searchlight(-6, CURB + 6.2, -6, 0xff9ee8);
}

// --- Plaza with a hologram
function hologramPlaza(cx, cz) {
  const plaza = new THREE.Mesh(
    new THREE.CylinderGeometry(6.5, 6.5, 0.15, 12),
    new THREE.MeshStandardMaterial({ color: 0x241c38, roughness: 0.5, metalness: 0.6, flatShading: true }),
  );
  plaza.position.set(cx, CURB + 0.08, cz);
  scene.add(plaza);
  for (const r of [6.5, 4.5]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 3, 12), new THREE.MeshBasicMaterial({ color: hdr(0x00f0ff, 2.5) }));
    ring.rotation.x = Math.PI / 2;
    ring.position.set(cx, CURB + 0.18, cz);
    scene.add(ring);
  }
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, 1.2, 6), roofMat);
  pedestal.position.set(cx, CURB + 0.75, cz);
  scene.add(pedestal);

  const beamGeo = new THREE.CylinderGeometry(4, 1.2, 12, 12, 1, true);
  beamGeo.translate(0, 6, 0);
  const beam = new THREE.Mesh(beamGeo, beamMaterial(0x00f0ff, 0.25));
  beam.position.set(cx, CURB + 1.35, cz);
  scene.add(beam);

  const holo = new THREE.Group();
  holo.position.set(cx, CURB + 9, cz);
  const holoMat = new THREE.MeshBasicMaterial({
    color: hdr(0x00f0ff, 1.5), transparent: true, opacity: 0.25,
    blending: THREE.AdditiveBlending, depthWrite: false,
  });
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 0), holoMat);
  const wire = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(3.25, 0)),
    new THREE.LineBasicMaterial({ color: hdr(0x7ff6ff, 3) }),
  );
  const inner = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.OctahedronGeometry(1.6, 0)),
    new THREE.LineBasicMaterial({ color: hdr(0xff2bd6, 3) }),
  );
  holo.add(core, wire, inner);
  const orbit = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(4.6 + i * 0.7, 0.05, 3, 32), new THREE.MeshBasicMaterial({ color: hdr(i === 1 ? 0xff2bd6 : 0x00f0ff, 2.5) }));
    holo.add(ring);
    orbit.push(ring);
  }
  scene.add(holo);
  updaters.push((t) => {
    core.rotation.set(t * 0.3, t * 0.5, 0);
    wire.rotation.copy(core.rotation);
    inner.rotation.set(-t * 0.8, -t * 0.6, 0);
    holo.position.y = CURB + 9 + Math.sin(t * 1.3) * 0.5;
    orbit.forEach((r, i) => r.rotation.set(t * (0.4 + i * 0.25), t * (0.3 - i * 0.2), i));
    holoMat.opacity = 0.22 + 0.06 * Math.sin(t * 17) * Math.sin(t * 3.1);
  });

  // Neon cherry trees around the plaza
  const leafMat = new THREE.MeshStandardMaterial({ color: 0xff7ad9, emissive: 0xff2bb0, emissiveIntensity: 0.9, flatShading: true });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2a1b2e, flatShading: true });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    const tx = cx + Math.cos(a) * 5.5, tz = cz + Math.sin(a) * 5.5;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 2, 5), trunkMat);
    trunk.position.set(tx, CURB + 1, tz);
    const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(range(0.9, 1.3), 0), leafMat);
    crown.position.set(tx, CURB + 2.4, tz);
    crown.rotation.set(rand() * 3, rand() * 3, 0);
    scene.add(trunk, crown);
  }
  // A ring of short buildings so the plaza sits in a courtyard
  for (const [dx, dz, w, d] of [[-5.5, -5.5, 3, 3], [5.5, -5.5, 3, 3], [5.5, 5.5, 3, 3], [-5.5, 5.5, 3, 3]]) {
    boxBuilding(cx + dx, cz + dz, w, d, range(5, 9));
  }
}

// --- Populate the grid
const PLAZA = [-2, 1];
for (let bi = -N; bi <= N; bi++) {
  for (let bj = -N; bj <= N; bj++) {
    const cx = bi * PITCH, cz = bj * PITCH;
    if (bi === 0 && bj === 0) { megatower(); continue; }
    if (bi === PLAZA[0] && bj === PLAZA[1]) { hologramPlaza(cx, cz); continue; }

    const dist = Math.hypot(cx, cz);
    const scale = 1 + 3 * Math.exp(-dist / 40);
    const lots = chance(0.22)
      ? [[cx, cz, BLOCK - 2]]
      : [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [cx + sx * BLOCK / 4, cz + sz * BLOCK / 4, BLOCK / 2 - 1.2]);

    for (const [x, z, size] of lots) {
      if (lots.length > 1 && chance(0.08)) continue; // empty lot
      const h = range(5, 15) * scale * (chance(0.08) ? 1.7 : 1);
      const shape = rand();
      if (shape < 0.58) {
        const w = size * range(0.8, 1), d = size * range(0.8, 1);
        boxBuilding(x, z, w, d, h);
        roofClutter(x, z, w, d, CURB + h);
      } else if (shape < 0.78) {
        // Stepped tower
        const w = size * range(0.85, 1), d = size * range(0.85, 1);
        const h1 = h * range(0.5, 0.65);
        boxBuilding(x, z, w, d, h1);
        const w2 = w * range(0.55, 0.75), d2 = d * range(0.55, 0.75);
        const h2 = h - h1 + range(2, 8);
        boxBuilding(x, z, w2, d2, h2, CURB + h1, false);
        batches.dark.add(x, CURB + h1 + 0.2, z, w * 0.98, 0.4, d * 0.98);
        roofClutter(x, z, w2, d2, CURB + h1 + h2);
      } else if (shape < 0.9) {
        prismBuilding(x, z, size / 2, h * 1.15, 6, 1);
      } else {
        prismBuilding(x, z, size / 1.6, h * 1.2, 4, range(0.45, 0.7));
      }
      if (h > 38 && searchlights.length < 4) {
        searchlights.push(1);
        searchlight(x, CURB + h + 0.5, z, pick([0xff9ee8, 0x9fdcff, 0xfff4a8]));
      }
    }
  }
}

// --- Distant skyline ring (cheap instanced silhouettes)
{
  const farTex = windowTextures[1].clone();
  farTex.repeat.set(1, 3);
  const far = new BoxBatch(new THREE.MeshStandardMaterial({
    color: 0x120e1f, roughness: 1, flatShading: true,
    emissive: 0xffffff, emissiveMap: farTex, emissiveIntensity: 1.2,
  }));
  for (let i = 0; i < 220; i++) {
    const a = rand() * Math.PI * 2;
    const r = range(HALF + 25, HALF + 220);
    const s = range(6, 16);
    const h = range(10, 70) * (1 - (r - HALF) / 400);
    far.add(Math.cos(a) * r, h / 2, Math.sin(a) * r, s, h, s * range(0.7, 1.3), rand() * Math.PI);
  }
  far.build();
}

// ---------------------------------------------------------------------------
// Traffic: flying cars in sky lanes and cars on the streets
// ---------------------------------------------------------------------------
const carBodyMat = new THREE.MeshStandardMaterial({ color: 0x2a2540, roughness: 0.35, metalness: 0.8, flatShading: true });
const carGlassMat = new THREE.MeshStandardMaterial({ color: 0x0a0f1e, emissive: 0x1a6aff, emissiveIntensity: 0.5, roughness: 0.1, flatShading: true });
const headMat = new THREE.MeshBasicMaterial({ color: hdr(0xfff6e0, 3) });
const tailMat = new THREE.MeshBasicMaterial({ color: hdr(0xff1030, 3) });

function makeVehicle(accent, flying) {
  const car = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 2.4, 6, 1), carBodyMat);
  body.rotation.z = Math.PI / 2;
  body.scale.set(1, 1, 0.55);
  const cabin = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 1.1, 4, 1), carGlassMat);
  cabin.rotation.set(0, Math.PI / 4, Math.PI / 2);
  cabin.position.set(-0.1, 0.35, 0);
  cabin.scale.set(1, 1, 0.9);
  const head = new THREE.Mesh(unitBox, headMat);
  head.scale.set(0.05, 0.1, 0.7);
  head.position.set(1.2, 0, 0);
  const tail = new THREE.Mesh(unitBox, tailMat);
  tail.scale.set(0.05, 0.1, 0.75);
  tail.position.set(-1.2, 0, 0);
  car.add(body, cabin, head, tail);
  if (flying) {
    const glowMat = new THREE.MeshBasicMaterial({ color: hdr(accent, 2.5) });
    const under = new THREE.Mesh(unitBox, glowMat);
    under.scale.set(1.6, 0.04, 0.6);
    under.position.y = -0.3;
    const trail = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({
      color: hdr(accent, 1.5), transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    trail.scale.set(6, 0.06, 0.5);
    trail.position.set(-4.3, -0.05, 0);
    car.add(under, trail);
  } else {
    const trail = new THREE.Mesh(unitBox, new THREE.MeshBasicMaterial({
      color: hdr(0xff1030, 1.2), transparent: true, opacity: 0.3,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    trail.scale.set(3, 0.05, 0.6);
    trail.position.set(-2.7, 0, 0);
    car.add(trail);
  }
  scene.add(car);
  return car;
}

const vehicles = [];
const WRAP = HALF + 30;
function addTraffic(count, flying) {
  for (let i = 0; i < count; i++) {
    const axis = chance(0.5) ? 'x' : 'z';
    const dir = chance(0.5) ? 1 : -1;
    const street = (Math.floor(range(-N - 1, N + 1)) + 0.5) * PITCH;
    const laneOff = flying ? range(-1.5, 1.5) : dir * 1.4;
    const y = flying ? pick([16, 24, 32, 44, 58]) + range(-1, 1) : 0.5;
    const car = makeVehicle(pick(NEON), flying);
    if (!flying) car.scale.setScalar(0.8);
    const v = {
      car, axis, dir, y, flying,
      fixed: street + (axis === 'x' ? laneOff : -laneOff),
      pos: range(-WRAP, WRAP),
      speed: flying ? range(14, 28) : range(7, 13),
      bob: rand() * 10,
    };
    car.rotation.y = axis === 'x' ? (dir > 0 ? 0 : Math.PI) : (dir > 0 ? -Math.PI / 2 : Math.PI / 2);
    vehicles.push(v);
  }
}
addTraffic(70, true);
addTraffic(90, false);

updaters.push((t, dt) => {
  for (const v of vehicles) {
    v.pos += v.dir * v.speed * dt;
    if (v.pos > WRAP) v.pos -= 2 * WRAP;
    if (v.pos < -WRAP) v.pos += 2 * WRAP;
    const y = v.y + (v.flying ? Math.sin(t * 1.5 + v.bob) * 0.3 : 0);
    if (v.axis === 'x') v.car.position.set(v.pos, y, v.fixed);
    else v.car.position.set(v.fixed, y, v.pos);
  }
});

// ---------------------------------------------------------------------------
// Rain
// ---------------------------------------------------------------------------
const RAIN = 7000, RAIN_TOP = 110, RAIN_R = 110;
const rainPos = new Float32Array(RAIN * 6);
const rainSpeed = new Float32Array(RAIN);
for (let i = 0; i < RAIN; i++) {
  const x = range(-RAIN_R, RAIN_R), z = range(-RAIN_R, RAIN_R), y = range(0, RAIN_TOP);
  rainPos.set([x, y, z, x - 0.25, y - 1.4, z - 0.1], i * 6);
  rainSpeed[i] = range(55, 75);
}
const rainGeo = new THREE.BufferGeometry();
rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({
  color: 0x9ab4ff, transparent: true, opacity: 0.32, depthWrite: false,
}));
rain.frustumCulled = false;
scene.add(rain);

updaters.push((t, dt) => {
  if (!rain.visible) return;
  for (let i = 0; i < RAIN; i++) {
    const o = i * 6;
    const fall = rainSpeed[i] * dt;
    rainPos[o + 1] -= fall;
    rainPos[o + 4] -= fall;
    rainPos[o] -= fall * 0.18;
    rainPos[o + 3] -= fall * 0.18;
    if (rainPos[o + 4] < 0) {
      const x = range(-RAIN_R, RAIN_R), z = range(-RAIN_R, RAIN_R);
      rainPos.set([x, RAIN_TOP, z, x - 0.25, RAIN_TOP - 1.4, z - 0.1], o);
    }
  }
  rainGeo.attributes.position.needsUpdate = true;
  rain.position.set(controls.target.x, 0, controls.target.z);
});

// Build every instanced batch now that the city is laid out
Object.values(batches).forEach((b) => b.build());

// ---------------------------------------------------------------------------
// Post-processing: bloom makes every HDR colour glow
// ---------------------------------------------------------------------------
const target = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight, {
  type: THREE.HalfFloatType, samples: 4,
});
const composer = new EffectComposer(renderer, target);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.85, 0.5, 1.0);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------------------
// Chase camera, input, resize, loop
// ---------------------------------------------------------------------------
let chase = null;
const chaseOffset = new THREE.Vector3(-14, 4.5, 0);
const chaseLook = new THREE.Vector3(14, 0.5, 0);
const tmp = new THREE.Vector3(), tmpLook = new THREE.Vector3();
const savedView = { pos: new THREE.Vector3(), target: new THREE.Vector3() };

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  switch (e.code) {
    case 'KeyR': rain.visible = !rain.visible; break;
    case 'KeyB': bloom.enabled = !bloom.enabled; break;
    case 'Space': controls.autoRotate = !controls.autoRotate; e.preventDefault(); break;
    case 'KeyC':
      if (chase) {
        chase = null;
        camera.position.copy(savedView.pos);
        controls.target.copy(savedView.target);
        controls.enabled = true;
      } else {
        savedView.pos.copy(camera.position);
        savedView.target.copy(controls.target);
        const flyers = vehicles.filter((v) => v.flying);
        chase = flyers[Math.floor(Math.random() * flyers.length)];
        controls.enabled = false;
        camera.position.copy(chase.car.localToWorld(tmp.copy(chaseOffset)));
      }
      break;
  }
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);
  const t = timer.getElapsed();
  timeUniform.value = t;
  for (const fn of updaters) fn(t, dt);

  if (chase) {
    chase.car.updateMatrixWorld();
    chase.car.localToWorld(tmp.copy(chaseOffset));
    if (camera.position.distanceTo(tmp) > 40) camera.position.copy(tmp); // the car wrapped around
    else camera.position.lerp(tmp, 1 - Math.exp(-dt * 4));
    camera.lookAt(chase.car.localToWorld(tmpLook.copy(chaseLook)));
    controls.target.copy(chase.car.position); // keeps the rain centred on the action
  } else {
    controls.update(dt);
  }
  composer.render();
});
