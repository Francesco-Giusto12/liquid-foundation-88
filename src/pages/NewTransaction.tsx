import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { CalendarIcon, ArrowLeft, Repeat, ArrowRightLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";

const typeLabels: Record<string, string> = {
  income: "Entrata",
  expense: "Uscita",
  transfer: "Trasferimento",
};

const transactionSchema = z
  .object({
    amount: z
      .string()
      .min(1, "L'importo è obbligatorio")
      .refine((v) => !isNaN(Number(v)) && Number(v) > 0, "Deve essere un numero positivo")
      .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), "Massimo 2 decimali")
      .refine((v) => Number(v) <= 999999999.99, "Importo troppo grande"),
    currency: z.string().min(1),
    type: z.enum(["income", "expense", "transfer"], { required_error: "Seleziona un tipo" }),
    category_id: z.string().optional(),
    account_id: z.string().min(1, "Seleziona un conto"),
    destination_account_id: z.string().optional(),
    date: z.date({ required_error: "Seleziona una data" }),
    description: z.string().trim().max(255, "Massimo 255 caratteri").optional(),
    notes: z.string().trim().max(1000, "Massimo 1000 caratteri").optional(),
    is_recurring: z.boolean().default(false),
    recurring_interval: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  })
  .refine(
    (d) => d.type !== "transfer" || (d.destination_account_id && d.destination_account_id !== d.account_id),
    { message: "Seleziona un conto di destinazione diverso", path: ["destination_account_id"] }
  )
  .refine(
    (d) => !d.is_recurring || d.recurring_interval,
    { message: "Seleziona una frequenza", path: ["recurring_interval"] }
  );

type TransactionForm = z.infer<typeof transactionSchema>;

