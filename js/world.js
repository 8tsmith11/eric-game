// Hollow Creek: terrain, buildings, landmarks, weather, flickering lights.
// Layout uses the seeded wr() so host and guest build the identical town.
import * as THREE from 'three';
import {
  V3, rand, clamp, lerp, wrapA, pick, wr, S, scene, camera, hemi, moon, carSpot, dynLights, worldLight,
  canvasTex, textTex, speckle, M, glow, mesh, BOX, addBox, addCircle, occluders, $,
} from './core.js';
import { SFX } from './audio.js';

// ---------------------------------------------------------------- textures & materials
const groundTex = canvasTex(512, 512, (g, w, h) => {
  g.fillStyle = '#1a1e14'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 14000, ['#232a18', '#151910', '#2a2617', '#1e2416', '#2f2a1c', '#121510'], 1, 4);
}, 70, 70);
const roadTex = canvasTex(256, 512, (g, w, h) => {
  g.fillStyle = '#19191b'; g.fillRect(0, 0, w, h);
  speckle(g, w, h, 9000, ['#222224', '#141416', '#2a2a2c', '#101011'], 1, 3);
  g.fillStyle = 'rgba(190,160,70,.55)'; g.fillRect(w / 2 - 4, 0, 8, h * 0.45);
  g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 2;
  for (let i = 0; i < 8; i++) { g.beginPath(); let x = rand(0, w), y = rand(0, h); g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += rand(-20, 20); y += rand(-30, 30); g.lineTo(x, y); } g.stroke(); }
}, 1, 26);
export const sidingTex = canvasTex(256, 256, (g, w, h) => {
  g.fillStyle = '#9a9a9a'; g.fillRect(0, 0, w, h);
  for (let y = 0; y < h; y += 16) { g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(255,255,255,.08)'; g.fillRect(0, y + 2, w, 1); }
  for (let i = 0; i < 40; i++) { g.fillStyle = 'rgba(30,25,15,.12)'; g.fillRect(rand(0, w), rand(h * .4, h), rand(4, 20), rand(20, 120)); }
  speckle(g, w, h, 2500, ['rgba(0,0,0,.2)', 'rgba(60,50,30,.2)'], 1, 2);
}, 2, 1);
const stoneTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#6c6a66'; g.fillRect(0, 0, w, h); speckle(g, w, h, 3000, ['#5a5854', '#7a7873', '#4c4a47'], 1, 3); });
const barkTex = canvasTex(64, 256, (g, w, h) => { g.fillStyle = '#2c2219'; g.fillRect(0, 0, w, h); for (let i = 0; i < 40; i++) { g.fillStyle = pick(['#1c150f', '#3a2c20']); g.fillRect(rand(0, w), 0, rand(1, 4), h); } }, 1, 2);
const dirtTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#2b2419'; g.fillRect(0, 0, w, h); speckle(g, w, h, 2500, ['#3a3022', '#1f1a12', '#33291b']); }, 12, 1);

const litWin = M(0x111111, { emissive: 0xffa040, emissiveIntensity: 1.3 });
const darkWin = M(0x05070a, { roughness: 0.15, metalness: 0.6 });
const doorMat = M(0x2a1c14);
const roofMat = M(0x221b19, { roughness: 0.95 });
export const woodMat = M(0x3b2a1d, { roughness: 0.9 });
export const metalMat = M(0x3a3d42, { metalness: 0.7, roughness: 0.45 });
const rustMat = M(0x4a3020, { metalness: 0.4, roughness: 0.8 });
const stoneMat = M(0x8a8780, { map: stoneTex, roughness: 0.95 });

// ---------------------------------------------------------------- ground
const ground = mesh(new THREE.PlaneGeometry(280, 280), M(0xffffff, { map: groundTex, roughness: 1 }), 0, 0, 0, scene, false);
ground.rotation.x = -Math.PI / 2;
const road = mesh(new THREE.PlaneGeometry(8, 185), M(0xffffff, { map: roadTex, roughness: 0.75 }), 0, 0.01, 2.5, scene, false);
road.rotation.x = -Math.PI / 2;
const trail = mesh(new THREE.PlaneGeometry(52, 3.2), M(0xffffff, { map: dirtTex, roughness: 1 }), -30, 0.012, -20, scene, false);
trail.rotation.x = -Math.PI / 2;
const moonM = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), glow(1.6, 1.6, 1.8)); moonM.position.set(-170, 130, -230); scene.add(moonM);

