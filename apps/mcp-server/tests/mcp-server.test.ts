/**
 * MCP サーバーの通しのテスト（本物のローカル D1 を使う）
 * 認証基盤だけは、JWKS エンドポイントをローカルの鍵で代役にし、発行済みトークンの行を D1 に直接入れる。
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import app from '../src/index';

const ISSUER = 'https://maronn-household-budget.com';
const RESOURCE = `${ISSUER}/mcp`;
const USER_ID = 'user-1';

let signingKey: CryptoKey;
let otherKey: CryptoKey;
let publicJwk: JWK;
let testDb: TestDatabase;
let env: { DB: D1Database; AUTH: Fetcher; ISSUER: string };

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  signingKey = pair.privateKey;
  publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'op-key', alg: 'RS256', use: 'sig' };
  otherKey = (await generateKeyPair('RS256')).privateKey;
});

beforeEach(async () => {
  testDb = await createTestDatabase();
  const auth = {
    fetch: async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      return url.pathname === '/.well-known/jwks.json'
        ? Response.json({ keys: [publicJwk] })
        : new Response('not found', { status: 404 });
    },
  } as unknown as Fetcher;
  env = { DB: testDb.db, AUTH: auth, ISSUER };
});

afterEach(async () => {
  await testDb.dispose();
});

interface TokenOptions {
  scope?: string;
  sub?: string;
  issuer?: string;
  key?: CryptoKey;
  typ?: string;
  audience?: string[];
  /** 認証基盤の access_tokens に行を作らない（失効済みのトークン） */
  revoked?: boolean;
}

/** 認証基盤が発行したのと同じ形のアクセストークンを作り、発行済みとして access_tokens に記録する */
async function accessToken(options: TokenOptions = {}) {
  const jti = crypto.randomUUID();
  const sub = options.sub ?? USER_ID;
  const exp = Math.floor(Date.now() / 1000) + 300;
  const token = await new SignJWT({ scope: options.scope ?? 'household offline_access', client_id: 'dcr-claude' })
    .setProtectedHeader({ alg: 'RS256', kid: 'op-key', typ: options.typ ?? 'at+jwt' })
    .setIssuer(options.issuer ?? ISSUER)
    .setSubject(sub)
    .setAudience(options.audience ?? [`${ISSUER}/userinfo`, RESOURCE])
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(exp)
    .sign(options.key ?? signingKey);
  if (!options.revoked) {
    await testDb.db
      .prepare(
        "INSERT INTO access_tokens (id, sub, exp, client_id, token_hash, payload) VALUES (?, ?, ?, 'dcr-claude', ?, '{}')"
      )
      .bind(jti, sub, exp, `hash-${jti}`)
      .run();
  }
  return token;
}

