/**
 * household-auth の Worker エントリ。gateway と household-app / household-mcp から service binding で呼ばれる（ルートは持たない）
 */
import { createAuthServer, type AuthEnv, type AuthServer } from './app.js';
import { cleanupExpiredRecords } from './cleanup.js';

let server: AuthServer | undefined;

export default {
  fetch(request: Request, env: AuthEnv, ctx: ExecutionContext) {
    server ??= createAuthServer(env);
    return server.fetch(request, env, ctx);
  },

  /** 期限切れのトークン・セッション、使われなかった動的登録クライアントを毎日削除する */
  async scheduled(_controller: ScheduledController, env: AuthEnv) {
    const deleted = await cleanupExpiredRecords(env.DB, Math.floor(Date.now() / 1000));
    console.log('[household-auth] cleanup', JSON.stringify(deleted));
  },
};
