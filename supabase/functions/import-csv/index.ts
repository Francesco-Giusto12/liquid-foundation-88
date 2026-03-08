// supabase/functions/import-csv/index.ts
//
// Edge Function: Import e Parsing CSV
// Metodo: POST (multipart/form-data)
// Auth: richiesta (Bearer token)
//
// FormData fields:
//   file: File (il CSV)
//   confirm: "true" | "false"  — false = solo anteprima, true = import reale
//   mapping: JSON string (opzionale, override del mapping auto-rilevato)
//   {
//     date_col: string,      // nome colonna data
//     amount_col: string,    // nome colonna importo
//     desc_col: string,      // nome colonna descrizione (opzionale)
//     credit_col: string,    // alternativa: colonna avere (opzionale)
//     debit_col: string      // alternativa: colonna dare (opzionale)
//   }
//
// Come aggiungere in Lovable:
// 1. Apri sezione "Edge functions" nel pannello Cloud
// 2. Clicca "Add edge function"
// 3. Nome funzione: import-csv
// 4. Sostituisci tutto il contenuto con questo file

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const MAX_FILE_SIZE   = 10 * 1024 * 1024; // 10 MB
const MAX_ROWS        = 10_000;
const MAX_AMOUNT      = 9_999_999.99;
const PREVIEW_ROWS    = 5;

// ── Alias colonne per auto-detect ────────────────────────────
const DATE_ALIASES    = ["data","date","data valuta","data contabile",
                         "data operazione","booking date","value date",
                         "transaction date","data mov"];
const AMOUNT_ALIASES  = ["importo","amount","valore","totale","total",
                         "saldo","balance","movimento","mov"];
const DESC_ALIASES    = ["descrizione","description","causale","note",
                         "notes","dettaglio","detail","merchant",
                         "beneficiario","payee"];
const CREDIT_ALIASES  = ["avere","accredito","credit","entrata","income"];
const DEBIT_ALIASES   = ["dare","addebito","debit","uscita","expense"];

// Formati data supportati con regex + parser
const DATE_FORMATS = [
  { re: /^\d{4}-\d{2}-\d{2}$/, parse: (s:string) => s },
  { re: /^\d{2}\/\d{2}\/\d{4}$/, parse: (s:string) => {
      const [d,m,y] = s.split("/"); return `${y}-${m}-${d}`; }},
  { re: /^\d{2}-\d{2}-\d{4}$/, parse: (s:string) => {
      const [d,m,y] = s.split("-"); return `${y}-${m}-${d}`; }},
  { re: /^\d{2}\.\d{2}\.\d{4}$/, parse: (s:string) => {
      const [d,m,y] = s.split("."); return `${y}-${m}-${d}`; }},
];

// ── Tipi ─────────────────────────────────────────────────────

interface ColumnMapping {
  date_col:    string;
  amount_col:  string | null;
  credit_col:  string | null;
  debit_col:   string | null;
  desc_col:    string | null;
}

interface ParsedRow {
  date:        string;   // ISO YYYY-MM-DD
  amount:      number;   // con segno
  description: string;
  import_hash: string;
}

interface RowError {
  row_number: number;
  raw:        string;
  reason:     string;
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

    // ── Parsing multipart ───────────────────────────────────
    const formData = await req.formData().catch(() => null);
    if (!formData) return errorResponse(400, "Expected multipart/form-data");

    const file    = formData.get("file") as File | null;
    const confirm = formData.get("confirm") === "true";
    const mappingRaw = formData.get("mapping") as string | null;

    if (!file) return errorResponse(400, "Missing file field");
    if (file.size > MAX_FILE_SIZE) return errorResponse(400, "File exceeds 10MB limit");

    // ── Lettura file con rilevamento encoding ───────────────
    const buffer = await file.arrayBuffer();
    const raw = decodeBuffer(buffer);

    // ── Rilevamento separatore ──────────────────────────────
    const separator = detectSeparator(raw);

    // ── Parsing CSV → righe/colonne ─────────────────────────
    const allLines = raw.split(/\r?\n/).filter(l => l.trim() !== "");
    if (allLines.length < 2) {
      return errorResponse(400, "File contains no data rows");
    }
    if (allLines.length - 1 > MAX_ROWS) {
      return errorResponse(400, `File exceeds ${MAX_ROWS} rows limit`);
    }

    // Prima riga = intestazione?
    const firstRowCells = parseCsvLine(allLines[0], separator);
    const hasHeader = firstRowCells.every(c => !isNumeric(c) && !isDateLike(c));
    const headers   = hasHeader
      ? firstRowCells.map(h => h.trim().toLowerCase())
      : firstRowCells.map((_, i) => `colonna_${i + 1}`);
    const dataLines = hasHeader ? allLines.slice(1) : allLines;

