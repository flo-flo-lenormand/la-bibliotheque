import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { playCreak, playThud, playPageTurn } from "./sounds";

type Book = ApiResponse<typeof api, "list_books">["books"][number];

// CSS custom properties travel through `style` alongside real properties.
type Vars = CSSProperties & Record<`--${string}`, string | number>;

/* ------------------------------------------------------------------ *
 * Deterministic "binding" — the AI's metadata (title, author, pages)  *
 * decides each book's material, colour, thickness and gilding. Same    *
 * book ⇒ same object, every render.                                    *
 * ------------------------------------------------------------------ */

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const clamp = (lo: number, hi: number, v: number) => Math.max(lo, Math.min(hi, v));

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  if (amt >= 0) { r += (255 - r) * amt; g += (255 - g) * amt; b += (255 - b) * amt; }
  else { r *= 1 + amt; g *= 1 + amt; b *= 1 + amt; }
  const to = (v: number) => Math.round(clamp(0, 255, v)).toString(16).padStart(2, "0");
  return `#${to(r)}${to(g)}${to(b)}`;
}

// Aged library palette — muted jewels & leathers.
const PALETTE = [
  "#6E2A24", "#5A1F2B", "#2F4030", "#234B47", "#1F2D4A",
  "#7A4A2B", "#3E2A3A", "#7E631C", "#2A2622", "#1E3A2E", "#52301B", "#3A1C1C",
];
const RIBBONS = ["#C9A227", "#8E2C24", "#2F4A44", "#E2C799", "#3A4E6B"];
const ORNAMENTS = ["✦", "❧", "✧", "❖", "◆", "✶", "⁘"];

type Material = "leather" | "cloth" | "paper";
type Identity = {
  material: Material;
  base: string; deep: string; mid: string; gilt: string; giltHi: string;
  W: number; H: number; D: number;
  lean: number; hubs: number; ribbon: string | null; ornament: string;
  gildTop: boolean; wear: number;
};

function identityFor(book: Book): Identity {
  const seed = hash(`${book.id}:${book.title}:${book.author}`);
  const rnd = mulberry32(seed);
  const base = PALETTE[seed % PALETTE.length]!;
  const m = rnd();
  const material: Material = m < 0.5 ? "leather" : m < 0.82 ? "cloth" : "paper";
  const pages = book.page_count ?? 280;
  const D = Math.round(clamp(20, 62, 20 + (pages - 120) * 0.072));
  const H = Math.round(clamp(168, 212, 168 + (hash(book.title) % 46)));
  const W = Math.round(H * 0.64);
  return {
    material,
    base,
    deep: shade(base, -0.42),
    mid: shade(base, 0.1),
    gilt: "#C9A227",
    giltHi: "#F0DDA0",
    W, H, D,
    lean: (rnd() - 0.5) * 2.4,
    hubs: material === "leather" ? 3 + Math.floor(rnd() * 2) : 0,
    ribbon: rnd() < 0.42 ? RIBBONS[Math.floor(rnd() * RIBBONS.length)]! : null,
    ornament: ORNAMENTS[Math.floor(rnd() * ORNAMENTS.length)]!,
    gildTop: rnd() < 0.5,
    wear: rnd(),
  };
}

/* ------------------------------------------------------------------ *
 * Hooks                                                                *
 * ------------------------------------------------------------------ */

function useReducedMotion() {
  const [r, setR] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setR(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return r;
}

// Camera tilt from pointer / device, smoothed toward a target.
function useTilt(reduced: boolean) {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const target = useRef({ x: 0, y: 0 });
  const cur = useRef({ x: 0, y: 0 });
  useEffect(() => {
    if (reduced) return;
    const onMove = (e: MouseEvent) => {
      target.current = {
        x: (e.clientX / window.innerWidth - 0.5) * 12,
        y: (e.clientY / window.innerHeight - 0.5) * -7,
      };
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      target.current = {
        x: clamp(-12, 12, e.gamma * 0.5),
        y: clamp(-7, 7, (e.beta - 50) * -0.25),
      };
    };
    let raf = 0;
    const loop = () => {
      cur.current.x += (target.current.x - cur.current.x) * 0.06;
      cur.current.y += (target.current.y - cur.current.y) * 0.06;
      setTilt({ x: Math.round(cur.current.x * 100) / 100, y: Math.round(cur.current.y * 100) / 100 });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("deviceorientation", onOrient);
    };
  }, [reduced]);
  return tilt;
}

// Dust motes drifting through the lamp beam, brighter near the top light.
function useLightDust(count = 70) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    type P = { x: number; y: number; r: number; vx: number; vy: number; a: number; tw: number };
    const ps: P[] = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.5,
      vx: (Math.random() - 0.5) * 0.00012,
      vy: (Math.random() - 0.5) * 0.00009 - 0.00003,
      a: 0.15 + Math.random() * 0.55,
      tw: Math.random() * Math.PI * 2,
    }));
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      canvas.width = w * dpr; canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    let raf = 0;
    const tick = (t: number) => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy; p.tw += 0.02;
        if (p.x < -0.05) p.x = 1.05; if (p.x > 1.05) p.x = -0.05;
        if (p.y < -0.05) p.y = 1.05; if (p.y > 1.05) p.y = -0.05;
        // brighter toward the top-centre beam
        const beam = (1 - p.y) * (1 - Math.abs(p.x - 0.5) * 1.3);
        const tw = 0.6 + 0.4 * Math.sin(p.tw + t * 0.001);
        const a = p.a * clamp(0, 1, beam) * tw;
        if (a <= 0.01) continue;
        ctx.beginPath();
        ctx.fillStyle = `rgba(231,205,138,${a * 0.5})`;
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [count]);
  return ref;
}

