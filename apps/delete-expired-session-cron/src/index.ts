import postgres from 'postgres';

// Env型定義（DATABASE_URLシークレットを含む）
interface Env {
	DATABASE_URL: string;
}

/**
 * 期限切れセッションを削除する関数
 * @param databaseUrl - データベース接続URL
 * @returns 削除されたセッションの総数
 */
async function deleteExpiredSessions(databaseUrl: string): Promise<number> {
	const BATCH_SIZE = 100;
	const BATCH_DELAY_MS = 100; // 各バッチ間の待機時間（ミリ秒）
	const EXPIRY_DAYS = 3; // 期限切れとみなす日数

	// PostgreSQL接続を確立
	const sql = postgres(databaseUrl, {
		prepare: false,
		// Cloudflare Workers環境での接続設定
		ssl: 'require',
		connection: {
			application_name: 'delete-expired-session-cron',
		},
	});

	let totalDeleted = 0;

	try {
		// UTC基準で3日前の日時を計算
		const thresholdDate = new Date();
		thresholdDate.setUTCDate(thresholdDate.getUTCDate() - EXPIRY_DAYS);

		console.log(`[deleteExpiredSessions] Starting deletion process. Threshold: ${thresholdDate.toISOString()}`);

		// バッチ処理でセッションを削除
		while (true) {
			// 期限切れセッションを最大BATCH_SIZE件削除（生SQL使用）
			const result = await sql`
				DELETE FROM session
				WHERE id IN (
					SELECT id FROM session
					WHERE expires_at < ${thresholdDate}
					LIMIT ${BATCH_SIZE}
				)
				RETURNING id
			`;

			const deletedCount = result.length;
			totalDeleted += deletedCount;

			console.log(`[deleteExpiredSessions] Batch deleted ${deletedCount} sessions (total: ${totalDeleted})`);

			// 削除件数が0になったら終了
			if (deletedCount === 0) {
				break;
			}

			// 削除件数がバッチサイズ未満なら、これが最後のバッチ
			if (deletedCount < BATCH_SIZE) {
				break;
			}

			// CPU負荷分散のため、次のバッチまで待機
			await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
		}

		console.log(`[deleteExpiredSessions] Deletion completed. Total deleted: ${totalDeleted}`);

		return totalDeleted;
	} catch (error) {
		console.error('[deleteExpiredSessions] Error during deletion:', error);
		throw error;
	} finally {
		// PostgreSQL接続をクローズ
		await sql.end();
	}
}

export default {
	async fetch(req: Request, env: Env): Promise<Response> {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '0 20 * * *');
		return new Response(
			`This is a scheduled worker that runs at 20:00 UTC daily.\n` +
			`To test the scheduled handler locally, run:\n` +
			`curl "${url.href}"`
		);
	},

	async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
		console.log(`[scheduled] Cron triggered at ${controller.cron} (scheduled time: ${new Date(controller.scheduledTime).toISOString()})`);

		// DATABASE_URLが設定されているか確認
		if (!env.DATABASE_URL) {
			console.error('[scheduled] DATABASE_URL is not set. Please set it using: wrangler secret put DATABASE_URL');
			return;
		}

		try {
			const deletedCount = await deleteExpiredSessions(env.DATABASE_URL);
			console.log(`[scheduled] Successfully deleted ${deletedCount} expired sessions`);
		} catch (error) {
			console.error('[scheduled] Failed to delete expired sessions:', error);
			// エラーをそのまま伝播させてCloudflareのモニタリングで検知できるようにする
			throw error;
		}
	},
} satisfies ExportedHandler<Env>;
