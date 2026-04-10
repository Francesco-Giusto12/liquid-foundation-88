import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TourStep {
  id: string;
  target: string | null; // CSS selector – null = centered modal
  title: string;
  description: string;
  placement?: "top" | "bottom" | "left" | "right" | "center";
  icon?: string;
  highlight?: boolean; // pulse ring on target
}

interface TooltipPosition {
  top: number;
  left: number;
  arrowSide: "top" | "bottom" | "left" | "right" | "none";
}

// ─── Tour Steps ───────────────────────────────────────────────────────────────

const TOUR_STEPS: TourStep[] = [
  {
    id: "welcome",
    target: null,
    placement: "center",
    icon: "💧",
    title: "Benvenuto in Liquidò!",
    description:
      "Liquidò calcola la tua vera liquidità disponibile, deducendo automaticamente IVA, IRPEF e contributi INPS. In 60 secondi ti mostriamo come funziona tutto.",
  },
  {
    id: "sidebar-nav",
    target: "[data-tour='sidebar'], nav, aside, [class*='sidebar']",
    placement: "right",
    icon: "🧭",
    title: "Navigazione principale",
    description:
      "Da qui accedi a tutte le sezioni: Dashboard, Transazioni, Conti, Accantonamenti e Impostazioni. La barra è sempre visibile per passare rapidamente da una sezione all'altra.",
    highlight: true,
  },
  {
    id: "liquidita-reale",
    target:
      "[data-tour='liquidita-reale'], [class*='liquidita'], [class*='real-liquidity'], [class*='liquid']",
    placement: "bottom",
    icon: "✨",
    title: "Liquidità Reale — il cuore di Liquidò",
    description:
      "Questo è il numero più importante: la tua liquidità dopo aver accantonato tutto il dovuto. Formula: LR = Saldo Totale − (IVA + IRPEF + INPS). Non ti ritroverai mai più a corto di soldi a marzo.",
    highlight: true,
  },
  {
    id: "saldo-corrente",
    target:
      "[data-tour='saldo-corrente'], [class*='saldo-corrente'], [class*='current-balance']",
    placement: "bottom",
    icon: "🏦",
    title: "Saldo Corrente",
    description:
      "Il totale dei movimenti registrati nei tuoi conti. Qui vedi esattamente quanto hai in questo momento, aggregato su tutti i conti che hai collegato.",
    highlight: true,
  },
  {
    id: "saldo-totale",
    target:
      "[data-tour='saldo-totale'], [class*='saldo-totale'], [class*='total-balance']",
    placement: "bottom",
    icon: "💰",
    title: "Saldo Totale (con saldi iniziali)",
    description:
      "Include i saldi iniziali dei conti più tutti i movimenti registrati. Questo è il valore reale su cui vengono calcolati gli accantonamenti fiscali.",
    highlight: true,
  },
  {
    id: "iva-section",
    target:
      "[data-tour='iva'], [class*='iva'], [class*='vat'], [href*='iva'], [href*='vat']",
    placement: "right",
    icon: "🧾",
    title: "Accantonamento IVA",
    description:
      "Liquidò calcola automaticamente la quota IVA da accantonare su ogni incasso. Puoi impostare il regime (forfettario, ordinario) e la percentuale nella sezione Impostazioni fiscali.",
    highlight: true,
  },
  {
    id: "irpef-section",
    target:
      "[data-tour='irpef'], [class*='irpef'], [class*='income-tax'], [href*='irpef']",
    placement: "right",
    icon: "📊",
    title: "Accantonamento IRPEF",
    description:
      "L'imposta sul reddito viene stimata in tempo reale sul tuo fatturato progressivo. Così eviti la sorpresa del conguaglio di giugno e novembre.",
    highlight: true,
  },
  {
    id: "inps-section",
    target:
      "[data-tour='inps'], [class*='inps'], [class*='contributions'], [href*='inps']",
    placement: "right",
    icon: "🛡️",
    title: "Contributi INPS",
    description:
      "I contributi previdenziali accantonati mese per mese. Liquidò usa le aliquote aggiornate per gestione separata o artigiani/commercianti in base al tuo profilo.",
    highlight: true,
  },
  {
    id: "transactions",
    target:
      "[data-tour='transactions'], [class*='transaction'], [href*='transaction'], [href*='moviment']",
    placement: "top",
    icon: "💸",
    title: "Transazioni",
    description:
      "Registra entrate e uscite manualmente o collegando i tuoi conti. Ogni transazione viene categorizzata automaticamente per alimentare i calcoli fiscali. Ricorda di associare ogni movimento al conto corretto.",
    highlight: true,
  },
  {
    id: "accounts",
    target:
      "[data-tour='accounts'], [class*='account'], [href*='account'], [href*='conti']",
    placement: "top",
    icon: "🏛️",
    title: "Conti bancari",
    description:
      "Aggiungi tutti i tuoi conti (corrente, PayPal, Stripe, contanti). Imposta il saldo iniziale di ciascuno per partire con i dati corretti — è fondamentale per il calcolo del Saldo Totale.",
    highlight: true,
  },
  {
    id: "settings",
    target:
      "[data-tour='settings'], [class*='setting'], [href*='setting'], [href*='impostaz']",
    placement: "left",
    icon: "⚙️",
    title: "Impostazioni fiscali",
    description:
      "Qui configuri il tuo regime fiscale, le aliquote INPS, la percentuale IVA e i tuoi dati da partita IVA. Fallo una volta sola e Liquidò calcolerà tutto in automatico.",
    highlight: true,
  },
  {
    id: "done",
    target: null,
    placement: "center",
    icon: "🎉",
    title: "Sei pronto a partire!",
    description:
      "Inizia aggiungendo i tuoi conti con i saldi iniziali, poi registra le prime transazioni. Liquidò farà il resto. Puoi rivedere questo tour in qualsiasi momento dal menu Aiuto.",
  },
];

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = "liquido_tour_completed_v1";
const TOOLTIP_W = 320;
const TOOLTIP_H_EST = 200; // estimated height for positioning
const MARGIN = 16;