/* ------------------------------------------------------------------ *
 * A single 3D book — a real cuboid with six faces.                     *
 * ------------------------------------------------------------------ */

function Book3D({ book, idx, mounted, onOpen }: {
  book: Book; idx: number; mounted: boolean; onOpen: (b: Book) => void;
}) {
  const id = useMemo(() => identityFor(book), [book.id, book.title, book.author, book.page_count]);
  const last = book.author.split(" ").filter(Boolean).pop() ?? book.author;
  const hasImg = !!book.cover_image_url;
  const isSuggest = book.status === "suggéré";

  const vars: Vars = {
    "--w": `${id.W}px`,
    "--h": `${id.H}px`,
    "--d": `${id.D}px`,
    "--base": id.base,
    "--deep": id.deep,
    "--mid": id.mid,
    "--gilt": id.gilt,
    "--gilt-hi": id.giltHi,
    "--lean": `${id.lean}deg`,
    "--i": idx,
  };

  const spineTitle = book.title.length > 26 ? book.title.slice(0, 24) + "…" : book.title;

  return (
    <button
      className={`book ${mounted ? "book--in" : ""} ${isSuggest ? "book--suggest" : ""}`}
      style={vars}
      onClick={() => onOpen(book)}
      aria-label={`${book.title} — ${book.author}`}
    >
      <span className="book__contact" aria-hidden />
      <span className="book__inner">
        {/* back */}
        <span className="face face--back" aria-hidden />
        {/* fore-edge (pages) */}
        <span className="face face--edge" aria-hidden />
        {/* bottom */}
        <span className="face face--bottom" aria-hidden />
        {/* top — page block + optional gilt edge */}
        <span className={`face face--top ${id.gildTop ? "is-gilt" : ""}`} aria-hidden>
          <span className="top-pages" />
        </span>
        {/* spine */}
        <span className={`face face--spine mat-${id.material}`} aria-hidden>
          <span className="spine-rule spine-rule--top" />
          {id.hubs > 0 && Array.from({ length: id.hubs }).map((_, i) => (
            <span key={i} className="spine-hub" style={{ top: `${22 + (i * 56) / id.hubs}%` } as Vars} />
          ))}
          <span className="spine-label">{spineTitle}</span>
          <span className="spine-author">{last}</span>
          <span className="spine-rule spine-rule--bot" />
        </span>
        {/* front cover */}
        <span
          className={`face face--front mat-${id.material} ${hasImg ? "has-img" : ""}`}
          style={hasImg ? ({ "--img": `url("${book.cover_image_url}")` } as Vars) : undefined}
        >
          {!hasImg && (
            <span className="cover-proc">
              <span className="cover-frame" />
              <span className="cover-orn cover-orn--top">{id.ornament}</span>
              <span className="cover-title">{book.title}</span>
              <span className="cover-author">{book.author}</span>
              <span className="cover-orn cover-orn--bot">{id.ornament}</span>
            </span>
          )}
          <span className="cover-sheen" />
          <span className="cover-shade" />
        </span>
      </span>

      {id.ribbon && <span className="book__ribbon" style={{ "--rb": id.ribbon } as Vars} aria-hidden />}
      {isSuggest && (
        <span className="book__tag" aria-hidden>
          <span className="book__tag-dot" />
        </span>
      )}
    </button>
  );
}

/* ------------------------------------------------------------------ *
 * A shelf — engraved label, page-count, scrollable row of 3D books.    *
 * ------------------------------------------------------------------ */

