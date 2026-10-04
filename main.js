import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// House dimensions (world units ≈ metres)
const W = 6;          // width  (x)
const D = 5;          // depth  (z)
const H = 3;          // wall height
const RISE = 2;       // roof rise from eave to ridge
const ROOF_T = 0.2;   // roof slab thickness
const OVERHANG = 0.4; // roof overhang past the eaves

const mat = {
  wall: new THREE.MeshStandardMaterial({ color: 0xf1e4cc, roughness: 0.9 }),
  roof: new THREE.MeshStandardMaterial({ color: 0x8c3b2e, roughness: 0.7 }),
  trim: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 }),
  door: new THREE.MeshStandardMaterial({ color: 0x5e3a1e, roughness: 0.6 }),
  brass: new THREE.MeshStandardMaterial({ color: 0xd4a73a, metalness: 0.8, roughness: 0.3 }),
  glass: new THREE.MeshStandardMaterial({
    color: 0x8fc7ea, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.65,
  }),
  brick: new THREE.MeshStandardMaterial({ color: 0x9c4a3a, roughness: 1 }),
  stone: new THREE.MeshStandardMaterial({ color: 0xa8a8a0, roughness: 1 }),
  grass: new THREE.MeshStandardMaterial({ color: 0x6fae52, roughness: 1 }),
  trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2b, roughness: 1 }),
  leaf: new THREE.MeshStandardMaterial({ color: 0x3f8f43, roughness: 0.9, flatShading: true }),
  smoke: new THREE.MeshStandardMaterial({ color: 0xdddddd, transparent: true, roughness: 1 }),
};

function shadowed(mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material));
  mesh.position.set(x, y, z);
  return mesh;
}

// Walls and the triangular gable ends, centred on the origin at ground level.
function buildWalls() {
  const group = new THREE.Group();
  group.add(box(W, H, D, mat.wall, 0, H / 2, 0));

  const gableShape = new THREE.Shape();
  gableShape.moveTo(-W / 2, 0);
  gableShape.lineTo(W / 2, 0);
  gableShape.lineTo(0, RISE);
  gableShape.closePath();
  const gableGeo = new THREE.ExtrudeGeometry(gableShape, { depth: D, bevelEnabled: false });
  gableGeo.translate(0, 0, -D / 2);
  const gable = shadowed(new THREE.Mesh(gableGeo, mat.wall));
  gable.position.y = H;
  group.add(gable);

  // Stone foundation strip
  group.add(box(W + 0.2, 0.3, D + 0.2, mat.stone, 0, 0.15, 0));
  return group;
}

// Two sloped slabs meeting at a ridge along the z axis.
function buildRoof() {
  const group = new THREE.Group();
  const halfW = W / 2;
  const slope = Math.hypot(halfW, RISE);
  const angle = Math.atan2(RISE, halfW);
  const length = slope + OVERHANG + 0.1; // overhang at the eave, small overlap at the ridge
  const centre = (slope + OVERHANG - 0.1) / 2;

  for (const side of [1, -1]) {
    const slab = box(length, ROOF_T, D + OVERHANG * 2, mat.roof);
    const down = new THREE.Vector2(side * Math.cos(angle), -Math.sin(angle));
    const normal = new THREE.Vector2(side * Math.sin(angle), Math.cos(angle));
    slab.position.set(
      down.x * centre + normal.x * (ROOF_T / 2),
      H + RISE + down.y * centre + normal.y * (ROOF_T / 2),
      0,
    );
    slab.rotation.z = -side * angle;
    group.add(slab);
  }

  // Ridge cap
  group.add(box(0.35, 0.15, D + OVERHANG * 2, mat.roof, 0, H + RISE + ROOF_T * 0.9, 0));
  return group;
}

