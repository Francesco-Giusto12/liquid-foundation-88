import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";

import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Dashboard from "./pages/Dashboard";
import Accounts from "./pages/Accounts";
import NewTransaction from "./pages/NewTransaction";
import ImportCsv from "./pages/ImportCsv";
import Reports from "./pages/Reports";
import Transactions from "./pages/Transactions";
import Settings from "./pages/Settings";
import Placeholder from "./pages/Placeholder";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function ProtectedPage({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/dashboard" element={<ProtectedPage><Dashboard /></ProtectedPage>} />
            <Route path="/accounts" element={<ProtectedPage><Accounts /></ProtectedPage>} />
            <Route path="/accounts/:id" element={<ProtectedPage><Placeholder /></ProtectedPage>} />
            <Route path="/transactions" element={<ProtectedPage><Transactions /></ProtectedPage>} />
            <Route path="/transactions/new" element={<ProtectedPage><NewTransaction /></ProtectedPage>} />
            <Route path="/import" element={<ProtectedPage><ImportCsv /></ProtectedPage>} />
            <Route path="/budgets" element={<ProtectedPage><Placeholder /></ProtectedPage>} />
            <Route path="/reports" element={<ProtectedPage><Reports /></ProtectedPage>} />
            <Route path="/settings" element={<ProtectedPage><Placeholder /></ProtectedPage>} />
            <Route path="/settings/security" element={<ProtectedPage><Placeholder /></ProtectedPage>} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
