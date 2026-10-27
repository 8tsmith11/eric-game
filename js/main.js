// Entry point: title screen, co-op lobby, input, main loop.
import { $, S, INPUT, TEST, canvas, composer, muzzleLight } from './core.js';
import { updateRain } from './world.js';
import { updateFx } from './fx.js';
import { initAudio, VOICE, SFX } from './audio.js';
import { updateText, updateGrain, toast, clearSubs } from './hud.js';
import { NET, hostRoom, joinRoom, send, leave } from './net.js';
import * as G from './game.js';

// ---------------------------------------------------------------- lobby
const show = id => { for (const el of ['menu', 'lobbyHost', 'lobbyJoin']) $(el).hidden = el !== id; };
function setStatus(el, text, cls = '') { $(el).textContent = text; $(el).className = 'status ' + cls; }
const NET_ERRORS = {
  'peer-unavailable': "No room with that code. Check the letters and make sure the host's lobby is still open.",
  timeout: "Couldn't connect. The host may have closed the lobby, or a network is blocking peer-to-peer connections.",
  network: "Couldn't reach the matchmaking server. Check your internet connection and try again.",
  'server-error': "Couldn't reach the matchmaking server. Try again in a moment.",
  'browser-incompatible': "This browser can't do peer-to-peer connections. Try a recent Chrome, Firefox, Edge or Safari.",
  nolib: "The co-op library didn't load. Check your connection and reload the page.",
};

