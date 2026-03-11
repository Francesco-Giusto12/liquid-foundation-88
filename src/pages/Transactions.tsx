import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency, formatDate } from "@/lib/format";
import { calculateLiquidity, evaluateAlerts } from "@/lib/edge-functions";
import { format, startOfMonth, subMonths } from "date-fns";
import { Upload, Check, X, FileDown, Tag } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function Transactions() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const now = new Date();
  const monthOptions = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const d = subMonths(now, i);
      return { value: format(startOfMonth(d), "yyyy-MM-dd"), label: format(d, "MMMM yyyy") };
    });
  }, []);

  const [filterMonth, setFilterMonth] = useState<string>("all");
  const [filterType, setFilterType] = useState<string>("all");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editingRow, setEditingRow] = useState<string | null>(null);
  const [bulkCategoryId, setBulkCategoryId] = useState<string>("");

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: transactions, isLoading } = useQuery({
    queryKey: ["transactions-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, categories(id, name, color, type)")
        .order("date", { ascending: false });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const filtered = useMemo(() => {
    if (!transactions) return [];
    return transactions.filter((t) => {
      if (filterMonth !== "all") {
        const mStart = filterMonth;
        const mEnd = format(new Date(new Date(mStart).getFullYear(), new Date(mStart).getMonth() + 1, 0), "yyyy-MM-dd");
        if (t.date < mStart || t.date > mEnd) return false;
      }
      if (filterType !== "all" && t.type !== filterType) return false;
      if (filterCategory !== "all" && t.category_id !== filterCategory) return false;
      return true;
    });
  }, [transactions, filterMonth, filterType, filterCategory]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === filtered.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(filtered.map((t) => t.id)));
    }
  };

  const updateCategory = useMutation({
    mutationFn: async ({ ids, categoryId }: { ids: string[]; categoryId: string }) => {
      const { error } = await supabase
        .from("transactions")
        .update({ category_id: categoryId })
        .in("id", ids);
      if (error) throw error;
      return ids.length;
    },
    onSuccess: (count, { ids }) => {
      queryClient.invalidateQueries({ queryKey: ["transactions-all"] });
      const isBulk = ids.length > 1;
      setSelected(new Set());
      setEditingRow(null);
      setBulkCategoryId("");
      toast.success(isBulk ? `${count} transazioni categorizzate` : "Categoria aggiornata");

      // Re-evaluate liquidity & alerts for affected periods
      if (transactions) {
        const affectedDates = transactions
          .filter((t) => ids.includes(t.id))
          .map((t) => format(startOfMonth(new Date(t.date)), "yyyy-MM-dd"));
        const uniquePeriods = [...new Set(affectedDates)];
        uniquePeriods.forEach((p) => {
          calculateLiquidity(p).catch(() => {});
          evaluateAlerts(p).catch(() => {});
        });
      }
    },
    onError: () => toast.error("Errore nell'aggiornamento"),
  });

  const handleBulkCategorize = () => {
    if (!bulkCategoryId || selected.size === 0) return;
    updateCategory.mutate({ ids: Array.from(selected), categoryId: bulkCategoryId });
  };

  const handleInlineCategory = (txId: string, categoryId: string) => {
    updateCategory.mutate({ ids: [txId], categoryId });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Transazioni</h1>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/import"><Upload className="mr-1 h-4 w-4" />Importa CSV</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/transactions/new">+ Nuova</Link>
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <Card>
        <CardContent className="p-3 flex flex-wrap gap-3 items-center">
          <Select value={filterMonth} onValueChange={setFilterMonth}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Mese" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti i mesi</SelectItem>
              {monthOptions.map((m) => (
                <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={filterType} onValueChange={setFilterType}>
            <SelectTrigger className="w-[150px]">
              <SelectValue placeholder="Tipo" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutti</SelectItem>
              <SelectItem value="income">Entrate</SelectItem>
              <SelectItem value="expense">Uscite</SelectItem>
              <SelectItem value="transfer">Trasferimenti</SelectItem>
            </SelectContent>
          </Select>

          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tutte le categorie</SelectItem>
              {categories?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  <span className="flex items-center gap-2">
                    {c.color && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />}
                    {c.name}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* spacer for sticky bar */}
      {selected.size > 0 && <div className="h-20" />}

      {/* Table */}
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !filtered.length ? (
        <Card>
          <CardContent className="py-16 text-center">
            <FileDown className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            <p className="text-lg font-medium">Nessuna transazione</p>
            <p className="text-muted-foreground mt-1">Importa un CSV per iniziare.</p>
            <Button asChild variant="outline" className="mt-4">
              <Link to="/import">Importa CSV</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <Checkbox
                      checked={selected.size === filtered.length && filtered.length > 0}
                      onCheckedChange={toggleAll}
                    />
                  </TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead className="text-right">Importo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((t) => {
                  const cat = t.categories as any;
                  const isEditing = editingRow === t.id;
                  return (
                    <TableRow
                      key={t.id}
                      className="cursor-pointer"
                      onClick={() => setEditingRow(isEditing ? null : t.id)}
                    >
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          checked={selected.has(t.id)}
                          onCheckedChange={() => toggleSelect(t.id)}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm">{formatDate(t.date)}</TableCell>
                      <TableCell className="text-sm max-w-[200px] truncate">
                        {t.merchant || t.description || "—"}
                      </TableCell>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        {isEditing ? (
                          <Select
                            value={t.category_id || ""}
                            onValueChange={(v) => handleInlineCategory(t.id, v)}
                          >
                            <SelectTrigger className="w-[160px] h-8 text-xs">
                              <SelectValue placeholder="Seleziona..." />
                            </SelectTrigger>
                            <SelectContent>
                              {categories
                                ?.filter((c) => t.type === "transfer" || c.type === t.type)
                                .map((c) => (
                                  <SelectItem key={c.id} value={c.id}>
                                    <span className="flex items-center gap-2">
                                      {c.color && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />}
                                      {c.name}
                                    </span>
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        ) : cat ? (
                          <Badge
                            variant="outline"
                            className="text-xs"
                            style={{
                              borderColor: cat.color || undefined,
                              color: cat.color || undefined,
                              backgroundColor: cat.color ? `${cat.color}15` : undefined,
                            }}
                          >
                            {cat.name}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground italic">Non categorizzata</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums font-medium text-sm">
                        <span className={t.type === "income" ? "text-success" : t.type === "expense" ? "text-destructive" : ""}>
                          {t.type === "income" ? "+" : t.type === "expense" ? "-" : ""}
                          {formatCurrency(Math.abs(Number(t.amount)))}
                        </span>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </Card>
      )}
      {/* Sticky bulk action bar */}
      {selected.size > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-lg">
          <div className="mx-auto max-w-screen-xl flex items-center justify-between gap-3 px-4 py-3">
            <span className="text-sm font-medium whitespace-nowrap">
              {selected.size} transazioni selezionate
            </span>
            <div className="flex items-center gap-2">
              <Select value={bulkCategoryId} onValueChange={setBulkCategoryId}>
                <SelectTrigger className="w-[180px] h-9">
                  <SelectValue placeholder="Categoria..." />
                </SelectTrigger>
                <SelectContent>
                  {categories?.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      <span className="flex items-center gap-2">
                        {c.color && <span className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: c.color }} />}
                        {c.name}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button size="sm" onClick={handleBulkCategorize} disabled={!bulkCategoryId || updateCategory.isPending}>
                <Tag className="h-4 w-4 mr-1" />Assegna categoria
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                <X className="h-4 w-4 mr-1" />Deseleziona tutto
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
