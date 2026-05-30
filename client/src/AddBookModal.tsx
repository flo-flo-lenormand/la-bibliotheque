import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { api, type ApiRequest } from "./api";
import { playStamp, playShelve, playChime } from "./sounds";

type AddBookInput = ApiRequest<typeof api, "add_book">;
type Status = "lu" | "suggéré";
type Phase = "idle" | "binding" | "done";

// Thickness of the spine grows with the page count — same spirit as the
// shelf's `bookDimensions`, tuned a little larger for the close-up preview.
function previewThickness(pages: number) {
  return Math.max(22, Math.min(78, 22 + (pages - 120) * 0.07));
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ */
/* The brass wax-seal button that opens the workbench.                */
/* ------------------------------------------------------------------ */
export function AddBookButton({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      aria-label="Ajouter un ouvrage"
      className="abm-seal group fixed z-30 right-[max(18px,env(safe-area-inset-right))] bottom-[max(22px,env(safe-area-inset-bottom))] w-16 h-16 rounded-full focus:outline-none"
      style={{
        background: "radial-gradient(60% 60% at 38% 32%, #E2C799 0%, #C9A227 38%, #8a6f1c 78%, #5b4711 100%)",
        boxShadow:
          "0 10px 28px rgba(0,0,0,0.55), 0 2px 0 rgba(255,255,255,0.25) inset, 0 -6px 12px rgba(0,0,0,0.4) inset",
      }}
    >
      {/* Embossed quill */}
      <span className="absolute inset-0 grid place-items-center">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden
          style={{ filter: "drop-shadow(0 1px 0 rgba(255,255,255,0.3)) drop-shadow(0 -1px 1px rgba(0,0,0,0.45))" }}>
          <path d="M3 21c4-1 7-3 10-6 2.5-2.5 4-5.5 5-9-3 1-6 2.5-8.5 5C7 13.5 5 16.5 3 21Z"
            fill="#3A2418" opacity="0.92" />
          <path d="M3 21c4-1 7-3 10-6" stroke="#E2C799" strokeWidth="0.8" opacity="0.5" />
          <circle cx="17.5" cy="6.5" r="1.4" fill="#3A2418" opacity="0.5" />
        </svg>
      </span>
      {/* Idle glow ring */}
      <span className="abm-seal-ring absolute inset-0 rounded-full pointer-events-none" />
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* The workbench modal.                                               */
/* ------------------------------------------------------------------ */
export function AddBookModal({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const reduced = usePrefersReducedMotion();

  const [shown, setShown] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [shake, setShake] = useState(false);

  // form state
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [status, setStatus] = useState<Status>("lu");
  const [pages, setPages] = useState(320);
  const [note, setNote] = useState("");
  const [coverUrl, setCoverUrl] = useState("");
  const [isbn, setIsbn] = useState("");
  const [showDetails, setShowDetails] = useState(false);

  const titleRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const valid = title.trim().length > 0 && author.trim().length > 0;
  const thick = previewThickness(pages);

  // Enter transition + body scroll lock + focus + Escape.
  useEffect(() => {
    const raf = requestAnimationFrame(() => setShown(true));
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => titleRef.current?.focus(), 380);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
    };
  }, []);

  const close = useCallback(() => {
    if (phase === "binding") return; // don't bail mid-press
    setShown(false);
    setTimeout(onClose, 360);
  }, [onClose, phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Gentle pointer parallax on the preview stage (desktop richness).
  const onStageMove = useCallback((e: ReactPointerEvent) => {
    if (reduced) return;
    const el = stageRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const nx = (e.clientX - r.left) / r.width - 0.5;
    const ny = (e.clientY - r.top) / r.height - 0.5;
    setTilt({ x: nx * 16, y: ny * -12 });
  }, [reduced]);
  const onStageLeave = useCallback(() => setTilt({ x: 0, y: 0 }), []);

  const mutation = useMutation({
    mutationFn: (input: AddBookInput) => api.add_book(input),
  });

  const submit = useCallback(() => {
    if (!valid || phase !== "idle") return;
    const input: AddBookInput = {
      title: title.trim(),
      author: author.trim(),
      status,
      page_count: pages,
    };
    if (note.trim()) input.personal_note = note.trim();
    if (isbn.trim()) input.isbn = isbn.trim();
    if (coverUrl.trim()) {
      try {
        new URL(coverUrl.trim());
        input.cover_image_url = coverUrl.trim();
      } catch { /* ignore malformed URL, let the server fetch a cover */ }
    }

    setPhase("binding");
    playStamp();

    mutation.mutate(input, {
      onSuccess: () => {
        // The shelf can repopulate behind us while the tome flies home.
        qc.invalidateQueries({ queryKey: ["books"] });
        setPhase("done");
        playShelve();
        setTimeout(playChime, 260);
        setTimeout(onClose, reduced ? 200 : 880);
      },
      onError: () => {
        setPhase("idle");
        setShake(true);
        setTimeout(() => setShake(false), 480);
      },
    });
  }, [valid, phase, title, author, status, pages, note, isbn, coverUrl, mutation, qc, onClose, reduced]);

  // Dust motes that burst when the tome is shelved.
  const motes = useMemo(
    () =>
      Array.from({ length: 16 }, (_, i) => ({
        dx: (Math.random() - 0.5) * 220,
        dy: -60 - Math.random() * 180,
        s: 0.5 + Math.random() * 1.6,
        d: 80 + Math.random() * 160,
        id: i,
      })),
    [],
  );

  const lastName = author.trim().split(" ").filter(Boolean).pop() ?? "";

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      role="dialog"
      aria-modal="true"
      aria-label="Relier un ouvrage"
      style={{ perspective: "1400px", fontFamily: "'Newsreader', serif" }}
    >
      {/* Backdrop */}
      <div
        onClick={close}
        className="absolute inset-0 transition-opacity duration-500"
        style={{
          opacity: shown ? 1 : 0,
          background:
            "radial-gradient(120% 90% at 50% -10%, rgba(226,199,121,0.10), transparent 55%), rgba(8,5,3,0.84)",
          backdropFilter: "blur(3px)",
        }}
      />

      {/* The desk / workbench panel */}
      <div
        className={`abm-panel relative z-10 m-0 flex h-full w-full flex-col overflow-hidden md:m-auto md:h-auto md:max-h-[92vh] md:w-[min(560px,94vw)] md:rounded-[22px] ${shake ? "abm-shake" : ""}`}
        style={{
          transform: shown ? "translateY(0)" : "translateY(28px)",
          opacity: shown ? 1 : 0,
          transition: "transform 460ms cubic-bezier(.16,1,.3,1), opacity 360ms ease",
          background: "linear-gradient(180deg, #2A1F1A 0%, #160F09 100%)",
          boxShadow: "0 -1px 0 rgba(255,255,255,0.05) inset, 0 40px 120px rgba(0,0,0,0.6)",
          paddingTop: "max(env(safe-area-inset-top), 0px)",
        }}
      >
        {/* Wood grain skin */}
        <div className="pointer-events-none absolute inset-0 opacity-[0.5]" style={{
          background:
            "repeating-linear-gradient(92deg, #3A2418 0px, #4A3022 9px, #34200f 18px, #2A1A0F 27px)",
          mixBlendMode: "overlay",
        }} />

        {/* Header — brass plate */}
        <header className="relative z-10 flex items-center justify-between gap-3 px-5 pt-4 pb-3">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-full grid place-items-center" style={{
              background: "radial-gradient(60% 60% at 38% 32%, #E2C799, #C9A227 55%, #7a6017)",
              boxShadow: "0 2px 6px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.3) inset",
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                <path d="M3 21c4-1 7-3 10-6 2.5-2.5 4-5.5 5-9-3 1-6 2.5-8.5 5C7 13.5 5 16.5 3 21Z" fill="#3A2418" />
              </svg>
            </div>
            <div className="leading-tight">
              <div className="text-[11px] uppercase tracking-[0.28em] text-[var(--accent)]" style={{ fontFamily: "system-ui" }}>
                L'Atelier
              </div>
              <div className="text-[18px] text-[var(--text)]">Relier un ouvrage</div>
            </div>
          </div>
          <button
            onClick={close}
            aria-label="Fermer"
            className="h-9 w-9 rounded-full grid place-items-center text-[var(--text)] active:scale-90 transition"
            style={{
              background: "linear-gradient(180deg, #4A3022, #2A1A0F)",
              boxShadow: "0 2px 6px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.08) inset",
            }}
          >
            ✕
          </button>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto overscroll-contain px-5 pb-3">
          {/* ---- Live preview stage ---- */}
          <div
            ref={stageRef}
            onPointerMove={onStageMove}
            onPointerLeave={onStageLeave}
            className="relative mx-auto mb-6 grid h-[260px] place-items-center"
            style={{ perspective: "900px" }}
          >
            {/* warm pool of light */}
            <div className="pointer-events-none absolute inset-x-0 top-2 h-[120px] blur-3xl opacity-40" style={{
              background: "radial-gradient(50% 100% at 50% 0%, rgba(226,199,121,0.55), transparent 70%)",
            }} />
            {/* contact shadow */}
            <div className="pointer-events-none absolute bottom-7 left-1/2 h-[26px] w-[160px] -translate-x-1/2 blur-2xl opacity-60" style={{
              background: "radial-gradient(50% 100% at 50% 50%, #000, transparent)",
            }} />

            <div
              className={`abm-book ${phase === "binding" ? "abm-pressing" : ""} ${phase === "done" ? "abm-flyaway" : ""} ${reduced ? "abm-still" : ""}`}
              style={{
                transformStyle: "preserve-3d",
                ["--tiltx" as any]: `${tilt.x}deg`,
                ["--tilty" as any]: `${tilt.y}deg`,
              }}
            >
              <div className="relative" style={{ width: 156, height: 224, transformStyle: "preserve-3d" }}>
                {/* Front cover */}
                <div
                  className="absolute inset-0 overflow-hidden rounded-[4px] rounded-l-[3px]"
                  style={{
                    transform: `translateZ(${thick / 2}px)`,
                    transition: "transform 420ms cubic-bezier(.2,.8,.2,1)",
                    background: coverUrl.trim()
                      ? `url(${coverUrl.trim()}) center/cover, #5C3D2E`
                      : "linear-gradient(135deg, #6B4630 0%, #4A3022 55%, #34200f 100%)",
                    boxShadow: "0 10px 26px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(0,0,0,0.45), inset 2px 0 6px rgba(255,255,255,0.05)",
                  }}
                >
                  {!coverUrl.trim() && (
                    <div className="absolute inset-0 flex flex-col justify-between p-3">
                      <div className="h-[3px] w-10 rounded-full" style={{ background: "rgba(226,199,121,0.6)" }} />
                      <div>
                        <div className="text-[15px] leading-[1.15] text-[#F5EFE6]/95 line-clamp-4">
                          {title.trim() || "Titre…"}
                        </div>
                        <div className="mt-2 text-[11px] text-[#E2C799]/85" style={{ fontFamily: "system-ui" }}>
                          {author.trim() || "Auteur"}
                        </div>
                      </div>
                      <div className="h-[2px] w-6 rounded-full" style={{ background: "rgba(226,199,121,0.4)" }} />
                    </div>
                  )}
                  {/* gold-foil sweep on press */}
                  <div className="abm-foil pointer-events-none absolute inset-0" />
                  {/* spine-side edge */}
                  <div className="pointer-events-none absolute inset-y-0 left-0 w-[4px] bg-gradient-to-r from-black/45 to-transparent" />
                </div>

                {/* Spine */}
                <div
                  className="absolute top-0 bottom-0 left-0 rounded-[2px]"
                  style={{
                    width: thick,
                    transform: `rotateY(-90deg) translateZ(${78 / 1}px)`,
                    transformOrigin: "left center",
                    transition: "width 420ms cubic-bezier(.2,.8,.2,1)",
                    background: "linear-gradient(90deg, #241509 0%, #4A3022 32%, #5C3D2E 68%, #241509 100%)",
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)",
                  }}
                >
                  <div className="absolute inset-0 grid place-items-center">
                    <div
                      className="text-[9px] tracking-wide text-[#E2C799] opacity-80"
                      style={{ writingMode: "vertical-rl", transform: "rotate(180deg)", fontFamily: "system-ui" }}
                    >
                      {lastName || "—"}
                    </div>
                  </div>
                </div>

                {/* Top page block */}
                <div
                  className="absolute left-0 right-0 top-0 h-[7px] rounded-t-[2px]"
                  style={{
                    transform: `translateZ(${thick / 2 - 1}px)`,
                    transition: "transform 420ms cubic-bezier(.2,.8,.2,1)",
                    background: "repeating-linear-gradient(90deg, #E8DFD3 0px, #E8DFD3 1px, #D6CBBE 1px, #D6CBBE 2px)",
                  }}
                />

                {/* Status flourish */}
                {status === "suggéré" ? (
                  <div className="abm-suggest pointer-events-none absolute -inset-[7px] rounded-[7px]" style={{
                    background: "repeating-linear-gradient(45deg, rgba(201,162,39,0.10) 0 8px, transparent 8px 16px)",
                    boxShadow: "0 0 0 1px rgba(201,162,39,0.3) inset, 0 0 34px rgba(201,162,39,0.18)",
                  }}>
                    <div className="absolute right-2 top-2 h-2 w-2 rounded-full bg-[var(--accent)] blur-[1px] animate-pulse" />
                  </div>
                ) : (
                  <div
                    className="abm-seal-read absolute -right-2 -top-2 z-10 grid h-9 w-9 place-items-center rounded-full"
                    style={{
                      transform: `translateZ(${thick / 2 + 6}px)`,
                      background: "radial-gradient(60% 60% at 40% 35%, #9a4a36, #6E3A2A 60%, #45211a)",
                      boxShadow: "0 3px 8px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.18) inset",
                    }}
                  >
                    <span className="text-[8px] uppercase tracking-wider text-[#F5EFE6]/90" style={{ fontFamily: "system-ui" }}>Lu</span>
                  </div>
                )}
              </div>

              {/* dust burst on shelve */}
              {phase === "done" && !reduced && (
                <div className="pointer-events-none absolute inset-0">
                  {motes.map((m) => (
                    <span
                      key={m.id}
                      className="abm-mote absolute left-1/2 top-1/2 rounded-full"
                      style={{
                        width: m.s * 3,
                        height: m.s * 3,
                        background: "rgba(226,199,121,0.8)",
                        ["--mx" as any]: `${m.dx}px`,
                        ["--my" as any]: `${m.dy}px`,
                        ["--md" as any]: `${m.d}ms`,
                      }}
                    />
                  ))}
                </div>
              )}
            </div>

            <div className="absolute bottom-1 text-[11px] uppercase tracking-[0.25em] text-[var(--dim)]/70" style={{ fontFamily: "system-ui" }}>
              {phase === "done" ? "Rangé." : phase === "binding" ? "Reliure…" : "Aperçu"}
            </div>
          </div>

          {/* ---- Form: index cards on the desk ---- */}
          <div className="space-y-4">
            <Field label="Titre" required>
              <input
                ref={titleRef}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Le titre de l'ouvrage"
                className="abm-input"
                enterKeyHint="next"
              />
            </Field>

            <Field label="Auteur" required>
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="Nom de l'auteur"
                className="abm-input"
              />
            </Field>

            {/* Status — wax-seal stamps */}
            <div>
              <Label>Statut</Label>
              <div className="mt-1.5 grid grid-cols-2 gap-3">
                <StampToggle
                  active={status === "lu"}
                  onClick={() => { setStatus("lu"); playStamp(); }}
                  tint="#6E3A2A"
                  label="Lu"
                  sub="déjà lu & aimé"
                />
                <StampToggle
                  active={status === "suggéré"}
                  onClick={() => { setStatus("suggéré"); playStamp(); }}
                  tint="#C9A227"
                  label="Suggéré"
                  sub="à découvrir"
                />
              </div>
            </div>

            {/* Page count — brass ruler */}
            <div>
              <div className="flex items-baseline justify-between">
                <Label>Épaisseur</Label>
                <span className="text-[13px] text-[var(--dim)]" style={{ fontFamily: "system-ui" }}>
                  ≈ {pages} pages
                </span>
              </div>
              <input
                type="range"
                min={80}
                max={1000}
                step={8}
                value={pages}
                onChange={(e) => setPages(Number(e.target.value))}
                className="abm-range mt-3 w-full"
                aria-label="Nombre de pages"
              />
            </div>

            {/* Personal note — handwritten card */}
            <div>
              <Label>Note personnelle</Label>
              <div className="abm-note mt-1.5">
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={3}
                  placeholder="Pourquoi ce livre compte…"
                  className="abm-note-area"
                />
              </div>
            </div>

            {/* Advanced — binder's details */}
            <div>
              <button
                onClick={() => setShowDetails((s) => !s)}
                className="text-[12px] uppercase tracking-[0.2em] text-[var(--accent)]/80 transition hover:text-[var(--accent)]"
                style={{ fontFamily: "system-ui" }}
              >
                {showDetails ? "− détails de reliure" : "+ détails de reliure"}
              </button>
              <div
                className="overflow-hidden transition-all duration-500"
                style={{ maxHeight: showDetails ? 240 : 0, opacity: showDetails ? 1 : 0 }}
              >
                <div className="space-y-4 pt-4">
                  <Field label="ISBN">
                    <input
                      value={isbn}
                      onChange={(e) => setIsbn(e.target.value)}
                      placeholder="ex. 9780593321447"
                      className="abm-input"
                      inputMode="numeric"
                    />
                  </Field>
                  <Field label="URL de couverture">
                    <input
                      value={coverUrl}
                      onChange={(e) => setCoverUrl(e.target.value)}
                      placeholder="https://… (sinon recherche auto)"
                      className="abm-input"
                      inputMode="url"
                    />
                  </Field>
                  <p className="text-[12px] leading-relaxed text-[var(--dim)]/70" style={{ fontFamily: "system-ui" }}>
                    Sans couverture, l'atelier en cherche une via Open Library.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer — bind & shelve */}
        <footer
          className="relative z-10 border-t border-black/40 px-5 pt-3"
          style={{
            paddingBottom: "max(env(safe-area-inset-bottom), 14px)",
            background: "linear-gradient(180deg, rgba(0,0,0,0) 0%, rgba(0,0,0,0.25) 100%)",
          }}
        >
          {mutation.isError && (
            <div className="mb-2 text-center text-[13px] text-[#e0a08f]" style={{ fontFamily: "system-ui" }}>
              La reliure a échoué. Réessaie.
            </div>
          )}
          <button
            onClick={submit}
            disabled={!valid || phase !== "idle"}
            className="abm-bind relative w-full overflow-hidden rounded-[12px] py-3.5 text-[15px] font-medium text-[#1A120B] transition active:scale-[0.985] disabled:opacity-45"
            style={{
              background: "linear-gradient(180deg, #E2C799 0%, #C9A227 52%, #a8861d 100%)",
              boxShadow: "0 8px 22px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.4) inset, 0 -3px 8px rgba(0,0,0,0.3) inset",
              fontFamily: "system-ui",
            }}
          >
            {phase !== "idle" && <span className="abm-shimmer pointer-events-none absolute inset-0" />}
            <span className="relative">
              {phase === "done" ? "Rangé ✓" : phase === "binding" ? "Reliure en cours…" : "Relier & ranger"}
            </span>
          </button>
        </footer>
      </div>

      <style>{styles}</style>
    </div>
  );
}

/* ---- small presentational helpers ---- */

function Label({ children }: { children: ReactNode }) {
  return (
    <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--accent)]" style={{ fontFamily: "system-ui" }}>
      {children}
    </span>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <Label>
        {label}
        {required && <span className="text-[#e0a08f]"> *</span>}
      </Label>
      <div className="mt-1.5">{children}</div>
    </label>
  );
}

