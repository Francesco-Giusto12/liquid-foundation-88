import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { MobileNav } from "@/components/MobileNav";
import { AlertsBell } from "@/components/AlertsBell";
import { useAuth } from "@/hooks/useAuth";
import { useInactivityTimeout } from "@/hooks/useInactivityTimeout";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { signOut, user } = useAuth();
  const { showWarning, dismissWarning } = useInactivityTimeout(signOut);
  const displayName = (user?.user_metadata?.full_name as string | undefined)?.split(" ")[0] || user?.email?.split("@")[0] || "";
  const initial = (displayName || "?").charAt(0).toUpperCase();

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <div className="hidden md:block">
          <AppSidebar />
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center justify-between gap-2 border-b bg-card px-3 sm:px-4 sticky top-0 z-40">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <SidebarTrigger className="hidden md:flex" />
              <div className="md:hidden flex items-center gap-2 min-w-0">
                <div className="h-8 w-8 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-semibold">
                  {initial}
                </div>
                {displayName && (
                  <span className="text-sm truncate min-w-0">Ciao, <span className="font-semibold">{displayName}</span></span>
                )}
              </div>
            </div>
            <AlertsBell />
          </header>
          <main className="flex-1 p-4 md:p-6 pb-20 md:pb-6">
            {children}
          </main>
        </div>
        <MobileNav />
      </div>

      <Dialog open={showWarning} onOpenChange={(open) => { if (!open) dismissWarning(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Sessione in scadenza</DialogTitle>
            <DialogDescription>
              Sei inattivo da 30 minuti. Verrai disconnesso automaticamente tra 5 minuti.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={signOut}>Esci ora</Button>
            <Button onClick={dismissWarning}>Resta connesso</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarProvider>
  );
}
