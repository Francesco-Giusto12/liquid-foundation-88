// supabase/functions/calculate-liquidity/index.ts
//
// Edge Function: Calcolo Liquidità Reale con breakdown IVA / IRPEF / INPS
//

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Tipi ─────────────────────────────────────────────────────

interface TaxBreakdown {
  f_iva: number;    // quota IVA accantonata
  f_irpef: number;  // quota IRPEF accantonata
  f_inps: number;   // quota INPS accantonata
  alpha_iva: number | null;   // aliquota IVA configurata (es. 0.22)
  alpha_irpef: number | null; // aliquota IRPEF configurata (es. 0.15)
  alpha_inps: number | null;  // aliquota INPS configurata (es. 0.26)
}

interface LiquidityResult {
  period_start: string;
  b0: number;
  bt: number;
  e_total: number;
  u_total: number;
  e_tax: number;
  e_uncat: number;
  f: number;                // accantonamento totale = f_iva + f_irpef + f_inps
  lr: number;
  alpha: number | null;     // aliquota totale legacy (mantenuta per compatibilità)
  regime_key: string | null;
  lr_negative: boolean;
  has_uncategorized: boolean;
  uncat_count: number;
  quality_warning: boolean;
  // NUOVO: breakdown fiscale
  breakdown: TaxBreakdown;
}

// ── Handler principale ────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse(401, "Missing authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claimsData, error: authError } = await supabase.auth.getClaims(token);
    if (authError || !claimsData?.claims) return errorResponse(401, "Unauthorized");
    const user = { id: claimsData.claims.sub as string };

    const body = await req.json().catch(() => ({}));
    const { period_start } = body;

    if (!period_start || !isValidDateString(period_start)) {
      return errorResponse(400, "Invalid period_start. Expected ISO date (YYYY-MM-DD)");
    }

    const periodDate = new Date(period_start);
    const normalizedPeriod = new Date(
      periodDate.getFullYear(), periodDate.getMonth(), 1
    ).toISOString().slice(0, 10);
    const periodEnd = new Date(
      periodDate.getFullYear(), periodDate.getMonth() + 1, 0
    ).toISOString().slice(0, 10);

    // ── Saldo iniziale ─────────────────────────────────────
    const { data: b0Data } = await supabase.rpc(
      "get_period_balance_start",
      { p_user_id: user.id, p_period_start: normalizedPeriod }
    );
    const b0: number = b0Data ?? 0;

    // ── Saldo conti ────────────────────────────────────────
    const { data: accountsData } = await supabase
      .from("accounts")
      .select("balance")
      .eq("user_id", user.id)
      .eq("is_active", true);
    const accountsBalance = (accountsData ?? []).reduce(
      (sum: number, acc: any) => sum + Number(acc.balance), 0
    );

    // ── Transazioni ────────────────────────────────────────
    const { data: transactions, error: txError } = await supabase
      .from("transactions")
      .select("amount, is_categorized, is_imponibile, category_id")
      .eq("user_id", user.id)
      .gte("date", normalizedPeriod)
      .lte("date", periodEnd);
    if (txError) return errorResponse(500, "Error fetching transactions");

    const txList = transactions ?? [];
    let e_total = 0, u_total = 0, e_tax = 0, e_uncat = 0, uncat_count = 0;

    for (const tx of txList) {
      const amount = Number(tx.amount);
      if (amount > 0) {
        e_total += amount;
        if (!tx.is_categorized) { e_uncat += amount; uncat_count++; }
        else if (tx.is_imponibile) { e_tax += amount; }
      } else {
        u_total += Math.abs(amount);
      }
    }

    e_total = round2(e_total);
    u_total = round2(u_total);
    e_tax   = round2(e_tax);
    e_uncat = round2(e_uncat);
    const bt = round2(accountsBalance + e_total - u_total);

    // ── Aliquota regime legacy ─────────────────────────────
    const { data: alphaData } = await supabase.rpc(
      "get_aliquota_for_period",
      { p_user_id: user.id, p_period_start: normalizedPeriod }
    );
    const alpha: number | null = alphaData !== null ? Number(alphaData) : null;

    let regime_key: string | null = null;
    if (alpha !== null) {
      const { data: regimeData } = await supabase
        .from("tax_regime_history")
        .select("regime_key")
        .eq("user_id", user.id)
        .lte("valid_from", normalizedPeriod)
        .or(`valid_to.is.null,valid_to.gte.${normalizedPeriod}`)
        .order("valid_from", { ascending: false })
        .limit(1)
        .single();
      regime_key = regimeData?.regime_key ?? null;
    }

    // ── Aliquote IVA / IRPEF / INPS dal profilo ────────────
    // Lette dalla tabella tax_rates (nuova) o dal profilo se presente.
    // Fallback: se non configurate, distribuzione proporzionale di alpha.
    let alpha_iva: number | null = null;
    let alpha_irpef: number | null = null;
    let alpha_inps: number | null = null;

    const { data: taxRates } = await supabase
      .from("tax_rates")
      .select("iva, irpef, inps")
      .eq("user_id", user.id)
      .single();

    if (taxRates) {
      alpha_iva   = taxRates.iva   !== null ? Number(taxRates.iva)   : null;
      alpha_irpef = taxRates.irpef !== null ? Number(taxRates.irpef) : null;
      alpha_inps  = taxRates.inps  !== null ? Number(taxRates.inps)  : null;
    }

    // ── Calcolo breakdown ──────────────────────────────────
    // Se le aliquote analitiche sono configurate, le usiamo direttamente.
    // Altrimenti, se c'è alpha legacy, usiamo proporzioni standard.
    let f_iva   = 0;
    let f_irpef = 0;
    let f_inps  = 0;

    const hasAnalytic = alpha_iva !== null || alpha_irpef !== null || alpha_inps !== null;

    if (hasAnalytic) {
      f_iva   = alpha_iva   !== null ? round2(alpha_iva   * e_tax) : 0;
      f_irpef = alpha_irpef !== null ? round2(alpha_irpef * e_tax) : 0;
      f_inps  = alpha_inps  !== null ? round2(alpha_inps  * e_tax) : 0;
    } else if (alpha !== null) {
      // Fallback: distribuisci alpha legacy con proporzioni tipiche forfettario
      // IVA: 0% (forfettario non applica IVA), IRPEF: 65%, INPS: 35%
      // Queste proporzioni sono solo indicative se non configurato
      f_irpef = round2(alpha * 0.65 * e_tax);
      f_inps  = round2(alpha * 0.35 * e_tax);
      f_iva   = 0;
    }

    const f  = round2(f_iva + f_irpef + f_inps) || (alpha !== null ? round2(alpha * e_tax) : 0);
    const lr = round2(bt - f);

    const result: LiquidityResult = {
      period_start: normalizedPeriod,
      b0, bt, e_total, u_total, e_tax, e_uncat,
      f, lr, alpha, regime_key,
      lr_negative: lr < 0,
      has_uncategorized: uncat_count > 0,
      uncat_count,
      quality_warning: uncat_count > 0,
      breakdown: {
        f_iva, f_irpef, f_inps,
        alpha_iva, alpha_irpef, alpha_inps,
      },
    };

    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "liquidity_calculated",
      resource_type: "period",
      metadata: { period_start: normalizedPeriod, lr, bt, alpha, f_iva, f_irpef, f_inps },
    });

    return new Response(
      JSON.stringify({ success: true, data: result }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    console.error("calculate-liquidity error:", err);
    return errorResponse(500, "Internal server error");
  }
});

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}
function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status }
  );
}