export default function NewTransaction() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const form = useForm<TransactionForm>({
    resolver: zodResolver(transactionSchema),
    defaultValues: {
      amount: "",
      currency: "EUR",
      type: "expense",
      account_id: "",
      destination_account_id: "",
      date: new Date(),
      description: "",
      notes: "",
      is_recurring: false,
    },
  });

  const watchType = form.watch("type");
  const watchRecurring = form.watch("is_recurring");

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("accounts")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => {
      const { data, error } = await supabase.from("categories").select("*").order("name");
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const filteredCategories = categories?.filter(
    (c) => watchType === "transfer" || c.type === watchType
  );

  const mutation = useMutation({
    mutationFn: async (values: TransactionForm) => {
      if (!user) throw new Error("Not authenticated");
      const amount = Number(values.amount);

      const { error: txError } = await supabase.from("transactions").insert({
        user_id: user.id,
        account_id: values.account_id,
        category_id: values.category_id || null,
        amount,
        type: values.type,
        description: values.description || null,
        date: format(values.date, "yyyy-MM-dd"),
        is_recurring: values.is_recurring,
        recurring_interval: values.is_recurring ? values.recurring_interval : null,
        notes: values.notes || null,
      });
      if (txError) throw txError;

      const sourceAccount = accounts?.find((a) => a.id === values.account_id);
      if (sourceAccount) {
        const currentBalance = Number(sourceAccount.balance || 0);
        let newBalance = currentBalance;
        if (values.type === "income") newBalance = currentBalance + amount;
        else if (values.type === "expense") newBalance = currentBalance - amount;
        else if (values.type === "transfer") newBalance = currentBalance - amount;

        await supabase.from("accounts").update({ balance: newBalance }).eq("id", values.account_id);
      }

      if (values.type === "transfer" && values.destination_account_id) {
        const destAccount = accounts?.find((a) => a.id === values.destination_account_id);
        if (destAccount) {
          const destBalance = Number(destAccount.balance || 0) + amount;
          await supabase.from("accounts").update({ balance: destBalance }).eq("id", values.destination_account_id);
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Transazione aggiunta");
      navigate("/transactions");
    },
    onError: () => {
      toast.error("Qualcosa è andato storto. Riprova.");
    },
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Nuova Transazione</h1>
      </div>

      <Card>
        <CardContent className="pt-6">
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-5">
              {/* Type selector */}
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tipo</FormLabel>
                    <div className="grid grid-cols-3 gap-2">
                      {(["income", "expense", "transfer"] as const).map((t) => (
                        <Button
                          key={t}
                          type="button"
                          variant={field.value === t ? "default" : "outline"}
                          className={cn(
                            field.value === t && t === "income" && "bg-[hsl(var(--success))] hover:bg-[hsl(var(--success))]/90",
                            field.value === t && t === "expense" && "bg-destructive hover:bg-destructive/90",
                            field.value === t && t === "transfer" && "bg-secondary hover:bg-secondary/90"
                          )}
                          onClick={() => {
                            field.onChange(t);
                            form.setValue("category_id", "");
                          }}
                        >
                          {t === "transfer" && <ArrowRightLeft className="h-4 w-4 mr-1" />}
                          {typeLabels[t]}
                        </Button>
                      ))}
                    </div>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Amount + Currency row */}
              <div className="grid grid-cols-[1fr_100px] gap-3">
                <FormField
                  control={form.control}
                  name="amount"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Importo</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          className="tabular-nums text-lg font-semibold"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="currency"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Valuta</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="GBP">GBP</SelectItem>
                          <SelectItem value="CHF">CHF</SelectItem>
                        </SelectContent>
                      </Select>
                    </FormItem>
                  )}
                />
              </div>

              {/* Account */}
              <FormField
                control={form.control}
                name="account_id"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{watchType === "transfer" ? "Dal Conto" : "Conto"}</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Seleziona conto" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {accounts?.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Destination account for transfers */}
              {watchType === "transfer" && (
                <FormField
                  control={form.control}
                  name="destination_account_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Al Conto</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona destinazione" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {accounts
                            ?.filter((a) => a.id !== form.getValues("account_id"))
                            .map((a) => (
                              <SelectItem key={a.id} value={a.id}>
                                {a.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Category */}
              {watchType !== "transfer" && (
                <FormField
                  control={form.control}
                  name="category_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Categoria</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Seleziona categoria" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {filteredCategories?.map((c) => (
                            <SelectItem key={c.id} value={c.id}>
                              <span className="flex items-center gap-2">
                                {c.color && (
                                  <span
                                    className="inline-block h-3 w-3 rounded-full shrink-0"
                                    style={{ backgroundColor: c.color }}
                                  />
                                )}
                                {c.name}
                              </span>
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}

              {/* Date */}
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel>Data</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                          >
                            {field.value ? format(field.value, "PPP", { locale: it }) : <span>Seleziona data</span>}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          initialFocus
                          className="p-3 pointer-events-auto"
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Description */}
              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Descrizione</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="es. Spesa al supermercato" maxLength={255} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Notes */}
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Note (opzionale)</FormLabel>
                    <FormControl>
                      <Textarea {...field} placeholder="Dettagli aggiuntivi…" maxLength={1000} rows={3} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Recurring toggle */}
              <div className="space-y-3">
                <FormField
                  control={form.control}
                  name="is_recurring"
                  render={({ field }) => (
                    <FormItem className="flex items-center justify-between rounded-lg border p-3">
                      <div className="flex items-center gap-2">
                        <Repeat className="h-4 w-4 text-muted-foreground" />
                        <FormLabel className="!mt-0">Ricorrente</FormLabel>
                      </div>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )}
                />

                {watchRecurring && (
                  <FormField
                    control={form.control}
                    name="recurring_interval"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Frequenza</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue placeholder="Seleziona frequenza" />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            <SelectItem value="daily">Giornaliera</SelectItem>
                            <SelectItem value="weekly">Settimanale</SelectItem>
                            <SelectItem value="monthly">Mensile</SelectItem>
                            <SelectItem value="yearly">Annuale</SelectItem>
                          </SelectContent>
                        </Select>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}
              </div>

              {/* Submit */}
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => navigate(-1)}>
                  Annulla
                </Button>
                <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                  {mutation.isPending ? "Salvataggio…" : "Aggiungi Transazione"}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
