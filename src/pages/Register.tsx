import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DollarSign } from "lucide-react";

const registerSchema = z.object({
  fullName: z.string().trim().min(1, "Il nome completo è obbligatorio").max(100),
  email: z.string().trim().email("Indirizzo email non valido").max(255),
  password: z
    .string()
    .min(12, "La password deve avere almeno 12 caratteri")
    .regex(/[A-Z]/, "Deve contenere almeno 1 lettera maiuscola")
    .regex(/[0-9]/, "Deve contenere almeno 1 numero")
    .regex(/[^A-Za-z0-9]/, "Deve contenere almeno 1 carattere speciale"),
  accountType: z.enum(["personal", "business"], { required_error: "Seleziona il tipo di account" }),
});

type RegisterValues = z.infer<typeof registerSchema>;

export default function Register() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { fullName: "", email: "", password: "", accountType: "personal" },
  });

  async function onSubmit(values: RegisterValues) {
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: values.email,
      password: values.password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: values.fullName,
          account_type: values.accountType,
        },
      },
    });
    setLoading(false);

    if (error) {
      toast({ title: "Registrazione fallita", description: "Qualcosa è andato storto. Riprova.", variant: "destructive" });
      return;
    }

    toast({ title: "Controlla la tua email", description: "Ti abbiamo inviato un link di verifica. Conferma la tua email per accedere." });
    navigate("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <DollarSign className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">Crea Account</CardTitle>
          <CardDescription>Inizia a gestire le tue finanze con Liquidò</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="fullName" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nome Completo</FormLabel>
                  <FormControl><Input placeholder="Mario Rossi" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" placeholder="tu@esempio.com" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl><Input type="password" placeholder="Min 12 caratteri, 1 maiuscola, 1 numero, 1 speciale" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="accountType" render={({ field }) => (
                <FormItem>
                  <FormLabel>Tipo Account</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger><SelectValue placeholder="Seleziona tipo" /></SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="personal">Personale</SelectItem>
                      <SelectItem value="business">Business</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Creazione in corso..." : "Crea account"}
              </Button>
            </form>
          </Form>
          <div className="mt-4 text-center text-sm text-muted-foreground">
            Hai già un account?{" "}
            <Link to="/login" className="text-secondary hover:underline font-medium">Accedi</Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
