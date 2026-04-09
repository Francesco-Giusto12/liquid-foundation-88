import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  illustration?: string;
  title: string;
  subtitle?: string;
  cta?: { label: string; to: string };
  secondaryCta?: { label: string; to: string };
}

export function EmptyState({ title, subtitle, cta, secondaryCta }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center gap-3">
      <p className="font-medium text-foreground">{title}</p>
      {subtitle && <p className="text-sm text-muted-foreground max-w-xs">{subtitle}</p>}
      <div className="flex gap-2 mt-2">
        {cta && (
          <Button asChild size="sm">
            <Link to={cta.to}>{cta.label}</Link>
          </Button>
        )}
        {secondaryCta && (
          <Button asChild variant="outline" size="sm">
            <Link to={secondaryCta.to}>{secondaryCta.label}</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
