import * as THREE from "three";
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";

const WORLD_SIZE = 48;
const EYE_HEIGHT = 1.7;
const GRAVITY = 20;
const JUMP_SPEED = 8;
const PLAYER_SPEED = 5.2;
const AGGRO_RANGE = 14;
const ATTACK_RANGE = 1.35;
const ATTACK_REACH = 4.5;
const MAX_ZOMBIES = 10;
const MAX_PIGS = 8;
const SWING_DURATION = 0.25;
const THIRD_PERSON_DIST = 3.6;
const THIRD_PERSON_HEIGHT = 1.1;
const AO_LEVELS = [0.45, 0.65, 0.82, 1.0];
const FACE_SUBDIV = 4;

const DAY_DURATION = 180; // seconds of daylight
const NIGHT_DURATION = 180; // seconds of night
const FULL_CYCLE = DAY_DURATION + NIGHT_DURATION;
const SKY_DAY = new THREE.Color(0x8fd3f4);
const SKY_NIGHT = new THREE.Color(0x060812);
const SKY_HORIZON = new THREE.Color(0xf3a25c);

const HUNGER_DECAY_PER_SEC = 100 / 300; // empties over 5 min of play
const STARVE_DAMAGE_INTERVAL = 4;
const STARVE_DAMAGE = 3;
const HUNGER_FROM_MEAT = 35;

const BLOCK_COLORS = {
  grass: { top: 0x5fb83b, side: 0x7a5230, bottom: 0x5c3a21 },
  dirt: { top: 0x7a5230, side: 0x7a5230, bottom: 0x7a5230 },
  stone: { top: 0x8f8f8f, side: 0x8f8f8f, bottom: 0x8f8f8f },
  wood: { top: 0x8a6239, side: 0x5c3a21, bottom: 0x8a6239 },
  leaves: { top: 0x2e7d32, side: 0x2e7d32, bottom: 0x2e7d32 },
};

// --- deterministic hash + value noise (no external noise lib needed) ---
function hash2(x, y) {
  let n = x * 374761393 + y * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  n = n ^ (n >> 16);
  return ((n & 0x7fffffff) / 0x7fffffff);
}
function fade(t) { return t * t * (3 - 2 * t); }
function lerp(a, b, t) { return a + (b - a) * t; }
function valueNoise(x, y) {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const sx = fade(x - x0), sy = fade(y - y0);
  const n00 = hash2(x0, y0), n10 = hash2(x0 + 1, y0);
  const n01 = hash2(x0, y0 + 1), n11 = hash2(x0 + 1, y0 + 1);
  return lerp(lerp(n00, n10, sx), lerp(n01, n11, sx), sy);
}
function fractalNoise(x, y) {
  let h = 0, amp = 1, freq = 0.06, max = 0;
  for (let o = 0; o < 3; o++) {
    h += valueNoise(x * freq, y * freq) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return h / max;
}
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// --- world data ---
const worldData = new Map();
const heightMap = [];
function key(x, y, z) { return x + ',' + y + ',' + z; }
function getBlock(x, y, z) { return worldData.get(key(x, y, z)) || null; }
function setBlock(x, y, z, type) { worldData.set(key(x, y, z), type); }
function removeBlock(x, y, z) { worldData.delete(key(x, y, z)); }
function groundHeight(x, z) {
  const ix = clamp(Math.round(x), 0, WORLD_SIZE - 1);
  const iz = clamp(Math.round(z), 0, WORLD_SIZE - 1);
  return heightMap[ix][iz];
}

function generateWorld() {
  for (let x = 0; x < WORLD_SIZE; x++) {
    heightMap[x] = [];
    for (let z = 0; z < WORLD_SIZE; z++) {
      const h = Math.floor(3 + fractalNoise(x, z) * 8);
      heightMap[x][z] = h;
      for (let y = 0; y < h; y++) {
        const depth = h - 1 - y;
        const type = depth === 0 ? 'grass' : depth <= 3 ? 'dirt' : 'stone';
        setBlock(x, y, z, type);
      }
    }
  }

  const spawnX = WORLD_SIZE / 2, spawnZ = WORLD_SIZE / 2;
  const treePositions = [];
  for (let x = 3; x < WORLD_SIZE - 3; x++) {
    for (let z = 3; z < WORLD_SIZE - 3; z++) {
      if (Math.hypot(x - spawnX, z - spawnZ) < 6) continue;
      if (Math.random() > 0.985) {
        const tooClose = treePositions.some((p) => Math.abs(p[0] - x) < 4 && Math.abs(p[1] - z) < 4);
        if (!tooClose) {
          treePositions.push([x, z]);
          placeTree(x, heightMap[x][z], z);
        }
      }
    }
  }
}

function placeTree(x, topY, z) {
  for (let i = 0; i < 4; i++) setBlock(x, topY + i, z, 'wood');
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      if (dx === 0 && dz === 0) continue;
      if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
      setBlock(x + dx, topY + 3, z + dz, 'leaves');
    }
  }
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      if (dx === 0 && dz === 0) continue;
      setBlock(x + dx, topY + 4, z + dz, 'leaves');
    }
  }
  setBlock(x, topY + 4, z, 'leaves');
  setBlock(x, topY + 5, z, 'leaves');
}

