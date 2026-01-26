// Env型定義（D1データベースバインディング）
interface Env {
	DB: D1Database;
}

/**
 * 期限切れセッションを削除する関数
 * @param db - D1データベース
 * @returns 削除されたセッションの総数
 */
async function deleteExpiredSessions(db: D1Database): Promise<number> {
	const EXPIRY_DAYS = 3; // 期限切れとみなす日数

	// UTC基準で3日前の日時を計算（ISO 8601形式）
	const thresholdDate = new Date();
	thresholdDate.setUTCDate(thresholdDate.getUTCDate() - EXPIRY_DAYS);
	const thresholdDateStr = thresholdDate.toISOString();

	console.log(`[deleteExpiredSessions] Starting deletion process. Threshold: ${thresholdDateStr}`);

	// D1で期限切れセッションを削除
	const result = await db
		.prepare('DELETE FROM session WHERE expires_at < ?')
		.bind(thresholdDateStr)
		.run();

	const deletedCount = result.meta.changes ?? 0;

	console.log(`[deleteExpiredSessions] Deletion completed. Total deleted: ${deletedCount}`);

	return deletedCount;
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

		if (!env.DB) {
			console.error('[scheduled] D1 database binding (DB) is not configured');
			return;
		}

		try {
			const deletedCount = await deleteExpiredSessions(env.DB);
			console.log(`[scheduled] Successfully deleted ${deletedCount} expired sessions`);
		} catch (error) {
			console.error('[scheduled] Failed to delete expired sessions:', error);
			// エラーをそのまま伝播させてCloudflareのモニタリングで検知できるようにする
			throw error;
		}
	},
} satisfies ExportedHandler<Env>;
