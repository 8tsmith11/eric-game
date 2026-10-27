// On-screen text: subtitles, headline messages, notes, toasts, hit markers, film grain.
import { $ } from './core.js';
import { SFX, WHO, speak } from './audio.js';

const subQ = []; let subT = 0;
export function say(who, text, delay = 0) { subQ.push({ who, text, delay }); }
export function clearSubs() { subQ.length = 0; subT = 0; $('sub').style.opacity = 0; }
let msgT = 0, noteT = 0, toastT = 0, hmT = 0, staticT = 0;
export function bigMsg(a, b = '', t = 3.2) { $('ma').textContent = a; $('mb').textContent = b; $('msg').style.opacity = 1; msgT = t; }
export function showNote(title, text) { $('nt').textContent = title; $('nx').textContent = text; $('note').classList.add('on'); noteT = 8; }
export function toast(t, dur = 2) { $('toast').textContent = t; toastT = dur; }
export function hitMark(kind) { const h = $('hm'); h.className = kind === 'kill' ? 'kill' : ''; h.style.opacity = 1; hmT = kind === 'kill' ? 0.25 : 0.12; }
export function staticFx(v) { staticT = Math.max(staticT, v); SFX.staticBurst(); }

export function updateText(dt) {
  if (subT > 0) { subT -= dt; if (subT <= 0) $('sub').style.opacity = 0; }
  else if (subQ.length) {
    const s = subQ[0];
    if (s.delay > 0) s.delay -= dt;
    else {
      subQ.shift();
      $('sub').innerHTML = `<b style="color:${(WHO[s.who] || WHO.ERIC).c}">${s.who}</b>${s.text}`; $('sub').style.opacity = 1;
      subT = Math.max(2.4, s.text.length * 0.068);
      if (s.who === 'RADIO') SFX.radio();
      speak(s.text, s.who);
    }
  }
  if (msgT > 0) { msgT -= dt; if (msgT <= 0) $('msg').style.opacity = 0; }
  if (noteT > 0) { noteT -= dt; if (noteT <= 0) $('note').classList.remove('on'); }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').textContent = ''; }
  if (hmT > 0) { hmT -= dt; if (hmT <= 0) $('hm').style.opacity = 0; }
}

const grainC = $('grain'), grainX = grainC.getContext('2d'), grainImg = grainX.createImageData(192, 108);
export function updateGrain(dt) {
  const d = grainImg.data;
  for (let i = 0; i < d.length; i += 4) { const v = Math.random() * 255; d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255; }
  grainX.putImageData(grainImg, 0, 0);
  staticT = Math.max(0, staticT - dt);
  grainC.style.opacity = 0.06 + staticT * 0.5;
}
