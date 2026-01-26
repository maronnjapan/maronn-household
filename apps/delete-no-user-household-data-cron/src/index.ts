// Env型定義
interface Env {
	DB: D1Database; // Cloudflare D1（認証・家計データ両方）
}

/**
 * D1のuserテーブルから全ユーザーIDを取得
 */
async function getAllUserIds(db: D1Database): Promise<Set<string>> {
	const result = await db
		.prepare('SELECT id FROM user')
		.all<{ id: string }>();

	return new Set(result.results.map((row) => row.id));
}

/**
 * D1からuserテーブルに存在しない孤立user_idを特定
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

	const allHouseholdUserIds = new Set([
		...expenseUsers.results.map((r) => r.user_id),
		...budgetUsers.results.map((r) => r.user_id),
	]);

	// userテーブルに存在しないuser_idを返す
	const orphanedIds = new Set<string>();
	for (const userId of allHouseholdUserIds) {
		if (!validUserIds.has(userId)) {
			orphanedIds.add(userId);
		}
	}

	console.log(
		`[getOrphanedUserIds] Found ${orphanedIds.size} orphaned user IDs out of ${allHouseholdUserIds.size} total in household tables`
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
	if (orphanedUserIds.size === 0) {
		return { expenses: 0, budgets: 0 };
	}

	// json_eachで配列を展開してIN句を構成し、テーブルごとに1リクエストで削除する
	const userIdsJson = JSON.stringify(Array.from(orphanedUserIds));
	const deleteForTable = async (tableName: 'expenses' | 'budgets'): Promise<number> => {
		const statement = `
			WITH target_ids AS (
				SELECT value AS user_id FROM json_each(?1)
			)
			DELETE FROM ${tableName}
			WHERE user_id IN (SELECT user_id FROM target_ids)
		`;
		const result = await db.prepare(statement).bind(userIdsJson).run();
		return result.meta.changes ?? 0;
	};

	const [expensesDeleted, budgetsDeleted] = await Promise.all([
		deleteForTable('expenses'),
		deleteForTable('budgets'),
	]);

	console.log(
		`[deleteOrphanedData] Deleted orphaned rows (expenses: ${expensesDeleted}, budgets: ${budgetsDeleted}) in single batches`
	);

	return { expenses: expensesDeleted, budgets: budgetsDeleted };
}

/**
 * メイン処理: userテーブルに存在しないユーザーの家計簿データを削除
 */
async function deleteNoUserHouseholdData(
	db: D1Database
): Promise<{ expenses: number; budgets: number; orphanedUserCount: number }> {
	console.log('[deleteNoUserHouseholdData] Starting deletion process');

	// 1. D1のuserテーブルから全ユーザーIDを取得
	const validUserIds = await getAllUserIds(db);
	console.log(`[deleteNoUserHouseholdData] Found ${validUserIds.size} valid users in D1 user table`);

	// 2. 孤立user_idを特定（expensesやbudgetsにはあるがuserテーブルにないもの）
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
				`It deletes household data (expenses, budgets) for users that no longer exist in the user table.\n` +
				`To test the scheduled handler locally, run:\n` +
				`curl "${url.href}"`
		);
	},

	async scheduled(controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
		console.log(
			`[scheduled] Cron triggered at ${controller.cron} (scheduled time: ${new Date(controller.scheduledTime).toISOString()})`
		);

		if (!env.DB) {
			console.error('[scheduled] D1 database binding (DB) is not configured');
			return;
		}

		try {
			const result = await deleteNoUserHouseholdData(env.DB);
			console.log(
				`[scheduled] Successfully deleted ${result.expenses} expenses and ${result.budgets} budgets from ${result.orphanedUserCount} orphaned users`
			);
		} catch (error) {
			console.error('[scheduled] Failed to delete orphaned household data:', error);
			throw error;
		}
	},
} satisfies ExportedHandler<Env>;
