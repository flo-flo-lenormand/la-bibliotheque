import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import { playPageTurn } from "./sounds";
import { ROOM_BG } from "./roombg";

type Book = ApiResponse<typeof api, "list_books">["books"][number];
type Vars = CSSProperties & Record<`--${string}`, string | number>;

/* The empty-library photo, measured: shelf-board tops (where a book's bottom
   rests) and the board above (the book's height ceiling), as % of the image. */
const BOARDS = [21.0, 30.7, 40.5, 50.2, 60.0, 70.1, 81.6];
const CEILS = [12.0, 21.0, 30.7, 40.5, 50.2, 60.0, 70.1];
const CAVITY_LEFT = 25;   // % from left where books begin
const CAVITY_RIGHT = 14;  // % inset from right

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Per-book proportions for variety: cover aspect + how much of the shelf gap it fills.
function shapeFor(b: Book) {
  const r = mulberry32(hash(`${b.id}:${b.title}:${b.author}`));
  const ar = 0.60 + r() * 0.12;        // cover width / height
  const fill = 0.84 + r() * 0.13;      // fraction of the shelf gap the book stands
  const lean = (r() - 0.5) * 1.6;      // tiny lean, degrees
  return { ar, fill, lean };
}

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
const haptic = (ms = 7) => { try { navigator.vibrate?.(ms); } catch { /* unsupported */ } };

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

/* A shelf: books standing on one board of the photo, with a DYMO tag. */
function RoomShelf({ books, label, board, ceil, mounted, sIdx, onOpen }: {
  books: Book[]; label: string; board: number; ceil: number; mounted: boolean; sIdx: number; onOpen: (o: Origin) => void;
}) {
  return (
    <div className="shelf-row" style={{ bottom: `${100 - board}%`, height: `${board - ceil}%`, "--si": sIdx } as Vars}>
      <span className="shelf-tag"><span className="shelf-tag__txt">{label}</span></span>
      {books.map((b) => {
        const s = shapeFor(b);
        return (
          <button
            key={b.id}
            className={`rbook ${mounted ? "rbook--in" : ""}`}
            style={{ "--ar": s.ar, "--fill": s.fill, "--lean": `${s.lean}deg` } as Vars}
            onClick={(e) => {
              haptic();
              const cover = e.currentTarget.querySelector(".cover");
              onOpen({ book: b, rect: cover ? cover.getBoundingClientRect() : null });
            }}
            aria-label={`${b.title} — ${b.author}`}
          >
            <Cover book={b} />
            {b.status === "suggéré" && <span className="rbook__dot" aria-hidden />}
          </button>
        );
      })}
    </div>
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
    if (!isPending) { const t = setTimeout(() => setMounted(true), 60); return () => clearTimeout(t); }
  }, [isPending]);

  // Group by category (fallback to status); each group sits on its own shelf.
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
      <div className="room" style={{ "--room": `url("${ROOM_BG}")` } as Vars}>
        <div className="room__img" />
        {isPending ? null : shelves.map((s, i) => (
          <RoomShelf key={s.name} label={s.name} books={s.list} board={BOARDS[i] ?? 81.6} ceil={CEILS[i] ?? 70.1}
            mounted={mounted} sIdx={i} onOpen={setOrigin} />
        ))}
      </div>

      {origin && <Reader origin={origin} onClose={() => setOrigin(null)} />}
      <style>{CSS}</style>
    </div>
  );
}

