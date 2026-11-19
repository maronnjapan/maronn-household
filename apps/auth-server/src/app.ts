/**
 * 認証基盤（OpenID Provider）
 *
 * maronn-openid-connect の生成コード（./oidc-provider、CLI 0.17.0 で生成、手で編集しない）に、
 * このアプリ固有の部品を applyOidc のオプションと追加のルートで差し込む。
 * - ユーザー: 既存の user / account テーブル（household-user-store.ts）
 * - ログイン: Google（google-login.ts）
 * - 動的クライアント登録の保存先: D1（install-dcr-store.ts）
 * - 署名鍵: secret OIDC_SIGNING_KEYS（signing-keys.ts）
 * - 画面: 日本語の画面（views.tsx）
 */
import { dcrStore } from './install-dcr-store.js'; // 生成コードより先に評価する
import { Hono, type MiddlewareHandler } from 'hono';
import { createCachedSigningKeyProvider } from '@maronn-openid-connect/core';
import { applyOidc } from './oidc-provider/apply.js';
import { setRequestContext, type OidcProviderOptions } from './oidc-provider/app.js';
import { createDatabase, createProviderStores, registerClient } from './oidc-provider/db/index.js';
import { d1Database } from './oidc-provider/db/instance.js';
import { rpInitiatedLogoutConfig } from './oidc-provider/features/rp-initiated-logout/config.js';
import { renderErrorPage } from './oidc-provider/pages/errors.js';
import { googleLoginRoutes, type GoogleLoginOptions } from './google-login.js';
import { createHouseholdUserStore } from './household-user-store.js';
import { loadSigningKeys } from './signing-keys.js';
import { views } from './views.js';

export interface AuthEnv {
  DB: D1Database;
  /** 公開オリジン（例: https://maronn-household-budget.com）。生成OPのルートはオリジン直下に固定 */
  ISSUER: string;
  OIDC_SIGNING_KEYS: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** 家計簿アプリ（household-app）のクライアントシークレット。household-app の同名の secret と同じ値 */
  HOUSEHOLD_CLIENT_SECRET: string;
}

export const HOUSEHOLD_CLIENT_ID = 'household-app';
/** JWT のアクセストークンは失効を即時に反映できないので短くする（MCP クライアントはリフレッシュする） */
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const SIGNING_KEY_CACHE_MS = 10 * 60 * 1000;
const MAX_DYNAMIC_CLIENTS = 1000;

type OidcApp = Hono<{ Bindings: AuthEnv; Variables: Record<string, unknown> }>;

export function buildApp(env: AuthEnv, options: { google?: Pick<GoogleLoginOptions, 'fetch' | 'jwks'> } = {}): OidcApp {
  const issuer = env.ISSUER;
  rpInitiatedLogoutConfig.postLogoutRedirectUris[HOUSEHOLD_CLIENT_ID] = [`${issuer}/`];

  const oidcOptions: OidcProviderOptions = {
    config: { issuer, accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS },
    signingKeyProvider: createCachedSigningKeyProvider(
      { getSigningKeys: () => loadSigningKeys(env.OIDC_SIGNING_KEYS) },
      SIGNING_KEY_CACHE_MS
    ),
    storage: (c) => ({
      ...createProviderStores(createDatabase(c)),
      userStore: createHouseholdUserStore(c.env.DB),
    }),
    views,
    dynamicClientRegistration: { maxRegisteredClients: MAX_DYNAMIC_CLIENTS },
  };

  const app: OidcApp = new Hono();
  app.use('*', async (c, next) => {
    dcrStore.use(d1Database(c.env.DB));
    await registerHouseholdClient(env);
    await next();
  });
  applyOidc(app, oidcOptions);

  // 生成コードのミドルウェアが掛からないパスでも、OP のリクエストコンテキストを用意する
  const oidcContext: MiddlewareHandler = async (c, next) => {
    if (!c.get('config')) {
      const failure = await setRequestContext(c, oidcOptions);
      if (failure) return failure;
    }
    await next();
  };
  app.route(
    '/',
    googleLoginRoutes(
      { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET, ...options.google },
      oidcContext
    )
  );

  app.onError((error, c) => {
    console.error('[auth-server] Unhandled error:', error);
    return renderErrorPage(c, {
      error: 'server_error',
      errorDescription: 'ログイン処理でエラーが発生しました。時間をおいてもう一度お試しください。',
      statusCode: 500,
    });
  });
  return app;
}

/** 登録済みの D1（isolate 内で一度だけ登録する。D1 バインディングごとに覚える） */
const householdClientRegistrations = new WeakMap<D1Database, Promise<void>>();

/**
 * 家計簿アプリを confidential クライアントとして登録する（isolate ごとに一度。登録は冪等な upsert）
 * secret を差し替えたときも、新しい isolate で反映される。
 */
function registerHouseholdClient(env: AuthEnv): Promise<void> {
  const registered = householdClientRegistrations.get(env.DB);
  if (registered) return registered;
  const registration = registerClient(d1Database(env.DB), {
    clientId: HOUSEHOLD_CLIENT_ID,
    clientName: '家計簿アプリ',
    clientType: 'confidential',
    clientSecret: env.HOUSEHOLD_CLIENT_SECRET,
    redirectUris: [`${env.ISSUER}/api/session/callback`],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    tokenEndpointAuthMethods: ['client_secret_basic'],
    scope: ['openid', 'profile', 'email'],
  }).catch((error: unknown) => {
    householdClientRegistrations.delete(env.DB);
    throw error;
  });
  householdClientRegistrations.set(env.DB, registration);
  return registration;
}
