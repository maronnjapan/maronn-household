/** 家計簿 MCP サーバー: 生成AIが読み取ったレシートの登録と、家計データの参照（auth-server が発行したトークンで保護） */
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createRemoteJWKSet, customFetch, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import { and, asc, desc, eq, gte, inArray, lt, lte } from 'drizzle-orm';
import { ulid } from 'ulidx';
import { z } from 'zod';
import { budgets, expenses, receiptItems, receipts } from '@maronn/db-schema/household';
import { EXPENSE_CATEGORY_VALUES } from '@maronn/domain/categories';
import { allocateReceiptToExpenses, monthDateRange, receiptDate, receiptFingerprint, summarizeSpending } from '@maronn/domain/receipt';

type Env = { DB: D1Database; AUTH: Fetcher; ISSUER: string };
type Caller = { db: DrizzleD1Database; userId: string; clientId: string };
const SCOPE = 'household';
const DEFAULT_BUDGET = 120_000;
const app = new Hono<{ Bindings: Env; Variables: { caller: Omit<Caller, 'db'> } }>();
let jwks: JWTVerifyGetKey | undefined; // isolate 内でキャッシュ（未知の kid なら jose が取り直す）

const metadataUrl = (env: Env) => `${env.ISSUER}/.well-known/oauth-protected-resource/mcp`;
app.get('/.well-known/oauth-protected-resource/:path{.*}?', (c) =>
  c.json({ resource: `${c.env.ISSUER}/mcp`, authorization_servers: [c.env.ISSUER], scopes_supported: [SCOPE], bearer_methods_supported: ['header'] }));

app.use('/mcp', async (c, next) => {
  const challenge = (status: 401 | 403, extra = '') => c.json({ error: status === 401 ? 'invalid_token' : 'insufficient_scope' }, status,
    { 'WWW-Authenticate': `Bearer ${extra}resource_metadata="${metadataUrl(c.env)}", scope="${SCOPE}"` });
  jwks ??= createRemoteJWKSet(new URL(`${c.env.ISSUER}/.well-known/jwks.json`), { [customFetch]: (url, init) => c.env.AUTH.fetch(url, init) });
  const token = /^Bearer (.+)$/.exec(c.req.header('Authorization') ?? '')?.[1];
  const payload = token && (await jwtVerify(token, jwks, { issuer: c.env.ISSUER, typ: 'at+jwt', algorithms: ['RS256'] }).catch(() => null))?.payload;
  if (!payload || !payload.sub) return challenge(401);
  if (!String(payload.scope ?? '').split(' ').includes(SCOPE)) return challenge(403, 'error="insufficient_scope", ');
  c.set('caller', { userId: payload.sub, clientId: String(payload.client_id) });
  await next();
});

app.all('/mcp', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await createServer({ db: drizzle(c.env.DB), ...c.get('caller') }).connect(transport);
  return transport.handleRequest(c.req.raw);
});

const reply = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data) }] });
const month = z.string().regex(/^\d{4}-\d{2}$/).describe('対象月（YYYY-MM）');
const category = z.enum(EXPENSE_CATEGORY_VALUES);

