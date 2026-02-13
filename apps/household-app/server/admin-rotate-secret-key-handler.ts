/**
 * 管理者専用: Webhookシークレットキーのローテーションハンドラー
 *
 * Cloudflareダッシュボードにアクセスできる管理者のみが実行可能。
 * 認証方式: ADMIN_API_KEY の値を Authorization ヘッダーで送信
 *
 * 手順:
 * 1. Cloudflareダッシュボードで ADMIN_API_KEY を設定（未設定の場合）
 * 2. WEBHOOK_SECRET_KEY に新しいキーを設定
 * 3. 旧キーを WEBHOOK_SECRET_KEY_OLD に設定
 * 4. curl でこのエンドポイントを実行:
 *    curl -X POST https://your-domain.com/api/admin/rotate-secret-key \
 *      -H "Authorization: Bearer <ADMIN_API_KEYの値>"
 * 5. 完了後、WEBHOOK_SECRET_KEY_OLD を削除
 *
 * 全ユーザーの暗号化データ（webhooks, webhookBatchSchedules）を
 * 旧キーから新キーに一括再暗号化する。
 * 完了後は旧キーでは復号不能になる。
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import {
  webhooks,
  webhookBatchSchedules,
} from '../database/drizzle/schema/household';
import {
  decryptWithKeyFallback,
  reEncrypt,
} from '../lib/webhook-secret';
import {
  enhance,
  type UniversalHandler,
} from '@universal-middleware/core';

interface Env {
  DB: D1Database;
  ADMIN_API_KEY?: string;
  WEBHOOK_SECRET_KEY?: string;
  WEBHOOK_SECRET_KEY_OLD?: string;
}

const jsonResponse = (data: unknown, status: number) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

export const adminRotateSecretKeyHandler = ((basePath: string) =>
  enhance(
    async (request, _context, runtime) => {
      const env = (runtime as { runtime: 'workerd'; env?: Env })?.env;

      if (!env) {
        return jsonResponse({ error: 'Environment not available' }, 500);
      }

      const url = new URL(request.url);
      if (!url.pathname.startsWith(basePath)) {
        return jsonResponse({ error: 'Not found' }, 404);
      }

      // POST メソッドのみ許可
      if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
      }

      const newKey = env.WEBHOOK_SECRET_KEY;
      const oldKey = env.WEBHOOK_SECRET_KEY_OLD;

      if (!newKey) {
        return jsonResponse(
          { error: 'WEBHOOK_SECRET_KEY が設定されていません' },
          500
        );
      }

      if (!oldKey) {
        return jsonResponse(
          {
            error:
              'WEBHOOK_SECRET_KEY_OLD が設定されていません。Cloudflareダッシュボードで旧キーを WEBHOOK_SECRET_KEY_OLD に設定してください。',
          },
          400
        );
      }

      // 認証: ADMIN_API_KEY で管理者を確認
      // WEBHOOK_SECRET_KEY_OLD とは独立した認証キー
      const adminKey = env.ADMIN_API_KEY;
      if (!adminKey) {
        return jsonResponse(
          { error: 'ADMIN_API_KEY が設定されていません。Cloudflareダッシュボードで設定してください。' },
          500
        );
      }

      const authHeader = request.headers.get('Authorization');
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return jsonResponse(
          { error: 'Authorization ヘッダーが必要です。Bearer <ADMIN_API_KEY> を指定してください。' },
          401
        );
      }

      const providedKey = authHeader.slice('Bearer '.length);
      if (providedKey !== adminKey) {
        return jsonResponse({ error: '認証失敗' }, 403);
      }

      // 新旧キーが同じ場合はエラー
      if (newKey === oldKey) {
        return jsonResponse(
          { error: 'WEBHOOK_SECRET_KEY と WEBHOOK_SECRET_KEY_OLD が同じです。新しいキーを設定してください。' },
          400
        );
      }

      const database = drizzle(env.DB);

      // 1. webhooks テーブルの全暗号化データを再暗号化
      const allWebhooks = await database.select().from(webhooks).all();
      let rotatedWebhookCount = 0;
      const errors: string[] = [];

      for (const webhook of allWebhooks) {
        const updates: Record<string, unknown> = {};
        let needsUpdate = false;

        // シークレットの再暗号化
        if (webhook.secretEncrypted && webhook.secretIv) {
          try {
            const result = await decryptWithKeyFallback(
              webhook.secretEncrypted,
              webhook.secretIv,
              newKey,
              oldKey
            );
            if (result.usedOldKey) {
              const reEncrypted = await reEncrypt(
                webhook.secretEncrypted,
                webhook.secretIv,
                oldKey,
                newKey
              );
              updates.secretEncrypted = reEncrypted.encrypted;
              updates.secretIv = reEncrypted.iv;
              needsUpdate = true;
            }
          } catch (e) {
            errors.push(`webhook ${webhook.id} secret: ${String(e)}`);
          }
        }

        // カスタムヘッダーの再暗号化
        if (webhook.customHeaders && webhook.customHeadersIv) {
          try {
            const result = await decryptWithKeyFallback(
              webhook.customHeaders,
              webhook.customHeadersIv,
              newKey,
              oldKey
            );
            if (result.usedOldKey) {
              const reEncrypted = await reEncrypt(
                webhook.customHeaders,
                webhook.customHeadersIv,
                oldKey,
                newKey
              );
              updates.customHeaders = reEncrypted.encrypted;
              updates.customHeadersIv = reEncrypted.iv;
              needsUpdate = true;
            }
          } catch (e) {
            errors.push(`webhook ${webhook.id} headers: ${String(e)}`);
          }
        }

        if (needsUpdate) {
          updates.updatedAt = new Date().toISOString();
          await database
            .update(webhooks)
            .set(updates)
            .where(eq(webhooks.id, webhook.id))
            .run();
          rotatedWebhookCount++;
        }
      }

      // 2. webhookBatchSchedules テーブルの全暗号化データを再暗号化
      const allSchedules = await database
        .select()
        .from(webhookBatchSchedules)
        .all();
      let rotatedScheduleCount = 0;

      for (const schedule of allSchedules) {
        if (schedule.customHeaders && schedule.customHeadersIv) {
          try {
            const result = await decryptWithKeyFallback(
              schedule.customHeaders,
              schedule.customHeadersIv,
              newKey,
              oldKey
            );
            if (result.usedOldKey) {
              const reEncrypted = await reEncrypt(
                schedule.customHeaders,
                schedule.customHeadersIv,
                oldKey,
                newKey
              );
              await database
                .update(webhookBatchSchedules)
                .set({
                  customHeaders: reEncrypted.encrypted,
                  customHeadersIv: reEncrypted.iv,
                  updatedAt: new Date().toISOString(),
                })
                .where(eq(webhookBatchSchedules.id, schedule.id))
                .run();
              rotatedScheduleCount++;
            }
          } catch (e) {
            errors.push(`schedule ${schedule.id} headers: ${String(e)}`);
          }
        }
      }

      return jsonResponse(
        {
          success: errors.length === 0,
          rotatedWebhooks: rotatedWebhookCount,
          rotatedSchedules: rotatedScheduleCount,
          totalWebhooks: allWebhooks.length,
          totalSchedules: allSchedules.length,
          errors: errors.length > 0 ? errors : undefined,
          message:
            errors.length === 0
              ? `ローテーション完了。Webhook: ${rotatedWebhookCount}件、スケジュール: ${rotatedScheduleCount}件を再暗号化しました。Cloudflareダッシュボードから WEBHOOK_SECRET_KEY_OLD を削除してください。`
              : `一部エラーあり。成功: Webhook ${rotatedWebhookCount}件、スケジュール ${rotatedScheduleCount}件。エラー: ${errors.length}件。`,
        },
        errors.length === 0 ? 200 : 207
      );
    },
    {
      name: 'household-app:admin-rotate-secret-key',
      path: `${basePath}`,
      method: ['POST'],
      immutable: false,
    }
  )) satisfies UniversalHandler;
