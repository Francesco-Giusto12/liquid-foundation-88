// supabase/functions/evaluate-alerts/index.ts
//
// Edge Function: Valutazione 5 Alert Intelligenti
// Metodo: POST
// Auth: richiesta (Bearer token)
//
// Body JSON:
// {
//   "period_start": "2024-10-01"   // ISO date, primo giorno del mese
// }
//
// Restituisce lo stato aggiornato di tutti e 5 gli alert per il periodo.
// Inserisce/aggiorna automaticamente i record in alert_history.
//
// Come aggiungere in Lovable:
// 1. Apri sezione "Edge functions" nel pannello Cloud
// 2. Clicca "Add edge function"
// 3. Nome funzione: evaluate-alerts
// 4. Sostituisci tutto il contenuto con questo file

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Tipi ─────────────────────────────────────────────────────

type AlertCode = "A1" | "A2" | "A3" | "A4" | "A5";
type AlertStatus = "active" | "resolved" | "seen";

interface AlertResult {
  code:          AlertCode;
  title:         string;
  status:        AlertStatus;
  triggered:     boolean;
  trigger_value: number | null;
  threshold:     number | null;
  message:       string;
  metadata:      Record<string, unknown>;
}

// ── Handler principale ───────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ── Auth ────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse(401, "Missing authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return errorResponse(401, "Unauthorized");

    // ── Input ────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { period_start } = body;

    if (!period_start || !isValidDate(period_start)) {
      return errorResponse(400, "Invalid period_start");
    }

    const periodDate = new Date(period_start);
    const normalizedPeriod = new Date(
      periodDate.getFullYear(), periodDate.getMonth(), 1
    ).toISOString().split("T")[0];

    const periodEnd = new Date(
      periodDate.getFullYear(), periodDate.getMonth() + 1, 0
    ).toISOString().split("T")[0];

    const today = new Date().toISOString().split("T")[0];
    const todayDay = new Date().getDate();

    // ── Carica dati necessari ─────────────────────────────────

    // Transazioni del periodo
    const { data: transactions } = await supabase
      .from("transactions")
      .select("amount, is_categorized, is_imponibile, category_id, date")
      .eq("user_id", user.id)
      .gte("date", normalizedPeriod)
      .lte("date", periodEnd);

    const txList = transactions ?? [];

    // Periodo precedente per A5
    const prevPeriodStart = new Date(
      periodDate.getFullYear(), periodDate.getMonth() - 1, 1
    ).toISOString().split("T")[0];
    const prevPeriodEnd = new Date(
      periodDate.getFullYear(), periodDate.getMonth(), 0
    ).toISOString().split("T")[0];

    const { data: prevTransactions } = await supabase
      .from("transactions")
      .select("amount")
      .eq("user_id", user.id)
      .gte("date", prevPeriodStart)
      .lte("date", prevPeriodEnd);

    // Calcolo Bₜ periodo corrente e precedente (senza b0 per semplicità alert)
    const btCurrent  = sumAmounts(txList);
    const btPrevious = sumAmounts(prevTransactions ?? []);

    // Calcolo LR corrente (chiamata interna alla funzione DB)
    const { data: alphaData } = await supabase.rpc(
      "get_aliquota_for_period",
      { p_user_id: user.id, p_period_start: normalizedPeriod }
    );
    const alpha = alphaData !== null ? Number(alphaData) : null;

    const eTax = txList
      .filter(t => Number(t.amount) > 0 && t.is_categorized && t.is_imponibile)
      .reduce((s, t) => s + Number(t.amount), 0);

    const { data: b0Data } = await supabase.rpc(
      "get_period_balance_start",
      { p_user_id: user.id, p_period_start: normalizedPeriod }
    );
    const b0 = b0Data ?? 0;
    const eTotal = txList.filter(t => Number(t.amount) > 0).reduce((s, t) => s + Number(t.amount), 0);
    const uTotal = txList.filter(t => Number(t.amount) < 0).reduce((s, t) => s + Math.abs(Number(t.amount)), 0);
    const bt = round2(b0 + eTotal - uTotal);
    const f  = alpha !== null ? round2(alpha * eTax) : 0;
    const lr = round2(bt - f);

    // Soglie alert A3 e A5
    const { data: thresholds } = await supabase
      .from("alert_thresholds")
      .select("alert_code, category_id, threshold")
      .eq("user_id", user.id);

    // Alert history esistente per questo periodo
    const { data: existingAlerts } = await supabase
      .from("alert_history")
      .select("*")
      .eq("user_id", user.id)
      .eq("period_start", normalizedPeriod);

    const existingMap = new Map(
      (existingAlerts ?? []).map((a: any) => [a.alert_code, a])
    );

    // ── Valutazione alert ─────────────────────────────────────

    const results: AlertResult[] = [];

    // ── A1: Liquidità Reale Negativa ─────────────────────────
    const a1Triggered = alpha !== null && lr < 0;
    results.push({
      code: "A1",
      title: "Liquidità Reale Negativa",
      status: a1Triggered ? "active" : "resolved",
      triggered: a1Triggered,
      trigger_value: lr,
      threshold: 0,
      message: a1Triggered
        ? `La liquidità reale è negativa: ${formatEur(lr)}. L'accantonamento fiscale (${formatEur(f)}) supera il saldo disponibile.`
        : "Liquidità reale positiva.",
      metadata: { lr, f, bt, alpha },
    });

    // ── A2: Entrate Non Categorizzate ────────────────────────
    const uncatEntrate = txList.filter(
      t => Number(t.amount) > 0 && !t.is_categorized
    );
    const eUncat       = round2(uncatEntrate.reduce((s, t) => s + Number(t.amount), 0));
    const a2Triggered  = uncatEntrate.length > 0;

    results.push({
      code: "A2",
      title: "Entrate Non Categorizzate",
      status: a2Triggered ? "active" : "resolved",
      triggered: a2Triggered,
      trigger_value: eUncat,
      threshold: null,
      message: a2Triggered
        ? `${uncatEntrate.length} entrate non categorizzate per un totale di ${formatEur(eUncat)}. L'accantonamento fiscale potrebbe essere sottostimato.`
        : "Tutte le entrate sono categorizzate.",
      metadata: { uncat_count: uncatEntrate.length, e_uncat: eUncat },
    });

    // ── A3: Soglia Spesa per Categoria ───────────────────────
    const a3Thresholds = (thresholds ?? []).filter((t: any) => t.alert_code === "A3");

    for (const thresh of a3Thresholds) {
      const catSpend = round2(
        txList
          .filter(t => Number(t.amount) < 0 && t.category_id === thresh.category_id)
          .reduce((s, t) => s + Math.abs(Number(t.amount)), 0)
      );

      const a3Triggered  = catSpend > Number(thresh.threshold);
      const pct          = thresh.threshold > 0
        ? round2((catSpend / Number(thresh.threshold)) * 100) : 0;

      // Recupera nome categoria
      const { data: catData } = await supabase
        .from("categories")
        .select("name")
        .eq("id", thresh.category_id)
        .single();
      const catName = catData?.name ?? thresh.category_id;

      results.push({
        code: "A3",
        title: `Soglia Spesa: ${catName}`,
        status: a3Triggered ? "active" : "resolved",
        triggered: a3Triggered,
        trigger_value: catSpend,
        threshold: Number(thresh.threshold),
        message: a3Triggered
          ? `La categoria "${catName}" ha raggiunto ${formatEur(catSpend)} (${pct}% di ${formatEur(Number(thresh.threshold))}).`
          : `La categoria "${catName}" è nei limiti: ${formatEur(catSpend)} su ${formatEur(Number(thresh.threshold))}.`,
        metadata: { category_id: thresh.category_id, category_name: catName, pct },
      });
    }

    // ── A4: Assenza Movimenti ─────────────────────────────────
    // Si attiva solo se siamo oltre il giorno 10 del mese e non ci sono movimenti
    const isCurrentPeriod = normalizedPeriod === today.slice(0, 7) + "-01";
    const a4Triggered = isCurrentPeriod && todayDay > 10 && txList.length === 0;

    results.push({
      code: "A4",
      title: "Nessun Movimento Registrato",
      status: a4Triggered ? "active" : "resolved",
      triggered: a4Triggered,
      trigger_value: 0,
      threshold: null,
      message: a4Triggered
        ? `Nessun movimento registrato per il mese in corso (oggi è il giorno ${todayDay}). Verifica se manca un import CSV.`
        : "Movimenti presenti per il periodo.",
      metadata: { today_day: todayDay, tx_count: txList.length },
    });

    // ── A5: Variazione Anomala Saldo ──────────────────────────
    const a5Thresh = (thresholds ?? []).find((t: any) => t.alert_code === "A5");
    const a5Pct    = a5Thresh ? Number(a5Thresh.threshold) / 100 : 0.5; // default 50%

    let a5Triggered = false;
    let a5PctChange = 0;

    if (btPrevious !== 0 && (prevTransactions ?? []).length > 0) {
      // Calcola Bₜ precedente con b0 del periodo precedente
      const { data: prevB0Data } = await supabase.rpc(
        "get_period_balance_start",
        { p_user_id: user.id, p_period_start: prevPeriodStart }
      );
      const prevB0 = prevB0Data ?? 0;
      const prevETotal = (prevTransactions ?? [])
        .filter(t => Number(t.amount) > 0)
        .reduce((s: number, t: any) => s + Number(t.amount), 0);
      const prevUTotal = (prevTransactions ?? [])
        .filter(t => Number(t.amount) < 0)
        .reduce((s: number, t: any) => s + Math.abs(Number(t.amount)), 0);
      const btPrev = round2(prevB0 + prevETotal - prevUTotal);

      if (btPrev !== 0) {
        a5PctChange = Math.abs((bt - btPrev) / Math.abs(btPrev));
        a5Triggered = a5PctChange > a5Pct;
      }
    }

    results.push({
      code: "A5",
      title: "Variazione Anomala del Saldo",
      status: a5Triggered ? "active" : "resolved",
      triggered: a5Triggered,
      trigger_value: round2(a5PctChange * 100),
      threshold: round2(a5Pct * 100),
      message: a5Triggered
        ? `Il saldo è variato del ${round2(a5PctChange * 100)}% rispetto al mese precedente (soglia: ${round2(a5Pct * 100)}%).`
        : "Variazione del saldo nei limiti configurati.",
      metadata: { bt_current: bt, pct_change: round2(a5PctChange * 100) },
    });

    // ── Persiste alert_history ────────────────────────────────
    for (const alert of results) {
      if (!alert.triggered && alert.status === "resolved") continue;

      const existing = existingMap.get(alert.code);

      if (!existing) {
        // Crea nuovo record solo se triggered
        if (alert.triggered) {
          await supabase.from("alert_history").insert({
            user_id:       user.id,
            alert_code:    alert.code,
            period_start:  normalizedPeriod,
            trigger_value: alert.trigger_value,
            threshold:     alert.threshold,
            status:        "active",
          });
        }
      } else {
        // Aggiorna se cambia stato o valore significativamente
        const valueDelta = existing.trigger_value !== null && alert.trigger_value !== null
          ? Math.abs(Number(alert.trigger_value) - Number(existing.trigger_value)) /
            (Math.abs(Number(existing.trigger_value)) || 1)
          : 0;

        const shouldReactivate =
          existing.status === "seen" &&
          alert.triggered &&
          valueDelta > 0.05; // 5% di variazione riattiva

        const newStatus = !alert.triggered
          ? "resolved"
          : shouldReactivate
          ? "active"
          : existing.status;

        if (newStatus !== existing.status || valueDelta > 0.01) {
          await supabase
            .from("alert_history")
            .update({
              trigger_value: alert.trigger_value,
              threshold:     alert.threshold,
              status:        newStatus,
            })
            .eq("id", existing.id);
        }
      }
    }

    // Audit log
    const activeCount = results.filter(r => r.triggered).length;
    await supabase.from("audit_logs").insert({
      user_id:       user.id,
      action:        "alerts_evaluated",
      resource_type: "alerts",
      metadata: {
        period_start:  normalizedPeriod,
        active_alerts: activeCount,
        codes:         results.filter(r => r.triggered).map(r => r.code),
      },
    });

    return new Response(
      JSON.stringify({
        success:       true,
        period_start:  normalizedPeriod,
        active_count:  activeCount,
        alerts:        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    console.error("evaluate-alerts error:", err);
    return errorResponse(500, "Internal server error");
  }
});

// ── Utilities ─────────────────────────────────────────────────

function sumAmounts(txList: any[]): number {
  return round2(txList.reduce((s, t) => s + Number(t.amount), 0));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function formatEur(n: number): string {
  return new Intl.NumberFormat("it-IT", {
    style: "currency", currency: "EUR"
  }).format(n);
}

function isValidDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status }
  );
}