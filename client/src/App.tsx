import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import { playPageTurn } from "./sounds";

type Book = ApiResponse<typeof api, "list_books">["books"][number];
type Vars = CSSProperties & Record<`--${string}`, string | number>;

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

// Curated, deliberately-distinct acrylic tints — assigned by shelf order so
// neighbouring shelves never clash (amber, blue, green, terracotta, violet, teal).
const SHELF_TINTS = ["#E0922A", "#3E8FD6", "#4FA08A", "#C8584B", "#8E76C4", "#46B2AC"];

// Whisper-quiet haptic for supported devices.
const haptic = (ms = 7) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

// Editorial palettes for generated covers (books without an image).
const COVERS = [
  { bg: "#E1462C", fg: "#FFFFFF", mark: "#F4C20D" },
  { bg: "#F4C20D", fg: "#1A1A1A", mark: "#E1462C" },
  { bg: "#15489E", fg: "#FFFFFF", mark: "#F4C20D" },
  { bg: "#161616", fg: "#FFFFFF", mark: "#E1462C" },
  { bg: "#EFEADD", fg: "#1A1A1A", mark: "#15489E" },
  { bg: "#2E7D5B", fg: "#FFFFFF", mark: "#F4C20D" },
  { bg: "#D9772B", fg: "#1A1A1A", mark: "#161616" },
  { bg: "#6E3A86", fg: "#FFFFFF", mark: "#F4C20D" },
];
const coverStyle = (b: Book) => COVERS[hash(`${b.id}:${b.title}`) % COVERS.length]!;

/* A cover — a real image (blur-up fade-in), or a clean generated one. */
function Cover({ book }: { book: Book }) {
  const [loaded, setLoaded] = useState(false);
  if (book.cover_image_url) {
    return <img className={`cover ${loaded ? "is-loaded" : ""}`} src={book.cover_image_url}
      alt={`${book.title} — ${book.author}`} loading="lazy" draggable={false}
      onLoad={() => setLoaded(true)} onError={() => setLoaded(true)} />;
  }
  const c = coverStyle(book);
  return (
    <div className="cover cover--proc" style={{ "--pc-bg": c.bg, "--pc-fg": c.fg, "--pc-mark": c.mark } as Vars}
      role="img" aria-label={`${book.title} — ${book.author}`}>
      <span className="cover-proc__mark" />
      <span className="cover-proc__title">{book.title}</span>
      <span className="cover-proc__author">{book.author}</span>
    </div>
  );
}

type Origin = { book: Book; rect: DOMRect | null };

/* ------------------------------------------------------------------ *
 * Shelf — section head + face-out covers on a translucent acrylic rail *
 * ------------------------------------------------------------------ */
