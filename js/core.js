// Engine core: renderer, scene, camera, lights, collision world, shared state.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const $ = id => document.getElementById(id);
export const V3 = THREE.Vector3;
export const rand = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
export const pick = arr => arr[(Math.random() * arr.length) | 0];
export const TEST = location.search.includes('test');

// Seeded random for world layout, so every player gets the same town.
let seed = 0x2b0f1e;
export function wr(a = 0, b = 1) {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return a + (((t ^ (t >>> 14)) >>> 0) / 4294967296) * (b - a);
}

// Shared game state. mode: solo | host | guest. story: solo | coop.
export const S = {
  state: 'title', mode: 'solo', story: 'solo', paused: false, phase: 'intro', time: 0, kills: 0, shots: 0, hits: 0,
  fuses: 0, notes: 0, walkie: false, sean: false, holdT: 0, HOLD: 60, flareCd: 0, flareFx: 0, blackout: 0,
  lightT: 14, light: 0, lightSeq: [0], spawnT: 6, hitstop: 0, slowmo: 0, escT: 0, grave: false, heliPos: new THREE.Vector3(),
};
export const INPUT = { keys: {}, mouseL: false, mouseR: false };

// ---------------------------------------------------------------- renderer
export const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
$('game').appendChild(renderer.domElement);
export const canvas = renderer.domElement;

export const scene = new THREE.Scene();
const FOG = 0x07090d;
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.FogExp2(FOG, 0.04);
export const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 500);
camera.rotation.order = 'YXZ';

export const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ---------------------------------------------------------------- lights (count stays constant so shaders never recompile)
export const hemi = new THREE.HemisphereLight(0x3d4c6a, 0x0c0a08, 0.55); scene.add(hemi);
export const moon = new THREE.DirectionalLight(0x8090c0, 0.35); moon.position.set(-60, 90, -40); scene.add(moon);
// your flashlight (casts shadows)
export const flash = new THREE.SpotLight(0xfff0d6, 95, 50, 0.46, 0.55, 1.2);
flash.castShadow = true; flash.shadow.mapSize.set(1024, 1024);
flash.shadow.camera.near = 0.5; flash.shadow.camera.far = 50; flash.shadow.bias = -0.0008;
scene.add(flash, flash.target);
// your partner's flashlight
export const flash2 = new THREE.SpotLight(0xfff4e0, 0, 40, 0.42, 0.6, 1.25); scene.add(flash2, flash2.target);
export const muzzleLight = new THREE.PointLight(0xffa860, 0, 18, 1.5); scene.add(muzzleLight);
export const fill = new THREE.PointLight(0x9aa8c8, 14, 8, 1.4); scene.add(fill); // over-the-shoulder fill so you read in the dark
export const carSpot = new THREE.SpotLight(0xfff4dc, 70, 45, 0.38, 0.6, 1.2); scene.add(carSpot, carSpot.target);
export const dynLights = [];
export function worldLight(color, intensity, dist, x, y, z, kind) {
  const l = new THREE.PointLight(color, intensity, dist, 1.3); l.position.set(x, y, z); scene.add(l);
  dynLights.push({ l, base: intensity, kind, t: wr(0, 9) }); return l;
}

// ---------------------------------------------------------------- helpers
export function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export function textTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
export function speckle(g, w, h, n, cols, smin = 1, smax = 3) {
  for (let i = 0; i < n; i++) { g.fillStyle = pick(cols); const s = rand(smin, smax); g.fillRect(rand(0, w), rand(0, h), s, s); }
}
export function M(color, o = {}) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.85 }, o)); }
export function glow(r, g, b, fog = false) { const m = new THREE.MeshBasicMaterial({ fog }); m.color.setRGB(r, g, b); return m; }
export function mesh(geo, mat, x = 0, y = 0, z = 0, parent = scene, cast = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; parent.add(m); return m;
}
export const BOX = (w, h, d) => new THREE.BoxGeometry(w, h, d);

// ---------------------------------------------------------------- collision world
export const colliders = [];
export const occluders = [];
export function addBox(cx, cz, w, d) { colliders.push({ b: 1, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 }); }
export function addCircle(x, z, r) { colliders.push({ b: 0, x, z, r }); }
export function blocked(x, z, r) {
  for (const c of colliders) {
    if (c.b) { if (x > c.minX - r && x < c.maxX + r && z > c.minZ - r && z < c.maxZ + r) return true; }
    else { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < (r + c.r) ** 2) return true; }
  }
  return false;
}
export function resolve(p, r) {
  for (const c of colliders) {
    if (c.b) {
      if (p.x < c.minX - r || p.x > c.maxX + r || p.z < c.minZ - r || p.z > c.maxZ + r) continue;
      const cx = clamp(p.x, c.minX, c.maxX), cz = clamp(p.z, c.minZ, c.maxZ);
      const dx = p.x - cx, dz = p.z - cz, d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-8) { const d = Math.sqrt(d2); p.x = cx + dx / d * r; p.z = cz + dz / d * r; }
      else {
        const l = p.x - c.minX, rr = c.maxX - p.x, t = p.z - c.minZ, b = c.maxZ - p.z, m = Math.min(l, rr, t, b);
        if (m === l) p.x = c.minX - r; else if (m === rr) p.x = c.maxX + r; else if (m === t) p.z = c.minZ - r; else p.z = c.maxZ + r;
      }
    } else {
      const dx = p.x - c.x, dz = p.z - c.z, d2 = dx * dx + dz * dz, R = r + c.r;
      if (d2 < R * R && d2 > 1e-8) { const d = Math.sqrt(d2); p.x = c.x + dx / d * R; p.z = c.z + dz / d * R; }
    }
  }
  const d = Math.hypot(p.x, p.z); if (d > 93) { p.x *= 93 / d; p.z *= 93 / d; }
}
const raycaster = new THREE.Raycaster();
export function rayBlock(o, d, far) { raycaster.set(o, d); raycaster.far = far; const h = raycaster.intersectObjects(occluders, false); return h.length ? h[0] : null; }
