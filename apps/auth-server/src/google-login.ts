/**
 * Google でのログイン（上流 OP への認可コードフロー）のルート
 *
 * 生成コードのログイン画面（views.tsx の loginPage）の「Googleでログイン」から始まり、
 * Google で認証したアカウントを OP のユーザーに結び付けて、生成コードのログインと同じステップ
 * （セッションの確立 → 同意画面への引き継ぎ）で認可リクエストに戻る。
 *
 * - GET /login/google?transaction_id=…  … Google の認可エンドポイントへリダイレクト
 * - GET /api/auth/callback/google        … Google からのコールバック（Google Cloud Console に登録済みの URI）
 */
import { Hono, type MiddlewareHandler } from 'hono';
import { generateRandomString } from '@maronn-openid-connect/core';
import type { JWTVerifyGetKey } from 'jose';
import { parseTransactionId } from './oidc-provider/cookies.js';
import { consentScreenUrl } from './oidc-provider/endpoints/login/page.js';
import { discardSessionForFreshLogin } from './oidc-provider/endpoints/login/steps/discard-session-for-fresh-login.js';
import { establishBrowserSession } from './oidc-provider/endpoints/login/steps/establish-session.js';
import { handOffToConsent } from './oidc-provider/endpoints/login/steps/hand-off-to-consent.js';
import { loadTransaction, loadTransactionById } from './oidc-provider/endpoints/login/steps/load-transaction.js';
import { renderErrorPage } from './oidc-provider/pages/errors.js';
import { redirectWithCookies } from './oidc-provider/pages/respond.js';
import type { ProviderStores, UpstreamLoginStorage, UserStorage } from './oidc-provider/store.js';
import {
  buildGoogleAuthorizationUrl,
  codeChallengeFor,
  deriveCodeVerifier,
  exchangeGoogleCode,
  verifyGoogleIdToken,
} from './google-oidc.js';
import { FederatedLoginError } from './household-user-store.js';

export const GOOGLE_PROVIDER = 'google';
export const GOOGLE_CALLBACK_PATH = '/api/auth/callback/google';

export interface GoogleLoginOptions {
  clientId: string;
  clientSecret: string;
  /** テストで Google のトークンエンドポイントと JWKS を差し替えるときに使う */
  fetch?: typeof fetch;
  jwks?: JWTVerifyGetKey;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type OidcContext = { Variables: Record<string, any> };

export function googleLoginRoutes(options: GoogleLoginOptions, oidcContext: MiddlewareHandler): Hono<OidcContext> {
  const routes = new Hono<OidcContext>();

  routes.get('/login/google', oidcContext, async (c) => {
    // ブラウザの認可トランザクション（Cookie）と URL の transaction_id を照合する
    const loaded = await loadTransaction(c);
    if ('kind' in loaded) return renderErrorPage(c, loaded);

    const nonce = generateRandomString(32);
    await upstreamLogins(c).save(nonce, {
      provider: GOOGLE_PROVIDER,
      transactionId: loaded.transactionId,
      expiresAt: loaded.transaction.expiresAt,
    });
    const codeVerifier = await deriveCodeVerifier(options.clientSecret, nonce);
    return c.redirect(
      buildGoogleAuthorizationUrl({
        clientId: options.clientId,
        redirectUri: callbackUrl(c),
        // state はコールバックでトランザクションを探す鍵、nonce は ID トークンの再利用を防ぐ値。どちらも同じ乱数を使う
        state: nonce,
        nonce,
        codeChallenge: await codeChallengeFor(codeVerifier),
      })
    );
  });

  routes.get(GOOGLE_CALLBACK_PATH, oidcContext, async (c) => {
    const state = c.req.query('state');
    const code = c.req.query('code');
    if (c.req.query('error') || !state || !code) {
      return renderErrorPage(c, {
        error: 'access_denied',
        errorDescription: 'Google でのログインが完了しませんでした。もう一度お試しください。',
        statusCode: 400,
      });
    }

    const login = await upstreamLogins(c).find(state);
    if (!login || login.provider !== GOOGLE_PROVIDER) {
      return renderErrorPage(c, {
        error: 'invalid_request',
        errorDescription: 'ログインの有効期限が切れました。アプリからもう一度ログインしてください。',
        statusCode: 400,
      });
    }
    // コールバックは一度だけ使える
    await upstreamLogins(c).delete(state);

    // ログインを始めたブラウザと同じブラウザか（攻撃者のログインを被害者のブラウザで完了させる攻撃を防ぐ）
    if (parseTransactionId(c.req.header('Cookie') ?? null) !== login.transactionId) {
      return renderErrorPage(c, {
        error: 'invalid_request',
        errorDescription: 'ログインを始めたブラウザでやり直してください。',
        statusCode: 400,
      });
    }

    const idToken = await exchangeGoogleCode({
      code,
      codeVerifier: await deriveCodeVerifier(options.clientSecret, state),
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      redirectUri: callbackUrl(c),
      fetch: options.fetch,
    });
    const account = await verifyGoogleIdToken(idToken, { clientId: options.clientId, nonce: state, jwks: options.jwks });

    const userStore: UserStorage = c.get('userStore');
    let subject: string;
    try {
      subject = (
        await userStore.linkFederatedIdentity({
          provider: GOOGLE_PROVIDER,
          subject: account.subject,
          claims: {
            email: account.email,
            email_verified: account.emailVerified,
            name: account.name,
            picture: account.picture,
          },
        })
      ).sub;
    } catch (error) {
      if (!(error instanceof FederatedLoginError)) throw error;
      return renderErrorPage(c, { error: 'access_denied', errorDescription: error.message, statusCode: 403 });
    }

    const loadedTransaction = await loadTransactionById(c, login.transactionId);
    if ('kind' in loadedTransaction) return renderErrorPage(c, loadedTransaction);
    await discardSessionForFreshLogin(c, login.transactionId, loadedTransaction.transaction);
    const { sessionId, authTime } = await establishBrowserSession(c, subject);
    const outcome = await handOffToConsent(c, login.transactionId, subject, sessionId, authTime);
    return redirectWithCookies(consentScreenUrl(c, outcome.transactionId), outcome.cookies);
  });

  return routes;
}

/** 上流 OP でのログイン待ちのストア（生成コードはリクエストコンテキストの stores に置く） */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function upstreamLogins(c: any): UpstreamLoginStorage {
  return (c.get('stores') as ProviderStores).upstreamLoginStore;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function callbackUrl(c: any): string {
  return new URL(GOOGLE_CALLBACK_PATH, c.get('config').issuer).toString();
}