async function rpc(method: string, params: unknown, token?: string) {
  return app.fetch(
    new Request(`${ISSUER}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
    env
  );
}

async function callTool(name: string, args: Record<string, unknown>, token?: string) {
  const response = await rpc('tools/call', { name, arguments: args }, token ?? (await accessToken()));
  const body = (await response.json()) as {
    result: { content: { text: string }[]; isError?: boolean };
  };
  const text = body.result.content[0]!.text;
  return { isError: body.result.isError, data: body.result.isError ? text : JSON.parse(text) };
}

async function count(table: string) {
  return (await testDb.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).first<{ n: number }>())!.n;
}

const RECEIPT = {
  storeName: 'スーパーA 新宿店',
  purchasedAt: '2026-11-19T18:30',
  totalAmount: 1100,
  taxAmount: 100,
  paymentMethod: 'credit_card',
  items: [
    { name: '米', amount: 700, category: 'food' },
    { name: 'ティッシュ', amount: 300, quantity: 1, category: 'daily-goods' },
  ],
};

describe('保護リソースのメタデータ（RFC 9728）', () => {
  it.each(['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource'])(
    '%s で認可サーバーとスコープを示す',
    async (path) => {
      const response = await app.fetch(new Request(`${ISSUER}${path}`), env);

      expect(await response.json()).toEqual({
        resource: RESOURCE,
        authorization_servers: [ISSUER],
        scopes_supported: ['household'],
        bearer_methods_supported: ['header'],
      });
    }
  );
});

describe('アクセストークンの検証', () => {
  it('トークンがなければ 401 とメタデータの場所を返す', async () => {
    const response = await rpc('tools/list', {});

    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toBe(
      `Bearer resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp", scope="household"`
    );
  });

  it.each<[string, TokenOptions]>([
    ['別の鍵で署名されたトークン', { key: undefined }],
    ['別の発行者のトークン', { issuer: 'https://evil.example.com' }],
    ['アクセストークンでない JWT（typ が違う）', { typ: 'JWT' }],
    ['この MCP サーバー宛てでない（aud に resource がない）トークン', { audience: [`${ISSUER}/userinfo`] }],
    ['失効した（認証基盤に記録がない）トークン', { revoked: true }],
  ])('%s は 401', async (label, options) => {
    const token = await accessToken({
      ...options,
      key: label.startsWith('別の鍵') ? otherKey : options.key,
    });

    expect((await rpc('tools/list', {}, token)).status).toBe(401);
  });

  it('household スコープのないトークンは 403 insufficient_scope', async () => {
    const response = await rpc('tools/list', {}, await accessToken({ scope: 'openid profile' }));

    expect(response.status).toBe(403);
    expect(response.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"');
  });

  it.each(['GET', 'DELETE'])('%s /mcp は 405（ステートレスなので SSE のストリームやセッションを持たない）', async (method) => {
    const response = await app.fetch(
      new Request(`${ISSUER}/mcp`, {
        method,
        headers: { Authorization: `Bearer ${await accessToken()}`, Accept: 'text/event-stream' },
      }),
      env
    );

    expect(response.status).toBe(405);
  });
});