function StampToggle({
  active, onClick, tint, label, sub,
}: { active: boolean; onClick: () => void; tint: string; label: string; sub: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`abm-stamp relative rounded-[12px] px-3 py-3 text-left transition ${active ? "abm-stamp-on" : ""}`}
      style={{
        background: active
          ? `linear-gradient(180deg, ${tint} 0%, ${tint}cc 100%)`
          : "linear-gradient(180deg, #2A1A0F, #1c130b)",
        boxShadow: active
          ? `0 6px 16px rgba(0,0,0,0.45), 0 0 0 1px ${tint} inset, 0 1px 0 rgba(255,255,255,0.25) inset`
          : "0 2px 6px rgba(0,0,0,0.4), 0 0 0 1px rgba(255,255,255,0.05) inset",
      }}
    >
      <div className="text-[15px] text-[var(--text)]">{label}</div>
      <div className="text-[11px] text-[var(--text)]/60" style={{ fontFamily: "system-ui" }}>{sub}</div>
      {active && (
        <span className="absolute right-2.5 top-2.5 grid h-5 w-5 place-items-center rounded-full bg-[#F5EFE6]/90 text-[11px] text-[#1A120B]">✓</span>
      )}
    </button>
  );
}

/* ---- scoped styles ---- */
const styles = `
.abm-input, .abm-note-area {
  width: 100%;
  font-family: 'Newsreader', serif;
  font-size: 16px; /* >=16px keeps iOS from zooming on focus */
  color: #1A120B;
  background:
    repeating-linear-gradient(#fbf6ec, #fbf6ec 27px, rgba(0,0,0,0.05) 28px),
    linear-gradient(180deg, #F5EFE6, #ece2d2);
  border: none;
  border-radius: 8px;
  padding: 12px 14px;
  box-shadow: 0 2px 8px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.25) inset, 0 1px 0 rgba(255,255,255,0.6) inset;
  outline: none;
  transition: box-shadow 220ms ease, transform 220ms ease;
}
.abm-input::placeholder, .abm-note-area::placeholder { color: #9b8a78; }
.abm-input:focus, .abm-note-area:focus {
  box-shadow: 0 6px 18px rgba(201,162,39,0.25), 0 0 0 2px var(--accent) inset, 0 1px 0 rgba(255,255,255,0.6) inset;
  transform: translateY(-1px);
}
.abm-note { border-radius: 8px; }
.abm-note-area {
  resize: none;
  font-family: 'Caveat', cursive;
  font-size: 20px;
  line-height: 28px;
  background:
    repeating-linear-gradient(#fbf6ec, #fbf6ec 27px, rgba(40,80,120,0.18) 28px),
    linear-gradient(180deg, #F7F2E8, #efe6d6);
}

/* brass ruler slider */
.abm-range { -webkit-appearance: none; appearance: none; height: 22px; background: transparent; }
.abm-range::-webkit-slider-runnable-track {
  height: 8px; border-radius: 6px;
  background:
    repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0 1px, transparent 1px 16px),
    linear-gradient(180deg, #4A3022, #2A1A0F);
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.6);
}
.abm-range::-moz-range-track {
  height: 8px; border-radius: 6px;
  background:
    repeating-linear-gradient(90deg, rgba(0,0,0,0.35) 0 1px, transparent 1px 16px),
    linear-gradient(180deg, #4A3022, #2A1A0F);
  box-shadow: inset 0 1px 3px rgba(0,0,0,0.6);
}
.abm-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  margin-top: -7px; width: 22px; height: 22px; border-radius: 50%;
  background: radial-gradient(60% 60% at 38% 32%, #E2C799, #C9A227 60%, #7a6017);
  box-shadow: 0 3px 8px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.4) inset;
  cursor: grab;
}
.abm-range::-moz-range-thumb {
  width: 22px; height: 22px; border: none; border-radius: 50%;
  background: radial-gradient(60% 60% at 38% 32%, #E2C799, #C9A227 60%, #7a6017);
  box-shadow: 0 3px 8px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.4) inset;
  cursor: grab;
}
.abm-range:focus { outline: none; }

/* preview book idle motion */
@keyframes abmFloat {
  0%, 100% { transform: rotateX(6deg) rotateY(calc(-22deg + var(--tilty))) translateY(0); }
  50%      { transform: rotateX(8deg) rotateY(calc(-14deg + var(--tilty))) translateY(-8px); }
}
.abm-book {
  transform: rotateX(7deg) rotateY(calc(-18deg + var(--tilty)));
  animation: abmFloat 6s ease-in-out infinite;
  transition: transform 240ms ease;
  will-change: transform;
}
.abm-book.abm-still { animation: none; transform: rotateX(7deg) rotateY(-18deg); }

@keyframes abmPress {
  0%   { transform: rotateX(7deg) rotateY(-18deg) scale(1); }
  35%  { transform: rotateX(7deg) rotateY(-18deg) scale(0.94, 0.9); }
  100% { transform: rotateX(7deg) rotateY(-18deg) scale(1); }
}
.abm-book.abm-pressing { animation: abmPress 520ms cubic-bezier(.3,.7,.3,1) both; }

@keyframes abmFly {
  0%   { transform: rotateX(7deg) rotateY(-18deg) translate(0,0) scale(1); opacity: 1; }
  100% { transform: rotateX(28deg) rotateY(-46deg) translate(0,-64vh) scale(0.22); opacity: 0; }
}
.abm-book.abm-flyaway { animation: abmFly 820ms cubic-bezier(.5,0,.7,.3) both; }

/* gold foil sweep over the cover during press */
.abm-foil {
  background: linear-gradient(115deg, transparent 30%, rgba(255,247,214,0.85) 48%, rgba(226,199,121,0.4) 54%, transparent 70%);
  transform: translateX(-130%);
  opacity: 0;
}
.abm-pressing .abm-foil, .abm-flyaway .abm-foil {
  animation: abmFoil 700ms ease-out;
}
@keyframes abmFoil {
  0%   { transform: translateX(-130%); opacity: 0; }
  20%  { opacity: 1; }
  100% { transform: translateX(130%); opacity: 0; }
}

/* dust motes */
@keyframes abmMote {
  0%   { transform: translate(-50%, -50%) scale(1); opacity: 0.9; }
  100% { transform: translate(calc(-50% + var(--mx)), calc(-50% + var(--my))) scale(0.2); opacity: 0; }
}
.abm-mote { animation: abmMote 900ms ease-out forwards; animation-delay: var(--md); }

/* footer shimmer while binding */
.abm-shimmer {
  background: linear-gradient(110deg, transparent 35%, rgba(255,255,255,0.55) 50%, transparent 65%);
  transform: translateX(-120%);
  animation: abmShimmer 1100ms ease-in-out infinite;
}
@keyframes abmShimmer {
  to { transform: translateX(120%); }
}

/* error shake */
@keyframes abmShake {
  0%,100% { transform: translateX(0); }
  20% { transform: translateX(-8px); }
  40% { transform: translateX(7px); }
  60% { transform: translateX(-5px); }
  80% { transform: translateX(3px); }
}
.abm-shake { animation: abmShake 460ms ease-in-out; }

/* opening seal button */
@keyframes abmSealFloat {
  0%,100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
.abm-seal { animation: abmSealFloat 4.5s ease-in-out infinite; }
.abm-seal:active { transform: scale(0.92); }
.abm-seal-ring {
  box-shadow: 0 0 0 0 rgba(226,199,121,0.5);
  animation: abmSealPulse 3.2s ease-out infinite;
}
@keyframes abmSealPulse {
  0% { box-shadow: 0 0 0 0 rgba(226,199,121,0.45); }
  70% { box-shadow: 0 0 0 16px rgba(226,199,121,0); }
  100% { box-shadow: 0 0 0 0 rgba(226,199,121,0); }
}
.abm-seal:hover .abm-seal-ring { box-shadow: 0 0 26px 4px rgba(226,199,121,0.4); animation: none; }

@media (prefers-reduced-motion: reduce) {
  .abm-book, .abm-seal, .abm-seal-ring, .abm-shimmer, .abm-foil, .abm-mote { animation: none !important; }
}
`;
