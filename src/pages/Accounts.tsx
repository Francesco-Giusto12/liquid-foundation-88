import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  Form, FormField, FormItem, FormLabel, FormControl, FormMessage,
} from "@/components/ui/form";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Landmark, CreditCard, Wallet, Briefcase, Plus, ExternalLink, Pencil } from "lucide-react";

const typeConfig: Record<string, { icon: React.ReactNode; label: string }> = {
  bank: { icon: <Landmark className="h-5 w-5" />, label: "Conto Corrente" },
  credit_card: { icon: <CreditCard className="h-5 w-5" />, label: "Carta di Credito" },
  cash: { icon: <Wallet className="h-5 w-5" />, label: "Contanti" },
  other: { icon: <Briefcase className="h-5 w-5" />, label: "Altro" },
};

const ibanRegex = /^[A-Z]{2}\d{2}[A-Z0-9]{4,30}$/;

const formSchema = z.object({
  name: z.string().trim().min(1, "Nome obbligatorio").max(100),
  type: z.enum(["bank", "credit_card", "cash", "other"]),
  iban: z.string().trim().transform(v => v.replace(/\s/g, "")).pipe(
    z.string().regex(ibanRegex, "Formato IBAN non valido").or(z.literal(""))
  ).optional().default(""),
  balance: z.coerce.number().default(0),
});

type FormValues = z.infer<typeof formSchema>;

function maskIban(iban: string | null | undefined): string | null {
  if (!iban || iban.length < 4) return null;
  const last4 = iban.slice(-4);
  return `•••• •••• •••• ${last4}`;
}

export default function Accounts() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { name: "", type: "bank", iban: "", balance: 0 },
  });

  const editSchema = z.object({
    name: z.string().trim().min(1, "Nome obbligatorio").max(100),
    type: z.enum(["bank", "credit_card", "cash", "other"]),
    balance: z.coerce.number().default(0),
  });
  type EditValues = z.infer<typeof editSchema>;
  const editForm = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: { name: "", type: "bank", balance: 0 },
  });

  const { data: accounts, isLoading } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  // Fetch transaction sums per account for live balance
  const { data: txSums } = useQuery({
    queryKey: ["account-tx-sums"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("account_id, amount");
      if (error) throw error;
      const sums: Record<string, number> = {};
      data?.forEach((t) => {
        if (t.account_id) {
          sums[t.account_id] = (sums[t.account_id] || 0) + Number(t.amount);
        }
      });
      return sums;
    },
    enabled: !!user,
  });

  const createAccount = useMutation({
    mutationFn: async (values: FormValues) => {
      const ibanLast4 = values.iban && values.iban.length >= 4 ? values.iban.slice(-4) : null;
      const { error } = await supabase.from("accounts").insert({
        user_id: user!.id,
        name: values.name,
        type: values.type,
        balance: values.balance,
        iban_last4: ibanLast4,
        is_active: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Conto creato");
      setOpen(false);
      form.reset();
    },
    onError: () => toast.error("Errore nella creazione del conto"),
  });

  const updateAccount = useMutation({
    mutationFn: async (values: EditValues) => {
      if (!editingId) throw new Error("Nessun conto selezionato");
      const { error } = await supabase
        .from("accounts")
        .update({ name: values.name, type: values.type, balance: values.balance })
        .eq("id", editingId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      toast.success("Conto aggiornato");
      setEditingId(null);
      editForm.reset();
    },
    onError: () => toast.error("Errore nell'aggiornamento del conto"),
  });

  const openEdit = (account: NonNullable<typeof accounts>[0]) => {
    editForm.reset({
      name: account.name,
      type: (account.type as EditValues["type"]) ?? "bank",
      balance: Number(account.balance ?? 0),
    });
    setEditingId(account.id);
  };

  const getBalance = (account: NonNullable<typeof accounts>[0]) => {
    const initial = Number(account.balance || 0);
    const txSum = txSums?.[account.id] || 0;
    return initial + txSum;
  };

  const totalBalance = accounts?.reduce((s, a) => s + getBalance(a), 0) || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Conti</h1>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />Nuovo Conto
        </Button>
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
          {accounts.map((account) => {
            const cfg = typeConfig[account.type] || typeConfig.other;
            const balance = getBalance(account);
            const masked = maskIban(account.iban_last4 ? `XXXX${account.iban_last4}` : null);
            return (
              <Card key={account.id} className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="h-9 w-9 rounded-lg flex items-center justify-center"
                        style={{ backgroundColor: account.color || "hsl(var(--primary))", color: "#fff" }}
                      >
                        {cfg.icon}
                      </div>
                      <div>
                        <CardTitle className="text-base">{account.name}</CardTitle>
                        {account.institution && (
                          <p className="text-xs text-muted-foreground">{account.institution}</p>
                        )}
                      </div>
                    </div>
                    <Badge variant="secondary" className="text-xs">{cfg.label}</Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-xl font-bold tabular-nums">{formatCurrency(balance, account.currency || "EUR")}</p>
                  {account.iban_last4 && (
                    <p className="text-xs text-muted-foreground">•••• •••• •••• {account.iban_last4}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <Button asChild variant="ghost" size="sm" className="px-0 text-xs text-primary">
                      <Link to={`/transactions?account=${account.id}`}>
                        <ExternalLink className="h-3 w-3 mr-1" />Vedi transazioni
                      </Link>
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openEdit(account)}>
                      <Pencil className="h-3 w-3 mr-1" />Modifica
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* New Account Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuovo Conto</DialogTitle>
            <DialogDescription>Aggiungi un conto bancario, carta o contanti.</DialogDescription>
          </DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createAccount.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome conto</FormLabel>
                  <FormControl><Input placeholder="Es. Conto principale" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="bank">Conto Corrente</SelectItem>
                      <SelectItem value="credit_card">Carta di Credito</SelectItem>
                      <SelectItem value="cash">Contanti</SelectItem>
                      <SelectItem value="other">Altro</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="iban" render={({ field }) => (
                <FormItem>
                  <FormLabel>IBAN (opzionale)</FormLabel>
                  <FormControl><Input placeholder="IT60X0542811101000000123456" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={form.control} name="balance" render={({ field }) => (
                <FormItem>
                  <FormLabel>Saldo iniziale (€)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="submit" disabled={createAccount.isPending}>
                  {createAccount.isPending ? "Salvataggio…" : "Salva"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      {/* Edit Account Dialog */}
      <Dialog open={!!editingId} onOpenChange={(o) => { if (!o) { setEditingId(null); editForm.reset(); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Modifica Conto</DialogTitle>
            <DialogDescription>Aggiorna nome, tipo o saldo iniziale.</DialogDescription>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit((v) => updateAccount.mutate(v))} className="space-y-4">
              <FormField control={editForm.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome conto</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={editForm.control} name="type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="bank">Conto Corrente</SelectItem>
                      <SelectItem value="credit_card">Carta di Credito</SelectItem>
                      <SelectItem value="cash">Contanti</SelectItem>
                      <SelectItem value="other">Altro</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />

              <FormField control={editForm.control} name="balance" render={({ field }) => (
                <FormItem>
                  <FormLabel>Saldo iniziale (€)</FormLabel>
                  <FormControl><Input type="number" step="0.01" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />

              <DialogFooter>
                <Button type="submit" disabled={updateAccount.isPending}>
                  {updateAccount.isPending ? "Salvataggio…" : "Salva modifiche"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
