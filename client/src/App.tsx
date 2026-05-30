import { useQuery } from "@tanstack/react-query";
import { api, type ApiResponse } from "./api";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { playCreak, playThud } from "./sounds";
import { AddBookButton, AddBookModal } from "./AddBookModal";

type Book = ApiResponse<typeof api, "list_books">["books"][number];

type Vec2 = { x: number; y: number };

function useDustParticles(count = 60) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;
    let raf = 0;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const particles = Array.from({ length: count }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: 0.4 + Math.random() * 1.2,
      vx: (Math.random() - 0.5) * 0.00015,
      vy: (Math.random() - 0.5) * 0.00012 - 0.00005,
      a: 0.2 + Math.random() * 0.5,
    }));
    const resize = () => {
      const { clientWidth: w, clientHeight: h } = canvas;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.scale(dpr, dpr);
    };
    resize();
    const tick = () => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < -0.05) p.x = 1.05;
        if (p.x > 1.05) p.x = -0.05;
        if (p.y < -0.05) p.y = 1.05;
        if (p.y > 1.05) p.y = -0.05;
        ctx.beginPath();
        ctx.fillStyle = `rgba(226,199,121,${p.a * 0.35})`;
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fill();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [count]);
  return canvasRef;
}

function useParallax() {
  const [tilt, setTilt] = useState<Vec2>({ x: 0, y: 0 });
  useEffect(() => {
    let mx = 0, my = 0;
    const onMove = (e: MouseEvent) => {
      mx = (e.clientX / window.innerWidth - 0.5) * 2;
      my = (e.clientY / window.innerHeight - 0.5) * 2;
      setTilt({ x: mx * 6, y: my * -4 });
    };
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      const gx = Math.max(-30, Math.min(30, e.gamma)) / 30;
      const gy = Math.max(-30, Math.min(30, e.beta - 45)) / 30;
      setTilt({ x: gx * 8, y: gy * -5 });
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("deviceorientation", onOrient);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("deviceorientation", onOrient);
    };
  }, []);
  return tilt;
}

function bookDimensions(pageCount: number | null) {
  const h = 210 + Math.round((Math.sin((pageCount ?? 300) * 0.013) * 12));
  const w = Math.round(h * 0.66); // 2:3
  const thick = Math.max(18, Math.min(48, 18 + ((pageCount ?? 300) - 150) * 0.06));
  return { h, w, thick };
}

