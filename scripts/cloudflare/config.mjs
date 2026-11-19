/**
 * 本番デプロイ（.github/workflows/deploy.yml）で使う定数
 *
 * Worker 名・ゾーン・ルートのパターンはここだけに書き、各スクリプトはここから読む。
 */
import { fileURLToPath } from 'node:url';

/** リポジトリのルート（このファイルは scripts/cloudflare/ にある） */
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export const ZONE_NAME = 'maronn-household-budget.com';
export const PUBLIC_ORIGIN = 'https://maronn-household-budget.com';

/** gateway だけが持つゾーンのルート */
export const ROUTE_PATTERNS = Object.freeze([
  'maronn-household-budget.com/*',
  'www.maronn-household-budget.com/*',
]);

export const GATEWAY_WORKER = 'household-gateway';
export const AUTH_WORKER = 'household-auth';
export const MCP_WORKER = 'household-mcp';
export const APP_WORKER = 'household-app';

/** Worker 名 → wrangler を実行するディレクトリ（リポジトリのルートからの相対パス） */
export const WORKER_DIRS = Object.freeze({
  [GATEWAY_WORKER]: 'apps/gateway',
  [AUTH_WORKER]: 'apps/auth-server',
  [MCP_WORKER]: 'apps/mcp-server',
  [APP_WORKER]: 'apps/household-app',
});

/**
 * デプロイ前に現在のデプロイ（バージョン）を記録し、失敗したらそこへ戻す Worker。
 * household-auth / household-mcp / household-gateway は wrangler deploy で即時に 100% になる。
 * household-app も記録する（secret をデプロイ前の時点にそろえて戻すため。household-auth だけを戻すと
 * HOUSEHOLD_CLIENT_SECRET が household-app と食い違うことがある）
 */
export const RECORDED_WORKERS = Object.freeze([AUTH_WORKER, MCP_WORKER, GATEWAY_WORKER, APP_WORKER]);

/** Google のトークンエンドポイントと、household-auth が使うリダイレクト URI（Google Cloud Console に登録済み） */
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REDIRECT_URI = `${PUBLIC_ORIGIN}/api/auth/callback/google`;

/**
 * 退役させる旧 Worker（この順に処理する）
 * - mcp-server: X-User-Id ヘッダーを信用する安全でない旧 MCP サーバー。最初に必ず消す
 * - auth-server: 旧認証サーバー（auth.maronn-household-budget.com の Custom Domain を持つ可能性がある）
 * - delete-expired-session-cron: household-auth の scheduled ハンドラーに移した旧 cron
 */
export const LEGACY_WORKERS = Object.freeze(['mcp-server', 'auth-server', 'delete-expired-session-cron']);

/** 現行の Worker。退役処理が誤ってこれらに触れないように、許可リストとの重なりを検査する */
export const CURRENT_WORKERS = Object.freeze([
  GATEWAY_WORKER,
  AUTH_WORKER,
  MCP_WORKER,
  APP_WORKER,
  'delete-no-user-household-data-cron',
  'webhook-batch-cron',
]);