// --- rendering setup ---
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(SKY_DAY);
scene.fog = new THREE.Fog(SKY_DAY.getHex(), 30, 88);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const hemi = new THREE.HemisphereLight(0xbfe3ff, 0x5c4a34, 0.7);
scene.add(hemi);

function makeSunLight(color) {
  const light = new THREE.DirectionalLight(color, 0);
  light.target.position.set(WORLD_SIZE / 2, 0, WORLD_SIZE / 2);
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.camera.left = -38;
  light.shadow.camera.right = 38;
  light.shadow.camera.top = 38;
  light.shadow.camera.bottom = -38;
  light.shadow.camera.near = 1;
  light.shadow.camera.far = 220;
  light.shadow.bias = -0.0015;
  scene.add(light);
  scene.add(light.target);
  return light;
}
const sun = makeSunLight(0xfff3d6);
const moonLight = makeSunLight(0x9db4d9);

// --- sky bodies ---
const sunMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(4.2, 0), new THREE.MeshBasicMaterial({ color: 0xfff4d6, fog: false }));
const moonMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 0), new THREE.MeshBasicMaterial({ color: 0xd7e3f0, fog: false }));
scene.add(sunMesh, moonMesh);

// --- clouds ---
const cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.88 });
const clouds = [];
function buildCloud() {
  const group = new THREE.Group();
  const puffCount = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < puffCount; i++) {
    const w = 3 + Math.random() * 3, h = 1.1, d = 2 + Math.random() * 2;
    const box = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), cloudMat);
    box.position.set((Math.random() - 0.5) * 5, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 3.5);
    group.add(box);
  }
  return group;
}
const CLOUD_MARGIN = 24;
const CLOUD_SPAN = WORLD_SIZE + CLOUD_MARGIN * 2;
for (let i = 0; i < 14; i++) {
  const cloud = buildCloud();
  cloud.position.set(
    -CLOUD_MARGIN + Math.random() * CLOUD_SPAN,
    26 + Math.random() * 8,
    -CLOUD_MARGIN + Math.random() * CLOUD_SPAN
  );
  cloud.userData.speed = 0.4 + Math.random() * 0.5;
  scene.add(cloud);
  clouds.push(cloud);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- day / night cycle ---
let dayClock = FULL_CYCLE * 0.25; // start at noon, not sunrise
let daylight = 1;
const _skyColor = new THREE.Color();

function updateSky(delta, center) {
  dayClock = (dayClock + delta) % FULL_CYCLE;
  const sunAngle = (dayClock / FULL_CYCLE) * Math.PI * 2;
  const moonAngle = sunAngle + Math.PI;
  const sunHeight = Math.sin(sunAngle);
  const moonHeight = Math.sin(moonAngle);
  daylight = Math.max(0, sunHeight);
  const moonlight = Math.max(0, moonHeight);

  const skyRadius = 140;
  sunMesh.position.set(center.x + Math.cos(sunAngle) * skyRadius, sunHeight * skyRadius, center.z - 20);
  moonMesh.position.set(center.x + Math.cos(moonAngle) * skyRadius, moonHeight * skyRadius, center.z - 20);
  sunMesh.visible = sunHeight > -0.05;
  moonMesh.visible = moonHeight > -0.05;

  sun.position.set(center.x + Math.cos(sunAngle) * 60, Math.max(sunHeight, 0.05) * 60 + 20, center.z + 15);
  sun.target.position.set(center.x, 0, center.z);
  sun.intensity = daylight;
  sun.castShadow = daylight >= moonlight;

  moonLight.position.set(center.x + Math.cos(moonAngle) * 60, Math.max(moonHeight, 0.05) * 60 + 20, center.z + 15);
  moonLight.target.position.set(center.x, 0, center.z);
  moonLight.intensity = moonlight * 0.28;
  moonLight.castShadow = moonlight > daylight;

  hemi.intensity = 0.22 + daylight * 0.5 + moonlight * 0.08;

  const horizonMix = Math.max(0, 1 - Math.abs(sunHeight) * 3.5);
  _skyColor.lerpColors(SKY_NIGHT, SKY_DAY, daylight);
  _skyColor.lerp(SKY_HORIZON, horizonMix * 0.45);
  scene.background.copy(_skyColor);
  scene.fog.color.copy(_skyColor);
  cloudMat.color.copy(_skyColor).lerp(new THREE.Color(0xffffff), 0.55 + daylight * 0.25);
  cloudMat.opacity = 0.55 + daylight * 0.35;
}

function updateClouds(delta) {
  for (const cloud of clouds) {
    cloud.position.x += cloud.userData.speed * delta;
    if (cloud.position.x > WORLD_SIZE + CLOUD_MARGIN) cloud.position.x = -CLOUD_MARGIN;
  }
}

// --- face-culled voxel mesh building ---
const FACES = [
  { dir: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]], key: 'side' },
  { dir: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]], key: 'side' },
  { dir: [0, 1, 0], corners: [[0, 1, 0], [0, 1, 1], [1, 1, 1], [1, 1, 0]], key: 'top' },
  { dir: [0, -1, 0], corners: [[0, 0, 1], [0, 0, 0], [1, 0, 0], [1, 0, 1]], key: 'bottom' },
  { dir: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]], key: 'side' },
  { dir: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]], key: 'side' },
];

