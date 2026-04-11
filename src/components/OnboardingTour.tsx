// src/components/OnboardingTour.tsx
import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

export const STORAGE_KEY = "liquido_tour_v1";
const TOOLTIP_W = 280;
const MARGIN = 12;

interface TourStep {
  id: string;
  target: string | null;
  title: string;
  description: string;
  placement: "top" | "bottom" | "left" | "right" | "center";
  icon: string;
}

const STEPS: TourStep[] = [
  {
    id: "welcome", target: null, placement: "center", icon: "💧",
    title: "Esploriamo Liquidò!",
    description: "Ti mostriamo dove si trova tutto. Meno di 2 minuti — puoi saltarlo quando vuoi.",
  },
  {
    id: "dashboard", target: "a[href='/dashboard']", placement: "right", icon: "📊",
    title: "Dashboard",
    description: "La tua centrale di controllo. Saldo Totale, Accantonamento Fiscale (IVA+IRPEF+INPS) e Liquidità Reale del mese.",
  },
  {
    id: "conti", target: "a[href='/accounts']", placement: "right", icon: "🏦",
    title: "Conti",
    description: "Gestisci i tuoi conti bancari, PayPal, Stripe o contanti. Il saldo iniziale è fondamentale per il calcolo corretto.",
  },
  {
    id: "transazioni", target: "a[href='/transactions']", placement: "right", icon: "💸",
    title: "Transazioni",
    description: "Tutte le tue entrate e uscite. Aggiungile manualmente o importale da CSV. Le fatture vengono auto-categorizzate.",
  },
  {
    id: "import", target: "a[href='/import']", placement: "right", icon: "📂",
    title: "Importa CSV",
    description: "Carica l'estratto conto della tua banca. Dopo l'import vedi subito il breakdown IVA/IRPEF/INPS.",
  },
  {
    id: "budget", target: "a[href='/budgets']", placement: "right", icon: "🎯",
    title: "Budget",
    description: "Imposta un limite di spesa per categoria. Ricevi un alert quando stai per sforare.",
  },
  {
    id: "report", target: "a[href='/reports']", placement: "right", icon: "📈",
    title: "Report",
    description: "Scarica il report PDF mensile con entrate, uscite e accantonamento fiscale. Utile per il commercialista.",
  },
  {
    id: "impostazioni", target: "a[href='/settings']", placement: "right", icon: "⚙️",
    title: "Impostazioni",
    description: "Modifica regime fiscale e aliquote IVA/IRPEF/INPS. Tutto si aggiorna automaticamente.",
  },
  {
    id: "done", target: null, placement: "center", icon: "🎉",
    title: "Sei pronto!",
    description: "Inizia importando un CSV o aggiungendo le prime transazioni. Buona liquidità! 💧",
  },
];

function findTarget(selector: string | null): Element | null {
  if (!selector) return null;
  for (const sel of selector.split(",").map((s) => s.trim())) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch { /* skip */ }
  }
  return null;
}

function getPos(el: Element | null, placement: TourStep["placement"]) {
  const vw = window.innerWidth, vh = window.innerHeight, H = 200;
  if (!el || placement === "center") {
    return { top: vh / 2 - H / 2, left: vw / 2 - TOOLTIP_W / 2, arrow: "none" as const };
  }
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  let top = 0, left = 0, arrow: "top"|"bottom"|"left"|"right" = "top";

  if (placement === "right")  { top = cy - H/2;          left = r.right + MARGIN + 8;        arrow = "left"; }
  if (placement === "left")   { top = cy - H/2;          left = r.left - TOOLTIP_W - MARGIN; arrow = "right"; }
  if (placement === "bottom") { top = r.bottom + MARGIN;  left = cx - TOOLTIP_W/2;            arrow = "top"; }
  if (placement === "top")    { top = r.top - H - MARGIN; left = cx - TOOLTIP_W/2;            arrow = "bottom"; }

  left = Math.max(MARGIN, Math.min(left, vw - TOOLTIP_W - MARGIN));
  top  = Math.max(MARGIN, Math.min(top,  vh - H - MARGIN));
  return { top, left, arrow };
}

function Spotlight({ target, onNext }: { target: Element | null; onNext: () => void }) {
  if (!target) return <div className="fixed inset-0 bg-black/60 z-[9990] cursor-pointer" onClick={onNext} aria-hidden="true" />;
  const r = target.getBoundingClientRect();
  const pad = 6, x = r.left-pad, y = r.top-pad, w = r.width+pad*2, h = r.height+pad*2;
  return (
    <svg className="fixed inset-0 z-[9990] pointer-events-none" style={{width:"100vw",height:"100vh"}} aria-hidden="true">
      <defs><mask id="tm"><rect width="100%" height="100%" fill="white"/><rect x={x} y={y} width={w} height={h} rx="8" fill="black"/></mask></defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,0.65)" mask="url(#tm)" className="pointer-events-auto cursor-pointer" onClick={onNext}/>
      <rect x={x} y={y} width={w} height={h} rx="8" fill="none" stroke="rgba(52,211,153,0.9)" strokeWidth="2"/>
    </svg>
  );
}

