// Skeuomorphic audio for La Bibliothèque.
//
// All sounds are synthesized on the fly via the Web Audio API — no asset
// files, no network. We share a single lazily-created AudioContext (browsers
// cap the number of live contexts, and re-creating one per click leaks).
// The context is resumed on demand since it can only start after a gesture.

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

// Dry wood flex — used when a book is pulled from / slides onto the shelf.
export function playCreak() {
  const ctx = ac();
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sawtooth";
  o.frequency.setValueAtTime(180, t);
  o.frequency.exponentialRampToValueAtTime(60, t + 0.25);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(0.08, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.45);
}

// Low, soft impact — a heavy book settling onto wood.
export function playThud() {
  const ctx = ac();
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(90, t);
  o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
  g.gain.setValueAtTime(0.12, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.2);
}

// Short filtered-noise burst — the press of a wax seal / library stamp.
export function playStamp() {
  const ctx = ac();
  if (!ctx) return;
  const t = ctx.currentTime;
  // Noise burst
  const dur = 0.12;
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  }
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.setValueAtTime(900, t);
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(0.18, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(filt).connect(ng).connect(ctx.destination);
  src.start(t);
  src.stop(t + dur);
  // Body thump under the click
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(130, t);
  o.frequency.exponentialRampToValueAtTime(55, t + 0.1);
  g.gain.setValueAtTime(0.1, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + 0.16);
}

// The full "shelving" gesture: a creak immediately followed by the thud.
export function playShelve() {
  playCreak();
  const ctx = ac();
  if (!ctx) {
    setTimeout(playThud, 220);
    return;
  }
  // Schedule the thud a touch after the creak peaks.
  setTimeout(playThud, 200);
}

// A soft two-note chime — quiet confirmation that a tome was bound.
export function playChime() {
  const ctx = ac();
  if (!ctx) return;
  const t = ctx.currentTime;
  const notes = [523.25, 783.99]; // C5 -> G5
  notes.forEach((f, i) => {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "triangle";
    const start = t + i * 0.09;
    o.frequency.setValueAtTime(f, start);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.06, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
    o.connect(g).connect(ctx.destination);
    o.start(start);
    o.stop(start + 0.55);
  });
}
