/**
 * リソースインジケーター（RFC 8707）を、生成OPが受け付ける audience パラメータに変換する
 *
 * 生成OP（CLI 0.17.0）は `resource` を無視し、代わりに許可リストなしの非標準パラメータ `audience` を
 * アクセストークンの aud に加える。そのまま使うと、他のサーバー宛てに発行させたトークンを
 * 家計簿の MCP サーバーへ送り直す攻撃（confused deputy）を防げないので、Worker の入口で認可リクエストを書き換える。
 *
 * - クライアントが直接指定した `audience` は取り除く
 * - `resource` は許可リストのリソースだけを受け付け、それ以外は invalid_target で拒否する
 * - リソース（または resource を送らない古いクライアントでは、そのリソースのスコープ）を求める認可は、
 *   そのリソースを audience にし、`offline_access` と `prompt=consent` を加える。
 *   MCP クライアントのリフレッシュトークンを、家計簿アプリのログアウト（OP のセッション終了）から切り離すため
 *   （OIDC Core 1.0 §11: offline_access は prompt=consent のときだけ付与される）。
 */

const AUTHORIZATION_PATH = '/authorize';

export interface ResourceIndicatorOptions {
  /** 受け付けるリソースの URL → そのリソースのスコープ */
  resources: Record<string, string>;
}

export async function prepareAuthorizationRequest(
  request: Request,
  options: ResourceIndicatorOptions
): Promise<Request | Response> {
  const url = new URL(request.url);
  if (url.pathname !== AUTHORIZATION_PATH) return request;

  // POST の認可リクエストはフォームだけを受け付ける（OP と同じく、メディアタイプは大文字小文字とパラメータを無視して比べる）
  const isForm = request.method === 'POST';
  const mediaType = (request.headers.get('Content-Type') ?? '').split(';')[0]?.trim().toLowerCase();
  if (isForm && mediaType !== 'application/x-www-form-urlencoded') {
    return Response.json(
      { error: 'invalid_request', error_description: 'Authorization requests must be form-encoded' },
      { status: 400 }
    );
  }
  const params = isForm ? new URLSearchParams(await request.clone().text()) : url.searchParams;

  const known = new Map(Object.entries(options.resources));
  const requested = params.getAll('resource');
  const unknown = requested.filter((resource) => !known.has(resource));
  if (unknown.length > 0) {
    return Response.json(
      { error: 'invalid_target', error_description: `Unknown resource: ${unknown.join(' ')}` },
      { status: 400 }
    );
  }

  params.delete('audience');
  const scopes = (params.get('scope') ?? '').split(' ').filter(Boolean);
  const audiences = [...known]
    .filter(([resource, scope]) => requested.includes(resource) || (requested.length === 0 && scopes.includes(scope)))
    .map(([resource]) => resource);
  if (audiences.length > 0) {
    params.set('audience', audiences.join(' '));
    if (!scopes.includes('offline_access')) params.set('scope', [...scopes, 'offline_access'].join(' '));
    const prompts = (params.get('prompt') ?? '').split(' ').filter(Boolean);
    if (!prompts.includes('none') && !prompts.includes('consent')) {
      params.set('prompt', [...prompts, 'consent'].join(' '));
    }
  }

  if (isForm) {
    const headers = new Headers(request.headers);
    headers.delete('Content-Length');
    return new Request(url, { method: 'POST', headers, body: params.toString() });
  }
  url.search = params.toString();
  return new Request(url, request);
}