// ─── Helper: find element by multiple selectors ───────────────────────────────

function findTarget(selector: string | null): Element | null {
  if (!selector) return null;
  const parts = selector.split(",").map((s) => s.trim());
  for (const sel of parts) {
    try {
      const el = document.querySelector(sel);
      if (el) return el;
    } catch {
      // invalid selector – skip
    }
  }
  return null;
}

// ─── Helper: compute tooltip position ────────────────────────────────────────

function computePosition(
  el: Element | null,
  placement: TourStep["placement"]
): TooltipPosition {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!el || placement === "center") {
    return {
      top: vh / 2 - TOOLTIP_H_EST / 2,
      left: vw / 2 - TOOLTIP_W / 2,
      arrowSide: "none",
    };
  }

  const rect = el.getBoundingClientRect();
  let top = 0;
  let left = 0;
  let arrowSide: TooltipPosition["arrowSide"] = "top";

  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;

  switch (placement) {
    case "bottom":
      top = rect.bottom + MARGIN;
      left = cx - TOOLTIP_W / 2;
      arrowSide = "top";
      break;
    case "top":
      top = rect.top - TOOLTIP_H_EST - MARGIN;
      left = cx - TOOLTIP_W / 2;
      arrowSide = "bottom";
      break;
    case "right":
      top = cy - TOOLTIP_H_EST / 2;
      left = rect.right + MARGIN;
      arrowSide = "left";
      break;
    case "left":
      top = cy - TOOLTIP_H_EST / 2;
      left = rect.left - TOOLTIP_W - MARGIN;
      arrowSide = "right";
      break;
    default:
      top = rect.bottom + MARGIN;
      left = cx - TOOLTIP_W / 2;
      arrowSide = "top";
  }

  // Clamp to viewport
  left = Math.max(MARGIN, Math.min(left, vw - TOOLTIP_W - MARGIN));
  top = Math.max(MARGIN, Math.min(top, vh - TOOLTIP_H_EST - MARGIN));

  return { top, left, arrowSide };
}

// ─── Spotlight Overlay ────────────────────────────────────────────────────────

interface SpotlightProps {
  target: Element | null;
  onClick: () => void;
}