let worldMeshes = {};

function varyColor(hex, x, y, z, amount) {
  const c = new THREE.Color(hex);
  const j = (hash2(x * 7 + z * 13, y * 17 + x) - 0.5) * amount;
  c.offsetHSL(0, 0, j);
  return c;
}

// Per-vertex ambient occlusion: for each face corner, look at the two blocks
// adjacent to it in the face plane plus the diagonal block; more solid
// neighbors -> darker corner. Standard cheap voxel-AO technique.
function cornerAO(bx, by, bz, face, corner) {
  const [fx, fy, fz] = face.dir;
  const normalAxis = fx !== 0 ? 0 : fy !== 0 ? 1 : 2;
  const tangents = [0, 1, 2].filter((a) => a !== normalAxis);
  const [t1, t2] = tangents;
  const base = [bx + fx, by + fy, bz + fz];
  const sign1 = corner[t1] === 0 ? -1 : 1;
  const sign2 = corner[t2] === 0 ? -1 : 1;
  const side1Pos = base.slice(); side1Pos[t1] += sign1;
  const side2Pos = base.slice(); side2Pos[t2] += sign2;
  const cornerPos = base.slice(); cornerPos[t1] += sign1; cornerPos[t2] += sign2;
  const side1 = !!getBlock(side1Pos[0], side1Pos[1], side1Pos[2]);
  const side2 = !!getBlock(side2Pos[0], side2Pos[1], side2Pos[2]);
  const cornerB = !!getBlock(cornerPos[0], cornerPos[1], cornerPos[2]);
  if (side1 && side2) return AO_LEVELS[0];
  return AO_LEVELS[3 - (side1 + side2 + cornerB)];
}

function lerp3(a, b, t) {
  return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
}

// Fine per-subcell brightness jitter so faces read as grainy/textured
// instead of one flat color, purely via geometry + vertex colors.
function subcellGrain(pos, salt) {
  const gx = Math.round(pos[0] * 53), gy = Math.round(pos[1] * 71), gz = Math.round(pos[2] * 97);
  return hash2(gx + gz * 3 + salt, gy * 7 - gx + salt * 31);
}

// Subdivides a block face into an NxN grid, bilinearly interpolating
// position and per-corner AO across it, and stamping each subcell with
// its own grain color so blocks aren't a single flat polygon/color.
function emitFace(buf, bx, by, bz, face, baseColor, type) {
  const aoVals = face.corners.map((c) => cornerAO(bx, by, bz, face, c));
  const macroPos = face.corners.map((c) => [bx + c[0], by + c[1], bz + c[2]]);
  const n = FACE_SUBDIV;
  const grainAmount = type === 'leaves' || type === 'grass' ? 0.28 : 0.16;
  const jitterAmount = type === 'leaves' ? 0.055 : 0;

  const grid = [];
  for (let i = 0; i <= n; i++) {
    grid[i] = [];
    const u = i / n;
    const topPos = lerp3(macroPos[0], macroPos[1], u);
    const botPos = lerp3(macroPos[3], macroPos[2], u);
    const topAO = lerp(aoVals[0], aoVals[1], u);
    const botAO = lerp(aoVals[3], aoVals[2], u);
    for (let j = 0; j <= n; j++) {
      const v = j / n;
      grid[i][j] = { pos: lerp3(topPos, botPos, v), ao: lerp(topAO, botAO, v) };
    }
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const cell = [grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1]];
      const startIndex = buf.count;
      for (const c of cell) {
        let pos = c.pos;
        if (jitterAmount) {
          const j2 = (subcellGrain(pos, 999) - 0.5) * jitterAmount;
          pos = [pos[0] + face.dir[0] * j2, pos[1] + face.dir[1] * j2, pos[2] + face.dir[2] * j2];
        }
        const grain = 1 + (subcellGrain(c.pos, 17) - 0.5) * grainAmount;
        buf.positions.push(pos[0], pos[1], pos[2]);
        buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
        const shade = grain * c.ao;
        buf.colors.push(baseColor.r * shade, baseColor.g * shade, baseColor.b * shade);
      }
      buf.indices.push(startIndex, startIndex + 1, startIndex + 2, startIndex, startIndex + 2, startIndex + 3);
      buf.count += 4;
    }
  }
}

