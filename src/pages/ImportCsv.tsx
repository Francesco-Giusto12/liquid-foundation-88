import { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, startOfMonth } from "date-fns";
import { Upload, FileSpreadsheet, CheckCircle, AlertTriangle } from "lucide-react";
import { importCsv, calculateLiquidity, evaluateAlerts } from "@/lib/edge-functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { FiscalBreakdown } from "@/components/FiscalBreakdown";

interface PreviewData {
  headers: string[];
  mapping: Record<string, string | null>;
  preview: any[];
  total_rows: number;
  error_count: number;
  errors: any[];
}

interface ImportResult {
  imported_count: number;
  duplicate_count: number;
  error_count: number;
  import_hashes?: string[];
}

// Tipo per i dati di liquidità post-import
interface LiquiditySnapshot {
  bt: number;
  e_tax: number;
  f: number;
  lr: number;
  breakdown: {
    f_iva: number;
    f_irpef: number;
    f_inps: number;
    alpha_iva: number | null;
    alpha_irpef: number | null;
    alpha_inps: number | null;
  };
}

export default function ImportCsv() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [liquiditySnapshot, setLiquiditySnapshot] = useState<LiquiditySnapshot | null>(null);
  const [needsMapping, setNeedsMapping] = useState(false);
  const [mappingError, setMappingError] = useState<string | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [availableHeaders, setAvailableHeaders] = useState<string[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("id, name, type").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  useEffect(() => {
    if (accounts?.length === 1 && !selectedAccountId) {
      setSelectedAccountId(accounts[0].id);
    }
  }, [accounts]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) {
      setFile(f);
      setPreview(null);
      setResult(null);
      setLiquiditySnapshot(null);
      setNeedsMapping(false);
    }
  };

  const handlePreview = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const res = await importCsv(file, false);
      if (res.error === "date_column_not_detected" || res.error === "amount_column_not_detected") {
        setNeedsMapping(true);
        setMappingError(res.message);
        setAvailableHeaders(res.headers);
        setMapping({ date_col: "", amount_col: "" });
      } else if (res.success) {
        setPreview(res);
        setNeedsMapping(false);
        if (res.mapping) {
          setMapping({
            date_col: res.mapping.date_col || "",
            amount_col: res.mapping.amount_col || "",
            desc_col: res.mapping.desc_col || "",
            ...(res.mapping.credit_col ? { credit_col: res.mapping.credit_col } : {}),
            ...(res.mapping.debit_col ? { debit_col: res.mapping.debit_col } : {}),
          });
        }
      }
    } catch { toast.error("Errore durante l'anteprima"); }
    setLoading(false);
  };

  const handleConfirm = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const m = Object.keys(mapping).length > 0 ? mapping : preview?.mapping;
      const res = await importCsv(file, true, m ?? undefined);
      if (res.success) {
        if (selectedAccountId && user) {
          await supabase
            .from("transactions")
            .update({ account_id: selectedAccountId })
            .is("account_id", null)
            .eq("user_id", user.id);
        }
        setResult(res);
        setPreview(null);
        toast.success(`${res.imported_count} transazioni importate`);
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["accounts"] });
        queryClient.invalidateQueries({ queryKey: ["account-tx-sums"] });

        // ── Calcola liquidità e salva snapshot per breakdown ──
        const period = format(startOfMonth(new Date()), "yyyy-MM-dd");
        const liquidityRes = await calculateLiquidity(period);
        queryClient.invalidateQueries({ queryKey: ["liquidity"] });
        evaluateAlerts(period).then(() => queryClient.invalidateQueries({ queryKey: ["alerts"] }));

        if (liquidityRes?.data) {
          setLiquiditySnapshot({
            bt: liquidityRes.data.bt ?? 0,
            e_tax: liquidityRes.data.e_tax ?? 0,
            f: liquidityRes.data.f ?? 0,
            lr: liquidityRes.data.lr ?? 0,
            breakdown: liquidityRes.data.breakdown ?? {
              f_iva: 0, f_irpef: 0, f_inps: 0,
              alpha_iva: null, alpha_irpef: null, alpha_inps: null,
            },
          });
        }
      }
    } catch (err) {
      console.error("[ImportCsv] confirm error:", err);
      toast.error("Errore durante l'importazione");
    }
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Importa CSV</h1>

      {/* Upload */}
      <Card>
        <CardContent className="pt-6">
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer hover:border-secondary transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">{file ? file.name : "Clicca per selezionare un file CSV"}</p>
            <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleFileSelect} />
          </div>
          {file && !preview && !result && (
            <Button className="mt-4 w-full" onClick={handlePreview} disabled={loading}>
              {loading ? "Analisi in corso…" : "Anteprima"}
            </Button>
          )}
        </CardContent>
      </Card>

      {/* Mapping error */}
      {needsMapping && (
        <Card>
          <CardHeader><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-[hsl(var(--warning))]" />Mapping colonne richiesto</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">{mappingError}</p>
            <div className="grid gap-3">
              <div>
                <Label>Colonna Data</Label>
                <Select onValueChange={(v) => setMapping(m => ({ ...m, date_col: v }))} value={mapping.date_col}>
                  <SelectTrigger><SelectValue placeholder="Seleziona…" /></SelectTrigger>
                  <SelectContent>{availableHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Colonna Importo</Label>
                <Select onValueChange={(v) => setMapping(m => ({ ...m, amount_col: v }))} value={mapping.amount_col}>
                  <SelectTrigger><SelectValue placeholder="Seleziona…" /></SelectTrigger>
                  <SelectContent>{availableHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label>Colonna Descrizione (opzionale)</Label>
                <Select onValueChange={(v) => setMapping(m => ({ ...m, desc_col: v }))} value={mapping.desc_col ?? ""}>
                  <SelectTrigger><SelectValue placeholder="Seleziona…" /></SelectTrigger>
                  <SelectContent>{availableHeaders.map(h => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
            {accounts && accounts.length > 1 && (
              <div>
                <Label>Conto di destinazione</Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger><SelectValue placeholder="Seleziona un conto…" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button className="w-full" disabled={!mapping.date_col || !mapping.amount_col || loading} onClick={handleConfirm}>
              {loading ? "Importazione…" : "Importa con questo mapping"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Preview */}
      {preview && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileSpreadsheet className="h-4 w-4" />
              Anteprima ({preview.total_rows} righe)
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <Badge variant="secondary">Data: {preview.mapping.date_col}</Badge>
              <Badge variant="secondary">Importo: {preview.mapping.amount_col || `${preview.mapping.credit_col}/${preview.mapping.debit_col}`}</Badge>
              {preview.mapping.desc_col && <Badge variant="secondary">Desc: {preview.mapping.desc_col}</Badge>}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-2 px-2">Data</th>
                    <th className="text-right py-2 px-2">Importo</th>
                    <th className="text-left py-2 px-2">Descrizione</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.preview.map((r: any, i: number) => (
                    <tr key={i} className="border-b last:border-0">
                      <td className="py-2 px-2">{r.date}</td>
                      <td className={`py-2 px-2 text-right tabular-nums font-medium ${r.amount > 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                        {r.amount > 0 ? "+" : ""}{r.amount.toFixed(2)}
                      </td>
                      <td className="py-2 px-2 truncate max-w-[200px]">{r.description || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {preview.error_count > 0 && (
              <p className="text-xs text-[hsl(var(--warning))]">⚠ {preview.error_count} righe con errori saranno ignorate</p>
            )}
            {accounts && accounts.length > 1 && (
              <div>
                <Label className="text-sm font-medium">Conto di destinazione</Label>
                <Select value={selectedAccountId} onValueChange={setSelectedAccountId}>
                  <SelectTrigger><SelectValue placeholder="Seleziona un conto…" /></SelectTrigger>
                  <SelectContent>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button className="w-full" onClick={handleConfirm} disabled={loading}>
              {loading ? "Importazione…" : `Importa ${preview.total_rows - preview.error_count} transazioni`}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── Result + Breakdown fiscale ── */}
      {result && (
        <>
          <Card>
            <CardContent className="pt-6 text-center space-y-3">
              <CheckCircle className="h-12 w-12 mx-auto text-[hsl(var(--success))]" />
              <h3 className="font-semibold text-lg">Importazione completata</h3>
              <div className="flex justify-center gap-4 text-sm">
                <span><strong>{result.imported_count}</strong> importate</span>
                <span className="text-muted-foreground"><strong>{result.duplicate_count}</strong> duplicate</span>
                <span className="text-muted-foreground"><strong>{result.error_count}</strong> errori</span>
              </div>
            </CardContent>
          </Card>

          {/* Breakdown fiscale — mostrato subito dopo l'import */}
          {liquiditySnapshot && (
            <FiscalBreakdown
              totalBalance={liquiditySnapshot.bt}
              taxableIncome={liquiditySnapshot.e_tax}
              totalProvision={liquiditySnapshot.f}
              liquidita={liquiditySnapshot.lr}
              breakdown={liquiditySnapshot.breakdown}
              variant="full"
            />
          )}

          <div className="text-center">
            <Button
              variant="outline"
              onClick={() => {
                setFile(null);
                setResult(null);
                setLiquiditySnapshot(null);
                setSelectedAccountId("");
              }}
            >
              Importa un altro file
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
