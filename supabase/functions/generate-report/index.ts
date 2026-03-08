// supabase/functions/generate-report/index.ts
//
// Edge Function: Generazione Report Mensile (HTML stampabile)
// Metodo: POST
// Auth: richiesta (Bearer token)
//
// Body JSON:
// {
//   "period_start": "2024-10-01"   // ISO date, primo giorno del mese
// }
//
// Restituisce HTML completo, stampabile come PDF da browser (Ctrl+P / window.print())
// Il frontend deve aprirlo in una nuova finestra o in un iframe e chiamare window.print()
//
// Come aggiungere in Lovable:
// 1. Apri sezione "Edge functions" nel pannello Cloud
// 2. Clicca "Add edge function"
// 3. Nome funzione: generate-report
// 4. Sostituisci tutto il contenuto con questo file

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

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

    const periodDate  = new Date(period_start);
    const normalizedPeriod = new Date(
      periodDate.getFullYear(), periodDate.getMonth(), 1
    ).toISOString().split("T")[0];
    const periodEnd   = new Date(
      periodDate.getFullYear(), periodDate.getMonth() + 1, 0
    ).toISOString().split("T")[0];
    const today       = new Date().toISOString().split("T")[0];

    if (normalizedPeriod > today) {
      return errorResponse(400, "Cannot generate report for future period");
    }

    // ── Carica dati ──────────────────────────────────────────

    // Profilo utente
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, account_type, currency")
      .eq("id", user.id)
      .single();

    // Transazioni del periodo con categoria
    const { data: transactions } = await supabase
      .from("transactions")
      .select(`
        id, amount, date, description, type,
        is_categorized, is_imponibile,
        categories(name, is_imponibile)
      `)
      .eq("user_id", user.id)
      .gte("date", normalizedPeriod)
      .lte("date", periodEnd)
      .order("date", { ascending: true });

    if (!transactions || transactions.length === 0) {
      return errorResponse(400, "No transactions found for this period");
    }

    // Calcolo LR
    const { data: alphaData } = await supabase.rpc(
      "get_aliquota_for_period",
      { p_user_id: user.id, p_period_start: normalizedPeriod }
    );
    const alpha = alphaData !== null ? Number(alphaData) : null;

    const { data: b0Data } = await supabase.rpc(
      "get_period_balance_start",
      { p_user_id: user.id, p_period_start: normalizedPeriod }
    );
    const b0 = b0Data ?? 0;

    const txList = transactions ?? [];
    const entrate = txList.filter(t => Number(t.amount) > 0);
    const uscite  = txList.filter(t => Number(t.amount) < 0);

    const eTotal  = round2(entrate.reduce((s, t) => s + Number(t.amount), 0));
    const uTotal  = round2(uscite.reduce((s, t) => s + Math.abs(Number(t.amount)), 0));
    const bt      = round2(b0 + eTotal - uTotal);
    const eTax    = round2(
      entrate
        .filter(t => t.is_categorized && t.is_imponibile)
        .reduce((s, t) => s + Number(t.amount), 0)
    );
    const f       = alpha !== null ? round2(alpha * eTax) : 0;
    const lr      = round2(bt - f);
    const eUncat  = round2(
      entrate.filter(t => !t.is_categorized).reduce((s, t) => s + Number(t.amount), 0)
    );
    const uncatCount = entrate.filter(t => !t.is_categorized).length;

    // Riepilogo per categoria
    const catMap = new Map<string, { name: string; type: string; total: number }>();
    for (const tx of txList) {
      const catName = (tx as any).categories?.name ?? "Non categorizzato";
      const key     = `${catName}_${Number(tx.amount) > 0 ? "income" : "expense"}`;
      if (!catMap.has(key)) {
        catMap.set(key, {
          name:  catName,
          type:  Number(tx.amount) > 0 ? "income" : "expense",
          total: 0,
        });
      }
      catMap.get(key)!.total = round2(
        catMap.get(key)!.total + Math.abs(Number(tx.amount))
      );
    }
    const catSummary = Array.from(catMap.values())
      .sort((a, b) => b.total - a.total);

    // Alert attivi del periodo
    const { data: alertsActive } = await supabase
      .from("alert_history")
      .select("alert_code, trigger_value, threshold, status")
      .eq("user_id", user.id)
      .eq("period_start", normalizedPeriod)
      .eq("status", "active");

    // Regime attivo
    const { data: regimeData } = await supabase
      .from("tax_regime_history")
      .select("regime_key, regime_label, aliquota")
      .eq("user_id", user.id)
      .lte("valid_from", normalizedPeriod)
      .or(`valid_to.is.null,valid_to.gte.${normalizedPeriod}`)
      .order("valid_from", { ascending: false })
      .limit(1)
      .single();

    const periodLabel = periodDate.toLocaleString("it-IT", {
      month: "long", year: "numeric"
    });
    const currency = profile?.currency ?? "EUR";

    // ── Genera HTML ──────────────────────────────────────────
    const html = buildReportHTML({
      profile,
      periodLabel,
      normalizedPeriod,
      periodEnd,
      generatedAt:  new Date().toLocaleDateString("it-IT"),
      b0, bt, lr, f, eTotal, uTotal, eTax, eUncat, uncatCount, alpha,
      regime:       regimeData,
      entrate,
      uscite,
      catSummary,
      alerts:       alertsActive ?? [],
      currency,
    });

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id:       user.id,
      action:        "report_generated",
      resource_type: "report",
      metadata: {
        period_start: normalizedPeriod,
        tx_count:     txList.length,
      },
    });

    return new Response(html, {
      headers: {
        ...corsHeaders,
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="liquido-report-${normalizedPeriod.slice(0,7)}.html"`,
      },
      status: 200,
    });

  } catch (err) {
    console.error("generate-report error:", err);
    return errorResponse(500, "Internal server error");
  }
});

// ── Builder HTML ──────────────────────────────────────────────

function buildReportHTML(d: any): string {
  const eur = (n: number) =>
    new Intl.NumberFormat("it-IT", { style: "currency", currency: d.currency }).format(n);

  const pct = (n: number) =>
    `${Math.round(n * 100)}%`;

  const rowColor = (i: number) => i % 2 === 0 ? "#ffffff" : "#f8fafc";

  const entrateRows = d.entrate.map((t: any, i: number) => `
    <tr style="background:${rowColor(i)}">
      <td>${formatDate(t.date)}</td>
      <td>${esc(t.description || "—")}</td>
      <td>${esc((t as any).categories?.name ?? "Non categorizzato")}</td>
      <td style="text-align:right;color:#1D6B44;font-weight:600">${eur(Math.abs(Number(t.amount)))}</td>
    </tr>`).join("");

  const usciteRows = d.uscite.map((t: any, i: number) => `
    <tr style="background:${rowColor(i)}">
      <td>${formatDate(t.date)}</td>
      <td>${esc(t.description || "—")}</td>
      <td>${esc((t as any).categories?.name ?? "Non categorizzato")}</td>
      <td style="text-align:right;color:#C0392B;font-weight:600">${eur(Math.abs(Number(t.amount)))}</td>
    </tr>`).join("");

  const catEntrateRows = d.catSummary
    .filter((c: any) => c.type === "income")
    .map((c: any, i: number) => `
      <tr style="background:${rowColor(i)}">
        <td>${esc(c.name)}</td>
        <td style="text-align:right;color:#1D6B44">${eur(c.total)}</td>
        <td style="text-align:right">${d.eTotal > 0 ? pct(c.total / d.eTotal) : "—"}</td>
      </tr>`).join("");

  const catUsciteRows = d.catSummary
    .filter((c: any) => c.type === "expense")
    .map((c: any, i: number) => `
      <tr style="background:${rowColor(i)}">
        <td>${esc(c.name)}</td>
        <td style="text-align:right;color:#C0392B">${eur(c.total)}</td>
        <td style="text-align:right">${d.uTotal > 0 ? pct(c.total / d.uTotal) : "—"}</td>
      </tr>`).join("");

  const alertRows = d.alerts.length === 0
    ? `<tr><td colspan="3" style="text-align:center;color:#888">Nessun alert attivo nel periodo</td></tr>`
    : d.alerts.map((a: any, i: number) => `
        <tr style="background:${rowColor(i)}">
          <td><strong>${a.alert_code}</strong></td>
          <td>${alertLabel(a.alert_code)}</td>
          <td>${a.trigger_value !== null ? eur(Number(a.trigger_value)) : "—"}</td>
        </tr>`).join("");

  const regimeInfo = d.regime
    ? `${d.regime.regime_key}${d.regime.regime_label ? ` — ${esc(d.regime.regime_label)}` : ""} (${pct(Number(d.regime.aliquota))})`
    : "Non configurato";

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Liquidò — Report ${d.periodLabel}</title>
  <style>
    /* ── Reset & base ── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
      font-size: 13px;
      color: #1a1a2e;
      background: #fff;
      padding: 32px;
      max-width: 900px;
      margin: 0 auto;
    }

    /* ── Intestazione ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #1B3A5C;
      padding-bottom: 16px;
      margin-bottom: 24px;
    }
    .header h1 { font-size: 22px; color: #1B3A5C; }
    .header .meta { text-align: right; color: #666; font-size: 12px; line-height: 1.8; }

    /* ── KPI cards ── */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 12px;
      margin-bottom: 24px;
    }
    .kpi-card {
      border: 1px solid #e0e0e0;
      border-radius: 6px;
      padding: 14px;
      background: #f8fafc;
    }
    .kpi-card .label { font-size: 11px; color: #666; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
    .kpi-card .value { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; }
    .kpi-card.highlight { border-color: #2E75B6; background: #D5E8F0; }
    .kpi-card.warning   { border-color: #C0392B; background: #FDECEA; }
    .value.positive { color: #1D6B44; }
    .value.negative { color: #C0392B; }
    .value.blue     { color: #1B3A5C; }

    /* ── Sezioni ── */
    h2 {
      font-size: 14px;
      color: #1B3A5C;
      border-left: 4px solid #2E75B6;
      padding-left: 8px;
      margin: 24px 0 10px;
    }

    /* ── Tabelle ── */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th {
      background: #1B3A5C;
      color: #fff;
      text-align: left;
      padding: 8px 10px;
      font-weight: 600;
    }
    td { padding: 7px 10px; border-bottom: 1px solid #f0f0f0; }

    /* ── Warning box ── */
    .warning-box {
      background: #FDECEA;
      border-left: 4px solid #C0392B;
      padding: 10px 14px;
      margin: 8px 0;
      border-radius: 0 4px 4px 0;
      font-size: 12px;
    }
    .info-box {
      background: #D5E8F0;
      border-left: 4px solid #2E75B6;
      padding: 10px 14px;
      margin: 8px 0;
      border-radius: 0 4px 4px 0;
      font-size: 12px;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 36px;
      padding-top: 12px;
      border-top: 1px solid #e0e0e0;
      font-size: 11px;
      color: #999;
      text-align: center;
    }

    /* ── Print ── */
    @media print {
      body { padding: 16px; font-size: 11px; }
      .no-print { display: none !important; }
      h2 { margin-top: 16px; }
      .kpi-grid { grid-template-columns: repeat(3, 1fr); }
      tr { page-break-inside: avoid; }
      h2, .section-title { page-break-after: avoid; }
    }
  </style>
</head>
<body>

  <div class="no-print" style="text-align:right;margin-bottom:16px">
    <button onclick="window.print()" style="padding:8px 16px;background:#1B3A5C;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px">
      📄 Stampa / Salva PDF
    </button>
  </div>

  <div class="header">
    <div>
      <h1>LIQUIDÒ — REPORT MENSILE</h1>
      <p style="font-size:15px;color:#2E75B6;margin-top:4px">${esc(d.periodLabel.toUpperCase())}</p>
      <p style="font-size:12px;color:#666;margin-top:4px">
        ${esc(d.profile?.full_name ?? "")}  · 
        ${esc(d.profile?.account_type === "business" ? "Azienda" : "Personale")}
      </p>
    </div>
    <div class="meta">
      Generato il ${d.generatedAt}<br>
      Periodo: ${formatDate(d.normalizedPeriod)} — ${formatDate(d.periodEnd)}<br>
      Regime fiscale: ${regimeInfo}
    </div>
  </div>

  <h2>1. Riepilogo Esecutivo</h2>
  <div class="kpi-grid">
    <div class="kpi-card">
      <div class="label">Saldo Iniziale</div>
      <div class="value blue">${eur(d.b0)}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Entrate</div>
      <div class="value positive">+ ${eur(d.eTotal)}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Uscite</div>
      <div class="value negative">− ${eur(d.uTotal)}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Saldo Corrente (Bₜ)</div>
      <div class="value blue">${eur(d.bt)}</div>
    </div>
    <div class="kpi-card">
      <div class="label">Accantonamento Fiscale</div>
      <div class="value negative">− ${eur(d.f)}</div>
    </div>
    <div class="kpi-card ${d.lr < 0 ? 'warning' : 'highlight'}">
      <div class="label">Liquidità Reale (LR)</div>
      <div class="value ${d.lr < 0 ? 'negative' : 'positive'}">${eur(d.lr)}</div>
    </div>
  </div>

  ${d.lr < 0 ? `
  <div class="warning-box">
    ⚠ <strong>Liquidità Reale Negativa:</strong>
    L'accantonamento fiscale (${eur(d.f)}) supera il saldo disponibile.
    Sono necessarie azioni correttive.
  </div>
` : ""}

  ${d.uncatCount > 0 ? `
  <div class="info-box">
    ℹ ${d.uncatCount} entrate non categorizzate per ${eur(d.eUncat)}.
    L'accantonamento fiscale potrebbe essere sottostimato.
  </div>
` : ""}

  <h2>2. Dettaglio Entrate (${d.entrate.length} movimenti)</h2>
  <table>
    <thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th>Importo</th></tr></thead>
    <tbody>${entrateRows}</tbody>
    <tfoot>
      <tr style="background:#f0f7f0;font-weight:700">
        <td colspan="3">Totale Entrate</td>
        <td style="text-align:right;color:#1D6B44">${eur(d.eTotal)}</td>
      </tr>
    </tfoot>
  </table>

  <h2>3. Dettaglio Uscite (${d.uscite.length} movimenti)</h2>
  <table>
    <thead><tr><th>Data</th><th>Descrizione</th><th>Categoria</th><th>Importo</th></tr></thead>
    <tbody>${usciteRows}</tbody>
    <tfoot>
      <tr style="background:#fef0f0;font-weight:700">
        <td colspan="3">Totale Uscite</td>
        <td style="text-align:right;color:#C0392B">${eur(d.uTotal)}</td>
      </tr>
    </tfoot>
  </table>

  <h2>4. Riepilogo per Categoria</h2>

  ${d.catSummary.filter((c: any) => c.type === "income").length > 0 ? `
  <h3 style="font-size:12px;color:#1D6B44;margin:12px 0 6px">Entrate per categoria</h3>
  <table>
    <thead><tr><th>Categoria</th><th>Totale</th><th>% su entrate</th></tr></thead>
    <tbody>${catEntrateRows}</tbody>
  </table>
` : ""}

  ${d.catSummary.filter((c: any) => c.type === "expense").length > 0 ? `
  <h3 style="font-size:12px;color:#C0392B;margin:12px 0 6px">Uscite per categoria</h3>
  <table>
    <thead><tr><th>Categoria</th><th>Totale</th><th>% su uscite</th></tr></thead>
    <tbody>${catUsciteRows}</tbody>
  </table>
` : ""}

  <h2>5. Accantonamento Fiscale</h2>
  <table>
    <thead><tr><th>Voce</th><th>Valore</th></tr></thead>
    <tbody>
      <tr><td>Regime fiscale attivo</td><td>${regimeInfo}</td></tr>
      <tr><td>Entrate imponibili (E_tax)</td><td>${eur(d.eTax)}</td></tr>
      <tr><td>Aliquota applicata (α)</td><td>${d.alpha !== null ? pct(d.alpha) : "—"}</td></tr>
      <tr><td>Accantonamento periodo (F)</td><td>${eur(d.f)}</td></tr>
      ${d.uncatCount > 0 ? `<tr style="background:#FDECEA"><td>Entrate non categorizzate (E_uncat)</td><td>${eur(d.eUncat)} ⚠</td></tr>` : ""}
    </tbody>
  </table>

  <h2>6. Alert del Periodo</h2>
  <table>
    <thead><tr><th>Codice</th><th>Tipo</th><th>Valore</th></tr></thead>
    <tbody>${alertRows}</tbody>
  </table>

  <h2>7. Note Qualità Dati</h2>
  <table>
    <thead><tr><th>Metrica</th><th>Valore</th></tr></thead>
    <tbody>
      <tr><td>Movimenti totali nel periodo</td><td>${d.entrate.length + d.uscite.length}</td></tr>
      <tr><td>Entrate non categorizzate</td>
        <td style="${d.uncatCount > 0 ? 'color:#C0392B;font-weight:600' : ''}">${d.uncatCount}</td></tr>
      <tr><td>Importo entrate non categorizzate</td>
        <td style="${d.uncatCount > 0 ? 'color:#C0392B' : ''}">${eur(d.eUncat)}</td></tr>
      <tr><td>Regime fiscale configurato</td>
        <td>${d.regime ? "✓ Sì" : "✗ No"}</td></tr>
      <tr><td>Saldo iniziale disponibile</td>
        <td>${d.b0 !== 0 ? "✓ Sì" : "⚠ Stimato"}</td></tr>
    </tbody>
  </table>

  <div class="footer">
    CashFlowVR — Report generato il ${d.generatedAt}  · 
    Periodo ${esc(d.periodLabel)}  · 
    Documento riservato — uso personale
  </div>

</body>
</html>`;
}

// ── Utilities ─────────────────────────────────────────────────

function esc(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function alertLabel(code: string): string {
  const labels: Record<string, string> = {
    A1: "Liquidità Reale Negativa",
    A2: "Entrate Non Categorizzate",
    A3: "Soglia Spesa Categoria",
    A4: "Nessun Movimento Registrato",
    A5: "Variazione Anomala Saldo",
  };
  return labels[code] ?? code;
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
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