    // ── Mapping colonne ─────────────────────────────────────
    let mapping: ColumnMapping;

    if (mappingRaw) {
      // Mapping fornito dall'utente (override)
      const userMapping = JSON.parse(mappingRaw);
      mapping = {
        date_col:   userMapping.date_col,
        amount_col: userMapping.amount_col ?? null,
        credit_col: userMapping.credit_col ?? null,
        debit_col:  userMapping.debit_col  ?? null,
        desc_col:   userMapping.desc_col   ?? null,
      };
    } else {
      mapping = autoDetectMapping(headers);
    }

    // Verifica colonne obbligatorie
    if (!mapping.date_col) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "date_column_not_detected",
          message: "Impossibile rilevare la colonna data. Specifica il mapping manualmente.",
          headers,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    const hasAmountColumn = !!mapping.amount_col;
    const hasSplitColumns = !!(mapping.credit_col && mapping.debit_col);

    if (!hasAmountColumn && !hasSplitColumns) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "amount_column_not_detected",
          message: "Impossibile rilevare la colonna importo. Specifica il mapping manualmente.",
          headers,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 422 }
      );
    }

    // ── Parsing righe ───────────────────────────────────────
    const dateColIdx    = headers.indexOf(mapping.date_col);
    const amountColIdx  = mapping.amount_col  ? headers.indexOf(mapping.amount_col)  : -1;
    const creditColIdx  = mapping.credit_col  ? headers.indexOf(mapping.credit_col)  : -1;
    const debitColIdx   = mapping.debit_col   ? headers.indexOf(mapping.debit_col)   : -1;
    const descColIdx    = mapping.desc_col    ? headers.indexOf(mapping.desc_col)    : -1;

    const parsed:    ParsedRow[] = [];
    const rowErrors: RowError[]  = [];
    const today = new Date().toISOString().split("T")[0];

    for (let i = 0; i < dataLines.length; i++) {
      const rowNum = hasHeader ? i + 2 : i + 1;
      const cells  = parseCsvLine(dataLines[i], separator);

      // ── Data ──────────────────────────────────────────────
      const rawDate = cells[dateColIdx]?.trim() ?? "";
      const isoDate = parseDate(rawDate);

      if (!isoDate) {
        rowErrors.push({ row_number: rowNum, raw: dataLines[i], reason: `Data non valida: "${rawDate}"` });
        continue;
      }
      if (isoDate > today) {
        rowErrors.push({ row_number: rowNum, raw: dataLines[i], reason: `Data futura non ammessa: "${rawDate}"` });
        continue;
      }

      // ── Importo ───────────────────────────────────────────
      let amount: number;

      if (hasAmountColumn) {
        const rawAmt = cells[amountColIdx]?.trim() ?? "";
        const parsed_amt = parseAmount(rawAmt);
        if (parsed_amt === null) {
          rowErrors.push({ row_number: rowNum, raw: dataLines[i], reason: `Importo non valido: "${rawAmt}"` });
          continue;
        }
        amount = parsed_amt;
      } else {
        // Colonne dare/avere separate
        const rawCredit = cells[creditColIdx]?.trim() ?? "0";
        const rawDebit  = cells[debitColIdx]?.trim()  ?? "0";
        const credit    = parseAmount(rawCredit) ?? 0;
        const debit     = parseAmount(rawDebit)  ?? 0;
        amount = credit - debit;
      }

      if (amount === 0) {
        rowErrors.push({ row_number: rowNum, raw: dataLines[i], reason: "Importo zero ignorato" });
        continue;
      }
      if (Math.abs(amount) > MAX_AMOUNT) {
        rowErrors.push({ row_number: rowNum, raw: dataLines[i], reason: `Importo fuori range: ${amount}` });
        continue;
      }

      // ── Descrizione ───────────────────────────────────────
      const description = descColIdx >= 0
        ? (cells[descColIdx]?.trim() ?? "")
        : "";

      // ── Hash deduplicazione ───────────────────────────────
      const import_hash = await sha256(`${isoDate}|${amount}|${description}`);

      parsed.push({ date: isoDate, amount, description, import_hash });
    }

    // ── Anteprima (confirm = false) ─────────────────────────
    if (!confirm) {
      return new Response(
        JSON.stringify({
          success: true,
          mode: "preview",
          mapping,
          headers,
          separator,
          total_rows: dataLines.length,
          preview: parsed.slice(0, PREVIEW_ROWS),
          error_count: rowErrors.length,
          errors: rowErrors.slice(0, 10),
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

    // ── Import reale (confirm = true) ───────────────────────

    // Controlla duplicati in batch
    const hashes = parsed.map(r => r.import_hash);
    const { data: existingHashes } = await supabase
      .from("transactions")
      .select("import_hash")
      .eq("user_id", user.id)
      .in("import_hash", hashes);

    const existingSet = new Set((existingHashes ?? []).map((r:any) => r.import_hash));

    const toInsert = parsed.filter(r => !existingSet.has(r.import_hash));
    const duplicate_count = parsed.length - toInsert.length;

    // Inserisce in batch da 200 righe
    let imported_count = 0;
    const BATCH = 200;

    for (let i = 0; i < toInsert.length; i += BATCH) {
      const batch = toInsert.slice(i, i + BATCH).map(r => ({
        user_id:     user.id,
        amount:      r.amount,
        date:        r.date,
        description: r.description,
        import_hash: r.import_hash,
        type:        r.amount > 0 ? "income" : "expense",
      }));

      const { error: insertError } = await supabase
        .from("transactions")
        .insert(batch);

      if (insertError) {
        console.error("Insert batch error:", JSON.stringify(insertError));
      } else {
        imported_count += batch.length;
      }
    }

    // Audit log
    await supabase.from("audit_logs").insert({
      user_id:       user.id,
      action:        "csv_imported",
      resource_type: "transactions",
      metadata: {
        total_rows:      dataLines.length,
        imported:        imported_count,
        duplicates:      duplicate_count,
        errors:          rowErrors.length,
        filename:        file.name,
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        mode: "import",
        total_rows:     dataLines.length,
        imported_count,
        duplicate_count,
        error_count:    rowErrors.length,
        errors:         rowErrors.slice(0, 50), // max 50 errori esposti
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );

  } catch (err) {
    console.error("import-csv error:", err);
    return errorResponse(500, "Internal server error");
  }
});

// ── Parsing utilities ─────────────────────────────────────────

function decodeBuffer(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // BOM check
  if (bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF) {
    return new TextDecoder("utf-8").decode(buffer.slice(3));
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    return decoded;
  } catch {
    return new TextDecoder("iso-8859-1").decode(buffer);
  }
}

function detectSeparator(raw: string): string {
  const sample = raw.split(/\r?\n/).slice(0, 5).join("\n");
  const counts = {
    ",":  (sample.match(/,/g)  || []).length,
    ";":  (sample.match(/;/g)  || []).length,
    "\t": (sample.match(/\t/g) || []).length,
  };
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}

function parseCsvLine(line: string, sep: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (ch === sep && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function autoDetectMapping(headers: string[]): ColumnMapping {
  const find = (aliases: string[]) =>
    headers.find(h => aliases.includes(h)) ?? null;

  return {
    date_col:   find(DATE_ALIASES)   ?? "",
    amount_col: find(AMOUNT_ALIASES),
    credit_col: find(CREDIT_ALIASES),
    debit_col:  find(DEBIT_ALIASES),
    desc_col:   find(DESC_ALIASES),
  };
}

function parseDate(raw: string): string | null {
  for (const fmt of DATE_FORMATS) {
    if (fmt.re.test(raw)) {
      const iso = fmt.parse(raw);
      if (!isNaN(Date.parse(iso))) return iso;
    }
  }
  return null;
}

function parseAmount(raw: string): number | null {
  // Rimuove simboli valuta, spazi, gestisce notazione italiana (1.234,56) e inglese (1,234.56)
  let s = raw.replace(/[€$£\s]/g, "").trim();
  // Gestisce segno testuale
  let sign = 1;
  if (s.startsWith("-") || s.toLowerCase().includes("dare") || s.toLowerCase().includes("adde")) {
    sign = -1;
    s = s.replace(/[^0-9.,]/g, "");
  } else {
    s = s.replace(/[^0-9.,]/g, "");
  }

  // Notazione italiana: 1.234,56
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    s = s.replace(/\./g, "").replace(",", ".");
  }
  // Notazione con solo virgola decimale
  else if (/^\d+(,\d{1,2})$/.test(s)) {
    s = s.replace(",", ".");
  }
  // Altrimenti rimuove virgole (notazione inglese)
  else {
    s = s.replace(/,/g, "");
  }

  const n = parseFloat(s);
  return isNaN(n) ? null : round2(n * sign);
}

function isNumeric(s: string): boolean {
  return !isNaN(parseFloat(s.replace(/[€$£,. ]/g, "")));
}

function isDateLike(s: string): boolean {
  return DATE_FORMATS.some(f => f.re.test(s.trim()));
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function errorResponse(status: number, message: string): Response {
  return new Response(
    JSON.stringify({ success: false, error: message }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status }
  );
}