function rebuildWorldMesh() {
  for (const type in worldMeshes) {
    scene.remove(worldMeshes[type]);
    worldMeshes[type].geometry.dispose();
    worldMeshes[type].material.dispose();
  }
  worldMeshes = {};

  const buffers = {};
  const ensure = (type) => {
    if (!buffers[type]) buffers[type] = { positions: [], normals: [], colors: [], indices: [], count: 0 };
    return buffers[type];
  };

  for (const [k, type] of worldData) {
    const [x, y, z] = k.split(',').map(Number);
    const colors = BLOCK_COLORS[type];
    const buf = ensure(type);
    for (const face of FACES) {
      const nx = x + face.dir[0], ny = y + face.dir[1], nz = z + face.dir[2];
      if (getBlock(nx, ny, nz)) continue;
      const baseColor = colors[face.key];
      const col = varyColor(baseColor, x, y, z, type === 'leaves' ? 0.08 : 0.04);
      emitFace(buf, x, y, z, face, col, type);
    }
  }

  for (const type in buffers) {
    const buf = buffers[type];
    if (buf.count === 0) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(buf.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(buf.normals, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(buf.colors, 3));
    geo.setIndex(new THREE.Uint32BufferAttribute(buf.indices, 1));
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    worldMeshes[type] = mesh;
  }
}

// --- player / controls ---
// PointerLockControls drives an invisible rig (position + look quaternion);
// the real camera is derived from it each frame so it can be pulled back
// behind the player in third-person view.
const playerRig = new THREE.Object3D();
const controls = new PointerLockControls(playerRig, renderer.domElement);
scene.add(playerRig);
scene.add(camera);

let viewMode = 'first';

function syncCamera() {
  if (viewMode === 'first') {
    camera.position.copy(playerRig.position);
    camera.quaternion.copy(playerRig.quaternion);
    playerBody.visible = false;
    swordViewModel.visible = true;
  } else {
    const back = new THREE.Vector3(0, 0, 1).applyQuaternion(playerRig.quaternion);
    const desired = playerRig.position.clone()
      .addScaledVector(back, THIRD_PERSON_DIST)
      .add(new THREE.Vector3(0, THIRD_PERSON_HEIGHT * 0.3, 0));
    const minY = groundHeight(desired.x, desired.z) + 0.6;
    if (desired.y < minY) desired.y = minY;
    camera.position.copy(desired);
    camera.quaternion.copy(playerRig.quaternion);
    playerBody.visible = true;
    swordViewModel.visible = false;
  }
}

const blocker = document.getElementById('blocker');
const startBtn = document.getElementById('startBtn');
const deathScreen = document.getElementById('deathScreen');
const deathStats = document.getElementById('deathStats');
const respawnBtn = document.getElementById('respawnBtn');
const healthBar = document.getElementById('healthBar');
const hungerBar = document.getElementById('hungerBar');
const killsValueEl = document.getElementById('killsValue');
const meatValueEl = document.getElementById('meatValue');
const eatHint = document.getElementById('eatHint');
const hitFlash = document.getElementById('hitFlash');

let playerHP = 100;
let hunger = 100;
let meat = 0;
let starveTimer = 0;
let kills = 0;
let gameOver = false;
let verticalVelocity = 0;
let onGround = true;

function updateMeatUI() {
  meatValueEl.textContent = meat;
  eatHint.classList.toggle('hidden', meat <= 0);
}

function eatMeat() {
  if (gameOver || meat <= 0 || hunger >= 100) return;
  meat--;
  hunger = clamp(hunger + HUNGER_FROM_MEAT, 0, 100);
  hungerBar.style.width = hunger + '%';
  updateMeatUI();
}

const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') jump();
  if (e.code === 'KeyF') viewMode = viewMode === 'first' ? 'third' : 'first';
  if (e.code === 'KeyE') eatMeat();
  if (e.code >= 'Digit1' && e.code <= 'Digit5') selectSlot(Number(e.code.slice(-1)) - 1);
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

function updateHunger(delta) {
  hunger = clamp(hunger - HUNGER_DECAY_PER_SEC * delta, 0, 100);
  hungerBar.style.width = hunger + '%';
  if (hunger <= 0) {
    starveTimer += delta;
    if (starveTimer >= STARVE_DAMAGE_INTERVAL) {
      starveTimer = 0;
      damagePlayer(STARVE_DAMAGE);
    }
  } else {
    starveTimer = 0;
  }
}

function jump() {
  if (onGround && !gameOver) {
    verticalVelocity = JUMP_SPEED;
    onGround = false;
  }
}

blocker.addEventListener('click', () => { if (!gameOver) controls.lock(); });
startBtn.addEventListener('click', (e) => { e.stopPropagation(); controls.lock(); });
controls.addEventListener('lock', () => blocker.classList.add('hidden'));
controls.addEventListener('unlock', () => { if (!gameOver) blocker.classList.remove('hidden'); });

function spawnPlayer() {
  const cx = WORLD_SIZE / 2, cz = WORLD_SIZE / 2;
  playerRig.position.set(cx, groundHeight(cx, cz) + EYE_HEIGHT, cz);
  verticalVelocity = 0;
  onGround = true;
}

function isHorizontallyBlocked(x, z) {
  const feetY = playerRig.position.y - EYE_HEIGHT;
  const bx = Math.floor(x), bz = Math.floor(z);
  for (let dy = 0; dy <= 1; dy++) {
    if (getBlock(bx, Math.floor(feetY) + dy, bz)) return true;
  }
  return false;
}

function updatePlayer(delta) {
  const speed = PLAYER_SPEED * delta;
  const forward = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
  const strafe = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);

  const prevX = playerRig.position.x, prevZ = playerRig.position.z;
  controls.moveForward(forward * speed);
  controls.moveRight(strafe * speed);
  playerRig.position.x = clamp(playerRig.position.x, 1, WORLD_SIZE - 2);
  playerRig.position.z = clamp(playerRig.position.z, 1, WORLD_SIZE - 2);
  if (isHorizontallyBlocked(playerRig.position.x, prevZ)) playerRig.position.x = prevX;
  if (isHorizontallyBlocked(playerRig.position.x, playerRig.position.z)) playerRig.position.z = prevZ;

  const ground = groundHeight(playerRig.position.x, playerRig.position.z);
  if (!onGround) verticalVelocity -= GRAVITY * delta;
  let feetY = (playerRig.position.y - EYE_HEIGHT) + verticalVelocity * delta;
  if (feetY <= ground) {
    feetY = ground;
    verticalVelocity = 0;
    onGround = true;
  } else {
    onGround = false;
  }
  playerRig.position.y = feetY + EYE_HEIGHT;

  const moving = (forward !== 0 || strafe !== 0) && onGround;
  updatePlayerBody(delta, moving);
}