function Shelf({ label, books, tint, mounted, sIdx, onOpen }: {
  label: string; books: Book[]; tint: string; mounted: boolean; sIdx: number; onOpen: (o: Origin) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const nudge = (dir: number) => {
    const el = rowRef.current;
    if (el) el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.8, 300), behavior: "smooth" });
  };
  return (
    <section className={`shelf ${mounted ? "shelf--in" : ""}`} style={{ "--si": sIdx } as Vars}>
      <header className="shelf__head">
        <h2 className="shelf__label">{label}</h2>
        <div className="shelf__meta">
          <span className="shelf__count">{books.length} {books.length > 1 ? "livres" : "livre"}</span>
          <span className="shelf__nav">
            <button onClick={() => nudge(-1)} aria-label="Précédent">‹</button>
            <button onClick={() => nudge(1)} aria-label="Suivant">›</button>
          </span>
        </div>
      </header>

      <div className="shelf__stage" style={{ "--tint": tint } as Vars}>
        <div className="shelf__row" ref={rowRef}>
          {books.map((b) => (
            <button
              key={b.id}
              className="book"
              onClick={(e) => {
                haptic();
                const cover = e.currentTarget.querySelector(".cover");
                onOpen({ book: b, rect: cover ? cover.getBoundingClientRect() : null });
              }}
              aria-label={`${b.title} — ${b.author}`}
            >
              <span className="book__plate"><Cover book={b} /></span>
              {b.status === "suggéré" && <span className="book__sug" title="Suggéré par l'intelligence" />}
            </button>
          ))}
          <span className="shelf__pad" aria-hidden />
        </div>
        <div className="rail" aria-hidden>
          <span className="rail__gloss" />
          <span className="rail__screw rail__screw--tl" />
          <span className="rail__screw rail__screw--bl" />
          <span className="rail__screw rail__screw--tr" />
          <span className="rail__screw rail__screw--br" />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Reader — the tapped cover flies up (FLIP); page 1 cover, page 2 rest *
 * ------------------------------------------------------------------ */
function Reader({ origin, onClose }: { origin: Origin; onClose: () => void }) {
  const book = origin.book;
  const [open, setOpen] = useState(false);
  const [landed, setLanded] = useState(!origin.rect);
  const [page, setPage] = useState(0);
  const pagerRef = useRef<HTMLDivElement | null>(null);
  const heroRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);

  // Shared-element open: a ghost cover travels from the shelf to the hero.
  useLayoutEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const hero = heroRef.current, ghost = ghostRef.current;
    if (!origin.rect || !hero || !ghost || reduced) {
      setOpen(true); setLanded(true);
      return () => { document.body.style.overflow = prev; };
    }
    const o = origin.rect;
    const t = hero.getBoundingClientRect();
    const dx = t.left - o.left, dy = t.top - o.top;
    const sx = t.width / o.width, sy = t.height / o.height;
    ghost.style.transform = "translate(0,0) scale(1)";
    ghost.style.transition = "none";
    void ghost.offsetWidth;
    const id = requestAnimationFrame(() => {
      setOpen(true);
      ghost.style.transition = "transform .56s cubic-bezier(.16,1,.3,1)";
      ghost.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    });
    return () => { cancelAnimationFrame(id); document.body.style.overflow = prev; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(() => { setOpen(false); setTimeout(onClose, 360); }, [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const goTo = (p: number) => pagerRef.current?.scrollTo({ left: p * pagerRef.current.clientWidth, behavior: "smooth" });
  const onScroll = () => {
    const el = pagerRef.current; if (!el) return;
    const p = Math.round(el.scrollLeft / el.clientWidth);
    if (p !== page) { setPage(p); playPageTurn(); haptic(); }
  };

  const dateStr = new Date(book.date_added).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const note = book.personal_note || "Aucune note n'accompagne encore ce volume.";
  const isSuggest = book.status === "suggéré";

  return (
    <div className="reader" role="dialog" aria-modal="true" aria-label={book.title}>
      <div className={`reader__backdrop ${open ? "is-open" : ""}`} onClick={close} />

      {origin.rect && !landed && (
        <div ref={ghostRef} className="ghost" onTransitionEnd={() => setLanded(true)}
          style={{ left: origin.rect.left, top: origin.rect.top, width: origin.rect.width, height: origin.rect.height }}>
          <Cover book={book} />
        </div>
      )}

      <div className={`reader__sheet ${open ? "is-open" : ""}`}>
        <header className="reader__bar">
          <button className="reader__icon" onClick={close} aria-label="Retour">‹</button>
          <span className="reader__crumb">{book.category || (isSuggest ? "Suggéré" : "Lu")}</span>
          <button className="reader__icon" onClick={close} aria-label="Fermer">✕</button>
        </header>

        <div className="reader__pager" ref={pagerRef} onScroll={onScroll}>
          {/* PAGE 1 — the cover */}
          <section className="rpage rpage--cover">
            <div ref={heroRef} className="hero" style={{ visibility: landed ? "visible" : "hidden" }}>
              <Cover book={book} />
            </div>
            <div className={`hero__meta ${open ? "is-open" : ""}`}>
              <h1 className="hero__title">{book.title}</h1>
              <p className="hero__author">{book.author}</p>
              <span className={`chip ${isSuggest ? "chip--sug" : "chip--lu"}`}>{isSuggest ? "Suggéré" : "Lu"}</span>
            </div>
          </section>

          {/* PAGE 2 — everything else */}
          <section className="rpage rpage--content">
            <div className={`content ${open ? "is-open" : ""}`}>
              <span className="kicker">{isSuggest ? "Pourquoi le lire" : "Note de lecture"}</span>
              <p className="note"><span className="note__drop">{note.charAt(0)}</span>{note.slice(1)}</p>
              <div className="sign">— {isSuggest ? "l'intelligence" : "le lecteur"} · {dateStr}</div>
              <dl className="facts">
                <div><dt>Auteur·ice</dt><dd>{book.author}</dd></div>
                {book.category && <div><dt>Style</dt><dd>{book.category}</dd></div>}
                <div><dt>État</dt><dd>{isSuggest ? "Suggéré" : "Lu"}</dd></div>
                {book.page_count != null && <div><dt>Pages</dt><dd>{book.page_count}</dd></div>}
                {book.isbn && <div><dt>ISBN</dt><dd>{book.isbn}</dd></div>}
              </dl>
            </div>
          </section>
        </div>

        <div className={`reader__dots ${open ? "is-open" : ""}`}>
          {[0, 1].map((p) => (
            <button key={p} className={p === page ? "is-on" : ""} onClick={() => goTo(p)} aria-label={`Page ${p + 1}`} />
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
  const { data, isPending } = useQuery({ queryKey: ["books"], queryFn: () => api.list_books({}) });
  const books = data?.books ?? [];

  const [origin, setOrigin] = useState<Origin | null>(null);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!isPending) { const t = setTimeout(() => setMounted(true), 40); return () => clearTimeout(t); }
  }, [isPending]);

  // Shelves adapt to the books' style: group by category, fall back to status.
  const shelves = useMemo(() => {
    const map = new Map<string, Book[]>();
    for (const b of books) {
      const key = b.category && b.category.trim() ? b.category.trim() : (b.status === "suggéré" ? "Suggérés" : "Lus");
      const arr = map.get(key);
      if (arr) arr.push(b); else map.set(key, [b]);
    }
    return [...map.entries()]
      .map(([name, list]) => ({ name, list }))
      .sort((a, b) => b.list.length - a.list.length || a.name.localeCompare(b.name));
  }, [books]);

  return (
    <div className="lib">
      <main className="lib__main">
        <header className="masthead">
          <span className="masthead__over">My Favourite</span>
          <h1 className="masthead__title">Books</h1>
        </header>

        {isPending ? (
          <div className="lib__loading">Ouverture de la bibliothèque…</div>
        ) : shelves.length === 0 ? (
          <div className="lib__loading">L'intelligence n'a encore rien déposé.</div>
        ) : (
          <div className="shelves">
            {shelves.map((s, i) => (
              <Shelf key={s.name} label={s.name} books={s.list} tint={SHELF_TINTS[i % SHELF_TINTS.length]!} sIdx={i} mounted={mounted} onOpen={setOrigin} />
            ))}
          </div>
        )}
      </main>

      {origin && <Reader origin={origin} onClose={() => setOrigin(null)} />}
      <style>{CSS}</style>
    </div>
  );
}

const CSS = String.raw`
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;0,9..144,700;1,9..144,400&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400&display=swap');

.lib *, .reader * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.lib {
  --bg: #ECECEC; --card: #F5F5F4; --ink: #1A1A1D; --muted: #98989E; --line: rgba(0,0,0,0.10);
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Inter, Arial, sans-serif;
  --display: 'Fraunces', Georgia, serif;
  --body: 'Newsreader', Georgia, serif;
  min-height: 100vh; background: var(--bg); color: var(--ink);
  font-family: var(--sans); -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility;
}
.lib__main { max-width: 760px; margin: 0 auto;
  padding: calc(env(safe-area-inset-top) + 30px) 0 calc(env(safe-area-inset-bottom) + 56px); }

/* ---- masthead ---- */
.masthead { text-align: center; padding: 20px 20px 10px; }
.masthead__over { display: block; font-family: var(--display); font-optical-sizing: auto; font-weight: 400;
  font-size: clamp(18px, 4.8vw, 24px); color: var(--ink); letter-spacing: 0.01em; }
.masthead__title { margin: -2px 0 0; font-family: 'Meteor', var(--display); font-weight: 400;
  text-transform: uppercase; font-size: clamp(58px, 18vw, 112px); line-height: 0.94; letter-spacing: 0; color: var(--ink); }

.lib__loading { text-align: center; color: var(--muted); padding: 90px 0; font-style: italic; font-family: var(--body); }

/* ---- shelves ---- */
.shelves { padding: 18px 0 0; }
.shelf { margin-top: 30px; opacity: 0; transform: translateY(10px); }
.shelf--in { animation: secIn .6s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--si) * 90ms); }
@keyframes secIn { to { opacity: 1; transform: translateY(0); } }

.shelf__head { display: flex; align-items: baseline; justify-content: space-between; padding: 0 22px 4px; }
.shelf__label { margin: 0; font-family: var(--sans); font-weight: 700; font-size: clamp(19px, 5vw, 23px);
  letter-spacing: -0.015em; color: var(--ink); }
.shelf__meta { display: flex; align-items: center; gap: 10px; }
.shelf__count { font-size: 13.5px; color: var(--muted); letter-spacing: 0.01em; }
.shelf__nav { display: inline-flex; gap: 1px; }
.shelf__nav button { width: 28px; height: 28px; border: none; background: transparent; color: var(--muted);
  font-size: 20px; line-height: 1; cursor: pointer; border-radius: 50%; transition: color .25s, background .25s; }
.shelf__nav button:hover { color: var(--ink); background: rgba(0,0,0,0.045); }
.shelf__nav button:active { transform: scale(0.92); }

.shelf__stage { position: relative; }
.shelf__row {
  display: flex; align-items: flex-end; gap: 5px;
  padding: 20px 22px 12px; overflow-x: auto; scroll-snap-type: x proximity;
  scrollbar-width: none; -ms-overflow-style: none;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 20px, #000 calc(100% - 20px), transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0, #000 20px, #000 calc(100% - 20px), transparent 100%);
}
.shelf__row::-webkit-scrollbar { display: none; }
.shelf__pad { flex: 0 0 16px; }

/* covers (face-out) */
.book { position: relative; flex: 0 0 auto; width: 124px; height: 186px; border: 0; padding: 0; background: none;
  cursor: pointer; scroll-snap-align: center; }
.book__plate { display: block; width: 100%; height: 100%; border-radius: 2px 4px 4px 2px; overflow: hidden;
  background: #e7e6e3; /* placeholder until the cover fades in */
  box-shadow: 0 0.5px 1px rgba(0,0,0,0.16), 0 11px 18px -12px rgba(0,0,0,0.5), inset 0 0 0 0.5px rgba(0,0,0,0.08);
  transition: transform .42s cubic-bezier(.2,.8,.2,1), box-shadow .42s; will-change: transform; }
@media (hover: hover) {
  .book:hover .book__plate { transform: translateY(-5px); box-shadow: 0 0.5px 1px rgba(0,0,0,0.16), 0 22px 30px -16px rgba(0,0,0,0.5); }
}
.book:active .book__plate { transform: translateY(-1px) scale(0.99); }
.book:focus-visible { outline: none; }
.book:focus-visible .book__plate { box-shadow: 0 0 0 2px var(--bg), 0 0 0 3.5px var(--ink); }

.book__sug { position: absolute; top: 8px; right: 8px; width: 6px; height: 6px; border-radius: 50%; z-index: 2;
  background: var(--tint); box-shadow: 0 0 0 1.5px rgba(255,255,255,0.7), 0 1px 2px rgba(0,0,0,0.22); }

.cover { display: block; width: 100%; height: 100%; object-fit: cover;
  opacity: 0; transform: scale(1.02); transition: opacity .6s ease, transform .7s cubic-bezier(.2,.8,.2,1); }
.cover.is-loaded { opacity: 1; transform: none; }

.cover--proc { container-type: inline-size; display: flex; flex-direction: column; justify-content: space-between;
  padding: 11% 10%; background: var(--pc-bg); color: var(--pc-fg); opacity: 1; transform: none; }
.cover-proc__mark { width: 20cqw; height: 4.5cqw; border-radius: 1px; background: var(--pc-mark); }
.cover-proc__title { font-family: var(--sans); font-weight: 700; font-size: 12cqw; line-height: 1.06; letter-spacing: -0.01em;
  display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.cover-proc__author { font-size: 4.6cqw; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.82; }

/* ---- acrylic rail — realistic frost, bevel, refraction, subtle shadow, iPhone screws ---- */
.rail {
  position: absolute; left: 14px; right: 14px; bottom: 6px; height: 52px; border-radius: 11px; z-index: 3; pointer-events: none;
  overflow: hidden;                                  /* clip bevel/gloss/edge to the rounded corners */
  background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 14%, transparent), color-mix(in srgb, var(--tint) 28%, transparent));
  -webkit-backdrop-filter: blur(10px) saturate(1.3) brightness(1.03);
  backdrop-filter: blur(10px) saturate(1.3) brightness(1.03);
  box-shadow:
    inset 0 0.8px 0 rgba(255,255,255,0.95),          /* crisp top bevel — follows the radius */
    inset 0 -1px 0 color-mix(in srgb, var(--tint) 40%, rgba(0,0,0,0.18)), /* bottom edge */
    inset 0 0 0 0.5px rgba(255,255,255,0.16),
    0 5px 12px -10px rgba(0,0,0,0.16);               /* whisper drop shadow */
}
.rail::before {  /* refraction: soft shadow where the covers enter the acrylic */
  content: ""; position: absolute; left: 0; right: 0; top: 0; height: 9px;
  background: linear-gradient(180deg, rgba(0,0,0,0.10), transparent); }
.rail__gloss { position: absolute; inset: 0 0 auto 0; height: 34%;
  background: linear-gradient(180deg, rgba(255,255,255,0.5), rgba(255,255,255,0)); }
.rail__screw { position: absolute; width: 4px; height: 4px; border-radius: 50%;
  background: radial-gradient(50% 50% at 40% 34%, #fcfcfe 0%, #d6d8dc 44%, #a9abb1 76%, #8a8c92 100%);
  box-shadow: inset 0 0.4px 0.4px rgba(255,255,255,0.95), inset 0 -0.4px 0.4px rgba(0,0,0,0.3), 0 0.5px 0.8px rgba(0,0,0,0.14); }
.rail__screw--tl { left: 8px; top: 7px; } .rail__screw--bl { left: 8px; bottom: 7px; }
.rail__screw--tr { right: 8px; top: 7px; } .rail__screw--br { right: 8px; bottom: 7px; }

/* ================================================================== *
 * Reader                                                              *
 * ================================================================== */
.reader { position: fixed; inset: 0; z-index: 50; }
.reader__backdrop { position: absolute; inset: 0; background: rgba(22,22,24,0.32); opacity: 0; transition: opacity .42s;
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.reader__backdrop.is-open { opacity: 1; }

.ghost { position: fixed; z-index: 60; transform-origin: top left; pointer-events: none;
  border-radius: 2px 3.5px 3.5px 2px; overflow: hidden; box-shadow: 0 18px 40px -18px rgba(0,0,0,0.5); }
.ghost .cover { border-radius: 2px 3.5px 3.5px 2px; }

.reader__sheet { position: absolute; left: 50%; top: 0; width: min(100%, 540px); height: 100%; transform: translateX(-50%);
  background: var(--card); display: flex; flex-direction: column; box-shadow: 0 0 60px rgba(0,0,0,0.18);
  font-family: var(--body); opacity: 0; transition: opacity .4s ease; }
.reader__sheet.is-open { opacity: 1; }

.reader__bar { display: flex; align-items: center; justify-content: space-between; padding: max(env(safe-area-inset-top), 16px) 16px 8px; }
.reader__icon { width: 38px; height: 38px; border: none; background: rgba(0,0,0,0.045); border-radius: 50%; cursor: pointer;
  font-size: 17px; color: var(--ink); line-height: 1; transition: background .2s, transform .2s; }
.reader__icon:hover { background: rgba(0,0,0,0.09); } .reader__icon:active { transform: scale(0.92); }
.reader__crumb { font-family: var(--sans); font-size: 10.5px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); }

.reader__pager { flex: 1; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.reader__pager::-webkit-scrollbar { display: none; }
.rpage { flex: 0 0 100%; scroll-snap-align: start; overflow-y: auto; padding: 6px 30px 26px; }

/* cover page */
.rpage--cover { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.hero { width: min(58%, 226px); aspect-ratio: 2 / 3; border-radius: 3px; overflow: hidden;
  box-shadow: 0 1px 1px rgba(0,0,0,0.12), 0 34px 54px -26px rgba(0,0,0,0.5); }
.hero .cover { border-radius: 3px; }
.hero__meta { margin-top: 28px; opacity: 0; transform: translateY(8px); transition: opacity .5s .15s, transform .5s .15s; }
.hero__meta.is-open { opacity: 1; transform: none; }
.hero__title { margin: 0; font-family: var(--display); font-optical-sizing: auto; font-weight: 600; font-variation-settings: 'SOFT' 0, 'WONK' 1;
  font-size: clamp(27px, 6.8vw, 37px); line-height: 1.05; }
.hero__author { margin: 9px 0 0; font-family: var(--sans); font-size: 15px; color: var(--muted); }
.chip { margin-top: 18px; display: inline-block; font-family: var(--sans); font-size: 10.5px; letter-spacing: 0.14em;
  text-transform: uppercase; padding: 7px 14px; border-radius: 999px; }
.chip--lu { background: rgba(46,125,91,0.13); color: #2C7355; }
.chip--sug { background: rgba(62,143,214,0.15); color: #2C77B6; }

/* content page */
.rpage--content { padding-top: 22px; }
.content { max-width: 460px; margin: 0 auto; opacity: 0; transform: translateY(10px); transition: opacity .5s .1s, transform .5s .1s; }
.content.is-open { opacity: 1; transform: none; }
.kicker { display: block; font-family: var(--sans); font-size: 10.5px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--muted); margin-bottom: 18px; }
.note { margin: 0; font-family: var(--body); font-size: clamp(17px, 2.4vw, 20px); line-height: 1.64; color: var(--ink); }
.note__drop { float: left; font-family: var(--display); font-weight: 600; font-size: 3em; line-height: 0.74; padding: 4px 12px 0 0; color: var(--ink); }
.sign { margin-top: 22px; font-family: var(--sans); font-size: 12px; color: var(--muted); }
.facts { margin: 30px 0 0; border-top: 1px solid var(--line); }
.facts > div { display: flex; justify-content: space-between; gap: 16px; padding: 13px 0; border-bottom: 1px solid var(--line); }
.facts dt { font-family: var(--sans); font-size: 10.5px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); align-self: center; }
.facts dd { margin: 0; font-family: var(--display); font-optical-sizing: auto; font-size: 16px; text-align: right; }

.reader__dots { display: flex; justify-content: center; gap: 9px; padding: 12px 0 max(env(safe-area-inset-bottom), 18px);
  opacity: 0; transition: opacity .4s .3s; }
.reader__dots.is-open { opacity: 1; }
.reader__dots button { width: 7px; height: 7px; border-radius: 50%; border: none; padding: 0; cursor: pointer;
  background: rgba(0,0,0,0.16); transition: all .3s; }
.reader__dots button.is-on { background: var(--ink); width: 20px; border-radius: 4px; }

@media (prefers-reduced-motion: reduce) {
  .shelf, .hero__meta, .content, .cover { opacity: 1; transform: none; animation: none; }
  .cover, .book__plate, .reader__sheet, .reader__backdrop, .ghost { transition: none; }
}
`;
