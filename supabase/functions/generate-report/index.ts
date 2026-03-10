import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return errorResponse(401, "Missing authorization header");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return errorResponse(401, "Unauthorized");

    const body = await req.json().catch(() => ({}));
    const { period_start } = body;

    if (!period_start || !/^\d{4}-\d{2}-\d{2}$/.test(period_start)) {
      return errorResponse(400, "Invalid period_start");
    }

    const periodDate = new Date(period_start);
    const normalizedPeriod = new Date(periodDate.getFullYear(), periodDate.getMonth(), 1)
      .toISOString().split("T")[0];
    const periodEnd = new Date(periodDate.getFullYear(), periodDate.getMonth() + 1, 0)
      .toISOString().split("T")[0];

    // Load data
    const { data: profile } = await supabase
      .from("profiles")
      .select("full_name, account_type, currency")
      .eq("id", user.id)
      .single();

    const { data: transactions } = await supabase
      .from("transactions")
      .select("id, amount, date, description, type, is_categorized, is_imponibile, categories(name, is_imponibile)")
      .eq("user_id", user.id)
      .gte("date", normalizedPeriod)
      .lte("date", periodEnd)
      .order("date", { ascending: true });

    if (!transactions || transactions.length === 0) {
      return errorResponse(400, "No transactions found for this period");
    }

    const { data: alphaData } = await supabase.rpc("get_aliquota_for_period", {
      p_user_id: user.id, p_period_start: normalizedPeriod,
    });
    const alpha = alphaData !== null ? Number(alphaData) : null;

    const { data: b0Data } = await supabase.rpc("get_period_balance_start", {
      p_user_id: user.id, p_period_start: normalizedPeriod,
    });
    const b0 = b0Data ?? 0;

    const entrate = transactions.filter(t => Number(t.amount) > 0);
    const uscite = transactions.filter(t => Number(t.amount) < 0);
    const eTotal = r2(entrate.reduce((s, t) => s + Number(t.amount), 0));
    const uTotal = r2(uscite.reduce((s, t) => s + Math.abs(Number(t.amount)), 0));
    const bt = r2(b0 + eTotal - uTotal);
    const eTax = r2(entrate.filter(t => t.is_categorized && t.is_imponibile).reduce((s, t) => s + Number(t.amount), 0));
    const f = alpha !== null ? r2(alpha * eTax) : 0;
    const lr = r2(bt - f);
    const eUncat = r2(entrate.filter(t => !t.is_categorized).reduce((s, t) => s + Number(t.amount), 0));
    const uncatCount = entrate.filter(t => !t.is_categorized).length;

    // Category summary
    const catMap = new Map<string, { name: string; type: string; total: number }>();
    for (const tx of transactions) {
      const catName = (tx as any).categories?.name ?? "Non categorizzato";
      const key = `${catName}_${Number(tx.amount) > 0 ? "income" : "expense"}`;
      if (!catMap.has(key)) catMap.set(key, { name: catName, type: Number(tx.amount) > 0 ? "income" : "expense", total: 0 });
      catMap.get(key)!.total = r2(catMap.get(key)!.total + Math.abs(Number(tx.amount)));
    }
    const catSummary = Array.from(catMap.values()).sort((a, b) => b.total - a.total);

    // Alerts
    const { data: alertsActive } = await supabase
      .from("alert_history")
      .select("alert_code, trigger_value, threshold, status")
      .eq("user_id", user.id)
      .eq("period_start", normalizedPeriod)
      .eq("status", "active");

    // Regime
    const { data: regimeData } = await supabase
      .from("tax_regime_history")
      .select("regime_key, regime_label, aliquota")
      .eq("user_id", user.id)
      .lte("valid_from", normalizedPeriod)
      .or(`valid_to.is.null,valid_to.gte.${normalizedPeriod}`)
      .order("valid_from", { ascending: false })
      .limit(1)
      .single();

    const periodLabel = periodDate.toLocaleString("it-IT", { month: "long", year: "numeric" });
    const currency = profile?.currency ?? "EUR";
    const generatedAt = new Date().toLocaleDateString("it-IT");

    // ── Build PDF ──
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    const pw = 210;
    const margin = 15;
    const cw = pw - margin * 2;
    let y = margin;

    const eur = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency }).format(n);
    const pct = (n: number) => `${Math.round(n * 100)}%`;
    const fmtDate = (iso: string) => { const [yy, mm, dd] = iso.split("-"); return `${dd}/${mm}/${yy}`; };

    // Colors
    const navy = [27, 58, 92] as const;
    const green = [29, 107, 68] as const;
    const red = [192, 57, 43] as const;
    const gray = [100, 100, 100] as const;
    const lightGray = [240, 240, 240] as const;

    // Header
    doc.setFontSize(18);
    doc.setTextColor(...navy);
    doc.text("LIQUIDÒ — REPORT MENSILE", margin, y);
    y += 7;
    doc.setFontSize(12);
    doc.setTextColor(46, 117, 182);
    doc.text(periodLabel.toUpperCase(), margin, y);
    y += 5;
    doc.setFontSize(9);
    doc.setTextColor(...gray);
    doc.text(`${profile?.full_name ?? ""} · ${profile?.account_type === "business" ? "Azienda" : "Personale"}`, margin, y);

    // Right-aligned meta
    doc.setFontSize(8);
    doc.text(`Generato il ${generatedAt}`, pw - margin, margin, { align: "right" });
    doc.text(`Periodo: ${fmtDate(normalizedPeriod)} — ${fmtDate(periodEnd)}`, pw - margin, margin + 4, { align: "right" });
    const regimeInfo = regimeData
      ? `${regimeData.regime_key}${regimeData.regime_label ? ` — ${regimeData.regime_label}` : ""} (${pct(Number(regimeData.aliquota))})`
      : "Non configurato";
    doc.text(`Regime: ${regimeInfo}`, pw - margin, margin + 8, { align: "right" });

    y += 5;
    doc.setDrawColor(...navy);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pw - margin, y);
    y += 8;

    // ── Section 1: Executive Summary ──
    y = sectionTitle(doc, "1. Riepilogo Esecutivo", y, margin, navy);

    const kpis = [
      { label: "Saldo Iniziale", value: eur(b0) },
      { label: "Entrate", value: `+ ${eur(eTotal)}` },
      { label: "Uscite", value: `- ${eur(uTotal)}` },
      { label: "Saldo Corrente (Bt)", value: eur(bt) },
      { label: "Accantonamento Fiscale", value: `- ${eur(f)}` },
      { label: "Liquidità Reale (LR)", value: eur(lr) },
    ];
    const kpiW = cw / 3;
    kpis.forEach((kpi, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      const x = margin + col * kpiW;
      const ky = y + row * 16;
      doc.setFillColor(248, 250, 252);
      doc.roundedRect(x, ky, kpiW - 3, 14, 2, 2, "F");
      doc.setFontSize(7);
      doc.setTextColor(...gray);
      doc.text(kpi.label.toUpperCase(), x + 3, ky + 5);
      doc.setFontSize(11);
      doc.setTextColor(...navy);
      doc.text(kpi.value, x + 3, ky + 11);
    });
    y += Math.ceil(kpis.length / 3) * 16 + 4;

    if (lr < 0) {
      y = warningBox(doc, `ATTENZIONE - Liquidita Reale Negativa: L'accantonamento (${eur(f)}) supera il saldo.`, y, margin, cw, red);
    }
    if (uncatCount > 0) {
      y = infoBox(doc, `INFO: ${uncatCount} entrate non categorizzate per ${eur(eUncat)}. Accantonamento potrebbe essere sottostimato.`, y, margin, cw);
    }

    // ── Section 2: Income Transactions ──
    y = checkPage(doc, y, 40);
    y = sectionTitle(doc, `2. Dettaglio Entrate (${entrate.length} movimenti)`, y, margin, navy);
    y = drawTable(doc, y, margin, cw,
      ["Data", "Descrizione", "Categoria", "Importo"],
      [0.12, 0.38, 0.3, 0.2],
      entrate.map(t => [
        fmtDate(t.date),
        t.description || "-",
        (t as any).categories?.name ?? "Non categorizzato",
        eur(Math.abs(Number(t.amount))),
      ]),
      { lastColAlign: "right", lastColColor: green }
    );
    y = drawTotalRow(doc, y, margin, cw, "Totale Entrate", eur(eTotal), green);

    // ── Section 3: Expense Transactions ──
    y = checkPage(doc, y, 40);
    y = sectionTitle(doc, `3. Dettaglio Uscite (${uscite.length} movimenti)`, y, margin, navy);
    y = drawTable(doc, y, margin, cw,
      ["Data", "Descrizione", "Categoria", "Importo"],
      [0.12, 0.38, 0.3, 0.2],
      uscite.map(t => [
        fmtDate(t.date),
        t.description || "—",
        (t as any).categories?.name ?? "Non categorizzato",
        eur(Math.abs(Number(t.amount))),
      ]),
      { lastColAlign: "right", lastColColor: red }
    );
    y = drawTotalRow(doc, y, margin, cw, "Totale Uscite", eur(uTotal), red);

    // ── Section 4: Category Summary ──
    y = checkPage(doc, y, 40);
    y = sectionTitle(doc, "4. Riepilogo per Categoria", y, margin, navy);

    const catIncome = catSummary.filter(c => c.type === "income");
    const catExpense = catSummary.filter(c => c.type === "expense");

    if (catIncome.length) {
      doc.setFontSize(9);
      doc.setTextColor(...green);
      doc.text("Entrate per categoria", margin, y);
      y += 4;
      y = drawTable(doc, y, margin, cw,
        ["Categoria", "Totale", "% su entrate"],
        [0.5, 0.25, 0.25],
        catIncome.map(c => [c.name, eur(c.total), eTotal > 0 ? pct(c.total / eTotal) : "—"]),
        { lastColAlign: "right" }
      );
    }
    if (catExpense.length) {
      doc.setFontSize(9);
      doc.setTextColor(...red);
      doc.text("Uscite per categoria", margin, y);
      y += 4;
      y = drawTable(doc, y, margin, cw,
        ["Categoria", "Totale", "% su uscite"],
        [0.5, 0.25, 0.25],
        catExpense.map(c => [c.name, eur(c.total), uTotal > 0 ? pct(c.total / uTotal) : "—"]),
        { lastColAlign: "right" }
      );
    }

    // ── Section 5: Tax ──
    y = checkPage(doc, y, 35);
    y = sectionTitle(doc, "5. Accantonamento Fiscale", y, margin, navy);
    y = drawTable(doc, y, margin, cw,
      ["Voce", "Valore"],
      [0.6, 0.4],
      [
        ["Regime fiscale attivo", regimeInfo],
        ["Entrate imponibili (E_tax)", eur(eTax)],
        ["Aliquota applicata (α)", alpha !== null ? pct(alpha) : "—"],
        ["Accantonamento periodo (F)", eur(f)],
        ...(uncatCount > 0 ? [["Entrate non categorizzate", `${eur(eUncat)} ⚠`]] : []),
      ],
      {}
    );

    // ── Section 6: Alerts ──
    y = checkPage(doc, y, 25);
    y = sectionTitle(doc, "6. Alert del Periodo", y, margin, navy);
    const alerts = alertsActive ?? [];
    if (alerts.length === 0) {
      doc.setFontSize(8);
      doc.setTextColor(...gray);
      doc.text("Nessun alert attivo nel periodo", margin, y);
      y += 6;
    } else {
      y = drawTable(doc, y, margin, cw,
        ["Codice", "Tipo", "Valore"],
        [0.2, 0.5, 0.3],
        alerts.map((a: any) => [
          a.alert_code,
          alertLabel(a.alert_code),
          a.trigger_value !== null ? eur(Number(a.trigger_value)) : "—",
        ]),
        {}
      );
    }

    // ── Section 7: Data Quality ──
    y = checkPage(doc, y, 30);
    y = sectionTitle(doc, "7. Note Qualità Dati", y, margin, navy);
    y = drawTable(doc, y, margin, cw,
      ["Metrica", "Valore"],
      [0.6, 0.4],
      [
        ["Movimenti totali nel periodo", String(transactions.length)],
        ["Entrate non categorizzate", String(uncatCount)],
        ["Importo entrate non categorizzate", eur(eUncat)],
        ["Regime fiscale configurato", regimeData ? "✓ Sì" : "✗ No"],
        ["Saldo iniziale disponibile", b0 !== 0 ? "✓ Sì" : "⚠ Stimato"],
      ],
      {}
    );

    // Footer
    y = checkPage(doc, y, 15);
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, y, pw - margin, y);
    y += 5;
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.text(`Liquidò — Report generato il ${generatedAt} · Periodo ${periodLabel} · Documento riservato`, pw / 2, y, { align: "center" });

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id: user.id,
      action: "report_generated",
      resource_type: "report",
      metadata: { period_start: normalizedPeriod, tx_count: transactions.length, format: "pdf" },
    });

    const pdfOutput = doc.output("arraybuffer");

    return new Response(pdfOutput, {
      headers: {
        ...corsHeaders,
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="liquido-report-${normalizedPeriod.slice(0, 7)}.pdf"`,
      },
      status: 200,
    });

  } catch (err) {
    console.error("generate-report error:", err);
    return errorResponse(500, "Internal server error");
  }
});

// ── PDF Helpers ──

function sectionTitle(doc: any, title: string, y: number, margin: number, color: readonly number[]): number {
  doc.setFontSize(11);
  doc.setTextColor(...color);
  doc.setFillColor(...color);
  doc.rect(margin, y - 3, 1.5, 6, "F");
  doc.text(title, margin + 4, y + 1.5);
  return y + 8;
}

function checkPage(doc: any, y: number, needed: number): number {
  if (y + needed > 280) {
    doc.addPage();
    return 15;
  }
  return y;
}

function drawTable(
  doc: any, startY: number, margin: number, cw: number,
  headers: string[], colRatios: number[], rows: string[][],
  opts: { lastColAlign?: string; lastColColor?: readonly number[] }
): number {
  const rowH = 6;
  let y = startY;

  // Header
  doc.setFillColor(27, 58, 92);
  doc.rect(margin, y, cw, rowH, "F");
  doc.setFontSize(7);
  doc.setTextColor(255, 255, 255);
  let x = margin;
  headers.forEach((h, i) => {
    const w = cw * colRatios[i];
    doc.text(h, x + 2, y + 4);
    x += w;
  });
  y += rowH;

  // Rows
  rows.forEach((row, ri) => {
    y = checkPage(doc, y, rowH);
    if (ri % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(margin, y, cw, rowH, "F");
    }
    x = margin;
    row.forEach((cell, ci) => {
      const w = cw * colRatios[ci];
      const isLast = ci === row.length - 1;
      if (isLast && opts.lastColColor) {
        doc.setTextColor(...opts.lastColColor);
      } else {
        doc.setTextColor(30, 30, 30);
      }
      doc.setFontSize(7);
      const txt = cell.length > 40 ? cell.slice(0, 38) + "…" : cell;
      if (isLast && opts.lastColAlign === "right") {
        doc.text(txt, x + w - 2, y + 4, { align: "right" });
      } else {
        doc.text(txt, x + 2, y + 4);
      }
      x += w;
    });
    y += rowH;
  });

  return y + 2;
}

function drawTotalRow(doc: any, y: number, margin: number, cw: number, label: string, value: string, color: readonly number[]): number {
  doc.setFillColor(240, 245, 240);
  doc.rect(margin, y, cw, 7, "F");
  doc.setFontSize(8);
  doc.setTextColor(30, 30, 30);
  doc.text(label, margin + 2, y + 5, { maxWidth: cw * 0.7 });
  doc.setTextColor(...color);
  doc.text(value, margin + cw - 2, y + 5, { align: "right" });
  return y + 10;
}

function warningBox(doc: any, text: string, y: number, margin: number, cw: number, color: readonly number[]): number {
  doc.setFillColor(253, 236, 234);
  doc.rect(margin, y, cw, 10, "F");
  doc.setFillColor(...color);
  doc.rect(margin, y, 1.5, 10, "F");
  doc.setFontSize(7);
  doc.setTextColor(...color);
  doc.text(text, margin + 4, y + 6, { maxWidth: cw - 6 });
  return y + 13;
}

function infoBox(doc: any, text: string, y: number, margin: number, cw: number): number {
  doc.setFillColor(213, 232, 240);
  doc.rect(margin, y, cw, 10, "F");
  doc.setFillColor(46, 117, 182);
  doc.rect(margin, y, 1.5, 10, "F");
  doc.setFontSize(7);
  doc.setTextColor(46, 117, 182);
  doc.text(text, margin + 4, y + 6, { maxWidth: cw - 6 });
  return y + 13;
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

function r2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" }, status }
  );
}
