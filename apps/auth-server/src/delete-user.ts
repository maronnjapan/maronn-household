/**
 * アカウント削除で、ユーザーと認証基盤の記録を消す（household-app から service binding で呼ぶ内部エンドポイント）
 *
 * user を消すと account と家計簿アプリの session は外部キーの cascade で消える。
 * OP の記録（同意・そのグラントで発行したトークン・ブラウザセッション）は外部キーがないので明示的に消す。
 * 家計データ（支出・予算・レシートなど）は household-app が先に消す。
 */
export async function deleteUserIdentity(db: D1Database, userId: string): Promise<void> {
  await db.batch([
    db
      .prepare('DELETE FROM refresh_tokens WHERE grant_id IN (SELECT grant_id FROM consent_grants WHERE subject = ?)')
      .bind(userId),
    db.prepare('DELETE FROM access_tokens WHERE sub = ?').bind(userId),
    db.prepare('DELETE FROM consent_grants WHERE subject = ?').bind(userId),
    db.prepare('DELETE FROM consent_scopes WHERE subject = ?').bind(userId),
    db.prepare('DELETE FROM browser_sessions WHERE subject = ?').bind(userId),
    db.prepare('DELETE FROM user WHERE id = ?').bind(userId),
  ]);
}
