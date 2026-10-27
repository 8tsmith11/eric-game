// Gameplay. In solo and as host this module runs the whole simulation.
// As guest it only drives the local player and mirrors the host's world.
import * as THREE from 'three';
import {
  $, V3, rand, clamp, lerp, wrapA, pick, S, INPUT, scene, camera, flash, flash2, muzzleLight, fill,
  M, glow, mesh, BOX, blocked, resolve, rayBlock,
} from './core.js';
import { towerPanel, walkie, metalMat, CIRCLE, GRAVE, lightning, updateWorld } from './world.js';
import { buildPerson, buildMonster, animWalk, poseDown, ERIC_LOOK, SEAN_LOOK, OTHER_LOOK, buildShotgun, buildPistol } from './characters.js';
import { PM, emit, bloodPool, tracer, eFlash, sFlash, showFlash } from './fx.js';
import { SFX, heliOn, updateMusic } from './audio.js';
import { say, bigMsg, showNote, toast, hitMark, staticFx } from './hud.js';
import { NET, send } from './net.js';

const tmp = new V3(), tmp2 = new V3(), camF = new V3(), camR = new V3(), muzzleW = new V3();
const isHostLike = () => S.mode !== 'guest';

// ================================================================ characters
export const WEAPONS = {
  shotgun: { name: 'PUMP SHOTGUN · 12 GA', max: 6, res: 24, resMax: 48, pickup: 6, unit: 'SHELLS', pellets: 9, dmg: 14, falloff: 40, spread: [0.085, 0.05], cool: 0.8, pump: true, each: true, reloadT: 0.48, kick: 1, flash: 0.7, icon: '' },
  pistol: { name: 'M1911 · .45 ACP', max: 8, res: 40, resMax: 80, pickup: 12, unit: 'ROUNDS', pellets: 1, dmg: 40, falloff: 90, spread: [0.028, 0.006], cool: 0.2, pump: false, each: false, reloadT: 1.25, kick: 0.45, flash: 0.4, icon: 'r' },
};
const ericP = buildPerson({ ...ERIC_LOOK, scale: 0.92, cast: false }); scene.add(ericP.root);
const seanP = buildPerson({ ...SEAN_LOOK, scale: 0.95, cast: true }); scene.add(seanP.root);
const shotgun = buildShotgun(); ericP.chest.add(shotgun.g);
const pistol = buildPistol(); seanP.chest.add(pistol.g);
function makeChar(id, name, person, gun, wdef, flashSprite) {
  return {
    id, name, person, gun, wdef, flashSprite, pos: person.root.position, vel: new V3(), yaw: 0, pitch: -0.08, modelYaw: Math.PI,
    hp: 100, down: false, dead: false, deadT: 0, stam: 100, dodgeT: 0, dodgeCd: 0, dodgeDir: new V3(), fireRecent: 0, ph: 0, stepPh: 0,
    aimK: 0, trauma: 0, flashOn: true, sprint: false, hurtFx: 0, regenT: 0,
    w: { mag: wdef.max, res: wdef.res, cool: 0, reloading: false, rT: 0, pumpT: 0, pumped: false, kick: 0 },
    net: { tx: 0, tz: 0, my: 0, aim: 0, fr: false, full: false, has: false },
  };
}
export const CH = {
  eric: makeChar('eric', 'ERIC KOSOY', ericP, shotgun, WEAPONS.shotgun, eFlash),
  sean: makeChar('sean', 'SEAN PERRIUS', seanP, pistol, WEAPONS.pistol, sFlash),
};
CH.eric.pos.set(1.6, 0, 78);
// Sean starts tied up at the church in solo. ai: captive | free | player
Object.assign(CH.sean, { ai: 'captive', fireT: 0, target: null, seekT: 0, barkT: 15, aimT: 0, struggle: 0 });
CH.sean.pos.copy(CIRCLE); CH.sean.modelYaw = -Math.PI / 2; seanP.root.rotation.y = -Math.PI / 2;
export let P = CH.eric, O = CH.sean; // P = me, O = my partner

export function setMode(mode) {
  S.mode = mode; S.story = mode === 'solo' ? 'solo' : 'coop';
  if (mode === 'guest') { P = CH.sean; O = CH.eric; } else { P = CH.eric; O = CH.sean; }
  if (mode !== 'solo') {
    const s = CH.sean; s.ai = 'player'; s.pos.set(3.4, 0, 78.6); s.modelYaw = Math.PI; s.yaw = 0;
    s.person.root.rotation.y = Math.PI; s.person.body.position.y = 0; s.person.chest.rotation.set(0, 0, 0);
    s.net.tx = s.pos.x; s.net.tz = s.pos.z;
  }
  $('myName').textContent = P.name; $('wname').textContent = P.wdef.name;
  lastRecv = performance.now();
}
function targetable() {
  const L = []; if (!CH.eric.down && !CH.eric.dead) L.push(CH.eric);
  const s = CH.sean; if (!s.down && (s.ai === 'player' || s.ai === 'free')) L.push(s);
  return L;
}
function lookDotFor(c, p) { tmp.subVectors(p, c.pos); tmp.y = 0; tmp.normalize(); return tmp.x * -Math.sin(c.yaw) + tmp.z * -Math.cos(c.yaw); }
function camFwdOf(c, v) { const cp = Math.cos(c.pitch); return v.set(-Math.sin(c.yaw) * cp, Math.sin(c.pitch), -Math.cos(c.yaw) * cp); }

// ================================================================ events (host decides, everyone plays)
const EV = {
  say: (who, text, delay) => say(who, text, delay || 0),
  msg: (a, b, t) => bigMsg(a, b, t),
  sfx: (name, pos, arg) => { const fn = SFX[name]; if (!fn) return; if (pos) fn(new V3().fromArray(pos), arg); else fn(arg); },
  light: () => lightning(true),
  blackout: t => { S.blackout = t; },
  static: v => staticFx(v),
  note: (t, x) => showNote(t, x),
  hurt: (fx, fz) => localHurt(fx, fz),
  got: type => localGot(type),
  hm: kind => hitMark(kind),
  kill: (id, head, dx, dz) => killFx(byId.get(id), head, dx, dz),
  rshot: (chId, m) => showRemoteShot(CH[chId], m),
  tower: () => towerPanel.screen.material.emissive.setHex(0x30ff60),
  heli: on => heliOn(on),
  end: (won, why) => endGame(won, why),
  toast: t => toast(t),
};
// who: 'all' or a character id ('eric' / 'sean')
function ev(type, args = [], who = 'all') {
  if (who === 'all' || who === P.id) EV[type](...args);
  if (S.mode === 'host' && NET.connected && (who === 'all' || who !== P.id)) send({ t: 'ev', e: type, a: args });
}
const sayAll = (who, text, delay = 0) => ev('say', [who, text, delay]);
const sfx = (name, pos, arg) => ev('sfx', [name, pos ? [pos.x, pos.y, pos.z] : null, arg]);

// ================================================================ enemies
export const enemies = [];
const byId = new Map();
let boss = null, nextId = 1;
const STATES = ['idle', 'chase', 'windup', 'lunge', 'recover', 'intro', 'tele', 'charge', 'summon'];
const TYPES = ['hollow', 'runner', 'boss'];
function newEnemy(type, id, sc, x, z) {
  const p = buildMonster(type, sc); p.root.position.set(x, 0, z); scene.add(p.root);
  const runner = type === 'runner', isBoss = type === 'boss', coop = S.mode !== 'solo';
  const e = {
    id, type, boss: isBoss, p, pos: p.root.position, scale: sc,
    hp: isBoss ? (coop ? 3600 : 2600) : runner ? 55 : 105, speed: runner ? rand(6, 6.7) : rand(3, 3.9), reach: 1.75, dmg: runner ? 10 : 17,
    windup: isBoss ? 0.6 : runner ? 0.28 : 0.45, state: isBoss ? 'intro' : 'chase', t: isBoss ? 2.6 : 0, ph: rand(0, 6), yaw: 0, stun: 0, kb: new V3(),
    dead: false, deadT: 0, lean: isBoss ? 0.15 : runner ? 0.85 : 0.32, lungeCd: 2, growlT: rand(2, 6), twitch: 0,
    headPos: new V3(), chestPos: new V3(), hipPos: new V3(), nx: x, nz: z, nyaw: 0, spd: 0, hpFrac: 1,
    summonT: 12, chargeT: 7, cdx: 0, cdz: 0,
  };
  e.maxHp = e.hp; p.root.updateMatrixWorld(true); updateHitboxes(e);
  enemies.push(e); byId.set(id, e);
  if (isBoss) boss = e;
  return e;
}
function makeEnemy(type, x, z, idle = false) {
  const e = newEnemy(type, nextId++, type === 'runner' ? 0.95 : rand(1, 1.12), x, z);
  if (idle) e.state = 'idle';
  e.yaw = rand(-3, 3); e.p.root.rotation.y = e.yaw; return e;
}
const HB_C = new V3(0, 0.3, 0), HB_H = new V3(0, 0.1, 0);
function updateHitboxes(e) {
  e.p.head.localToWorld(e.headPos.copy(HB_H));
  e.p.chest.localToWorld(e.chestPos.copy(HB_C));
  e.hipPos.set(e.pos.x, 0.85 * e.scale, e.pos.z);
}
function anchorChar() { const T = targetable(); return T.length ? pick(T) : CH.eric; }
function spawnAround(type, rmin = 22, rmax = 34, behind = true, anchor = anchorChar()) {
  for (let k = 0; k < 30; k++) {
    const head = -anchor.yaw;
    const b = behind && k < 20 ? head + Math.PI + rand(-1.7, 1.7) : rand(0, Math.PI * 2);
    const r = rand(rmin, rmax), x = anchor.pos.x + Math.sin(b) * r, z = anchor.pos.z - Math.cos(b) * r;
    if (Math.hypot(x, z) > 90 || blocked(x, z, 0.7)) continue;
    const e = makeEnemy(type, x, z); e.yaw = Math.atan2(anchor.pos.x - x, anchor.pos.z - z); return e;
  }
  return null;
}
function horde(n, rmin = 14, rmax = 24) { if (S.mode !== 'solo') n = Math.ceil(n * 1.4); for (let i = 0; i < n; i++) spawnAround(Math.random() < 0.3 ? 'runner' : 'hollow', rmin, rmax, false); }
function wake(e) { if (e.state !== 'idle') return; e.state = 'chase'; sfx('scream', e.pos, e.type === 'runner' ? 1.3 : 1); }
function wakeNear(pos, r) { for (const e of enemies) if (e.state === 'idle' && e.pos.distanceTo(pos) < r) setTimeout(() => wake(e), rand(100, 700)); }
const hpFrac = e => S.mode === 'guest' ? e.hpFrac : Math.max(0, e.hp) / e.maxHp;

// by: 'eric' | 'sean' (players) or 'ai'
function damageEnemy(e, dmg, dir, head, pt, by) {
  if (e.dead) return;
  e.hp -= dmg; e.twitch = 0.15;
  const k = e.boss ? 0.012 : 0.07; e.kb.x += dir.x * dmg * k; e.kb.z += dir.z * dmg * k;
  if (!e.boss && dmg > 45) e.stun = Math.max(e.stun, 0.4);
  if (e.state === 'idle') wake(e);
  if (pt) sfx('flesh', pt);
  if (by === 'eric' || by === 'sean') ev('hm', [e.hp <= 0 ? 'kill' : 'hit'], by);
  if (e.hp <= 0) killEnemy(e, dir, head);
}
function killEnemy(e, dir, head) {
  e.dead = true; e.deadT = 0; S.kills++;
  ev('kill', [e.id, head && !e.boss ? 1 : 0, +dir.x.toFixed(2), +dir.z.toFixed(2)]);
  S.hitstop = e.boss ? 0 : 0.045;
  if (e.boss) { bossDefeated(); return; }
  const r = Math.random(), ac = (S.phase === 'hold' || S.phase === 'boss') ? 0.55 : 0.33;
  if (r < ac) addPickup('ammo', e.pos.x, e.pos.z);
  else if (r < ac + (Math.min(CH.eric.hp, CH.sean.hp) < 50 ? 0.16 : 0.07)) addPickup('health', e.pos.x, e.pos.z);
  if (S.mode === 'solo' && CH.sean.ai === 'free' && Math.random() < 0.25) seanBark('kill');
}
// runs on every machine when something dies
function killFx(e, head, dx, dz) {
  if (!e) return;
  if (!e.dead) { e.dead = true; e.deadT = 0; }
  const dir = new V3(dx, 0, dz);
  if (head) { e.p.head.visible = false; emit(e.headPos, 28, PM.blood, 5, 0.07, 1.3, { dir: new V3(0, 1, 0) }); SFX.splat(e.pos); }
  emit(e.chestPos, 14, PM.blood, 3, 0.06, 1, { dir });
  bloodPool(e.pos, e.boss ? 3 : 1);
  SFX.die(e.pos, e.type === 'runner' ? 1.4 : e.boss ? 0.5 : 1);
}

