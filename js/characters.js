// People, monsters and guns, all built from primitives.
import * as THREE from 'three';
import { rand, canvasTex, M, glow, mesh, BOX } from './core.js';

const CLAW_GEO = new THREE.ConeGeometry(0.012, 0.11, 4); CLAW_GEO.rotateX(Math.PI);
const CLAW_MAT = M(0x15100c, { roughness: 0.4 });
const MOUTH = M(0x080000, { roughness: 1 });

export function buildPerson(o) {
  const cast = o.cast !== false, al = o.armLen || 1;
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const body = new THREE.Group(); root.add(body);
  const B = (w, h, d, mat, x, y, z, par) => mesh(BOX(w, h, d), mat, x, y, z, par, cast);
  B(0.34, 0.2, 0.2, o.pants, 0, 0.97, 0, body);
  const chest = new THREE.Group(); chest.position.y = 1.03; body.add(chest);
  B(0.4, 0.56, 0.23, o.top, 0, 0.29, 0, chest);
  if (o.collar) B(0.36, 0.09, 0.25, o.collar, 0, 0.56, 0, chest);
  if (o.shirt) B(0.1, 0.3, 0.02, o.shirt, 0, 0.36, 0.118, chest);
  mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.1, 8), o.skin, 0, 0.61, 0, chest, cast);
  const head = new THREE.Group(); head.position.y = 0.66; chest.add(head);
  mesh(new THREE.SphereGeometry(0.12, 16, 12), o.skin, 0, 0.1, 0, head, cast).scale.set(0.9, 1.12, 1);
  B(0.028, 0.05, 0.04, o.skin, 0, 0.085, 0.115, head);
  for (const s of [-1, 1]) {
    mesh(new THREE.SphereGeometry(0.03, 6, 6), o.skin, s * 0.106, 0.09, 0, head, cast).scale.set(0.45, 1, 0.8);
    mesh(new THREE.SphereGeometry(o.eyeR || 0.016, 8, 6), o.eye, s * 0.042, 0.115, 0.098, head, false);
    if (o.hairMat) B(0.05, 0.013, 0.015, o.hairMat, s * 0.044, 0.148, 0.106, head);
  }
  let jaw = null;
  if (o.mouth) jaw = B(o.mouthW || 0.08, o.mouthH || 0.03, 0.02, MOUTH, 0, 0.035, 0.112, head);
  if (o.hairMat) {
    // short curly hair: little icosahedron curls spread over the top and back of the skull
    const cg = new THREE.IcosahedronGeometry(0.043 * (o.curl || 1), 0);
    const N = o.hairN || 60;
    for (let i = 0; i < N; i++) {
      const u = (i + 0.5) / N, phi = Math.acos(1 - u * 1.2), th = i * 2.39996;
      const x = Math.sin(phi) * Math.cos(th), y = Math.cos(phi), z = Math.sin(phi) * Math.sin(th);
      if (z > 0.3 && y < 0.62) continue;
      if (y < 0.05 && Math.abs(x) > 0.6 && z > -0.5) continue;
      const c = mesh(cg, o.hairMat, x * 0.112, 0.11 + y * 0.135, z * 0.122, head, cast);
      c.rotation.set(rand(0, 3), rand(0, 3), 0); c.scale.setScalar(rand(0.8, 1.25));
    }
  }
  const arms = [];
  for (const s of [-1, 1]) {
    const sh = new THREE.Group(); sh.position.set(s * 0.255, 0.5, 0); chest.add(sh);
    B(0.11, 0.3 * al, 0.11, o.sleeve || o.top, 0, -0.15 * al, 0, sh);
    const el = new THREE.Group(); el.position.y = -0.3 * al; sh.add(el);
    B(0.095, 0.27 * al, 0.095, o.forearm || o.sleeve || o.top, 0, -0.135 * al, 0, el);
    B(0.08, 0.09, 0.06, o.skin, 0, -0.27 * al - 0.045, 0, el);
    if (o.claws) for (const c of [-1, 0, 1]) mesh(CLAW_GEO, CLAW_MAT, c * 0.025, -0.27 * al - 0.14, 0.01, el, false);
    arms.push({ sh, el });
  }
  const legs = [];
  for (const s of [-1, 1]) {
    const hip = new THREE.Group(); hip.position.set(s * 0.1, 0.92, 0); body.add(hip);
    B(0.15, 0.45, 0.16, o.pants, 0, -0.225, 0, hip);
    const kn = new THREE.Group(); kn.position.y = -0.45; hip.add(kn);
    B(0.125, 0.42, 0.135, o.pants, 0, -0.21, 0, kn);
    B(0.13, 0.08, 0.25, o.shoe, 0, -0.43, 0.045, kn);
    legs.push({ hip, kn });
  }
  root.scale.setScalar(o.scale || 1);
  return { root, body, chest, head, jaw, arms, legs };
}

export function animWalk(p, ph, amp, arms = true) {
  for (let i = 0; i < 2; i++) {
    const o = i ? Math.PI : 0, a = Math.sin(ph + o);
    p.legs[i].hip.rotation.x = a * 0.62 * amp;
    p.legs[i].kn.rotation.x = Math.max(0, -Math.cos(ph + o)) * 1.1 * amp + 0.04;
    if (arms) { p.arms[i].sh.rotation.set(-a * 0.5 * amp, 0, 0); p.arms[i].el.rotation.x = -0.2 * amp - 0.1; }
  }
  p.body.position.y = -Math.abs(Math.sin(ph)) * 0.035 * amp;
}

