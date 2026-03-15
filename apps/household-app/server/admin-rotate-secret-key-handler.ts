/**
 * 管理者専用: Webhookシークレットキーのローテーションハンドラー
 *
 * Cloudflareダッシュボードにアクセスできる管理者のみが実行可能。
 * 認証方式: ADMIN_API_KEY の値を Authorization ヘッダーで送信
 *
 * リクエストボディに新しいキーを渡すと、サーバー側で現在の
 * WEBHOOK_SECRET_KEY を旧キーとして使い、全データを再暗号化する。
 * 呼び出し側は現在のキーの値を知る必要がない。
 *
 * 手順:
 * 1. ローテーションスクリプトを実行:
 *    bash scripts/rotate-webhook-secret.sh --env production
 *
 *    または手動で:
 *    curl -X POST https://your-domain.com/api/admin/rotate-secret-key \
 *      -H "Authorization: Bearer <ADMIN_API_KEYの値>" \
 *      -H "Content-Type: application/json" \
 *      -d '{"newKey": "<新しいキー>"}'
 * 2. 成功後、wrangler secret put で WEBHOOK_SECRET_KEY を新キーに更新
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
} from '@maronn/db-schema/household';
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

      // 認証: ADMIN_API_KEY で管理者を確認
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

      // 現在のキー（env）を旧キーとして使用
      const oldKey = env.WEBHOOK_SECRET_KEY;
      if (!oldKey) {
        return jsonResponse(
          { error: 'WEBHOOK_SECRET_KEY が設定されていません' },
          500
        );
      }

      // リクエストボディから新キーを取得
      let body: { newKey?: string };
      try {
        body = await request.json() as { newKey?: string };
      } catch {
        return jsonResponse(
          { error: 'リクエストボディが不正です。JSON形式で { "newKey": "..." } を送信してください。' },
          400
        );
      }

      const newKey = body.newKey;
      if (!newKey || typeof newKey !== 'string' || newKey.length < 16) {
        return jsonResponse(
          { error: 'newKey が不正です。16文字以上の文字列を指定してください。' },
          400
        );
      }

      // 新旧キーが同じ場合はエラー
      if (newKey === oldKey) {
        return jsonResponse(
          { error: '新しいキーが現在のキーと同じです。異なるキーを指定してください。' },
          400
        );
      }

      const database = drizzle(env.DB);

      // 1. webhooks テーブルの全暗号化データを再暗号化
      // oldKey（現在のenv値）で暗号化されたデータを newKey（ボディから取得）で再暗号化
      // 既に newKey で暗号化済みのデータ（リトライ時）はスキップ
      const allWebhooks = await database.select().from(webhooks).all();
      let rotatedWebhookCount = 0;
      const errors: string[] = [];

      for (const webhook of allWebhooks) {
        const updates: Record<string, unknown> = {};
        let needsUpdate = false;

        // シークレットの再暗号化
        if (webhook.secretEncrypted && webhook.secretIv) {
          try {
            // oldKey（現在のenv値）で復号を試み、失敗したら newKey で試す
            const result = await decryptWithKeyFallback(
              webhook.secretEncrypted,
              webhook.secretIv,
              oldKey,
              newKey
            );
            // oldKey で復号できた → 再暗号化が必要
            if (!result.usedOldKey) {
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
            // usedOldKey === true → newKey で復号できた → 既に再暗号化済み
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
              oldKey,
              newKey
            );
            if (!result.usedOldKey) {
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
              oldKey,
              newKey
            );
            if (!result.usedOldKey) {
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
              ? `ローテーション完了。Webhook: ${rotatedWebhookCount}件、スケジュール: ${rotatedScheduleCount}件を再暗号化しました。wrangler secret put で WEBHOOK_SECRET_KEY を新キーに更新してください。`
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
