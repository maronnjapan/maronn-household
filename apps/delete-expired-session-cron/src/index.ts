// Env型定義（Supabase REST API用のシークレットを含む）
interface Env {
	SUPABASE_URL: string;
	SUPABASE_SERVICE_KEY: string;
}

/**
 * 期限切れセッションを削除する関数（Supabase REST API使用）
 * postgres.jsの代わりにREST APIを使用することで、subrequest数を最小化
 * @returns 削除されたセッションの総数
 */
async function deleteExpiredSessions(
	supabaseUrl: string,
	serviceKey: string
): Promise<number> {
	const EXPIRY_DAYS = 3; // 期限切れとみなす日数

	// UTC基準で3日前の日時を計算
	const thresholdDate = new Date();
	thresholdDate.setUTCDate(thresholdDate.getUTCDate() - EXPIRY_DAYS);

	console.log(
		`[deleteExpiredSessions] Starting deletion process. Threshold: ${thresholdDate.toISOString()}`
	);

	// Supabase REST APIでDELETEを実行（単一のfetch = 1 subrequest）
	// Prefer: return=representation で削除された行を返す
	const response = await fetch(
		`${supabaseUrl}/rest/v1/session?expires_at=lt.${thresholdDate.toISOString()}`,
		{
			method: 'DELETE',
			headers: {
				apikey: serviceKey,
				Authorization: `Bearer ${serviceKey}`,
				'Content-Type': 'application/json',
				Prefer: 'return=representation',
			},
		}
	);

	if (!response.ok) {
		const errorText = await response.text();
		throw new Error(
			`Supabase REST API error: ${response.status} ${response.statusText} - ${errorText}`
		);
	}

	// 削除された行の配列が返される
	const deletedRows = (await response.json()) as unknown[];
	const totalDeleted = deletedRows.length;

	console.log(`[deleteExpiredSessions] Deletion completed. Total deleted: ${totalDeleted}`);

	return totalDeleted;
}

export default {
	async fetch(req: Request, _env: Env): Promise<Response> {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '0 20 * * *');
		return new Response(
			`This is a scheduled worker that runs at 20:00 UTC daily.\n` +
				`To test the scheduled handler locally, run:\n` +
				`curl "${url.href}"`
		);
	},

	async scheduled(
		controller: ScheduledController,
		env: Env,
		_ctx: ExecutionContext
	): Promise<void> {
		console.log(
			`[scheduled] Cron triggered at ${controller.cron} (scheduled time: ${new Date(controller.scheduledTime).toISOString()})`
		);

		if (!env.SUPABASE_URL) {
			console.error(
				'[scheduled] SUPABASE_URL is not set. Please set it using: wrangler secret put SUPABASE_URL'
			);
			return;
		}

		if (!env.SUPABASE_SERVICE_KEY) {
			console.error(
				'[scheduled] SUPABASE_SERVICE_KEY is not set. Please set it using: wrangler secret put SUPABASE_SERVICE_KEY'
			);
			return;
		}

		try {
			const deletedCount = await deleteExpiredSessions(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
			console.log(`[scheduled] Successfully deleted ${deletedCount} expired sessions`);
		} catch (error) {
			console.error('[scheduled] Failed to delete expired sessions:', error);
			// エラーをそのまま伝播させてCloudflareのモニタリングで検知できるようにする
			throw error;
		}
	},
} satisfies ExportedHandler<Env>;
