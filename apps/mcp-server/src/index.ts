/**
 * 家計簿MCP Server
 *
 * 生成AIから家計簿データの分析・記録を可能にするMCPサーバー。
 * Cloudflare Workers上で動作し、Streamable HTTP transportを使用。
 *
 * TODO: OAuth2による認可を別途実装予定
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { z } from 'zod';
import { getMonthlySummary } from './tools/get-monthly-summary';
import { getExpenses } from './tools/get-expenses';
import { addExpense } from './tools/add-expense';
import { updateBudget } from './tools/update-budget';
import { analyzeSpending } from './tools/analyze-spending';

interface Env {
  DB: D1Database;
}

function createMcpServer(db: D1Database, userId: string): McpServer {
  const server = new McpServer({
    name: 'household-mcp',
    version: '0.0.1',
  });

  // 月次サマリー取得
  server.tool(
    'get_monthly_summary',
    '指定月の予算・支出・残額のサマリーを取得する。カテゴリ別の内訳、1日あたりの使用可能額、予算ペースの評価も含む。',
    {
      month: z.string().regex(/^\d{4}-\d{2}$/).describe('対象月（YYYY-MM形式、例: 2026-03）'),
    },
    async ({ month }) => {
      const result = await getMonthlySummary(db, userId, { month });
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 支出一覧取得
  server.tool(
    'get_expenses',
    '支出の一覧を取得する。月やカテゴリでフィルタリング可能。',
    {
      month: z.string().regex(/^\d{4}-\d{2}$/).optional().describe('対象月（YYYY-MM形式）'),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('開始日（YYYY-MM-DD形式）'),
      endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('終了日（YYYY-MM-DD形式）'),
      category: z.string().optional().describe('カテゴリでフィルタリング'),
      limit: z.number().min(1).max(500).optional().describe('取得件数の上限（デフォルト: 100）'),
    },
    async (params) => {
      const result = await getExpenses(db, userId, params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 支出追加
  server.tool(
    'add_expense',
    '新しい支出を記録する。',
    {
      amount: z.number().positive().describe('金額（正の整数、円単位）'),
      category: z.string().optional().describe('カテゴリ（例: 食費、交通費、日用品）'),
      memo: z.string().optional().describe('メモ（例: スーパーで買い物）'),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('日付（YYYY-MM-DD形式、省略時は今日）'),
    },
    async (params) => {
      const result = await addExpense(db, userId, params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 予算更新
  server.tool(
    'update_budget',
    '指定月の予算を設定・更新する。',
    {
      month: z.string().regex(/^\d{4}-\d{2}$/).describe('対象月（YYYY-MM形式、例: 2026-03）'),
      amount: z.number().min(0).describe('予算額（円単位）'),
    },
    async (params) => {
      const result = await updateBudget(db, userId, params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  // 支出分析
  server.tool(
    'analyze_spending',
    '指定期間の支出を分析する。月別推移、カテゴリ別集計、曜日別パターンを返す。',
    {
      startMonth: z.string().regex(/^\d{4}-\d{2}$/).describe('分析開始月（YYYY-MM形式）'),
      endMonth: z.string().regex(/^\d{4}-\d{2}$/).describe('分析終了月（YYYY-MM形式）'),
    },
    async (params) => {
      const result = await analyzeSpending(db, userId, params);
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    },
  );

  return server;
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-User-Id, Mcp-Session-Id, Mcp-Protocol-Version',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // /mcp パスのみ処理
    if (url.pathname !== '/mcp') {
      return new Response('Not found', { status: 404 });
    }

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    // TODO: OAuth2による認可を別途実装予定
    // 現時点ではリクエストヘッダーのuserIdを信用する
    const userId = request.headers.get('X-User-Id');
    if (!userId) {
      return new Response(JSON.stringify({ error: 'X-User-Id header is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // MCPサーバーを作成
    const mcpServer = createMcpServer(env.DB, userId);

    // Streamable HTTP transport（ステートレスモード）
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    // MCPサーバーとtransportを接続
    await mcpServer.connect(transport);

    // リクエストを処理
    const response = await transport.handleRequest(request);

    // CORSヘッダーを追加
    const headers = new Headers(response.headers);
    for (const [key, value] of Object.entries(corsHeaders())) {
      headers.set(key, value);
    }

    return new Response(response.body, {
      status: response.status,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;