// --- simulation (host / solo only)
function simEnemy(e, dt) {
  const p = e.pos;
  if (e.dead) {
    p.x += e.kb.x * dt; p.z += e.kb.z * dt; e.kb.multiplyScalar(Math.exp(-6 * dt));
    if (e.deadT > 6) p.y -= dt * 0.5;
    if (e.deadT > 8.5) e.remove = true;
    return 0;
  }
  const T = targetable(); if (!T.length) return 0;
  let tc = T[0], best = 1e9; for (const c of T) { const d = c.pos.distanceToSquared(p); if (d < best) { best = d; tc = c; } }
  const tp = tc.pos, dx = tp.x - p.x, dz = tp.z - p.z, dist = Math.hypot(dx, dz) || 0.001, face = Math.atan2(dx, dz);
  e.twitch = Math.max(0, e.twitch - dt);
  let moveSp = 0;
  if (e.stun > 0) e.stun -= dt;
  else switch (e.state) {
    case 'idle': {
      for (const c of T) { const pd = Math.hypot(c.pos.x - p.x, c.pos.z - p.z); if (pd < 8.5 || (c.flashOn && pd < 16 && lookDotFor(c, p) > 0.94)) { wake(e); break; } }
      break;
    }
    case 'chase': {
      moveSp = e.speed; e.yaw += wrapA(face - e.yaw) * Math.min(1, dt * 7);
      if (dist < e.reach) { e.state = 'windup'; e.t = e.windup; if (Math.random() < 0.6) sfx('growl', p, e.type === 'runner' ? 1.5 : 1); }
      if (e.type === 'runner') { e.lungeCd -= dt; if (dist < 7 && dist > 3 && e.lungeCd <= 0) { e.state = 'lunge'; e.t = 0.5; e.ldx = dx / dist; e.ldz = dz / dist; e.lungeCd = rand(3, 5); sfx('scream', p, 1.5); } }
      e.growlT -= dt; if (e.growlT <= 0) { e.growlT = rand(3, 8); if (dist < 25) sfx(Math.random() < 0.5 ? 'growl' : 'scream', p, rand(0.8, 1.3)); }
      break;
    }
    case 'windup':
      e.t -= dt; e.yaw += wrapA(face - e.yaw) * Math.min(1, dt * 10); moveSp = e.speed * 0.15;
      if (e.t <= 0) { if (dist < e.reach + 0.75) hitChar(tc, e.dmg, p); sfx('whoosh'); e.state = 'recover'; e.t = 0.55; }
      break;
    case 'lunge':
      e.t -= dt; p.x += e.ldx * 11 * dt; p.z += e.ldz * 11 * dt;
      if (dist < 1.2) { hitChar(tc, e.dmg + 4, p); e.state = 'recover'; e.t = 0.7; }
      else if (e.t <= 0) { e.state = 'recover'; e.t = 0.4; }
      break;
    case 'recover': e.t -= dt; moveSp = e.speed * 0.3; if (e.t <= 0) e.state = 'chase'; break;
  }
  if (moveSp > 0 && e.stun <= 0) {
    let mx = dx / dist, mz = dz / dist;
    for (const o of enemies) { if (o === e || o.dead) continue; const ox = p.x - o.pos.x, oz = p.z - o.pos.z, d2 = ox * ox + oz * oz; if (d2 < 1.4 && d2 > 1e-4) { mx += ox / d2 * 0.35; mz += oz / d2 * 0.35; } }
    const ml = Math.hypot(mx, mz) || 1;
    if (dist > 1.1) { p.x += mx / ml * moveSp * dt; p.z += mz / ml * moveSp * dt; }
  }
  p.addScaledVector(e.kb, dt); e.kb.multiplyScalar(Math.exp(-7 * dt));
  resolve(p, 0.38 * e.scale);
  return e.state === 'lunge' ? 11 : moveSp;
}
// --- animation (everyone)
function animEnemy(e, dt, moveSp) {
  const pp = e.p;
  if (e.dead) {
    e.deadT += dt; const k = Math.min(1, e.deadT / 0.55); pp.root.rotation.x = -k * k * 1.5;
    pp.legs.forEach(l => { l.hip.rotation.x = lerp(l.hip.rotation.x, -0.3, dt * 4); l.kn.rotation.x = lerp(l.kn.rotation.x, 0.6, dt * 4); });
    return;
  }
  pp.root.rotation.y = e.yaw;
  const [L, R] = pp.arms;
  if (e.stun > 0) { pp.head.rotation.z = Math.sin(S.time * 40) * 0.3; pp.chest.rotation.x = e.lean + 0.3; }
  else if (e.state === 'idle') {
    e.ph += dt * 0.6; pp.chest.rotation.x = 0.55 + Math.sin(e.ph) * 0.05; pp.head.rotation.x = 0.5; pp.head.rotation.z = Math.sin(e.ph * 1.7) * 0.2;
    L.sh.rotation.set(Math.sin(e.ph) * 0.08, 0, 0); R.sh.rotation.set(Math.sin(e.ph + 1) * 0.08, 0, 0); L.el.rotation.x = R.el.rotation.x = -0.05;
  } else {
    e.ph += dt * (moveSp > 0.2 ? moveSp * 2.1 : 2);
    animWalk(pp, e.ph, moveSp > 0.2 ? Math.min(1.2, moveSp / 3.5) : 0.15, false);
    pp.chest.rotation.x = e.lean + Math.sin(e.ph * 2) * 0.05 + (e.twitch > 0 ? -0.4 : 0);
    if (Math.random() < dt * 2) pp.head.rotation.z = rand(-0.6, 0.6);
    pp.head.rotation.x = -0.2 - e.lean * 0.5;
    if (pp.jaw) pp.jaw.scale.y = 1 + Math.abs(Math.sin(S.time * 9 + e.ph)) * 1.5;
    if (e.state === 'windup') { const k = 1 - e.t / e.windup; L.sh.rotation.set(-1.4 - k * 1.4, 0, 0.3); R.sh.rotation.set(-1.4 - k * 1.4, 0, -0.3); L.el.rotation.x = R.el.rotation.x = -0.6; }
    else if (e.state === 'recover') { L.sh.rotation.set(-0.5, 0, 0.2); R.sh.rotation.set(-0.5, 0, -0.2); L.el.rotation.x = R.el.rotation.x = -0.2; }
    else if (e.type === 'runner') { const s = Math.sin(e.ph); L.sh.rotation.set(-0.4 + s * 0.9, 0, 0.1); R.sh.rotation.set(-0.4 - s * 0.9, 0, -0.1); L.el.rotation.x = R.el.rotation.x = -0.5; }
    else { const s = Math.sin(e.ph) * 0.18; L.sh.rotation.set(-1.25 + s, 0, 0.12); R.sh.rotation.set(-1.25 - s, 0, -0.12); L.el.rotation.x = R.el.rotation.x = -0.25; }
  }
  pp.root.updateMatrixWorld(true); updateHitboxes(e);
}

// ================================================================ boss: The Other Eric
function spawnBoss() {
  const a = anchorChar();
  let x = a.pos.x - Math.sin(a.yaw) * 24, z = a.pos.z - Math.cos(a.yaw) * 24;
  if (blocked(x, z, 1.2) || Math.hypot(x, z) > 88) { x = 0; z = -55; }
  const e = newEnemy('boss', nextId++, 2.2, x, z);
  e.yaw = Math.atan2(a.pos.x - x, a.pos.z - z);
  sfx('roar', e.pos); ev('light');
}
function simBoss(e, dt) {
  const p = e.pos;
  if (e.dead) return 0;
  const T = targetable(); if (!T.length) return 0;
  let tc = T[0], best = 1e9; for (const c of T) { const d = c.pos.distanceToSquared(p); if (d < best) { best = d; tc = c; } }
  const dx = tc.pos.x - p.x, dz = tc.pos.z - p.z, dist = Math.hypot(dx, dz) || 0.001, face = Math.atan2(dx, dz);
  e.twitch = Math.max(0, e.twitch - dt);
  let moveSp = 0;
  if (e.stun > 0) e.stun -= dt;
  else switch (e.state) {
    case 'intro': e.t -= dt; e.yaw = face; if (e.t <= 0) e.state = 'chase'; break;
    case 'chase':
      moveSp = 3.9; e.yaw += wrapA(face - e.yaw) * Math.min(1, dt * 4);
      e.chargeT -= dt; e.summonT -= dt;
      if (dist < 3.4) { e.state = 'windup'; e.t = 0.6; sfx('growl', p, 0.5); }
      else if (e.chargeT <= 0 && dist > 7 && dist < 28) { e.state = 'tele'; e.t = 0.95; sfx('roar', p); }
      else if (e.summonT <= 0) { e.state = 'summon'; e.t = 1.6; e.summonT = rand(13, 17); sfx('scream', p, 0.6); }
      if (dist > 42) { // it doesn't walk. it arrives.
        const b = -tc.yaw + Math.PI + rand(-0.6, 0.6), nx = tc.pos.x + Math.sin(b) * 12, nz = tc.pos.z - Math.cos(b) * 12;
        if (!blocked(nx, nz, 1)) { p.x = nx; p.z = nz; ev('static', [0.8]); sfx('sting', null, 0.7); }
      }
      break;
    case 'tele': e.t -= dt; e.yaw = face; if (e.t <= 0) { e.state = 'charge'; e.t = 1.15; e.cdx = dx / dist; e.cdz = dz / dist; } break;
    case 'charge':
      e.t -= dt; p.x += e.cdx * 17 * dt; p.z += e.cdz * 17 * dt; moveSp = 17;
      for (const c of T) if (c.pos.distanceTo(p) < 2.4) { hitChar(c, 32, p, 14); e.state = 'recover'; e.t = 1.1; e.chargeT = rand(7, 10); }
      if (e.state === 'charge' && e.t <= 0) { e.state = 'recover'; e.t = 1.3; e.chargeT = rand(7, 10); }
      break;
    case 'windup': e.t -= dt; e.yaw += wrapA(face - e.yaw) * Math.min(1, dt * 6);
      if (e.t <= 0) { if (dist < 4.4) hitChar(tc, 28, p); sfx('whoosh'); e.state = 'recover'; e.t = 0.8; } break;
    case 'summon': e.t -= dt; if (e.t <= 0) { for (let i = 0; i < 3; i++) spawnAround('runner', 12, 20, false); e.state = 'chase'; } break;
    case 'recover': e.t -= dt; moveSp = 1; if (e.t <= 0) e.state = 'chase'; break;
  }
  if (e.state !== 'charge' && moveSp > 0 && dist > 2.5) { p.x += dx / dist * moveSp * dt; p.z += dz / dist * moveSp * dt; }
  p.addScaledVector(e.kb, dt); e.kb.multiplyScalar(Math.exp(-6 * dt));
  resolve(p, 0.8);
  return moveSp;
}
function animBoss(e, dt, sp) {
  const pp = e.p, [L, R] = pp.arms;
  if (e.dead) {
    e.deadT += dt; const k = Math.min(1, e.deadT / 1.4);
    pp.root.rotation.x = -k * k * 1.45; pp.root.rotation.z = Math.sin(e.deadT * 30) * 0.03 * (1 - k);
    if (e.deadT < 2 && Math.random() < dt * 20) emit(e.chestPos, 4, PM.blood, 4, 0.08, 1.2);
    return;
  }
  pp.root.rotation.y = e.yaw;
  e.ph += dt * (sp > 0.2 ? 1 + sp * 0.9 : 1);
  animWalk(pp, e.ph, sp > 0.2 ? Math.min(1.3, sp / 3) : 0.1, false);
  if (e.stun > 0) pp.head.rotation.z = Math.sin(S.time * 30) * 0.4;
  else if (e.state === 'intro' || e.state === 'tele') { L.sh.rotation.set(-0.3, 0, 1.3); R.sh.rotation.set(-0.3, 0, -1.3); pp.chest.rotation.x = -0.3; pp.head.rotation.z = Math.sin(S.time * 3) * 0.5; }
  else if (e.state === 'windup') { const k = 1 - e.t / 0.6; L.sh.rotation.set(-1.4 - k * 1.5, 0, 0.3); R.sh.rotation.set(-1.4 - k * 1.5, 0, -0.3); }
  else if (e.state === 'summon') { pp.chest.rotation.x = -0.5; pp.head.rotation.x = -0.6; L.sh.rotation.set(-2.6, 0, 0.6); R.sh.rotation.set(-2.6, 0, -0.6); }
  else {
    pp.chest.rotation.x = e.state === 'charge' ? 0.7 : 0.15 + Math.sin(e.ph * 2) * 0.04;
    const s = Math.sin(e.ph) * 0.3; L.sh.rotation.set(-0.3 + s, 0, 0.25); R.sh.rotation.set(-0.3 - s, 0, -0.25); L.el.rotation.x = R.el.rotation.x = -0.4;
    pp.head.rotation.x = 0; if (Math.random() < dt * 3) pp.head.rotation.z = rand(-0.5, 0.5);
  }
  if (pp.jaw) pp.jaw.scale.y = 1.5 + Math.abs(Math.sin(S.time * 6)) * 2;
  pp.root.updateMatrixWorld(true); updateHitboxes(e);
}
function bossDefeated() {
  S.phase = 'escape'; S.escT = 9; S.slowmo = 1.6;
  sfx('roar', boss.pos); ev('light');
  ev('msg', ['IT IS DONE', 'The Other Eric is gone.', 4]);
  for (const e of enemies) if (!e.dead && !e.boss) { e.dead = true; e.deadT = rand(-0.5, 0); ev('kill', [e.id, 0, 0, 0]); }
  for (const c of [CH.eric, CH.sean]) if (c.down) { c.down = false; c.hp = 30; }
  sayAll('SEAN', "Is it dead? Tell me it's dead.", 1.5);
  sayAll('ERIC', 'It had my face, Sean. It had my face.');
  sayAll('RADIO', 'Route 9, this is County Rescue. We see your light. Coming down.');
  ev('heli', [true]);
}

