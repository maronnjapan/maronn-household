import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import { D1DynamicClientStore } from '../src/dcr-store';
import { d1Database } from '../src/oidc-provider/db/instance';
import { createClientResolver } from '../src/oidc-provider/db/clients';

const MCP_CLIENT = {
  clientId: 'dcr-AAAAAAAAAAAAAAAAAAAAAA',
  clientType: 'public' as const,
  clientName: 'Claude',
  redirectUris: ['https://claude.ai/api/mcp/auth_callback'],
  grantTypes: ['authorization_code', 'refresh_token'],
  responseTypes: ['code'],
  tokenEndpointAuthMethods: ['none' as const],
  scope: ['household'],
};

let testDb: TestDatabase;
let store: D1DynamicClientStore;

beforeEach(async () => {
  testDb = await createTestDatabase();
  store = new D1DynamicClientStore();
  store.use(d1Database(testDb.db));
});

afterEach(async () => {
  await testDb.dispose();
});

describe('D1DynamicClientStore', () => {
  it('動的登録したクライアントを D1 に保存し、別のインスタンス（別の isolate 相当）からも引ける', async () => {
    await store.save(MCP_CLIENT);

    const otherIsolate = new D1DynamicClientStore();
    otherIsolate.use(d1Database(testDb.db));
    const found = await otherIsolate.get(MCP_CLIENT.clientId);

    expect(found?.clientId).toBe(MCP_CLIENT.clientId);
    expect(found?.redirectUris).toEqual(MCP_CLIENT.redirectUris);
    expect(found?.grantTypes).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
  });

  it('保存したクライアントは OP の通常のクライアント解決（clients テーブル）で見つかる', async () => {
    await store.save(MCP_CLIENT);

    const client = await createClientResolver(d1Database(testDb.db)).findClient(MCP_CLIENT.clientId);

    expect(client?.clientId).toBe(MCP_CLIENT.clientId);
    expect(client?.clientType).toBe('public');
  });

  it('count は直近24時間に動的登録したクライアントの数（上限は登録の速さを抑えるもので、恒久的に塞がらない）', async () => {
    const now = Math.floor(Date.now() / 1000);
    await store.save(MCP_CLIENT);
    await store.save({ ...MCP_CLIENT, clientId: 'dcr-BBBBBBBBBBBBBBBBBBBBBB' });
    await store.save({ ...MCP_CLIENT, clientId: 'dcr-CCCCCCCCCCCCCCCCCCCCCC' });
    await testDb.db
      .prepare("UPDATE dcr_client_registrations SET created_at = ? WHERE client_id = 'dcr-CCCCCCCCCCCCCCCCCCCCCC'")
      .bind(now - 25 * 60 * 60)
      .run();
    await testDb.db
      .prepare("INSERT INTO clients (id, client_type, is_deleted) VALUES ('household-app', 'confidential', FALSE)")
      .run();

    expect(await store.count()).toBe(2);
  });

  it('delete すると引けなくなり、数にも入らない', async () => {
    await store.save(MCP_CLIENT);

    await store.delete(MCP_CLIENT.clientId);

    expect(await store.get(MCP_CLIENT.clientId)).toBeUndefined();
    expect(await store.count()).toBe(0);
  });

  it('データベースを渡す前に使うとエラーにする', async () => {
    const unbound = new D1DynamicClientStore();

    await expect(unbound.count()).rejects.toThrow();
  });
});