// ---------------------------------------------------------------- houses
function house(cx, cz, w, d, h, facing, color) {
  const g = new THREE.Group(); g.position.set(cx, 0, cz); scene.add(g);
  const mat = M(color, { map: sidingTex, roughness: 0.92 });
  occluders.push(mesh(BOX(w, h, d), mat, 0, h / 2, 0, g));
  const R = (w + 0.9) / Math.sqrt(3);
  const roof = mesh(new THREE.CylinderGeometry(R, R, d + 0.8, 3), roofMat, 0, h + 0.5 * R * 0.45, 0, g);
  roof.rotation.x = -Math.PI / 2; roof.scale.z = 0.45;
  const fx = facing * (w / 2 + 0.02), ry = facing * Math.PI / 2;
  const win = (x, y, z, rot) => { const m = mesh(new THREE.PlaneGeometry(1.1, 1.3), wr() < 0.3 ? litWin : darkWin, x, y, z, g, false); m.rotation.y = rot; };
  win(fx, h * 0.55, -d / 4, ry); win(fx, h * 0.55, d / 4, ry);
  mesh(new THREE.PlaneGeometry(1.1, 2.2), doorMat, fx, 1.1, 0, g, false).rotation.y = ry;
  win(-fx, h * 0.55, 0, -ry);
  win(0, h * 0.55, d / 2 + 0.02, 0); win(0, h * 0.55, -d / 2 - 0.02, Math.PI);
  mesh(BOX(1.6, 0.3, 1.8), woodMat, facing * (w / 2 + 0.8), 0.15, 0, g);
  mesh(BOX(0.8, 2.4, 0.8), M(0x3b2723), w * 0.2, h + 1.6, d * 0.25, g);
  addBox(cx, cz, w, d);
}
const HOUSE_COLS = [0x6d6a5e, 0x5a6670, 0x7a6a55, 0x5e5f52, 0x705c58, 0x4f5a55];
[36, 20, 4, -12, -28, -44].forEach((z, i) => house(-14, z, wr(8, 10), wr(8, 10), wr(4.2, 5.4), 1, HOUSE_COLS[i % 6]));
[52, 36, 20, -20, -36, -52].forEach((z, i) => house(14, z, wr(8, 10), wr(8, 10), wr(4.2, 5.4), -1, HOUSE_COLS[(i + 3) % 6]));

// ---------------------------------------------------------------- streetlights
function streetlight(x, z, working) {
  const s = Math.sign(x);
  mesh(new THREE.CylinderGeometry(0.08, 0.12, 6.5, 6), metalMat, x, 3.25, z);
  mesh(BOX(1.6, 0.08, 0.08), metalMat, x - s * 0.8, 6.4, z);
  mesh(BOX(0.6, 0.18, 0.35), working ? glow(3, 2.2, 1.2, true) : metalMat, x - s * 1.5, 6.3, z, scene, false);
  addCircle(x, z, 0.2);
  if (working) worldLight(0xffb070, 30, 22, x - s * 1.5, 5.9, z, 'street');
}
streetlight(5, 64, true); streetlight(-5, 30, true); streetlight(5, -5, false); streetlight(-5, -40, true); streetlight(5, -66, true);

