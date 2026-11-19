import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { createTestDatabase, type TestDatabase } from '@maronn/test-utils';
import app from '../src/index';

const ISSUER = 'https://maronn-household-budget.com';
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
  // 認証基盤（auth-server）の JWKS エンドポイントの代わり
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

function accessToken(
  options: { scope?: string; sub?: string; issuer?: string; key?: CryptoKey; typ?: string } = {}
) {
  return new SignJWT({ scope: options.scope ?? 'household', client_id: 'dcr-claude' })
    .setProtectedHeader({ alg: 'RS256', kid: 'op-key', typ: options.typ ?? 'at+jwt' })
    .setIssuer(options.issuer ?? ISSUER)
    .setSubject(options.sub ?? USER_ID)
    .setAudience(`${ISSUER}/userinfo`)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(options.key ?? signingKey);
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
        resource: `${ISSUER}/mcp`,
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

  it.each([
    ['別の鍵で署名されたトークン', { key: undefined as CryptoKey | undefined, issuer: ISSUER, typ: 'at+jwt', other: true }],
    ['別の発行者のトークン', { key: undefined, issuer: 'https://evil.example.com', typ: 'at+jwt', other: false }],
    ['アクセストークンでない JWT（typ が違う）', { key: undefined, issuer: ISSUER, typ: 'JWT', other: false }],
  ])('%s は 401', async (_label, options) => {
    const token = await accessToken({
      issuer: options.issuer,
      typ: options.typ,
      key: options.other ? otherKey : undefined,
    });

    expect((await rpc('tools/list', {}, token)).status).toBe(401);
  });

  it('household スコープのないトークンは 403 insufficient_scope', async () => {
    const response = await rpc('tools/list', {}, await accessToken({ scope: 'openid profile' }));

    expect(response.status).toBe(403);
    expect(response.headers.get('WWW-Authenticate')).toContain('error="insufficient_scope"');
  });
});

describe('ツール', () => {
  it('tools/list でレシート登録と参照のツールを公開する', async () => {
    const response = await rpc('tools/list', {}, await accessToken());
    const body = (await response.json()) as { result: { tools: { name: string }[] } };

    expect(body.result.tools.map((tool) => tool.name).sort()).toEqual([
      'get_budget_summary',
      'list_expenses',
      'list_receipts',
      'record_receipt',
    ]);
  });

  it('record_receipt はレシートと明細を保存し、カテゴリ別に按分した支出をトークンのユーザーで作る', async () => {
    const { data } = await callTool('record_receipt', RECEIPT);

    expect(data.duplicate).toBe(false);
    const expenses = await testDb.db
      .prepare('SELECT user_id, amount, category, date, device_id, receipt_id FROM expenses ORDER BY amount DESC')
      .all();
    expect(expenses.results).toEqual([
      { user_id: USER_ID, amount: 770, category: 'food', date: '2026-11-19', device_id: 'mcp:dcr-claude', receipt_id: data.receiptId },
      { user_id: USER_ID, amount: 330, category: 'daily-goods', date: '2026-11-19', device_id: 'mcp:dcr-claude', receipt_id: data.receiptId },
    ]);
    const receipt = await testDb.db.prepare('SELECT * FROM receipts').first();
    expect(receipt).toMatchObject({
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

  it('同じレシートの二度目の登録は保存せず duplicate を返し、allowDuplicate なら別の購入として保存する', async () => {
    const first = await callTool('record_receipt', RECEIPT);
    const second = await callTool('record_receipt', { ...RECEIPT, storeName: 'スーパーA新宿店' });
    const third = await callTool('record_receipt', { ...RECEIPT, allowDuplicate: true });

    expect(second.data).toMatchObject({ duplicate: true, receiptId: first.data.receiptId });
    expect(third.data.duplicate).toBe(false);
    const count = await testDb.db.prepare('SELECT COUNT(*) AS n FROM receipts').first<{ n: number }>();
    expect(count?.n).toBe(2);
  });

  it('不正な入力（負の金額）はエラーとして返し、何も保存しない', async () => {
    const { isError } = await callTool('record_receipt', { ...RECEIPT, totalAmount: -1 });

    expect(isError).toBe(true);
    const count = await testDb.db.prepare('SELECT COUNT(*) AS n FROM receipts').first<{ n: number }>();
    expect(count?.n).toBe(0);
  });

  it('list_expenses はトークンのユーザーの指定月の支出だけを返す', async () => {
    await callTool('record_receipt', RECEIPT);
    await callTool('record_receipt', { ...RECEIPT, purchasedAt: '2026-10-31' });
    await callTool('record_receipt', RECEIPT, await accessToken({ sub: 'someone-else' }));

    const { data } = await callTool('list_expenses', { month: '2026-11' });

    expect(data.expenses).toHaveLength(2);
    expect(data.expenses.every((expense: { date: string }) => expense.date === '2026-11-19')).toBe(true);
  });

  it('list_receipts は指定月のレシートを明細付きで返す', async () => {
    await callTool('record_receipt', RECEIPT);

    const { data } = await callTool('list_receipts', { month: '2026-11' });

    expect(data.receipts).toHaveLength(1);
    expect(data.receipts[0]).toMatchObject({ storeName: 'スーパーA 新宿店', totalAmount: 1100 });
    expect(data.receipts[0].items.map((item: { name: string }) => item.name)).toEqual(['米', 'ティッシュ']);
  });

  it('get_budget_summary は月の予算（なければ直近の過去月、それもなければ 120,000円）に対する残額と内訳を返す', async () => {
    await callTool('record_receipt', RECEIPT);
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
