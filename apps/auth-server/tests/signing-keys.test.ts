import { describe, expect, it } from 'vitest';
import { generateSigningKey, loadSigningKeys } from '../src/signing-keys';

describe('generateSigningKey', () => {
  it('RS256 の秘密鍵 JWK（kid 付き）の JSON を作る', async () => {
    const jwk = JSON.parse(await generateSigningKey('key-2026-11'));

    expect(jwk).toMatchObject({ kty: 'RSA', kid: 'key-2026-11', alg: 'RS256' });
    expect(jwk.d).toBeTruthy();
  });
});

describe('loadSigningKeys', () => {
  it('現行の鍵を署名鍵として読み込み、公開鍵 JWK には秘密の値を含めない', async () => {
    const [key] = await loadSigningKeys({ current: await generateSigningKey('key-1') });

    expect(key?.keyId).toBe('key-1');
    expect(key?.publicJwk).toEqual({
      kty: 'RSA',
      n: expect.any(String),
      e: 'AQAB',
      alg: 'RS256',
      use: 'sig',
      kid: 'key-1',
    });
  });

  it('読み込んだ秘密鍵で署名した値を公開鍵で検証できる', async () => {
    const [key] = await loadSigningKeys({ current: await generateSigningKey('key-1') });
    const data = new TextEncoder().encode('payload');
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

    const signature = await crypto.subtle.sign(algorithm, key!.privateKey, data);
    const publicKey = await crypto.subtle.importKey('jwk', key!.publicJwk, algorithm, false, ['verify']);

    expect(await crypto.subtle.verify(algorithm, publicKey, signature, data)).toBe(true);
  });

  it('ローテーション中は現行の鍵（署名に使う）を先頭に、前の鍵を後ろに並べる', async () => {
    const keys = await loadSigningKeys({
      current: await generateSigningKey('new'),
      previous: await generateSigningKey('old'),
    });

    expect(keys.map((key) => key.keyId)).toEqual(['new', 'old']);
  });

  it('現行の鍵が未設定・不正なときはエラーにする', async () => {
    await expect(loadSigningKeys({ current: undefined })).rejects.toThrow(/OIDC_SIGNING_KEY/);
    await expect(loadSigningKeys({ current: '{"kty":"RSA"}' })).rejects.toThrow(/OIDC_SIGNING_KEY/);
    await expect(loadSigningKeys({ current: 'not json' })).rejects.toThrow(/OIDC_SIGNING_KEY/);
  });
});