// ================================================================ damage to players
function hitChar(c, dmg, from, push = 5) {
  if (S.phase === 'escape' || c.down || c.dead) return;
  if (c.dodgeT > 0) { if (c === P) toast('DODGED'); else ev('toast', ['DODGED'], c.id); return; }
  if (S.mode === 'solo' && c === CH.sean) { hitSeanAI(dmg * 0.6); return; }
  c.hp -= dmg; c.regenT = 5;
  emit(tmp.set(c.pos.x, 1.3, c.pos.z), 8, PM.blood, 3, 0.05, 0.8);
  const fx = from ? from.x : c.pos.x, fz = from ? from.z : c.pos.z;
  if (c === P) localHurt(fx, fz, push); else ev('hurt', [+fx.toFixed(2), +fz.toFixed(2)], c.id);
  if (c.hp <= 0) {
    c.hp = 0;
    if (S.mode === 'solo') playerDie();
    else {
      c.down = true;
      if (c === P) localDowned();
      sayAll(c.id === 'eric' ? 'ERIC' : 'SEAN', c.id === 'eric' ? "I'm down! Sean, help me up!" : "I'm down! Eric! ERIC!");
      if (CH.eric.down && CH.sean.down) ev('end', [false, 'both']);
    }
  }
}
function localHurt(fx, fz, push = 5) {
  P.trauma = Math.min(1, P.trauma + 0.45); P.hurtFx = 1; SFX.hurt();
  const dx = P.pos.x - fx, dz = P.pos.z - fz, d = Math.hypot(dx, dz) || 1; P.vel.x += dx / d * push; P.vel.z += dz / d * push;
}
function localDowned() { bigMsg("YOU'RE DOWN", `Hold on. ${O.name.split(' ')[0]} can help you up.`, 5); SFX.sting(0.6); }
function localRevived() { bigMsg('BACK UP', '', 2); }
function localGot(type) {
  SFX.pickup();
  if (type === 'ammo') { P.w.res = Math.min(P.wdef.resMax, P.w.res + P.wdef.pickup); toast(`+${P.wdef.pickup} ${P.wdef.unit}`); }
  else toast('+40 HEALTH');
}

// ================================================================ Sean as an AI partner (solo)
const BARKS = {
  kill: ['Got one!', 'Stay down!', 'That one had teeth, Eric. TEETH.', 'Nice. Nice nice nice.', "I'm never driving at night again."],
  idle: ['Eric, your jacket is covered in... something.', 'Keep the light on. Please keep the light on.', 'Did that one just say your name?', 'Why does everything here know you, man?', "Hey Kosoy. If we get out, you're buying breakfast."],
  hurt: ["I'm hit!", 'Get it off me!', 'Eric! Help!'],
};
function seanBark(kind) { const s = CH.sean; if (s.barkT > 0) return; s.barkT = 7; say('SEAN', pick(BARKS[kind])); }
function hitSeanAI(d) {
  const s = CH.sean; if (s.ai !== 'free' || s.down) return;
  s.hp -= d; emit(tmp.set(s.pos.x, 1.3, s.pos.z), 6, PM.blood, 3, 0.05, 0.8);
  if (Math.random() < 0.3) { s.barkT = 0; seanBark('hurt'); }
  if (s.hp <= 0) { s.hp = 0; s.down = true; say('SEAN', "I'm down! Eric, I'm down!"); }
}
function updateSeanAI(dt) {
  const s = CH.sean, pp = s.person, [L, R] = pp.arms; s.barkT -= dt;
  if (s.ai === 'captive') {
    s.struggle += dt; pistol.g.visible = false; pp.body.position.y = -0.42;
    pp.legs.forEach(l => { l.hip.rotation.x = -0.1; l.kn.rotation.x = 1.55; });
    L.sh.rotation.set(0.6, 0, 0.35); R.sh.rotation.set(0.6, 0, -0.35); L.el.rotation.x = R.el.rotation.x = -0.9;
    pp.chest.rotation.x = 0.3 + Math.sin(s.struggle * 1.3) * 0.05; pp.head.rotation.x = 0.45 + Math.sin(s.struggle * 0.7) * 0.1;
    pp.chest.rotation.z = Math.sin(s.struggle * 5) * (Math.sin(s.struggle * 0.4) > 0.7 ? 0.12 : 0.01);
    return;
  }
  if (s.down) { pistol.g.visible = false; poseDown(pp, S.time); return; }
  pistol.g.visible = true; pp.body.position.y = 0; pp.chest.rotation.z = 0; pp.head.rotation.z = 0;
  const E = CH.eric, fx = -Math.sin(E.yaw), fz = -Math.cos(E.yaw), rx = Math.cos(E.yaw), rz = -Math.sin(E.yaw);
  const tx = E.pos.x - rx * 1.7 - fx * 1.9, tz = E.pos.z - rz * 1.7 - fz * 1.9;
  const dx = tx - s.pos.x, dz = tz - s.pos.z; let d = Math.hypot(dx, dz);
  if (E.pos.distanceTo(s.pos) > 38 && !blocked(tx, tz, 0.5)) { s.pos.set(tx, 0, tz); d = 0; }
  s.seekT -= dt;
  if (s.seekT <= 0) {
    s.seekT = 0.3; s.target = null; let best = 22;
    for (const e of enemies) {
      if (e.dead || e.state === 'idle') continue; const ed = e.pos.distanceTo(s.pos); if (ed >= best) continue;
      tmp.set(s.pos.x, 1.45, s.pos.z); tmp2.subVectors(e.chestPos, tmp); const l = tmp2.length(); tmp2.normalize();
      if (rayBlock(tmp, tmp2, l)) continue; best = ed; s.target = e;
    }
  }
  const t = s.target && !s.target.dead ? s.target : null;
  let speed = 0;
  if (d > 0.7) { speed = d > 6 ? 6.6 : d > 2.5 ? 4.4 : 2.2; if (t) speed *= 0.75; s.pos.x += dx / d * speed * dt; s.pos.z += dz / d * speed * dt; }
  resolve(s.pos, 0.35);
  let ty = speed > 0.5 ? Math.atan2(dx, dz) : s.modelYaw;
  if (t) ty = Math.atan2(t.pos.x - s.pos.x, t.pos.z - s.pos.z);
  s.modelYaw += wrapA(ty - s.modelYaw) * Math.min(1, dt * 9); pp.root.rotation.y = s.modelYaw;
  s.yaw = s.modelYaw + Math.PI; s.pitch = 0;
  s.ph += dt * speed * 2; animWalk(pp, s.ph, Math.min(1.2, speed / 4.4), true);
  s.fireT -= dt; s.aimT -= dt;
  if (t) {
    s.aimT = 0.8;
    if (s.fireT <= 0 && Math.abs(wrapA(ty - s.modelYaw)) < 0.3) {
      s.fireT = rand(0.5, 0.8);
      pp.root.updateMatrixWorld(true); pistol.muzzle.getWorldPosition(tmp);
      showFlash(sFlash, tmp, 0.35); SFX.pistol(tmp);
      const hit = Math.random() < 0.72;
      const end = hit ? t.chestPos.clone() : t.chestPos.clone().add(new V3(rand(-1, 1), rand(-0.5, 1), rand(-1, 1)));
      tracer(tmp, end, 0.015);
      if (hit) { tmp2.subVectors(end, tmp).normalize(); emit(end, 4, PM.blood, 2.5, 0.05, 0.6, { dir: tmp2 }); damageEnemy(t, t.boss ? 20 : 26, tmp2.clone(), Math.random() < 0.12, null, 'ai'); }
      wakeNear(s.pos, 20);
    }
  }
  if (s.aimT > 0) {
    L.sh.rotation.set(-1.45, 0, 0.45); R.sh.rotation.set(-1.5, 0, -0.05); L.el.rotation.x = -0.25; R.el.rotation.x = -0.05;
    pistol.g.position.set(0.04, 0.42, 0.5); pistol.g.rotation.set(0, 0, 0); pp.chest.rotation.x = 0;
  } else { pistol.g.position.set(0.24, -0.02, 0.1); pistol.g.rotation.set(1.3, 0, 0); pp.chest.rotation.x = 0.08; }
  if (!t && s.barkT < -10 && Math.random() < dt * 0.05) seanBark('idle');
}

