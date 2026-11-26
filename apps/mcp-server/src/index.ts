/**
 * 家計簿 MCP サーバー: 生成AIが読み取ったレシートの記録、家計データの参照、カテゴリーの管理
 *
 * レシート1枚 = 1回の会計 = 支出1件（金額は支払総額、明細は支出の内訳）。カテゴリー別の額は支払総額を内訳の比率で按分する
 */
import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport as Transport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ulid } from 'ulidx';
import { z } from 'zod';
import {
  MAX_CATEGORY_LABEL_LENGTH,
  categoryLabel,
  findCategory,
  planCategoryCreation,
  planCategoryDeletion,
  planCategoryUpdate,
  type Category,
} from '@maronn/domain/categories';
import {
  MAX_EXPENSE_ITEMS,
  MAX_EXPENSE_ITEM_AMOUNT,
  MAX_EXPENSE_ITEM_QUANTITY,
  MAX_EXPENSE_ITEM_MEMO_LENGTH,
  summarizeSpending,
  type CategoryAmount,
  type ExpenseItem,
} from '@maronn/domain';
import { planReceiptRecording, receiptDate } from '@maronn/domain/receipt';
import { createHouseholdStore, type HouseholdStore } from '@maronn/household-store';
import { protectedResource, type AccessTokenCaller, type ResourceContext } from '@maronn/oauth-resource';

