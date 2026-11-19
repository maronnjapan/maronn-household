/**
 * 動的クライアント登録（RFC 7591）のクライアントを D1 に保存するストア
 *
 * 生成コードの既定のストアはメモリ上（isolate ごと）なので、Workers では別の isolate に登録が見えず、
 * isolate が入れ替わると消える。生成ファイルは編集せず、生成コードが参照する
 * globalThis.__oidcDynamicallyRegisteredClientStore にこのストアを先に入れておく（install-dcr-store.ts）。
 *
 * 保存先は静的クライアントと同じ clients テーブル（registerClient）。
 * OP のクライアント解決は先に clients テーブルを引くので、保存したクライアントはそのまま解決される。
 */
import type { SqlDatabase } from './oidc-provider/db/database.js';
import { createClientResolver, registerClient } from './oidc-provider/db/clients.js';
import type { ClientRegistration } from './oidc-provider/config.js';
import type { DynamicallyRegisteredClientStore } from './oidc-provider/features/dynamic-client-registration/store.js';

/** 登録数の上限（maxRegisteredClients）を数える期間。上限は登録の速さを抑えるもので、古い登録で恒久的に塞がらない */
export const REGISTRATION_WINDOW_SECONDS = 24 * 60 * 60;

export class D1DynamicClientStore implements DynamicallyRegisteredClientStore {
  private db: SqlDatabase | undefined;

  /**
   * リクエストのデータベースを渡す。
   * isolate 内の全リクエストは同じ D1 バインディングを使うので、モジュールの一つのストアで共有してよい。
   */
  use(db: SqlDatabase): void {
    this.db = db;
  }

  async get(clientId: string): Promise<ClientRegistration | undefined> {
    const client = await createClientResolver(this.database()).findClient(clientId);
    return client ?? undefined;
  }

  async save(registration: ClientRegistration): Promise<void> {
    await registerClient(this.database(), registration);
    // 登録日時を記録する（上限の計算と、使われなかったクライアントの掃除に使う。cleanup.ts）
    await this.database().run({
      sql: 'INSERT INTO dcr_client_registrations (client_id, created_at) VALUES (?, ?) ON CONFLICT (client_id) DO NOTHING',
      params: [registration.clientId, nowSeconds()],
    });
  }

  async count(): Promise<number> {
    const [row] = await this.database().all<{ count: number }>({
      sql: 'SELECT COUNT(*) AS count FROM dcr_client_registrations WHERE created_at > ?',
      params: [nowSeconds() - REGISTRATION_WINDOW_SECONDS],
    });
    return Number(row?.count ?? 0);
  }

  async delete(clientId: string): Promise<void> {
    await this.database().run({ sql: 'DELETE FROM clients WHERE id = ?', params: [clientId] });
  }

  private database(): SqlDatabase {
    if (!this.db) {
      throw new Error('D1DynamicClientStore: database is not set. Call use(db) for each request.');
    }
    return this.db;
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