// ---------------------------------------------------------------- cars
function car(x, z, rot, color, hood) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = rot; scene.add(g);
  const paint = M(color, { roughness: 0.45, metalness: 0.5 });
  occluders.push(mesh(BOX(1.85, 0.7, 4.3), paint, 0, 0.62, 0, g));
  mesh(BOX(1.65, 0.6, 2.1), M(0x0a0c10, { roughness: 0.1, metalness: 0.8 }), 0, 1.25, 0.25, g);
  for (const sx of [-0.92, 0.92]) for (const sz of [-1.35, 1.35]) { const w = mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.22, 12), M(0x0d0d0d), sx, 0.34, sz, g); w.rotation.z = Math.PI / 2; }
  if (hood) { const h = mesh(BOX(1.7, 0.05, 1.3), paint, 0, 1.45, -1.35, g); h.rotation.x = -1.0; }
  const hl = []; for (const sx of [-0.62, 0.62]) hl.push(mesh(BOX(0.35, 0.16, 0.05), glow(0.2, 0.2, 0.2, true), sx, 0.72, -2.16, g, false));
  const tl = []; for (const sx of [-0.7, 0.7]) tl.push(mesh(BOX(0.3, 0.14, 0.05), glow(0.2, 0.02, 0, true), sx, 0.72, 2.16, g, false));
  const c = Math.abs(Math.cos(rot)), s = Math.abs(Math.sin(rot));
  addBox(x, z, 1.85 * c + 4.3 * s, 4.3 * c + 1.85 * s);
  return { g, hl, tl };
}
export const ericCar = car(-1.8, 74, 0.05, 0x34495a, true);
ericCar.hl.forEach(m => m.material.color.setRGB(6, 5.5, 4.5));
carSpot.position.set(-1.8, 0.9, 71.6); carSpot.target.position.set(-1.0, 0, 50);
car(2.1, 28, 0.4, 0x5b1e1a, false);
car(-2.5, -31, -0.9, 0x3c3d30, false);
car(9, -70, 1.4, 0x2a2a2e, false);

// ---------------------------------------------------------------- town sign
{
  const t = textTex(512, 256, (g, w, h) => {
    g.fillStyle = '#2d3a2c'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d8d0b8'; g.lineWidth = 8; g.strokeRect(12, 12, w - 24, h - 24);
    g.fillStyle = '#d8d0b8'; g.textAlign = 'center'; g.font = 'bold 34px Georgia,serif'; g.fillText('WELCOME TO', w / 2, 70);
    g.font = 'bold 64px Georgia,serif'; g.fillText('HOLLOW CREEK', w / 2, 140); g.font = '30px Georgia,serif'; g.fillText('POP. 412', w / 2, 200);
    g.strokeStyle = '#a3100f'; g.lineWidth = 7; g.beginPath(); g.moveTo(w / 2 - 70, 190); g.lineTo(w / 2 + 70, 180); g.stroke();
    g.fillStyle = '#b3120f'; g.font = 'bold 44px Georgia,serif'; g.fillText('2', w / 2 + 110, 214);
  });
  mesh(new THREE.PlaneGeometry(3.6, 1.8), M(0xffffff, { map: t }), 6.5, 2.2, 66.1, scene, false);
  mesh(BOX(0.12, 2.2, 0.12), woodMat, 5.2, 1.1, 66.05); mesh(BOX(0.12, 2.2, 0.12), woodMat, 7.8, 1.1, 66.05);
}

// ---------------------------------------------------------------- gas station
{
  const cx = -16, cz = 58;
  mesh(BOX(12, 0.5, 9), M(0xd8d4c8, { roughness: 0.7 }), cx, 4.7, cz);
  mesh(BOX(12.1, 0.6, 9.1), M(0x8a1612, { roughness: 0.6 }), cx, 4.25, cz, scene, false);
  for (const sx of [-5, 5]) for (const sz of [-3.8, 3.8]) { mesh(BOX(0.35, 4.5, 0.35), M(0xc8c4b8), cx + sx, 2.25, cz + sz); addCircle(cx + sx, cz + sz, 0.25); }
  for (const sz of [-2.2, 2.2]) {
    occluders.push(mesh(BOX(0.8, 1.7, 0.55), M(0xb21c18, { roughness: 0.5 }), cx, 0.85, cz + sz));
    mesh(BOX(0.6, 0.35, 0.05), glow(0.05, 0.4, 0.25, true), cx + 0.42, 1.25, cz + sz, scene, false).rotation.y = Math.PI / 2;
    addBox(cx, cz + sz, 0.8, 0.55);
  }
  occluders.push(mesh(BOX(9, 4, 8), M(0x8d8778, { map: sidingTex }), cx - 10, 2, cz)); addBox(cx - 10, cz, 9, 8);
  mesh(BOX(9.4, 0.4, 8.4), roofMat, cx - 10, 4.2, cz);
  mesh(new THREE.PlaneGeometry(5, 2), M(0x0b1210, { emissive: 0x6fffb0, emissiveIntensity: 0.25, roughness: 0.1 }), cx - 5.48, 1.6, cz, scene, false).rotation.y = Math.PI / 2;
  const signT = textTex(512, 128, (g, w, h) => { g.fillStyle = '#120808'; g.fillRect(0, 0, w, h); g.fillStyle = '#ff6a3a'; g.textAlign = 'center'; g.font = 'bold 70px Arial Black,Arial,sans-serif'; g.fillText('GAS · FOOD', w / 2, 92); });
  mesh(new THREE.PlaneGeometry(6, 1.5), new THREE.MeshBasicMaterial({ map: signT, fog: true, color: new THREE.Color(1.6, 1.6, 1.6) }), cx + 6.08, 4.5, cz, scene, false).rotation.y = Math.PI / 2;
  worldLight(0xd8ffe8, 26, 18, cx, 4.1, cz, 'fluor');
  mesh(BOX(0.9, 0.8, 0.7), woodMat, -20.5, 0.4, 56.5); addBox(-20.5, 56.5, 0.9, 0.7);
  mesh(BOX(2.6, 1.5, 1.4), M(0x1f3a2a, { metalness: 0.4 }), -30.5, 0.75, 63.5); addBox(-30.5, 63.5, 2.6, 1.4);
}

