// Every sound is synthesized with WebAudio. Voices use the browser's speech synthesis.
import { clamp, lerp, S, camera } from './core.js';

export const AU = { ctx: null };
export function initAudio() {
  if (AU.ctx) { AU.ctx.resume(); return; }
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)(); AU.ctx = ctx;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 5; comp.connect(ctx.destination);
    AU.master = ctx.createGain(); AU.master.gain.value = 0.85; AU.master.connect(comp);
    const len = ctx.sampleRate * 2.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.8); }
    AU.rev = ctx.createConvolver(); AU.rev.buffer = ir; AU.rev.connect(AU.master);
    AU.revIn = ctx.createGain(); AU.revIn.gain.value = 0.5; AU.revIn.connect(AU.rev);
    AU.music = ctx.createGain(); AU.music.gain.value = 0; AU.music.connect(AU.master);
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1; AU.noise = nb;
    const curve = new Float32Array(1024); for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 5); } AU.curve = curve;
    startAmbience();
  } catch (e) { AU.ctx = null; }
}
function route(node, pan = 0, rev = 0.25, dest) {
  const ctx = AU.ctx; let n = node;
  if (pan) { const p = ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); n.connect(p); n = p; }
  n.connect(dest || AU.master);
  if (rev > 0) { const g = ctx.createGain(); g.gain.value = rev; n.connect(g); g.connect(AU.revIn); }
}
function envG(g, t0, peak, attack, dur) { g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + attack); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur); }
function sNoise(o) {
  if (!AU.ctx) return; const ctx = AU.ctx, t0 = ctx.currentTime + (o.when || 0);
  const src = ctx.createBufferSource(); src.buffer = AU.noise; src.loop = true;
  const f = ctx.createBiquadFilter(); f.type = o.type || 'lowpass'; f.frequency.setValueAtTime(o.f || 1000, t0);
  if (o.f2) f.frequency.exponentialRampToValueAtTime(o.f2, t0 + o.dur); f.Q.value = o.q || 0.7;
  const g = ctx.createGain(); envG(g, t0, o.gain ?? 0.5, o.attack || 0.003, o.dur);
  src.connect(f); f.connect(g); route(g, o.pan || 0, o.rev ?? 0.25, o.dest);
  src.start(t0, Math.random() * 1.5); src.stop(t0 + o.dur + 0.05);
}
function sTone(o) {
  if (!AU.ctx) return; const ctx = AU.ctx, t0 = ctx.currentTime + (o.when || 0);
  const os = ctx.createOscillator(); os.type = o.type || 'sine'; os.frequency.setValueAtTime(o.f, t0);
  if (o.f2) os.frequency.exponentialRampToValueAtTime(o.f2, t0 + (o.glide || o.dur));
  let n = os;
  if (o.vib) { const l = ctx.createOscillator(); l.frequency.value = o.vib[0]; const lg = ctx.createGain(); lg.gain.value = o.vib[1]; l.connect(lg); lg.connect(os.frequency); l.start(t0); l.stop(t0 + o.dur + 0.1); }
  if (o.dist) { const ws = ctx.createWaveShaper(); ws.curve = AU.curve; n.connect(ws); n = ws; }
  if (o.lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; f.Q.value = o.q || 1; n.connect(f); n = f; }
  const g = ctx.createGain(); envG(g, t0, o.gain ?? 0.3, o.attack || 0.005, o.dur); n.connect(g);
  route(g, o.pan || 0, o.rev ?? 0.25, o.dest);
  os.start(t0); os.stop(t0 + o.dur + 0.05);
}
// pan and distance falloff relative to the camera
function spatial(pos) {
  const dx = pos.x - camera.position.x, dz = pos.z - camera.position.z, d = Math.hypot(dx, dz) + 0.001, y = camera.rotation.y;
  return { pan: (dx * Math.cos(y) - dz * Math.sin(y)) / d * 0.8, vol: 1 / (1 + d * 0.09), d };
}
export const SFX = {
  shot() { sNoise({ dur: 0.55, f: 5000, f2: 250, gain: 1, rev: 0.7 }); sTone({ f: 160, f2: 38, dur: 0.32, gain: 1.1, rev: 0.2 }); sNoise({ dur: 0.06, type: 'highpass', f: 2500, gain: 0.6, rev: 0.3 }); },
  shotAt(pos) { const s = spatial(pos); sNoise({ dur: 0.55, f: 4000, f2: 250, gain: 0.9 * s.vol, pan: s.pan, rev: 0.7 }); sTone({ f: 150, f2: 40, dur: 0.3, gain: 0.8 * s.vol, pan: s.pan }); },
  pistolMine() { sNoise({ dur: 0.28, f: 5200, f2: 400, gain: 0.75, rev: 0.6 }); sTone({ f: 240, f2: 60, dur: 0.14, gain: 0.6 }); sNoise({ dur: 0.04, type: 'highpass', f: 3000, gain: 0.4, rev: 0.2 }); },
  pistol(pos) { const s = spatial(pos); sNoise({ dur: 0.25, f: 4500, f2: 400, gain: 0.55 * s.vol, pan: s.pan, rev: 0.6 }); sTone({ f: 220, f2: 60, dur: 0.12, gain: 0.4 * s.vol, pan: s.pan }); },
  pump() { sNoise({ dur: 0.05, type: 'bandpass', f: 1700, q: 4, gain: 0.7, rev: 0.1 }); sNoise({ when: 0.13, dur: 0.06, type: 'bandpass', f: 1100, q: 4, gain: 0.7, rev: 0.1 }); },
  shell() { sNoise({ dur: 0.04, type: 'bandpass', f: 2600, q: 5, gain: 0.5, rev: 0.05 }); sTone({ type: 'triangle', f: 1300, f2: 900, dur: 0.05, gain: 0.08 }); },
  mag() { sNoise({ dur: 0.06, type: 'bandpass', f: 1400, q: 3, gain: 0.6, rev: 0.05 }); sNoise({ when: 0.2, dur: 0.05, type: 'bandpass', f: 2200, q: 4, gain: 0.6, rev: 0.05 }); },
  empty() { sNoise({ dur: 0.03, type: 'highpass', f: 3500, gain: 0.35, rev: 0 }); },
  step(run) { sNoise({ dur: 0.08, f: run ? 900 : 600, f2: 200, gain: run ? 0.16 : 0.1, rev: 0.05 }); },
  hurt() { sTone({ type: 'sawtooth', f: 140, f2: 70, dur: 0.35, gain: 0.35, dist: true, lp: 900 }); sNoise({ dur: 0.3, type: 'bandpass', f: 500, gain: 0.6 }); },
  flesh(pos) { const s = spatial(pos); sNoise({ dur: 0.1, type: 'bandpass', f: 420, q: 1.2, gain: 0.7 * s.vol, pan: s.pan, rev: 0.1 }); },
  splat(pos) { const s = spatial(pos); sNoise({ dur: 0.45, f: 900, f2: 150, gain: 1 * s.vol, pan: s.pan, rev: 0.3 }); },
  scream(pos, p = 1) { const s = spatial(pos), v = s.vol; for (const m of [1, 1.5, 2.07]) sTone({ type: 'sawtooth', f: 380 * p * m, f2: 210 * p * m, glide: 0.9, dur: 0.9, gain: 0.12 * v, vib: [28, 30 * m], dist: true, lp: 2400, q: 2, pan: s.pan, rev: 0.5 }); sNoise({ dur: 0.7, type: 'bandpass', f: 2200, q: 2, gain: 0.3 * v, pan: s.pan }); },
  growl(pos, p = 1) { const s = spatial(pos); sTone({ type: 'sawtooth', f: 85 * p, f2: 62 * p, dur: 1.2, gain: 0.32 * s.vol, vib: [9, 8], dist: true, lp: 600, pan: s.pan, rev: 0.4 }); },
  die(pos, p = 1) { const s = spatial(pos); sTone({ type: 'sawtooth', f: 300 * p, f2: 55, dur: 0.8, gain: 0.3 * s.vol, dist: true, lp: 1200, pan: s.pan, rev: 0.5 }); },
  pickup() { [523, 659, 784].forEach((f, i) => sTone({ type: 'triangle', f, dur: 0.25, gain: 0.16, when: i * 0.06, rev: 0.4 })); },
  fuse() { [220, 261.6, 329.6, 392, 523].forEach((f, i) => sTone({ type: 'triangle', f, dur: 2.4, gain: 0.11, attack: 0.05 + i * 0.05, rev: 0.8 })); sNoise({ dur: 1.4, type: 'bandpass', f: 3000, f2: 600, gain: 0.15, attack: 0.6, rev: 0.6 }); },
  sting(v = 1) { [1180, 1250, 1330, 1597, 1690].forEach(f => sTone({ type: 'sawtooth', f, f2: f * 0.94, dur: 1.5, gain: 0.07 * v, dist: true, lp: 5000, rev: 0.8 })); sNoise({ dur: 0.9, type: 'bandpass', f: 3000, q: 0.8, gain: 0.5 * v, rev: 0.7 }); sTone({ f: 55, f2: 30, dur: 1.6, gain: 0.9 * v, rev: 0.3 }); },
  heart(v) { sTone({ f: 62, f2: 40, dur: 0.16, gain: 0.8 * v, rev: 0 }); sTone({ when: 0.2, f: 55, f2: 38, dur: 0.14, gain: 0.5 * v, rev: 0 }); },
  flare() { sNoise({ dur: 0.9, type: 'highpass', f: 6000, f2: 800, gain: 0.6, rev: 0.7 }); sTone({ f: 2400, f2: 1800, dur: 1, gain: 0.1, rev: 0.8 }); },
  roar(pos) { const s = spatial(pos); [55, 58, 111, 165].forEach(f => sTone({ type: 'sawtooth', f, f2: f * 0.75, dur: 2.2, gain: 0.22 * s.vol + 0.1, vib: [6, f * 0.05], dist: true, lp: 1100, pan: s.pan, rev: 0.7 })); sNoise({ dur: 2, f: 900, gain: 0.4, rev: 0.6 }); },
  staticBurst() { sNoise({ dur: 0.45, type: 'highpass', f: 1500, gain: 0.45, rev: 0 }); },
  radio() { sNoise({ dur: 0.35, type: 'bandpass', f: 1800, q: 0.6, gain: 0.35, rev: 0 }); sTone({ type: 'square', f: 1200, dur: 0.06, gain: 0.05, rev: 0 }); },
  thunder() { sNoise({ when: 0.5 + Math.random(), dur: 3.8, f: 420, f2: 50, gain: 1, attack: 0.04, rev: 0.9 }); sNoise({ dur: 0.3, type: 'highpass', f: 1500, gain: 0.35 }); },
  whoosh() { sNoise({ dur: 0.28, type: 'bandpass', f: 600, f2: 1600, q: 1, gain: 0.35, rev: 0.1 }); },
  join() { [392, 523, 659].forEach((f, i) => sTone({ type: 'triangle', f, dur: 0.5, gain: 0.12, when: i * 0.09, rev: 0.6 })); },
};
function startAmbience() {
  const ctx = AU.ctx;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 160; lp.Q.value = 3;
  const dg = ctx.createGain(); dg.gain.value = 0.1; lp.connect(dg); route(dg, 0, 0.4);
  [41.2, 41.55, 61.7].forEach(f => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.connect(lp); o.start(); });
  const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05; const lg = ctx.createGain(); lg.gain.value = 70; lfo.connect(lg); lg.connect(lp.frequency); lfo.start();
  const rs = ctx.createBufferSource(); rs.buffer = AU.noise; rs.loop = true;
  const rf = ctx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 1800;
  const rg = ctx.createGain(); rg.gain.value = 0.05; rs.connect(rf); rf.connect(rg); route(rg, 0, 0.1); rs.start();
  const ws = ctx.createBufferSource(); ws.buffer = AU.noise; ws.loop = true;
  const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 400; wf.Q.value = 0.9;
  const wl = ctx.createOscillator(); wl.frequency.value = 0.07; const wlg = ctx.createGain(); wlg.gain.value = 260; wl.connect(wlg); wlg.connect(wf.frequency); wl.start();
  const wg = ctx.createGain(); wg.gain.value = 0.06; ws.connect(wf); wf.connect(wg); route(wg, 0, 0.3); ws.start(0, 0.7);
  AU.tension = ctx.createGain(); AU.tension.gain.value = 0; route(AU.tension, 0, 0.7);
  [233.1, 246.9, 349.2, 370].forEach(f => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; const g = ctx.createGain(); g.gain.value = 0.25; o.connect(g); g.connect(AU.tension); o.start(); });
  AU.heli = ctx.createGain(); AU.heli.gain.value = 0; route(AU.heli, 0, 0.3);
  const hs = ctx.createBufferSource(); hs.buffer = AU.noise; hs.loop = true; const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 260;
  const am = ctx.createGain(); am.gain.value = 0.5; const ho = ctx.createOscillator(); ho.frequency.value = 11; const hog = ctx.createGain(); hog.gain.value = 0.5; ho.connect(hog); hog.connect(am.gain); ho.start();
  hs.connect(hf); hf.connect(am); am.connect(AU.heli); hs.start();
}
export function heliOn(on) { if (AU.ctx) AU.heli.gain.setTargetAtTime(on ? 0.5 : 0, AU.ctx.currentTime, 2); }