const CSS = String.raw`
@import url('https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,400&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400&display=swap');

.lib *, .reader * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.lib {
  --card: #FAF6EE; --ink: #211f1b; --muted: #8f897d; --line: rgba(0,0,0,0.10);
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Inter, Arial, sans-serif;
  --display: 'Fraunces', Georgia, serif;
  --body: 'Newsreader', Georgia, serif;
  min-height: 100svh; background: #efe7d8; color: var(--ink);
  font-family: var(--sans); -webkit-font-smoothing: antialiased;
  display: flex; justify-content: center;
}

/* ---- the room: the photo is the set, books stand on its shelves ---- */
.room { position: relative; height: 100svh; aspect-ratio: 759 / 1640; overflow: hidden; }
.room__img { position: absolute; inset: 0; background: var(--room) center/cover no-repeat; }

/* one shelf = a board line; books sit on its bottom edge, left → right */
.shelf-row { position: absolute; left: ${CAVITY_LEFT}%; right: ${CAVITY_RIGHT}%;
  display: flex; align-items: flex-end; gap: 2.4%; }

.rbook { position: relative; flex: 0 0 auto; height: calc(var(--fill) * 100%); aspect-ratio: var(--ar);
  border: 0; padding: 0; background: none; cursor: pointer; transform-origin: 50% 100%;
  transform: rotate(var(--lean)); }
.rbook--in { animation: rbookIn .5s cubic-bezier(.2,.8,.2,1) both; animation-delay: calc(var(--si) * 80ms); }
@keyframes rbookIn { from { opacity: 0; transform: translateY(6px) rotate(var(--lean)); } to { opacity: 1; } }
.rbook:active { transform: rotate(var(--lean)) translateY(-1px); }
.rbook:focus-visible { outline: none; }

/* contact shadow cast onto the shelf board (light comes from the left window) */
.rbook::after { content: ""; position: absolute; left: 6%; right: -14%; bottom: -4%; height: 12%; z-index: -1;
  background: radial-gradient(60% 100% at 42% 50%, rgba(40,28,14,0.42), transparent 72%); filter: blur(3px); }

.cover { display: block; width: 100%; height: 100%; object-fit: cover; border-radius: 1px 2.5px 2.5px 1px;
  box-shadow: 0 0.5px 1px rgba(0,0,0,0.25), inset 0 0 0 0.5px rgba(0,0,0,0.12),
    inset -3px 0 5px -3px rgba(0,0,0,0.35);   /* slight page-edge shade on the right */
  opacity: 0; transition: opacity .55s ease; }
.cover.is-loaded { opacity: 1; }
/* window light raking across each cover from the left */
.rbook::before { content: ""; position: absolute; inset: 0; z-index: 1; pointer-events: none; border-radius: 1px 2.5px 2.5px 1px;
  background: linear-gradient(100deg, rgba(255,246,224,0.34) 0%, rgba(255,246,224,0.05) 26%, transparent 46%, rgba(36,26,12,0.16) 100%); }

.rbook__dot { position: absolute; top: 5%; right: 7%; width: 5px; height: 5px; border-radius: 50%; z-index: 2;
  background: #e8b04a; box-shadow: 0 0 0 1.5px rgba(255,255,255,0.6); }

.cover--proc { container-type: inline-size; display: flex; flex-direction: column; justify-content: space-between;
  padding: 11% 10%; background: var(--pc-bg); color: var(--pc-fg); opacity: 1; }
.cover-proc__mark { width: 20cqw; height: 4.5cqw; border-radius: 1px; background: var(--pc-mark); }
.cover-proc__title { font-family: var(--sans); font-weight: 700; font-size: 12cqw; line-height: 1.06; letter-spacing: -0.01em;
  display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.cover-proc__author { font-size: 4.6cqw; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.82; }

/* DYMO-ish white tag sitting on the shelf board, before the books */
.shelf-tag { align-self: flex-end; flex: 0 0 auto; margin-bottom: 1.5%; padding: 2px 5px; border-radius: 1.5px;
  background: #f6f4ef; box-shadow: 0 0.5px 0.5px rgba(0,0,0,0.06); }
.shelf-tag__txt { display: block; font-family: var(--sans); font-weight: 800; font-size: clamp(5px, 1.3vw, 7px);
  letter-spacing: 0.16em; text-transform: uppercase; color: #1b1b1d; }

/* ================================================================== *
 * Reader                                                              *
 * ================================================================== */
.reader { position: fixed; inset: 0; z-index: 50; }
.reader__backdrop { position: absolute; inset: 0; background: rgba(22,22,24,0.32); opacity: 0; transition: opacity .42s;
  -webkit-backdrop-filter: blur(3px); backdrop-filter: blur(3px); }
.reader__backdrop.is-open { opacity: 1; }

.ghost { position: fixed; z-index: 60; transform-origin: top left; pointer-events: none;
  border-radius: 1px 2.5px 2.5px 1px; overflow: hidden; box-shadow: 0 18px 40px -18px rgba(0,0,0,0.5); }
.ghost .cover { border-radius: 1px 2.5px 2.5px 1px; opacity: 1; }

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
  .rbook--in, .hero__meta, .content { animation: none; opacity: 1; transform: none; }
  .cover, .reader__sheet, .reader__backdrop, .ghost { transition: none; }
}
`;