// ---------------------------------------------------------------- playground
export const swings = [];
{
  const cx = 30, cz = 40;
  for (const x of [cx - 3, cx + 3]) for (const dz of [-0.8, 0.8]) { const l = mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.4, 6), rustMat, x, 1.6, cz + dz); l.rotation.x = dz > 0 ? -0.24 : 0.24; }
  mesh(new THREE.CylinderGeometry(0.07, 0.07, 6.2, 6), rustMat, cx, 3.25, cz).rotation.z = Math.PI / 2;
  for (const dx of [-1.6, 0, 1.6]) {
    const piv = new THREE.Group(); piv.position.set(cx + dx, 3.2, cz); scene.add(piv);
    for (const s of [-0.22, 0.22]) mesh(BOX(0.02, 2.4, 0.02), metalMat, s, -1.2, 0, piv);
    mesh(BOX(0.55, 0.06, 0.25), M(0x2a2a2a), 0, -2.42, 0, piv);
    swings.push({ piv, phase: wr(0, 6), amp: dx === 0 ? 0.55 : 0.04 });
  }
  addCircle(cx - 3, cz, 0.3); addCircle(cx + 3, cz, 0.3);
  mesh(BOX(0.9, 0.08, 4.2), M(0x6a1c18, { metalness: 0.3 }), cx + 6.5, 1.2, cz + 5).rotation.x = 0.55;
  mesh(BOX(0.9, 2.3, 0.9), rustMat, cx + 6.5, 1.15, cz + 3.2); addBox(cx + 6.5, cz + 3.2, 0.9, 0.9);
  swings.push({ spin: mesh(new THREE.CylinderGeometry(1.6, 1.6, 0.12, 16), M(0x2b3d5a, { metalness: 0.4 }), cx - 5, 0.45, cz + 6) });
  const tb = new THREE.Group(); tb.position.set(cx + 0.6, 0, cz + 1.2); scene.add(tb);
  const bm = M(0x6a4a30, { roughness: 1 });
  mesh(new THREE.SphereGeometry(0.16, 10, 8), bm, 0, 0.16, 0, tb); mesh(new THREE.SphereGeometry(0.11, 10, 8), bm, 0, 0.38, 0, tb);
  tb.rotation.z = 0.5;
}