function Spotlight({ target, onClick }: SpotlightProps) {
  if (!target) {
    return (
      <div
        className="fixed inset-0 bg-black/60 z-[9998]"
        onClick={onClick}
        aria-hidden="true"
      />
    );
  }

  const rect = target.getBoundingClientRect();
  const pad = 8;
  const x = rect.left - pad;
  const y = rect.top - pad;
  const w = rect.width + pad * 2;
  const h = rect.height + pad * 2;
  const r = 12;

  return (
    <svg
      className="fixed inset-0 z-[9998] pointer-events-none"
      style={{ width: "100vw", height: "100vh" }}
      aria-hidden="true"
    >
      <defs>
        <mask id="spotlight-mask">
          <rect width="100%" height="100%" fill="white" />
          <rect x={x} y={y} width={w} height={h} rx={r} fill="black" />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,0.65)"
        mask="url(#spotlight-mask)"
        className="pointer-events-auto cursor-pointer"
        onClick={onClick}
      />
      {/* Highlight border */}
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={r}
        fill="none"
        stroke="rgba(99,210,175,0.8)"
        strokeWidth="2"
      />
    </svg>
  );
}

// ─── Tooltip Card ─────────────────────────────────────────────────────────────

interface TooltipCardProps {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  position: TooltipPosition;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

function TooltipCard({
  step,
  stepIndex,
  totalSteps,
  position,
  onNext,
  onBack,
  onSkip,
}: TooltipCardProps) {
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === totalSteps - 1;
  const isCenter = step.placement === "center" || !step.target;

  const arrowStyles: Record<string, React.CSSProperties> = {
    top: {
      top: -8,
      left: "50%",
      transform: "translateX(-50%) rotate(45deg)",
    },
    bottom: {
      bottom: -8,
      left: "50%",
      transform: "translateX(-50%) rotate(45deg)",
    },
    left: {
      left: -8,
      top: "50%",
      transform: "translateY(-50%) rotate(45deg)",
    },
    right: {
      right: -8,
      top: "50%",
      transform: "translateY(-50%) rotate(45deg)",
    },
    none: { display: "none" },
  };

  return (
    <div
      className="fixed z-[9999] animate-in fade-in zoom-in-95 duration-200"
      style={{
        top: position.top,
        left: position.left,
        width: TOOLTIP_W,
      }}
    >
      {/* Arrow */}
      {position.arrowSide !== "none" && !isCenter && (
        <div
          className="absolute w-4 h-4 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700"
          style={arrowStyles[position.arrowSide]}
        />
      )}

      {/* Card */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl overflow-hidden">
        {/* Top accent */}
        <div className="h-1 bg-gradient-to-r from-emerald-400 via-teal-500 to-emerald-600" />

        <div className="p-5">
          {/* Icon + step count */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-2xl leading-none">{step.icon}</span>
            {!isCenter && (
              <span className="text-xs font-medium text-zinc-400 dark:text-zinc-500 tabular-nums">
                {stepIndex + 1} / {totalSteps}
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100 mb-2 leading-snug">
            {step.title}
          </h3>

          {/* Description */}
          <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed mb-5">
            {step.description}
          </p>

          {/* Progress dots */}
          {totalSteps > 2 && (
            <div className="flex items-center gap-1.5 mb-4">
              {Array.from({ length: totalSteps }).map((_, i) => (
                <div
                  key={i}
                  className={`rounded-full transition-all duration-300 ${
                    i === stepIndex
                      ? "w-4 h-1.5 bg-emerald-500"
                      : i < stepIndex
                      ? "w-1.5 h-1.5 bg-emerald-300 dark:bg-emerald-700"
                      : "w-1.5 h-1.5 bg-zinc-200 dark:bg-zinc-700"
                  }`}
                />
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={onBack}
                className="px-3 py-2 text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
              >
                ← Indietro
              </button>
            )}

            <div className="flex-1" />

            {!isLast && (
              <button
                onClick={onSkip}
                className="px-3 py-2 text-xs text-zinc-400 dark:text-zinc-500 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
              >
                Salta
              </button>
            )}

            <button
              onClick={onNext}
              className="px-4 py-2 text-sm font-medium text-white bg-emerald-500 hover:bg-emerald-600 active:scale-95 rounded-xl transition-all duration-150"
            >
              {isLast ? "Inizia!" : isFirst ? "Inizia il tour →" : "Avanti →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Pulse Ring (highlight effect) ───────────────────────────────────────────

function PulseRing({ target }: { target: Element | null }) {
  if (!target) return null;
  const rect = target.getBoundingClientRect();
  const pad = 6;

  return (
    <div
      className="fixed z-[9999] pointer-events-none rounded-xl"
      style={{
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
        boxShadow: "0 0 0 3px rgba(16,185,129,0.6)",
        animation: "liquido-pulse 1.5s ease-in-out infinite",
      }}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

interface OnboardingTourProps {
  /** Forza l'apertura del tour (utile dal pulsante Aiuto) */
  forceOpen?: boolean;
  onClose?: () => void;
}

export function OnboardingTour({ forceOpen = false, onClose }: OnboardingTourProps) {
  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [positions, setPositions] = useState<Record<number, TooltipPosition>>(
    {}
  );
  const rafRef = useRef<number | null>(null);

  // Decide se mostrare il tour al mount
  useEffect(() => {
    const completed = localStorage.getItem(STORAGE_KEY);
    if (!completed || forceOpen) {
      // Piccolo delay per aspettare che la UI sia renderizzata
      const t = setTimeout(() => setActive(true), 600);
      return () => clearTimeout(t);
    }
  }, [forceOpen]);

  // Calcola posizione tooltip per lo step corrente
  const recalcPosition = useCallback(() => {
    const step = TOUR_STEPS[stepIndex];
    if (!step) return;
    const el = findTarget(step.target ?? null);
    const pos = computePosition(el, step.placement);
    setPositions((prev) => ({ ...prev, [stepIndex]: pos }));

    // Scroll to target if off-screen
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [stepIndex]);

  useEffect(() => {
    if (!active) return;
    recalcPosition();

    const handleResize = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(recalcPosition);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [active, recalcPosition]);

  const completeTour = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, "true");
    setActive(false);
    onClose?.();
  }, [onClose]);

  const handleNext = useCallback(() => {
    if (stepIndex >= TOUR_STEPS.length - 1) {
      completeTour();
    } else {
      setStepIndex((i) => i + 1);
    }
  }, [stepIndex, completeTour]);

  const handleBack = useCallback(() => {
    setStepIndex((i) => Math.max(0, i - 1));
  }, []);

  if (!active) return null;

  const step = TOUR_STEPS[stepIndex];
  const targetEl = findTarget(step.target ?? null);
  const position = positions[stepIndex] ?? computePosition(targetEl, step.placement);

  return createPortal(
    <>
      {/* Inline keyframes */}
      <style>{`
        @keyframes liquido-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(16,185,129,0.6); }
          50%       { box-shadow: 0 0 0 6px rgba(16,185,129,0.2); }
        }
      `}</style>

      {/* Overlay / Spotlight */}
      <Spotlight target={targetEl} onClick={handleNext} />

      {/* Pulse ring on target */}
      {targetEl && step.highlight && <PulseRing target={targetEl} />}

      {/* Tooltip card */}
      <TooltipCard
        step={step}
        stepIndex={stepIndex}
        totalSteps={TOUR_STEPS.length}
        position={position}
        onNext={handleNext}
        onBack={handleBack}
        onSkip={completeTour}
      />
    </>,
    document.body
  );
}

// ─── Re-launch button (da inserire nell'header/menu aiuto) ────────────────────

export function RestartTourButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);

  const handleStart = () => {
    localStorage.removeItem(STORAGE_KEY);
    setOpen(true);
  };

  return (
    <>
      <button
        onClick={handleStart}
        className={
          className ??
          "flex items-center gap-2 px-3 py-2 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg transition-colors"
        }
      >
        <span className="text-base">💧</span>
        Tour guidato
      </button>
      {open && (
        <OnboardingTour
          forceOpen
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

export default OnboardingTour;
