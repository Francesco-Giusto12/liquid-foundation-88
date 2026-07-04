import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Droplet } from "lucide-react";

type OAuthAuthzClient = { name?: string; logo_uri?: string };
type OAuthAuthzDetails = { client?: OAuthAuthzClient; redirect_url?: string; redirect_to?: string; scopes?: string[] };
type OAuthAuthzResult = { data: OAuthAuthzDetails | null; error: { message: string } | null };
type OAuthNS = {
  getAuthorizationDetails: (id: string) => Promise<OAuthAuthzResult>;
  approveAuthorization: (id: string) => Promise<OAuthAuthzResult>;
  denyAuthorization: (id: string) => Promise<OAuthAuthzResult>;
};
const oauth = () => (supabase.auth as unknown as { oauth: OAuthNS }).oauth;

function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/dashboard";
  return next;
}

export default function OAuthConsent() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id") ?? "";
  const [details, setDetails] = useState<OAuthAuthzDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!authorizationId) return setError("authorization_id mancante");
      const { data: sess } = await supabase.auth.getSession();
      if (!sess.session) {
        const next = window.location.pathname + window.location.search;
        window.location.href = "/login?next=" + encodeURIComponent(next);
        return;
      }
      const { data, error } = await oauth().getAuthorizationDetails(authorizationId);
      if (!active) return;
      if (error) return setError(error.message);
      const immediate = data?.redirect_url ?? data?.redirect_to;
      if (immediate && !data?.client) { window.location.href = immediate; return; }
      setDetails(data);
    })();
    return () => { active = false; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    setBusy(true);
    const { data, error } = approve
      ? await oauth().approveAuthorization(authorizationId)
      : await oauth().denyAuthorization(authorizationId);
    if (error) { setBusy(false); return setError(error.message); }
    const target = data?.redirect_url ?? data?.redirect_to;
    if (!target) { setBusy(false); return setError("Nessun redirect restituito dal server di autorizzazione."); }
    window.location.href = target;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <Card className="w-full max-w-md p-8">
        <div className="mb-6 flex items-center gap-3">
          <Droplet className="h-8 w-8 fill-[#2563a8] text-[#2563a8]" strokeWidth={0} />
          <h1 className="text-2xl font-bold text-[#1e3a5f]">Liquidò</h1>
        </div>
        {error && <p className="text-sm text-destructive">Errore: {error}</p>}
        {!error && !details && <p className="text-sm text-muted-foreground">Caricamento…</p>}
        {!error && details && (
          <>
            <h2 className="text-lg font-semibold">
              Consenti a {details.client?.name ?? "questa applicazione"} di accedere al tuo account?
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              L'applicazione potrà usare Liquidò con la tua identità: leggere conti e transazioni e crearne di nuove.
            </p>
            <div className="mt-6 flex gap-3">
              <Button variant="outline" className="flex-1" disabled={busy} onClick={() => decide(false)}>
                Nega
              </Button>
              <Button className="flex-1 bg-[#16a34a] hover:bg-[#15803d]" disabled={busy} onClick={() => decide(true)}>
                Approva
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}

export { safeNext };