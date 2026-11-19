/**
 * 認証基盤（OpenID Provider）
 *
 * maronn-openid-connect の生成コード（./oidc-provider、CLI 0.17.0 で生成、手で編集しない）に、
 * このアプリ固有の部品を applyOidc のオプションと追加のルートで差し込む。
 * - ユーザー: 既存の user / account テーブル（household-user-store.ts）
 * - ログイン: Google（google-login.ts）
 * - 動的クライアント登録の保存先: D1（install-dcr-store.ts）
 * - 署名鍵: secret OIDC_SIGNING_KEY / OIDC_SIGNING_KEY_PREVIOUS（signing-keys.ts）
 * - 画面: 日本語の画面（views.tsx）
 * - リソースインジケーター（RFC 8707）: 認可リクエストの前処理（resource-indicator.ts）
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
import { deleteUserIdentity } from './delete-user.js';
import { googleLoginRoutes, type GoogleLoginOptions } from './google-login.js';
import { createHouseholdUserStore } from './household-user-store.js';
import { prepareAuthorizationRequest } from './resource-indicator.js';
import { loadSigningKeys } from './signing-keys.js';
import { views } from './views.js';

export interface AuthEnv {
  DB: D1Database;
  /** 公開オリジン（例: https://maronn-household-budget.com）。生成OPのルートはオリジン直下に固定 */
  ISSUER: string;
  OIDC_SIGNING_KEY: string;
  OIDC_SIGNING_KEY_PREVIOUS?: string;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  /** 家計簿アプリ（household-app）のクライアントシークレット。household-app の同名の secret と同じ値 */
  HOUSEHOLD_CLIENT_SECRET: string;
}

export const HOUSEHOLD_CLIENT_ID = 'household-app';
/** MCP サーバー（household-mcp）のリソースとスコープ */
export const MCP_SCOPE = 'household';
export const mcpResource = (issuer: string) => `${issuer}/mcp`;
/** JWT のアクセストークンは失効を即時に反映しにくいので短くする（MCP クライアントはリフレッシュする） */
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
/**
 * ID トークンの寿命は家計簿アプリのセッション（30日）に合わせる。
 * アプリはログアウト時に保存した ID トークンを id_token_hint として渡すので、期限が切れていると
 * 確認画面を挟むことになる。ID トークンはどの API のベアラーとしても受け付けない（MCP は typ=at+jwt のみ）。
 */
const ID_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const SIGNING_KEY_CACHE_MS = 10 * 60 * 1000;
/** 直近24時間の動的クライアント登録の上限（dcr-store.ts の count） */
const MAX_DYNAMIC_CLIENTS_PER_DAY = 200;

type OidcApp = Hono<{ Bindings: AuthEnv; Variables: Record<string, unknown> }>;

export interface AuthServer {
  fetch(request: Request, env: AuthEnv, ctx?: ExecutionContext): Promise<Response>;
}

/**
 * 認証基盤の Worker を組み立てる。
 * 認可リクエストは、OP に渡す前にリソースインジケーターを処理する。
 */
export function createAuthServer(env: AuthEnv, options: { google?: Pick<GoogleLoginOptions, 'fetch' | 'jwks'> } = {}): AuthServer {
  const app = buildOidcApp(env, options);
  const resources = { [mcpResource(env.ISSUER)]: MCP_SCOPE };
  return {
    async fetch(request, requestEnv, ctx) {
      const prepared = await prepareAuthorizationRequest(request, { resources });
      if (prepared instanceof Response) return prepared;
      return app.fetch(prepared, requestEnv, ctx);
    },
  };
}

function buildOidcApp(env: AuthEnv, options: { google?: Pick<GoogleLoginOptions, 'fetch' | 'jwks'> }): OidcApp {
  const issuer = env.ISSUER;
  rpInitiatedLogoutConfig.postLogoutRedirectUris[HOUSEHOLD_CLIENT_ID] = [`${issuer}/`];

  const oidcOptions: OidcProviderOptions = {
    config: {
      issuer,
      accessTokenExpiresIn: ACCESS_TOKEN_TTL_SECONDS,
      idTokenExpiresIn: ID_TOKEN_TTL_SECONDS,
      // 動的登録クライアントのロゴやポリシーの URL は、リダイレクト先と同じホストのものだけ表示する
      requireClientDisplayUriHostMatch: true,
    },
    signingKeyProvider: createCachedSigningKeyProvider(
      {
        getSigningKeys: () =>
          loadSigningKeys({ current: env.OIDC_SIGNING_KEY, previous: env.OIDC_SIGNING_KEY_PREVIOUS }),
      },
      SIGNING_KEY_CACHE_MS
    ),
    storage: (c) => ({
      ...createProviderStores(createDatabase(c)),
      userStore: createHouseholdUserStore(c.env.DB),
    }),
    views,
    dynamicClientRegistration: {
      maxRegisteredClients: MAX_DYNAMIC_CLIENTS_PER_DAY,
      // 未認証の登録者が指定した URL を OP に取りに行かせない
      acceptJwksUri: false,
    },
  };

  const app: OidcApp = new Hono();
  app.use('*', async (c, next) => {
    dcrStore.use(d1Database(c.env.DB));
    await registerHouseholdClient(env);
    await next();
    // 同意画面などを他のサイトの枠に埋め込ませない（クリックジャッキング対策）
    const response = new Response(c.res.body, c.res);
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set('Content-Security-Policy', "frame-ancestors 'none'");
    c.res = response;
  });

  // アカウント削除（household-app から service binding でだけ呼ぶ。gateway はこのパスを転送しない）
  app.post('/internal/users/delete', async (c) => {
    // 公開経路（gateway 経由）のリクエストには Cloudflare が CF-Connecting-IP を付ける
    if (c.req.header('CF-Connecting-IP')) return c.notFound();
    const { userId } = await c.req.json<{ userId?: unknown }>();
    if (typeof userId !== 'string' || userId.length === 0) {
      return c.json({ error: 'invalid_request' }, 400);
    }
    await deleteUserIdentity(c.env.DB, userId);
    return c.body(null, 204);
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
    console.error('[household-auth] Unhandled error:', error);
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
 * スコープは openid profile email だけにし、MCP 用の household は求められないようにする。
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