// ================================================================ the stalker (local to each player)
const stalker = { p: buildPerson({ ...OTHER_LOOK, scale: 0.92 }), on: false, t: 0, cd: 38, seen: 0 };
scene.add(stalker.p.root); stalker.p.root.visible = false;
function lookDot(p) { tmp.subVectors(p, camera.position); tmp.y = 0; tmp.normalize(); return tmp.x * -Math.sin(P.yaw) + tmp.z * -Math.cos(P.yaw); }
function updateStalker(dt) {
  const st = stalker;
  if (!['intro', 'explore', 'tower'].includes(S.phase)) { if (st.on) { st.on = false; st.p.root.visible = false; } return; }
  if (!st.on) {
    st.cd -= dt; if (st.cd > 0) return;
    const b = -P.yaw + rand(-0.45, 0.45), r = rand(22, 30);
    const x = P.pos.x + Math.sin(b) * r, z = P.pos.z - Math.cos(b) * r;
    if (blocked(x, z, 0.8) || Math.hypot(x, z) > 90) { st.cd = 2; return; }
    st.on = true; st.t = 0; st.seen = 0; st.p.root.position.set(x, 0, z); st.p.root.visible = true;
    return;
  }
  st.t += dt;
  const p = st.p.root.position, d = p.distanceTo(P.pos);
  st.p.root.rotation.y = Math.atan2(P.pos.x - p.x, P.pos.z - p.z);
  st.p.head.rotation.z = Math.sin(st.t * 0.8) * 0.25;
  if (lookDot(p) > 0.985) st.seen += dt;
  if (st.seen > 0.35 || d < 13 || st.t > 10) {
    st.on = false; st.p.root.visible = false; st.cd = rand(32, 55);
    if (st.seen > 0.35 || d < 13) { SFX.sting(0.55); staticFx(0.6); if (Math.random() < 0.5) say('???', pick(['Eric.', 'Eric... Kosoy.', 'I wear it better.', 'Come home, Eric.'])); }
  }
}

// ================================================================ pickups, fuses, notes
const pickups = [];
let nextPick = 1;
const pickGeo = { ammo: BOX(0.42, 0.24, 0.26), health: BOX(0.42, 0.3, 0.3) };
const pickMat = { ammo: M(0x7a1810, { emissive: 0x401008, emissiveIntensity: 0.6 }), health: M(0xd8d4cc, { emissive: 0x303030, emissiveIntensity: 0.5 }) };
const crossMat = glow(1.6, 0.1, 0.1, true), stripeMat = glow(1.3, 0.95, 0.3, true);
function pickupMesh(type, x, z) {
  const g = new THREE.Group(); g.position.set(x, 0.4, z); scene.add(g);
  mesh(pickGeo[type], pickMat[type], 0, 0, 0, g, false);
  if (type === 'health') { mesh(BOX(0.22, 0.06, 0.31), crossMat, 0, 0, 0.001, g, false); mesh(BOX(0.06, 0.22, 0.31), crossMat, 0, 0, 0.001, g, false); }
  else mesh(BOX(0.43, 0.05, 0.27), stripeMat, 0, 0.04, 0, g, false);
  return g;
}
function addPickup(type, x, z, id = nextPick++) { pickups.push({ id, type, g: pickupMesh(type, x, z), t: rand(0, 6) }); }

export const FUSES = [
  { x: -31.4, z: 60.6, name: 'GAS STATION' }, { x: 30.6, z: 42.6, name: 'PLAYGROUND' }, { x: 45, z: -33, name: 'GRAVEYARD' }, { x: -55.8, z: -17.6, name: 'CABIN' },
];
const fuseGlass = M(0x221500, { emissive: 0xffb020, emissiveIntensity: 3 });
const beamMat = new THREE.MeshBasicMaterial({ color: 0xffb040, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, fog: false, depthWrite: false });
FUSES.forEach(f => {
  const g = new THREE.Group(); g.position.set(f.x, 0.7, f.z); scene.add(g);
  mesh(new THREE.CylinderGeometry(0.09, 0.09, 0.32, 10), fuseGlass, 0, 0, 0, g, false);
  for (const y of [-0.19, 0.19]) mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 10), metalMat, 0, y, 0, g, false);
  mesh(new THREE.CylinderGeometry(0.25, 0.25, 70, 8, 1, true), beamMat, 0, 35, 0, g, false);
  f.g = g; f.taken = false;
});
const NOTES = [
  { x: -21.4, z: 55.6, t: "CLERK'S LOG", x2: 'Mar 3. Everybody in town keeps saying one name. Some fella named Eric. Nobody here is named Eric. By Friday they were saying it in HIS voice.' },
  { x: 27.4, z: 37.2, t: 'CRAYON DRAWING', x2: 'the tall man asked me which one of us is eric. i said nobody. he said not yet.' },
  { x: -57.6, z: -23.4, t: "HUNTER'S JOURNAL", x2: "It doesn't kill you. It practices you. Your walk first. Then your voice. Then your face. When it's good enough, it doesn't need you anymore." },
  { x: 25.6, z: -6.2, t: 'TORN HYMNAL PAGE', x2: 'It cannot abide the light. Bring light to the tower on the hill and the sky will answer. Hold until it does.' },
  { x: 4.2, z: -72.8, t: "TECHNICIAN'S NOTE", x2: "Transmitter needs all four fuses. Once it's live it needs a full minute to reach County. They hear it too. They will come for the noise." },
];
const noteMat = M(0xe8e0cc, { emissive: 0x605848, emissiveIntensity: 0.7 });
NOTES.forEach(n => { n.m = mesh(new THREE.PlaneGeometry(0.3, 0.4), noteMat, n.x, 0.03, n.z, scene, false); n.m.rotation.set(-Math.PI / 2, 0, rand(0, 6)); n.taken = false; });

function takeFuse(f, by) {
  f.taken = true; scene.remove(f.g); S.fuses++; sfx('fuse');
  ev('msg', [`FUSE ${S.fuses} / 4`, f.name, 3]);
  switch (S.fuses) {
    case 1: sayAll('ERIC', 'One fuse. Three to go.'); horde(3); break;
    case 2:
      ev('blackout', [7]); sfx('sting');
      setTimeout(() => { // something right behind whoever grabbed it
        const b = -by.yaw + Math.PI, x = by.pos.x + Math.sin(b) * 4.5, z = by.pos.z - Math.cos(b) * 4.5;
        if (!blocked(x, z, 0.5)) { const e = makeEnemy('runner', x, z); e.yaw = b + Math.PI; sfx('scream', e.pos, 1.4); }
      }, 900);
      horde(3); sayAll('ERIC', 'No no no, not the lights—', 0.5); break;
    case 3: ev('light'); sayAll('???', 'Eric... you dropped something.'); horde(4); break;
    case 4: sayAll('ERIC', "That's all four. Tower's north, end of the road."); horde(5); break;
  }
  checkExplore();
}
function checkExplore() {
  if (S.phase !== 'explore') return;
  if (S.fuses >= 4 && S.sean) { S.phase = 'tower'; ev('msg', ['THE RADIO TOWER', 'Start the transmitter', 3.5]); sayAll('SEAN', 'Go go go, tower, now!', 1); }
  else if (S.fuses >= 4) sayAll('ERIC', S.story === 'solo' ? 'Not leaving without Sean. Church first.' : "Whatever's at that church, it's between us and the tower.", 2);
}

// ================================================================ interactions
const ACTS = {
  walkie: () => {
    if (S.walkie) return;
    S.walkie = true; scene.remove(walkie); S.phase = 'explore'; sfx('pickup');
    if (S.story === 'solo') {
      sayAll('SEAN', 'Eric?! Eric, can you hear me? Pick up, man!');
      sayAll('SEAN', "They dragged me to the church. There's a thing... it has your face. It has YOUR face, Eric.");
      sayAll('SEAN', 'The radio tower north of town. It needs fuses, four of them. Get them, then come get me—');
      sayAll('RADIO', '*static*');
      sayAll('ERIC', "Hang on, Sean. I'm coming.");
      ev('msg', ['FIND SEAN', 'Collect four fuses · The church is east of the road', 4]);
    } else {
      sayAll('???', 'Eric. Come to the church. Bring your friend.');
      sayAll('SEAN', 'Nope. Nope nope nope.');
      sayAll('ERIC', 'There are tower schematics taped to this crate. Four fuses, and it runs.');
      sayAll('SEAN', 'Fuses, then the church, then we leave this town forever. Deal?');
      ev('msg', ['THE BROADCAST', 'Collect four fuses · Something waits at the church', 4]);
    }
  },
  sean: () => { // solo: cut Sean loose
    const s = CH.sean; if (s.ai !== 'captive') return;
    s.ai = 'free'; s.hp = 100; S.sean = true; SFX.fuse(); SFX.sting(0.8);
    bigMsg('SEAN PERRIUS', 'joins you', 3);
    say('SEAN', 'Eric! Took you long enough!');
    say('ERIC', 'You can thank Kosoy later. Can you shoot?');
    say('SEAN', "I found a pistol and I have bad ideas. Let's go.");
    churchAmbush(); checkExplore();
  },
  circle: () => { // co-op: break the ritual circle
    if (S.sean) return;
    S.sean = true; sfx('sting', null, 0.8); ev('static', [0.6]);
    ev('msg', ['THE CIRCLE', 'It was waiting for both of you', 3]);
    sayAll('SEAN', 'Eric. It set out a candle for each of us. Why does it have a candle for each of us?');
    sayAll('ERIC', 'Kick them over. Kick them ALL over.');
    churchAmbush(); checkExplore();
  },
  revive: by => {
    const other = by === 'eric' ? CH.sean : CH.eric; if (!other.down) return;
    other.down = false; other.hp = S.mode === 'solo' ? 60 : 50;
    if (other === P) localRevived();
    sayAll(other.id === 'eric' ? 'ERIC' : 'SEAN', other.id === 'eric' ? 'Thanks. Thought that was it.' : 'Thanks, man. Thought I was a goner.');
  },
  tower: () => {
    if (S.phase !== 'tower') return;
    S.phase = 'hold'; S.holdT = 0; ev('tower'); sfx('fuse'); sfx('radio');
    ev('msg', ['TRANSMITTING', 'Hold the tower for 60 seconds', 3.5]);
    sayAll('ERIC', 'Mayday, mayday. Route 9, Hollow Creek. Two survivors. Anybody.');
    sayAll('SEAN', 'Eric... the whole town just turned toward us.');
    addPickup('ammo', 3, -74); addPickup('ammo', -3, -77); addPickup('health', 2, -84);
    horde(5, 18, 28); S.spawnT = 2;
  },
};
function churchAmbush() {
  for (let i = 0; i < 5; i++) spawnAround(i < 3 ? 'hollow' : 'runner', 12, 20, false, CH.eric);
  for (const en of enemies) if (en.state === 'idle' && en.pos.distanceTo(CIRCLE) < 20) wake(en);
}
function interactables(ch) {
  const L = [];
  if (!S.walkie) L.push({ id: 'walkie', pos: walkie.position, r: 2.4, label: S.story === 'solo' ? 'Pick up the walkie-talkie' : 'Pick up the broadcasting walkie-talkie', hold: 0 });
  if (S.story === 'solo' && CH.sean.ai === 'captive') L.push({ id: 'sean', pos: CH.sean.pos, r: 2.6, label: 'Cut Sean free', hold: 1.4 });
  if (S.story === 'coop' && !S.sean && S.walkie) L.push({ id: 'circle', pos: CIRCLE, r: 3, label: 'Break the ritual circle', hold: 1.4 });
  const other = ch === CH.eric ? CH.sean : CH.eric;
  if (other.down) L.push({ id: 'revive', pos: other.pos, r: 2.4, label: `Help ${other.name.split(' ')[0][0] + other.name.split(' ')[0].slice(1).toLowerCase()} up`, hold: 1.6 });
  if (S.phase === 'tower') L.push({ id: 'tower', pos: towerPanel.pos, r: 2.6, label: 'Start the transmitter', hold: 1.2 });
  else if (S.phase === 'explore' || S.phase === 'intro') L.push({ id: 'towerx', pos: towerPanel.pos, r: 2.6, label: `Transmitter dead. Fuses ${S.fuses}/4${S.sean ? '' : S.story === 'solo' ? ' · Find Sean first' : ' · The church first'}`, info: true });
  return L;
}
function doAct(id) { if (S.mode === 'guest') send({ t: 'act', id }); else ACTS[id](P.id); }
let ePrev = false, holdK = 0, holdId = null;
function updateInteract(dt) {
  let best = null, bd = 99;
  for (const it of interactables(P)) { const d = Math.hypot(it.pos.x - P.pos.x, it.pos.z - P.pos.z); if (d < it.r && d < bd) { bd = d; best = it; } }
  const e = !!INPUT.keys.KeyE && !S.paused;
  if (!best || P.down || P.dead) { $('prompt').style.opacity = 0; holdK = 0; ePrev = e; return; }
  $('prompt').style.opacity = 1;
  $('ptxt').innerHTML = best.info ? best.label : `<kbd>E</kbd>${best.label}`;
  $('pbar').style.display = best.hold ? 'block' : 'none';
  if (holdId !== best.id) { holdK = 0; holdId = best.id; }
  if (!best.info) {
    if (best.hold === 0) { if (e && !ePrev) doAct(best.id); }
    else if (e) { holdK += dt / best.hold; if (holdK >= 1) { holdK = 0; doAct(best.id); } }
    else holdK = Math.max(0, holdK - dt * 2);
  }
  $('pbf').style.width = (holdK * 100) + '%';
  ePrev = e;
}