// lying on the ground, waiting for a hand up
export function poseDown(pp, t) {
  pp.root.rotation.x = 0; pp.body.position.y = -0.62; pp.chest.rotation.x = -0.9; pp.chest.rotation.z = 0;
  pp.legs.forEach((l, i) => { l.hip.rotation.x = -1.5; l.kn.rotation.x = 0.2 + i * 0.4; });
  pp.arms[0].sh.rotation.set(-0.3, 0, 0.3); pp.arms[1].sh.rotation.set(-1.2 + Math.sin(t * 1.5) * 0.15, 0, -0.2);
  pp.head.rotation.x = -0.3 + Math.sin(t * 2) * 0.05;
}

const plaidTex = canvasTex(128, 128, (g, w, h) => {
  g.fillStyle = '#7d1d1b'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(15,10,10,.65)';
  for (let i = 0; i < w; i += 32) { g.fillRect(i, 0, 12, h); g.fillRect(0, i, w, 12); }
  g.fillStyle = 'rgba(230,200,170,.25)'; for (let i = 16; i < w; i += 32) { g.fillRect(i + 8, 0, 2, h); g.fillRect(0, i + 8, w, 2); }
}, 2, 2);

// Eric Kosoy: medium height, short curly black hair, olive field jacket
export const ERIC_LOOK = {
  skin: M(0xe4b79d, { roughness: 0.7 }), top: M(0x313b2b, { roughness: 0.92 }), collar: M(0x283023), shirt: M(0x16181a),
  pants: M(0x1c2333, { roughness: 0.9 }), shoe: M(0x15110e), hairMat: M(0x0c0a09, { roughness: 1 }), curl: 1, hairN: 64, eye: M(0x2b1a10),
};
// Sean Perrius: curly blond hair, red flannel
export const SEAN_LOOK = {
  skin: M(0xefc4aa, { roughness: 0.7 }), top: M(0xffffff, { map: plaidTex, roughness: 0.95 }), collar: M(0x5a1515), shirt: M(0xd8d2c4),
  pants: M(0x34445e, { roughness: 0.9 }), shoe: M(0x3c2b1d), hairMat: M(0xe6c164, { roughness: 0.9 }), curl: 1.2, hairN: 74, eye: M(0x2a3b4c),
};
// The Other Eric: Eric, but wrong
export const OTHER_LOOK = {
  skin: M(0xbdb8b0, { roughness: 0.6 }), top: M(0x1f261c, { roughness: 1 }), collar: M(0x161a13), pants: M(0x12161f), shoe: M(0x0a0806),
  hairMat: M(0x060505, { roughness: 1 }), curl: 1, hairN: 64, eye: glow(3.5, 3.5, 3.8), eyeR: 0.02,
};
const EM = {
  skin: M(0x7e7a72, { roughness: 0.95 }), skin2: M(0x5b564e, { roughness: 0.95 }), rag: M(0x221e1a, { roughness: 1 }), rag2: M(0x2d251f, { roughness: 1 }),
  eyeR: glow(3.2, 0.2, 0.05), eyeY: glow(2.8, 2.1, 0.25),
};
export function buildMonster(type, scale) {
  if (type === 'boss') return buildPerson({ ...OTHER_LOOK, armLen: 1.75, claws: true, mouth: true, mouthW: 0.1, mouthH: 0.06, scale, cast: true });
  const runner = type === 'runner';
  return buildPerson({ skin: runner ? EM.skin2 : EM.skin, top: EM.rag, pants: EM.rag2, shoe: EM.rag, eye: runner ? EM.eyeY : EM.eyeR, eyeR: 0.02,
    armLen: runner ? 1.25 : 1.38, claws: true, mouth: true, mouthH: 0.05, scale });
}

export function buildShotgun() {
  const g = new THREE.Group();
  const metal = M(0x1d1e21, { metalness: 0.75, roughness: 0.35 }), wood = M(0x4a2a17, { roughness: 0.6 });
  mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.62, 8), metal, 0, 0.03, 0.42, g, false).rotation.x = Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.46, 8), metal, 0, -0.005, 0.36, g, false).rotation.x = Math.PI / 2;
  const pump = mesh(BOX(0.05, 0.05, 0.17), wood, 0, -0.005, 0.38, g, false);
  mesh(BOX(0.055, 0.09, 0.26), metal, 0, 0.01, 0.03, g, false);
  mesh(BOX(0.045, 0.1, 0.3), wood, 0, -0.035, -0.24, g, false).rotation.x = -0.15;
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, 0.76); g.add(muzzle);
  return { g, pump, muzzle };
}
export function buildPistol() {
  const g = new THREE.Group(); const m = M(0x18191b, { metalness: 0.7, roughness: 0.4 });
  mesh(BOX(0.04, 0.05, 0.2), m, 0, 0.02, 0.06, g, false); mesh(BOX(0.035, 0.1, 0.05), m, 0, -0.04, -0.01, g, false);
  const muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.02, 0.17); g.add(muzzle);
  return { g, pump: null, muzzle };
}