// ---------------------------------------------------------------- church + ritual circle
export const candles = [];
export const CIRCLE = new V3(27.6, 0, -2);
{
  const cx = 37, cz = -2;
  occluders.push(mesh(BOX(10, 8, 18), M(0x6b665e, { map: sidingTex }), cx, 4, cz)); addBox(cx, cz, 10, 18);
  const R = 10.9 / Math.sqrt(3);
  const roof = mesh(new THREE.CylinderGeometry(R, R, 18.8, 3), roofMat, cx, 8 + 0.5 * R * 0.8, cz); roof.rotation.x = -Math.PI / 2; roof.scale.z = 0.8;
  occluders.push(mesh(BOX(3.4, 15, 3.4), M(0x625d55, { map: sidingTex }), cx - 4.2, 7.5, cz)); addBox(cx - 4.2, cz, 3.4, 3.4);
  mesh(new THREE.ConeGeometry(2.6, 7, 4), roofMat, cx - 4.2, 18.5, cz).rotation.y = Math.PI / 4;
  mesh(BOX(0.18, 2.2, 0.18), metalMat, cx - 4.2, 23, cz); mesh(BOX(0.18, 0.18, 1.2), metalMat, cx - 4.2, 23.4, cz);
  mesh(new THREE.PlaneGeometry(1.8, 3), M(0x050000, { emissive: 0x500000, emissiveIntensity: 0.9 }), cx - 5.92, 1.5, cz, scene, false).rotation.y = -Math.PI / 2;
  for (const z of [-6, -2, 2, 6]) for (const s of [-1, 1]) {
    const w = mesh(new THREE.PlaneGeometry(1.2, 3), M(0x100306, { emissive: 0x7a1030, emissiveIntensity: 0.6 }), cx + z * 0.7, 4.5, cz + s * 9.02, scene, false);
    w.rotation.y = s > 0 ? 0 : Math.PI;
  }
  mesh(new THREE.RingGeometry(1.7, 1.85, 40), new THREE.MeshBasicMaterial({ color: 0x3a0000 }), CIRCLE.x, 0.02, CIRCLE.z, scene, false).rotation.x = -Math.PI / 2;
  mesh(new THREE.CylinderGeometry(0.1, 0.12, 2.4, 6), woodMat, 27.25, 1.2, -2);
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2, x = CIRCLE.x + Math.cos(a) * 2.2, z = CIRCLE.z + Math.sin(a) * 2.2;
    mesh(new THREE.CylinderGeometry(0.05, 0.05, wr(0.2, 0.45), 6), M(0xd8d0bc), x, 0.15, z, scene, false);
    candles.push(mesh(new THREE.SphereGeometry(0.035, 6, 4), glow(4, 2, 0.6, true), x, 0.42, z, scene, false));
  }
  worldLight(0xff9a40, 10, 9, CIRCLE.x, 0.8, CIRCLE.z, 'candle');
}

// ---------------------------------------------------------------- graveyard
export const GRAVE = new V3(38, 0, -28.6);
{
  const cx = 42, cz = -30;
  const fenceMat = M(0x111111, { metalness: 0.8 });
  for (let x = -9; x <= 9; x += 1.5) for (const z of [-7.5, 7.5]) mesh(BOX(0.06, 1.3, 0.06), fenceMat, cx + x, 0.65, cz + z, scene, false);
  for (let z = -7.5; z <= 7.5; z += 1.5) for (const x of [-9, 9]) if (Math.abs(z) > 1.5 || x > 0) mesh(BOX(0.06, 1.3, 0.06), fenceMat, cx + x, 0.65, cz + z, scene, false);
  for (let i = 0; i < 30; i++) {
    const x = cx - 7 + (i % 6) * 2.6 + wr(-0.3, 0.3), z = cz - 5.5 + ((i / 6) | 0) * 2.6 + wr(-0.3, 0.3);
    if (Math.hypot(x - GRAVE.x, z - GRAVE.z) < 1.6) continue;
    let st;
    if (wr() < 0.25) { st = new THREE.Group(); st.position.set(x, 0, z); scene.add(st); mesh(BOX(0.14, 1.2, 0.14), stoneMat, 0, 0.6, 0, st); mesh(BOX(0.6, 0.14, 0.14), stoneMat, 0, 0.85, 0, st); }
    else st = mesh(BOX(0.7, wr(0.8, 1.2), 0.18), stoneMat, x, 0.45, z);
    st.rotation.set(wr(-0.15, 0.15), wr(-0.2, 0.2), wr(-0.15, 0.15));
    addCircle(x, z, 0.35);
  }
  occluders.push(mesh(BOX(4, 3.6, 4), stoneMat, 47.5, 1.8, -36)); addBox(47.5, -36, 4, 4);
  mesh(new THREE.ConeGeometry(3.1, 1.6, 4), stoneMat, 47.5, 4.4, -36).rotation.y = Math.PI / 4;
  const gt = textTex(256, 320, (g, w, h) => {
    g.fillStyle = '#6e6c67'; g.fillRect(0, 0, w, h); speckle(g, w, h, 3000, ['#5d5b57', '#7b7974', '#4f4d49']);
    g.fillStyle = '#2a2826'; g.textAlign = 'center'; g.font = 'bold 34px Georgia,serif'; g.fillText('ERIC', w / 2, 110); g.fillText('KOSOY', w / 2, 150);
    g.font = '24px Georgia,serif'; g.fillText('— 2026 —', w / 2, 200); g.font = 'italic 20px Georgia,serif'; g.fillText('welcome home', w / 2, 250);
  });
  mesh(BOX(0.9, 1.3, 0.2), [stoneMat, stoneMat, stoneMat, stoneMat, M(0xffffff, { map: gt }), stoneMat], GRAVE.x, 0.65, GRAVE.z);
  mesh(BOX(1.1, 0.2, 2.2), M(0x22170f, { roughness: 1 }), GRAVE.x, 0.08, GRAVE.z + 1.4); addCircle(GRAVE.x, GRAVE.z, 0.4);
}