// ================================================================ local player: shooting
function fire() {
  const w = P.w, d = P.wdef;
  if (w.cool > 0 || P.dodgeT > 0 || P.down || P.dead || S.paused) return;
  if (w.reloading) { if (w.mag > 0 && d.each) w.reloading = false; else return; }
  if (w.mag <= 0) { SFX.empty(); w.cool = 0.35; if (w.res > 0) startReload(); else toast(`OUT OF ${d.unit}`); return; }
  w.mag--; w.cool = d.cool; S.shots++;
  if (d.pump) { w.pumpT = 0.0001; w.pumped = false; }
  P.fireRecent = 1.2; P.modelYaw = P.yaw + Math.PI; P.person.root.rotation.y = P.modelYaw;
  P.trauma = Math.min(1, P.trauma + 0.3 * d.kick); w.kick = 1; P.pitch += 0.035 * d.kick;
  if (d.pump) SFX.shot(); else SFX.pistolMine();
  if (isHostLike()) wakeNear(P.pos, 40);
  animChar(P, 0); P.person.root.updateMatrixWorld(true); P.gun.muzzle.getWorldPosition(muzzleW);
  showFlash(P.flashSprite, muzzleW, d.flash); muzzleLight.position.copy(muzzleW); muzzleLight.intensity = 80 * d.kick;
  if (!d.pump) emit(muzzleW, 1, PM.brass, 2.5, 0.03, 1, { dir: new V3(Math.cos(P.yaw), 0.8, -Math.sin(P.yaw)) });
  const f = camFwdOf(P, camF).clone(), r = new V3(Math.cos(P.yaw), 0, -Math.sin(P.yaw)), u = new V3().crossVectors(r, f);
  const t0 = Math.max(0, tmp.set(P.pos.x - camera.position.x, 1.4 - camera.position.y, P.pos.z - camera.position.z).dot(f));
  const origin = camera.position.clone().addScaledVector(f, t0);
  const spread = lerp(d.spread[0], d.spread[1], P.aimK);
  const hits = new Map(), pts = []; let anyHit = false;
  for (let i = 0; i < d.pellets; i++) {
    const a = rand(0, Math.PI * 2), m = Math.sqrt(Math.random()) * spread;
    const dir = f.clone().addScaledVector(r, Math.cos(a) * m).addScaledVector(u, Math.sin(a) * m).normalize();
    const res = traceShot(origin, dir, 70);
    let kind = 0;
    if (res.enemy) {
      let h = hits.get(res.enemy); if (!h) { h = { dmg: 0, head: false, pt: res.point, dir }; hits.set(res.enemy, h); }
      h.dmg += d.dmg * (res.head ? (d.pump ? 2 : 2.5) : 1) * clamp(1.15 - res.t / d.falloff, 0.35, 1); if (res.head) h.head = true;
      emit(res.point, 3, PM.blood, 3, 0.05, 0.7, { dir }); anyHit = true; kind = 1;
    } else if (res.world) { emit(res.point, 3, PM.spark, 4, 0.025, 0.25, { grav: 0.4 }); kind = 2; }
    else if (res.ground) { emit(res.point, 2, PM.dust, 2, 0.05, 0.4); kind = 3; }
    if (i < 4) { tracer(muzzleW, res.point, d.pump ? 0.02 : 0.015); pts.push([+res.point.x.toFixed(2), +res.point.y.toFixed(2), +res.point.z.toFixed(2), kind]); }
  }
  if (anyHit) S.hits++;
  const shotMsg = { mz: [+muzzleW.x.toFixed(2), +muzzleW.y.toFixed(2), +muzzleW.z.toFixed(2)], pts };
  if (S.mode === 'guest') {
    hits.forEach((h, e) => { send({ t: 'dmg', id: e.id, d: +h.dmg.toFixed(1), x: +h.dir.x.toFixed(2), z: +h.dir.z.toFixed(2), h: h.head ? 1 : 0 }); SFX.flesh(h.pt); hitMark('hit'); });
    send({ t: 'shot', ...shotMsg });
  } else {
    hits.forEach((h, e) => damageEnemy(e, h.dmg, h.dir, h.head, h.pt, P.id));
    if (S.mode === 'host') ev('rshot', [P.id, shotMsg], 'sean');
  }
}
function showRemoteShot(c, m) {
  if (!c) return;
  const mz = new V3().fromArray(m.mz);
  showFlash(c.flashSprite, mz, c.wdef.flash);
  if (c.wdef.pump) SFX.shotAt(mz); else SFX.pistol(mz);
  for (const p of m.pts) {
    const end = new V3(p[0], p[1], p[2]); tracer(mz, end, c.wdef.pump ? 0.02 : 0.015);
    if (p[3] === 1) emit(end, 3, PM.blood, 3, 0.05, 0.7); else if (p[3] === 2) emit(end, 3, PM.spark, 4, 0.025, 0.25, { grav: 0.4 }); else if (p[3] === 3) emit(end, 2, PM.dust, 2, 0.05, 0.4);
  }
  c.fireRecent = 1.2; c.w.kick = 1; if (c.wdef.pump) c.w.pumpT = 0.0001;
}
function raySphere(o, d, c, r) {
  const ox = c.x - o.x, oy = c.y - o.y, oz = c.z - o.z, t = ox * d.x + oy * d.y + oz * d.z;
  if (t < 0) return null; const px = ox - d.x * t, py = oy - d.y * t, pz = oz - d.z * t, d2 = px * px + py * py + pz * pz;
  if (d2 > r * r) return null; return t - Math.sqrt(r * r - d2);
}
function traceShot(o, d, far) {
  let best = far, res = { t: far };
  const h = rayBlock(o, d, far); if (h) { best = h.distance; res = { world: true, t: best, point: h.point.clone() }; }
  if (d.y < -0.001) { const tg = -o.y / d.y; if (tg < best) { best = tg; res = { ground: true, t: tg, point: o.clone().addScaledVector(d, tg) }; } }
  for (const e of enemies) {
    if (e.dead) continue; const s = e.scale;
    let t = raySphere(o, d, e.headPos, 0.17 * s); if (t !== null && t < best) { best = t; res = { enemy: e, head: true, t }; }
    t = raySphere(o, d, e.chestPos, 0.32 * s); if (t !== null && t < best) { best = t; res = { enemy: e, head: false, t }; }
    t = raySphere(o, d, e.hipPos, 0.3 * s); if (t !== null && t < best) { best = t; res = { enemy: e, head: false, t }; }
  }
  if (!res.point) res.point = o.clone().addScaledVector(d, res.t);
  return res;
}
export function startReload() { const w = P.w; if (w.reloading || w.mag >= P.wdef.max || w.res <= 0 || P.down || P.dead) return; w.reloading = true; w.rT = P.wdef.reloadT; if (!P.wdef.each) SFX.mag(); }
export function fireFlare() {
  if (S.flareCd > 0 || P.down || P.dead) return;
  S.flareCd = 14; SFX.flare(); S.flareFx = 0.35;
  if (S.mode === 'guest') send({ t: 'flare' }); else applyFlare(P);
}
function applyFlare(c) {
  for (const e of enemies) {
    if (e.dead) continue; const d = e.pos.distanceTo(c.pos);
    if (d < 6 || (d < 16 && lookDotFor(c, e.pos) > 0.5)) {
      e.stun = e.boss ? 1.4 : 2.6; if (e.state === 'idle') e.state = 'chase';
      tmp.subVectors(e.pos, c.pos).setY(0).normalize(); damageEnemy(e, e.boss ? 60 : 20, tmp.clone(), false, null, c.id);
      if (!e.boss) e.kb.addScaledVector(tmp, 6);
    }
  }
}
export function dodge() {
  if (P.dodgeCd > 0 || P.stam < 25 || P.down || P.dead) return;
  const K = INPUT.keys, fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  let mx = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), mz = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
  if (!mx && !mz) mz = -1;
  P.dodgeDir.set(rx * mx + fx * mz, 0, rz * mx + fz * mz).normalize();
  P.dodgeT = 0.32; P.dodgeCd = 0.6; P.stam -= 25; SFX.whoosh(); SFX.step(true);
}
export function toggleFlash() { P.flashOn = !P.flashOn; SFX.empty(); }
export function look(dx, dy) { const s = 0.0022 * (INPUT.mouseR ? 0.6 : 1); P.yaw -= dx * s; P.pitch = clamp(P.pitch - dy * s, -0.9, 0.75); }

