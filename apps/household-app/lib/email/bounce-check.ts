/**
 * メールアドレスのバウンスチェック機能
 *
 * メール送信前にバウンス・コンプレイントリストをチェックし、
 * 送信を抑制すべきかどうかを判断する
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { emailBounces } from '../../database/drizzle/schema/household';

export interface BounceCheckResult {
  shouldSend: boolean;
  reason?: string;
  bounceType?: string;
  bounceSubType?: string;
}

/**
 * メールアドレスがバウンス・コンプレイントリストに存在するかチェック
 *
 * @param db - D1データベースインスタンス
 * @param email - チェックするメールアドレス
 * @returns 送信可否の結果
 */
export async function checkEmailBounce(
  db: D1Database,
  email: string
): Promise<BounceCheckResult> {
  const database = drizzle(db);
  const normalizedEmail = email.toLowerCase();

  // バウンス・コンプレイント記録を検索
  const bounceRecord = await database
    .select()
    .from(emailBounces)
    .where(eq(emailBounces.email, normalizedEmail))
    .get();

  if (!bounceRecord) {
    return { shouldSend: true };
  }

  // Permanent bounce または complaint の場合は送信しない
  if (
    bounceRecord.bounceType === 'complaint' ||
    bounceRecord.bounceSubType === 'Permanent'
  ) {
    return {
      shouldSend: false,
      reason: `Email address is on the ${bounceRecord.bounceType} list`,
      bounceType: bounceRecord.bounceType,
      bounceSubType: bounceRecord.bounceSubType || undefined,
    };
  }

  // Transient bounce の場合は一定期間経過後に再送信可能
  if (bounceRecord.bounceSubType === 'Transient') {
    const bounceDate = new Date(bounceRecord.createdAt);
    const now = new Date();
    const hoursSinceBounce =
      (now.getTime() - bounceDate.getTime()) / (1000 * 60 * 60);

    // 24時間以内の一時的なバウンスは送信しない
    if (hoursSinceBounce < 24) {
      return {
        shouldSend: false,
        reason: 'Transient bounce within 24 hours',
        bounceType: bounceRecord.bounceType,
        bounceSubType: bounceRecord.bounceSubType,
      };
    }

    // 24時間経過後は送信可能
    return { shouldSend: true };
  }

  // その他のケース（Undetermined等）は送信しない
  return {
    shouldSend: false,
    reason: `Email address has bounce record: ${bounceRecord.bounceSubType || 'Unknown'}`,
    bounceType: bounceRecord.bounceType,
    bounceSubType: bounceRecord.bounceSubType || undefined,
  };
}

/**
 * バウンスチェックエラー
 */
export class EmailBounceError extends Error {
  constructor(
    message: string,
    public readonly bounceType: string,
    public readonly bounceSubType?: string
  ) {
    super(message);
    this.name = 'EmailBounceError';
  }
}
