/**
 * OP の署名鍵
 *
 * secret `OIDC_SIGNING_KEY` に RSA 秘密鍵の JWK（kid 付き）を 1 つ置き、トークンに署名する。
 * ローテーションでは、古い鍵を `OIDC_SIGNING_KEY_PREVIOUS` に移して新しい鍵を `OIDC_SIGNING_KEY` に入れ、
 * 古い鍵で署名したトークンが失効したら `OIDC_SIGNING_KEY_PREVIOUS` を消す。どちらの公開鍵も JWKS に載る。
 * （Workers の secret は 1 つ 5KB までなので、複数の鍵を 1 つの secret にまとめない）
 * 初回のデプロイでは GitHub Actions が未設定なら生成して投入する（scripts/cloudflare/ensure-secrets.mjs）。
 */
import type { SigningKey } from '@maronn-openid-connect/core';

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;

interface PrivateRsaJwk extends JsonWebKey {
  kty: 'RSA';
  kid: string;
  n: string;
  e: string;
  d: string;
}

export async function loadSigningKeys(secrets: {
  current: string | undefined;
  previous?: string;
}): Promise<SigningKey[]> {
  const jwks = [parseKey('OIDC_SIGNING_KEY', secrets.current)];
  if (secrets.previous) {
    jwks.push(parseKey('OIDC_SIGNING_KEY_PREVIOUS', secrets.previous));
  }
  return Promise.all(
    jwks.map(async (jwk) => ({
      keyId: jwk.kid,
      privateKey: await crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['sign']),
      publicJwk: { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig', kid: jwk.kid },
    }))
  );
}

function parseKey(name: string, secret: string | undefined): PrivateRsaJwk {
  if (!secret) {
    throw new Error(`${name} is not set`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(secret);
  } catch {
    throw new Error(`${name} is not valid JSON`);
  }
  if (!isPrivateRsaJwk(parsed)) {
    throw new Error(`${name} must be an RSA private JWK with kid`);
  }
  return parsed;
}

function isPrivateRsaJwk(value: unknown): value is PrivateRsaJwk {
  if (typeof value !== 'object' || value === null) return false;
  const jwk = value as Record<string, unknown>;
  return (
    jwk.kty === 'RSA' &&
    typeof jwk.kid === 'string' &&
    jwk.kid.length > 0 &&
    typeof jwk.n === 'string' &&
    typeof jwk.e === 'string' &&
    typeof jwk.d === 'string'
  );
}

/** `OIDC_SIGNING_KEY` に入れる値（RS256 / 2048bit の秘密鍵 JWK）を作る */
export async function generateSigningKey(kid: string): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { ...ALGORITHM, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return JSON.stringify({ ...jwk, kid, alg: 'RS256' });
}