// ================================================================ local player: movement
function updateLocal(dt) {
  if (P.dead) { P.deadT += dt; P.person.root.rotation.x = -Math.min(1, P.deadT * 1.5) * 1.45; return; }
  if (P.down) { P.vel.multiplyScalar(0.85); P.w.reloading = false; animChar(P, dt); return; }
  const K = S.paused ? {} : INPUT.keys;
  if (K.ArrowLeft) P.yaw += dt * 2.2; if (K.ArrowRight) P.yaw -= dt * 2.2;
  if (K.ArrowUp) P.pitch += dt * 1.5; if (K.ArrowDown) P.pitch -= dt * 1.5;
  P.pitch = clamp(P.pitch, -0.9, 0.75);
  const fx = -Math.sin(P.yaw), fz = -Math.cos(P.yaw), rx = Math.cos(P.yaw), rz = -Math.sin(P.yaw);
  const mx = (K.KeyD ? 1 : 0) - (K.KeyA ? 1 : 0), mz = (K.KeyW ? 1 : 0) - (K.KeyS ? 1 : 0);
  let wx = rx * mx + fx * mz, wz = rz * mx + fz * mz; const wl = Math.hypot(wx, wz); if (wl > 0) { wx /= wl; wz /= wl; }
  const aimHeld = INPUT.mouseR && !S.paused;
  P.sprint = !!K.ShiftLeft && mz > 0 && !aimHeld && P.stam > 1 && wl > 0;
  const sp = aimHeld ? 2.7 : P.sprint ? 7.4 : 4.5;
  if (P.dodgeT > 0) { P.dodgeT -= dt; P.vel.set(P.dodgeDir.x * 12, 0, P.dodgeDir.z * 12); }
  else { const k = 1 - Math.exp(-dt * 11); P.vel.x = lerp(P.vel.x, wx * sp, k); P.vel.z = lerp(P.vel.z, wz * sp, k); }
  P.dodgeCd -= dt;
  P.pos.x += P.vel.x * dt; P.pos.z += P.vel.z * dt; resolve(P.pos, 0.38);
  P.stam = clamp(P.stam + (P.sprint ? -22 : 16) * dt, 0, 100);
  P.aimK = lerp(P.aimK, aimHeld && P.dodgeT <= 0 ? 1 : 0, 1 - Math.exp(-dt * 12));
  P.fireRecent -= dt;
  const spd = Math.hypot(P.vel.x, P.vel.z);
  let ty = P.modelYaw;
  if (P.aimK > 0.3 || P.fireRecent > 0 || P.w.reloading) ty = P.yaw + Math.PI; else if (spd > 0.6) ty = Math.atan2(P.vel.x, P.vel.z);
  P.modelYaw += wrapA(ty - P.modelYaw) * Math.min(1, dt * 12); P.person.root.rotation.y = P.modelYaw;
  // weapon
  const w = P.w, d = P.wdef;
  w.cool -= dt;
  if (w.reloading) {
    w.rT -= dt;
    if (w.rT <= 0) {
      if (d.each) { w.mag++; w.res--; SFX.shell(); w.rT = d.reloadT; if (w.mag >= d.max || w.res <= 0) { w.reloading = false; SFX.pump(); } }
      else { const n = Math.min(d.max - w.mag, w.res); w.mag += n; w.res -= n; w.reloading = false; SFX.mag(); }
    }
  }
  if (INPUT.mouseL && !S.paused) fire();
  if (K.KeyR) startReload();
  S.flareCd = Math.max(0, S.flareCd - dt);
  animChar(P, dt);
}
// Pose any human-controlled character (local or remote)
function animChar(C, dt) {
  const pp = C.person, d = C.wdef, g = C.gun;
  if (C.down) { g.g.visible = false; poseDown(pp, S.time); return; }
  g.g.visible = true; pp.root.rotation.x = 0; pp.chest.rotation.z = 0; pp.head.rotation.z = 0;
  const spd = Math.hypot(C.vel.x, C.vel.z);
  C.ph += dt * spd * 1.85;
  if (C === P) { const st = Math.floor(C.ph / Math.PI); if (st !== C.stepPh) { C.stepPh = st; if (spd > 1) SFX.step(C.sprint); } }
  animWalk(pp, C.ph, Math.min(1.25, spd / 4.5), true);
  const aiming = C.aimK > 0.3 || C.fireRecent > 0;
  const [L, R] = pp.arms;
  pp.chest.rotation.x = aiming ? -C.pitch * 0.8 : (C.sprint ? 0.22 : 0.04);
  pp.head.rotation.x = aiming ? 0 : -C.pitch * 0.4;
  if (d.pump) {
    if (C.w.reloading) { R.sh.rotation.set(-0.9, 0, -0.1); R.el.rotation.x = -0.6; L.sh.rotation.set(-0.5, 0, 0.45); L.el.rotation.x = -1.5 + Math.sin(S.time * 13) * 0.25; g.g.position.set(0.05, 0.25, 0.25); g.g.rotation.set(0.3, -0.3, 0.6); }
    else if (aiming) { R.sh.rotation.set(-1.48, 0, -0.1); R.el.rotation.x = -0.12; L.sh.rotation.set(-1.32, 0, 0.6); L.el.rotation.x = -0.3; g.g.position.set(0.1, 0.36, 0.12); g.g.rotation.set(0, 0, 0); }
    else { R.sh.rotation.set(-0.7, 0, -0.15); R.el.rotation.x = -0.75; L.sh.rotation.set(-0.85, 0, 0.5); L.el.rotation.x = -0.85; g.g.position.set(0.04, 0.2, 0.22); g.g.rotation.set(0.45, -0.55, 0); }
  } else {
    if (C.w.reloading) { R.sh.rotation.set(-1.0, 0, -0.2); R.el.rotation.x = -0.8; L.sh.rotation.set(-1.0, 0, 0.5); L.el.rotation.x = -0.9 + Math.sin(S.time * 10) * 0.2; g.g.position.set(0.05, 0.3, 0.35); g.g.rotation.set(0.8, 0, 0.4); }
    else if (aiming) { L.sh.rotation.set(-1.45, 0, 0.45); R.sh.rotation.set(-1.5, 0, -0.05); L.el.rotation.x = -0.25; R.el.rotation.x = -0.05; g.g.position.set(0.04, 0.42, 0.5); g.g.rotation.set(0, 0, 0); }
    else { R.sh.rotation.set(-0.15, 0, -0.08); R.el.rotation.x = -0.4; g.g.position.set(0.26, 0.0, 0.12); g.g.rotation.set(1.2, 0, 0); }
  }
  C.w.kick = Math.max(0, C.w.kick - dt * 6);
  g.g.position.z -= C.w.kick * 0.09 * d.kick; g.g.rotation.x -= C.w.kick * 0.3 * d.kick;
  if (d.pump && C.w.pumpT > 0) {
    C.w.pumpT += dt; const k = C.w.pumpT;
    if (k > 0.22 && k < 0.5) {
      g.pump.position.z = 0.38 - Math.sin((k - 0.22) / 0.28 * Math.PI) * 0.12;
      if (!C.w.pumped && k > 0.3) { C.w.pumped = true; if (C === P) { SFX.pump(); g.muzzle.getWorldPosition(tmp); tmp.y -= 0.05; emit(tmp, 1, PM.shell, 2.5, 0.05, 1.2, { dir: new V3(Math.cos(C.yaw), 0.8, -Math.sin(C.yaw)) }); } }
    }
    if (k >= 0.5) { C.w.pumpT = 0; g.pump.position.z = 0.38; C.w.pumped = false; }
  }
  if (C.dodgeT > 0) { pp.body.position.y = -0.3; pp.chest.rotation.x = 0.8; pp.legs.forEach(l => { l.hip.rotation.x = -1; l.kn.rotation.x = 1.6; }); }
}
// Mirror the other human player from network packets
function updateRemote(C, dt) {
  if (!C.net.has) { animChar(C, dt); return; }
  const k = 1 - Math.exp(-dt * 14), px = C.pos.x, pz = C.pos.z;
  C.pos.x = lerp(C.pos.x, C.net.tx, k); C.pos.z = lerp(C.pos.z, C.net.tz, k);
  if (Math.hypot(C.net.tx - C.pos.x, C.net.tz - C.pos.z) > 6) { C.pos.x = C.net.tx; C.pos.z = C.net.tz; }
  const vx = (C.pos.x - px) / Math.max(dt, 1e-4), vz = (C.pos.z - pz) / Math.max(dt, 1e-4);
  C.vel.x = lerp(C.vel.x, vx, 0.3); C.vel.z = lerp(C.vel.z, vz, 0.3);
  C.modelYaw += wrapA(C.net.my - C.modelYaw) * k; C.person.root.rotation.y = C.modelYaw;
  C.aimK = lerp(C.aimK, C.net.aim, k);
  C.fireRecent = C.net.fr ? Math.max(C.fireRecent, 0.2) : C.fireRecent - dt;
  C.dodgeT = Math.max(0, C.dodgeT - dt);
  animChar(C, dt);
}

// ================================================================ camera & flashlights
function updateCamera(dt) {
  const ox = lerp(0.62, 0.72, P.aimK), oy = lerp(0.28, 0.12, P.aimK), oz = lerp(3.3, 1.6, P.aimK);
  const f = camFwdOf(P, camF), r = camR.set(Math.cos(P.yaw), 0, -Math.sin(P.yaw));
  const low = P.dead || P.down;
  const piv = tmp.set(P.pos.x, P.pos.y + (low ? 0.6 : 1.55), P.pos.z);
  const want = tmp2.copy(piv).addScaledVector(r, ox).addScaledVector(f, -oz); want.y += oy;
  const dir = new V3().subVectors(want, piv), len = dir.length(); dir.normalize();
  const h = rayBlock(piv, dir, len + 0.3); if (h) want.copy(piv).addScaledVector(dir, Math.max(0.25, h.distance - 0.3));
  if (want.y < 0.3) want.y = 0.3;
  camera.position.copy(want);
  fill.position.copy(want).addScaledVector(r, -0.4); fill.position.y += 0.5;
  const tr = P.trauma * P.trauma;
  camera.rotation.set(P.pitch + rand(-1, 1) * tr * 0.05, P.yaw + rand(-1, 1) * tr * 0.05, rand(-1, 1) * tr * 0.04 + (low ? 0.3 : 0));
  P.trauma = Math.max(0, P.trauma - dt * 1.6);
  const fov = lerp(68, 50, P.aimK) + (P.sprint ? 6 : 0) + (P.dodgeT > 0 ? 4 : 0);
  if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = lerp(camera.fov, fov, 1 - Math.exp(-dt * 8)); camera.updateProjectionMatrix(); }
  // my flashlight
  const ffx = -Math.sin(P.yaw), ffz = -Math.cos(P.yaw);
  flash.position.set(P.pos.x + r.x * 0.25 + ffx * 0.35, low ? 0.5 : 1.45, P.pos.z + r.z * 0.25 + ffz * 0.35);
  flash.target.position.copy(camera.position).addScaledVector(f, 25);
  let fi = P.flashOn ? 95 : 0;
  let near = 99; for (const e of enemies) if (!e.dead) near = Math.min(near, e.pos.distanceTo(P.pos));
  if (near < 7 && Math.random() < 0.15) fi *= rand(0, 0.5);
  if (S.blackout > 5.5) fi *= Math.random() < 0.7 ? 0 : 1;
  if (S.flareFx > 0) { S.flareFx -= dt; fi = 95 + S.flareFx * 2400; }
  flash.intensity = fi;
  // partner's flashlight
  const o = O; let on = false;
  if (S.mode === 'solo') on = o.ai === 'free' && !o.down;
  else on = o.flashOn && !o.down;
  if (on) {
    const of = camFwdOf(o, tmp);
    flash2.position.set(o.pos.x + of.x * 0.6, 1.45, o.pos.z + of.z * 0.6);
    flash2.target.position.set(o.pos.x + of.x * 20, 1.45 + of.y * 20, o.pos.z + of.z * 20);
  }
  flash2.intensity = on ? 55 : 0;
  muzzleLight.intensity = Math.max(0, muzzleLight.intensity - dt * 1400);
  return near;
}

