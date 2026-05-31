import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import type { CSSProperties } from "react";
import { playPageTurn } from "./sounds";

type Book = ApiResponse<typeof api, "list_books">["books"][number];
type Vars = CSSProperties & Record<`--${string}`, string | number>;

/* ------------------------------------------------------------------ *
 * Deterministic cover styling for books without an image.             *
 * ------------------------------------------------------------------ */
function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
// Bright, editorial cover palettes (à la Rams / Bauhaus / Penguin).
const COVERS = [
  { bg: "#E1462C", fg: "#FFFFFF", mark: "#F4C20D" },
  { bg: "#F4C20D", fg: "#1A1A1A", mark: "#E1462C" },
  { bg: "#1455B0", fg: "#FFFFFF", mark: "#F4C20D" },
  { bg: "#141414", fg: "#FFFFFF", mark: "#E1462C" },
  { bg: "#EFEADD", fg: "#1A1A1A", mark: "#1455B0" },
  { bg: "#2E7D5B", fg: "#FFFFFF", mark: "#F4C20D" },
  { bg: "#D9772B", fg: "#1A1A1A", mark: "#141414" },
  { bg: "#7A3E8E", fg: "#FFFFFF", mark: "#F4C20D" },
];
function coverStyle(book: Book) {
  return COVERS[hash(`${book.id}:${book.title}`) % COVERS.length]!;
}

/* ------------------------------------------------------------------ *
 * Cover — a real image, or a clean generated cover.                    *
 * ------------------------------------------------------------------ */
