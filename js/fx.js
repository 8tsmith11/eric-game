// Particles, blood pools, bullet tracers, muzzle flashes.
import * as THREE from 'three';
import { V3, rand, scene, M, glow, BOX, textTex } from './core.js';

const PART_GEO = BOX(1, 1, 1);
export const PM = {
  blood: M(0x4d0303, { roughness: 0.4 }), spark: glow(4, 2.6, 1, false), dust: M(0x3c362c), shell: M(0xa52219, { metalness: 0.3 }),
  brass: M(0xc9a24a, { metalness: 0.8, roughness: 0.3 }), ember: glow(5, 2, 0.5, false),
};
const parts = [];
for (let i = 0; i < 380; i++) { const m = new THREE.Mesh(PART_GEO, PM.blood); m.visible = false; scene.add(m); parts.push({ m, v: new V3(), life: 0, grav: 1 }); }
let pIdx = 0;
export function emit(pos, n, mat, spd, size, life, o = {}) {
  for (let i = 0; i < n; i++) {
    const p = parts[pIdx++ % parts.length];
    p.m.material = mat; p.m.visible = true; p.m.position.copy(pos);
    p.m.scale.setScalar(size * rand(0.6, 1.4));
    p.v.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).normalize().multiplyScalar(spd * rand(0.3, 1));
    if (o.dir) p.v.addScaledVector(o.dir, spd * 0.7);
    p.life = life * rand(0.6, 1.2); p.grav = o.grav ?? 1;
  }
}
const pools = [];
const poolGeo = new THREE.CircleGeometry(1, 14);
export function bloodPool(pos, s = 1) {
  let p = pools.length >= 40 ? pools.shift() : null;
  if (!p) { p = new THREE.Mesh(poolGeo, new THREE.MeshStandardMaterial({ color: 0x2a0000, roughness: 0.15, transparent: true, depthWrite: false })); p.rotation.x = -Math.PI / 2; scene.add(p); }
  p.position.set(pos.x + rand(-0.3, 0.3), 0.015 + Math.random() * 0.004, pos.z + rand(-0.3, 0.3)); p.scale.setScalar(0.01); p.userData.target = rand(0.6, 1.1) * s; p.material.opacity = 0.9;
  pools.push(p);
}
const tracers = [];
for (let i = 0; i < 32; i++) {
  const m = new THREE.Mesh(PART_GEO, new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, fog: false, depthWrite: false }));
  m.visible = false; scene.add(m); tracers.push({ m, life: 0 });
}
let tIdx = 0;
export function tracer(a, b, w = 0.02) {
  const t = tracers[tIdx++ % tracers.length]; const len = a.distanceTo(b);
  t.m.position.copy(a).lerp(b, 0.5); t.m.lookAt(b); t.m.scale.set(w, w, len); t.m.visible = true; t.m.material.opacity = 0.85; t.life = 0.07;
}
const flareTex = textTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(0.25, 'rgba(255,170,70,.8)'); gr.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(255,220,160,.8)'; g.lineWidth = 3;
  for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; g.beginPath(); g.moveTo(64, 64); g.lineTo(64 + Math.cos(a) * 62, 64 + Math.sin(a) * 62); g.stroke(); }
});
function makeFlashSprite() { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: flareTex, blending: THREE.AdditiveBlending, fog: false, depthWrite: false, transparent: true })); s.visible = false; scene.add(s); s.userData.t = 0; return s; }
export const eFlash = makeFlashSprite(), sFlash = makeFlashSprite();
export function showFlash(s, pos, size) { s.position.copy(pos); s.scale.setScalar(size * rand(0.8, 1.2)); s.material.rotation = rand(0, 6); s.visible = true; s.userData.t = 0.05; }

export function updateFx(dt, rdt) {
  for (const p of parts) {
    if (!p.m.visible) continue;
    p.life -= dt; if (p.life <= 0) { p.m.visible = false; continue; }
    p.v.y -= 9.8 * p.grav * dt; p.m.position.addScaledVector(p.v, dt);
    if (p.m.position.y < 0.02) { p.m.position.y = 0.02; p.v.multiplyScalar(0.2); p.v.y = 0; }
    p.m.rotation.x += dt * 6; p.m.rotation.z += dt * 4;
  }
  for (const p of pools) if (p.scale.x < p.userData.target) p.scale.setScalar(Math.min(p.userData.target, p.scale.x + rdt * 0.6));
  for (const t of tracers) if (t.life > 0) { t.life -= rdt; t.m.material.opacity = Math.max(0, t.life / 0.07) * 0.85; if (t.life <= 0) t.m.visible = false; }
  for (const s of [eFlash, sFlash]) if (s.userData.t > 0) { s.userData.t -= rdt; if (s.userData.t <= 0) s.visible = false; }
}
