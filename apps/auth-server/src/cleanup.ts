/**
 * 期限切れの記録の削除（Cron Trigger から毎日呼ぶ。生成OPは期限切れの行を消さない）
 *
 * 以前の delete-expired-session-cron（家計簿アプリのセッションの削除）の役目もここで引き受ける。
 */
import { REGISTRATION_WINDOW_SECONDS } from './dcr-store.js';

/** OP のブラウザセッションを残す期間。オンラインのリフレッシュトークンの最長の寿命（90日）に合わせる */
const BROWSER_SESSION_LIFETIME_SECONDS = 90 * 24 * 60 * 60;

export async function cleanupExpiredRecords(db: D1Database, nowSeconds: number): Promise<Record<string, number>> {
  const statements = {
    // 認可リクエストのトランザクション（authentication_requests などは外部キーの cascade で消える）
    transactions: db.prepare('DELETE FROM transactions WHERE expired_at <= ?').bind(nowSeconds),
    codes: db.prepare('DELETE FROM codes WHERE expired_at <= ?').bind(nowSeconds),
    refreshTokens: db.prepare('DELETE FROM refresh_tokens WHERE exp <= ?').bind(nowSeconds),
    accessTokens: db.prepare('DELETE FROM access_tokens WHERE exp <= ?').bind(nowSeconds),
    clientAssertionJtis: db.prepare('DELETE FROM client_assertion_jtis WHERE expired_at <= ?').bind(nowSeconds),
    browserSessions: db
      .prepare('DELETE FROM browser_sessions WHERE auth_time <= ?')
      .bind(nowSeconds - BROWSER_SESSION_LIFETIME_SECONDS),
    // 家計簿アプリのセッションと、ログイン途中で放棄された記録（expires_at は ISO 8601）
    appSessions: db.prepare('DELETE FROM session WHERE expires_at <= ?').bind(new Date(nowSeconds * 1000).toISOString()),
    verifications: db.prepare('DELETE FROM verification WHERE expires_at <= ?').bind(new Date(nowSeconds * 1000).toISOString()),
    // 登録から24時間たっても、同意も発行したトークンもない動的登録クライアント（登録だけで使われなかったもの）
    unusedDynamicClients: db
      .prepare(
        'DELETE FROM clients WHERE id IN (SELECT client_id FROM dcr_client_registrations WHERE created_at <= ?) ' +
          'AND id NOT IN (SELECT client_id FROM consent_scopes) AND id NOT IN (SELECT client_id FROM access_tokens)'
      )
      .bind(nowSeconds - REGISTRATION_WINDOW_SECONDS),
  };
  const results = await db.batch(Object.values(statements));
  return Object.fromEntries(Object.keys(statements).map((name, index) => [name, results[index]?.meta.changes ?? 0]));
}