function damagePlayer(amount) {
  if (gameOver) return;
  playerHP = clamp(playerHP - amount, 0, 100);
  healthBar.style.width = playerHP + '%';
  hitFlash.classList.add('active');
  setTimeout(() => hitFlash.classList.remove('active'), 150);
  if (playerHP <= 0) die();
}

function die() {
  gameOver = true;
  controls.unlock();
  deathStats.textContent = `Убито зомби: ${kills}`;
  deathScreen.classList.remove('hidden');
}

respawnBtn.addEventListener('click', () => {
  playerHP = 100;
  healthBar.style.width = '100%';
  hunger = 100;
  hungerBar.style.width = '100%';
  starveTimer = 0;
  meat = 0;
  updateMeatUI();
  kills = 0;
  killsValueEl.textContent = '0';
  gameOver = false;
  deathScreen.classList.add('hidden');
  spawnPlayer();
  for (const z of zombies) z.dispose();
  zombies.length = 0;
  spawnInitialZombies();
  controls.lock();
});

// --- hotbar ---
let selectedBlockType = 'grass';
const slots = Array.from(document.querySelectorAll('.slot'));
function selectSlot(i) {
  slots.forEach((s, idx) => s.classList.toggle('selected', idx === i));
  selectedBlockType = slots[i].dataset.type;
}
slots.forEach((s, i) => s.addEventListener('click', () => selectSlot(i)));

// --- raycasting for block break/place ---
function playerLookDir() {
  return new THREE.Vector3(0, 0, -1).applyQuaternion(playerRig.quaternion);
}

function raycastBlock(maxDist = 6, step = 0.04) {
  const dir = playerLookDir();
  const origin = playerRig.position.clone();
  let lastEmpty = null;
  for (let t = 0; t < maxDist; t += step) {
    const p = origin.clone().addScaledVector(dir, t);
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    if (getBlock(bx, by, bz)) {
      return { x: bx, y: by, z: bz, placeAt: lastEmpty };
    }
    lastEmpty = { x: bx, y: by, z: bz };
  }
  return null;
}

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (!controls.isLocked || gameOver) return;
  if (e.button === 0) {
    triggerSwing();
    const target = getTargetEntity();
    if (target) {
      if (target.kind === 'zombie') attackZombie(target.entity);
      else attackPig(target.entity);
    } else {
      const hit = raycastBlock();
      if (hit) {
        removeBlock(hit.x, hit.y, hit.z);
        rebuildWorldMesh();
      }
    }
  } else if (e.button === 2) {
    const hit = raycastBlock();
    if (hit && hit.placeAt) {
      const { x, y, z } = hit.placeAt;
      const feetY = Math.floor(playerRig.position.y - EYE_HEIGHT);
      const headY = Math.floor(playerRig.position.y);
      const inPlayer = Math.floor(playerRig.position.x) === x && Math.floor(playerRig.position.z) === z && (y === feetY || y === headY);
      if (!inPlayer) {
        setBlock(x, y, z, selectedBlockType);
        rebuildWorldMesh();
      }
    }
  }
});