// ---------------------------------------------------------------- cabin in the woods
{
  const cx = -60, cz = -20;
  occluders.push(mesh(BOX(6, 3.2, 5.5), M(0x3a2a1e, { roughness: 0.95 }), cx, 1.6, cz)); addBox(cx, cz, 6, 5.5);
  const R = 6.9 / Math.sqrt(3);
  const roof = mesh(new THREE.CylinderGeometry(R, R, 6.3, 3), roofMat, cx, 3.2 + 0.5 * R * 0.5, cz); roof.rotation.x = -Math.PI / 2; roof.scale.z = 0.5; roof.rotation.y = Math.PI / 2;
  mesh(new THREE.PlaneGeometry(1, 2), doorMat, cx + 3.02, 1, cz).rotation.y = Math.PI / 2;
  mesh(new THREE.PlaneGeometry(0.9, 0.8), litWin, cx + 3.02, 1.7, cz + 1.7, scene, false).rotation.y = Math.PI / 2;
  mesh(BOX(2.2, 0.25, 5.5), woodMat, cx + 4.1, 0.12, cz);
  mesh(new THREE.SphereGeometry(0.12, 8, 6), glow(5, 2.6, 0.8, true), cx + 3.6, 2.2, cz + 1.2, scene, false);
  worldLight(0xff9040, 14, 14, cx + 3.6, 2.1, cz + 1.2, 'lantern');
  for (let i = 0; i < 6; i++) { const l = mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.4, 6), woodMat, cx - 1 + (i % 3) * 0.32, 0.15 + ((i / 3) | 0) * 0.28, cz + 3.4); l.rotation.z = Math.PI / 2; }
}

// ---------------------------------------------------------------- radio tower
export const towerLight = mesh(new THREE.SphereGeometry(0.45, 10, 8), glow(6, 0.2, 0.1, false), 0, 40.5, -80, scene, false);
export const towerPanel = { pos: new V3(5.2, 0, -76) };
{
  const cx = 0, cz = -80, H = 40;
  const beam = (a, b, r, mat) => { const d = new V3().subVectors(b, a), len = d.length(); const m = mesh(new THREE.CylinderGeometry(r, r, len, 5), mat, 0, 0, 0, scene, true); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new V3(0, 1, 0), d.normalize()); return m; };
  const corner = (i, y) => { const s = lerp(3, 0.5, y / H); const sx = (i === 0 || i === 3) ? -1 : 1, sz = i < 2 ? -1 : 1; return new V3(cx + sx * s, y, cz + sz * s); };
  const tm = M(0x6a2a20, { metalness: 0.6, roughness: 0.6 });
  for (let i = 0; i < 4; i++) { beam(corner(i, 0), corner(i, H), 0.12, tm); const c = corner(i, 0); addCircle(c.x, c.z, 0.3); }
  for (let y = 0; y < H; y += 5) for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4; beam(corner(i, y), corner(j, y + 5), 0.04, tm); beam(corner(j, y), corner(i, y + 5), 0.04, tm); beam(corner(i, y + 5), corner(j, y + 5), 0.05, tm);
  }
  mesh(BOX(1.6, 0.8, 0.3), metalMat, cx, H - 3, cz + 0.6);
  occluders.push(mesh(BOX(3.4, 2.8, 3.4), M(0x55574f, { map: sidingTex }), 7.5, 1.4, -76)); addBox(7.5, -76, 3.4, 3.4);
  mesh(BOX(3.8, 0.2, 3.8), roofMat, 7.5, 2.9, -76);
  towerPanel.screen = mesh(new THREE.PlaneGeometry(1.1, 0.7), M(0x050505, { emissive: 0xff2010, emissiveIntensity: 1.2 }), 5.78, 1.5, -76, scene, false);
  towerPanel.screen.rotation.y = -Math.PI / 2;
  for (let i = 0; i < 3; i++) mesh(BOX(0.6, 1.2, 0.03), metalMat, 5.75, 1.5, -77.4 + i * 0.25, scene, false).rotation.y = -Math.PI / 2;
  for (let i = 0; i < 9; i++) {
    const a = i / 9 * Math.PI * 2 + 0.2; if (Math.abs(wrapA(a - Math.PI / 2)) < 0.5) continue;
    const x = cx + Math.cos(a) * 11, z = cz + Math.sin(a) * 11;
    mesh(BOX(2.2, 1, 0.6), M(0x6a6a62, { map: stoneTex }), x, 0.5, z).rotation.y = -a + Math.PI / 2; addCircle(x, z, 0.9);
  }
}

