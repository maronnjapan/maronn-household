import { beforeAll, describe, expect, it } from 'vitest';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair, type JWK } from 'jose';
import {
  GOOGLE_AUTHORIZATION_ENDPOINT,
  buildGoogleAuthorizationUrl,
  codeChallengeFor,
  deriveCodeVerifier,
  exchangeGoogleCode,
  verifyGoogleIdToken,
} from '../src/google-oidc';

const CLIENT_ID = 'client-123.apps.googleusercontent.com';

let privateKey: CryptoKey;
let jwks: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const publicJwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: 'g1', alg: 'RS256' };
  jwks = createLocalJWKSet({ keys: [publicJwk] });
});

function googleIdToken(claims: Record<string, unknown>, options: { issuer?: string; audience?: string } = {}) {
  return new SignJWT({ email: 'taro@example.com', email_verified: true, name: '山田太郎', nonce: 'n-1', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'g1' })
    .setIssuer(options.issuer ?? 'https://accounts.google.com')
    .setAudience(options.audience ?? CLIENT_ID)
    .setSubject('google-sub-1')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
}

describe('deriveCodeVerifier / codeChallengeFor', () => {
  it('同じ秘密と nonce からは同じ code_verifier を導出し、別の nonce では別の値になる', async () => {
    const a = await deriveCodeVerifier('secret', 'nonce-1');
    const b = await deriveCodeVerifier('secret', 'nonce-1');
    const c = await deriveCodeVerifier('secret', 'nonce-2');

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[A-Za-z0-9_-]{43,128}$/);
  });

  it('code_challenge は code_verifier の SHA-256 の base64url（RFC 7636 の例）', async () => {
    expect(await codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM'
    );
  });
});

describe('buildGoogleAuthorizationUrl', () => {
  it('認可コードフロー（openid email profile、PKCE S256、state と nonce）の URL を作る', () => {
    const url = new URL(
      buildGoogleAuthorizationUrl({
        clientId: CLIENT_ID,
        redirectUri: 'https://maronn-household-budget.com/api/auth/callback/google',
        state: 'state-1',
        nonce: 'nonce-1',
        codeChallenge: 'challenge-1',
      })
    );

    expect(`${url.origin}${url.pathname}`).toBe(GOOGLE_AUTHORIZATION_ENDPOINT);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: 'https://maronn-household-budget.com/api/auth/callback/google',
      scope: 'openid email profile',
      state: 'state-1',
      nonce: 'nonce-1',
      code_challenge: 'challenge-1',
      code_challenge_method: 'S256',
      prompt: 'select_account',
    });
  });
});

describe('verifyGoogleIdToken', () => {
  it('署名・発行者・受信者・nonce を検証してアカウント情報を返す', async () => {
    const account = await verifyGoogleIdToken(await googleIdToken({ picture: 'https://p' }), {
      clientId: CLIENT_ID,
      nonce: 'n-1',
      jwks,
    });

    expect(account).toEqual({
      subject: 'google-sub-1',
      email: 'taro@example.com',
      emailVerified: true,
      name: '山田太郎',
      picture: 'https://p',
    });
  });

  it('nonce が違えばエラー', async () => {
    await expect(
      verifyGoogleIdToken(await googleIdToken({}), { clientId: CLIENT_ID, nonce: 'other', jwks })
    ).rejects.toThrow();
  });

  it('受信者（aud）が別のクライアントならエラー', async () => {
    await expect(
      verifyGoogleIdToken(await googleIdToken({}, { audience: 'other-client' }), {
        clientId: CLIENT_ID,
        nonce: 'n-1',
        jwks,
      })
    ).rejects.toThrow();
  });

  it('発行者が Google でなければエラー', async () => {
    await expect(
      verifyGoogleIdToken(await googleIdToken({}, { issuer: 'https://evil.example.com' }), {
        clientId: CLIENT_ID,
        nonce: 'n-1',
        jwks,
      })
    ).rejects.toThrow();
  });
});

describe('exchangeGoogleCode', () => {
  it('トークンエンドポイントにコードと code_verifier をクライアント認証付きで送り、ID トークンを返す', async () => {
    const requests: Request[] = [];
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init));
      return Response.json({ id_token: 'the-id-token', access_token: 'x', token_type: 'Bearer' });
    };

    const idToken = await exchangeGoogleCode({
      code: 'code-1',
      codeVerifier: 'verifier-1',
      clientId: CLIENT_ID,
      clientSecret: 'secret',
      redirectUri: 'https://maronn-household-budget.com/api/auth/callback/google',
      fetch: fetcher,
    });

    expect(idToken).toBe('the-id-token');
    const body = new URLSearchParams(await requests[0]!.text());
    expect(Object.fromEntries(body)).toEqual({
      grant_type: 'authorization_code',
      code: 'code-1',
      code_verifier: 'verifier-1',
      client_id: CLIENT_ID,
      client_secret: 'secret',
      redirect_uri: 'https://maronn-household-budget.com/api/auth/callback/google',
    });
  });

  it('トークンエンドポイントがエラーを返したら例外にする', async () => {
    const fetcher = async () => Response.json({ error: 'invalid_grant' }, { status: 400 });

    await expect(
      exchangeGoogleCode({
        code: 'bad',
        codeVerifier: 'v',
        clientId: CLIENT_ID,
        clientSecret: 's',
        redirectUri: 'https://x/cb',
        fetch: fetcher,
      })
    ).rejects.toThrow(/invalid_grant/);
  });
});
