import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatDate } from "@/lib/format";
import { toast } from "sonner";
import { ShieldCheck, AlertTriangle, Percent, Tag } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const REGIME_PRESETS = [
  { key: "R1", defaultLabel: "Regime Forfettario", defaultAliquota: 15 },
  { key: "R2", defaultLabel: "Regime Ordinario", defaultAliquota: 23 },
  { key: "R3", defaultLabel: "Regime Semplificato", defaultAliquota: 5 },
];

const ATECO_PRESETS = [
  { label: "Consulenti, freelancer, IT, professionisti", value: "78" },
  { label: "Agenti di commercio, mediatori", value: "62" },
  { label: "Artigiani, costruzioni", value: "40" },
  { label: "Commercianti", value: "40" },
  { label: "Servizi di alloggio e ristorazione", value: "40" },
  { label: "Attività professionali con albo", value: "78" },
  { label: "Attività immobiliari", value: "86" },
  { label: "Agricoltura, pesca", value: "25" },
];

export default function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const [regimes, setRegimes] = useState(
    REGIME_PRESETS.map((p) => ({ key: p.key, label: p.defaultLabel, aliquota: String(p.defaultAliquota) }))
  );
  const [confirmDialog, setConfirmDialog] = useState<{ key: string; label: string; aliquota: number } | null>(null);
  const [a3Category, setA3Category] = useState("");
  const [a3Threshold, setA3Threshold] = useState("");
  const [a5Threshold, setA5Threshold] = useState("");
  const [taxRates, setTaxRates] = useState({ iva: "", irpef: "", inps: "" });
  const [atecoCoefficient, setAtecoCoefficient] = useState("78");
  const [savingRates, setSavingRates] = useState(false);

  const { data: categories, isLoading: loadingCats } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: taxHistory, isLoading: loadingHistory } = useQuery({
    queryKey: ["tax-regime-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tax_regime_history")
        .select("*")
        .order("valid_from", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: thresholds } = useQuery({
    queryKey: ["alert-thresholds"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alert_thresholds")
        .select("*, categories(name, color)")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  useQuery({
    queryKey: ["tax-rates"],
    queryFn: async () => {
      const { data } = await supabase
        .from("tax_rates")
        .select("iva, irpef, inps, ateco_coefficient")
        .eq("user_id", user!.id)
        .single();
      if (data) {
        setTaxRates({
          iva:   data.iva   !== null ? String(Math.round(Number(data.iva)   * 100)) : "",
          irpef: data.irpef !== null ? String(Math.round(Number(data.irpef) * 100)) : "",
          inps:  data.inps  !== null ? String(Math.round(Number(data.inps)  * 100)) : "",
        });
        if ((data as any).ateco_coefficient !== null && (data as any).ateco_coefficient !== undefined) {
          setAtecoCoefficient(String(Math.round(Number((data as any).ateco_coefficient) * 100)));
        }
      }
      return data;
    },
    enabled: !!user,
  });

  const activateRegime = useMutation({
    mutationFn: async ({ key, label, aliquota }: { key: string; label: string; aliquota: number }) => {
      if (!user) throw new Error("Not authenticated");
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const validTo = yesterday.toISOString().slice(0, 10);
      const validFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;
      await supabase.from("tax_regime_history").update({ valid_to: validTo }).eq("user_id", user.id).is("valid_to", null);
      const { error } = await supabase.from("tax_regime_history").insert({
        user_id: user.id, regime_key: key, regime_label: label, aliquota: aliquota / 100, valid_from: validFrom,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tax-regime-history"] });
      queryClient.invalidateQueries({ queryKey: ["liquidity"] });
      toast.success("Regime fiscale attivato");
      setConfirmDialog(null);
    },
    onError: () => toast.error("Errore nell'attivazione del regime"),
  });

  const toggleImponibile = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: boolean }) => {
      const { error } = await supabase.from("categories").update({ is_imponibile: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success("Categoria aggiornata");
    },
  });

  const saveThreshold = useMutation({
    mutationFn: async ({ alertCode, threshold, categoryId }: { alertCode: string; threshold: number; categoryId?: string }) => {
      if (!user) throw new Error("Not authenticated");
      const q = supabase.from("alert_thresholds").delete().eq("alert_code", alertCode).eq("user_id", user.id);
      if (categoryId) { await q.eq("category_id", categoryId); } else { await q; }
      const { error } = await supabase.from("alert_thresholds").insert({
        user_id: user.id, alert_code: alertCode, threshold, category_id: categoryId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-thresholds"] });
      toast.success("Soglia salvata");
      setA3Threshold(""); setA5Threshold("");
    },
    onError: () => toast.error("Errore nel salvataggio"),
  });

  const deleteThreshold = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("alert_thresholds").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-thresholds"] });
      toast.success("Soglia rimossa");
    },
  });

  const updateRegimeField = (key: string, field: "label" | "aliquota", value: string) => {
    setRegimes((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const activeRegime = taxHistory?.find((r) => !r.valid_to);

  const saveTaxRates = async () => {
    if (!user) return;
    setSavingRates(true);
    try {
      const payload: any = {
        user_id: user.id,
        iva:   taxRates.iva   ? Number(taxRates.iva)   / 100 : null,
        irpef: taxRates.irpef ? Number(taxRates.irpef) / 100 : null,
        inps:  taxRates.inps  ? Number(taxRates.inps)  / 100 : null,
        ateco_coefficient: atecoCoefficient ? Number(atecoCoefficient) / 100 : 0.78,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("tax_rates").upsert(payload, { onConflict: "user_id" });
      if (error) throw error;
      queryClient.invalidateQueries({ queryKey: ["tax-rates"] });
      queryClient.invalidateQueries({ queryKey: ["liquidity"] });
      toast.success("Aliquote e coefficiente ATECO salvati");
    } catch {
      toast.error("Errore nel salvataggio");
    }
    setSavingRates(false);
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-24">
      <h1 className="text-3xl font-bold tracking-tight text-[#1e3a5f]">Impostazioni Fiscali</h1>

      {/* Regime Fiscale */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2 text-[#1e3a5f]"><ShieldCheck className="h-5 w-5" />Regime Fiscale</h2>
          <p className="text-sm text-muted-foreground">Configura il regime fiscale per il calcolo della liquidità reale.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {regimes.map((r) => {
            const isActive = activeRegime?.regime_key === r.key;
            return (
              <div
                key={r.key}
                className={`rounded-2xl bg-white border-2 overflow-hidden shadow-sm ${
                  isActive ? "border-[#16a34a]" : "border-gray-200"
                }`}
              >
                <div
                  className={`px-4 py-3 flex items-center justify-between ${
                    isActive ? "bg-[#16a34a]" : "bg-[#1e3a5f]"
                  }`}
                >
                  <h3 className="text-white font-semibold text-sm">
                    {r.key} - {r.label}
                  </h3>
                  {isActive && (
                    <span className="text-xs font-semibold text-white bg-white/20 rounded-full px-2 py-0.5">
                      Attivo
                    </span>
                  )}
                </div>
                <div className="p-4 space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Nome</Label>
                    <Input
                      value={r.label}
                      onChange={(e) => updateRegimeField(r.key, "label", e.target.value)}
                      className="h-10 rounded-lg"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs text-muted-foreground">Aliquota %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={r.aliquota}
                      onChange={(e) => updateRegimeField(r.key, "aliquota", e.target.value)}
                      className="h-10 rounded-lg tabular-nums"
                    />
                  </div>
                  <Button
                    className={`w-full h-11 rounded-lg text-white font-semibold ${
                      isActive
                        ? "bg-[#16a34a] hover:bg-[#16a34a]/90"
                        : "bg-[#1e3a5f] hover:bg-[#1e3a5f]/90"
                    }`}
                    disabled={isActive}
                    onClick={() => {
                      const aliq = Number(r.aliquota);
                      if (isNaN(aliq) || aliq < 0 || aliq > 100) {
                        toast.error("Aliquota non valida (0-100)");
                        return;
                      }
                      setConfirmDialog({ key: r.key, label: r.label, aliquota: aliq });
                    }}
                  >
                    {isActive ? "Attivo" : "Attiva"}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Aliquote analitiche + ATECO */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Percent className="h-5 w-5 text-primary" />Aliquote fiscali analitiche
          </h2>
          <p className="text-sm text-muted-foreground">
            Breakdown IVA / IRPEF / INPS. Il coefficiente ATECO riduce la base imponibile nel forfettario.
          </p>
        </div>
        <Card>
          <CardContent className="pt-6 space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <Label className="text-sm">🧾 IVA <span className="text-muted-foreground font-normal text-xs">(% entrate imponibili)</span></Label>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={0} max={100} value={taxRates.iva} onChange={(e) => setTaxRates((r) => ({ ...r, iva: e.target.value }))} placeholder="0" className="h-9 tabular-nums" />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">📊 IRPEF <span className="text-muted-foreground font-normal text-xs">(% sul reddito)</span></Label>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={0} max={100} value={taxRates.irpef} onChange={(e) => setTaxRates((r) => ({ ...r, irpef: e.target.value }))} placeholder="15" className="h-9 tabular-nums" />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-sm">🛡️ INPS <span className="text-muted-foreground font-normal text-xs">(% contributi)</span></Label>
                <div className="flex items-center gap-1.5">
                  <Input type="number" min={0} max={100} value={taxRates.inps} onChange={(e) => setTaxRates((r) => ({ ...r, inps: e.target.value }))} placeholder="26" className="h-9 tabular-nums" />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </div>
            </div>

            <Separator />

            {/* Coefficiente ATECO */}
            <div className="space-y-3">
              <div>
                <Label className="text-sm font-medium">
                  📋 Coefficiente di redditività ATECO{" "}
                  <span className="text-muted-foreground font-normal text-xs">(solo regime forfettario)</span>
                </Label>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Riduce la base imponibile. Es. 78%: su €10.000 incassati, l'imponibile IRPEF è €7.800.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Preset per attività</Label>
                <Select value="" onValueChange={(v) => setAtecoCoefficient(v)}>
                  <SelectTrigger className="h-9">
                    <SelectValue placeholder="Scegli attività per precompilare..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ATECO_PRESETS.map((p) => (
                      <SelectItem key={p.value + p.label} value={p.value}>
                        {p.label} — {p.value}%
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Input
                  type="number" min={1} max={100}
                  value={atecoCoefficient}
                  onChange={(e) => setAtecoCoefficient(e.target.value)}
                  className="h-9 tabular-nums w-28"
                  placeholder="78"
                />
                <span className="text-sm text-muted-foreground">%</span>
                <span className="text-xs text-muted-foreground ml-2">
                  Su €10.000 → imponibile €{Math.round(10000 * Number(atecoCoefficient || 0) / 100).toLocaleString("it-IT")}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-border">
              <p className="text-xs text-muted-foreground">
                Accantonamento totale:{" "}
                <strong>{[taxRates.iva, taxRates.irpef, taxRates.inps].filter(Boolean).reduce((s, v) => s + Number(v), 0)}%</strong>
                {" "}· Coefficiente ATECO: <strong>{atecoCoefficient || 78}%</strong>
              </p>
              <Button size="sm" onClick={saveTaxRates} disabled={savingRates}>
                {savingRates ? "Salvataggio…" : "Salva"}
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Categorie Imponibili */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2 text-[#1e3a5f]"><Tag className="h-5 w-5" />Categorie Imponibili</h2>
          <p className="text-sm text-muted-foreground">Le entrate con queste categorie verranno incluse nel calcolo dell'accantonamento fiscale.</p>
        </div>
        {loadingCats ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories?.filter((c) => c.type === "income").map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between bg-white border border-gray-200 rounded-xl px-4 py-3 shadow-sm"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="h-3 w-3 rounded-full shrink-0"
                    style={{ backgroundColor: c.color || "#94a3b8" }}
                  />
                  <span className="text-sm font-medium text-[#1e3a5f] truncate">{c.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-medium ${c.is_imponibile ? "text-[#16a34a]" : "text-muted-foreground"}`}>
                    {c.is_imponibile ? "On" : "Off"}
                  </span>
                  <Switch
                    checked={c.is_imponibile}
                    onCheckedChange={(v) => toggleImponibile.mutate({ id: c.id, value: v })}
                    className="data-[state=checked]:bg-[#16a34a]"
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Storico Regimi */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold text-[#1e3a5f]">Storico Regimi</h2>
        <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
          {loadingHistory ? (
            <div className="p-4"><Skeleton className="h-24 w-full" /></div>
          ) : !taxHistory?.length ? (
            <div className="p-6 text-center text-muted-foreground text-sm">Nessun regime configurato.</div>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader className="bg-[#1e3a5f]/5">
                  <TableRow>
                    <TableHead className="text-[#1e3a5f] font-semibold">Codice</TableHead>
                    <TableHead className="text-[#1e3a5f] font-semibold">Nome</TableHead>
                    <TableHead className="text-[#1e3a5f] font-semibold">Aliquota</TableHead>
                    <TableHead className="text-[#1e3a5f] font-semibold">Da</TableHead>
                    <TableHead className="text-[#1e3a5f] font-semibold">A</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxHistory.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><Badge variant="outline" className="border-[#1e3a5f] text-[#1e3a5f]">{r.regime_key}</Badge></TableCell>
                      <TableCell className="text-sm">{r.regime_label}</TableCell>
                      <TableCell className="text-sm tabular-nums">{Math.round(Number(r.aliquota) * 100)}%</TableCell>
                      <TableCell className="text-sm">{formatDate(r.valid_from)}</TableCell>
                      <TableCell className="text-sm">{r.valid_to ? formatDate(r.valid_to) : <Badge className="bg-[#16a34a] hover:bg-[#16a34a] text-white text-xs">Attivo</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </section>

      <Separator />

      {/* Alert Thresholds */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2 text-[#1e3a5f]"><AlertTriangle className="h-5 w-5 text-warning" />Soglie Alert</h2>
          <p className="text-sm text-muted-foreground">Configura le soglie per ricevere notifiche automatiche.</p>
        </div>
        <Card className="rounded-2xl border border-gray-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-[#1e3a5f]">A3 — Limite spesa per categoria</CardTitle>
            <CardDescription className="text-xs">Ricevi un avviso quando la spesa mensile di una categoria supera la soglia.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1 flex-1 min-w-[180px]">
                <Label className="text-xs">Categoria</Label>
                <Select value={a3Category} onValueChange={setA3Category}>
                  <SelectTrigger className="h-10 rounded-lg text-sm"><SelectValue placeholder="Seleziona..." /></SelectTrigger>
                  <SelectContent>
                    {categories?.filter((c) => c.type === "expense").map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        <span className="flex items-center gap-2">
                          {c.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />}
                          {c.name}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Soglia (€)</Label>
                <Input type="number" min={1} value={a3Threshold} onChange={(e) => setA3Threshold(e.target.value)} className="w-[140px] h-10 rounded-lg text-sm tabular-nums" placeholder="500" />
              </div>
              <Button
                className="h-10 px-6 rounded-lg bg-[#16a34a] hover:bg-[#16a34a]/90 text-white font-semibold"
                disabled={!a3Category || !a3Threshold || saveThreshold.isPending}
                onClick={() => saveThreshold.mutate({ alertCode: "A3", threshold: Number(a3Threshold), categoryId: a3Category })}
              >
                Salva
              </Button>
            </div>
            {thresholds?.filter((t) => t.alert_code === "A3").map((t) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50">
                <div className="flex items-center gap-2 text-sm">
                  {(t.categories as any)?.color && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: (t.categories as any).color }} />}
                  <span>{(t.categories as any)?.name || "—"}</span>
                  <span className="text-muted-foreground">≤ €{t.threshold}</span>
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => deleteThreshold.mutate(t.id)}>Rimuovi</Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="rounded-2xl border border-gray-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base text-[#1e3a5f]">A5 — Variazione saldo</CardTitle>
            <CardDescription className="text-xs">Ricevi un avviso quando il saldo varia più della percentuale indicata rispetto al periodo precedente.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Percentuale %</Label>
                <Input type="number" min={1} max={100} value={a5Threshold} onChange={(e) => setA5Threshold(e.target.value)} className="w-[140px] h-10 rounded-lg text-sm tabular-nums" placeholder="20" />
              </div>
              <Button
                className="h-10 px-6 rounded-lg bg-[#16a34a] hover:bg-[#16a34a]/90 text-white font-semibold"
                disabled={!a5Threshold || saveThreshold.isPending}
                onClick={() => saveThreshold.mutate({ alertCode: "A5", threshold: Number(a5Threshold) })}
              >
                Salva
              </Button>
            </div>
            {thresholds?.filter((t) => t.alert_code === "A5").map((t) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50 mt-2">
                <span className="text-sm text-muted-foreground">Soglia: {t.threshold}%</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => deleteThreshold.mutate(t.id)}>Rimuovi</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* Confirm Dialog */}
      <Dialog open={!!confirmDialog} onOpenChange={() => setConfirmDialog(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conferma attivazione regime</DialogTitle>
            <DialogDescription>
              Attivare <strong>{confirmDialog?.label}</strong> con aliquota <strong>{confirmDialog?.aliquota}%</strong>? Avrà effetto dal mese corrente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDialog(null)}>Annulla</Button>
            <Button disabled={activateRegime.isPending} onClick={() => confirmDialog && activateRegime.mutate(confirmDialog)}>Conferma</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
