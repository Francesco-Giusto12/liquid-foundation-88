import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function sb(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_transactions",
  title: "List transactions",
  description: "List the signed-in user's transactions, optionally filtered by date range, type, or account.",
  inputSchema: {
    from: z.string().optional().describe("ISO date (YYYY-MM-DD) lower bound, inclusive."),
    to: z.string().optional().describe("ISO date (YYYY-MM-DD) upper bound, inclusive."),
    type: z.enum(["income", "expense"]).optional().describe("Filter by transaction type."),
    account_id: z.string().uuid().optional().describe("Filter by account UUID."),
    limit: z.number().int().min(1).max(200).default(50),
  },
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async ({ from, to, type, account_id, limit }, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    let q = sb(ctx)
      .from("transactions")
      .select("id,date,amount,type,description,merchant,category_id,account_id,is_categorized")
      .order("date", { ascending: false })
      .limit(limit);
    if (from) q = q.gte("date", from);
    if (to) q = q.lte("date", to);
    if (type) q = q.eq("type", type);
    if (account_id) q = q.eq("account_id", account_id);
    const { data, error } = await q;
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: { transactions: data ?? [] },
    };
  },
});