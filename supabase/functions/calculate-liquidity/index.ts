// supabase/functions/calculate-liquidity/index.ts
//
// Edge Function: Calcolo Liquidità Reale
// Metodo: POST
// Auth: richiesta (Bearer token)
//
// Body JSON:
// {
//   "period_start": "2024-10-01",   // ISO date, primo giorno del mese
//   "force_recalc": false            // opzionale, default false
// }
//
// Come aggiungere in Lovable:
// 1. Apri sezione "Edge functions" nel pannello Cloud
// 2. Clicca "Add edge function"
// 3. Nome funzione: calculate-liquidity
// 4. Sostituisci tutto il contenuto con questo file

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Tipi ────────────────────────────────────────────────────

interface LiquidityResult {
  period_start: string;
  b0: number;               // saldo iniziale
  bt: number;               // saldo corrente (b0 + E - U)
  e_total: number;          // entrate totali
  u_total: number;          // uscite totali (valore positivo)
  e_tax: number;            // entrate imponibili categorizzate
  e_uncat: number;          // entrate NON categorizzate (metadato qualità)
  f: number;                // accantonamento fiscale = alpha * e_tax
  lr: number;               // liquidità reale = bt - f
  alpha: number | null;     // aliquota applicata (null = regime non configurato)
  regime_key: string | null;
  lr_negative: boolean;     // true se lr < 0
  has_uncategorized: boolean;
  uncat_count: number;      // numero movimenti non categorizzati
  quality_warning: boolean; // true se e_uncat > 0
}

// ── Handler principale ───────────────────────────────────────

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Autenticazione ──────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return errorResponse(401, "Missing authorization header");
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return errorResponse(401, "Unauthorized");
    }

    // ── Parsing input ───────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { period_start, force_recalc = false } = body;

    if (!period_start || !isValidDateString(period_start)) {
      return errorResponse(400, "Invalid period_start. Expected ISO date (YYYY-MM-DD)");
    }

    // Normalizza al primo del mese
    const periodDate = new Date(period_start);
    const normalizedPeriod = new Date(
      periodDate.getFullYear(),
      periodDate.getMonth(),
      1
    ).toISOString().split("T")[0];

    const periodEnd = new Date(
      periodDate.getFullYear(),
      periodDate.getMonth() + 1,
      0
    ).toISOString().split("T")[0];

    // ── Recupera saldo iniziale ─────────────────────────────
    const { data: b0Data } = await supabase.rpc(
      "get_period_balance_start",
      { p_user_id: user.id, p_period_start: normalizedPeriod }
    );

    const b0: number = b0Data ?? 0;
    const b0Missing = b0Data === null;

    // ── Recupera movimenti del periodo ──────────────────────
    const { data: transactions, error: txError } = await supabase
      .from("transactions")
      .select("amount, is_categorized, is_imponibile, category_id")
      .eq("user_id", user.id)
      .gte("date", normalizedPeriod)
      .lte("date", periodEnd);

    if (txError) {
      return errorResponse(500, "Error fetching transactions");
    }

    const txList = transactions ?? [];

    // ── Calcolo aggregati ───────────────────────────────────
    let e_total = 0;
    let u_total = 0;
    let e_tax = 0;
    let e_uncat = 0;
    let uncat_count = 0;

    for (const tx of txList) {
      const amount = Number(tx.amount);

      if (amount > 0) {
        e_total += amount;

        if (!tx.is_categorized) {
          e_uncat += amount;
          uncat_count++;
        } else if (tx.is_imponibile) {
          e_tax += amount;
        }
      } else {
        u_total += Math.abs(amount);
      }
    }

    // Arrotonda a 2 decimali per evitare floating point drift
    e_total = round2(e_total);
    u_total = round2(u_total);
    e_tax   = round2(e_tax);
    e_uncat = round2(e_uncat);

    const bt = round2(b0 + e_total - u_total);

    // ── Recupera aliquota regime ────────────────────────────
    const { data: alphaData } = await supabase.rpc(
      "get_aliquota_for_period",
      { p_user_id: user.id, p_period_start: normalizedPeriod }
    );

    const alpha: number | null = alphaData !== null ? Number(alphaData) : null;

    // Recupera anche il regime_key per info
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

    // ── Calcolo accantonamento e LR ─────────────────────────
    const f  = alpha !== null ? round2(alpha * e_tax) : 0;
    const lr = round2(bt - f);

    // ── Costruisce risultato ────────────────────────────────
    const result: LiquidityResult = {
      period_start: normalizedPeriod,
      b0,
      bt,
      e_total,
      u_total,
      e_tax,
      e_uncat,
      f,
      lr,
      alpha,
      regime_key,
      lr_negative: lr < 0,
      has_uncategorized: uncat_count > 0,
      uncat_count,
      quality_warning: uncat_count > 0,
    };

    // ── Audit log ───────────────────────────────────────────
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "liquidity_calculated",
      resource_type: "period",
      metadata: {
        period_start: normalizedPeriod,
        lr,
        bt,
        alpha,
        b0_missing: b0Missing,
      },
    });

    return new Response(
      JSON.stringify({ success: true, data: result }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error("calculate-liquidity error:", err);
    return errorResponse(500, "Internal server error");
  }
});

// ── Utilities ────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function isValidDateString(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    }
  );
}