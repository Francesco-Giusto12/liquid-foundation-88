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

export default function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // ─── Regime state ───
  const [regimes, setRegimes] = useState(
    REGIME_PRESETS.map((p) => ({ key: p.key, label: p.defaultLabel, aliquota: String(p.defaultAliquota) }))
  );
  const [confirmDialog, setConfirmDialog] = useState<{ key: string; label: string; aliquota: number } | null>(null);

  // ─── Alert threshold state ───
  const [a3Category, setA3Category] = useState("");
  const [a3Threshold, setA3Threshold] = useState("");
  const [a5Threshold, setA5Threshold] = useState("");

  // ─── Queries ───
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

  const { data: thresholds, isLoading: loadingThresholds } = useQuery({
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

  // ─── Mutations ───
  const activateRegime = useMutation({
    mutationFn: async ({ key, label, aliquota }: { key: string; label: string; aliquota: number }) => {
      if (!user) throw new Error("Not authenticated");
      const today = new Date();
      const yesterday = new Date(today);
      yesterday.setDate(yesterday.getDate() - 1);
      const validTo = yesterday.toISOString().slice(0, 10);
      const validFrom = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-01`;

      // Close ALL active regimes
      await supabase
        .from("tax_regime_history")
        .update({ valid_to: validTo })
        .eq("user_id", user.id)
        .is("valid_to", null);

      const { error } = await supabase.from("tax_regime_history").insert({
        user_id: user.id,
        regime_key: key,
        regime_label: label,
        aliquota: aliquota / 100,
        valid_from: validFrom,
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
      // Upsert: delete old + insert new
      const q = supabase.from("alert_thresholds").delete().eq("alert_code", alertCode).eq("user_id", user.id);
      if (categoryId) {
        await q.eq("category_id", categoryId);
      } else {
        await q;
      }
      const { error } = await supabase.from("alert_thresholds").insert({
        user_id: user.id,
        alert_code: alertCode,
        threshold,
        category_id: categoryId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alert-thresholds"] });
      toast.success("Soglia salvata");
      setA3Threshold("");
      setA5Threshold("");
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

  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Impostazioni</h1>

      {/* ─── Tax Regime Section ─── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" />Regime Fiscale</h2>
          <p className="text-sm text-muted-foreground">Configura il regime fiscale per il calcolo della liquidità reale.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          {regimes.map((r) => {
            const isActive = activeRegime?.regime_key === r.key;
            return (
              <Card key={r.key} className={isActive ? "border-primary ring-1 ring-primary" : ""}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge variant={isActive ? "default" : "outline"}>{r.key}</Badge>
                    {isActive && <Badge className="bg-success text-success-foreground text-xs">Attivo</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Nome</Label>
                    <Input
                      value={r.label}
                      onChange={(e) => updateRegimeField(r.key, "label", e.target.value)}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Aliquota %</Label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={r.aliquota}
                      onChange={(e) => updateRegimeField(r.key, "aliquota", e.target.value)}
                      className="h-8 text-sm tabular-nums"
                    />
                  </div>
                  <Button
                    size="sm"
                    variant={isActive ? "secondary" : "default"}
                    className="w-full"
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
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* ─── Imponibile Categories ─── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><Tag className="h-5 w-5 text-primary" />Categorie Imponibili</h2>
          <p className="text-sm text-muted-foreground">Le entrate con queste categorie verranno incluse nel calcolo dell'accantonamento fiscale.</p>
        </div>
        <Card>
          <CardContent className="p-4">
            {loadingCats ? (
              <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <div className="space-y-1">
                {categories
                  ?.filter((c) => c.type === "income")
                  .map((c) => (
                    <div key={c.id} className="flex items-center justify-between py-2 px-2 rounded-md hover:bg-muted/50">
                      <div className="flex items-center gap-2">
                        {c.color && <span className="h-3 w-3 rounded-full" style={{ backgroundColor: c.color }} />}
                        <span className="text-sm">{c.name}</span>
                      </div>
                      <Switch
                        checked={c.is_imponibile}
                        onCheckedChange={(v) => toggleImponibile.mutate({ id: c.id, value: v })}
                      />
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* ─── Regime History ─── */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Storico Regimi</h2>
        <Card>
          {loadingHistory ? (
            <CardContent className="p-4"><Skeleton className="h-24 w-full" /></CardContent>
          ) : !taxHistory?.length ? (
            <CardContent className="p-6 text-center text-muted-foreground text-sm">Nessun regime configurato.</CardContent>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Codice</TableHead>
                    <TableHead>Nome</TableHead>
                    <TableHead>Aliquota</TableHead>
                    <TableHead>Da</TableHead>
                    <TableHead>A</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {taxHistory.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell><Badge variant="outline">{r.regime_key}</Badge></TableCell>
                      <TableCell className="text-sm">{r.regime_label}</TableCell>
                      <TableCell className="text-sm tabular-nums">{Math.round(Number(r.aliquota) * 100)}%</TableCell>
                      <TableCell className="text-sm">{formatDate(r.valid_from)}</TableCell>
                      <TableCell className="text-sm">{r.valid_to ? formatDate(r.valid_to) : <Badge className="bg-success text-success-foreground text-xs">Attivo</Badge>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </Card>
      </section>

      <Separator />

      {/* ─── Alert Thresholds ─── */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-warning" />Soglie Alert</h2>
          <p className="text-sm text-muted-foreground">Configura le soglie per ricevere notifiche automatiche.</p>
        </div>

        {/* A3 — per-category spend limit */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">A3 — Limite spesa per categoria</CardTitle>
            <CardDescription className="text-xs">Ricevi un avviso quando la spesa mensile di una categoria supera la soglia.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Categoria</Label>
                <Select value={a3Category} onValueChange={setA3Category}>
                  <SelectTrigger className="w-[180px] h-8 text-sm">
                    <SelectValue placeholder="Seleziona..." />
                  </SelectTrigger>
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
                <Input
                  type="number"
                  min={1}
                  value={a3Threshold}
                  onChange={(e) => setA3Threshold(e.target.value)}
                  className="w-[120px] h-8 text-sm tabular-nums"
                  placeholder="500"
                />
              </div>
              <Button
                size="sm"
                disabled={!a3Category || !a3Threshold || saveThreshold.isPending}
                onClick={() => saveThreshold.mutate({ alertCode: "A3", threshold: Number(a3Threshold), categoryId: a3Category })}
              >
                Salva
              </Button>
            </div>

            {/* Existing A3 thresholds */}
            {thresholds?.filter((t) => t.alert_code === "A3").map((t) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50">
                <div className="flex items-center gap-2 text-sm">
                  {(t.categories as any)?.color && (
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: (t.categories as any).color }} />
                  )}
                  <span>{(t.categories as any)?.name || "—"}</span>
                  <span className="text-muted-foreground">≤ €{t.threshold}</span>
                </div>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => deleteThreshold.mutate(t.id)}>
                  Rimuovi
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* A5 — balance variation */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">A5 — Variazione saldo</CardTitle>
            <CardDescription className="text-xs">Ricevi un avviso quando il saldo varia più della percentuale indicata rispetto al periodo precedente.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Percentuale %</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={a5Threshold}
                  onChange={(e) => setA5Threshold(e.target.value)}
                  className="w-[120px] h-8 text-sm tabular-nums"
                  placeholder="20"
                />
              </div>
              <Button
                size="sm"
                disabled={!a5Threshold || saveThreshold.isPending}
                onClick={() => saveThreshold.mutate({ alertCode: "A5", threshold: Number(a5Threshold) })}
              >
                Salva
              </Button>
            </div>
            {thresholds?.filter((t) => t.alert_code === "A5").map((t) => (
              <div key={t.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50 mt-2">
                <span className="text-sm text-muted-foreground">Soglia: {t.threshold}%</span>
                <Button size="sm" variant="ghost" className="h-7 text-xs text-destructive" onClick={() => deleteThreshold.mutate(t.id)}>
                  Rimuovi
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </section>

      {/* ─── Confirm Dialog ─── */}
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
            <Button
              disabled={activateRegime.isPending}
              onClick={() => confirmDialog && activateRegime.mutate(confirmDialog)}
            >
              Conferma
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