// A window facing +z: frame, glass, cross bars, sill. Origin at the wall surface.
function buildWindow(w = 1, h = 1.1) {
  const group = new THREE.Group();
  const f = 0.08; // frame thickness
  group.add(box(w, h, 0.06, mat.glass, 0, 0, 0.03));
  group.add(box(w + 2 * f, f, 0.12, mat.trim, 0, h / 2 + f / 2, 0.06));
  group.add(box(w + 2 * f, f, 0.12, mat.trim, 0, -h / 2 - f / 2, 0.06));
  group.add(box(f, h, 0.12, mat.trim, -w / 2 - f / 2, 0, 0.06));
  group.add(box(f, h, 0.12, mat.trim, w / 2 + f / 2, 0, 0.06));
  group.add(box(w, f / 2, 0.1, mat.trim, 0, 0, 0.06)); // horizontal bar
  group.add(box(f / 2, h, 0.1, mat.trim, 0, 0, 0.06)); // vertical bar
  group.add(box(w + 0.3, 0.07, 0.22, mat.trim, 0, -h / 2 - f - 0.035, 0.11)); // sill
  return group;
}

function buildDoor() {
  const group = new THREE.Group();
  const w = 1.1;
  const h = 2.1;
  const f = 0.1;
  group.add(box(w, h, 0.08, mat.door, 0, h / 2, 0.04));
  group.add(box(w + 2 * f, f, 0.14, mat.trim, 0, h + f / 2, 0.07));
  group.add(box(f, h + f, 0.14, mat.trim, -w / 2 - f / 2, (h + f) / 2, 0.07));
  group.add(box(f, h + f, 0.14, mat.trim, w / 2 + f / 2, (h + f) / 2, 0.07));

  // Raised panels
  for (const y of [0.55, 1.5]) {
    group.add(box(0.7, y === 0.55 ? 0.7 : 0.8, 0.03, mat.door, 0, y, 0.095));
  }

  const knob = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), mat.brass));
  knob.position.set(0.38, 1.0, 0.13);
  group.add(knob);

  // Step in front of the door
  group.add(box(w + 0.6, 0.15, 0.6, mat.stone, 0, 0.075, 0.3));
  return group;
}

function buildChimney() {
  const group = new THREE.Group();
  const x = 1.8;
  const z = -1;
  // Roof surface height at this x; the chimney extends well below it.
  const roofY = H + RISE * (1 - x / (W / 2));
  const top = H + RISE + 0.7;
  const height = top - (roofY - 0.5);
  group.add(box(0.7, height, 0.7, mat.brick, x, top - height / 2, z));
  group.add(box(0.85, 0.12, 0.85, mat.stone, x, top + 0.06, z));
  group.userData.top = new THREE.Vector3(x, top + 0.12, z);
  return group;
}

// Round attic window in the front gable.
function buildAtticWindow() {
  const group = new THREE.Group();
  const glass = new THREE.Mesh(new THREE.CircleGeometry(0.35, 32), mat.glass);
  glass.position.z = 0.01;
  const ring = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.37, 0.05, 12, 32), mat.trim));
  ring.position.z = 0.02;
  group.add(glass, ring);
  group.add(box(0.7, 0.04, 0.04, mat.trim, 0, 0, 0.03));
  group.add(box(0.04, 0.7, 0.04, mat.trim, 0, 0, 0.03));
  return group;
}

function buildHouse() {
  const house = new THREE.Group();
  house.add(buildWalls(), buildRoof());

  const door = buildDoor();
  door.position.z = D / 2;
  house.add(door);

  const frontY = 1.7;
  for (const x of [-1.9, 1.9]) {
    const win = buildWindow();
    win.position.set(x, frontY, D / 2);
    house.add(win);
  }

  const attic = buildAtticWindow();
  attic.position.set(0, H + 0.85, D / 2);
  house.add(attic);

  // Side windows (rotated to face ±x) and a back window
  for (const [side, rotY] of [[1, Math.PI / 2], [-1, -Math.PI / 2]]) {
    for (const z of [-1.1, 1.1]) {
      const win = buildWindow();
      win.rotation.y = rotY;
      win.position.set(side * (W / 2), frontY, z);
      house.add(win);
    }
  }
  const back = buildWindow(1.4, 1.1);
  back.rotation.y = Math.PI;
  back.position.set(0, frontY, -D / 2);
  house.add(back);

  const chimney = buildChimney();
  house.add(chimney);
  house.userData.chimneyTop = chimney.userData.top;
  return house;
}

