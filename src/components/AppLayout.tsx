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
  const { signOut } = useAuth();
  const { showWarning, dismissWarning } = useInactivityTimeout(signOut);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full">
        <div className="hidden md:block">
          <AppSidebar />
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-12 flex items-center justify-between border-b bg-card px-4 sticky top-0 z-40">
            <div className="flex items-center">
              <SidebarTrigger className="hidden md:flex" />
              <span className="md:hidden font-bold text-primary text-lg">Liquidò</span>
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