function createServer({ db, userId, clientId }: Caller) {
  const server = new McpServer({ name: 'maronn-household', version: '1.0.0' });
  const inMonth = (m: string) => { const { start, end } = monthDateRange(m); return and(eq(expenses.userId, userId), gte(expenses.date, start), lt(expenses.date, end)); };

  server.registerTool('record_receipt', {
    description: 'レシート写真から読み取った購入を家計簿に記録する。支払総額を明細の比率でカテゴリ別の支出に按分する（消費税・値引きは明細に入れず totalAmount に反映すればよい）。同じレシートは duplicate を返すので、別の購入なら allowDuplicate: true で再実行する。',
    inputSchema: {
      storeName: z.string().min(1).describe('店名'),
      purchasedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}/).describe('購入日時（YYYY-MM-DD または YYYY-MM-DDTHH:mm）'),
      totalAmount: z.number().int().nonnegative().describe('支払総額（税込・値引き後、円）'),
      taxAmount: z.number().int().nonnegative().optional(),
      paymentMethod: z.string().optional().describe('cash / credit_card / e_money / qr_code / other'),
      category: category.optional().describe('明細にカテゴリがないときのカテゴリ'),
      items: z.array(z.object({ name: z.string().min(1), amount: z.number().int().nonnegative(), quantity: z.number().positive().optional(), category: category.optional() })).optional(),
      allowDuplicate: z.boolean().optional(),
    },
  }, async (input) => {
    const fingerprint = receiptFingerprint(input) + (input.allowDuplicate ? `|${ulid()}` : '');
    const existing = await db.select({ id: receipts.id }).from(receipts).where(and(eq(receipts.userId, userId), eq(receipts.fingerprint, fingerprint))).get();
    if (existing) return reply({ duplicate: true, receiptId: existing.id });
    const now = new Date().toISOString();
    const receiptId = ulid();
    const date = receiptDate(input.purchasedAt);
    const allocated = allocateReceiptToExpenses(input).map((e) => ({ ...e, id: ulid(), userId, date, createdAt: now, updatedAt: now, deviceId: `mcp:${clientId}`, receiptId }));
    await db.batch([
      db.insert(receipts).values({ id: receiptId, userId, storeName: input.storeName, purchasedAt: input.purchasedAt, totalAmount: input.totalAmount, taxAmount: input.taxAmount, paymentMethod: input.paymentMethod, fingerprint, source: clientId, createdAt: now, updatedAt: now }),
      ...(input.items ?? []).map((item, position) => db.insert(receiptItems).values({ ...item, id: ulid(), receiptId, userId, position })),
      ...allocated.map((expense) => db.insert(expenses).values(expense)),
    ]);
    return reply({ duplicate: false, receiptId, expenses: allocated.map(({ amount, category, memo }) => ({ amount, category, memo })) });
  });

  server.registerTool('list_expenses', { description: '指定月の支出の一覧（レシート由来の支出は receiptId 付き）', inputSchema: { month } }, async (input) =>
    reply({ expenses: await db.select({ id: expenses.id, date: expenses.date, amount: expenses.amount, category: expenses.category, memo: expenses.memo, receiptId: expenses.receiptId })
      .from(expenses).where(inMonth(input.month)).orderBy(asc(expenses.date)).all() }));

  server.registerTool('list_receipts', { description: '指定月に登録したレシートの一覧（明細付き）', inputSchema: { month } }, async (input) => {
    const { start, end } = monthDateRange(input.month);
    const rows = await db.select().from(receipts).where(and(eq(receipts.userId, userId), gte(receipts.purchasedAt, start), lt(receipts.purchasedAt, end))).orderBy(asc(receipts.purchasedAt)).all();
    const items = rows.length ? await db.select().from(receiptItems).where(inArray(receiptItems.receiptId, rows.map((r) => r.id))).orderBy(asc(receiptItems.position)).all() : [];
    return reply({ receipts: rows.map(({ fingerprint: _f, userId: _u, ...r }) => ({ ...r, items: items.filter((i) => i.receiptId === r.id).map(({ name, amount, quantity, category }) => ({ name, amount, quantity, category })) })) });
  });

  server.registerTool('get_budget_summary', { description: '指定月の予算・支出合計・残額とカテゴリ別内訳', inputSchema: { month } }, async (input) => {
    const budget = await db.select({ amount: budgets.amount }).from(budgets).where(and(eq(budgets.userId, userId), lte(budgets.month, input.month))).orderBy(desc(budgets.month)).get();
    const rows = await db.select({ amount: expenses.amount, category: expenses.category }).from(expenses).where(inMonth(input.month)).all();
    return reply({ month: input.month, ...summarizeSpending(budget?.amount ?? DEFAULT_BUDGET, rows) });
  });
  return server;
}

export default app;
