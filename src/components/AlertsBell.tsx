import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { startOfMonth, format } from "date-fns";
import { evaluateAlerts } from "@/lib/edge-functions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

const codeColors: Record<string, string> = {
  A1: "bg-destructive text-destructive-foreground",
  A2: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  A3: "bg-[hsl(var(--warning))] text-[hsl(var(--warning-foreground))]",
  A4: "bg-secondary text-secondary-foreground",
  A5: "bg-destructive text-destructive-foreground",
};

export function AlertsBell() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const periodStart = format(startOfMonth(new Date()), "yyyy-MM-dd");

  const { data } = useQuery({
    queryKey: ["alerts", periodStart],
    queryFn: () => evaluateAlerts(periodStart),
    enabled: !!user,
    refetchInterval: 5 * 60 * 1000,
  });

  const alerts = data?.alerts?.filter((a: any) => a.triggered) ?? [];
  const count = alerts.length;

  const markSeen = async (alertCode: string) => {
    await supabase
      .from("alert_history")
      .update({ status: "seen", seen_at: new Date().toISOString() })
      .eq("user_id", user!.id)
      .eq("period_start", periodStart)
      .eq("alert_code", alertCode);
    queryClient.invalidateQueries({ queryKey: ["alerts"] });
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="relative">
          <Bell className="h-5 w-5" />
          {count > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] font-bold text-destructive-foreground">
              {count}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="end">
        <div className="px-4 py-3 border-b">
          <h4 className="font-semibold text-sm">Alert</h4>
        </div>
        <ScrollArea className="max-h-80">
          {alerts.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground text-center">Nessun alert attivo</p>
          ) : (
            <div className="divide-y">
              {alerts.map((a: any) => (
                <div key={a.code + (a.metadata?.category_id ?? "")} className="p-3 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <Badge className={codeColors[a.code] ?? ""}>{a.code}</Badge>
                    <span className="text-sm font-medium">{a.title}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{a.message}</p>
                  <Button variant="outline" size="sm" className="text-xs h-7" onClick={() => markSeen(a.code)}>
                    Segna come visto
                  </Button>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
