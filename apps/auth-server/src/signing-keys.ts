/**
 * OP の署名鍵
 *
 * secret `OIDC_SIGNING_KEYS` に RSA 秘密鍵 JWK の JSON 配列（kid 付き、先頭が新しい鍵）を置く。
 * 先頭の鍵でトークンに署名し、すべての鍵の公開鍵を JWKS で公開する。
 * ローテーションは、新しい鍵を先頭に足し、古いトークンが失効するまで古い鍵を残してから外す。
 * secret は GitHub Actions のデプロイで未設定なら生成して投入する（scripts/ensure-secrets.mjs）。
 */
import type { SigningKey } from '@maronn-openid-connect/core';

const ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const;
const SECRET_NAME = 'OIDC_SIGNING_KEYS';

interface PrivateRsaJwk extends JsonWebKey {
  kty: 'RSA';
  kid: string;
  n: string;
  e: string;
  d: string;
}

export async function loadSigningKeys(secret: string | undefined): Promise<SigningKey[]> {
  const jwks = parseSecret(secret);
  return Promise.all(
    jwks.map(async (jwk) => ({
      keyId: jwk.kid,
      privateKey: await crypto.subtle.importKey('jwk', jwk, ALGORITHM, false, ['sign']),
      publicJwk: { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig', kid: jwk.kid },
    }))
  );
}

function parseSecret(secret: string | undefined): PrivateRsaJwk[] {
  if (!secret) {
    throw new Error(`${SECRET_NAME} is not set`);
  }
  const parsed: unknown = JSON.parse(secret);
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every(isPrivateRsaJwk)) {
    throw new Error(`${SECRET_NAME} must be a non-empty JSON array of RSA private JWKs with kid`);
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

/** `OIDC_SIGNING_KEYS` に入れる値（RS256 / 2048bit の鍵1つ）を作る */
export async function generateSigningKeysSecret(kid: string): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { ...ALGORITHM, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify']
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as JsonWebKey;
  return JSON.stringify([{ ...jwk, kid, alg: 'RS256' }]);
}