function PulseRing({ target }: { target: Element | null }) {
  if (!target) return null;
  const r = target.getBoundingClientRect(), pad = 5;
  return (
    <>
      <style>{`@keyframes lqp{0%,100%{box-shadow:0 0 0 0 rgba(52,211,153,.5)}50%{box-shadow:0 0 0 7px rgba(52,211,153,0)}}`}</style>
      <div className="fixed pointer-events-none rounded-lg z-[9991]" style={{top:r.top-pad,left:r.left-pad,width:r.width+pad*2,height:r.height+pad*2,animation:"lqp 1.6s ease-in-out infinite"}}/>
    </>
  );
}

function Card({ step, index, total, pos, onNext, onBack, onSkip }: {
  step: TourStep; index: number; total: number;
  pos: ReturnType<typeof getPos>;
  onNext: () => void; onBack: () => void; onSkip: () => void;
}) {
  const isFirst = index === 0, isLast = index === total - 1;
  const isCenter = step.placement === "center";
  const arrowCss: Record<string, React.CSSProperties> = {
    top:    {top:-7,   left:"50%", transform:"translateX(-50%) rotate(45deg)"},
    bottom: {bottom:-7,left:"50%", transform:"translateX(-50%) rotate(45deg)"},
    left:   {left:-7,  top:"50%",  transform:"translateY(-50%) rotate(45deg)"},
    right:  {right:-7, top:"50%",  transform:"translateY(-50%) rotate(45deg)"},
    none:   {display:"none"},
  };
  return (
    <div className="fixed z-[9999]" style={{top:pos.top,left:pos.left,width:TOOLTIP_W}}>
      {!isCenter && <div className="absolute w-3.5 h-3.5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700" style={arrowCss[pos.arrow]}/>}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl overflow-hidden">
        <div className="h-1 bg-gradient-to-r from-emerald-400 to-teal-500"/>
        <div className="p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-lg">{step.icon}</span>
            {!isCenter && <span className="text-[11px] text-zinc-400 tabular-nums">{index+1} / {total}</span>}
          </div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 mb-1.5">{step.title}</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed mb-3">{step.description}</p>
          {total > 2 && (
            <div className="flex items-center gap-1 mb-3">
              {Array.from({length:total}).map((_,i) => (
                <div key={i} className={`rounded-full transition-all duration-300 ${i===index?"w-4 h-1.5 bg-emerald-500":i<index?"w-1.5 h-1.5 bg-emerald-300 dark:bg-emerald-700":"w-1.5 h-1.5 bg-zinc-200 dark:bg-zinc-700"}`}/>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            {!isFirst && <button onClick={onBack} className="px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg">← Indietro</button>}
            <div className="flex-1"/>
            {!isLast && <button onClick={onSkip} className="text-[11px] text-zinc-400 hover:text-zinc-600 px-1">Salta</button>}
            <button onClick={onNext} className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-500 hover:bg-emerald-600 active:scale-95 rounded-xl transition-all">
              {isLast?"Inizia!":isFirst?"Inizia il tour →":"Avanti →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface OnboardingTourProps { forceOpen?: boolean; onClose?: () => void; }

export function OnboardingTour({ forceOpen = false, onClose }: OnboardingTourProps) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const [pos, setPos] = useState<ReturnType<typeof getPos>>({top:0,left:0,arrow:"none"});
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const done = localStorage.getItem(STORAGE_KEY);
    if (!done || forceOpen) {
      const t = setTimeout(() => setActive(true), 700);
      return () => clearTimeout(t);
    }
  }, [forceOpen]);

  const recalc = useCallback(() => {
    const step = STEPS[index];
    const el = findTarget(step.target);
    setPos(getPos(el, step.placement));
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [index]);

  useEffect(() => {
    if (!active) return;
    recalc();
    const onResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recalc);
    };
    window.addEventListener("resize", onResize);
    return () => { window.removeEventListener("resize", onResize); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [active, recalc]);

  const finish = useCallback(() => { localStorage.setItem(STORAGE_KEY, "true"); setActive(false); onClose?.(); }, [onClose]);
  const next = useCallback(() => { if (index >= STEPS.length-1) finish(); else setIndex((i) => i+1); }, [index, finish]);
  const back = useCallback(() => setIndex((i) => Math.max(0, i-1)), []);

  if (!active) return null;
  const step = STEPS[index];
  const targetEl = findTarget(step.target);

  return createPortal(
    <>
      <Spotlight target={targetEl} onNext={next}/>
      {targetEl && <PulseRing target={targetEl}/>}
      <Card step={step} index={index} total={STEPS.length} pos={pos} onNext={next} onBack={back} onSkip={finish}/>
    </>,
    document.body
  );
}

export function RestartTourButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => { localStorage.removeItem(STORAGE_KEY); setOpen(true); }}
        className={className ?? "flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors w-full"}
      >
        <span className="text-sm">💧</span>
        Tour guidato
      </button>
      {open && <OnboardingTour forceOpen onClose={() => setOpen(false)}/>}
    </>
  );
}

export default OnboardingTour;