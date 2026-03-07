import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, startOfMonth, subMonths } from "date-fns";
import { it } from "date-fns/locale";
import { FileText, Download, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { generateReport } from "@/lib/edge-functions";
import { toast } from "sonner";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

export default function Reports() {
  const { user } = useAuth();
  const [selectedPeriod, setSelectedPeriod] = useState("");
  const [generating, setGenerating] = useState(false);

  // Get months that have transactions
  const { data: availableMonths, isLoading } = useQuery({
    queryKey: ["report-months"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transactions")
        .select("date")
        .order("date", { ascending: false });
      if (error) throw error;

      const months = new Set<string>();
      data?.forEach((t) => {
        const d = new Date(t.date);
        months.add(format(startOfMonth(d), "yyyy-MM-dd"));
      });
      return Array.from(months).sort().reverse();
    },
    enabled: !!user,
  });

  const handleGenerate = async () => {
    if (!selectedPeriod) return;
    setGenerating(true);
    try {
      await generateReport(selectedPeriod);
    } catch {
      toast.error("Errore nella generazione del report");
    }
    setGenerating(false);
  };

  const formatMonthLabel = (iso: string) => {
    const d = new Date(iso);
    return format(d, "MMMM yyyy", { locale: it });
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Report</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Genera Report Mensile
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Seleziona un mese per generare un report completo in formato HTML stampabile.
          </p>

          <Select onValueChange={setSelectedPeriod} value={selectedPeriod}>
            <SelectTrigger>
              <SelectValue placeholder="Seleziona periodo…" />
            </SelectTrigger>
            <SelectContent>
              {availableMonths?.map((m) => (
                <SelectItem key={m} value={m}>
                  {formatMonthLabel(m)}
                </SelectItem>
              ))}
              {availableMonths?.length === 0 && (
                <div className="px-3 py-2 text-sm text-muted-foreground">
                  Nessuna transazione trovata
                </div>
              )}
            </SelectContent>
          </Select>

          <Button
            className="w-full"
            onClick={handleGenerate}
            disabled={!selectedPeriod || generating}
          >
            {generating ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Generazione in corso…</>
            ) : (
              <><Download className="mr-2 h-4 w-4" />Genera Report</>
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