const app = new Hono<ResourceContext>();
const resource = protectedResource({ path: '/mcp', scope: 'household' });
app.get('/.well-known/oauth-protected-resource/:path{.*}?', resource.metadata);
app.use('/mcp', resource.authenticate);
// ステートレスなので、SSE のストリームもセッションも持たない
app.on(['GET', 'DELETE'], '/mcp', (c) => c.body(null, 405, { Allow: 'POST' }));
app.post('/mcp', async (c) => {
  const caller = c.get('caller');
  const store = createHouseholdStore(c.env.DB, caller.userId);
  // ツールの説明に利用者のカテゴリーを載せるため、リクエストごとに読む
  const server = createServer(store, caller, await store.listCategories());
  const transport = new Transport({ enableJsonResponse: true });
  await server.connect(transport);
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
/** メモ（空なら付けない。改行も残す）。欄ごとに新しく作る */
const memoText = () => z.string().trim().max(MAX_EXPENSE_ITEM_MEMO_LENGTH).optional();
/** カテゴリーを value か名前で指す入力（追加したカテゴリーの value は ULID の 26 文字）。欄ごとに新しく作る */
const categoryRef = () => text(40);
const now = () => new Date().toISOString();

function createServer(store: HouseholdStore, { userId, clientId }: AccessTokenCaller, categories: Category[]) {
  const server = new McpServer({ name: 'maronn-household', version: '1.0.0' });
  const readOnly = { readOnlyHint: true };
  const catalog = JSON.stringify(
    Object.fromEntries(categories.filter((category) => !category.deleted).map(({ value, label }) => [value, label]))
  );
  // 欄ごとに新しいスキーマを作る（同じスキーマを使い回すと JSON Schema が $ref になり、説明が読まれないことがある）
  const receiptCategory = (note = '') =>
    categoryRef()
      .optional()
      .describe(`${note}カテゴリーの value か名前（合うものがなければ other）: ${catalog}`);
  /** カテゴリーの指定を value にそろえる。知らない・削除したカテゴリーは CategoryError（ツールの結果はエラーになる） */
  const toValue = (input: string | undefined) =>
    input === undefined ? undefined : findCategory(categories, input).value;
  /** 支出・明細の category の表示名（削除したカテゴリーも名前を返す。知らない値はそのまま） */
  const labelOf = (value: string | null | undefined) =>
    value === null || value === undefined ? null : (categoryLabel(categories, value) ?? value);
  /** カテゴリー別の額にカテゴリー名を付ける（get_budget_summary・record_receipt・list_records で同じ形） */
  const withLabels = (amounts: CategoryAmount[]) =>
    amounts.map(({ category, amount }) => ({ category, label: labelOf(category), amount }));
  /** 内訳の各行にカテゴリー名を付ける */
  const itemsWithLabels = (items: ExpenseItem[] | null) =>
    items?.map((item) => ({ ...item, categoryLabel: labelOf(item.category) })) ?? null;

  server.registerTool(
    'record_receipt',
    {
      description:
        'レシート写真から読み取った購入（1回の会計）を記録する。支払総額を1件の支出にし、明細を内訳（品名・金額・カテゴリー）として残す。' +
        'カテゴリー別の額は支払総額を明細の金額の比率で按分する（税・値引きは明細に入れず totalAmount に反映）。' +
        '同じ日・同じ支払総額のレシートや、アプリで記録した同じ日・同じ金額の支出があれば duplicate を返す。' +
        'ユーザーに確かめ、別の買い物なら allowDuplicate: true で再実行する（アプリの記録と同じ会計なら、二重にならないよう記録しない）。' +
        'difference（支払総額と明細合計の差）が大きければ読み取りを見直す。' +
        'ユーザーが会計全体や品物についてメモ（用途・割り勘・立替など）を頼んだら、memo（会計全体）と items[].memo（品物ごと）に入れる。' +
        '会計の memo はアプリのメモ欄に表示される（省略すると店名）。',
      inputSchema: {
        storeName: text(100).describe('店名'),
        purchasedAt: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/)
          .describe('購入日時 YYYY-MM-DD[THH:mm]'),
        totalAmount: yen.positive().describe('支払総額（税込・値引き後、円）'),
        taxAmount: yen.optional().describe('消費税額（円）'),
        paymentMethod: text(30).optional().describe('cash/credit_card/e_money/qr_code/other'),
        category: receiptCategory('会計のカテゴリー。明細にカテゴリーがないときに使う（省略すると明細の金額が最大のカテゴリー）。'),
        memo: memoText().describe('会計全体（支払総額）のメモ。アプリでは店名の代わりにこのメモが表示される（省略すると店名）'),
        items: z
          .array(
            z.object({
              name: text(100),
              amount: yen.max(MAX_EXPENSE_ITEM_AMOUNT).describe('数量×単価（円）'),
              quantity: z.number().positive().max(MAX_EXPENSE_ITEM_QUANTITY).optional(),
              category: receiptCategory(),
              memo: memoText().describe('この品についてのメモ（ユーザーが頼んだときに付ける）'),
            })
          )
          .max(MAX_EXPENSE_ITEMS)
          .optional(),
        allowDuplicate: z.boolean().optional().describe('同じ日・同じ金額の別の買い物として記録する'),
      },
    },
    async (input) => {
      // 何かを保存する前に、カテゴリーを確かめて value にそろえる
      const receipt = {
        ...input,
        category: toValue(input.category),
        items: input.items?.map((item) => ({ ...item, category: toValue(item.category) })),
      };
      if (!receipt.allowDuplicate) {
        const same = await store.findSameDayRecords(receiptDate(receipt.purchasedAt), receipt.totalAmount);
        const existing = [
          ...same.receipts.map(({ id, storeName, purchasedAt }) => ({
            source: 'receipt',
            receiptId: id,
            storeName,
            purchasedAt,
          })),
          ...same.expenses.map(({ id, date, amount, memo, category }) => ({
            source: 'app',
            expenseId: id,
            date,
            amount,
            memo,
            categoryLabel: labelOf(category),
          })),
        ];
        if (existing.length > 0) return json({ duplicate: true, existing });
      }
      const plan = planReceiptRecording(receipt, { userId, clientId, now: now(), newId: ulid });
      await store.saveReceipt(plan);
      return json({
        duplicate: false,
        receiptId: plan.receipt.id,
        expenseId: plan.expense.id,
        amount: plan.expense.amount,
        category: plan.expense.category,
        categoryLabel: labelOf(plan.expense.category),
        memo: plan.expense.memo,
        itemsTotal: plan.itemsTotal,
        difference: plan.difference,
        byCategory: withLabels(plan.byCategory),
      });
    }
  );

  server.registerTool(
    'delete_receipt',
    {
      description: '記録したレシートを取り消す（その支出と内訳も削除）',
      inputSchema: { receiptId: text(40) },
      annotations: { destructiveHint: true },
    },
    async ({ receiptId }) => json({ deleted: await store.deleteReceipt(receiptId) })
  );

  server.registerTool(
    'list_records',
    {
      description:
        '月の支出（1件 = 1回の会計、amount は支払総額。レシート由来は店名付き、category は会計の主なカテゴリー）。' +
        'memo は会計のメモ（アプリで編集できる。メモを付けずに記録したレシートは店名）。' +
        'ただし 2026-11-21 までに記録したレシートは、同じ receiptId の支出がカテゴリ別に複数に分かれている（合わせて1回の会計）。' +
        'total と byCategory はサブ予算を含む月の全支出で、byCategory は内訳の比率で按分したカテゴリ別の額（カテゴリ別の集計にはこれを使う。予算に対する内訳は get_budget_summary）。' +
        'includeItems で各支出の内訳（expenses[].items。品物ごとのメモは items[].memo）と、' +
        'レシートの店名・日時・税・支払方法（receipts。以前のレシートは明細も items に持つ）を返す',
      inputSchema: { month, includeItems: z.boolean().optional() },
      annotations: readOnly,
    },
    async (input) => {
      const expenses = await store.listExpenses(input.month);
      const receipts = input.includeItems ? await store.listReceipts(input.month) : undefined;
      const summary = summarizeSpending(0, expenses);
      return json({
        total: summary.spent,
        byCategory: withLabels(summary.byCategory),
        expenses: expenses.map(({ items, ...expense }) => ({
          ...expense,
          categoryLabel: labelOf(expense.category),
          ...(input.includeItems ? { items: itemsWithLabels(items) } : {}),
        })),
        receipts: receipts?.map(({ items, ...receipt }) => ({
          ...receipt,
          ...(items.length > 0
            ? { items: items.map((item) => ({ ...item, categoryLabel: labelOf(item.category) })) }
            : {}),
        })),
      });
    }
  );

  server.registerTool(
    'get_budget_summary',
    {
      description: '月の予算・支出合計・残額とカテゴリ別内訳（サブ予算の支出を除く。内訳のある支出は内訳の比率で按分）',
      inputSchema: { month },
      annotations: readOnly,
    },
    async (input) => {
      const summary = await store.getBudgetSummary(input.month);
      return json({ month: input.month, ...summary, byCategory: withLabels(summary.byCategory) });
    }
  );

  registerCategoryTools(server, store, categories);
  return server;
}

/** カテゴリーの一覧・追加・名前変更・削除（支出の行は書き換えない） */
function registerCategoryTools(server: McpServer, store: HouseholdStore, categories: Category[]) {
  server.registerTool(
    'list_categories',
    {
      description: '支出カテゴリーの一覧（value と名前。builtIn は既定のカテゴリー）',
      annotations: { readOnlyHint: true },
    },
    async () =>
      json({
        categories: categories
          .filter((category) => !category.deleted)
          .map(({ value, label, builtIn }) => ({ value, label, builtIn })),
      })
  );

  server.registerTool(
    'create_category',
    {
      description:
        'カテゴリーを追加する。ユーザーが追加を頼んだときだけ使う（記録で合うカテゴリーがないだけなら other に計上する）。' +
        '同じ名前のカテゴリーがあれば作らずにそれを返し（status: existing）、削除したカテゴリーと同じ名前なら復元する（status: restored。また選べるようになる）',
      inputSchema: { label: text(MAX_CATEGORY_LABEL_LENGTH).describe('カテゴリー名') },
      annotations: { destructiveHint: false },
    },
    async ({ label }) => {
      const plan = planCategoryCreation(categories, label, { now: now(), newId: ulid });
      if (plan.status === 'created' && !(await store.addCategory(plan.change))) {
        // 同じ名前のカテゴリーが同時に作られていた（並列の呼び出しや再送）。作らずにそれを返す
        const existing = findCategory(await store.listCategories(), plan.category.label);
        return json({ status: 'existing', value: existing.value, label: existing.label });
      }
      if (plan.status === 'restored') await store.saveCategory(plan.change);
      return json({ status: plan.status, value: plan.category.value, label: plan.category.label });
    }
  );

  server.registerTool(
    'update_category',
    {
      description: 'カテゴリーの名前を変える（既定のカテゴリーも変えられる）。記録済みの支出も新しい名前で表示される',
      inputSchema: {
        category: categoryRef().describe('名前を変えるカテゴリーの value か今の名前'),
        label: text(MAX_CATEGORY_LABEL_LENGTH).describe('新しい名前'),
      },
      annotations: { destructiveHint: false, idempotentHint: true },
    },
    async (input) => {
      const { change } = planCategoryUpdate(categories, input.category, input.label, now());
      await store.saveCategory(change);
      return json({ value: change.value, label: change.label });
    }
  );

  server.registerTool(
    'delete_category',
    {
      description:
        'カテゴリーを削除する（カテゴリーのない支出の計上先 other は削除できない）。' +
        '記録済みの支出（内訳でそのカテゴリーを使う会計を含む）はそのカテゴリーと名前のまま残り（expenseCount 件）、新しい記録には使えなくなる',
      inputSchema: { category: categoryRef().describe('削除するカテゴリーの value か名前') },
      annotations: { destructiveHint: true },
    },
    async (input) => {
      const { change } = planCategoryDeletion(categories, input.category, now());
      await store.saveCategory(change);
      return json({
        deleted: true,
        value: change.value,
        label: change.label,
        expenseCount: await store.countExpensesInCategory(change.value),
      });
    }
  );
}
