import postgres from 'postgres';

// Env型定義
interface Env {
	DATABASE_URL: string; // Supabase PostgreSQL接続URL
	DB: D1Database; // Cloudflare D1
}

/**
 * Supabaseから全ユーザーIDを取得
 */
async function getAllUserIds(databaseUrl: string): Promise<Set<string>> {
	const sql = postgres(databaseUrl, {
		prepare: false,
		ssl: 'require',
		connection: {
			application_name: 'delete-no-user-household-data-cron',
		},
	});

	try {
		const result = await sql`SELECT id FROM "user"`;
		return new Set(result.map((row) => row.id));
	} finally {
		await sql.end();
	}
}

/**
 * D1からSupabaseに存在しない孤立user_idを特定
 */
async function getOrphanedUserIds(
	db: D1Database,
	validUserIds: Set<string>
): Promise<Set<string>> {
	// expenses と budgets から DISTINCT user_id を取得
	const [expenseUsers, budgetUsers] = await Promise.all([
		db.prepare('SELECT DISTINCT user_id FROM expenses').all<{ user_id: string }>(),
		db.prepare('SELECT DISTINCT user_id FROM budgets').all<{ user_id: string }>(),
	]);

	const allD1UserIds = new Set([
		...expenseUsers.results.map((r) => r.user_id),
		...budgetUsers.results.map((r) => r.user_id),
	]);

	// Supabaseに存在しないuser_idを返す
	const orphanedIds = new Set<string>();
	for (const userId of allD1UserIds) {
		if (!validUserIds.has(userId)) {
			orphanedIds.add(userId);
		}
	}

	console.log(
		`[getOrphanedUserIds] Found ${orphanedIds.size} orphaned user IDs out of ${allD1UserIds.size} total in D1`
	);

	return orphanedIds;
}

/**
 * 孤立データを削除（バッチ処理）
 */
async function deleteOrphanedData(
	db: D1Database,
	orphanedUserIds: Set<string>
): Promise<{ expenses: number; budgets: number }> {
	const BATCH_DELAY_MS = 100;

	let expensesDeleted = 0;
	let budgetsDeleted = 0;

	for (const userId of orphanedUserIds) {
		// expenses削除
		const expResult = await db.prepare('DELETE FROM expenses WHERE user_id = ?').bind(userId).run();
		expensesDeleted += expResult.meta.changes ?? 0;

		// budgets削除
		const budResult = await db.prepare('DELETE FROM budgets WHERE user_id = ?').bind(userId).run();
		budgetsDeleted += budResult.meta.changes ?? 0;

		console.log(
			`[deleteOrphanedData] Deleted data for user_id: ${userId} (expenses: ${expResult.meta.changes ?? 0}, budgets: ${budResult.meta.changes ?? 0})`
		);

		// CPU負荷分散のため待機
		await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
	}

	return { expenses: expensesDeleted, budgets: budgetsDeleted };
}

/**
 * メイン処理: Supabaseに存在しないユーザーの家計簿データを削除
 */
async function deleteNoUserHouseholdData(
	databaseUrl: string,
	db: D1Database
): Promise<{ expenses: number; budgets: number; orphanedUserCount: number }> {
	console.log('[deleteNoUserHouseholdData] Starting deletion process');

	// 1. Supabaseから全ユーザーIDを取得
	const validUserIds = await getAllUserIds(databaseUrl);
	console.log(`[deleteNoUserHouseholdData] Found ${validUserIds.size} valid users in Supabase`);

	// 2. D1から孤立user_idを特定
	const orphanedUserIds = await getOrphanedUserIds(db, validUserIds);

	if (orphanedUserIds.size === 0) {
		console.log('[deleteNoUserHouseholdData] No orphaned data found');
		return { expenses: 0, budgets: 0, orphanedUserCount: 0 };
	}

	// 3. 孤立データを削除
	const result = await deleteOrphanedData(db, orphanedUserIds);

	console.log(
		`[deleteNoUserHouseholdData] Deletion completed. Deleted ${result.expenses} expenses and ${result.budgets} budgets from ${orphanedUserIds.size} orphaned users`
	);

	return {
		expenses: result.expenses,
		budgets: result.budgets,
		orphanedUserCount: orphanedUserIds.size,
	};
}

export default {
	async fetch(req: Request, _env: Env): Promise<Response> {
		const url = new URL(req.url);
		url.pathname = '/__scheduled';
		url.searchParams.append('cron', '0 20 * * *');
		return new Response(
			`This is a scheduled worker that runs at 20:00 UTC daily.\n` +
				`It deletes household data (expenses, budgets) for users that no longer exist in Supabase.\n` +
				`To test the scheduled handler locally, run:\n` +
				`curl "${url.href}"`
		);
	},

	async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		console.log(
			`[scheduled] Cron triggered at ${controller.cron} (scheduled time: ${new Date(controller.scheduledTime).toISOString()})`
		);

		if (!env.DATABASE_URL) {
			console.error(
				'[scheduled] DATABASE_URL is not set. Please set it using: wrangler secret put DATABASE_URL'
			);
			return;
		}

		if (!env.DB) {
			console.error('[scheduled] D1 database binding (DB) is not configured');
			return;
		}

		try {
			const result = await deleteNoUserHouseholdData(env.DATABASE_URL, env.DB);
			console.log(
				`[scheduled] Successfully deleted ${result.expenses} expenses and ${result.budgets} budgets from ${result.orphanedUserCount} orphaned users`
			);
		} catch (error) {
			console.error('[scheduled] Failed to delete orphaned household data:', error);
			throw error;
		}
	},
} satisfies ExportedHandler<Env>;
