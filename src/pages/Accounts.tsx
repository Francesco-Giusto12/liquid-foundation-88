import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Landmark, CreditCard, Wallet, PiggyBank } from "lucide-react";

const typeIcons: Record<string, React.ReactNode> = {
  bank: <Landmark className="h-5 w-5" />,
  credit_card: <CreditCard className="h-5 w-5" />,
  cash: <Wallet className="h-5 w-5" />,
  savings: <PiggyBank className="h-5 w-5" />,
};

const typeLabels: Record<string, string> = {
  bank: "Banca",
  credit_card: "Carta di Credito",
  cash: "Contanti",
  savings: "Risparmio",
};

export default function Accounts() {
  const { user } = useAuth();

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase.from("accounts").select("*").order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const totalBalance = accounts?.reduce((s, a) => s + Number(a.balance || 0), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Conti</h1>
      </div>

      <Card>
        <CardContent className="p-4">
          <p className="text-xs text-muted-foreground mb-1">Saldo Totale</p>
          {isLoading ? <Skeleton className="h-8 w-32" /> : (
            <p className="text-2xl font-bold tabular-nums">{formatCurrency(totalBalance)}</p>
          )}
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}><CardContent className="p-6"><Skeleton className="h-20 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : !accounts?.length ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <Landmark className="h-12 w-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">Nessun conto aggiunto</p>
            <p className="text-sm mt-1">Aggiungi il tuo primo conto bancario, carta di credito o conto contanti per iniziare.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {accounts.map((account) => (
            <Card key={account.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div
                      className="h-9 w-9 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: account.color || "hsl(var(--primary))", color: "#fff" }}
                    >
                      {typeIcons[account.type] || <Landmark className="h-5 w-5" />}
                    </div>
                    <div>
                      <CardTitle className="text-base">{account.name}</CardTitle>
                      {account.institution && (
                        <p className="text-xs text-muted-foreground">{account.institution}</p>
                      )}
                    </div>
                  </div>
                  <Badge variant="secondary" className="text-xs">{typeLabels[account.type] || account.type}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold tabular-nums">{formatCurrency(Number(account.balance || 0), account.currency || "EUR")}</p>
                {account.iban_last4 && (
                  <p className="text-xs text-muted-foreground mt-1">····{account.iban_last4}</p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