export function App() {
  const { data, isPending } = useQuery({
    queryKey: ["books"],
    queryFn: () => api.list_books({}),
  });
  const books = data?.books ?? [];

  const [activeId, setActiveId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(0);
  const [addOpen, setAddOpen] = useState(false);
  const dustRef = useDustParticles(80);
  const tilt = useParallax();

  const shelves = useMemo(() => {
    const per = 4;
    const out: Book[][] = [];
    for (let i = 0; i < books.length; i += per) out.push(books.slice(i, i + per));
    while (out.length < 3) out.push([]);
    return out.slice(0, 3);
  }, [books]);

  const active = useMemo(() => books.find(b => b.id === activeId) ?? null, [books, activeId]);

  const selectBook = useCallback((b: Book) => {
    if (activeId === b.id && open) return;
    playCreak();
    setActiveId(b.id);
    setOpen(false);
    setPage(0);
    setTimeout(() => {
      setOpen(true);
      playThud();
    }, 320);
  }, [activeId, open]);

  const closeBook = useCallback(() => {
    playThud();
    setOpen(false);
    setTimeout(() => setActiveId(null), 300);
  }, []);

  // subtle breathing
  const [breath, setBreath] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const loop = (t: number) => {
      setBreath(Math.sin((t - start) * 0.0005) * 0.5 + 0.5);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (isPending) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex items-center justify-center text-[var(--dim)]">
        Chargement…
      </div>
    );
  }

  return (
    <div className="relative min-h-screen bg-[var(--bg)] text-[var(--text)] overflow-hidden select-none" style={{ fontFamily: "'Newsreader', serif" }}>
      {/* Warm radial glow */}
      <div className="absolute inset-0 pointer-events-none" style={{
        background: "radial-gradient(120% 80% at 50% -10%, rgba(226,199,121,0.10) 0%, transparent 60%), radial-gradient(100% 100% at 50% 120%, rgba(0,0,0,0.7) 0%, transparent 40%)",
      }} />
      {/* Dust */}
      <canvas ref={dustRef} className="absolute inset-0 w-full h-full pointer-events-none opacity-80" />

      {/* Scene */}
      <div className="relative z-10 h-[100vh] w-full flex flex-col items-center justify-center px-3 py-10">
        <div className="w-full max-w-[980px]">
          {/* Bookshelf cabinet */}
          <div className="relative mx-auto" style={{ perspective: "1400px", transformStyle: "preserve-3d" }}>
            <div className="relative rounded-[24px] p-[18px] md:p-[28px]" style={{
              background: "linear-gradient(180deg, #2A1F1A 0%, #1A120B 100%)",
              boxShadow: "0 0 0 1px rgba(0,0,0,0.6), inset 0 0 80px rgba(0,0,0,0.8), 0 40px 120px rgba(0,0,0,0.65)",
            }}>
              {/* Wood body with grain */}
              <div className="absolute inset-0 rounded-[24px] overflow-hidden pointer-events-none">
                <div className="absolute inset-0" style={{
                  background: `
                    radial-gradient(120% 60% at 50% 0%, rgba(201,162,39,0.08), transparent 60%),
                    linear-gradient(180deg, rgba(255,255,255,0.02), transparent 20%),
                    repeating-linear-gradient(90deg, #3A2418 0px, #4A3022 8px, #3A2418 16px, #2F1E14 24px)
                  `,
                  filter: "contrast(1.05) brightness(0.95)",
                }} />
                <div className="absolute inset-0 mix-blend-overlay opacity-[0.15]" style={{
                  backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.4'/%3E%3C/svg%3E")`,
                }} />
              </div>

              {/* Inner cavity */}
              <div className="relative rounded-[16px] p-4 md:p-6" style={{
                background: "linear-gradient(180deg, #1F1610 0%, #0F0A07 100%)",
                boxShadow: "inset 0 0 60px rgba(0,0,0,0.9), inset 0 0 0 1px rgba(0,0,0,0.8)",
              }}>
                <div className="space-y-10 md:space-y-14">
                  {shelves.map((shelfBooks, sIdx) => (
                    <div key={sIdx} className="relative">
                      {/* Shelf plank */}
                      <div className="absolute left-0 right-0 top-[-18px] h-[22px] rounded-[6px]" style={{
                        background: "linear-gradient(180deg, #5C3D2E 0%, #3A2418 60%, #1F120A 100%)",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06), inset 0 -2px 6px rgba(0,0,0,0.5)",
                      }} />
                      {/* Shelf floor shadow */}
                      <div className="absolute left-2 right-2 top-[4px] h-[40px] blur-2xl opacity-40 pointer-events-none" style={{
                        background: "radial-gradient(60% 100% at 50% 0%, #000, transparent)",
                      }} />

                      <div className="relative flex items-end justify-center gap-4 md:gap-6 min-h-[240px] pt-6">
                        {shelfBooks.length === 0 ? (
                          <div className="h-[200px] w-full" />
                        ) : shelfBooks.map((b, i) => {
                          const { h, w, thick } = bookDimensions(b.page_count);
                          const isSuggested = b.status === "suggéré";
                          const isActive = activeId === b.id;
                          const offset = (i - (shelfBooks.length - 1) / 2) * 4;
                          const lean = Math.sin((b.id * 1.7)) * 1.2;
                          const breathe = 1 + (breath - 0.5) * 0.006;
                          return (
                            <button
                              key={b.id}
                              onClick={() => selectBook(b)}
                              className="group relative focus:outline-none"
                              style={{
                                width: thick,
                                height: h,
                                transform: `translate3d(${offset + tilt.x * 0.3}px, ${tilt.y * 0.2}px, 0) rotateZ(${lean}deg) scale(${breathe})`,
                                transformStyle: "preserve-3d",
                                transition: "transform 600ms cubic-bezier(.2,.8,.2,1)",
                                cursor: "grab",
                              }}
                              aria-label={b.title}
                            >
                              {/* Shadow */}
                              <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 w-[80%] h-[18px] blur-xl opacity-50" style={{
                                background: "radial-gradient(50% 100% at 50% 0%, #000, transparent)",
                              }} />

                              {/* 3D book */}
                              <div className="relative w-full h-full" style={{ transformStyle: "preserve-3d", transform: `rotateY(-28deg)` }}>
                                {/* Front cover */}
                                <div className="absolute inset-0 rounded-[3px] overflow-hidden" style={{
                                  transform: `translateZ(${thick / 2}px)`,
                                  background: b.cover_image_url ? `url(${b.cover_image_url}) center/cover` : "#5C3D2E",
                                  boxShadow: "0 8px 20px rgba(0,0,0,0.5), inset 0 0 0 1px rgba(0,0,0,0.4)",
                                }}>
                                  {!b.cover_image_url && (
                                    <div className="absolute inset-0 flex items-center justify-center p-2 text-center">
                                      <div className="text-[11px] leading-tight text-[#F5EFE6]/90" style={{ writingMode: "vertical-rl", transform: "rotate(180deg)" }}>
                                        {b.title}
                                      </div>
                                    </div>
                                  )}
                                  {/* Edge highlight */}
                                  <div className="absolute inset-y-0 left-0 w-[3px] bg-gradient-to-r from-black/40 to-transparent" />
                                </div>

                                {/* Spine */}
                                <div className="absolute top-0 bottom-0 left-0 rounded-[3px]" style={{
                                  width: thick,
                                  transform: `rotateY(-90deg) translateZ(${w / 2}px)`,
                                  background: "linear-gradient(90deg, #2A1A0F 0%, #4A3022 30%, #5C3D2E 70%, #2A1A0F 100%)",
                                  boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.5)",
                                }}>
                                  <div className="absolute inset-0 flex items-center justify-center">
                                    <div className="text-[9px] tracking-wide text-[#E2C799] opacity-80" style={{
                                      writingMode: "vertical-rl",
                                      transform: "rotate(180deg)",
                                      fontFamily: "system-ui",
                                    }}>
                                      {b.author.split(" ").pop()}
                                    </div>
                                  </div>
                                </div>

                                {/* Top pages */}
                                <div className="absolute left-0 right-0 top-0 h-[6px] rounded-t-[2px]" style={{
                                  transform: `translateZ(${thick / 2 - 1}px)`,
                                  background: "repeating-linear-gradient(90deg, #E8DFD3 0px, #E8DFD3 1px, #D6CBBE 1px, #D6CBBE 2px)",
                                }} />

                                {/* Suggested wrap */}
                                {isSuggested && (
                                  <div className="absolute -inset-[6px] rounded-[6px] pointer-events-none" style={{
                                    background: "repeating-linear-gradient(45deg, rgba(201,162,39,0.08) 0 8px, transparent 8px 16px)",
                                    boxShadow: "0 0 0 1px rgba(201,162,39,0.25) inset, 0 0 30px rgba(201,162,39,0.15)",
                                  }}>
                                    <div className="absolute inset-0 rounded-[6px]" style={{
                                      background: "radial-gradient(80% 60% at 50% 0%, rgba(226,199,121,0.12), transparent 70%)",
                                    }} />
                                    <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-[var(--accent)] blur-[1px] animate-pulse" />
                                  </div>
                                )}

                                {/* Hover lift */}
                                <div className="absolute inset-0 rounded-[3px] opacity-0 group-hover:opacity-100 transition-opacity" style={{
                                  boxShadow: "0 0 0 2px rgba(226,199,121,0.5) inset",
                                }} />

                                {/* Face-down mystery for suggested */}
                                {isSuggested && !isActive && (
                                  <div className="absolute inset-0 rounded-[3px] flex items-center justify-center" style={{
                                    background: "linear-gradient(180deg, rgba(20,14,10,0.85), rgba(20,14,10,0.95))",
                                    backdropFilter: "blur(0.5px)",
                                  }}>
                                    <div className="w-8 h-8 rounded-full border border-[var(--accent)]/40 flex items-center justify-center">
                                      <div className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] animate-pulse" />
                                    </div>
                                  </div>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Shelf lip */}
                      <div className="relative mt-2 h-[10px] rounded-[4px]" style={{
                        background: "linear-gradient(180deg, #3A2418 0%, #1A120B 100%)",
                        boxShadow: "0 4px 12px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.04)",
                      }} />
                    </div>
                  ))}
                </div>

                {/* Lamp glow top */}
                <div className="pointer-events-none absolute -top-10 left-1/2 -translate-x-1/2 w-[60%] h-[120px] blur-3xl opacity-30" style={{
                  background: "radial-gradient(50% 100% at 50% 0%, rgba(226,199,121,0.5), transparent 70%)",
                }} />
              </div>
            </div>

            {/* Table below */}
            <div className="relative mx-auto mt-10 w-[92%] h-[120px] rounded-[24px]" style={{
              background: "radial-gradient(100% 60% at 50% 0%, rgba(92,61,46,0.5), rgba(26,18,11,0.9))",
              boxShadow: "0 -10px 40px rgba(0,0,0,0.5) inset, 0 20px 60px rgba(0,0,0,0.5)",
              transform: `rotateX(65deg) translateZ(-80px)`,
              transformOrigin: "top center",
            }} />
          </div>
        </div>
      </div>

      {/* Pulled book stage */}
      {active && (
        <div className="fixed inset-0 z-40 flex items-end justify-center pb-[10vh] px-4" style={{ perspective: "1600px" }}>
          <div className="absolute inset-0 bg-black/70 backdrop-blur-[2px]" onClick={closeBook} />
          <div className="relative" style={{ transformStyle: "preserve-3d", transform: `rotateX(${8 + tilt.y * 0.2}deg) rotateY(${tilt.x * 0.3}deg)` }}>
            {/* Book on table */}
            <div className={`relative transition-transform duration-500 ${open ? "translate-y-0" : "translate-y-12"}`} style={{ transformStyle: "preserve-3d", transform: open ? "rotateX(12deg)" : "rotateX(30deg)" }}>
              <div className="relative mx-auto" style={{ width: 340, height: 460, transformStyle: "preserve-3d" }}>
                {/* Left page */}
                <div className="absolute left-0 top-0 bottom-0 w-1/2 origin-right" style={{
                  transform: `rotateY(${open ? -165 : -20}deg)`,
                  transformStyle: "preserve-3d",
                  transition: "transform 800ms cubic-bezier(.2,.8,.2,1)",
                }}>
                  <div className="absolute inset-0 rounded-l-[10px] bg-[#F5EFE6] shadow-2xl overflow-hidden" style={{
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08), -10px 0 30px rgba(0,0,0,0.3)",
                  }}>
                    <div className="h-full p-6" style={{ backgroundImage: "repeating-linear-gradient(transparent, transparent 24px, rgba(0,0,0,0.04) 25px)" }}>
                      {page === 0 ? (
                        <div className="h-full flex flex-col">
                          <div className="text-[11px] uppercase tracking-widest text-[#6B5A4A] mb-3" style={{ fontFamily: "system-ui" }}>Couverture</div>
                          <div className="flex-1 rounded-[6px] overflow-hidden bg-[#1A120B] relative">
                            {active.cover_image_url && <img src={active.cover_image_url} className="w-full h-full object-cover" alt="" />}
                            <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                            <div className="absolute bottom-3 left-3 right-3">
                              <div className="text-white text-[18px] leading-tight">{active.title}</div>
                              <div className="text-[#E2C799] text-[13px] mt-1">{active.author}</div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="pt-4">
                          <div className="text-[11px] uppercase tracking-widest text-[#6B5A4A] mb-4" style={{ fontFamily: "system-ui" }}>Recommandation</div>
                          <p className="text-[17px] leading-[1.6] text-[#1A120B]" style={{ fontFamily: "'Caveat', cursive" }}>
                            {active.personal_note || "—"}
                          </p>
                          <div className="mt-6 text-[12px] text-[#6B5A4A]" style={{ fontFamily: "system-ui" }}>
                            — Lucy • {new Date(active.date_added).toLocaleDateString("fr-FR")}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right page */}
                <div className="absolute right-0 top-0 bottom-0 w-1/2">
                  <div className="absolute inset-0 rounded-r-[10px] bg-[#F5EFE6] shadow-2xl overflow-hidden" style={{
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.08), 10px 0 30px rgba(0,0,0,0.25)",
                  }}>
                    <div className="h-full p-6" style={{ backgroundImage: "repeating-linear-gradient(transparent, transparent 24px, rgba(0,0,0,0.04) 25px)" }}>
                      {page === 0 ? (
                        <div className="pt-2">
                          <div className="text-[11px] uppercase tracking-widest text-[#6B5A4A] mb-3" style={{ fontFamily: "system-ui" }}>Note</div>
                          <p className="text-[16px] leading-[1.7] text-[#1A120B]" style={{ fontFamily: "'Caveat', cursive" }}>
                            {active.status === "lu"
                              ? "Lu avec attention. Les passages sur le craft résonnent."
                              : "À découvrir. Laisse-toi surprendre."}
                          </p>
                          <div className="mt-8 text-[12px] text-[#6B5A4A]" style={{ fontFamily: "system-ui" }}>
                            {active.page_count ? `${active.page_count} pages` : ""}
                          </div>
                        </div>
                      ) : (
                        <div className="h-full flex flex-col justify-between">
                          <div>
                            <div className="text-[11px] uppercase tracking-widest text-[#6B5A4A] mb-3" style={{ fontFamily: "system-ui" }}>Détails</div>
                            <div className="text-[15px] text-[#1A120B] space-y-2" style={{ fontFamily: "system-ui" }}>
                              <div><span className="text-[#6B5A4A]">Auteur</span> • {active.author}</div>
                              <div><span className="text-[#6B5A4A]">Statut</span> • {active.status === "lu" ? "Lu" : "Suggéré"}</div>
                            </div>
                          </div>
                          <button onClick={closeBook} className="mt-6 w-full py-3 rounded-[10px] bg-[#1A120B] text-[#F5EFE6] text-[14px] font-medium active:scale-[0.98] transition" style={{ fontFamily: "system-ui" }}>
                            Reposer
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Spine shadow */}
                <div className="absolute left-1/2 top-0 bottom-0 w-[2px] -translate-x-1/2 bg-black/10" />
              </div>

              {/* Page turn hint */}
              <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 flex gap-3">
                {[0,1].map(i => (
                  <button key={i} onClick={() => setPage(i)} className={`h-2 rounded-full transition-all ${page===i ? "w-8 bg-[#E2C799]" : "w-2 bg-white/30"}`} aria-label={`Page ${i+1}`} />
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add-a-book workbench */}
      {!active && <AddBookButton onOpen={() => setAddOpen(true)} />}
      {addOpen && <AddBookModal onClose={() => setAddOpen(false)} />}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,300;6..72,400;6..72,500&family=Caveat:wght@400;500&display=swap');
        * { -webkit-tap-highlight-color: transparent; }
      `}</style>
    </div>
  );
}
