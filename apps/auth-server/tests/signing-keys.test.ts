import { describe, expect, it } from 'vitest';
import { generateSigningKeysSecret, loadSigningKeys } from '../src/signing-keys';

describe('generateSigningKeysSecret', () => {
  it('RS256 の秘密鍵 JWK を1つ含む JSON 配列を作る（kid 付き）', async () => {
    const secret = await generateSigningKeysSecret('key-2026-11');
    const keys = JSON.parse(secret);

    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ kty: 'RSA', kid: 'key-2026-11', alg: 'RS256' });
    expect(keys[0].d).toBeTruthy();
  });
});

describe('loadSigningKeys', () => {
  it('secret の秘密鍵を署名鍵として読み込み、公開鍵 JWK には秘密の値を含めない', async () => {
    const secret = await generateSigningKeysSecret('key-1');

    const [key] = await loadSigningKeys(secret);

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
    const [key] = await loadSigningKeys(await generateSigningKeysSecret('key-1'));
    const data = new TextEncoder().encode('payload');
    const algorithm = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

    const signature = await crypto.subtle.sign(algorithm, key!.privateKey, data);
    const publicKey = await crypto.subtle.importKey('jwk', key!.publicJwk, algorithm, false, ['verify']);

    expect(await crypto.subtle.verify(algorithm, publicKey, signature, data)).toBe(true);
  });

  it('複数の鍵は secret の順（先頭が署名に使う新しい鍵）で返す', async () => {
    const newer = JSON.parse(await generateSigningKeysSecret('new'));
    const older = JSON.parse(await generateSigningKeysSecret('old'));

    const keys = await loadSigningKeys(JSON.stringify([...newer, ...older]));

    expect(keys.map((key) => key.keyId)).toEqual(['new', 'old']);
  });

  it('secret が未設定・空・不正なときはエラーにする', async () => {
    await expect(loadSigningKeys(undefined)).rejects.toThrow(/OIDC_SIGNING_KEYS/);
    await expect(loadSigningKeys('[]')).rejects.toThrow(/OIDC_SIGNING_KEYS/);
    await expect(loadSigningKeys('{"kty":"RSA"}')).rejects.toThrow(/OIDC_SIGNING_KEYS/);
  });
});
