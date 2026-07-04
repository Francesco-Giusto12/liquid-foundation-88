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
  name: "create_transaction",
  title: "Create transaction",
  description: "Create a new transaction for the signed-in user.",
  inputSchema: {
    date: z.string().describe("ISO date YYYY-MM-DD."),
    amount: z.number().describe("Transaction amount in EUR (positive number)."),
    type: z.enum(["income", "expense"]).describe("Entrata (income) o uscita (expense)."),
    description: z.string().optional(),
    merchant: z.string().optional(),
    account_id: z.string().uuid().optional(),
    category_id: z.string().uuid().optional(),
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (input, ctx) => {
    if (!ctx.isAuthenticated()) return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    const { data, error } = await sb(ctx)
      .from("transactions")
      .insert({
        user_id: ctx.getUserId(),
        date: input.date,
        amount: input.amount,
        type: input.type,
        description: input.description ?? null,
        merchant: input.merchant ?? null,
        account_id: input.account_id ?? null,
        category_id: input.category_id ?? null,
        is_categorized: !!input.category_id,
      })
      .select()
      .single();
    if (error) return { content: [{ type: "text", text: error.message }], isError: true };
    return {
      content: [{ type: "text", text: `Transazione creata: ${data.id}` }],
      structuredContent: { transaction: data },
    };
  },
});