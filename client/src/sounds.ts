// Skeuomorphic audio for La Bibliothèque.
//
// All sounds are synthesized live via the Web Audio API — no asset files, no
// network. A single lazily-created AudioContext is shared (browsers cap live
// contexts) and resumed on demand, since it can only start after a gesture.

let _ctx: AudioContext | null = null;

function ac(): AudioContext | null {
  try {
    if (!_ctx) {
      const Ctor = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctor) return null;
      _ctx = new Ctor();
    }
    if (_ctx.state === "suspended") void _ctx.resume();
    return _ctx;
  } catch {
    return null;
  }
}

// Dry wood flex — a book sliding out of a tight shelf.
export function playCreak() {
  const ctx = ac();
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(190, t);
  o.frequency.exponentialRampToValueAtTime(58, t + 0.28);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.06, t + 0.03);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
  const lp = ctx.createBiquadFilter();
  lp.type = "lowpass";
  lp.frequency.value = 1200;
  o.connect(lp).connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.46);
}

// Low, soft impact — a heavy clothbound book settling.
export function playThud() {
  const ctx = ac();
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(92, t);
  o.frequency.exponentialRampToValueAtTime(38, t + 0.13);
  g.gain.setValueAtTime(0.11, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.22);
}

// Soft paper sweep — a page turning.
export function playPageTurn() {
  const ctx = ac();
  if (!ctx) return;
  const t = ctx.currentTime;
  const dur = 0.22;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const env = Math.sin((i / data.length) * Math.PI); // swell in & out
    data[i] = (Math.random() * 2 - 1) * env * 0.5;
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.setValueAtTime(2600, t);
  bp.frequency.exponentialRampToValueAtTime(900, t + dur);
  bp.Q.value = 0.6;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.13, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(bp).connect(g).connect(ctx.destination);
  src.start(t);
  src.stop(t + dur);
}