// ================================================================ host bookkeeping
function updatePickupsHost(dt) {
  const pickers = S.mode === 'host' ? [CH.eric, CH.sean] : [CH.eric];
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    for (const c of pickers) {
      if (c.down || Math.hypot(p.g.position.x - c.pos.x, p.g.position.z - c.pos.z) >= 1.3) continue;
      if (p.type === 'ammo') {
        const full = c === P ? c.w.res >= c.wdef.resMax : c.net.full; if (full) continue;
        if (c === P) localGot('ammo'); else ev('got', ['ammo'], c.id);
      } else {
        if (c.hp >= 100) continue; c.hp = Math.min(100, c.hp + 40);
        if (c === P) localGot('health'); else ev('got', ['health'], c.id);
        if (S.mode === 'solo' && CH.sean.ai === 'free') CH.sean.hp = Math.min(100, CH.sean.hp + 25);
      }
      scene.remove(p.g); pickups.splice(i, 1); break;
    }
  }
  for (const f of FUSES) {
    if (f.taken || !S.walkie) continue;
    for (const c of pickers) if (!c.down && !f.taken && Math.hypot(f.x - c.pos.x, f.z - c.pos.z) < 1.5) takeFuse(f, c);
  }
  for (const n of NOTES) {
    if (n.taken) continue;
    for (const c of pickers) if (!n.taken && Math.hypot(n.x - c.pos.x, n.z - c.pos.z) < 1.4) { n.taken = true; scene.remove(n.m); S.notes++; sfx('pickup'); ev('note', [n.t, n.x2]); }
  }
  // slow regen when out of combat
  for (const c of [CH.eric, CH.sean]) { c.regenT -= dt; if (c.regenT <= 0 && !c.down && c.hp > 0 && c.hp < 40) c.hp = Math.min(40, c.hp + dt * 3); }
}
function updatePhase(dt) {
  if (S.phase === 'hold') {
    S.holdT += dt;
    if (Math.abs(S.holdT - 20) < dt) sayAll('SEAN', 'Is anyone even listening?!');
    if (Math.abs(S.holdT - 38) < dt) { sayAll('RADIO', '...County... Route 9... repeat... '); addPickup('ammo', 1, -73); addPickup('ammo', -2, -86); }
    if (Math.abs(S.holdT - 50) < dt) sayAll('ERIC', 'Ten more seconds. TEN MORE.');
    if (S.holdT >= S.HOLD) startBoss();
  }
  if (S.phase === 'escape') { S.escT -= dt; if (S.escT <= 0 && S.state === 'play') ev('end', [true]); }
}
function startBoss() {
  S.phase = 'boss'; ev('blackout', [2.5]); sfx('sting'); ev('static', [1.2]);
  sayAll('RADIO', 'Copy, Route 9. We hear you. Inbound, three minutes.');
  setTimeout(() => {
    spawnBoss(); ev('msg', ['THE OTHER ERIC', 'It wears your face', 3.5]);
    sayAll('SEAN', 'Eric... why are there TWO of you?!', 1.2);
    sayAll('ERIC', 'Shoot the ugly one!');
    sayAll('SEAN', "THAT'S NOT HELPFUL!");
    for (const c of targetable()) { addPickup('ammo', c.pos.x + 2, c.pos.z + 1); addPickup('ammo', c.pos.x - 2, c.pos.z - 1); }
  }, 2200);
}
function updateSpawner(dt) {
  if (S.phase === 'escape') return;
  S.spawnT -= dt;
  if (S.phase === 'intro' && S.time < 30) return;
  const act = enemies.filter(e => !e.dead && !e.boss && e.state !== 'idle').length;
  const prog = S.fuses + (S.sean ? 1 : 0), co = S.mode !== 'solo' ? 1.4 : 1;
  let maxA, iv, runP;
  if (S.phase === 'hold') { maxA = 14 * co; iv = 1.2 / co; runP = 0.4; }
  else if (S.phase === 'boss') { maxA = 4 * co; iv = 5; runP = 0.5; }
  else { maxA = (3 + prog * 1.5) * co; iv = Math.max(2.6, 9 - prog * 1.3) / co; runP = 0.12 + prog * 0.08; }
  if (S.spawnT <= 0) { S.spawnT = iv * rand(0.7, 1.3); if (act < maxA) spawnAround(Math.random() < runP ? 'runner' : 'hollow'); }
}

// ================================================================ network sync
function packChar(c) {
  return [+c.pos.x.toFixed(2), +c.pos.z.toFixed(2), +c.yaw.toFixed(3), +c.pitch.toFixed(3), +c.modelYaw.toFixed(3),
    (c.aimK > 0.5 ? 1 : 0) | (c.w.reloading ? 2 : 0) | (c.dodgeT > 0 ? 4 : 0) | (c.flashOn ? 8 : 0) | (c.fireRecent > 0.9 ? 16 : 0) | (c.sprint ? 32 : 0) | (c.w.res >= c.wdef.resMax ? 64 : 0)];
}
function unpackChar(c, a) {
  c.net.tx = a[0]; c.net.tz = a[1]; c.yaw = a[2]; c.pitch = a[3]; c.net.my = a[4];
  const f = a[5]; c.net.aim = f & 1; c.w.reloading = !!(f & 2); if (f & 4) c.dodgeT = 0.15; c.flashOn = !!(f & 8); c.net.fr = !!(f & 16); c.sprint = !!(f & 32); c.net.full = !!(f & 64);
  if (!c.net.has) { c.pos.x = a[0]; c.pos.z = a[1]; c.net.has = true; }
}
function buildSnap() {
  return {
    t: 's',
    g: [S.phase, S.fuses, S.sean ? 1 : 0, S.walkie ? 1 : 0, +S.holdT.toFixed(2), S.notes, +S.escT.toFixed(2), S.kills],
    h: [Math.round(CH.eric.hp), CH.eric.down ? 1 : 0, Math.round(CH.sean.hp), CH.sean.down ? 1 : 0],
    me: packChar(CH.eric),
    e: enemies.map(e => [e.id, TYPES.indexOf(e.type), +e.scale.toFixed(3), +e.pos.x.toFixed(2), +e.pos.z.toFixed(2), +e.yaw.toFixed(2), STATES.indexOf(e.state), +e.t.toFixed(2), e.dead ? 1 : 0, e.stun > 0 ? 1 : 0, +hpFrac(e).toFixed(3), e.p.head.visible ? 0 : 1, +e.pos.y.toFixed(2)]),
    pk: pickups.map(p => [p.id, p.type === 'ammo' ? 0 : 1, +p.g.position.x.toFixed(2), +p.g.position.z.toFixed(2)]),
    f: FUSES.map(f => f.taken ? 1 : 0).join(''), n: NOTES.map(n => n.taken ? 1 : 0).join(''),
  };
}
function applySnap(s) {
  const g = s.g;
  S.phase = g[0]; S.fuses = g[1]; S.sean = !!g[2]; S.walkie = !!g[3]; S.holdT = g[4]; S.notes = g[5]; S.escT = g[6]; S.kills = g[7];
  const wasDown = CH.sean.down;
  CH.eric.hp = s.h[0]; CH.eric.down = !!s.h[1]; CH.sean.hp = s.h[2]; CH.sean.down = !!s.h[3];
  if (CH.sean.down && !wasDown) localDowned();
  if (!CH.sean.down && wasDown) localRevived();
  unpackChar(CH.eric, s.me);
  const seen = new Set();
  for (const a of s.e) {
    seen.add(a[0]);
    let e = byId.get(a[0]);
    if (!e) { e = newEnemy(TYPES[a[1]], a[0], a[2], a[3], a[4]); e.yaw = a[5]; }
    e.nx = a[3]; e.nz = a[4]; e.nyaw = a[5]; e.state = STATES[a[6]]; e.t = a[7];
    if (a[8] && !e.dead) { e.dead = true; e.deadT = 0; }
    e.stun = a[9] ? 0.1 : 0; e.hpFrac = a[10]; if (a[11]) e.p.head.visible = false; e.pos.y = a[12];
  }
  for (let i = enemies.length - 1; i >= 0; i--) if (!seen.has(enemies[i].id)) { const e = enemies[i]; scene.remove(e.p.root); byId.delete(e.id); enemies.splice(i, 1); if (e === boss) boss = null; }
  const pseen = new Set();
  for (const a of s.pk) { pseen.add(a[0]); if (!pickups.some(p => p.id === a[0])) addPickup(a[1] ? 'health' : 'ammo', a[2], a[3], a[0]); }
  for (let i = pickups.length - 1; i >= 0; i--) if (!pseen.has(pickups[i].id)) { scene.remove(pickups[i].g); pickups.splice(i, 1); }
  FUSES.forEach((f, i) => { if (s.f[i] === '1' && !f.taken) { f.taken = true; scene.remove(f.g); } });
  NOTES.forEach((n, i) => { if (s.n[i] === '1' && !n.taken) { n.taken = true; scene.remove(n.m); } });
  if (S.walkie && walkie.parent) scene.remove(walkie);
}
function updateReplicas(dt) {
  for (const e of enemies) {
    const px = e.pos.x, pz = e.pos.z, k = 1 - Math.exp(-dt * 12);
    e.pos.x = lerp(e.pos.x, e.nx, k); e.pos.z = lerp(e.pos.z, e.nz, k); e.yaw += wrapA(e.nyaw - e.yaw) * k;
    const sp = Math.hypot(e.pos.x - px, e.pos.z - pz) / Math.max(dt, 1e-4); e.spd = lerp(e.spd, sp, 0.2);
    (e.boss ? animBoss : animEnemy)(e, dt, e.state === 'idle' ? 0 : e.spd);
  }
}
let lastRecv = performance.now();
export function onNet(m) {
  lastRecv = performance.now();
  if (S.mode === 'host') {
    switch (m.t) {
      case 'p': unpackChar(CH.sean, m.c); break;
      case 'dmg': { const e = byId.get(m.id); if (e && !e.dead) damageEnemy(e, Math.min(m.d, 300), new V3(m.x, 0, m.z), !!m.h, e.chestPos, 'sean'); break; }
      case 'shot': showRemoteShot(CH.sean, m); wakeNear(CH.sean.pos, 40); break;
      case 'flare': SFX.flare(); applyFlare(CH.sean); break;
      case 'act': {
        const it = interactables(CH.sean).find(i => i.id === m.id && !i.info);
        if (it && Math.hypot(it.pos.x - CH.sean.pos.x, it.pos.z - CH.sean.pos.z) < it.r + 1.5) ACTS[m.id]('sean');
        break;
      }
    }
  } else if (S.mode === 'guest') {
    if (m.t === 's') applySnap(m);
    else if (m.t === 'ev' && EV[m.e]) EV[m.e](...m.a);
  }
}
// partner left mid-game
export function onPartnerLost() {
  if (S.state !== 'play') return;
  if (S.mode === 'host') {
    S.mode = 'solo'; const s = CH.sean; s.ai = 'free'; s.down = false; s.hp = Math.max(s.hp, 60);
    toast("SEAN'S PLAYER LEFT · SEAN IS AI NOW", 5);
  } else if (S.mode === 'guest') endGame(false, 'net');
}

// ================================================================ start, death, ending
export function initSim() {
  [[3, 68], [-10, 42], [9, 13], [-8, -8], [22, -14], [36, 30], [-38, -17], [30, -40], [-20, 22], [4, -58], [-6, -72], [-52, -23], [20, 60]].forEach(([x, z]) => addPickup('ammo', x, z));
  [[-23, 53], [33, 45], [-54, -16], [24, -7], [-9, -50], [9, -66], [-18, 0]].forEach(([x, z]) => addPickup('health', x, z));
  // sleepers: they wake when you get close, shine a light on them, or make noise
  [[24, 41], [34, 37], [44, -27], [39, -33], [-2, 18], [3, -22], [-57, -14], [-27, 64], [24, 2], [25, -6], [31, -2.5], [-14, -2]].forEach(([x, z]) => makeEnemy(Math.random() < 0.2 ? 'runner' : 'hollow', x, z, true));
}
export function introLines() {
  if (S.story === 'solo') {
    sayAll('ERIC', "Sean? ...Sean, it's been forty minutes.");
    sayAll('SEAN', 'Eric— ...gas station... someone here— they know your n—', 0.4);
    sayAll('RADIO', '*static*');
    sayAll('ERIC', "Okay. Okay. Gas station. Shotgun's in the trunk for a reason.");
  } else {
    sayAll('RADIO', "This is Eric Kosoy. If you can hear this... don't come to Hollow Creek.");
    sayAll('ERIC', "...Sean. That's my voice. That's MY voice.");
    sayAll('SEAN', "It's coming from the gas station. Please be a prank. Please be a really elaborate prank.");
    sayAll('ERIC', "Get the pistol out of the glovebox. I've got the shotgun.");
  }
}
function playerDie() {
  P.dead = true; P.deadT = 0; P.hp = 0; S.state = 'dying'; SFX.sting(); SFX.roar(P.pos);
  setTimeout(() => endGame(false), 1300);
}
let ended = false;
export function endGame(won, why) {
  if (ended) return; ended = true;
  if (S.mode === 'host' && NET.connected) send({ t: 'ev', e: 'end', a: [won, why] });
  S.state = 'ending';
  const show = () => endScreen(won, why);
  if (won) { heliOn(false); show(); }
  else { $('fade').style.transition = 'opacity 2s'; $('fade').style.opacity = 1; setTimeout(show, 2100); }
}
const fmtTime = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function endScreen(won, why) {
  try { document.exitPointerLock(); } catch (e) { }
  $('hud').classList.remove('on'); S.state = won ? 'won' : 'lost';
  const acc = S.shots ? Math.round(S.hits / S.shots * 100) : 0;
  const coop = S.story === 'coop';
  let head, story;
  if (won) {
    head = coop ? 'ERIC & SEAN<br>SURVIVED' : 'ERIC KOSOY<br>SURVIVED';
    story = S.sean || coop
      ? 'The helicopter lifted Eric and <em>Sean Perrius</em> out of the fog. Sean didn\'t stop talking until they hit the ground. Neither of them looked back at the tower. Something on it waved.'
      : 'The helicopter lifted Eric out of the fog.';
  } else if (why === 'net') {
    head = 'LOST THE<br>SIGNAL'; story = 'The connection to the host dropped. Somewhere in Hollow Creek, Eric is on his own now.';
  } else {
    head = coop ? 'NOBODY<br>MADE IT' : "ERIC DIDN'T<br>MAKE IT";
    story = 'Somewhere on Route 9, a man with curly black hair is walking back to a broken-down car. He walks almost exactly like Eric. He is practicing the face.';
  }
  const scr = $('screen'); scr.hidden = false; scr.classList.add('click');
  scr.style.background = won ? 'radial-gradient(ellipse at 30% 50%,rgba(20,20,20,.6),rgba(0,0,0,.95))' : 'radial-gradient(ellipse at 30% 50%,rgba(60,0,0,.5),rgba(0,0,0,.95))';
  scr.innerHTML = `<div class="tt end">
    <div class="kick">${won ? 'HOLLOW CREEK · 4:02 AM' : 'HOLLOW CREEK · ROUTE 9'}</div>
    <h2>${head}</h2>
    <p class="story">${story}</p>
    <div class="stats"><div><b>${fmtTime(S.time)}</b>TIME</div><div><b>${S.kills}</b>KILLS${coop ? ' (TEAM)' : ''}</div><div><b>${acc}%</b>YOUR ACCURACY</div><div><b>${S.fuses}/4</b>FUSES</div><div><b>${S.notes}/5</b>NOTES</div></div>
    <div class="go">CLICK TO RETURN TO THE TITLE</div>
  </div>`;
  scr.onclick = () => { location.href = location.pathname; };
}