// ---------------------------------------------------------------- walkie-talkie on the gas station crate
export const walkie = new THREE.Group(); walkie.position.set(-20.5, 0.86, 56.5); scene.add(walkie);
mesh(BOX(0.08, 0.18, 0.04), M(0x1a1a1a), 0, 0, 0, walkie, false);
mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.15), M(0x111111), 0.02, 0.15, 0, walkie, false);
const walkieLed = mesh(new THREE.SphereGeometry(0.012, 6, 4), glow(0.2, 6, 0.4, true), -0.02, 0.07, 0.02, walkie, false);

// ---------------------------------------------------------------- forest
{
  const zones = [{ x: -18, z: 58, r: 15 }, { x: 30, z: 40, r: 12 }, { x: 40, z: -16, r: 20 }, { x: -60, z: -20, r: 10 }, { x: 0, z: -80, r: 15 }, { x: 0, z: 76, r: 9 }];
  const ok = (x, z) => {
    if (Math.abs(x) < 25 && z > -62 && z < 72) return false;
    if (Math.abs(x) < 6) return false;
    if (x < -2 && x > -58 && Math.abs(z + 20) < 3.5) return false;
    for (const zn of zones) if (Math.hypot(x - zn.x, z - zn.z) < zn.r) return false;
    return true;
  };
  const pts = [];
  for (let k = 0; k < 9000 && pts.length < 620; k++) {
    const a = wr(0, Math.PI * 2), r = Math.sqrt(wr()) * 105, x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!ok(x, z)) continue;
    if (pts.some(p => (p.x - x) ** 2 + (p.z - z) ** 2 < (r > 85 ? 3 : 10))) continue;
    pts.push({ x, z, s: wr(0.8, 1.6), rot: wr(0, 6), sy: wr(0.9, 1.25), dead: wr() < 0.12 });
  }
  const tg = new THREE.CylinderGeometry(0.14, 0.26, 5, 6); tg.translate(0, 2.5, 0);
  const l1 = new THREE.ConeGeometry(1.9, 5.5, 7); l1.translate(0, 5.6, 0);
  const l2 = new THREE.ConeGeometry(1.35, 4, 7); l2.translate(0, 8, 0);
  const trunks = new THREE.InstancedMesh(tg, M(0xffffff, { map: barkTex, roughness: 1 }), pts.length);
  const leaf1 = new THREE.InstancedMesh(l1, M(0x15211a, { roughness: 1 }), pts.length);
  const leaf2 = new THREE.InstancedMesh(l2, M(0x18261d, { roughness: 1 }), pts.length);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  pts.forEach((p, i) => {
    q.setFromAxisAngle(new V3(0, 1, 0), p.rot);
    m4.compose(new V3(p.x, 0, p.z), q, new V3(p.s, p.s * p.sy, p.s));
    trunks.setMatrixAt(i, m4);
    if (p.dead) m4.compose(new V3(p.x, -50, p.z), q, new V3(0.001, 0.001, 0.001));
    leaf1.setMatrixAt(i, m4); leaf2.setMatrixAt(i, m4);
    addCircle(p.x, p.z, 0.35 * p.s);
  });
  for (const im of [trunks, leaf1, leaf2]) { im.castShadow = true; im.receiveShadow = true; scene.add(im); }
  trunks.computeBoundingSphere(); occluders.push(trunks);
}

