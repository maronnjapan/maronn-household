import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import { createHouseholdUserStore } from '../src/household-user-store';

const GOOGLE_IDENTITY = {
  provider: 'google',
  subject: 'google-sub-1',
  claims: {
    email: 'taro@example.com',
    email_verified: true,
    name: '山田太郎',
    picture: 'https://example.com/taro.png',
  },
};

let testDb: TestDatabase;

beforeEach(async () => {
  testDb = await createTestDatabase();
});

afterEach(async () => {
  await testDb.dispose();
});

/** Better Auth 時代に作られた既存ユーザー（user + account）を入れる */
async function insertExistingUser(id: string, googleSub: string, email: string) {
  const now = '2025-01-01T00:00:00.000Z';
  await testDb.db
    .prepare(
      'INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES (?, ?, ?, 1, NULL, ?, ?)'
    )
    .bind(id, '既存ユーザー', email, now, now)
    .run();
  await testDb.db
    .prepare(
      'INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .bind(`acc-${id}`, googleSub, 'google', id, now, now)
    .run();
}

describe('createHouseholdUserStore', () => {
  it('既存ユーザーの Google アカウントでログインすると、既存の user_id をサブジェクトにする', async () => {
    await insertExistingUser('existing-user-id', 'google-sub-1', 'taro@example.com');
    const store = createHouseholdUserStore(testDb.db);

    const claims = await store.linkFederatedIdentity(GOOGLE_IDENTITY);

    expect(claims.sub).toBe('existing-user-id');
    expect(claims.email).toBe('taro@example.com');
  });

  it('ログインのたびに Google が示した名前・メール・画像で user を更新する', async () => {
    await insertExistingUser('existing-user-id', 'google-sub-1', 'taro@example.com');
    const store = createHouseholdUserStore(testDb.db);

    await store.linkFederatedIdentity(GOOGLE_IDENTITY);
    const claims = await store.getClaims('existing-user-id');

    expect(claims).toEqual({
      sub: 'existing-user-id',
      name: '山田太郎',
      email: 'taro@example.com',
      email_verified: true,
      picture: 'https://example.com/taro.png',
    });
  });

  it('初めての Google アカウントなら user と account を作り、次回以降も同じ user_id になる', async () => {
    const store = createHouseholdUserStore(testDb.db);

    const first = await store.linkFederatedIdentity(GOOGLE_IDENTITY);
    const second = await store.linkFederatedIdentity(GOOGLE_IDENTITY);

    expect(first.sub).toBeTruthy();
    expect(second.sub).toBe(first.sub);
    const account = await testDb.db
      .prepare('SELECT user_id FROM account WHERE provider_id = ? AND account_id = ?')
      .bind('google', 'google-sub-1')
      .first<{ user_id: string }>();
    expect(account?.user_id).toBe(first.sub);
  });

  it('同じメールアドレスの既存ユーザーに Google アカウントがなければ、そのユーザーに紐づける', async () => {
    const now = '2025-01-01T00:00:00.000Z';
    await testDb.db
      .prepare(
        'INSERT INTO user (id, name, email, email_verified, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)'
      )
      .bind('user-without-account', '既存', 'taro@example.com', now, now)
      .run();
    const store = createHouseholdUserStore(testDb.db);

    const claims = await store.linkFederatedIdentity(GOOGLE_IDENTITY);

    expect(claims.sub).toBe('user-without-account');
  });

  it('同じメールアドレスのユーザーが別の Google アカウントに紐づいていればエラーにする', async () => {
    await insertExistingUser('other-user', 'google-sub-other', 'taro@example.com');
    const store = createHouseholdUserStore(testDb.db);

    await expect(store.linkFederatedIdentity(GOOGLE_IDENTITY)).rejects.toThrow();
  });

  it('メールアドレスが確認済みでない Google アカウントはエラーにする', async () => {
    const store = createHouseholdUserStore(testDb.db);

    await expect(
      store.linkFederatedIdentity({
        ...GOOGLE_IDENTITY,
        claims: { ...GOOGLE_IDENTITY.claims, email_verified: false },
      })
    ).rejects.toThrow();
  });

  it('登録されていないサブジェクトのクレームは undefined', async () => {
    const store = createHouseholdUserStore(testDb.db);

    expect(await store.getClaims('nobody')).toBeUndefined();
  });

  it('パスワードでのログインは常に失敗する（Google ログインのみ）', async () => {
    await insertExistingUser('existing-user-id', 'google-sub-1', 'taro@example.com');
    const store = createHouseholdUserStore(testDb.db);

    expect(await store.authenticate('existing-user-id', 'anything')).toBeUndefined();
  });
});