// ================================================================ HUD
const compass = $('compass');
function cm(cls) { const d = document.createElement('div'); d.className = 'cm ' + cls; compass.appendChild(d); return d; }
const dirMarks = [['N', 0], ['E', Math.PI / 2], ['S', Math.PI], ['W', -Math.PI / 2]].map(([t, a]) => { const d = cm(''); d.textContent = t; return { d, a }; });
const cmarks = []; for (let i = 0; i < 8; i++) cmarks.push(cm('o'));
function hudTargets() {
  const T = [];
  if (S.phase === 'intro') T.push({ x: walkie.position.x, z: walkie.position.z, c: 'o', t: '◆' });
  if (S.phase === 'explore') {
    FUSES.forEach(f => { if (!f.taken) T.push({ x: f.x, z: f.z, c: 'o', t: '◆' }); });
    if (!S.sean) T.push({ x: CIRCLE.x, z: CIRCLE.z, c: S.story === 'solo' ? 's' : 'b', t: S.story === 'solo' ? '✚' : '✖' });
  }
  if (S.phase === 'tower') T.push({ x: towerPanel.pos.x, z: towerPanel.pos.z, c: 'o', t: '▲' });
  if (S.phase === 'boss' && boss && !boss.dead) T.push({ x: boss.pos.x, z: boss.pos.z, c: 'b', t: '✖' });
  if (S.mode !== 'solo' || S.sean) {
    const d = Math.hypot(O.pos.x - P.pos.x, O.pos.z - P.pos.z);
    if (O.down || d > 12) T.push({ x: O.pos.x, z: O.pos.z, c: 's', t: O.down ? '✚' : '●' });
  }
  return T;
}
let lastObj = '';
const shells = $('shells');
function updateHUD(dt) {
  const head = -P.yaw, W2 = compass.clientWidth;
  const place = (d, a) => { const rel = wrapA(a - head); if (Math.abs(rel) > 1.3) { d.style.display = 'none'; return; } d.style.display = 'block'; d.style.left = (W2 / 2 + rel / 1.3 * W2 / 2) + 'px'; };
  dirMarks.forEach(m => place(m.d, m.a));
  const T = hudTargets();
  cmarks.forEach((d, i) => {
    const t = T[i]; if (!t) { d.style.display = 'none'; return; }
    const dx = t.x - P.pos.x, dz = t.z - P.pos.z; d.className = 'cm ' + t.c;
    d.innerHTML = `${t.t}<small>${Math.round(Math.hypot(dx, dz))}m</small>`; place(d, Math.atan2(dx, -dz));
  });
  const coop = S.story === 'coop';
  const line = (t, done) => `<div class="l${done ? ' done' : ''}">${t}</div>`;
  let o = '';
  if (S.phase === 'intro') o = coop ? line('Find the source of the broadcast at the <b>gas station</b>') : line('Find Sean. He walked to the <b>gas station</b>.');
  else if (S.phase === 'explore') o = line(`Collect fuses <b>${S.fuses} / 4</b>`, S.fuses >= 4) + line(coop ? 'Break the circle at the <b>church</b>' : 'Rescue Sean at the <b>church</b>', S.sean);
  else if (S.phase === 'tower') o = line('Reach the <b>radio tower</b>') + line('Start the transmitter');
  else if (S.phase === 'hold') o = line('Defend the transmitter') + line('Stay close to <b>the tower</b>');
  else if (S.phase === 'boss') o = line('Kill <b>The Other Eric</b>');
  else if (S.phase === 'escape') o = line('Rescue is here');
  if (O.down && (S.mode !== 'solo' || S.sean)) o += line(`<b>${O.name.split(' ')[0]} is down.</b> Help him up.`);
  o = `<div class="h">OBJECTIVE · NOTES ${S.notes}/5${S.mode !== 'solo' ? ' · CO-OP' : ''}</div>` + o;
  if (o !== lastObj) { $('obj').innerHTML = o; lastObj = o; }
  $('hpf').style.transform = `scaleX(${clamp(P.hp / 100, 0, 1)})`;
  $('stf').style.transform = `scaleX(${P.stam / 100})`;
  const showO = S.mode !== 'solo' || S.sean;
  $('sv').style.display = showO ? 'block' : 'none';
  if (showO) { $('svn').textContent = O.name; $('svf').style.transform = `scaleX(${clamp(O.hp / 100, 0, 1)})`; $('svs').textContent = O.down ? 'DOWN' : ''; }
  $('fl').textContent = S.flareCd > 0 ? `FLARE ${Math.ceil(S.flareCd)}s` : 'FLARE [Q] READY'; $('fl').className = S.flareCd > 0 ? '' : 'rdy';
  $('mag').textContent = P.w.mag; $('res').textContent = '/ ' + P.w.res;
  const sh = Array.from({ length: P.wdef.max }, (_, i) => `<i class="${P.wdef.icon}${i < P.w.mag ? '' : ' e'}"></i>`).join('');
  if (shells.dataset.v !== sh) { shells.innerHTML = sh; shells.dataset.v = sh; }
  $('timer').style.display = S.phase === 'hold' ? 'block' : 'none';
  if (S.phase === 'hold') { const k = clamp(S.holdT / S.HOLD, 0, 1); $('timt').textContent = Math.floor(k * 100) + '%'; $('timf').style.transform = `scaleX(${k})`; }
  $('boss').style.display = boss && !boss.dead ? 'block' : 'none';
  if (boss) $('bossf').style.transform = `scaleX(${hpFrac(boss)})`;
  const sp = 7 + (1 - P.aimK) * 10 + P.w.kick * 10 * P.wdef.kick + Math.hypot(P.vel.x, P.vel.z);
  const xh = $('xh').children; xh[0].style.top = (-sp - 7) + 'px'; xh[1].style.top = sp + 'px'; xh[2].style.left = (-sp - 7) + 'px'; xh[3].style.left = sp + 'px';
  P.hurtFx = Math.max(0, P.hurtFx - dt * 1.5);
  const low = P.down ? 0.55 : P.hp < 35 ? (0.35 + Math.sin(S.time * 5) * 0.12) * (1 - P.hp / 35) : 0;
  $('hurt').style.opacity = Math.max(P.hurtFx * 0.8, low);
  if (S.phase === 'escape' && S.escT < 3) $('white').style.opacity = clamp((3 - S.escT) / 3, 0, 1);
}

// ================================================================ per-frame entry points
let netT = 0, hbT = 0;
export function tick(dt, rdt) {
  S.time += dt;
  updateLocal(dt);
  if (S.mode === 'guest') {
    updateRemote(CH.eric, dt);
    updateReplicas(dt);
  } else {
    if (S.mode === 'host') updateRemote(CH.sean, dt); else updateSeanAI(dt);
    for (const e of enemies) { const sp = e.boss ? simBoss(e, dt) : simEnemy(e, dt); (e.boss ? animBoss : animEnemy)(e, dt, sp); }
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].remove) { const e = enemies[i]; scene.remove(e.p.root); byId.delete(e.id); enemies.splice(i, 1); }
    if (S.state === 'play') { updatePickupsHost(dt); updatePhase(dt); updateSpawner(dt); }
  }
  updateStalker(dt);
  if (S.state === 'play') {
    updateInteract(dt);
    if (!S.grave && Math.hypot(GRAVE.x - P.pos.x, GRAVE.z - P.pos.z) < 4) {
      S.grave = true; SFX.sting(0.8); staticFx(0.5); bigMsg('ERIC KOSOY', 'A fresh grave. The dirt is still wet.', 4);
      say('???', 'Welcome home, Eric.');
      say(P.id === 'eric' ? 'ERIC' : 'SEAN', P.id === 'eric' ? "That's... that's not funny." : "Eric. Eric, come look at this. Actually, don't.");
    }
  }
  for (const p of pickups) { p.t += dt; p.g.rotation.y += dt * 1.5; p.g.position.y = 0.45 + Math.sin(p.t * 2.5) * 0.08; }
  for (const f of FUSES) if (!f.taken) { f.g.rotation.y += dt; f.g.position.y = 0.75 + Math.sin(S.time * 2) * 0.1; }
  const near = updateCamera(dt);
  hbT -= dt;
  const fear = Math.max(near < 12 ? 1 - near / 12 : 0, P.hp < 40 ? 1 - P.hp / 40 : 0);
  if (fear > 0.05 && hbT <= 0) { SFX.heart(0.3 + fear * 0.7); hbT = lerp(1.1, 0.45, fear); }
  updateMusic(rdt, (S.phase === 'hold' || S.phase === 'boss') ? 1 : near < 18 ? 0.8 : 0);
  updateHUD(rdt);
  updateWorld(rdt, P.pos);
  // network at 20 Hz; a partner silent for 6s is treated as gone
  if (S.mode !== 'solo' && S.state === 'play' && performance.now() - lastRecv > 6000) { onPartnerLost(); NET.connected = false; }
  netT -= rdt;
  if (netT <= 0 && NET.connected) {
    netT = 0.05;
    if (S.mode === 'host') send(buildSnap());
    else if (S.mode === 'guest') send({ t: 'p', c: packChar(P) });
  }
}
// slow orbit around Eric by his car on the title screen
export function titleTick(now, rdt) {
  const t = now / 1000, E = CH.eric;
  E.person.root.rotation.y = 0.9; animChar(E, 0);
  camera.position.set(E.pos.x + Math.sin(t * 0.12) * 3.4 + 1.2, 1.55, E.pos.z + Math.cos(t * 0.12) * 1.5 - 3.6);
  camera.lookAt(E.pos.x - 0.6, 1.3, E.pos.z);
  flash.position.set(E.pos.x + 2, 2.2, E.pos.z - 3.5); flash.target.position.set(E.pos.x, 1.2, E.pos.z); flash.intensity = 30;
  if (camera.fov !== 45) { camera.fov = 45; camera.updateProjectionMatrix(); }
  S.time += rdt * 0.5;
  updateWorld(rdt, null);
}
// test hooks
export const debug = { traceShot, camera, onNet, get lastRecv() { return lastRecv; }, S, CH, enemies, FUSES, ACTS, takeFuse, startBoss, spawnAround, fire, get P() { return P; } };