function Cover({ book, className = "" }: { book: Book; className?: string }) {
  if (book.cover_image_url) {
    return <img className={`cover ${className}`} src={book.cover_image_url} alt={`${book.title} — ${book.author}`} loading="lazy" />;
  }
  const c = coverStyle(book);
  return (
    <div className={`cover cover--proc ${className}`} style={{ "--pc-bg": c.bg, "--pc-fg": c.fg, "--pc-mark": c.mark } as Vars}
      role="img" aria-label={`${book.title} — ${book.author}`}>
      <span className="cover-proc__mark" />
      <span className="cover-proc__title">{book.title}</span>
      <span className="cover-proc__author">{book.author}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * A shelf — section head + scrollable face-out covers + acrylic rail.  *
 * ------------------------------------------------------------------ */
function Shelf({ label, books, tint, mounted, onOpen }: {
  label: string; books: Book[]; tint: string; mounted: boolean; onOpen: (b: Book) => void;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  const nudge = (dir: number) => {
    const el = rowRef.current;
    if (el) el.scrollBy({ left: dir * Math.min(el.clientWidth * 0.8, 280), behavior: "smooth" });
  };
  return (
    <section className="shelf">
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

      <div className="shelf__stage">
        {books.length === 0 ? (
          <div className="shelf__empty">L'intelligence n'a encore rien déposé ici.</div>
        ) : (
          <>
            <div className="shelf__row" ref={rowRef}>
              {books.map((b, i) => (
                <button
                  key={b.id}
                  className={`book ${mounted ? "book--in" : ""}`}
                  style={{ "--i": i } as Vars}
                  onClick={() => onOpen(b)}
                  aria-label={`${b.title} — ${b.author}`}
                >
                  <Cover book={b} />
                </button>
              ))}
              <span className="shelf__pad" aria-hidden />
            </div>
            <div className="rail" style={{ "--tint": tint } as Vars} aria-hidden>
              <span className="rail__screw rail__screw--l" />
              <span className="rail__screw rail__screw--r" />
              <span className="rail__gloss" />
            </div>
          </>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Reader — slides up; cover on page 1, content on page 2.              *
 * ------------------------------------------------------------------ */
function Reader({ book, onClose }: { book: Book; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const pagerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const a = requestAnimationFrame(() => setOpen(true));
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { cancelAnimationFrame(a); document.body.style.overflow = prev; };
  }, []);

  const close = useCallback(() => { setOpen(false); setTimeout(onClose, 380); }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const goTo = (p: number) => {
    const el = pagerRef.current;
    if (!el) return;
    el.scrollTo({ left: p * el.clientWidth, behavior: "smooth" });
  };
  const onScroll = () => {
    const el = pagerRef.current;
    if (!el) return;
    const p = Math.round(el.scrollLeft / el.clientWidth);
    if (p !== page) { setPage(p); playPageTurn(); }
  };

  const dateStr = new Date(book.date_added).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  const note = book.personal_note || "Aucune note n'accompagne encore ce volume.";
  const isSuggest = book.status === "suggéré";

  return (
    <div className="reader" role="dialog" aria-modal="true" aria-label={book.title}>
      <div className={`reader__backdrop ${open ? "is-open" : ""}`} onClick={close} />
      <div className={`reader__sheet ${open ? "is-open" : ""}`}>
        <header className="reader__bar">
          <button className="reader__icon" onClick={close} aria-label="Fermer">‹</button>
          <span className="reader__crumb">{isSuggest ? "Suggéré" : "Lu"}</span>
          <button className="reader__icon" onClick={close} aria-label="Fermer">✕</button>
        </header>

        <div className="reader__pager" ref={pagerRef} onScroll={onScroll}>
          {/* PAGE 1 — the cover */}
          <section className="rpage rpage--cover">
            <div className="hero">
              <Cover book={book} className="hero__cover" />
            </div>
            <h1 className="hero__title">{book.title}</h1>
            <p className="hero__author">{book.author}</p>
            <span className={`chip ${isSuggest ? "chip--sug" : "chip--lu"}`}>{isSuggest ? "Suggéré par l'intelligence" : "Lu"}</span>
            <button className="hero__more" onClick={() => goTo(1)}>Lire la note ›</button>
          </section>

          {/* PAGE 2 — everything else */}
          <section className="rpage rpage--content">
            <div className="content">
              <span className="kicker">{isSuggest ? "Pourquoi le lire" : "Note de lecture"}</span>
              <p className="note"><span className="note__drop">{note.charAt(0)}</span>{note.slice(1)}</p>
              <div className="sign">— {isSuggest ? "l'intelligence" : "le lecteur"} · {dateStr}</div>

              <dl className="facts">
                <div><dt>Auteur·ice</dt><dd>{book.author}</dd></div>
                <div><dt>État</dt><dd>{isSuggest ? "Suggéré" : "Lu"}</dd></div>
                {book.page_count != null && <div><dt>Pages</dt><dd>{book.page_count}</dd></div>}
                {book.isbn && <div><dt>ISBN</dt><dd>{book.isbn}</dd></div>}
              </dl>
            </div>
          </section>
        </div>

        <div className="reader__dots">
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

  const [activeId, setActiveId] = useState<number | null>(null);
  const active = useMemo(() => books.find((b) => b.id === activeId) ?? null, [books, activeId]);

  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    if (!isPending) { const t = setTimeout(() => setMounted(true), 50); return () => clearTimeout(t); }
  }, [isPending]);

  const lus = useMemo(() => books.filter((b) => b.status !== "suggéré"), [books]);
  const sugg = useMemo(() => books.filter((b) => b.status === "suggéré"), [books]);

  return (
    <div className="lib">
      <main className="lib__main">
        <header className="masthead">
          <span className="masthead__over">Ma collection de</span>
          <h1 className="masthead__title">Livres</h1>
          <p className="masthead__sub">lus &amp; suggérés par l'intelligence</p>
        </header>

        {isPending ? (
          <div className="lib__loading">Ouverture de la bibliothèque…</div>
        ) : (
          <div className="shelves">
            <Shelf label="Lus" books={lus} tint="#E8941F" mounted={mounted} onOpen={(b) => setActiveId(b.id)} />
            <Shelf label="Suggérés" books={sugg} tint="#3E92D6" mounted={mounted} onOpen={(b) => setActiveId(b.id)} />
          </div>
        )}
      </main>

      {active && <Reader book={active} onClose={() => setActiveId(null)} />}
      <style>{CSS}</style>
    </div>
  );
}

const CSS = String.raw`
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;1,500&family=Newsreader:ital,opsz,wght@0,6..72,300;0,6..72,400;0,6..72,500;1,6..72,400&display=swap');

.lib *, .reader * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
.lib {
  --bg: #ECE9E3; --card: #F6F4EF; --ink: #161514; --muted: #9C978C; --line: rgba(0,0,0,0.08);
  --sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
  --serif: 'Playfair Display', Georgia, serif;
  --body: 'Newsreader', Georgia, serif;
  min-height: 100vh; background: var(--bg); color: var(--ink);
  font-family: var(--sans); -webkit-font-smoothing: antialiased;
}
.lib__main { max-width: 760px; margin: 0 auto;
  padding: calc(env(safe-area-inset-top) + 26px) 0 calc(env(safe-area-inset-bottom) + 50px); }

/* ---- masthead ---- */
.masthead { text-align: center; padding: 16px 20px 8px; }
.masthead__over { display: block; font-family: var(--serif); font-size: clamp(17px, 4.6vw, 22px); font-weight: 400; color: var(--ink); }
.masthead__title { margin: -2px 0 0; font-family: var(--serif); font-weight: 700; text-transform: uppercase;
  font-size: clamp(54px, 17vw, 104px); line-height: 0.92; letter-spacing: -0.01em; color: var(--ink); }
.masthead__sub { margin: 12px 0 0; font-family: var(--body); font-style: italic; font-size: 14px; color: var(--muted); }

.lib__loading { text-align: center; color: var(--muted); padding: 90px 0; font-style: italic; font-family: var(--body); }

/* ---- shelves ---- */
.shelves { padding: 16px 0 0; }
.shelf { margin-top: 26px; }
.shelf__head { display: flex; align-items: center; justify-content: space-between; padding: 0 22px 6px; }
.shelf__label { margin: 0; font-family: var(--sans); font-weight: 700; font-size: clamp(19px, 5vw, 24px); letter-spacing: -0.01em; color: var(--ink); }
.shelf__meta { display: flex; align-items: center; gap: 12px; }
.shelf__count { font-size: 14px; color: var(--muted); }
.shelf__nav { display: inline-flex; gap: 2px; }
.shelf__nav button { width: 30px; height: 30px; border: none; background: transparent; color: var(--muted);
  font-size: 22px; line-height: 1; cursor: pointer; border-radius: 50%; transition: color .2s, background .2s; }
.shelf__nav button:hover { color: var(--ink); background: rgba(0,0,0,0.05); }

.shelf__stage { position: relative; }
.shelf__row {
  display: flex; align-items: flex-end; gap: 5px;
  padding: 16px 22px 22px; overflow-x: auto; scroll-snap-type: x proximity;
  scrollbar-width: none; -ms-overflow-style: none;
}
.shelf__row::-webkit-scrollbar { display: none; }
.shelf__pad { flex: 0 0 16px; }
.shelf__empty { padding: 28px 22px 34px; color: var(--muted); font-style: italic; font-family: var(--body); font-size: 14px; }

/* covers (face-out) */
.book { flex: 0 0 auto; border: 0; padding: 0; background: none; cursor: pointer; scroll-snap-align: center;
  opacity: 0; transform: translateY(14px); }
.book--in { animation: bookIn .55s cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i) * 55ms); }
@keyframes bookIn { to { opacity: 1; transform: translateY(0); } }
.book:active { transform: translateY(1px) scale(0.99); }

.cover { display: block; width: 118px; height: 178px; object-fit: cover; border-radius: 2px 3px 3px 2px;
  box-shadow: 0 1px 0 rgba(0,0,0,0.12), 0 10px 18px -10px rgba(0,0,0,0.5), inset 0 0 0 0.5px rgba(0,0,0,0.12);
  transition: transform .35s cubic-bezier(.2,.8,.2,1), box-shadow .35s; }
.book:hover .cover { transform: translateY(-8px); box-shadow: 0 1px 0 rgba(0,0,0,0.12), 0 22px 30px -14px rgba(0,0,0,0.55); }

.cover--proc { display: flex; flex-direction: column; justify-content: space-between; padding: 13px 12px;
  background: var(--pc-bg); color: var(--pc-fg); }
.cover-proc__mark { width: 22px; height: 6px; border-radius: 1px; background: var(--pc-mark); }
.cover-proc__title { font-family: var(--sans); font-weight: 700; font-size: 14px; line-height: 1.08; letter-spacing: -0.01em;
  display: -webkit-box; -webkit-line-clamp: 5; -webkit-box-orient: vertical; overflow: hidden; }
.cover-proc__author { font-size: 9px; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.85; }

/* acrylic rail */
.rail { position: absolute; left: 16px; right: 16px; bottom: 8px; height: 50px; border-radius: 9px; z-index: 2; pointer-events: none;
  background: linear-gradient(180deg, color-mix(in srgb, var(--tint) 30%, transparent), color-mix(in srgb, var(--tint) 48%, transparent));
  -webkit-backdrop-filter: blur(7px) saturate(1.2); backdrop-filter: blur(7px) saturate(1.2);
  box-shadow:
    0 1px 0 rgba(255,255,255,0.7) inset,
    0 -1px 0 color-mix(in srgb, var(--tint) 60%, transparent) inset,
    0 16px 22px -12px color-mix(in srgb, var(--tint) 70%, transparent),
    0 2px 6px rgba(0,0,0,0.10);
  border: 1px solid rgba(255,255,255,0.35); }
.rail__gloss { position: absolute; inset: 1px 1px auto 1px; height: 42%; border-radius: 8px 8px 14px 14px;
  background: linear-gradient(180deg, rgba(255,255,255,0.45), rgba(255,255,255,0) 100%); }
.rail__screw { position: absolute; top: 50%; width: 13px; height: 13px; border-radius: 50%; transform: translateY(-50%);
  background: radial-gradient(40% 40% at 38% 32%, #fdfdfd, #c8c8c8 55%, #8c8c8c 100%);
  box-shadow: 0 1px 2px rgba(0,0,0,0.4), inset 0 0 0 1px rgba(0,0,0,0.18); }
.rail__screw::after { content: ""; position: absolute; inset: 0; margin: auto; width: 7px; height: 1.4px; background: rgba(0,0,0,0.4); border-radius: 1px; transform: rotate(-30deg); }
.rail__screw--l { left: 9px; } .rail__screw--r { right: 9px; }

/* ================================================================== *
 * Reader                                                              *
 * ================================================================== */
.reader { position: fixed; inset: 0; z-index: 50; }
.reader__backdrop { position: absolute; inset: 0; background: rgba(20,18,16,0.4); opacity: 0; transition: opacity .4s;
  -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); }
.reader__backdrop.is-open { opacity: 1; }
.reader__sheet { position: absolute; left: 50%; bottom: 0; width: min(100%, 560px); height: 100%;
  transform: translate(-50%, 100%); transition: transform .42s cubic-bezier(.16,1,.3,1);
  background: var(--card); display: flex; flex-direction: column; box-shadow: 0 -10px 50px rgba(0,0,0,0.3);
  font-family: var(--body); }
.reader__sheet.is-open { transform: translate(-50%, 0); }

.reader__bar { display: flex; align-items: center; justify-content: space-between;
  padding: max(env(safe-area-inset-top), 14px) 16px 10px; }
.reader__icon { width: 40px; height: 40px; border: none; background: rgba(0,0,0,0.04); border-radius: 50%; cursor: pointer;
  font-size: 18px; color: var(--ink); line-height: 1; transition: background .2s; }
.reader__icon:hover { background: rgba(0,0,0,0.09); }
.reader__crumb { font-family: var(--sans); font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--muted); }

.reader__pager { flex: 1; display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
.reader__pager::-webkit-scrollbar { display: none; }
.rpage { flex: 0 0 100%; scroll-snap-align: start; overflow-y: auto; padding: 8px 30px 28px; }

/* cover page */
.rpage--cover { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
.hero { margin-bottom: 26px; }
.hero__cover { width: auto; max-width: 64%; height: auto; max-height: 46vh; aspect-ratio: auto;
  border-radius: 3px; box-shadow: 0 2px 0 rgba(0,0,0,0.1), 0 30px 50px -20px rgba(0,0,0,0.55); }
.hero .cover--proc { width: 200px; height: 300px; }
.hero__title { margin: 0; font-family: var(--serif); font-weight: 600; font-size: clamp(26px, 6.6vw, 36px); line-height: 1.06; }
.hero__author { margin: 8px 0 0; font-family: var(--sans); font-size: 15px; color: var(--muted); }
.chip { margin-top: 18px; display: inline-block; font-family: var(--sans); font-size: 11px; letter-spacing: 0.14em;
  text-transform: uppercase; padding: 7px 14px; border-radius: 999px; }
.chip--lu { background: rgba(46,125,91,0.14); color: #2E7D5B; }
.chip--sug { background: rgba(62,146,214,0.16); color: #2D77B6; }
.hero__more { margin-top: 26px; border: none; background: none; cursor: pointer; font-family: var(--sans);
  font-size: 14px; color: var(--ink); opacity: 0.65; transition: opacity .2s; }
.hero__more:hover { opacity: 1; }

/* content page */
.rpage--content { padding-top: 18px; }
.content { max-width: 460px; margin: 0 auto; }
.kicker { display: block; font-family: var(--sans); font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase; color: var(--muted); margin-bottom: 18px; }
.note { margin: 0; font-family: var(--body); font-size: clamp(17px, 2.4vw, 20px); line-height: 1.62; color: var(--ink); }
.note__drop { float: left; font-family: var(--serif); font-weight: 600; font-size: 3.1em; line-height: 0.72; padding: 4px 12px 0 0; }
.sign { margin-top: 22px; font-family: var(--sans); font-size: 12px; color: var(--muted); }
.facts { margin: 30px 0 0; border-top: 1px solid var(--line); }
.facts > div { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid var(--line); }
.facts dt { font-family: var(--sans); font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: var(--muted); }
.facts dd { margin: 0; font-family: var(--serif); font-size: 16px; text-align: right; }

.reader__dots { display: flex; justify-content: center; gap: 9px; padding: 12px 0 max(env(safe-area-inset-bottom), 18px); }
.reader__dots button { width: 8px; height: 8px; border-radius: 50%; border: none; padding: 0; cursor: pointer;
  background: rgba(0,0,0,0.18); transition: all .3s; }
.reader__dots button.is-on { background: var(--ink); width: 22px; border-radius: 5px; }

@media (prefers-reduced-motion: reduce) {
  .book { opacity: 1; transform: none; }
  .book--in { animation: none; }
  .cover, .reader__sheet, .reader__backdrop { transition: none; }
}
`;
