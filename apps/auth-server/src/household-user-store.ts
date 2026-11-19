/**
 * OP のユーザーストア（UserStorage）を、既存の Better Auth のテーブル（user / account）で実装する
 *
 * 生成OPの既定のストアは users / federated_identities を使い、初めてのログインでランダムな ID を振る。
 * それでは既存ユーザーの user_id（家計データの user_id）が変わってしまうので、
 * Google のサブジェクトを account(provider_id='google', account_id=sub) から引き、既存の user.id をそのまま OP のサブジェクトにする。
 */
import type { UserClaims } from '@maronn-openid-connect/core';
import type { FederatedIdentity, UserStorage } from './oidc-provider/store.js';

interface UserRow {
  id: string;
  name: string;
  email: string;
  email_verified: number;
  image: string | null;
}

export class FederatedLoginError extends Error {}

export function createHouseholdUserStore(db: D1Database): UserStorage {
  async function findUser(id: string): Promise<UserRow | null> {
    return db
      .prepare('SELECT id, name, email, email_verified, image FROM user WHERE id = ?')
      .bind(id)
      .first<UserRow>();
  }

  async function findLinkedUserId(provider: string, subject: string): Promise<string | null> {
    const row = await db
      .prepare('SELECT user_id FROM account WHERE provider_id = ? AND account_id = ?')
      .bind(provider, subject)
      .first<{ user_id: string }>();
    return row?.user_id ?? null;
  }

  /**
   * 同じメールアドレスの既存ユーザーに、まだこのプロバイダのアカウントがなければ紐づける。
   * メールアドレスは Google が確認済みのものだけを受け付ける（呼び出し側で確認する）。
   */
  async function linkByEmail(identity: FederatedIdentity, email: string, now: string): Promise<string | null> {
    const user = await db
      .prepare('SELECT id FROM user WHERE email = ?')
      .bind(email)
      .first<{ id: string }>();
    if (!user) return null;
    const linked = await db
      .prepare('SELECT 1 AS found FROM account WHERE user_id = ? AND provider_id = ?')
      .bind(user.id, identity.provider)
      .first();
    if (linked) {
      throw new FederatedLoginError(
        'このメールアドレスは別の Google アカウントで登録されています'
      );
    }
    await insertAccount(user.id, identity, now);
    return user.id;
  }

  /** user と account は一つのバッチ（トランザクション）で作り、紐づけのないユーザーを残さない */
  async function createUser(identity: FederatedIdentity, email: string, now: string): Promise<string> {
    const id = crypto.randomUUID();
    await db.batch([
      db
        .prepare(
          'INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)'
        )
        .bind(id, identity.claims.name ?? email, email, identity.claims.picture ?? null, now, now),
      accountInsert(id, identity, now),
    ]);
    return id;
  }

  async function insertAccount(userId: string, identity: FederatedIdentity, now: string): Promise<void> {
    await accountInsert(userId, identity, now).run();
  }

  function accountInsert(userId: string, identity: FederatedIdentity, now: string): D1PreparedStatement {
    return db
      .prepare(
        'INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .bind(crypto.randomUUID(), identity.subject, identity.provider, userId, now, now);
  }

  async function saveClaims(userId: string, identity: FederatedIdentity, email: string, now: string) {
    const current = await findUser(userId);
    await db
      .prepare('UPDATE user SET name = ?, email = ?, image = ?, email_verified = 1, updated_at = ? WHERE id = ?')
      .bind(
        identity.claims.name ?? current?.name ?? email,
        email,
        identity.claims.picture ?? current?.image ?? null,
        now,
        userId
      )
      .run();
  }

  return {
    // パスワードでのログインは提供しない（Google でのログインのみ）
    async authenticate() {
      return undefined;
    },

    async getClaims(sub) {
      const user = await findUser(sub);
      return user ? toClaims(user) : undefined;
    },

    async linkFederatedIdentity(identity) {
      const email = identity.claims.email;
      if (!email || identity.claims.email_verified !== true) {
        throw new FederatedLoginError('メールアドレスが確認済みの Google アカウントでログインしてください');
      }
      const now = new Date().toISOString();
      const userId =
        (await findLinkedUserId(identity.provider, identity.subject)) ??
        (await linkByEmail(identity, email, now)) ??
        (await createUser(identity, email, now));
      await saveClaims(userId, identity, email, now);
      const user = await findUser(userId);
      if (!user) {
        throw new Error(`User ${userId} disappeared during federated login`);
      }
      return toClaims(user);
    },
  };
}

function toClaims(user: UserRow): UserClaims {
  return {
    sub: user.id,
    name: user.name,
    email: user.email,
    email_verified: user.email_verified === 1,
    ...(user.image ? { picture: user.image } : {}),
  };
}
