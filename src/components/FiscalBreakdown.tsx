// src/components/FiscalBreakdown.tsx
//
// Componente riutilizzabile: mostra il breakdown IVA / IRPEF / INPS
// dell'accantonamento fiscale con barra proporzionale.
//
// Usato in: ImportCsv.tsx (post-import), Dashboard.tsx (card accantonamento)

import { formatCurrency } from "@/lib/format";
import { ShieldAlert, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface TaxBreakdown {
  f_iva: number;
  f_irpef: number;
  f_inps: number;
  alpha_iva: number | null;
  alpha_irpef: number | null;
  alpha_inps: number | null;
}

interface FiscalBreakdownProps {
  /** Saldo totale (bt) — usato per calcolare % sul totale */
  totalBalance: number;
  /** Entrate imponibili (e_tax) */
  taxableIncome: number;
  /** Accantonamento totale (f) */
  totalProvision: number;
  /** Liquidità reale (lr) */
  liquidita: number;
  /** Breakdown analitico */
  breakdown: TaxBreakdown;
  /** Variante compatta (per Dashboard) o estesa (per ImportCsv) */
  variant?: "compact" | "full";
}

const ITEMS = [
  {
    key: "f_iva" as const,
    alphaKey: "alpha_iva" as const,
    label: "IVA",
    sublabel: "Imposta sul valore aggiunto",
    color: "bg-blue-500",
    textColor: "text-blue-600 dark:text-blue-400",
    bgColor: "bg-blue-50 dark:bg-blue-950/40",
    borderColor: "border-blue-200 dark:border-blue-800",
    icon: "🧾",
  },
  {
    key: "f_irpef" as const,
    alphaKey: "alpha_irpef" as const,
    label: "IRPEF",
    sublabel: "Imposta sul reddito",
    color: "bg-amber-500",
    textColor: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/40",
    borderColor: "border-amber-200 dark:border-amber-800",
    icon: "📊",
  },
  {
    key: "f_inps" as const,
    alphaKey: "alpha_inps" as const,
    label: "INPS",
    sublabel: "Contributi previdenziali",
    color: "bg-violet-500",
    textColor: "text-violet-600 dark:text-violet-400",
    bgColor: "bg-violet-50 dark:bg-violet-950/40",
    borderColor: "border-violet-200 dark:border-violet-800",
    icon: "🛡️",
  },
];

function pct(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

function formatPct(alpha: number | null): string {
  if (alpha === null) return "—";
  return `${Math.round(alpha * 100)}%`;
}

export function FiscalBreakdown({
  totalBalance,
  taxableIncome,
  totalProvision,
  liquidita,
  breakdown,
  variant = "full",
}: FiscalBreakdownProps) {
  const hasBreakdown =
    breakdown.f_iva > 0 || breakdown.f_irpef > 0 || breakdown.f_inps > 0;

  // Barra proporzionale: LR + IVA + IRPEF + INPS = bt (se bt > 0)
  const barTotal = Math.max(totalBalance, totalProvision + Math.max(liquidita, 0));

  return (
    <Card className="border-[hsl(var(--warning))]/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[hsl(var(--warning))]" />
          Breakdown accantonamento fiscale
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-[220px] text-xs">
                Calcolato sulle entrate imponibili ({formatCurrency(taxableIncome)}).
                Configura le aliquote in Impostazioni.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Barra proporzionale */}
        {barTotal > 0 && (
          <div className="space-y-1.5">
            <div className="flex h-3 rounded-full overflow-hidden gap-px">
              {/* Liquidità Reale */}
              <div
                className="bg-emerald-500 transition-all duration-500"
                style={{ width: `${pct(Math.max(liquidita, 0), barTotal)}%` }}
              />
              {/* IVA */}
              <div
                className="bg-blue-500 transition-all duration-500"
                style={{ width: `${pct(breakdown.f_iva, barTotal)}%` }}
              />
              {/* IRPEF */}
              <div
                className="bg-amber-500 transition-all duration-500"
                style={{ width: `${pct(breakdown.f_irpef, barTotal)}%` }}
              />
              {/* INPS */}
              <div
                className="bg-violet-500 transition-all duration-500"
                style={{ width: `${pct(breakdown.f_inps, barTotal)}%` }}
              />
            </div>
            <div className="flex items-center gap-3 flex-wrap text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                Liquidità reale
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                IVA
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />
                IRPEF
              </span>
              <span className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full bg-violet-500" />
                INPS
              </span>
            </div>
          </div>
        )}

        {/* Righe dettaglio */}
        <div className={`grid gap-2 ${variant === "compact" ? "grid-cols-3" : "grid-cols-1 sm:grid-cols-3"}`}>
          {ITEMS.map((item) => {
            const amount = breakdown[item.key];
            const alpha = breakdown[item.alphaKey];
            const perc = pct(amount, barTotal);

            return (
              <div
                key={item.key}
                className={`rounded-lg border p-3 ${item.bgColor} ${item.borderColor}`}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-sm">{item.icon}</span>
                  <span className={`text-xs font-semibold ${item.textColor}`}>
                    {item.label}
                  </span>
                  {alpha !== null && (
                    <span className={`ml-auto text-[10px] font-medium ${item.textColor} opacity-70`}>
                      {formatPct(alpha)}
                    </span>
                  )}
                </div>
                <p className={`text-lg font-bold tabular-nums ${item.textColor}`}>
                  {formatCurrency(amount)}
                </p>
                {variant === "full" && (
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {perc}% del totale
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Totale accantonamento */}
        {variant === "full" && (
          <div className="flex items-center justify-between pt-2 border-t border-border text-sm">
            <span className="text-muted-foreground font-medium">Totale accantonato</span>
            <span className="font-bold tabular-nums text-[hsl(var(--warning))]">
              {formatCurrency(totalProvision)}
            </span>
          </div>
        )}

        {/* Liquidità reale risultante */}
        <div className={`flex items-center justify-between rounded-lg px-3 py-2.5 ${
          liquidita >= 0
            ? "bg-[hsl(var(--success))]/10 border border-[hsl(var(--success))]/30"
            : "bg-destructive/10 border border-destructive/30"
        }`}>
          <span className="text-sm font-medium">
            💧 Liquidità Reale
          </span>
          <span className={`text-base font-bold tabular-nums ${
            liquidita >= 0 ? "text-[hsl(var(--success))]" : "text-destructive"
          }`}>
            {formatCurrency(liquidita)}
          </span>
        </div>

        {/* Warning aliquote non configurate */}
        {!hasBreakdown && totalProvision > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Configura le aliquote IVA, IRPEF e INPS in{" "}
            <a href="/settings" className="underline hover:text-foreground">
              Impostazioni
            </a>{" "}
            per vedere il breakdown dettagliato.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