// --- sword ---
function buildSwordMesh() {
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshLambertMaterial({ color: 0xd7d9dd });
  const guardMat = new THREE.MeshLambertMaterial({ color: 0xcfa53a });
  const handleMat = new THREE.MeshLambertMaterial({ color: 0x5c3a21 });

  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.62, 0.03), bladeMat);
  blade.position.set(0, 0.5, 0);
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.06), guardMat);
  guard.position.set(0, 0.16, 0);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), handleMat);
  handle.position.set(0, 0.02, 0);

  group.add(blade, guard, handle);
  group.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return group;
}

const swordViewModel = buildSwordMesh();
const SWORD_REST = { pos: [0.32, -0.35, -0.55], rot: [-0.3, 0.4, -0.9] };
swordViewModel.position.set(...SWORD_REST.pos);
swordViewModel.rotation.set(...SWORD_REST.rot);
camera.add(swordViewModel);

// --- player body (visible in third-person) ---
function buildPlayerMesh() {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xd8a072 });
  const shirt = new THREE.MeshLambertMaterial({ color: 0x3a6ea5 });
  const pants = new THREE.MeshLambertMaterial({ color: 0x2b3550 });

  const legGeo = new THREE.BoxGeometry(0.28, 0.8, 0.28);
  const legL = new THREE.Mesh(legGeo, pants);
  legL.position.set(-0.15, 0.4, 0);
  const legR = new THREE.Mesh(legGeo, pants);
  legR.position.set(0.15, 0.4, 0);

  const torsoGeo = new THREE.BoxGeometry(0.6, 0.75, 0.35);
  const torso = new THREE.Mesh(torsoGeo, shirt);
  torso.position.set(0, 1.175, 0);

  const armGeo = new THREE.BoxGeometry(0.25, 0.7, 0.25);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.42, 1.15, 0);

  const armPivotR = new THREE.Group();
  armPivotR.position.set(0.42, 1.5, 0);
  const armR = new THREE.Mesh(armGeo, skin);
  armR.position.set(0, -0.35, 0);
  armPivotR.add(armR);

  const sword = buildSwordMesh();
  sword.scale.setScalar(0.9);
  sword.position.set(0, -0.32, 0.02);
  sword.rotation.set(-0.15, 0, 0);
  armR.add(sword);

  const headGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  const head = new THREE.Mesh(headGeo, skin);
  head.position.set(0, 1.78, 0);

  group.add(legL, legR, torso, armL, armPivotR, head);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  group.visible = false;
  return { group, armPivotR, legL, legR };
}

const playerParts = buildPlayerMesh();
const playerBody = playerParts.group;
scene.add(playerBody);

let swinging = false;
let swingTime = 0;
let walkCycle = 0;

function triggerSwing() {
  swinging = true;
  swingTime = 0;
}

function updatePlayerBody(delta, moving) {
  if (moving) {
    walkCycle += delta * 8;
    playerParts.legL.rotation.x = Math.sin(walkCycle) * 0.5;
    playerParts.legR.rotation.x = -Math.sin(walkCycle) * 0.5;
  } else {
    playerParts.legL.rotation.x *= 0.8;
    playerParts.legR.rotation.x *= 0.8;
  }

  let swing = 0;
  if (swinging) {
    swingTime += delta;
    const t = Math.min(swingTime / SWING_DURATION, 1);
    swing = Math.sin(t * Math.PI);
    if (t >= 1) swinging = false;
  }
  swordViewModel.rotation.x = SWORD_REST.rot[0] - swing * 1.1;
  swordViewModel.rotation.z = SWORD_REST.rot[2] + swing * 0.6;
  swordViewModel.position.z = SWORD_REST.pos[2] - swing * 0.15;
  playerParts.armPivotR.rotation.x = -swing * 1.6;

  playerBody.position.set(playerRig.position.x, playerRig.position.y - EYE_HEIGHT, playerRig.position.z);
  const euler = new THREE.Euler().setFromQuaternion(playerRig.quaternion, 'YXZ');
  playerBody.rotation.y = euler.y;
}

// --- zombies ---
function buildZombieMesh() {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x2e6b3e, emissive: 0x000000 });
  const clothes = new THREE.MeshLambertMaterial({ color: 0x35424a, emissive: 0x000000 });
  const eyeMat = new THREE.MeshBasicMaterial({ color: 0xc8ff3c });
  const mouthMat = new THREE.MeshLambertMaterial({ color: 0x2a1414 });

  const legGeo = new THREE.BoxGeometry(0.28, 0.8, 0.28);
  const legL = new THREE.Mesh(legGeo, clothes);
  legL.position.set(-0.15, 0.4, 0);
  const legR = new THREE.Mesh(legGeo, clothes);
  legR.position.set(0.15, 0.4, 0);

  const torsoGeo = new THREE.BoxGeometry(0.6, 0.75, 0.35);
  const torso = new THREE.Mesh(torsoGeo, clothes);
  torso.position.set(0, 1.175, 0);

  const armGeo = new THREE.BoxGeometry(0.25, 0.7, 0.25);
  const armL = new THREE.Mesh(armGeo, skin);
  armL.position.set(-0.42, 1.15, 0);
  const armR = new THREE.Mesh(armGeo, skin);
  armR.position.set(0.42, 1.15, 0);

  const headGeo = new THREE.BoxGeometry(0.42, 0.42, 0.42);
  const head = new THREE.Mesh(headGeo, skin);
  head.position.set(0, 1.78, 0);

  const eyeGeo = new THREE.BoxGeometry(0.07, 0.07, 0.03);
  const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
  eyeL.position.set(-0.11, 1.82, -0.21);
  const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
  eyeR.position.set(0.11, 1.82, -0.21);

  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.03), mouthMat);
  mouth.position.set(0, 1.68, -0.21);

  group.add(legL, legR, torso, armL, armR, head, eyeL, eyeR, mouth);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

