import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";

const DEADLINES: { label: string; month: number; day: number }[] = [
  { label: "IVA trimestrale Q4", month: 3, day: 16 },
  { label: "Acconto IRPEF I rata", month: 6, day: 30 },
  { label: "Acconto IRPEF II rata", month: 11, day: 30 },
  { label: "IVA trimestrale Q3", month: 12, day: 16 },
];

function nextOccurrence(month: number, day: number): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const year = today.getFullYear();
  let d = new Date(year, month - 1, day);
  if (d < today) d = new Date(year + 1, month - 1, day);
  return d;
}

function daysUntil(date: Date): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function UpcomingDeadlines() {
  const items = DEADLINES.map((d) => {
    const date = nextOccurrence(d.month, d.day);
    const days = daysUntil(date);
    return { ...d, date, days };
  }).sort((a, b) => a.days - b.days);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Calendar className="h-5 w-5" /> Prossime scadenze
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border">
          {items.map((it) => {
            const urgent = it.days <= 7;
            const soon = !urgent && it.days <= 30;
            const tone = urgent
              ? "bg-destructive/10 text-destructive border-destructive/30"
              : soon
                ? "bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-500/10 dark:text-orange-400 dark:border-orange-500/30"
                : "bg-muted text-muted-foreground border-border";
            const formatted = it.date.toLocaleDateString("it-IT", { day: "2-digit", month: "long", year: "numeric" });
            return (
              <li key={it.label} className="flex items-center justify-between py-3 gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-sm truncate">{it.label}</p>
                  <p className="text-xs text-muted-foreground">{formatted}</p>
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full border whitespace-nowrap ${tone}`}>
                  {it.days === 0 ? "Oggi" : it.days === 1 ? "Domani" : `Tra ${it.days} giorni`}
                </span>
              </li>
            );
          })}
        </ul>
      </CardContent>
    </Card>
  );
}