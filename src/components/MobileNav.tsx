import { LayoutDashboard, Landmark, ArrowLeftRight, Target, Settings } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const items = [
  { title: "Dashboard", url: "/dashboard", icon: LayoutDashboard },
  { title: "Conti", url: "/accounts", icon: Landmark },
  { title: "Transazioni", url: "/transactions", icon: ArrowLeftRight },
  { title: "Budget", url: "/budgets", icon: Target },
  { title: "Impostazioni", url: "/settings", icon: Settings },
];

export function MobileNav() {
  const location = useLocation();
  const isActive = (path: string) => location.pathname === path || location.pathname.startsWith(path + "/");

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t bg-card md:hidden pb-[env(safe-area-inset-bottom)]">
      <div className="flex items-stretch justify-around py-2">
        {items.map((item) => (
          <Link
            key={item.title}
            to={item.url}
            className={cn(
              "flex flex-1 min-w-0 flex-col items-center gap-0.5 px-1 py-1 transition-colors",
              isActive(item.url) ? "text-primary font-medium" : "text-muted-foreground"
            )}
          >
            <item.icon className="h-5 w-5 shrink-0" />
            <span className="text-[10px] leading-tight truncate max-w-full">{item.title}</span>
          </Link>
        ))}
      </div>
    </nav>
  );
}