function buildTree(x, z, scale = 1) {
  const tree = new THREE.Group();
  const trunk = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 2, 10), mat.trunk));
  trunk.position.y = 1;
  tree.add(trunk);
  const blobs = [[0, 2.8, 0, 1.3], [0.6, 3.4, 0.2, 0.9], [-0.5, 3.5, -0.3, 0.8]];
  for (const [bx, by, bz, r] of blobs) {
    const blob = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat.leaf));
    blob.position.set(bx, by, bz);
    tree.add(blob);
  }
  tree.position.set(x, 0, z);
  tree.scale.setScalar(scale);
  return tree;
}

function buildBush(x, z, r = 0.45) {
  const bush = shadowed(new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), mat.leaf));
  bush.position.set(x, r * 0.8, z);
  bush.scale.y = 0.85;
  return bush;
}

function buildGarden() {
  const group = new THREE.Group();

  const ground = new THREE.Mesh(new THREE.CircleGeometry(40, 64), mat.grass);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  // Stepping-stone path from the door to the edge of the lawn
  for (let i = 0; i < 6; i++) {
    const stone = box(1.1, 0.06, 0.7, mat.stone, (i % 2 ? 0.12 : -0.12), 0.03, D / 2 + 1.2 + i * 0.95);
    stone.rotation.y = (i % 2 ? 1 : -1) * 0.08;
    group.add(stone);
  }

  group.add(buildTree(-6.5, 1.5, 1.1));
  group.add(buildTree(7.5, -3, 0.85));
  for (const x of [-2.6, -1.9, 1.9, 2.6]) group.add(buildBush(x, D / 2 + 0.55, 0.4));

  return group;
}

// A few translucent puffs that drift up from the chimney.
function buildSmoke(origin) {
  const puffs = [];
  const group = new THREE.Group();
  const count = 6;
  for (let i = 0; i < count; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), mat.smoke.clone());
    puff.userData.phase = i / count;
    group.add(puff);
    puffs.push(puff);
  }
  function update(t) {
    for (const puff of puffs) {
      const p = (t * 0.12 + puff.userData.phase) % 1;
      puff.position.set(origin.x + p * 0.9, origin.y + 0.2 + p * 2.4, origin.z);
      puff.scale.setScalar(0.6 + p * 1.8);
      puff.material.opacity = 0.55 * (1 - p);
    }
  }
  update(0);
  return { group, update };
}

// --- Scene setup -----------------------------------------------------------

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xbfe3f5);
scene.fog = new THREE.Fog(0xbfe3f5, 22, 42); // fades the lawn edge into the sky

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
camera.position.set(9, 6, 12);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 2.5, 0);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI / 2 - 0.02; // keep the camera above the ground
controls.minDistance = 4;
controls.maxDistance = 35;
controls.update();

scene.add(new THREE.HemisphereLight(0xdff1ff, 0x6a8c4a, 1.1));

const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
sun.position.set(10, 14, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 1, far: 50 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
scene.add(sun);

const house = buildHouse();
scene.add(house, buildGarden());

const smoke = buildSmoke(house.userData.chimneyTop);
scene.add(smoke.group);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

renderer.setAnimationLoop((time) => {
  smoke.update(time / 1000);
  controls.update();
  renderer.render(scene, camera);
});

// Exposed for debugging / automated checks
window.__scene = { scene, camera, renderer, controls };
