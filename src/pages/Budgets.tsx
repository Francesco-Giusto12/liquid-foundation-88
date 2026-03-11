import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { format, startOfMonth, endOfMonth } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/hooks/use-toast";
import { Plus, Wallet } from "lucide-react";

export default function Budgets() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [limitAmount, setLimitAmount] = useState("");

  const now = new Date();
  const monthStart = format(startOfMonth(now), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(now), "yyyy-MM-dd");
  const periodKey = format(now, "yyyy-MM");

  // Load categories for the dialog
  const { data: categories } = useQuery({
    queryKey: ["categories-expense"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("categories")
        .select("id, name, color, type")
        .in("type", ["expense", "both"])
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Load budgets with spend calculation
  const { data: budgets, isLoading } = useQuery({
    queryKey: ["budgets-page", periodKey],
    queryFn: async () => {
      const { data: budgetData, error } = await supabase
        .from("budgets")
        .select("*, categories(name, color)")
        .eq("period", periodKey);
      if (error) throw error;

      const results = await Promise.all(
        (budgetData || []).map(async (b) => {
          const { data: txns } = await supabase
            .from("transactions")
            .select("amount")
            .eq("category_id", b.category_id)
            .eq("type", "expense")
            .gte("date", monthStart)
            .lte("date", monthEnd);
          const spent = txns?.reduce((s, t) => s + Math.abs(Number(t.amount)), 0) || 0;
          const pct = Number(b.amount) > 0 ? Math.round((spent / Number(b.amount)) * 100) : 0;
          return { ...b, spent, percentage: pct };
        })
      );
      return results;
    },
    enabled: !!user,
  });

  const createBudget = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("budgets").insert({
        user_id: user!.id,
        category_id: selectedCategory,
        amount: parseFloat(limitAmount),
        period: periodKey,
        start_date: monthStart,
        end_date: monthEnd,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["budgets-page"] });
      queryClient.invalidateQueries({ queryKey: ["budgets-progress"] });
      toast({ title: "Budget creato", description: "Il budget è stato salvato con successo." });
      setDialogOpen(false);
      setSelectedCategory("");
      setLimitAmount("");
    },
    onError: () => {
      toast({ title: "Errore", description: "Impossibile creare il budget.", variant: "destructive" });
    },
  });

  const getStatusBadge = (pct: number) => {
    if (pct > 100) return <Badge className="bg-destructive text-destructive-foreground">Superato</Badge>;
    if (pct > 75) return <Badge className="bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]">Attenzione</Badge>;
    return <Badge className="bg-[hsl(var(--success))] text-[hsl(var(--success-foreground))]">OK</Badge>;
  };

  const usedCategoryIds = new Set(budgets?.map((b) => b.category_id) || []);
  const availableCategories = categories?.filter((c) => !usedCategoryIds.has(c.id)) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Budget</h1>
        <Button size="sm" onClick={() => setDialogOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Nuovo Budget
        </Button>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 w-full rounded-lg" />
          ))}
        </div>
      ) : !budgets?.length ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Wallet className="h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nessun budget configurato</p>
            <p className="text-sm text-muted-foreground mt-1">Crea il tuo primo budget.</p>
            <Button className="mt-4" size="sm" onClick={() => setDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Nuovo Budget
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {budgets.map((b) => (
            <Card key={b.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base flex items-center gap-2">
                    <div
                      className="h-3 w-3 rounded-full shrink-0"
                      style={{ backgroundColor: (b.categories as any)?.color || "hsl(var(--muted))" }}
                    />
                    {(b.categories as any)?.name || "Categoria"}
                  </CardTitle>
                  {getStatusBadge(b.percentage)}
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm text-muted-foreground tabular-nums">
                  <span>Speso: {formatCurrency(b.spent)}</span>
                  <span>Limite: {formatCurrency(Number(b.amount))}</span>
                </div>
                <Progress value={Math.min(b.percentage, 100)} className="h-2" />
                <p className="text-right text-xs text-muted-foreground tabular-nums">{b.percentage}%</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuovo Budget</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleziona categoria" />
                </SelectTrigger>
                <SelectContent>
                  {availableCategories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Limite mensile (€)</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                placeholder="500.00"
                value={limitAmount}
                onChange={(e) => setLimitAmount(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Annulla
            </Button>
            <Button
              onClick={() => createBudget.mutate()}
              disabled={!selectedCategory || !limitAmount || parseFloat(limitAmount) <= 0 || createBudget.isPending}
            >
              {createBudget.isPending ? "Salvataggio..." : "Crea Budget"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
