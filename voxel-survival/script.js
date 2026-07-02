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

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.Fog(0x87ceeb, 28, 85);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);

const ambient = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambient);
const sun = new THREE.DirectionalLight(0xffffff, 0.85);
sun.position.set(40, 60, 20);
scene.add(sun);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

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
      const startIndex = buf.count;
      for (const c of face.corners) {
        buf.positions.push(x + c[0], y + c[1], z + c[2]);
        buf.normals.push(face.dir[0], face.dir[1], face.dir[2]);
        buf.colors.push(col.r, col.g, col.b);
      }
      buf.indices.push(startIndex, startIndex + 1, startIndex + 2, startIndex, startIndex + 2, startIndex + 3);
      buf.count += 4;
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
    scene.add(mesh);
    worldMeshes[type] = mesh;
  }
}

// --- player / controls ---
const controls = new PointerLockControls(camera, renderer.domElement);
scene.add(controls.getObject());

const blocker = document.getElementById('blocker');
const startBtn = document.getElementById('startBtn');
const deathScreen = document.getElementById('deathScreen');
const deathStats = document.getElementById('deathStats');
const respawnBtn = document.getElementById('respawnBtn');
const healthBar = document.getElementById('healthBar');
const killsValueEl = document.getElementById('killsValue');
const hitFlash = document.getElementById('hitFlash');

let playerHP = 100;
let kills = 0;
let gameOver = false;
let verticalVelocity = 0;
let onGround = true;

const keys = {};
document.addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space') jump();
  if (e.code >= 'Digit1' && e.code <= 'Digit5') selectSlot(Number(e.code.slice(-1)) - 1);
});
document.addEventListener('keyup', (e) => { keys[e.code] = false; });

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
  camera.position.set(cx, groundHeight(cx, cz) + EYE_HEIGHT, cz);
  verticalVelocity = 0;
  onGround = true;
}

function isHorizontallyBlocked(x, z) {
  const feetY = camera.position.y - EYE_HEIGHT;
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

  const prevX = camera.position.x, prevZ = camera.position.z;
  controls.moveForward(forward * speed);
  controls.moveRight(strafe * speed);
  camera.position.x = clamp(camera.position.x, 1, WORLD_SIZE - 2);
  camera.position.z = clamp(camera.position.z, 1, WORLD_SIZE - 2);
  if (isHorizontallyBlocked(camera.position.x, prevZ)) camera.position.x = prevX;
  if (isHorizontallyBlocked(camera.position.x, camera.position.z)) camera.position.z = prevZ;

  const ground = groundHeight(camera.position.x, camera.position.z);
  if (!onGround) verticalVelocity -= GRAVITY * delta;
  let feetY = (camera.position.y - EYE_HEIGHT) + verticalVelocity * delta;
  if (feetY <= ground) {
    feetY = ground;
    verticalVelocity = 0;
    onGround = true;
  } else {
    onGround = false;
  }
  camera.position.y = feetY + EYE_HEIGHT;
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
function raycastBlock(maxDist = 6, step = 0.04) {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const origin = camera.position.clone();
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
    const target = getTargetZombie();
    if (target) {
      attackZombie(target);
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
      const feetY = Math.floor(camera.position.y - EYE_HEIGHT);
      const headY = Math.floor(camera.position.y);
      const inPlayer = Math.floor(camera.position.x) === x && Math.floor(camera.position.z) === z && (y === feetY || y === headY);
      if (!inPlayer) {
        setBlock(x, y, z, selectedBlockType);
        rebuildWorldMesh();
      }
    }
  }
});

// --- zombies ---
function buildZombieMesh() {
  const group = new THREE.Group();
  const skin = new THREE.MeshLambertMaterial({ color: 0x2e6b3e, emissive: 0x000000 });
  const clothes = new THREE.MeshLambertMaterial({ color: 0x35424a, emissive: 0x000000 });

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

  group.add(legL, legR, torso, armL, armR, head);
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
    this.group.traverse((o) => { if (o.isMesh) o.material.emissive.setHex(0xff0000); });
    setTimeout(() => {
      this.group.traverse((o) => { if (o.isMesh) o.material.emissive.setHex(0x000000); });
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
    if (Math.hypot(x - camera.position.x, z - camera.position.z) >= minDistFromPlayer) return [x, z];
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

function getTargetZombie() {
  const camDir = new THREE.Vector3();
  camera.getWorldDirection(camDir);
  let best = null, bestDist = Infinity;
  for (const z of zombies) {
    const toZ = new THREE.Vector3(z.x - camera.position.x, z.y + 1 - camera.position.y, z.z - camera.position.z);
    const dist = toZ.length();
    if (dist > ATTACK_REACH) continue;
    toZ.normalize();
    const angle = camDir.angleTo(toZ);
    if (angle < 0.3 && dist < bestDist) {
      bestDist = dist;
      best = z;
    }
  }
  return best;
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

// --- main loop ---
const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.1);

  if (controls.isLocked && !gameOver) {
    updatePlayer(delta);
    for (const z of zombies) z.update(delta, camera.position);
    zombieSpawnTimer += delta;
    if (zombieSpawnTimer > 8) {
      zombieSpawnTimer = 0;
      spawnRandomZombie();
    }
  }

  renderer.render(scene, camera);
}

generateWorld();
rebuildWorldMesh();
spawnPlayer();
spawnInitialZombies();
animate();
