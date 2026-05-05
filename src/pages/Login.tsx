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
import { useToast } from "@/hooks/use-toast";
import { Droplet } from "lucide-react";

const loginSchema = z.object({
  email: z.string().trim().email("Indirizzo email non valido").max(255),
  password: z.string().min(1, "La password è obbligatoria"),
});

type LoginValues = z.infer<typeof loginSchema>;

export default function Login() {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const form = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  async function onSubmit(values: LoginValues) {
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: values.email,
      password: values.password,
    });
    setLoading(false);

    if (error) {
      toast({ title: "Accesso fallito", description: "Email o password non validi. Riprova.", variant: "destructive" });
      return;
    }
    navigate("/dashboard", { replace: true });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="flex items-center gap-3">
            <Droplet className="h-12 w-12 fill-[#2563a8] text-[#2563a8]" strokeWidth={0} />
            <h1 className="text-5xl font-bold tracking-tight text-[#1e3a5f]">Liquidò</h1>
          </div>
          <p className="mt-4 text-xl text-[#1e3a5f]/80">Accedi al tuo account</p>
        </div>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem>
                <div className="rounded-xl border-2 border-[#1e3a5f]/80 px-4 py-2 focus-within:border-[#1e3a5f]">
                  <FormLabel className="text-xs font-semibold text-[#1e3a5f]">Email</FormLabel>
                  <FormControl>
                    <Input
                      type="email"
                      placeholder="tu@esempio.com"
                      className="h-7 border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      {...field}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem>
                <div className="rounded-xl border-2 border-[#1e3a5f]/80 px-4 py-2 focus-within:border-[#1e3a5f]">
                  <FormLabel className="text-xs font-semibold text-[#1e3a5f]">Password</FormLabel>
                  <FormControl>
                    <Input
                      type="password"
                      placeholder="••••••••••••"
                      className="h-7 border-0 bg-transparent p-0 text-base shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
                      {...field}
                    />
                  </FormControl>
                </div>
                <FormMessage />
              </FormItem>
            )} />
            <Button
              type="submit"
              disabled={loading}
              className="h-14 w-full rounded-xl bg-[#1e3a5f] text-lg font-semibold text-white hover:bg-[#16294a]"
            >
              {loading ? "Accesso in corso..." : "Accedi"}
            </Button>
          </form>
        </Form>
        <div className="mt-6 text-center">
          <Link to="/forgot-password" className="text-base font-medium text-[#16a34a] hover:underline">
            Password dimenticata?
          </Link>
        </div>
        <div className="mt-3 text-center">
          <Link to="/register" className="text-base font-medium text-[#16a34a] hover:underline">
            Non hai un account? Registrati
          </Link>
        </div>
      </div>
    </div>
  );
}
