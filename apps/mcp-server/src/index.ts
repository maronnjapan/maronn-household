/** 家計簿 MCP サーバー: 生成AIが読み取ったレシートの記録と、家計データの参照 */
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport as Transport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ulid } from 'ulidx';
import { z } from 'zod';
import { EXPENSE_CATEGORIES as CATEGORIES } from '@maronn/domain/categories';
import { planReceiptRecording, receiptDate } from '@maronn/domain/receipt';
import { createHouseholdStore } from '@maronn/household-store';
import { protectedResource, type AccessTokenCaller, type ResourceContext } from '@maronn/oauth-resource';

const app = new Hono<ResourceContext>();
const resource = protectedResource({ path: '/mcp', scope: 'household' });
app.get('/.well-known/oauth-protected-resource/:path{.*}?', resource.metadata);
app.use('/mcp', resource.authenticate);
// ステートレスなので、SSE のストリームもセッションも持たない
app.on(['GET', 'DELETE'], '/mcp', (c) => c.body(null, 405, { Allow: 'POST' }));
app.post('/mcp', async (c) => {
  const transport = new Transport({ enableJsonResponse: true });
  await createServer(c.env.DB, c.get('caller')).connect(transport);
  return transport.handleRequest(c.req.raw);
});
export default app;

const json = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
const text = (max: number) => z.string().trim().min(1).max(max);
const yen = z.number().int().nonnegative();
const month = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .describe('YYYY-MM');
const category = z
  .enum(CATEGORIES.map((c) => c.value) as [string, ...string[]])
  .describe(CATEGORIES.map((c) => `${c.value}=${c.label}`).join(', '));

const receipt = {
  storeName: text(100).describe('店名'),
  purchasedAt: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
    .describe('購入日時 YYYY-MM-DD[THH:mm]'),
  totalAmount: yen.positive().describe('支払総額（税込・値引き後、円）'),
  taxAmount: yen.optional().describe('消費税額（円）'),
  paymentMethod: text(30).optional().describe('cash/credit_card/e_money/qr_code/other'),
  category: category.optional().describe('明細にカテゴリがないときに使う'),
  items: z
    .array(
      z.object({
        name: text(100),
        amount: yen.describe('数量×単価（円）'),
        quantity: z.number().positive().optional(),
        category: category.optional(),
      })
    )
    .max(200)
    .optional(),
  allowDuplicate: z.boolean().optional().describe('同じ日・同じ金額の別の買い物として記録する'),
};

function createServer(db: D1Database, { userId, clientId }: AccessTokenCaller) {
  const store = createHouseholdStore(db, userId);
  const server = new McpServer({ name: 'maronn-household', version: '1.0.0' });
  const readOnly = { readOnlyHint: true };

  server.registerTool(
    'record_receipt',
    {
      description:
        'レシート写真から読み取った購入を記録する。支払総額を明細の比率でカテゴリ別の支出に按分する（税・値引きは明細に入れず totalAmount に反映）。' +
        '同じ日・同じ支払総額のレシートがあれば duplicate を返すので、ユーザーに確かめて別の買い物なら allowDuplicate: true で再実行する。' +
        'difference（支払総額と明細合計の差）が大きければ読み取りを見直す。',
      inputSchema: receipt,
    },
    async (input) => {
      const existing = input.allowDuplicate
        ? []
        : await store.findSameDayReceipts(receiptDate(input.purchasedAt), input.totalAmount);
      if (existing.length > 0) return json({ duplicate: true, existing });
      const plan = planReceiptRecording(input, { userId, clientId, now: new Date().toISOString(), newId: ulid });
      await store.saveReceipt(plan);
      const expenses = plan.expenses.map(({ amount, category, memo }) => ({ amount, category, memo }));
      return json({
        duplicate: false,
        receiptId: plan.receipt.id,
        itemsTotal: plan.itemsTotal,
        difference: plan.difference,
        expenses,
      });
    }
  );

  server.registerTool(
    'delete_receipt',
    {
      description: '記録したレシートを取り消す（明細と按分した支出も削除）',
      inputSchema: { receiptId: text(40) },
      annotations: { destructiveHint: true },
    },
    async ({ receiptId }) => json({ deleted: await store.deleteReceipt(receiptId) })
  );

  server.registerTool(
    'list_records',
    {
      description: '月の支出（レシート由来は店名付き）。includeItems でレシートと明細も返す',
      inputSchema: { month, includeItems: z.boolean().optional() },
      annotations: readOnly,
    },
    async (input) =>
      json({
        expenses: await store.listExpenses(input.month),
        receipts: input.includeItems ? await store.listReceipts(input.month) : undefined,
      })
  );

  server.registerTool(
    'get_budget_summary',
    {
      description: '月の予算・支出合計・残額とカテゴリ別内訳（サブ予算の支出を除く）',
      inputSchema: { month },
      annotations: readOnly,
    },
    async (input) => json({ month: input.month, ...(await store.getBudgetSummary(input.month)) })
  );
  return server;
}
