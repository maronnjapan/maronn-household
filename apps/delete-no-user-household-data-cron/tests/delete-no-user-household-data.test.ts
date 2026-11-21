/**
 * 孤立データ削除の cron の通しのテスト（本物のローカル D1）
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import worker from '../src/index';

let testDb: TestDatabase;

beforeEach(async () => {
	testDb = await createTestDatabase();
});

afterEach(async () => {
	await testDb.dispose();
});

async function insertUser(id: string) {
	await testDb.db
		.prepare("INSERT INTO user (id, name, email, created_at, updated_at) VALUES (?, ?, ?, 'x', 'x')")
		.bind(id, id, `${id}@example.com`)
		.run();
}

async function insertExpense(id: string, userId: string) {
	await testDb.db
		.prepare(
			"INSERT INTO expenses (id, user_id, amount, date, created_at, updated_at, device_id) VALUES (?, ?, 100, '2026-11-20', 'x', 'x', 'd')"
		)
		.bind(id, userId)
		.run();
}

async function insertCategory(userId: string, value: string) {
	await testDb.db
		.prepare("INSERT INTO categories (user_id, value, label, created_at, updated_at) VALUES (?, ?, 'ペット', 'x', 'x')")
		.bind(userId, value)
		.run();
}

async function runCron() {
	// scheduled ハンドラーは ExecutionContext を使わないので、空の実装を渡す
	const ctx: ExecutionContext = { waitUntil() {}, passThroughOnException() {}, exports: {} as Cloudflare.Exports, props: {} };
	await worker.scheduled({ cron: '0 20 * * *', scheduledTime: Date.now(), noRetry() {} }, { DB: testDb.db }, ctx);
}

describe('孤立データの削除', () => {
	it('user テーブルにいないユーザーの支出とカテゴリーを削除し、いるユーザーのデータは残す', async () => {
		await insertUser('alive');
		await insertExpense('e1', 'alive');
		await insertCategory('alive', 'C1');
		await insertExpense('e2', 'gone');
		await insertCategory('gone', 'C2');

		await runCron();

		const expenses = await testDb.db.prepare('SELECT user_id FROM expenses').all();
		const categories = await testDb.db.prepare('SELECT user_id FROM categories').all();
		expect(expenses.results).toEqual([{ user_id: 'alive' }]);
		expect(categories.results).toEqual([{ user_id: 'alive' }]);
	});

	it('カテゴリーだけが残っているユーザーも孤立データとして削除する', async () => {
		await insertCategory('gone', 'C1');

		await runCron();

		expect((await testDb.db.prepare('SELECT COUNT(*) AS n FROM categories').first<{ n: number }>())?.n).toBe(0);
	});
});
