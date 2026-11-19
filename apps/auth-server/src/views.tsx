/**
 * 認証基盤の画面（生成コードの既定ビューを applyOidc の views オプションで差し替える）
 *
 * - ログイン画面: パスワードフォームは出さず「Googleでログイン」だけ
 * - 同意画面: ファーストパーティ（家計簿アプリ）は自動で承認し、MCP クライアントには日本語の同意画面を出す
 */
import type { Child } from 'hono/jsx';
import type { JSX } from 'hono/jsx/jsx-runtime';
import { raw } from 'hono/html';
import { buildTransactionPath } from '@maronn-openid-connect/core';
import { clientDisplayName, type ConsentPageParams, type ErrorPageParams, type LoginPageParams, type Views } from './oidc-provider/views.js';

/** 同意画面を出さずに承認するファーストパーティのクライアント */
export const FIRST_PARTY_CLIENT_IDS: readonly string[] = ['household-app'];

const SCOPE_LABELS: Record<string, string> = {
  household: '家計簿データ（支出・予算・レシート）の参照と記録',
  openid: 'あなたのアカウントの識別',
  profile: '名前とプロフィール画像',
  email: 'メールアドレス',
  offline_access: 'ログインしていない間の継続したアクセス',
};

const STYLE = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Hiragino Sans', sans-serif; background: #f5f5f5; color: #333; margin: 0; }
  main { max-width: 26rem; margin: 10vh auto; padding: 2rem 1.5rem; background: #fff; border-radius: 0.75rem; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  p { line-height: 1.6; }
  ul { padding-left: 1.25rem; }
  .button { display: block; width: 100%; box-sizing: border-box; padding: 0.75rem 1rem; margin-top: 0.75rem; border-radius: 0.5rem; border: 1px solid #dadce0; background: #fff; color: #333; font-size: 1rem; text-align: center; text-decoration: none; cursor: pointer; }
  .primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
`;

function Page(props: { title: string; children?: Child }): JSX.Element {
  return (
    <>
      {raw('<!DOCTYPE html>')}
      <html lang="ja">
        <head>
          <meta charset="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>{props.title} | 家計簿</title>
          <style>{raw(STYLE)}</style>
        </head>
        <body>
          <main>{props.children}</main>
        </body>
      </html>
    </>
  );
}

function loginPage(params: LoginPageParams): JSX.Element {
  const googleLoginUrl = `/login/google?${new URLSearchParams({ transaction_id: params.transactionId })}`;
  return (
    <Page title="ログイン">
      <h1>ログイン</h1>
      <p>
        <strong>{clientDisplayName(params.client)}</strong> を利用するには、Google アカウントでログインしてください。
      </p>
      {params.error ? <p role="alert">{params.error}</p> : null}
      <a class="button" href={googleLoginUrl}>
        Googleでログイン
      </a>
    </Page>
  );
}

function consentPage(params: ConsentPageParams): JSX.Element {
  const firstParty = FIRST_PARTY_CLIENT_IDS.includes(params.client.clientId);
  return (
    <Page title="アクセスの許可">
      {firstParty ? null : (
        <>
          <h1>アクセスの許可</h1>
          <p>
            <strong>{clientDisplayName(params.client)}</strong> が次のアクセスを求めています。
          </p>
          <ul>
            {params.scopes.map((scope) => (
              <li>{SCOPE_LABELS[scope] ?? scope}</li>
            ))}
          </ul>
        </>
      )}
      <form method="post" action={buildTransactionPath('/consent', params.transactionId)}>
        <input type="hidden" name="transaction_id" value={params.transactionId} />
        <input type="hidden" name="csrf_token" value={params.csrfToken} />
        {firstParty ? (
          <>
            <input type="hidden" name="action" value="approve" />
            <noscript>
              <button class="button primary" type="submit">続ける</button>
            </noscript>
          </>
        ) : (
          <>
            <button class="button primary" type="submit" name="action" value="approve">許可する</button>
            <button class="button" type="submit" name="action" value="deny">拒否する</button>
          </>
        )}
      </form>
      {firstParty ? raw('<script>document.forms[0].submit();</script>') : null}
    </Page>
  );
}

function errorPage(params: ErrorPageParams): JSX.Element {
  return (
    <Page title="エラー">
      <h1>ログインできませんでした</h1>
      <p>{params.errorDescription ?? params.error}</p>
      <a class="button" href="/">家計簿に戻る</a>
    </Page>
  );
}

export const views: Partial<Views> = { loginPage, consentPage, errorPage };