$('bSolo').onclick = () => { initAudio(); startGame('solo'); };
$('bHost').onclick = () => {
  initAudio(); show('lobbyHost'); setStatus('hStatus', 'Opening a room…'); $('bStart').disabled = true;
  NET.onStatus = (s, d) => {
    if (S.state === 'play' || S.state === 'dying') { if (s === 'closed') G.onPartnerLost(); return; }
    if (s === 'open') {
      $('hCode').textContent = d; $('hLink').value = `${location.origin}${location.pathname}?join=${d}`;
      setStatus('hStatus', "Waiting for Sean's player to join…");
    } else if (s === 'connected') { setStatus('hStatus', "Sean's player is here. Start when you're both ready.", 'ok'); $('bStart').disabled = false; SFX.join(); }
    else if (s === 'closed') { setStatus('hStatus', "Sean's player left. Waiting for someone to join…"); $('bStart').disabled = true; }
    else if (s === 'error') setStatus('hStatus', NET_ERRORS[d] || `Connection problem (${d}). Try again.`, 'bad');
  };
  NET.onMsg = m => G.onNet(m);
  hostRoom();
};
$('bCopy').onclick = () => {
  const v = $('hLink').value; if (!v) return;
  navigator.clipboard?.writeText(v).then(() => { $('bCopy').textContent = 'COPIED'; setTimeout(() => $('bCopy').textContent = 'COPY INVITE LINK', 1500); })
    .catch(() => { $('hLink').select(); });
};
$('bStart').onclick = () => { if (!NET.connected) return; send({ t: 'start' }); startGame('host'); };
$('bJoin').onclick = () => { show('lobbyJoin'); $('jCode').focus(); };
$('jCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('bJoinGo').click(); e.stopPropagation(); });
$('jCode').addEventListener('input', () => { $('jCode').value = $('jCode').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
$('bJoinGo').onclick = () => {
  const code = $('jCode').value.trim().toUpperCase();
  if (code.length !== 5) { setStatus('jStatus', 'Room codes are 5 letters.', 'bad'); return; }
  initAudio(); leave(); $('bJoinGo').disabled = true;
  setStatus('jStatus', `Connecting to room ${code}…`);
  NET.onStatus = (s, d) => {
    if (S.state !== 'title') { if (s === 'closed' || s === 'error') G.onPartnerLost(); return; }
    if (s === 'connected') { setStatus('jStatus', "Connected. Waiting for Eric's player to start…", 'ok'); SFX.join(); }
    else if (s === 'closed') { setStatus('jStatus', 'The host closed the room.', 'bad'); $('bJoinGo').disabled = false; }
    else if (s === 'error') { setStatus('jStatus', NET_ERRORS[d] || `Connection problem (${d}). Try again.`, 'bad'); $('bJoinGo').disabled = false; leave(); }
  };
  NET.onMsg = m => {
    if (m.t === 'start') { if (S.state === 'title') startGame('guest'); return; }
    if (m.t === 'full') { setStatus('jStatus', 'That room already has two players.', 'bad'); $('bJoinGo').disabled = false; return; }
    G.onNet(m);
  };
  joinRoom(code);
};
document.querySelectorAll('.back').forEach(b => b.onclick = () => { leave(); show('menu'); $('bJoinGo').disabled = false; });
const joinParam = new URLSearchParams(location.search).get('join');
if (joinParam) { show('lobbyJoin'); $('jCode').value = joinParam.toUpperCase().slice(0, 5); setStatus('jStatus', 'Press JOIN to connect to your friend’s game.'); }

function startGame(mode) {
  G.setMode(mode);
  if (mode !== 'guest') G.initSim();
  $('screen').hidden = true; $('hud').classList.add('on');
  S.state = 'play'; requestLock();
  if (mode === 'guest') toast('CLICK TO CAPTURE THE MOUSE', 4);
  if (mode !== 'guest') setTimeout(G.introLines, 1200);
}

// ---------------------------------------------------------------- input
let locked = false, everLocked = false;
addEventListener('keydown', e => {
  if (e.target && e.target.tagName === 'INPUT') return;
  INPUT.keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
  if (S.state !== 'play' || S.paused) return;
  if (e.code === 'KeyF') G.toggleFlash();
  if (e.code === 'KeyQ') G.fireFlare();
  if (e.code === 'Space') G.dodge();
  if (e.code === 'KeyV') { VOICE.on = !VOICE.on; toast(VOICE.on ? 'VOICES ON' : 'VOICES OFF'); try { if (!VOICE.on) speechSynthesis.cancel(); } catch (er) { } }
  if (e.code === 'KeyP') pause();
});
addEventListener('keyup', e => { INPUT.keys[e.code] = false; });
addEventListener('blur', () => { for (const k in INPUT.keys) INPUT.keys[k] = false; INPUT.mouseL = INPUT.mouseR = false; });
canvas.addEventListener('mousedown', e => {
  if (S.state !== 'play' || S.paused) return;
  if (!locked) requestLock();
  if (e.button === 0) INPUT.mouseL = true;
  if (e.button === 2) INPUT.mouseR = true;
});
addEventListener('mouseup', e => { if (e.button === 0) INPUT.mouseL = false; if (e.button === 2) INPUT.mouseR = false; });
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('mousemove', e => {
  if (S.state !== 'play' || S.paused) return;
  if (!locked && everLocked) return;
  G.look(e.movementX, e.movementY);
});
function requestLock() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => { }); } catch (e) { } }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) everLocked = true;
  else if (S.state === 'play' && everLocked && !S.paused) pause();
});
function pause() {
  const coop = S.mode !== 'solo';
  INPUT.mouseL = INPUT.mouseR = false; for (const k in INPUT.keys) INPUT.keys[k] = false;
  if (coop) S.paused = true; else { S.state = 'paused'; try { speechSynthesis.pause(); } catch (e) { } }
  const scr = $('screen'); scr.hidden = false; scr.classList.add('click');
  scr.innerHTML = `<div class="tt"><div class="kick">PAUSED</div><h1 style="font-size:clamp(60px,10vw,120px)">ERIC</h1>
    <p class="story">${coop ? 'Co-op keeps running while you\'re here. Your friend is still out there.' : 'Hollow Creek waits for you.'}</p><div class="go">CLICK TO RESUME</div></div>`;
  scr.onclick = () => {
    scr.hidden = true; scr.onclick = null;
    if (coop) S.paused = false; else { S.state = 'play'; try { speechSynthesis.resume(); } catch (e) { } }
    requestLock();
  };
}

// ---------------------------------------------------------------- loop
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const rdt = Math.min(0.05, (now - last) / 1000); last = now;
  let dt = rdt;
  if (S.hitstop > 0) { S.hitstop -= rdt; dt *= 0.08; }
  if (S.slowmo > 0) { S.slowmo -= rdt; dt *= 0.3; }
  if (S.state === 'play' || S.state === 'dying' || S.state === 'ending') G.tick(dt, rdt);
  else if (S.state === 'title') G.titleTick(now, rdt);
  if (S.state !== 'paused') { updateFx(dt, rdt); updateRain(rdt); updateText(rdt); }
  updateGrain(rdt);
  composer.render();
}
requestAnimationFrame(loop);

if (TEST) window.G = { ...G.debug, startGame, NET, G };
