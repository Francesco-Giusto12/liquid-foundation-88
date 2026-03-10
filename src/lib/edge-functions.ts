import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = (supabase as any).supabaseUrl;

async function getAuthHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");
  return {
    Authorization: `Bearer ${session.access_token}`,
    "Content-Type": "application/json",
  };
}

export async function calculateLiquidity(periodStart: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/calculate-liquidity`, {
    method: "POST",
    headers,
    body: JSON.stringify({ period_start: periodStart }),
  });
  if (!res.ok) throw new Error("Failed to calculate liquidity");
  return res.json();
}

export async function evaluateAlerts(periodStart: string) {
  const headers = await getAuthHeaders();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/evaluate-alerts`, {
    method: "POST",
    headers,
    body: JSON.stringify({ period_start: periodStart }),
  });
  if (!res.ok) throw new Error("Failed to evaluate alerts");
  return res.json();
}

export async function importCsv(file: File, confirm: boolean, mapping?: Record<string, string>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const formData = new FormData();
  formData.append("file", file);
  formData.append("confirm", confirm ? "true" : "false");
  if (mapping) formData.append("mapping", JSON.stringify(mapping));

  const res = await fetch(`${SUPABASE_URL}/functions/v1/import-csv`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    body: formData,
  });
  if (!res.ok && res.status !== 422) throw new Error("Failed to import CSV");
  return res.json();
}

export async function generateReport(periodStart: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.access_token) throw new Error("Not authenticated");

  const res = await fetch(`${SUPABASE_URL}/functions/v1/generate-report`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ period_start: periodStart }),
  });
  if (!res.ok) throw new Error("Failed to generate report");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `liquidò-report-${periodStart.slice(0, 7)}.pdf`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
