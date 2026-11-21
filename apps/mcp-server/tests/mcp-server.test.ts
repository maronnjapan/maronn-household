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

interface ToolDefinition {
  name: string;
  inputSchema: JsonSchema;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
}

interface JsonSchema {
  description?: string;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
}

async function listTools(token?: string): Promise<ToolDefinition[]> {
  const response = await rpc('tools/list', {}, token ?? (await accessToken()));
  const body = (await response.json()) as { result: { tools: ToolDefinition[] } };
  return body.result.tools;
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

  it('検証できないトークンには error="invalid_token" を返す（RFC 6750 §3）', async () => {
    const response = await rpc('tools/list', {}, await accessToken({ revoked: true }));

    expect(response.headers.get('WWW-Authenticate')).toBe(
      `Bearer error="invalid_token", resource_metadata="${ISSUER}/.well-known/oauth-protected-resource/mcp", scope="household"`
    );
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
  it('tools/list でレシートの記録・取り消し、参照、カテゴリーの管理のツールを公開する', async () => {
    const tools = Object.fromEntries((await listTools()).map((tool) => [tool.name, tool.annotations]));

    expect(Object.keys(tools).sort()).toEqual([
      'create_category',
      'delete_category',
      'delete_receipt',
      'get_budget_summary',
      'list_categories',
      'list_records',
      'record_receipt',
      'update_category',
    ]);
    expect(tools.list_records?.readOnlyHint).toBe(true);
    expect(tools.get_budget_summary?.readOnlyHint).toBe(true);
    expect(tools.list_categories?.readOnlyHint).toBe(true);
    expect(tools.delete_receipt?.destructiveHint).toBe(true);
    expect(tools.delete_category?.destructiveHint).toBe(true);
    expect(tools.create_category).toMatchObject({ destructiveHint: false });
    expect(tools.update_category).toMatchObject({ destructiveHint: false, idempotentHint: true });
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

  it('list_records の includeItems は、アプリで支出をすべて消して取り消したレシートを含めない', async () => {
    const cancelled = await callTool('record_receipt', RECEIPT);
    await callTool('record_receipt', { ...RECEIPT, totalAmount: 2000, items: undefined, category: 'food' });
    await testDb.db.prepare('DELETE FROM expenses WHERE receipt_id = ?').bind(cancelled.data.receiptId).run();

    const { data } = await callTool('list_records', { month: '2026-11', includeItems: true });

    expect(data.receipts.map((r: { totalAmount: number }) => r.totalAmount)).toEqual([2000]);
  });

  it('暦にない購入日は記録しない', async () => {
    const { isError } = await callTool('record_receipt', { ...RECEIPT, purchasedAt: '2026-02-31' });

    expect(isError).toBe(true);
    expect(await count('receipts')).toBe(0);
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
        { category: 'food', label: '食費', amount: 770 },
        { category: 'daily-goods', label: '日用品', amount: 330 },
      ],
    });
  });
});