class Zombie {
  constructor(x, z) {
    this.x = x;
    this.z = z;
    this.y = groundHeight(x, z);
    this.hp = 100;
    this.speed = 1.5 + Math.random() * 0.6;
    this.attackCooldown = 0;
    this.group = buildZombieMesh();
    this.group.position.set(this.x, this.y, this.z);
    scene.add(this.group);
  }
  update(delta, playerPos) {
    const dx = playerPos.x - this.x, dz = playerPos.z - this.z;
    const distSq = dx * dx + dz * dz;
    if (distSq < AGGRO_RANGE * AGGRO_RANGE && distSq > 0.25) {
      const dist = Math.sqrt(distSq);
      const nx = dx / dist, nz = dz / dist;
      this.x += nx * this.speed * delta;
      this.z += nz * this.speed * delta;
      this.group.rotation.y = Math.atan2(nx, nz);
    }
    this.x = clamp(this.x, 1, WORLD_SIZE - 2);
    this.z = clamp(this.z, 1, WORLD_SIZE - 2);
    this.y = groundHeight(this.x, this.z);
    this.group.position.set(this.x, this.y, this.z);

    if (this.attackCooldown > 0) this.attackCooldown -= delta;
    const distToPlayer = Math.hypot(playerPos.x - this.x, playerPos.z - this.z);
    if (distToPlayer < ATTACK_RANGE && this.attackCooldown <= 0) {
      damagePlayer(12);
      this.attackCooldown = 1.1;
    }
  }
  takeDamage(dmg) {
    this.hp -= dmg;
    this.group.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(0xff0000); });
    setTimeout(() => {
      this.group.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(0x000000); });
    }, 120);
    return this.hp <= 0;
  }
  dispose() { scene.remove(this.group); }
}

const zombies = [];

function randomZombieSpot(minDistFromPlayer) {
  for (let i = 0; i < 30; i++) {
    const x = 2 + Math.random() * (WORLD_SIZE - 4);
    const z = 2 + Math.random() * (WORLD_SIZE - 4);
    if (Math.hypot(x - playerRig.position.x, z - playerRig.position.z) >= minDistFromPlayer) return [x, z];
  }
  return [WORLD_SIZE / 2 + 5, WORLD_SIZE / 2 + 5];
}

function spawnRandomZombie() {
  if (zombies.length >= MAX_ZOMBIES || gameOver) return;
  const [x, z] = randomZombieSpot(10);
  zombies.push(new Zombie(x, z));
}

function spawnInitialZombies() {
  for (let i = 0; i < 6; i++) spawnRandomZombie();
}

function getTargetEntity() {
  const lookDir = playerLookDir();
  const origin = playerRig.position;
  let best = null, bestKind = null, bestDist = Infinity;
  const consider = (e, kind, headOffset) => {
    const toE = new THREE.Vector3(e.x - origin.x, e.y + headOffset - origin.y, e.z - origin.z);
    const dist = toE.length();
    if (dist > ATTACK_REACH) return;
    toE.normalize();
    const angle = lookDir.angleTo(toE);
    if (angle < 0.3 && dist < bestDist) {
      bestDist = dist;
      best = e;
      bestKind = kind;
    }
  };
  for (const z of zombies) consider(z, 'zombie', 1);
  for (const p of pigs) consider(p, 'pig', 0.4);
  return best ? { entity: best, kind: bestKind } : null;
}

function attackZombie(z) {
  const dead = z.takeDamage(34);
  if (dead) {
    z.dispose();
    zombies.splice(zombies.indexOf(z), 1);
    kills++;
    killsValueEl.textContent = kills;
    setTimeout(spawnRandomZombie, 4000);
  }
}

let zombieSpawnTimer = 0;

// --- pigs ---
function buildPigMesh() {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0xf0a6b8 });
  const snoutMat = new THREE.MeshLambertMaterial({ color: 0xd9829a });

  const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.9), skin);
  body.position.set(0, 0.5, 0);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.36, 0.38), skin);
  head.position.set(0, 0.56, -0.58);
  const snout = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.16, 0.08), snoutMat);
  snout.position.set(0, 0.5, -0.79);

  const legGeo = new THREE.BoxGeometry(0.15, 0.3, 0.15);
  const legPositions = [[-0.18, 0.15, -0.32], [0.18, 0.15, -0.32], [-0.18, 0.15, 0.32], [0.18, 0.15, 0.32]];
  const legs = legPositions.map((p) => {
    const l = new THREE.Mesh(legGeo, skin);
    l.position.set(p[0], p[1], p[2]);
    return l;
  });

  group.add(body, head, snout, ...legs);
  group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return group;
}

