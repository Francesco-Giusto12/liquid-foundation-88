import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency, formatDate } from "@/lib/format";
import { calculateLiquidity } from "@/lib/edge-functions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "react-router-dom";
import { Plus, Wallet, ShieldAlert, AlertTriangle, Info, Calendar, HandCoins, Briefcase } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { startOfMonth, endOfMonth, subMonths, format } from "date-fns";
import { it } from "date-fns/locale";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { FiscalBreakdown } from "@/components/FiscalBreakdown";
import { UpcomingDeadlines } from "@/components/UpcomingDeadlines";

export default function Dashboard() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);

  const { data: profileOnboarding, isLoading: loadingOnboarding } = useQuery({
    queryKey: ["profile-onboarding", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("onboarding_completed")
        .eq("id", user!.id)
        .single();
      return data;
    },
    enabled: !!user,
  });

  const needsOnboarding = !loadingOnboarding && profileOnboarding && !(profileOnboarding as any).onboarding_completed;

  const { data: latestMonth } = useQuery({
    queryKey: ["latest-transaction-month"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("date")
        .order("date", { ascending: false })
        .limit(1);
      if (error) throw error;
      if (!data?.length) return format(new Date(), "yyyy-MM-01");
      return format(startOfMonth(new Date(data[0].date)), "yyyy-MM-dd");
    },
    enabled: !!user,
  });

  const monthOptions = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(new Date(), i);
    const value = format(startOfMonth(d), "yyyy-MM-dd");
    const label = format(d, "MMMM yyyy", { locale: it });
    return { value, label: label.charAt(0).toUpperCase() + label.slice(1) };
  });

  const periodStart = selectedPeriod || latestMonth || format(new Date(), "yyyy-MM-01");
  const periodDate = new Date(periodStart);
  const monthStart = format(startOfMonth(periodDate), "yyyy-MM-dd");
  const monthEnd = format(endOfMonth(periodDate), "yyyy-MM-dd");

  const { data: liquidityData, isLoading: loadingLiquidity } = useQuery({
    queryKey: ["liquidity", monthStart],
    queryFn: async () => {
      const res = await calculateLiquidity(monthStart);
      return res.data;
    },
    enabled: !!user && !!latestMonth,
  });

  const { data: recentTransactions, isLoading: loadingRecent } = useQuery({
    queryKey: ["transactions-recent"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("*, categories(name, icon, color)")
        .order("date", { ascending: false })
        .limit(10);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: chartData, isLoading: loadingChart } = useQuery({
    queryKey: ["cashflow-chart"],
    queryFn: async () => {
      const now = new Date();
      const sixMonthsAgo = subMonths(now, 5);
      const start = format(startOfMonth(sixMonthsAgo), "yyyy-MM-dd");
      const { data, error } = await supabase
        .from("transactions")
        .select("amount, type, date")
        .gte("date", start);
      if (error) throw error;

      const months: Record<string, { income: number; expenses: number }> = {};
      for (let i = 5; i >= 0; i--) {
        const m = subMonths(now, i);
        const key = format(m, "MMM yyyy", { locale: it });
        months[key] = { income: 0, expenses: 0 };
      }

      data?.forEach((t) => {
        const key = format(new Date(t.date), "MMM yyyy", { locale: it });
        if (months[key]) {
          if (Number(t.amount) > 0) months[key].income += Number(t.amount);
          else months[key].expenses += Math.abs(Number(t.amount));
        }
      });

      return Object.entries(months).map(([month, vals]) => ({
        month,
        income: vals.income,
        expenses: vals.expenses,
      }));
    },
    enabled: !!user,
  });

  const { data: budgets, isLoading: loadingBudgets } = useQuery({
    queryKey: ["budgets-progress", monthStart, monthEnd],
    queryFn: async () => {
      const { data: budgetData, error: bErr } = await supabase
        .from("budgets")
        .select("*, categories(name, color)")
        .eq("period", "monthly")
        .limit(3);
      if (bErr) throw bErr;

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
          return { ...b, spent, percentage: Math.min(100, Math.round((spent / Number(b.amount)) * 100)) };
        })
      );
      return results;
    },
    enabled: !!user && !!latestMonth,
  });

  const { data: accountBalances } = useQuery({
    queryKey: ["account-balances"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("balance")
        .eq("is_active", true);
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const accountsTotal = accountBalances?.reduce((s, a) => s + Number(a.balance ?? 0), 0) || 0;
  const totalBalance = liquidityData?.bt ?? accountsTotal;

  if (needsOnboarding || showOnboarding) {
    return (
      <OnboardingWizard
        onComplete={() => {
          setShowOnboarding(false);
          queryClient.invalidateQueries({ queryKey: ["profile-onboarding"] });
        }}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 min-w-0">
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <div className="flex items-center gap-2 min-w-0">
            <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
            <Select value={periodStart} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[160px] sm:w-[180px] h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild size="sm" className="flex-1 sm:flex-none min-w-0">
            <Link to="/transactions/new"><Plus className="mr-1 h-4 w-4 shrink-0" /><span className="truncate">Nuova Transazione</span></Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="flex-1 sm:flex-none min-w-0">
            <Link to="/accounts"><Plus className="mr-1 h-4 w-4 shrink-0" /><span className="truncate">Aggiungi Conto</span></Link>
          </Button>
        </div>
      </div>

      {/* Warnings */}
      {liquidityData && (
        <div className="space-y-2">
          {liquidityData.alpha === null && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-sm">
              <Info className="h-4 w-4 text-secondary shrink-0" />
              <span>Configura il regime fiscale per calcolare la liquidità reale</span>
            </div>
          )}
          {liquidityData.lr_negative && (
            <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-4 py-3 text-sm text-destructive">
              <ShieldAlert className="h-4 w-4 shrink-0" />
              <span>Liquidità reale negativa — l'accantonamento fiscale supera il saldo disponibile</span>
            </div>
          )}
          {liquidityData.quality_warning && (
            <div className="flex items-center gap-2 rounded-lg bg-orange-50 border border-orange-200 px-4 py-3 text-sm text-orange-800 dark:bg-orange-950/30 dark:border-orange-900/50 dark:text-orange-300">
              <AlertTriangle className="h-4 w-4 shrink-0 text-orange-600 dark:text-orange-400" />
              <span>{liquidityData.uncat_count} entrate non categorizzate — accantonamento potrebbe essere sottostimato</span>
            </div>
          )}
        </div>
      )}

      {/* 3 KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="order-2 md:order-1">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-[#1e3a5f] flex items-center justify-center shrink-0">
              <Wallet className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground font-medium">Saldo Totale</p>
              {loadingLiquidity ? (
                <Skeleton className="h-7 w-28 mt-1" />
              ) : (
                <p className="text-xl font-bold tabular-nums">{formatCurrency(totalBalance)}</p>
              )}
            </div>
            <svg className="h-8 w-16 text-primary/40 shrink-0" viewBox="0 0 64 32">
              <polyline points="0,28 12,20 24,22 36,14 48,16 64,8" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </CardContent>
        </Card>

        <Card className="order-3 md:order-2">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-[#1e3a5f] flex items-center justify-center shrink-0">
              <Briefcase className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-muted-foreground font-medium">Accantonamento Fiscale</p>
              {loadingLiquidity ? (
                <Skeleton className="h-7 w-28 mt-1" />
              ) : (
                <p className="text-xl font-bold tabular-nums">{formatCurrency(liquidityData?.f ?? 0)}</p>
              )}
              {/* Breakdown mini IVA / IRPEF / INPS */}
              {!loadingLiquidity && liquidityData?.breakdown && liquidityData.f > 0 && (
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {liquidityData.breakdown.f_iva > 0 && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300 tabular-nums">
                      IVA {formatCurrency(liquidityData.breakdown.f_iva)}
                    </span>
                  )}
                  {liquidityData.breakdown.f_irpef > 0 && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300 tabular-nums">
                      IRPEF {formatCurrency(liquidityData.breakdown.f_irpef)}
                    </span>
                  )}
                  {liquidityData.breakdown.f_inps > 0 && (
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300 tabular-nums">
                      INPS {formatCurrency(liquidityData.breakdown.f_inps)}
                    </span>
                  )}
                </div>
              )}
            </div>
            <svg className="h-8 w-16 text-muted-foreground/40 shrink-0" viewBox="0 0 64 32">
              <polyline points="0,16 16,18 32,14 48,16 64,12" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </CardContent>
        </Card>

        <Card className={`order-1 md:order-3 border-0 ${liquidityData && liquidityData.lr < 0 ? "bg-destructive" : "bg-[#16a34a]"} text-white shadow-md`}>
          <CardContent className="p-4 flex items-center gap-4">
            <div className="h-10 w-10 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
              <HandCoins className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-white/80 font-medium">Liquidità Reale</p>
              {loadingLiquidity ? (
                <Skeleton className="h-7 w-28 mt-1 bg-white/20" />
              ) : (
                <p className="text-xl font-bold tabular-nums text-white">
                  {formatCurrency(liquidityData?.lr ?? 0)}
                </p>
              )}
            </div>
            <svg className="h-8 w-16 text-white/60 shrink-0" viewBox="0 0 64 32">
              <polyline points="0,24 16,20 32,16 48,10 64,6" fill="none" stroke="currentColor" strokeWidth="2" />
            </svg>
          </CardContent>
        </Card>
      </div>

      {/* Breakdown fiscale esteso — visibile quando i dati sono disponibili */}
      {!loadingLiquidity && liquidityData && liquidityData.f > 0 && liquidityData.breakdown && (
        <FiscalBreakdown
          totalBalance={totalBalance}
          taxableIncome={liquidityData.e_tax ?? 0}
          totalProvision={liquidityData.f}
          liquidita={liquidityData.lr}
          breakdown={liquidityData.breakdown}
          variant="compact"
        />
      )}

      <UpcomingDeadlines />

      {/* Area Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Flusso di Cassa Mensile</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingChart ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="fillIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16a34a" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#16a34a" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="fillExpenses" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#e11d48" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#e11d48" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => `€ ${v.toLocaleString("it-IT")}`} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--radius)",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend
                  formatter={(value) => (
                    <span className="text-xs">{value}</span>
                  )}
                />
                <Area type="monotone" dataKey="income" stroke="#16a34a" strokeWidth={2} fill="url(#fillIncome)" name="Entrate" />
                <Area type="monotone" dataKey="expenses" stroke="#e11d48" strokeWidth={2} fill="url(#fillExpenses)" name="Uscite" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Bottom: Transactions Table + Budget */}
      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Transazioni Recenti</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRecent ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : !recentTransactions?.length ? (
              <EmptyState
                illustration="transactions"
                title="Nessun dato per questo periodo"
                subtitle="Importa un CSV o aggiungi la tua prima transazione per vedere la tua liquidità reale"
                cta={{ label: "Importa CSV", to: "/import" }}
                secondaryCta={{ label: "+ Aggiungi transazione", to: "/transactions/new" }}
              />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Descrizione</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Importo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recentTransactions.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="text-sm tabular-nums whitespace-nowrap">{formatDate(t.date)}</TableCell>
                      <TableCell className="text-sm">{t.merchant || t.description || "Transazione"}</TableCell>
                      <TableCell>
                        {(t.categories as any)?.name ? (
                          <Badge
                            variant="secondary"
                            style={{
                              backgroundColor: (t.categories as any)?.color || undefined,
                              color: (t.categories as any)?.color ? "#fff" : undefined,
                            }}
                          >
                            {(t.categories as any).name}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground">Non categorizzata</Badge>
                        )}
                      </TableCell>
                      <TableCell className={`text-sm font-medium tabular-nums text-right ${Number(t.amount) > 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                        {Number(t.amount) > 0 ? "+" : "-"}{formatCurrency(Math.abs(Number(t.amount)))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Budget</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingBudgets ? (
              <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : !budgets?.length ? (
              <EmptyState
                illustration="budgets"
                title="Nessun budget configurato"
                subtitle="Imposta un limite di spesa per categoria"
                cta={{ label: "+ Crea budget", to: "/budgets" }}
              />
            ) : (
              <div className="space-y-4">
                {budgets.map((b) => (
                  <div key={b.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{(b.categories as any)?.name || "Categoria"}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatCurrency(b.spent)} / {formatCurrency(Number(b.amount))}
                      </span>
                    </div>
                    <Progress value={b.percentage} className="h-2" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