describe('カテゴリー', () => {
  const selectExpenses = async () =>
    (await testDb.db.prepare('SELECT * FROM expenses ORDER BY id').all()).results;

  it('list_categories は既定のカテゴリーを、追加したものがなければそのまま返す', async () => {
    const { data } = await callTool('list_categories', {});

    expect(data.categories).toHaveLength(12);
    expect(data.categories[0]).toEqual({ value: 'food', label: '食費', builtIn: true });
    expect(data.categories.at(-1)).toEqual({ value: 'other', label: 'その他', builtIn: true });
  });

  it('create_category で追加したカテゴリーは一覧に載り、record_receipt で名前でも value でも使え、参照の結果に名前が付く', async () => {
    const { data: pet } = await callTool('create_category', { label: 'ペット' });
    await callTool('record_receipt', {
      ...RECEIPT,
      items: [
        { name: 'ドッグフード', amount: 700, category: 'ペット' },
        { name: 'ティッシュ', amount: 300, category: '日用品' },
      ],
    });
    await callTool('record_receipt', {
      storeName: 'ペットショップ',
      purchasedAt: '2026-11-20',
      totalAmount: 500,
      category: pet.value,
    });

    const { data: listed } = await callTool('list_categories', {});
    const records = await callTool('list_records', { month: '2026-11', includeItems: true });
    const summary = await callTool('get_budget_summary', { month: '2026-11' });

    expect(pet).toEqual({ status: 'created', value: expect.stringMatching(/^[0-9A-Z]{26}$/), label: 'ペット' });
    expect(listed.categories.at(-2)).toEqual({ value: pet.value, label: 'ペット', builtIn: false });
    expect(listed.categories.at(-1).value).toBe('other');
    const expenses = (await testDb.db.prepare('SELECT amount, category FROM expenses ORDER BY amount DESC').all())
      .results;
    expect(expenses).toEqual([
      { amount: 770, category: pet.value },
      { amount: 500, category: pet.value },
      { amount: 330, category: 'daily-goods' },
    ]);
    expect(
      records.data.expenses.map((e: { amount: number; categoryLabel: string }) => [e.amount, e.categoryLabel])
    ).toEqual(expect.arrayContaining([[770, 'ペット'], [330, '日用品'], [500, 'ペット']]));
    expect(
      records.data.receipts[0].items.map((i: { category: string; categoryLabel: string }) => [i.category, i.categoryLabel])
    ).toEqual([
      [pet.value, 'ペット'],
      ['daily-goods', '日用品'],
    ]);
    expect(summary.data.byCategory).toEqual([
      { category: pet.value, label: 'ペット', amount: 1270 },
      { category: 'daily-goods', label: '日用品', amount: 330 },
    ]);
  });

  it('tools/list の record_receipt のカテゴリーの説明に、利用者の有効なカテゴリーの対応表を載せる（追加分を含み、削除したものは含まない）', async () => {
    const { data: pet } = await callTool('create_category', { label: 'ペット' });
    await callTool('delete_category', { category: '教育費' });

    const recordReceipt = (await listTools()).find((tool) => tool.name === 'record_receipt')!;
    const properties = recordReceipt.inputSchema.properties!;
    const itemCategory = properties.items!.items!.properties!.category!.description!;

    expect(itemCategory).toContain(`"${pet.value}":"ペット"`);
    expect(itemCategory).toContain('"food":"食費"');
    expect(itemCategory).not.toContain('教育費');
    expect(properties.category!.description).toContain('明細にカテゴリーがないときに使う');
    expect(properties.category!.description).toContain(`"${pet.value}":"ペット"`);
    expect(JSON.stringify(recordReceipt.inputSchema)).not.toContain('$ref');
  });

  it('record_receipt は、知らないカテゴリーや削除したカテゴリーでは何も記録しない', async () => {
    await callTool('delete_category', { category: 'education' });

    const unknown = await callTool('record_receipt', {
      ...RECEIPT,
      items: [{ name: 'ドッグフード', amount: 1000, category: 'ペット' }],
    });
    const deleted = await callTool('record_receipt', { ...RECEIPT, items: undefined, category: '教育費' });

    expect(unknown.isError).toBe(true);
    expect(unknown.data).toContain('ペット');
    expect(deleted.isError).toBe(true);
    expect(deleted.data).toContain('削除済み');
    expect(await count('receipts')).toBe(0);
    expect(await count('expenses')).toBe(0);
  });

  it('update_category で名前を変えると、記録済みの支出の行は変えずに表示名だけ変わる（既定のカテゴリーも変えられる）', async () => {
    await callTool('record_receipt', RECEIPT);
    const before = await selectExpenses();

    const renamed = await callTool('update_category', { category: '食費', label: '食料品' });

    const { data: listed } = await callTool('list_categories', {});
    const { data: records } = await callTool('list_records', { month: '2026-11' });
    expect(renamed.data).toEqual({ value: 'food', label: '食料品' });
    expect(await selectExpenses()).toEqual(before);
    expect(listed.categories[0]).toEqual({ value: 'food', label: '食料品', builtIn: true });
    expect(records.expenses.find((e: { category: string }) => e.category === 'food').categoryLabel).toBe('食料品');
  });

  it('同じ名前のカテゴリーは作らずに既存のものを返し、他のカテゴリーと同じ名前には変えられない', async () => {
    const { data: pet } = await callTool('create_category', { label: 'ペット' });

    const again = await callTool('create_category', { label: ' ペット ' });
    const builtIn = await callTool('create_category', { label: '食費' });
    const rename = await callTool('update_category', { category: 'ペット', label: '食費' });

    expect(again.data).toEqual({ status: 'existing', value: pet.value, label: 'ペット' });
    expect(builtIn.data).toEqual({ status: 'existing', value: 'food', label: '食費' });
    expect(rename.isError).toBe(true);
    expect(rename.data).toContain('食費');
    expect(await count('categories')).toBe(1);
  });

  it('全角半角・大文字小文字だけが違う名前も同じカテゴリーとみなし、record_receipt の結果にもカテゴリー名を付ける', async () => {
    const { data: pet } = await callTool('create_category', { label: 'Pet' });

    const fullWidth = await callTool('create_category', { label: 'ＰＥＴ' });
    const recorded = await callTool('record_receipt', { ...RECEIPT, items: undefined, category: 'ｐｅｔ' });

    expect(fullWidth.data).toEqual({ status: 'existing', value: pet.value, label: 'Pet' });
    expect(recorded.data.expenses).toEqual([
      { amount: 1100, category: pet.value, categoryLabel: 'Pet', memo: 'スーパーA 新宿店' },
    ]);
  });

  it('同じ名前の create_category を同時に呼んでも、カテゴリーは 1 つだけ作る（後の呼び出しには既存のものを返す）', async () => {
    const token = await accessToken();

    const results = await Promise.all([
      callTool('create_category', { label: 'ペット' }, token),
      callTool('create_category', { label: 'ペット' }, token),
    ]);

    const { data } = await callTool('list_categories', {});
    expect(results.map((result) => result.data.status).sort()).toEqual(['created', 'existing']);
    expect(new Set(results.map((result) => result.data.value)).size).toBe(1);
    expect(data.categories.filter((c: { label: string }) => c.label === 'ペット')).toHaveLength(1);
    expect(await count('categories')).toBe(1);
  });

  it('delete_category で削除したカテゴリーは一覧から消え、記録済みの支出はカテゴリーと名前を保つ', async () => {
    const { data: pet } = await callTool('create_category', { label: 'ペット' });
    await callTool('record_receipt', { ...RECEIPT, items: undefined, category: 'ペット' });
    const before = await selectExpenses();

    const deleted = await callTool('delete_category', { category: 'ペット' });

    const { data: listed } = await callTool('list_categories', {});
    const { data: records } = await callTool('list_records', { month: '2026-11' });
    const { data: summary } = await callTool('get_budget_summary', { month: '2026-11' });
    expect(deleted.data).toEqual({ deleted: true, value: pet.value, label: 'ペット', expenseCount: 1 });
    expect(await selectExpenses()).toEqual(before);
    expect(listed.categories.map((c: { value: string }) => c.value)).not.toContain(pet.value);
    expect(records.expenses[0]).toMatchObject({ category: pet.value, categoryLabel: 'ペット' });
    expect(summary.byCategory).toEqual([{ category: pet.value, label: 'ペット', amount: 1100 }]);
  });

  it('カテゴリーのない支出の計上先（その他）は削除できない', async () => {
    const result = await callTool('delete_category', { category: 'その他' });

    expect(result.isError).toBe(true);
    expect(result.data).toContain('削除できません');
    expect(await count('categories')).toBe(0);
  });

  it('削除したカテゴリーと同じ名前で作ると、新しく作らずに復元する（既定のカテゴリーも）', async () => {
    const { data: pet } = await callTool('create_category', { label: 'ペット' });
    await callTool('delete_category', { category: pet.value });
    await callTool('delete_category', { category: '教育費' });

    const restoredPet = await callTool('create_category', { label: 'ペット' });
    const restoredEducation = await callTool('create_category', { label: '教育費' });

    const { data: listed } = await callTool('list_categories', {});
    expect(restoredPet.data).toEqual({ status: 'restored', value: pet.value, label: 'ペット' });
    expect(restoredEducation.data).toEqual({ status: 'restored', value: 'education', label: '教育費' });
    expect(listed.categories).toHaveLength(13);
    expect(await count('categories')).toBe(2);
  });

  it('カテゴリーはユーザーごと（他のユーザーが追加・変更・削除したカテゴリーは見えず、使えない）', async () => {
    const others = await accessToken({ sub: 'someone-else' });
    const { data: theirs } = await callTool('create_category', { label: 'ペット' }, others);
    await callTool('update_category', { category: 'food', label: '食料品' }, others);
    await callTool('delete_category', { category: 'education' }, others);

    const { data } = await callTool('list_categories', {});
    const recorded = await callTool('record_receipt', { ...RECEIPT, items: undefined, category: theirs.value });

    expect(data.categories).toHaveLength(12);
    expect(data.categories[0]).toEqual({ value: 'food', label: '食費', builtIn: true });
    expect(data.categories.map((c: { value: string }) => c.value)).toContain('education');
    expect(recorded.isError).toBe(true);
    const owners = await testDb.db.prepare('SELECT DISTINCT user_id FROM categories').all();
    expect(owners.results).toEqual([{ user_id: 'someone-else' }]);
  });
});
