// Peer-to-peer co-op over WebRTC via PeerJS. The public PeerJS server only introduces
// the two browsers; game traffic then flows directly between them.
const PREFIX = 'hollowcreek-ek-';
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const NET = { mode: 'solo', peer: null, conn: null, code: '', connected: false, onMsg: null, onStatus: null };

function status(s, detail) { if (NET.onStatus) NET.onStatus(s, detail); }
function makeCode() { return Array.from({ length: 5 }, () => ALPHA[(Math.random() * ALPHA.length) | 0]).join(''); }
function wire(c) {
  c.on('open', () => { NET.conn = c; NET.connected = true; status('connected'); });
  c.on('data', d => { if (NET.onMsg) NET.onMsg(d); });
  c.on('close', () => { if (NET.conn === c) { NET.connected = false; NET.conn = null; status('closed'); } });
  c.on('error', () => { });
}

export function hostRoom() {
  if (typeof Peer === 'undefined') { status('error', 'nolib'); return; }
  NET.mode = 'host'; NET.code = makeCode();
  const peer = new Peer(PREFIX + NET.code, { debug: 0 }); NET.peer = peer;
  peer.on('open', () => status('open', NET.code));
  peer.on('connection', c => {
    if (NET.conn) { c.on('open', () => { c.send({ t: 'full' }); setTimeout(() => c.close(), 400); }); return; }
    wire(c);
  });
  peer.on('error', e => {
    if (e.type === 'unavailable-id') { peer.destroy(); hostRoom(); return; }
    status('error', e.type);
  });
  peer.on('disconnected', () => { try { if (!peer.destroyed) peer.reconnect(); } catch (e) { } });
}

export function joinRoom(code) {
  if (typeof Peer === 'undefined') { status('error', 'nolib'); return; }
  NET.mode = 'guest'; NET.code = code.toUpperCase();
  const peer = new Peer({ debug: 0 }); NET.peer = peer;
  peer.on('open', () => {
    const c = peer.connect(PREFIX + NET.code, { reliable: true, serialization: 'json' });
    wire(c);
    setTimeout(() => { if (!NET.connected) status('error', 'timeout'); }, 15000);
  });
  peer.on('error', e => status('error', e.type));
}

export function send(m) { if (NET.conn && NET.connected) { try { NET.conn.send(m); } catch (e) { } } }
export function leave() {
  try { if (NET.conn) NET.conn.close(); } catch (e) { }
  try { if (NET.peer) NET.peer.destroy(); } catch (e) { }
  NET.conn = null; NET.peer = null; NET.connected = false; NET.mode = 'solo';
}
