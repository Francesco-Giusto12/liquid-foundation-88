import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { Link } from "react-router-dom";
import { Plus, TrendingUp, TrendingDown, DollarSign, ArrowUpDown, ShieldAlert, AlertTriangle, Info, Calendar } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { startOfMonth, endOfMonth, subMonths, format, parse } from "date-fns";
import { it } from "date-fns/locale";

export default function Dashboard() {
  const { user } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

  // Find the most recent month with transactions
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

  // Generate last 12 months for the picker
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

  // KPI: query transactions for selected period
  const { data: monthlyTransactions, isLoading: loadingMonthly } = useQuery({
    queryKey: ["transactions-monthly", monthStart, monthEnd],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("amount, type")
        .gte("date", monthStart)
        .lte("date", monthEnd);
      if (error) throw error;
      return data;
    },
    enabled: !!user && !!latestMonth,
  });

  // Liquidity calculation with selected period
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
        const key = format(m, "MMM yyyy");
        months[key] = { income: 0, expenses: 0 };
      }

      data?.forEach((t) => {
        const key = format(new Date(t.date), "MMM yyyy");
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

  // KPI calculations: positive amounts = income, negative = expenses
  const monthlyIncome = monthlyTransactions
    ?.filter((t) => Number(t.amount) > 0)
    .reduce((s, t) => s + Number(t.amount), 0) || 0;
  const monthlyExpenses = monthlyTransactions
    ?.filter((t) => Number(t.amount) < 0)
    .reduce((s, t) => s + Math.abs(Number(t.amount)), 0) || 0;
  const netCashFlow = monthlyIncome - monthlyExpenses;
  const totalBalance = monthlyTransactions
    ?.reduce((s, t) => s + Number(t.amount), 0) || 0;

  const loading = loadingMonthly;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-muted-foreground" />
            <Select value={periodStart} onValueChange={setSelectedPeriod}>
              <SelectTrigger className="w-[180px] h-9">
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
          <Button asChild size="sm">
            <Link to="/transactions/new"><Plus className="mr-1 h-4 w-4" />Add Transaction</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/accounts"><Plus className="mr-1 h-4 w-4" />Add Account</Link>
          </Button>
        </div>
      </div>

      {/* Liquidity Warnings */}
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
            <div className="flex items-center gap-2 rounded-lg bg-[hsl(var(--warning))]/10 border border-[hsl(var(--warning))]/30 px-4 py-3 text-sm text-[hsl(var(--warning))]">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <span>{liquidityData.uncat_count} entrate non categorizzate — accantonamento potrebbe essere sottostimato</span>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard title="Total Balance" value={totalBalance} icon={<DollarSign className="h-4 w-4" />} loading={loading} />
        <KpiCard title="Monthly Income" value={monthlyIncome} icon={<TrendingUp className="h-4 w-4" />} loading={loading} color="text-[hsl(var(--success))]" />
        <KpiCard title="Monthly Expenses" value={monthlyExpenses} icon={<TrendingDown className="h-4 w-4" />} loading={loading} color="text-destructive" />
        <KpiCard title="Net Cash Flow" value={netCashFlow} icon={<ArrowUpDown className="h-4 w-4" />} loading={loading} color={netCashFlow >= 0 ? "text-[hsl(var(--success))]" : "text-destructive"} />
      </div>

      {/* Liquidity KPI Cards */}
      {liquidityData && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <KpiCard title="Saldo Corrente" value={liquidityData.bt} icon={<DollarSign className="h-4 w-4" />} loading={loadingLiquidity} />
          <KpiCard title="Accantonamento Fiscale" value={liquidityData.f} icon={<ShieldAlert className="h-4 w-4" />} loading={loadingLiquidity} />
          <Card className={liquidityData.lr < 0 ? "border-destructive bg-destructive/5" : ""}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-muted-foreground font-medium">Liquidità Reale</span>
                <span className="text-muted-foreground"><ShieldAlert className="h-4 w-4" /></span>
              </div>
              {loadingLiquidity ? (
                <Skeleton className="h-7 w-24" />
              ) : (
                <p className={`text-xl font-bold tabular-nums ${liquidityData.lr < 0 ? "text-destructive" : "text-[hsl(var(--success))]"}`}>
                  {formatCurrency(liquidityData.lr)}
                </p>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Cash Flow Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Cash Flow (Last 6 Months)</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingChart ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="month" tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <YAxis tick={{ fontSize: 12 }} stroke="hsl(var(--muted-foreground))" />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "var(--radius)",
                    fontSize: 12,
                  }}
                  formatter={(value: number) => formatCurrency(value)}
                />
                <Legend />
                <Line type="monotone" dataKey="income" stroke="hsl(var(--success))" strokeWidth={2} name="Income" />
                <Line type="monotone" dataKey="expenses" stroke="hsl(var(--destructive))" strokeWidth={2} name="Expenses" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Recent Transactions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Transactions</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingRecent ? (
              <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            ) : !recentTransactions?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No transactions yet</p>
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link to="/transactions/new">Add your first transaction</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {recentTransactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between py-2 border-b last:border-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                        style={{ backgroundColor: (t.categories as any)?.color || "hsl(var(--muted))", color: "#fff" }}
                      >
                        {((t.categories as any)?.name || "?")[0]}
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{t.merchant || t.description || "Transaction"}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(t.date)}</p>
                      </div>
                    </div>
                    <span className={`text-sm font-medium tabular-nums ${Number(t.amount) > 0 ? "text-[hsl(var(--success))]" : "text-destructive"}`}>
                      {Number(t.amount) > 0 ? "+" : "-"}{formatCurrency(Math.abs(Number(t.amount)))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Budget Progress */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Budget Progress</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingBudgets ? (
              <div className="space-y-4">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
            ) : !budgets?.length ? (
              <div className="text-center py-8 text-muted-foreground">
                <p>No budgets set up yet</p>
                <Button asChild variant="outline" size="sm" className="mt-2">
                  <Link to="/budgets">Create a budget</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {budgets.map((b) => (
                  <div key={b.id} className="space-y-1.5">
                    <div className="flex items-center justify-between text-sm">
                      <span className="font-medium">{(b.categories as any)?.name || "Category"}</span>
                      <span className="text-muted-foreground tabular-nums">
                        {formatCurrency(b.spent)} / {formatCurrency(Number(b.amount))}
                      </span>
                    </div>
                    <Progress value={b.percentage} className="h-2" />
                    <div className="flex justify-end">
                      <Badge variant={b.percentage >= 90 ? "destructive" : b.percentage >= 70 ? "outline" : "secondary"} className="text-xs">
                        {b.percentage}%
                      </Badge>
                    </div>
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

function KpiCard({ title, value, icon, loading, color }: { title: string; value: number; icon: React.ReactNode; loading: boolean; color?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground font-medium">{title}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        {loading ? (
          <Skeleton className="h-7 w-24" />
        ) : (
          <p className={`text-xl font-bold tabular-nums ${color || ""}`}>{formatCurrency(value)}</p>
        )}
      </CardContent>
    </Card>
  );
}