function Shelf({ label, books, mounted, onOpen }: {
  label: string; books: Book[]; mounted: boolean; onOpen: (b: Book) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const nudge = (dir: number) => rowRef.current?.scrollBy({ left: dir * 240, behavior: "smooth" });
  return (
    <section className="shelf">
      <header className="shelf__head">
        <h2 className="shelf__label">{label}</h2>
        <div className="shelf__meta">
          <span className="shelf__count">{String(books.length).padStart(2, "0")}</span>
          <span className="shelf__unit">{books.length > 1 ? "volumes" : "volume"}</span>
          {books.length > 2 && (
            <span className="shelf__nav">
              <button onClick={() => nudge(-1)} aria-label="Précédent">‹</button>
              <button onClick={() => nudge(1)} aria-label="Suivant">›</button>
            </span>
          )}
        </div>
      </header>

      <div className="shelf__stage">
        {books.length === 0 ? (
          <div className="shelf__empty">L'intelligence n'a encore rien déposé ici.</div>
        ) : (
          <div className="shelf__row" ref={rowRef}>
            {books.map((b, i) => (
              <Book3D key={b.id} book={b} idx={i} mounted={mounted} onOpen={onOpen} />
            ))}
            <span className="shelf__bookend" aria-hidden />
          </div>
        )}
        {/* the physical plank the books rest on */}
        <div className="plank" aria-hidden>
          <span className="plank__top" />
          <span className="plank__front" />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Reading scene — a 3D tome that opens, orbits, and turns pages.       *
 * ------------------------------------------------------------------ */

function ReadingScene({ book, onClose, reduced }: {
  book: Book; onClose: () => void; reduced: boolean;
}) {
  const id = useMemo(() => identityFor(book), [book.id, book.title, book.author, book.page_count]);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const sceneRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const a = requestAnimationFrame(() => setOpen(true));
    if (!reduced) setTimeout(playCreak, 60);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { cancelAnimationFrame(a); document.body.style.overflow = prev; };
  }, [reduced]);

  const close = useCallback(() => {
    playThud();
    setOpen(false);
    setTimeout(onClose, 460);
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const onMove = useCallback((e: ReactPointerEvent) => {
    if (reduced) return;
    const r = sceneRef.current?.getBoundingClientRect();
    if (!r) return;
    setTilt({
      x: ((e.clientX - r.left) / r.width - 0.5) * 18,
      y: ((e.clientY - r.top) / r.height - 0.5) * -14,
    });
  }, [reduced]);

  const turn = (to: number) => {
    if (to === page) return;
    playPageTurn();
    setPage(to);
  };

  const dateStr = new Date(book.date_added).toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric",
  });
  const note = book.personal_note || "Aucune note n'accompagne encore ce volume.";

  const vars: Vars = {
    "--base": id.base, "--deep": id.deep, "--mid": id.mid,
    "--gilt": id.gilt, "--gilt-hi": id.giltHi,
    "--rx": `${tilt.y}deg`, "--ry": `${tilt.x}deg`,
  };

  return (
    <div className="reader" role="dialog" aria-modal="true" aria-label={book.title}>
      <div className={`reader__veil ${open ? "is-open" : ""}`} onClick={close} />
      <button className={`reader__close ${open ? "is-open" : ""}`} onClick={close} aria-label="Reposer le livre">✕</button>

      <div className="reader__scene" ref={sceneRef} onPointerMove={onMove} onPointerLeave={() => setTilt({ x: 0, y: 0 })} style={vars}>
        <div className={`tome ${open ? "tome--open" : ""} ${reduced ? "tome--still" : ""}`} data-page={page}>
          {/* page block thickness */}
          <div className="tome__block" aria-hidden>
            <span className="tome__pages-edge" />
          </div>

          {/* LEFT board */}
          <div className="leaf leaf--left">
            <div className="leaf__face">
              {page === 0 ? (
                <div className="pg pg--cover">
                  <div className="pg__cover-art">
                    {book.cover_image_url
                      ? <img src={book.cover_image_url} alt="" />
                      : <div className="pg__cover-proc"><span>{id.ornament}</span><h3>{book.title}</h3><p>{book.author}</p></div>}
                    <span className="pg__cover-glow" />
                  </div>
                </div>
              ) : (
                <div className="pg pg--detail">
                  <span className="pg__kicker">Le volume</span>
                  <dl className="pg__dl">
                    <div><dt>Titre</dt><dd>{book.title}</dd></div>
                    <div><dt>Auteur·ice</dt><dd>{book.author}</dd></div>
                    <div><dt>État</dt><dd>{book.status === "suggéré" ? "Suggéré par l'intelligence" : "Lu"}</dd></div>
                    {book.page_count && <div><dt>Pages</dt><dd>{book.page_count}</dd></div>}
                    {book.isbn && <div><dt>ISBN</dt><dd>{book.isbn}</dd></div>}
                  </dl>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT board */}
          <div className="leaf leaf--right">
            <div className="leaf__face">
              {page === 0 ? (
                <div className="pg pg--note">
                  <span className="pg__kicker">{book.status === "suggéré" ? "Pourquoi le lire" : "Note de lecture"}</span>
                  <p className="pg__note"><span className="pg__drop">{note.charAt(0)}</span>{note.slice(1)}</p>
                  <div className="pg__sign">— {book.status === "suggéré" ? "l'intelligence" : "le lecteur"} · {dateStr}</div>
                </div>
              ) : (
                <div className="pg pg--colophon">
                  <span className="pg__orn">{id.ornament}</span>
                  <p className="pg__col-text">Reposé avec soin sur l'étagère.</p>
                  <button className="pg__rest" onClick={close}>Reposer le livre</button>
                </div>
              )}
            </div>
          </div>

          {/* spine ridge */}
          <div className="tome__spine" aria-hidden />
          {id.ribbon && <span className="tome__ribbon" style={{ "--rb": id.ribbon } as Vars} aria-hidden />}
        </div>

        <div className={`reader__dots ${open ? "is-open" : ""}`}>
          {[0, 1].map((p) => (
            <button key={p} className={p === page ? "is-on" : ""} onClick={() => turn(p)} aria-label={`Feuillet ${p + 1}`} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * App                                                                  *
 * ------------------------------------------------------------------ */

export function App() {
  const { data, isPending } = useQuery({
    queryKey: ["books"],
    queryFn: () => api.list_books({}),
  });
  const books = data?.books ?? [];

  const reduced = useReducedMotion();
  const tilt = useTilt(reduced);
  const dustRef = useLightDust(80);

  const [activeId, setActiveId] = useState<number | null>(null);
  const active = useMemo(() => books.find((b) => b.id === activeId) ?? null, [books, activeId]);

  // stagger the entrance once data lands
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!isPending && books.length >= 0) {
      const t = setTimeout(() => setMounted(true), 60);
      return () => clearTimeout(t);
    }
  }, [isPending, books.length]);

  const lus = useMemo(() => books.filter((b) => b.status !== "suggéré"), [books]);
  const sugg = useMemo(() => books.filter((b) => b.status === "suggéré"), [books]);

  const openBook = useCallback((b: Book) => {
    playCreak();
    setActiveId(b.id);
  }, []);

  const sceneVars: Vars = { "--rx": `${tilt.y}deg`, "--ry": `${tilt.x}deg` };

  return (
    <div className="lib">
      <div className="lib__bg" aria-hidden />
      <div className="lib__beam" aria-hidden style={sceneVars} />
      <canvas ref={dustRef} className="lib__dust" aria-hidden />

      <main className="lib__main">
        <header className="masthead">
          <span className="masthead__over">Ma collection · curatée par l'intelligence</span>
          <h1 className="masthead__title">Bibliothèque</h1>
          <span className="masthead__rule" />
        </header>

        {isPending ? (
          <div className="lib__loading">Ouverture de la bibliothèque…</div>
        ) : (
          <div className="cabinet" style={sceneVars}>
            <div className="cabinet__world">
              <span className="cabinet__wall cabinet__wall--l" aria-hidden />
              <span className="cabinet__wall cabinet__wall--r" aria-hidden />
              <span className="cabinet__crown" aria-hidden />
              <div className="cabinet__inner">
                <Shelf label="Lus" books={lus} mounted={mounted} onOpen={openBook} />
                <Shelf label="Suggérés par l'intelligence" books={sugg} mounted={mounted} onOpen={openBook} />
              </div>
              <span className="cabinet__plinth" aria-hidden />
            </div>
          </div>
        )}

        <footer className="colophon">
          <span>{books.length} volumes</span>
          <span className="colophon__dot">·</span>
          <span>{lus.length} lus</span>
          <span className="colophon__dot">·</span>
          <span>{sugg.length} suggérés</span>
        </footer>
      </main>

      {active && <ReadingScene book={active} reduced={reduced} onClose={() => setActiveId(null)} />}

      <style>{CSS}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Styles — the whole skeuomorphic 3D library lives here.               *
 * ------------------------------------------------------------------ */

const CSS = String.raw`
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,500&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400;1,6..72,500&display=swap');

.lib *, .reader * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.lib {
  --ink: #F3E8D6; --dim: #B9A488; --gold: #C9A227; --gold-hi: #E7CD8A;
  --wood: #4A3022; --wood-dk: #2A1A0F; --wood-lt: #6B4630;
  position: relative; min-height: 100vh; overflow: hidden;
  background: #0B0805; color: var(--ink);
  font-family: 'Newsreader', Georgia, serif; user-select: none;
  -webkit-font-smoothing: antialiased;
}

/* deep room background + vignette */
.lib__bg {
  position: fixed; inset: 0; pointer-events: none;
  background:
    radial-gradient(130% 80% at 50% -10%, rgba(231,205,138,0.10), transparent 52%),
    radial-gradient(100% 100% at 50% 120%, rgba(0,0,0,0.85), transparent 45%),
    radial-gradient(140% 120% at 50% 40%, #1a120b 0%, #0b0805 70%);
}
.lib__bg::after { /* faint panelled wall */
  content: ""; position: absolute; inset: 0; opacity: 0.5; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.012 0.11' numOctaves='5' seed='7'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.5 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.lib__beam { /* warm lamp cone from above, drifts with parallax */
  position: fixed; left: 50%; top: -8%; width: 80%; height: 70%;
  transform: translateX(-50%) translate3d(calc(var(--ry,0deg) * 0.6), 0, 0);
  pointer-events: none; filter: blur(8px); opacity: 0.7;
  background: radial-gradient(46% 70% at 50% 0%, rgba(231,205,138,0.30), rgba(231,205,138,0.06) 45%, transparent 70%);
}
.lib__dust { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; opacity: 0.9; }

.lib__main { position: relative; z-index: 2; max-width: 1040px; margin: 0 auto;
  padding: calc(env(safe-area-inset-top) + 30px) 16px calc(env(safe-area-inset-bottom) + 40px); }

/* ---- masthead ---- */
.masthead { text-align: center; margin-bottom: 26px; }
.masthead__over { display: block; font-size: 11px; letter-spacing: 0.34em; text-transform: uppercase;
  color: var(--dim); font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.masthead__title { margin: 8px 0 0; font-family: 'Playfair Display', serif; font-weight: 500;
  font-size: clamp(44px, 13vw, 96px); line-height: 0.92; letter-spacing: -0.01em;
  color: var(--ink); text-shadow: 0 1px 0 rgba(0,0,0,0.6), 0 0 36px rgba(231,205,138,0.18); }
.masthead__rule { display: block; width: 56px; height: 1px; margin: 18px auto 0;
  background: linear-gradient(90deg, transparent, var(--gold), transparent); opacity: 0.7; }

.lib__loading { text-align: center; color: var(--dim); padding: 80px 0; font-style: italic; }

/* ---- cabinet (the 3D wooden case) ---- */
.cabinet { perspective: 1500px; perspective-origin: 50% 36%; }
.cabinet__world {
  position: relative; transform-style: preserve-3d;
  transform: rotateX(calc(var(--rx,0deg) * 0.5)) rotateY(calc(var(--ry,0deg) * 0.5));
  transition: transform 200ms ease-out;
  border-radius: 14px;
  padding: 20px 14px;
  background:
    linear-gradient(180deg, #3a2417, #241409);
  box-shadow: 0 0 0 1px rgba(0,0,0,0.7), 0 50px 120px rgba(0,0,0,0.7), inset 0 0 70px rgba(0,0,0,0.65);
}
.cabinet__world::before { /* wood grain skin on the case */
  content: ""; position: absolute; inset: 0; border-radius: 14px; pointer-events: none; opacity: 0.55; mix-blend-mode: overlay;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='400'%3E%3Cfilter id='w'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.009 0.085' numOctaves='5' seed='13'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.75 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23w)'/%3E%3C/svg%3E");
}
.cabinet__crown { position: absolute; left: -6px; right: -6px; top: -14px; height: 20px; border-radius: 8px 8px 4px 4px;
  background: linear-gradient(180deg, #74502f, #3a2417 70%, #20120a); transform: translateZ(40px);
  box-shadow: 0 10px 26px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.12); }
.cabinet__plinth { position: absolute; left: -6px; right: -6px; bottom: -14px; height: 22px; border-radius: 4px 4px 8px 8px;
  background: linear-gradient(180deg, #4a3022, #20120a); transform: translateZ(40px);
  box-shadow: 0 16px 30px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.08); }
.cabinet__wall { position: absolute; top: 6px; bottom: 6px; width: 26px;
  background: linear-gradient(90deg, #1c0f07, #2e1b0e); }
.cabinet__wall--l { left: 0; transform: rotateY(58deg) translateZ(2px); transform-origin: left center; border-radius: 6px 0 0 6px; }
.cabinet__wall--r { right: 0; transform: rotateY(-58deg) translateZ(2px); transform-origin: right center; border-radius: 0 6px 6px 0; }

.cabinet__inner {
  position: relative; border-radius: 8px; padding: 6px 8px;
  background: linear-gradient(180deg, #18100a, #0d0805);
  box-shadow: inset 0 0 60px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.8);
  transform-style: preserve-3d;
}

/* ---- shelf ---- */
.shelf { position: relative; padding: 14px 4px 4px; }
.shelf + .shelf { margin-top: 10px; }
.shelf__head { display: flex; align-items: baseline; justify-content: space-between; padding: 0 8px 6px; }
.shelf__label { margin: 0; font-family: 'Playfair Display', serif; font-style: italic; font-weight: 500;
  font-size: clamp(17px, 4.6vw, 23px); color: var(--gold-hi);
  text-shadow: 0 1px 1px rgba(0,0,0,0.7); }
.shelf__meta { display: flex; align-items: baseline; gap: 8px; font-family: ui-monospace, "SF Mono", Menlo, monospace; }
.shelf__count { font-size: 16px; color: var(--ink); letter-spacing: 0.05em; }
.shelf__unit { font-size: 10px; letter-spacing: 0.2em; text-transform: uppercase; color: var(--dim); }
.shelf__nav { display: inline-flex; gap: 2px; margin-left: 4px; }
.shelf__nav button { width: 24px; height: 24px; border: none; cursor: pointer; color: var(--dim);
  background: rgba(255,255,255,0.04); border-radius: 6px; font-size: 16px; line-height: 1;
  transition: color .2s, background .2s; }
.shelf__nav button:hover { color: var(--gold-hi); background: rgba(231,205,138,0.1); }

.shelf__stage { position: relative; perspective: 1300px; perspective-origin: 50% 32%; }
.shelf__row {
  position: relative; z-index: 2; display: flex; align-items: flex-end; gap: 10px;
  padding: 26px 16px 0; min-height: 248px;
  overflow-x: auto; overflow-y: visible; scroll-snap-type: x proximity;
  transform-style: preserve-3d; scrollbar-width: none; -ms-overflow-style: none;
}
.shelf__row::-webkit-scrollbar { display: none; }
.shelf__bookend { flex: 0 0 8px; }
.shelf__empty { padding: 40px 16px 30px; text-align: center; color: var(--dim); font-style: italic; font-size: 14px; opacity: 0.8; }

/* the plank the books sit on */
.plank { position: absolute; left: 4px; right: 4px; bottom: 0; height: 26px; z-index: 1; transform-style: preserve-3d; }
.plank__top { position: absolute; inset: 0 0 12px; border-radius: 3px;
  background: linear-gradient(180deg, #6a4528, #3a2417);
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.14), 0 1px 0 rgba(0,0,0,0.5); }
.plank__front { position: absolute; left: 0; right: 0; bottom: 0; height: 14px; border-radius: 0 0 4px 4px;
  background: linear-gradient(180deg, #3a2417, #1c0f07);
  box-shadow: 0 12px 24px rgba(0,0,0,0.6); }

/* ---- the 3D book ---- */
.book {
  position: relative; flex: 0 0 auto; width: var(--w); height: var(--h);
  margin-right: calc(-1 * var(--d) * 0.35); /* slight overlap, like a packed shelf */
  border: 0; background: none; padding: 0; cursor: pointer;
  transform-style: preserve-3d; scroll-snap-align: center;
  opacity: 0;
}
.book--in { animation: bookIn 0.7s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i) * 70ms); }
@keyframes bookIn {
  from { opacity: 0; transform: translateY(26px); }
  to   { opacity: 1; transform: translateY(0); }
}
.book__inner {
  position: absolute; inset: 0; transform-style: preserve-3d; transform-origin: 50% 100%;
  transform: rotateX(calc(4deg + var(--rx,0deg) * -0.15)) rotateY(calc(-26deg + var(--ry,0deg) * 0.25)) rotateZ(var(--lean));
  transition: transform .65s cubic-bezier(.2,.8,.2,1);
}
.book:hover .book__inner, .book:focus-visible .book__inner {
  transform: translateY(-12px) translateZ(46px) rotateX(2deg) rotateY(-14deg) rotateZ(0deg);
}
.book:focus-visible { outline: none; }

.face { position: absolute; left: 50%; top: 50%; transform-style: preserve-3d; backface-visibility: hidden; overflow: hidden; }
.face--front  { width: var(--w); height: var(--h); transform: translate(-50%,-50%) translateZ(calc(var(--d) / 2)); border-radius: 1px 3px 3px 1px; }
.face--back   { width: var(--w); height: var(--h); transform: translate(-50%,-50%) rotateY(180deg) translateZ(calc(var(--d) / 2));
  background: linear-gradient(135deg, var(--deep), #0c0805); }
.face--spine  { width: var(--d); height: var(--h); transform: translate(-50%,-50%) rotateY(-90deg) translateZ(calc(var(--w) / 2)); border-radius: 2px 0 0 2px; }
.face--edge   { width: var(--d); height: var(--h); transform: translate(-50%,-50%) rotateY(90deg) translateZ(calc(var(--w) / 2));
  background: repeating-linear-gradient(0deg, #efe6d3 0 1px, #d8ccb6 1px 2.4px); box-shadow: inset 0 0 6px rgba(0,0,0,0.35); }
.face--top    { width: var(--w); height: var(--d); transform: translate(-50%,-50%) rotateX(90deg) translateZ(calc(var(--h) / 2)); }
.face--bottom { width: var(--w); height: var(--d); transform: translate(-50%,-50%) rotateX(-90deg) translateZ(calc(var(--h) / 2));
  background: #160d07; }

.face--top .top-pages { position: absolute; inset: 0; background: repeating-linear-gradient(90deg, #efe6d3 0 1px, #d8ccb6 1px 2.4px); }
.face--top.is-gilt .top-pages { background: linear-gradient(90deg, #b8902f, #e7cd8a 40%, #b8902f); opacity: 0.9; }

/* materials (front + spine share a base) */
.mat-leather { background: linear-gradient(135deg, var(--mid), var(--base) 42%, var(--deep)); }
.mat-cloth   { background: linear-gradient(135deg, var(--base), var(--deep)); }
.mat-paper   { background: linear-gradient(135deg, var(--mid), var(--base)); }
.mat-leather::after { /* leather grain */
  content: ""; position: absolute; inset: 0; opacity: 0.4; mix-blend-mode: overlay; pointer-events: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='l'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='3' seed='4'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.6 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23l)'/%3E%3C/svg%3E"); }
.mat-cloth::after { /* woven cloth */
  content: ""; position: absolute; inset: 0; opacity: 0.18; mix-blend-mode: overlay; pointer-events: none;
  background-image: repeating-linear-gradient(0deg, rgba(255,255,255,0.5) 0 1px, transparent 1px 2px), repeating-linear-gradient(90deg, rgba(0,0,0,0.5) 0 1px, transparent 1px 2px); background-size: 3px 3px; }

/* front cover lighting + image */
.face--front.has-img { background-image: var(--img); background-size: cover; background-position: center; }
.cover-sheen { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(125deg, rgba(255,255,255,0.22), rgba(255,255,255,0.04) 26%, transparent 50%); }
.cover-shade { position: absolute; inset: 0; pointer-events: none;
  background: linear-gradient(125deg, transparent 55%, rgba(0,0,0,0.28)); }
.face--front::before { /* spine-edge crease */
  content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 5px;
  background: linear-gradient(90deg, rgba(0,0,0,0.5), transparent); z-index: 3; }

/* procedural cover */
.cover-proc { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
  padding: 16px 12px; text-align: center; }
.cover-frame { position: absolute; inset: 8px; border: 1px solid color-mix(in srgb, var(--gilt) 70%, transparent);
  box-shadow: inset 0 0 0 3px transparent, inset 0 0 0 4px color-mix(in srgb, var(--gilt) 40%, transparent); border-radius: 1px; }
.cover-orn { color: var(--gilt-hi); font-size: 15px; text-shadow: 0 1px 1px rgba(0,0,0,0.6); z-index: 1; }
.cover-title { z-index: 1; font-family: 'Playfair Display', serif; font-weight: 600; font-size: 15px; line-height: 1.12;
  color: #f6ecd5; text-shadow: 0 1px 2px rgba(0,0,0,0.6); display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
.cover-author { z-index: 1; font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--gilt-hi);
  font-family: ui-monospace, monospace; opacity: 0.9; }

/* spine engraving */
.face--spine { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 14px 0; }
.face--spine::after { content: ""; position: absolute; inset: 0; box-shadow: inset 6px 0 10px rgba(0,0,0,0.5), inset -4px 0 8px rgba(0,0,0,0.4); pointer-events: none; }
.spine-rule { width: 60%; height: 1px; background: linear-gradient(90deg, transparent, var(--gilt-hi), transparent); opacity: 0.8; }
.spine-rule--top { margin-bottom: auto; }
.spine-rule--bot { margin-top: auto; }
.spine-hub { position: absolute; left: 0; right: 0; height: 5px;
  background: linear-gradient(180deg, rgba(255,255,255,0.16), rgba(0,0,0,0.4)); box-shadow: 0 1px 1px rgba(0,0,0,0.5); }
.spine-label { writing-mode: vertical-rl; transform: rotate(180deg); font-family: 'Playfair Display', serif; font-weight: 600;
  font-size: clamp(8px, calc(var(--d) * 0.34), 13px); letter-spacing: 0.02em; color: var(--gilt-hi);
  text-shadow: 0 0 4px rgba(231,205,138,0.4), 0 1px 1px rgba(0,0,0,0.6); white-space: nowrap; max-height: 64%; overflow: hidden; }
.spine-author { writing-mode: vertical-rl; transform: rotate(180deg); font-size: 8px; letter-spacing: 0.18em;
  text-transform: uppercase; color: color-mix(in srgb, var(--gilt) 80%, #fff); font-family: ui-monospace, monospace; opacity: 0.85; margin-top: 6px; }

/* contact shadow on the plank */
.book__contact { position: absolute; left: -6%; right: -18%; bottom: -8px; height: 20px; z-index: -1;
  background: radial-gradient(60% 100% at 42% 50%, rgba(0,0,0,0.6), transparent 72%); filter: blur(5px);
  transform: translateZ(-2px); transition: opacity .4s; }
.book:hover .book__contact { opacity: 0.4; }

/* ribbon bookmark peeking from the top */
.book__ribbon { position: absolute; top: -10px; left: 24%; width: 7px; height: 30px; z-index: 4;
  background: linear-gradient(180deg, color-mix(in srgb, var(--rb) 80%, #000), var(--rb));
  clip-path: polygon(0 0, 100% 0, 100% 100%, 50% 78%, 0 100%); box-shadow: 0 2px 4px rgba(0,0,0,0.5);
  transform: translateZ(calc(var(--d) / 2 - 4px)); }

/* suggested glow tag */
.book--suggest .book__inner { box-shadow: 0 0 0 transparent; }
.book__tag { position: absolute; top: 6px; right: 8px; z-index: 5; transform: translateZ(calc(var(--d) / 2 + 4px)); }
.book__tag-dot { display: block; width: 7px; height: 7px; border-radius: 50%; background: var(--gold-hi);
  box-shadow: 0 0 8px 2px rgba(231,205,138,0.7); animation: pulse 2.4s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 0.5; transform: scale(0.8); } 50% { opacity: 1; transform: scale(1.15); } }

/* ---- colophon ---- */
.colophon { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 26px;
  font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 11px; letter-spacing: 0.16em;
  text-transform: uppercase; color: var(--dim); }
.colophon__dot { opacity: 0.5; }

/* ================================================================== *
 * Reading scene                                                       *
 * ================================================================== */
.reader { position: fixed; inset: 0; z-index: 50; display: grid; place-items: center; }
.reader__veil { position: absolute; inset: 0; background:
  radial-gradient(120% 90% at 50% 0%, rgba(231,205,138,0.10), transparent 50%), rgba(6,4,2,0.86);
  backdrop-filter: blur(4px); opacity: 0; transition: opacity .5s; }
.reader__veil.is-open { opacity: 1; }
.reader__close { position: absolute; top: max(env(safe-area-inset-top), 14px); right: 16px; z-index: 4;
  width: 42px; height: 42px; border-radius: 50%; border: none; cursor: pointer; color: var(--ink);
  background: linear-gradient(180deg, #4a3022, #20120a); box-shadow: 0 4px 12px rgba(0,0,0,0.5), inset 0 1px 0 rgba(255,255,255,0.1);
  font-size: 16px; opacity: 0; transform: scale(0.8); transition: opacity .4s .2s, transform .4s .2s; }
.reader__close.is-open { opacity: 1; transform: scale(1); }
.reader__close:active { transform: scale(0.9); }

.reader__scene { position: relative; z-index: 2; width: min(94vw, 760px); height: min(78vh, 600px);
  perspective: 1700px; perspective-origin: 50% 42%; display: grid; place-items: center; }

.tome { position: relative; width: min(86vw, 660px); height: min(64vh, 460px); transform-style: preserve-3d;
  transform: rotateX(72deg) rotateZ(0deg) scale(0.6); opacity: 0;
  transition: transform .9s cubic-bezier(.16,1,.3,1), opacity .5s; }
.tome--open { opacity: 1;
  transform: rotateX(calc(20deg + var(--rx,0deg) * 0.5)) rotateY(calc(var(--ry,0deg) * 0.5)) scale(1);
  animation: tomeBreathe 9s ease-in-out infinite 1s; }
.tome--still.tome--open { animation: none; }
@keyframes tomeBreathe {
  0%,100% { transform: rotateX(20deg) rotateY(-2deg) scale(1); }
  50%     { transform: rotateX(17deg) rotateY(3deg) translateZ(8px) scale(1.005); }
}

.tome__block { position: absolute; left: 50%; bottom: 0; width: 70%; height: 22px; transform: translate(-50%, 10px) rotateX(90deg);
  transform-origin: bottom center; background: repeating-linear-gradient(90deg, #efe6d3 0 1.5px, #cdbfa6 1.5px 3px);
  border-radius: 2px; box-shadow: 0 0 18px rgba(0,0,0,0.5); }

.leaf { position: absolute; top: 0; bottom: 0; width: 50%; transform-style: preserve-3d; }
.leaf--left { left: 0; transform-origin: right center; transform: rotateY(18deg); }
.leaf--right { right: 0; transform-origin: left center; transform: rotateY(-18deg); }
.tome--open .leaf--left { transform: rotateY(0deg); }
.tome--open .leaf--right { transform: rotateY(0deg); }
.leaf__face { position: absolute; inset: 0; overflow: hidden; backface-visibility: hidden;
  background: linear-gradient(#fbf5e8, #f1e7d3); box-shadow: inset 0 0 40px rgba(120,90,50,0.14); }
.leaf--left .leaf__face { border-radius: 8px 0 0 8px; box-shadow: inset 0 0 40px rgba(120,90,50,0.14), inset -22px 0 30px rgba(60,40,20,0.22); }
.leaf--right .leaf__face { border-radius: 0 8px 8px 0; box-shadow: inset 0 0 40px rgba(120,90,50,0.14), inset 22px 0 30px rgba(60,40,20,0.22); }
.leaf__face::after { content: ""; position: absolute; inset: 0; pointer-events: none; opacity: 0.5; mix-blend-mode: multiply;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='200'%3E%3Cfilter id='p'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' seed='3'/%3E%3CfeColorMatrix type='matrix' values='0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0.06 0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23p)'/%3E%3C/svg%3E"); }

.tome__spine { position: absolute; left: 50%; top: 0; bottom: 0; width: 14px; transform: translateX(-50%) translateZ(-6px);
  background: linear-gradient(90deg, rgba(60,40,20,0.4), rgba(40,26,12,0.7), rgba(60,40,20,0.4)); }
.tome__ribbon { position: absolute; left: 50%; top: 8px; width: 9px; height: 78%; transform: translateX(10px);
  background: linear-gradient(180deg, color-mix(in srgb, var(--rb) 80%, #000), var(--rb));
  clip-path: polygon(0 0,100% 0,100% 100%,50% 86%,0 100%); box-shadow: 0 0 10px rgba(0,0,0,0.4); }

/* page content */
.pg { position: absolute; inset: 0; padding: clamp(18px, 3.4vw, 34px); display: flex; flex-direction: column; color: #2a1c0f; }
.pg__kicker { font-family: ui-monospace, monospace; font-size: 10px; letter-spacing: 0.26em; text-transform: uppercase;
  color: #9a6b1f; margin-bottom: 14px; }
.pg--cover { padding: clamp(14px,2.6vw,24px); }
.pg__cover-art { position: relative; flex: 1; border-radius: 4px; overflow: hidden; background: #1a120b;
  box-shadow: 0 14px 30px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(0,0,0,0.3); }
.pg__cover-art img { width: 100%; height: 100%; object-fit: cover; display: block; }
.pg__cover-glow { position: absolute; inset: 0; background: linear-gradient(125deg, rgba(255,255,255,0.18), transparent 40%); pointer-events: none; }
.pg__cover-proc { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;
  padding: 18px; text-align: center; background: linear-gradient(135deg, var(--mid), var(--deep)); color: #f6ecd5; }
.pg__cover-proc span { color: var(--gilt-hi); font-size: 20px; }
.pg__cover-proc h3 { margin: 0; font-family: 'Playfair Display', serif; font-size: 22px; line-height: 1.1; }
.pg__cover-proc p { margin: 0; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--gilt-hi); font-family: ui-monospace, monospace; }

.pg__note { margin: 0; font-size: clamp(15px, 2vw, 18px); line-height: 1.62; font-style: italic; color: #2a1c0f; }
.pg__drop { float: left; font-family: 'Playfair Display', serif; font-style: normal; font-size: 3.1em; line-height: 0.78;
  padding: 6px 8px 0 0; color: #7a4a2b; }
.pg__sign { margin-top: auto; padding-top: 18px; font-family: ui-monospace, monospace; font-size: 11px; letter-spacing: 0.08em; color: #8a6b48; }

.pg__dl { margin: 0; display: flex; flex-direction: column; gap: 14px; }
.pg__dl > div { display: flex; flex-direction: column; gap: 2px; border-bottom: 1px solid rgba(120,90,50,0.18); padding-bottom: 12px; }
.pg__dl dt { font-family: ui-monospace, monospace; font-size: 9px; letter-spacing: 0.22em; text-transform: uppercase; color: #9a6b1f; }
.pg__dl dd { margin: 0; font-family: 'Playfair Display', serif; font-size: 17px; color: #2a1c0f; }

.pg--colophon { align-items: center; justify-content: center; text-align: center; gap: 16px; }
.pg__orn { font-size: 30px; color: #7a4a2b; }
.pg__col-text { margin: 0; font-style: italic; color: #6a4a2b; font-size: 15px; }
.pg__rest { margin-top: 6px; border: none; cursor: pointer; padding: 11px 22px; border-radius: 8px;
  background: linear-gradient(180deg, #3a2417, #20120a); color: #f3e8d6; font-family: 'Newsreader', serif; font-size: 14px;
  box-shadow: 0 6px 16px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.12); transition: transform .2s; }
.pg__rest:active { transform: scale(0.97); }

.reader__dots { position: absolute; bottom: -36px; left: 50%; transform: translateX(-50%); display: flex; gap: 10px;
  opacity: 0; transition: opacity .4s .4s; }
.reader__dots.is-open { opacity: 1; }
.reader__dots button { width: 9px; height: 9px; border-radius: 50%; border: 1px solid rgba(231,205,138,0.5);
  background: transparent; cursor: pointer; padding: 0; transition: all .3s; }
.reader__dots button.is-on { background: var(--gold-hi); border-color: var(--gold-hi); box-shadow: 0 0 10px rgba(231,205,138,0.6); width: 26px; border-radius: 6px; }

@media (max-width: 520px) {
  .tome { transform-origin: center; }
  .reader__scene { height: min(82vh, 620px); }
}

@media (prefers-reduced-motion: reduce) {
  .book--in { animation: none; opacity: 1; }
  .book__tag-dot, .tome--open { animation: none; }
  .cabinet__world, .book__inner { transition: none; }
}
`;