describe('ツール', () => {
  it('tools/list でレシートの記録・取り消しと参照のツールを公開する', async () => {
    const response = await rpc('tools/list', {}, await accessToken());
    const body = (await response.json()) as {
      result: { tools: { name: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[] };
    };
    const tools = Object.fromEntries(body.result.tools.map((tool) => [tool.name, tool.annotations]));

    expect(Object.keys(tools).sort()).toEqual([
      'delete_receipt',
      'get_budget_summary',
      'list_records',
      'record_receipt',
    ]);
    expect(tools.list_records?.readOnlyHint).toBe(true);
    expect(tools.get_budget_summary?.readOnlyHint).toBe(true);
    expect(tools.delete_receipt?.destructiveHint).toBe(true);
  });

  it('record_receipt はレシートと明細を保存し、カテゴリ別に按分した支出をトークンのユーザーで作る', async () => {
    const { data } = await callTool('record_receipt', RECEIPT);

    expect(data).toMatchObject({ duplicate: false, itemsTotal: 1000, difference: 100 });
    const expenses = await testDb.db
      .prepare('SELECT user_id, amount, category, date, device_id, receipt_id FROM expenses ORDER BY amount DESC')
      .all();
    expect(expenses.results).toEqual([
      { user_id: USER_ID, amount: 770, category: 'food', date: '2026-11-19', device_id: 'mcp:dcr-claude', receipt_id: data.receiptId },
      { user_id: USER_ID, amount: 330, category: 'daily-goods', date: '2026-11-19', device_id: 'mcp:dcr-claude', receipt_id: data.receiptId },
    ]);
    expect(await testDb.db.prepare('SELECT * FROM receipts').first()).toMatchObject({
      id: data.receiptId,
      user_id: USER_ID,
      store_name: 'スーパーA 新宿店',
      total_amount: 1100,
      tax_amount: 100,
      payment_method: 'credit_card',
      source: 'dcr-claude',
    });
    const items = await testDb.db
      .prepare('SELECT position, name, amount, quantity, category FROM receipt_items ORDER BY position')
      .all();
    expect(items.results).toEqual([
      { position: 0, name: '米', amount: 700, quantity: null, category: 'food' },
      { position: 1, name: 'ティッシュ', amount: 300, quantity: 1, category: 'daily-goods' },
    ]);
  });

  it('同じ購入日・同じ支払総額のレシートは duplicate を返し（店名や時刻の読み取り揺れも含む）、allowDuplicate なら記録する', async () => {
    const first = await callTool('record_receipt', RECEIPT);
    const second = await callTool('record_receipt', { ...RECEIPT, storeName: 'スーパーA', purchasedAt: '2026-11-19' });
    const third = await callTool('record_receipt', { ...RECEIPT, allowDuplicate: true });

    expect(second.data).toMatchObject({ duplicate: true, existing: [{ id: first.data.receiptId, storeName: 'スーパーA 新宿店' }] });
    expect(third.data.duplicate).toBe(false);
    expect(await count('receipts')).toBe(2);
  });

  it('アプリで支出をすべて消したレシートは重複とみなさず、読み直して記録できる', async () => {
    const first = await callTool('record_receipt', RECEIPT);
    await testDb.db.prepare('DELETE FROM expenses WHERE receipt_id = ?').bind(first.data.receiptId).run();

    const again = await callTool('record_receipt', RECEIPT);

    expect(again.data.duplicate).toBe(false);
  });

  it('不正な入力（0円・負の金額）はエラーとして返し、何も保存しない', async () => {
    const zero = await callTool('record_receipt', { ...RECEIPT, totalAmount: 0 });
    const negative = await callTool('record_receipt', {
      ...RECEIPT,
      items: [{ name: '値引き', amount: -100 }],
    });

    expect(zero.isError).toBe(true);
    expect(negative.isError).toBe(true);
    expect(await count('receipts')).toBe(0);
  });

  it('delete_receipt は自分のレシートと、その明細・按分した支出を取り消す', async () => {
    const mine = await callTool('record_receipt', RECEIPT);
    const others = await callTool('record_receipt', RECEIPT, await accessToken({ sub: 'someone-else' }));

    const deleted = await callTool('delete_receipt', { receiptId: mine.data.receiptId });
    const notMine = await callTool('delete_receipt', { receiptId: others.data.receiptId });

    expect(deleted.data).toEqual({ deleted: true });
    expect(notMine.data).toEqual({ deleted: false });
    expect(await count('receipts')).toBe(1);
    expect(await count('receipt_items')).toBe(2);
    expect(await count('expenses')).toBe(2);
  });

  it('list_records はトークンのユーザーの指定月の支出を店名付きで返し、includeItems でレシートの明細も返す', async () => {
    await callTool('record_receipt', RECEIPT);
    await callTool('record_receipt', { ...RECEIPT, purchasedAt: '2026-10-31' });
    await callTool('record_receipt', RECEIPT, await accessToken({ sub: 'someone-else' }));

    const { data } = await callTool('list_records', { month: '2026-11' });
    const withItems = await callTool('list_records', { month: '2026-11', includeItems: true });

    expect(data.expenses).toHaveLength(2);
    expect(data.expenses[0]).toMatchObject({ date: '2026-11-19', storeName: 'スーパーA 新宿店' });
    expect(data.receipts).toBeUndefined();
    expect(withItems.data.receipts).toHaveLength(1);
    expect(withItems.data.receipts[0].items.map((item: { name: string }) => item.name)).toEqual(['米', 'ティッシュ']);
  });

  it('get_budget_summary は月の予算（なければ直近の過去月、それもなければ 120,000円）に対する残額と内訳を返し、サブ予算の支出は含めない', async () => {
    await callTool('record_receipt', RECEIPT);
    await testDb.db
      .prepare(
        "INSERT INTO expenses (id, user_id, amount, date, created_at, updated_at, device_id, sub_budget_id) VALUES ('sub', ?, 5000, '2026-11-02', 'x', 'x', 'd', 'sb-1')"
      )
      .bind(USER_ID)
      .run();
    const empty = await callTool('get_budget_summary', { month: '2026-11' });
    await testDb.db
      .prepare("INSERT INTO budgets (id, user_id, month, amount, updated_at) VALUES ('b1', ?, '2026-09', 50000, 'x')")
      .bind(USER_ID)
      .run();

    const { data } = await callTool('get_budget_summary', { month: '2026-11' });

    expect(empty.data.budget).toBe(120000);
    expect(data).toEqual({
      month: '2026-11',
      budget: 50000,
      spent: 1100,
      remaining: 48900,
      byCategory: [
        { category: 'food', amount: 770 },
        { category: 'daily-goods', amount: 330 },
      ],
    });
  });
});