// Action score: a step sequencer that fades in during fights.
const MUS = { t: 0, step: 0, inten: 0, bass: [41.2, 0, 41.2, 41.2, 0, 43.65, 0, 41.2, 49, 0, 46.25, 0, 43.65, 0, 38.9, 0] };
export function updateMusic(dt, target) {
  if (!AU.ctx) return;
  MUS.inten = lerp(MUS.inten, target, 1 - Math.exp(-dt * (target > MUS.inten ? 2 : 0.4)));
  AU.music.gain.setTargetAtTime(MUS.inten * 0.55, AU.ctx.currentTime, 0.1);
  AU.tension.gain.setTargetAtTime((1 - MUS.inten) * 0.012 + (S.phase === 'boss' ? 0.02 : 0), AU.ctx.currentTime, 0.5);
  if (MUS.inten < 0.03) return;
  const sd = 60 / 148 / 4; MUS.t += dt;
  while (MUS.t >= sd) {
    MUS.t -= sd; const i = MUS.step++ % 16, d = { dest: AU.music, rev: 0.1 };
    if (i % 4 === 0) sTone({ ...d, f: 120, f2: 38, dur: 0.22, gain: 1 });
    if (i % 4 === 2) sNoise({ ...d, type: 'highpass', f: 7000, dur: 0.04, gain: 0.25 });
    if (i === 4 || i === 12) sNoise({ ...d, type: 'bandpass', f: 1600, dur: 0.16, gain: 0.45, rev: 0.4 });
    const b = MUS.bass[i]; if (b) sTone({ ...d, type: 'sawtooth', f: b * 2, dur: 0.12, gain: 0.32, lp: 420, dist: true });
    if (MUS.step % 64 === 0) [329.6, 349.2, 466].forEach(f => sTone({ ...d, type: 'sawtooth', f, dur: 1.4, gain: 0.05, lp: 1800, rev: 0.6 }));
  }
}

// ---------------------------------------------------------------- voices
export const VOICE = { on: true };
let voices = [];
try { voices = speechSynthesis.getVoices(); speechSynthesis.onvoiceschanged = () => { voices = speechSynthesis.getVoices(); }; } catch (e) { }
export const WHO = {
  ERIC: { c: 'var(--ink)', p: 0.85, r: 1.02, v: 0 }, SEAN: { c: 'var(--sean)', p: 1.3, r: 1.08, v: 1 },
  '???': { c: 'var(--blood)', p: 0.1, r: 0.55, v: 0 }, RADIO: { c: 'var(--dim)', p: 0.8, r: 1, v: 2 },
};
export function speak(text, who) {
  if (!VOICE.on) return;
  try {
    const w = WHO[who] || WHO.ERIC; speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[—*]/g, ', ')); u.pitch = w.p; u.rate = w.r; u.volume = who === '???' ? 0.8 : 1;
    const en = voices.filter(v => /^en/i.test(v.lang)); if (en.length) u.voice = en[Math.min(w.v, en.length - 1)];
    speechSynthesis.speak(u);
  } catch (e) { }
}
