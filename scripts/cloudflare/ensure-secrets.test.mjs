import { describe, expect, it } from 'vitest';
import {
  decideSecretActions,
  generateHouseholdClientSecret,
  generateOidcSigningKey,
  resolveSecretValues,
  signingKeyId,
} from './ensure-secrets.mjs';

const summarize = ({ puts }) => puts.map((p) => `${p.worker}/${p.name}<-${p.source.type === 'env' ? p.source.env : p.source.generator}`);

describe('decideSecretActions', () => {
  it('初回（どちらにも secret が無い）: Google の値を入れ、署名鍵とクライアントシークレットを生成して両方に入れる', () => {
    expect(summarize(decideSecretActions([], ['BETTER_AUTH_SECRET', 'WEBHOOK_SECRET_KEY']))).toEqual([
      'household-auth/GOOGLE_CLIENT_ID<-GOOGLE_CLIENT_ID',
      'household-auth/GOOGLE_CLIENT_SECRET<-GOOGLE_CLIENT_SECRET',
      'household-auth/OIDC_SIGNING_KEY<-oidc-signing-key',
      'household-auth/HOUSEHOLD_CLIENT_SECRET<-household-client-secret',
      'household-app/HOUSEHOLD_CLIENT_SECRET<-household-client-secret',
    ]);
  });

  it('2 回目以降（すべてある）: Google の値だけを入れ直し、署名鍵とクライアントシークレットは変えない', () => {
    const actions = decideSecretActions(
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'OIDC_SIGNING_KEY', 'HOUSEHOLD_CLIENT_SECRET'],
      ['HOUSEHOLD_CLIENT_SECRET', 'BETTER_AUTH_SECRET']
    );
    expect(summarize(actions)).toEqual([
      'household-auth/GOOGLE_CLIENT_ID<-GOOGLE_CLIENT_ID',
      'household-auth/GOOGLE_CLIENT_SECRET<-GOOGLE_CLIENT_SECRET',
    ]);
    expect(actions.kept).toEqual([
      { worker: 'household-auth', name: 'OIDC_SIGNING_KEY' },
      { worker: 'household-auth', name: 'HOUSEHOLD_CLIENT_SECRET' },
      { worker: 'household-app', name: 'HOUSEHOLD_CLIENT_SECRET' },
    ]);
  });

  it('既存の署名鍵は決して上書きしない', () => {
    for (const app of [[], ['HOUSEHOLD_CLIENT_SECRET']]) {
      const { puts } = decideSecretActions(['OIDC_SIGNING_KEY'], app);
      expect(puts.some((p) => p.name === 'OIDC_SIGNING_KEY')).toBe(false);
    }
  });

  it('クライアントシークレットがどちらか一方にしか無ければ、生成し直して両方に入れる（household-auth が先）', () => {
    for (const [auth, app] of [
      [['HOUSEHOLD_CLIENT_SECRET', 'OIDC_SIGNING_KEY'], []],
      [['OIDC_SIGNING_KEY'], ['HOUSEHOLD_CLIENT_SECRET']],
    ]) {
      const names = decideSecretActions(auth, app)
        .puts.filter((p) => p.name === 'HOUSEHOLD_CLIENT_SECRET')
        .map((p) => p.worker);
      expect(names).toEqual(['household-auth', 'household-app']);
    }
  });

  it('OIDC_SIGNING_KEY_PREVIOUS など他の secret には触れない', () => {
    const { puts } = decideSecretActions(['OIDC_SIGNING_KEY_PREVIOUS'], ['BETTER_AUTH_SECRET']);
    expect(puts.map((p) => p.name)).not.toContain('OIDC_SIGNING_KEY_PREVIOUS');
    expect(puts.map((p) => p.name)).not.toContain('BETTER_AUTH_SECRET');
  });
});

describe('resolveSecretValues', () => {
  it('同じ generator の値は 1 回だけ作り、household-auth と household-app で同じ値にする', async () => {
    let calls = 0;
    const generators = {
      'oidc-signing-key': () => 'jwk',
      'household-client-secret': () => `secret-${++calls}`,
    };
    const { puts } = decideSecretActions([], []);
    const resolved = await resolveSecretValues(puts, { GOOGLE_CLIENT_ID: ' id ', GOOGLE_CLIENT_SECRET: 'sec' }, generators);
    const values = Object.fromEntries(resolved.map(({ put, value }) => [`${put.worker}/${put.name}`, value]));
    expect(values).toEqual({
      'household-auth/GOOGLE_CLIENT_ID': 'id',
      'household-auth/GOOGLE_CLIENT_SECRET': 'sec',
      'household-auth/OIDC_SIGNING_KEY': 'jwk',
      'household-auth/HOUSEHOLD_CLIENT_SECRET': 'secret-1',
      'household-app/HOUSEHOLD_CLIENT_SECRET': 'secret-1',
    });
    expect(calls).toBe(1);
  });

  it('GitHub secret の値が空なら例外にする', async () => {
    const { puts } = decideSecretActions(['OIDC_SIGNING_KEY', 'HOUSEHOLD_CLIENT_SECRET'], ['HOUSEHOLD_CLIENT_SECRET']);
    await expect(resolveSecretValues(puts, { GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: '  ' })).rejects.toThrow(
      'GOOGLE_CLIENT_SECRET'
    );
  });
});

describe('生成する値', () => {
  it('署名鍵は kid と alg: RS256 付きの RSA-2048 秘密鍵 JWK 1 つで、RS256 の署名・検証に使える', async () => {
    const value = await generateOidcSigningKey('key-20261119');
    const jwk = JSON.parse(value);
    expect(Array.isArray(jwk)).toBe(false);
    expect(jwk).toMatchObject({ kty: 'RSA', kid: 'key-20261119', alg: 'RS256', e: 'AQAB' });
    for (const field of ['n', 'd', 'p', 'q', 'dp', 'dq', 'qi']) expect(typeof jwk[field]).toBe('string');
    expect(Buffer.from(jwk.n, 'base64url').length).toBe(256);

    // household-auth（signing-keys.ts）と同じ読み込み方で使えること
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };
    const privateKey = await crypto.subtle.importKey('jwk', jwk, algorithm, false, ['sign']);
    const publicKey = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256' }, algorithm, false, ['verify']);
    const data = new TextEncoder().encode('payload');
    const signature = await crypto.subtle.sign(algorithm, privateKey, data);
    expect(await crypto.subtle.verify(algorithm, publicKey, signature, data)).toBe(true);
  });

  it('kid は UTC の日付で key-YYYYMMDD', () => {
    expect(signingKeyId(new Date('2026-11-19T23:59:59Z'))).toBe('key-20261119');
    expect(signingKeyId(new Date('2027-01-02T00:00:00Z'))).toBe('key-20270102');
  });

  it('クライアントシークレットは 32 バイトの base64url で、毎回異なる', () => {
    const a = generateHouseholdClientSecret();
    const b = generateHouseholdClientSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(a, 'base64url').length).toBe(32);
    expect(a).not.toBe(b);
  });
});
