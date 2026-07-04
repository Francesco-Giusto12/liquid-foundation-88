import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listAccounts from "./tools/list-accounts";
import listTransactions from "./tools/list-transactions";
import createTransaction from "./tools/create-transaction";

const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "liquido-mcp",
  title: "Liquidò MCP",
  version: "0.1.0",
  instructions:
    "Strumenti per Liquidò, l'app di gestione finanziaria per freelance italiani. Usa `list_accounts` per elencare i conti, `list_transactions` per leggere le transazioni (con filtri per data, tipo, conto) e `create_transaction` per registrarne una nuova.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listAccounts, listTransactions, createTransaction],
});