class Pig {
  constructor(x, z) {
    this.x = x;
    this.z = z;
    this.y = groundHeight(x, z);
    this.hp = 60;
    this.speed = 0.9 + Math.random() * 0.5;
    this.wanderDir = Math.random() * Math.PI * 2;
    this.wanderTimer = 1 + Math.random() * 4;
    this.moving = false;
    this.group = buildPigMesh();
    this.group.position.set(this.x, this.y, this.z);
    this.group.rotation.y = this.wanderDir;
    scene.add(this.group);
  }
  update(delta) {
    this.wanderTimer -= delta;
    if (this.wanderTimer <= 0) {
      this.wanderDir = Math.random() * Math.PI * 2;
      this.wanderTimer = 1.5 + Math.random() * 4;
      this.moving = Math.random() < 0.6;
      this.group.rotation.y = this.wanderDir;
    }
    if (this.moving) {
      this.x += Math.sin(this.wanderDir) * this.speed * delta;
      this.z += Math.cos(this.wanderDir) * this.speed * delta;
    }
    this.x = clamp(this.x, 1, WORLD_SIZE - 2);
    this.z = clamp(this.z, 1, WORLD_SIZE - 2);
    this.y = groundHeight(this.x, this.z);
    this.group.position.set(this.x, this.y, this.z);
  }
  takeDamage(dmg) {
    this.hp -= dmg;
    this.group.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(0xff0000); });
    setTimeout(() => {
      this.group.traverse((o) => { if (o.isMesh && o.material.emissive) o.material.emissive.setHex(0x000000); });
    }, 120);
    return this.hp <= 0;
  }
  dispose() { scene.remove(this.group); }
}

const pigs = [];

function randomPigSpot() {
  for (let i = 0; i < 30; i++) {
    const x = 2 + Math.random() * (WORLD_SIZE - 4);
    const z = 2 + Math.random() * (WORLD_SIZE - 4);
    if (Math.hypot(x - playerRig.position.x, z - playerRig.position.z) >= 5) return [x, z];
  }
  return [WORLD_SIZE / 2 + 5, WORLD_SIZE / 2 - 5];
}

function spawnRandomPig() {
  if (pigs.length >= MAX_PIGS || gameOver) return;
  const [x, z] = randomPigSpot();
  pigs.push(new Pig(x, z));
}

function spawnInitialPigs() {
  for (let i = 0; i < 5; i++) spawnRandomPig();
}

// --- meat pickups ---
const pickupMat = new THREE.MeshLambertMaterial({ color: 0xb5453a });
const pickups = [];

function spawnMeatPickup(x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), pickupMat);
  mesh.castShadow = true;
  mesh.position.set(x + (Math.random() - 0.5) * 0.4, y + 0.35, z + (Math.random() - 0.5) * 0.4);
  scene.add(mesh);
  pickups.push({ mesh, baseY: mesh.position.y, phase: Math.random() * Math.PI * 2 });
}

function updatePickups(delta, playerPos) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.phase += delta * 3;
    p.mesh.position.y = p.baseY + Math.sin(p.phase) * 0.08;
    p.mesh.rotation.y += delta * 1.5;
    const dist = Math.hypot(p.mesh.position.x - playerPos.x, p.mesh.position.z - playerPos.z);
    if (dist < 1.0 && Math.abs(p.mesh.position.y - (playerPos.y - EYE_HEIGHT)) < 2) {
      scene.remove(p.mesh);
      pickups.splice(i, 1);
      meat++;
      updateMeatUI();
    }
  }
}

function attackPig(p) {
  const dead = p.takeDamage(34);
  if (dead) {
    p.dispose();
    pigs.splice(pigs.indexOf(p), 1);
    const dropCount = 1 + (Math.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < dropCount; i++) spawnMeatPickup(p.x, p.y, p.z);
    setTimeout(spawnRandomPig, 5000);
  }
}

// --- main loop ---
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  if (controls.isLocked && !gameOver) {
    updatePlayer(delta);
    updateHunger(delta);
    updateSky(delta, playerRig.position);
    updateClouds(delta);
    for (const z of zombies) z.update(delta, playerRig.position);
    for (const p of pigs) p.update(delta);
    updatePickups(delta, playerRig.position);
    zombieSpawnTimer += delta;
    if (zombieSpawnTimer > 8) {
      zombieSpawnTimer = 0;
      spawnRandomZombie();
    }
  }

  syncCamera();
  renderer.render(scene, camera);
}

generateWorld();
rebuildWorldMesh();
spawnPlayer();
spawnInitialZombies();
spawnInitialPigs();
animate();
