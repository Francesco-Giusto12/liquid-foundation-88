import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { DollarSign } from "lucide-react";

const schema = z.object({
  password: z
    .string()
    .min(12, "La password deve avere almeno 12 caratteri")
    .regex(/[A-Z]/, "Deve contenere almeno 1 lettera maiuscola")
    .regex(/[0-9]/, "Deve contenere almeno 1 numero")
    .regex(/[^A-Za-z0-9]/, "Deve contenere almeno 1 carattere speciale"),
});

export default function ResetPassword() {
  const [loading, setLoading] = useState(false);
  const [validToken, setValidToken] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { password: "" },
  });

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setValidToken(true);
    }
  }, []);

  async function onSubmit(values: z.infer<typeof schema>) {
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: values.password });
    setLoading(false);

    if (error) {
      toast({ title: "Errore", description: "Qualcosa è andato storto. Riprova.", variant: "destructive" });
      return;
    }

    toast({ title: "Password aggiornata", description: "La tua password è stata reimpostata con successo." });
    navigate("/dashboard", { replace: true });
  }

  if (!validToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CardTitle>Link non valido</CardTitle>
            <CardDescription>Questo link di reset password non è valido o è scaduto.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-lg bg-primary">
            <DollarSign className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl font-bold">Nuova Password</CardTitle>
          <CardDescription>Scegli una nuova password sicura</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField control={form.control} name="password" render={({ field }) => (
                <FormItem>
                  <FormLabel>Nuova Password</FormLabel>
                  <FormControl><Input type="password" placeholder="Min 12 caratteri, 1 maiuscola, 1 numero, 1 speciale" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Aggiornamento..." : "Aggiorna password"}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
