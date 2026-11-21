/**
 * カテゴリー（tRPC）の通しのテスト
 *
 * データベースは本物のローカル D1、アカウント削除で呼ぶ認証基盤（AUTH の service binding）は本物の household-auth を使う。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import { dbD1 } from '@maronn/db-schema/db';
import { categoryMatchKey } from '@maronn/domain/categories';
import { createAuthServer } from 'auth-server/src/app';
import { generateSigningKey } from 'auth-server/src/signing-keys';
import { appRouter, type Env } from '../trpc/server';

const ISSUER = 'https://maronn-household-budget.com';
const USER = { id: 'user-1', name: '山田太郎', email: 'taro@example.com', image: null };

let opSigningKey: string;
let testDb: TestDatabase;
let env: Env;

beforeAll(async () => {
  opSigningKey = await generateSigningKey('op-key');
});

beforeEach(async () => {
  testDb = await createTestDatabase();
  const authEnv = {
    DB: testDb.db,
    ISSUER,
    OIDC_SIGNING_KEY: opSigningKey,
    GOOGLE_CLIENT_ID: 'google-client',
    GOOGLE_CLIENT_SECRET: 'google-secret',
    HOUSEHOLD_CLIENT_SECRET: 'household-secret',
  };
  const auth = createAuthServer(authEnv);
  env = {
    DB: testDb.db,
    AUTH: {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => auth.fetch(new Request(input, init), authEnv),
    } as unknown as Fetcher,
    OIDC_ISSUER: ISSUER,
    HOUSEHOLD_CLIENT_SECRET: 'household-secret',
    WEBHOOK_SECRET_KEY: 'webhook-secret-key',
  };
});

afterEach(async () => {
  await testDb.dispose();
});

function callerFor(user: typeof USER | null) {
  return appRouter.createCaller({ db: dbD1(testDb.db), env, user, session: null, resHeaders: new Headers() });
}

async function insertCategory(userId: string, value: string, label: string, deletedAt: string | null = null) {
  await testDb.db
    .prepare(
      'INSERT INTO categories (user_id, value, label, label_key, deleted_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .bind(userId, value, label, categoryMatchKey(label), deletedAt, '2026-11-20T00:00:00.000Z', '2026-11-20T00:00:00.000Z')
    .run();
}

describe('getCategories', () => {
  it('ログイン中のユーザーのカテゴリー（既定の名前変更、削除済みの追加分を含む）を返し、他のユーザーの変更は含めない', async () => {
    await insertCategory(USER.id, 'food', '食料品');
    await insertCategory(USER.id, '01JDPET', 'ペット', '2026-11-21T00:00:00.000Z');
    await insertCategory('someone-else', '01JDTRAVEL', '旅行');
    await insertCategory('someone-else', 'education', '教育費', '2026-11-21T00:00:00.000Z');

    const { categories } = await callerFor(USER).getCategories();

    expect(categories).toHaveLength(13);
    expect(categories[0]).toEqual({ value: 'food', label: '食料品', builtIn: true, deleted: false });
    expect(categories.find((c) => c.value === '01JDPET')).toEqual({
      value: '01JDPET',
      label: 'ペット',
      builtIn: false,
      deleted: true,
    });
    expect(categories.find((c) => c.value === 'education')?.deleted).toBe(false);
    expect(categories.map((c) => c.value)).not.toContain('01JDTRAVEL');
  });

  it('ログインしていなければ使えない', async () => {
    await expect(callerFor(null).getCategories()).rejects.toThrow(/logged in/);
  });
});

describe('deleteAccount', () => {
  it('ユーザーのカテゴリーも削除する（他のユーザーのカテゴリーは残す）', async () => {
    await insertCategory(USER.id, '01JDPET', 'ペット');
    await insertCategory(USER.id, 'food', '食料品');
    await insertCategory('someone-else', '01JDTRAVEL', '旅行');

    await callerFor(USER).deleteAccount();

    const { results } = await testDb.db.prepare('SELECT user_id, value FROM categories').all();
    expect(results).toEqual([{ user_id: 'someone-else', value: '01JDTRAVEL' }]);
  });
});