// ---------------------------------------------------------------- rain
const RAIN_N = 1500;
const rainPos = new Float32Array(RAIN_N * 6);
const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
for (let i = 0; i < RAIN_N; i++) { rainPos[i * 6] = rand(-25, 25); rainPos[i * 6 + 1] = rand(0, 22); rainPos[i * 6 + 2] = rand(-25, 25); }
const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0x8696ad, transparent: true, opacity: 0.3 }));
rain.frustumCulled = false; scene.add(rain);
export function updateRain(dt) {
  const cx = camera.position.x, cz = camera.position.z;
  for (let i = 0; i < RAIN_N; i++) {
    const k = i * 6; let x = rainPos[k] + 2 * dt, y = rainPos[k + 1] - 24 * dt, z = rainPos[k + 2];
    if (y < 0) y += 22;
    if (x - cx > 25) x -= 50; else if (x - cx < -25) x += 50;
    if (z - cz > 25) z -= 50; else if (z - cz < -25) z += 50;
    rainPos[k] = x; rainPos[k + 1] = y; rainPos[k + 2] = z; rainPos[k + 3] = x - 0.06; rainPos[k + 4] = y + 0.55; rainPos[k + 5] = z;
  }
  rainGeo.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------- lightning & per-frame world life
export function lightning(force) {
  S.light = 0.42; S.lightSeq = [1, 0.1, 0.7, 0, 0.35]; SFX.thunder(); if (force) S.lightT = rand(25, 45);
}
export function updateWorld(dt, me) {
  S.blackout = Math.max(0, S.blackout - dt);
  for (const d of dynLights) {
    d.t += dt; let k = 1;
    if (d.kind === 'street') k = Math.random() < 0.02 ? 0.2 : (Math.sin(d.t * 17) > 0.97 ? 0.4 : 1);
    if (d.kind === 'fluor') k = Math.random() < 0.06 ? 0.05 : 1;
    if (d.kind === 'candle' || d.kind === 'lantern') k = 0.8 + Math.sin(d.t * 11) * 0.1 + Math.sin(d.t * 23) * 0.1;
    if (d.kind === 'candle' && S.sean) k *= 0.6;
    if (S.blackout > 0) k = 0;
    if (S.phase === 'boss' && d.kind === 'street') k *= 0.3;
    d.l.intensity = d.base * k;
  }
  litWin.emissiveIntensity = S.blackout > 0 ? 0 : 1.2 + Math.sin(S.time * 3) * 0.1;
  for (const c of candles) c.visible = S.blackout <= 0;
  const hz = (Math.sin(S.time * 6) > 0 && S.blackout <= 0) ? 6 : 0.1;
  ericCar.tl.forEach(m => m.material.color.setRGB(hz, hz * 0.35, 0));
  const on = Math.sin(S.time * 3) > 0.3;
  towerLight.material.color.setRGB(on ? 6 : 0.4, on ? 0.2 : 0.01, 0.05);
  for (const s of swings) { if (s.spin) s.spin.rotation.y += dt * 0.35; else s.piv.rotation.x = Math.sin(S.time * 1.4 + s.phase) * s.amp; }
  walkieLed.visible = Math.sin(S.time * 8) > 0;
  // lightning
  S.lightT -= dt;
  if (S.lightT <= 0 && S.state === 'play') { lightning(); S.lightT = rand(22, 45); }
  let L = 0;
  if (S.light > 0) { S.light -= dt; const seq = S.lightSeq, i = Math.floor((0.42 - S.light) / 0.42 * seq.length); L = seq[clamp(i, 0, seq.length - 1)] || 0; }
  hemi.intensity = 0.55 + L * 7; moon.intensity = 0.35 + L * 5;
  if (S.phase !== 'escape') $('white').style.opacity = L * 0.12 + Math.max(0, S.flareFx) * 1.6;
  // the car's headlight becomes the rescue helicopter's searchlight at the end
  if (S.phase === 'escape' && me) {
    S.heliPos.lerp(new V3(me.x + 6, 26, me.z + 6), dt * 0.35);
    carSpot.position.copy(S.heliPos); carSpot.target.position.set(me.x + Math.sin(S.time) * 2, 0, me.z + Math.cos(S.time * 0.8) * 2);
    carSpot.intensity = 900; carSpot.distance = 60; carSpot.angle = 0.3;
  } else carSpot.intensity = S.blackout > 0 ? 0 : 70 * (Math.random() < 0.01 ? 0.3 : 1);
}
