/**
 * Cloudflare API v4 の小さなクライアント（依存なし・グローバル fetch）
 *
 * - トークンは CLOUDFLARE_API_TOKEN（Bearer）、アカウントは CLOUDFLARE_ACCOUNT_ID
 * - `success: false` や 2xx 以外はエラーメッセージ付きで例外にする
 * - 「Worker が無い」と判断するのは、HTTP 404 かつエラーコード 10007
 *   （workers.api.error.script_not_found。wrangler の WORKER_NOT_FOUND_ERR_CODE と同じ）のときだけ。
 *   それ以外の失敗（権限不足・アカウント ID の誤りなど）を「無い」と取り違えない
 */

export const CLOUDFLARE_API_BASE = 'https://api.cloudflare.com/client/v4';

/** workers.api.error.script_not_found */
export const SCRIPT_NOT_FOUND_CODE = 10007;

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_LIST_PAGES = 50;

export class CloudflareApiError extends Error {
  constructor({ method, path, status, errors = [], detail }) {
    const described = errors.length > 0 ? errors.map((e) => `[${e.code}] ${e.message}`).join('; ') : detail;
    super(`Cloudflare API ${method} ${path} が失敗しました (HTTP ${status}): ${described ?? '詳細なし'}`);
    this.name = 'CloudflareApiError';
    this.method = method;
    this.path = path;
    this.status = status;
    this.errors = errors;
  }

  hasCode(code) {
    return this.errors.some((e) => e.code === code);
  }
}

/** Worker（スクリプト）が存在しないことを示すエラーか（HTTP 404 かつコード 10007 のときだけ true） */
export function isScriptNotFoundError(error) {
  return error instanceof CloudflareApiError && error.status === 404 && error.hasCode(SCRIPT_NOT_FOUND_CODE);
}

function normalizeErrors(errors) {
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => ({
    code: typeof e?.code === 'number' ? e.code : Number(e?.code),
    message: typeof e?.message === 'string' ? e.message : JSON.stringify(e),
  }));
}

/**
 * API のレスポンス本文を解釈する（純粋関数）
 * @returns {{ result: unknown, resultInfo: Record<string, unknown> | null }}
 */
export function parseApiResponse({ method, path, status, text }) {
  const ok = status >= 200 && status < 300;
  const body = text.trim();
  if (body === '') {
    if (ok) return { result: null, resultInfo: null };
    throw new CloudflareApiError({ method, path, status, detail: '空のレスポンス' });
  }
  let json;
  try {
    json = JSON.parse(body);
  } catch {
    // Custom Domain の DELETE などは本文が JSON でないことがある。成功した DELETE だけは本文を問わない
    if (ok && method === 'DELETE') return { result: null, resultInfo: null };
    throw new CloudflareApiError({ method, path, status, detail: `JSON でないレスポンス: ${body.slice(0, 200)}` });
  }
  const errors = normalizeErrors(json?.errors);
  if (!ok || json?.success !== true) {
    throw new CloudflareApiError({ method, path, status, errors, detail: 'success が true ではありません' });
  }
  return { result: json.result ?? null, resultInfo: json.result_info ?? null };
}

/** 一覧 API の次のページの指定（カーソル式とページ番号式の両方に対応）。無ければ null */
export function nextPageQuery(resultInfo, page, previousCursor) {
  if (!resultInfo) return null;
  const cursor = resultInfo.cursor;
  if (typeof cursor === 'string' && cursor !== '' && cursor !== previousCursor) return { cursor };
  const totalPages = Number(resultInfo.total_pages);
  if (Number.isFinite(totalPages) && page < totalPages) return { page: String(page + 1) };
  return null;
}

function requireArray(value, what) {
  if (!Array.isArray(value)) throw new Error(`${what} の応答が配列ではありません`);
  return value;
}

function requireString(value, what) {
  if (typeof value !== 'string' || value === '') throw new Error(`${what} が文字列ではありません`);
  return value;
}

/** Worker のデプロイ（バージョンごとのトラフィック配分）を検証して正規化する */
export function normalizeDeployment(deployment) {
  if (!deployment || typeof deployment !== 'object') throw new Error('デプロイの応答が不正です');
  const versions = requireArray(deployment.versions, 'deployment.versions').map((v) => ({
    version_id: requireString(v?.version_id, 'deployment.versions[].version_id'),
    percentage: Number(v?.percentage),
  }));
  if (versions.length === 0 || versions.some((v) => !Number.isFinite(v.percentage))) {
    throw new Error('デプロイのバージョン配分が不正です');
  }
  return { id: typeof deployment.id === 'string' ? deployment.id : null, versions };
}

const enc = encodeURIComponent;

/**
 * @param {{ apiToken: string, accountId: string, fetchImpl?: typeof fetch, baseUrl?: string, retryDelaysMs?: number[] }} options
 */
export function createCloudflareClient({
  apiToken,
  accountId,
  fetchImpl = globalThis.fetch,
  baseUrl = CLOUDFLARE_API_BASE,
  retryDelaysMs = [1_000, 3_000],
}) {
  if (!apiToken) throw new Error('CLOUDFLARE_API_TOKEN が設定されていません');
  if (!accountId) throw new Error('CLOUDFLARE_ACCOUNT_ID が設定されていません');

  async function send(method, path, { query, body } = {}) {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    const headers = { Authorization: `Bearer ${apiToken}`, Accept: 'application/json' };
    const init = { method, headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const response = await fetchImpl(url, init);
    return { status: response.status, text: await response.text() };
  }

  /** GET だけは一時的な失敗（ネットワーク・429・5xx）を数回やり直す。変更系はやり直さない */
  async function request(method, path, options = {}) {
    const delays = method === 'GET' ? retryDelaysMs : [];
    for (let attempt = 0; ; attempt++) {
      let response;
      try {
        response = await send(method, path, options);
      } catch (error) {
        if (attempt >= delays.length) {
          throw new Error(`Cloudflare API ${method} ${path} に接続できません: ${error?.message ?? error}`);
        }
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      const transient = response.status === 429 || response.status >= 500;
      if (transient && attempt < delays.length) {
        await new Promise((r) => setTimeout(r, delays[attempt]));
        continue;
      }
      return parseApiResponse({ method, path, status: response.status, text: response.text });
    }
  }

  async function listAll(path, query = {}) {
    const items = [];
    let pageQuery = {};
    let page = 1;
    for (let i = 0; i < MAX_LIST_PAGES; i++) {
      const { result, resultInfo } = await request('GET', path, { query: { ...query, ...pageQuery } });
      items.push(...requireArray(result, `GET ${path}`));
      const next = nextPageQuery(resultInfo, page, pageQuery.cursor);
      if (!next) return items;
      if (next.page) page = Number(next.page);
      pageQuery = next;
    }
    throw new Error(`GET ${path} のページが多すぎます（${MAX_LIST_PAGES} ページで打ち切り）`);
  }

  const account = `/accounts/${enc(accountId)}`;

  return {
    accountId,
    request,
    listAll,

    /** ゾーン名からゾーン ID を引く（同名が複数ならアカウント ID で絞る） */
    async getZoneId(zoneName) {
      const zones = (await listAll('/zones', { name: zoneName })).filter((z) => z?.name === zoneName);
      const inAccount = zones.filter((z) => z?.account?.id === accountId);
      const candidates = inAccount.length > 0 ? inAccount : zones;
      if (candidates.length === 0) {
        throw new Error(
          `ゾーン ${zoneName} が見つかりません（CLOUDFLARE_API_TOKEN にこのゾーンの Zone:Read 権限があるか確認してください）`
        );
      }
      if (candidates.length > 1) throw new Error(`ゾーン ${zoneName} が複数見つかりました`);
      return requireString(candidates[0].id, 'zone.id');
    },

    /** ゾーンの Workers ルート一覧（{ id, pattern, script? }） */
    async listRoutes(zoneId) {
      const routes = await listAll(`/zones/${enc(zoneId)}/workers/routes`);
      return routes.map((r) => ({
        id: requireString(r?.id, 'route.id'),
        pattern: requireString(r?.pattern, 'route.pattern'),
        script: typeof r?.script === 'string' && r.script !== '' ? r.script : null,
      }));
    },

    async createRoute(zoneId, { pattern, script }) {
      const body = script ? { pattern, script } : { pattern };
      const { result } = await request('POST', `/zones/${enc(zoneId)}/workers/routes`, { body });
      return { id: requireString(result?.id, 'created route.id') };
    },

    /** 既存ルートの割り当て先を変える（ルート ID は変わらず、未割り当ての時間ができない） */
    async updateRoute(zoneId, routeId, { pattern, script }) {
      const body = script ? { pattern, script } : { pattern };
      await request('PUT', `/zones/${enc(zoneId)}/workers/routes/${enc(routeId)}`, { body });
    },

    async deleteRoute(zoneId, routeId) {
      await request('DELETE', `/zones/${enc(zoneId)}/workers/routes/${enc(routeId)}`);
    },

    /** アカウントの Workers Custom Domains（{ id, hostname, service, zone_name, environment }） */
    async listWorkerDomains() {
      const { result } = await request('GET', `${account}/workers/domains`);
      return requireArray(result, 'GET workers/domains').map((d) => ({
        id: requireString(d?.id, 'domain.id'),
        hostname: typeof d?.hostname === 'string' ? d.hostname : '',
        service: typeof d?.service === 'string' ? d.service : '',
        environment: typeof d?.environment === 'string' ? d.environment : '',
        zoneName: typeof d?.zone_name === 'string' ? d.zone_name : '',
      }));
    },

    async deleteWorkerDomain(domainId) {
      await request('DELETE', `${account}/workers/domains/${enc(domainId)}`);
    },

    /** Worker を削除する。既に無ければ 'not-found'（404 かつ 10007 のときだけ） */
    async deleteScript(scriptName) {
      try {
        await request('DELETE', `${account}/workers/scripts/${enc(scriptName)}`);
        return 'deleted';
      } catch (error) {
        if (isScriptNotFoundError(error)) return 'not-found';
        throw error;
      }
    },

    /** Worker の secret 名の一覧。Worker が無ければ null（それ以外の失敗は例外） */
    async listScriptSecretNames(scriptName) {
      try {
        const { result } = await request('GET', `${account}/workers/scripts/${enc(scriptName)}/secrets`);
        return requireArray(result, `GET ${scriptName}/secrets`).map((s) =>
          requireString(s?.name, `${scriptName} の secret.name`)
        );
      } catch (error) {
        if (isScriptNotFoundError(error)) return null;
        throw error;
      }
    },

    /**
     * Worker の現在のデプロイ（最新のもの）。
     * @returns {Promise<{ scriptExists: boolean, deployment: { id: string | null, versions: { version_id: string, percentage: number }[] } | null }>}
     */
    async getCurrentDeployment(scriptName) {
      try {
        const { result } = await request('GET', `${account}/workers/scripts/${enc(scriptName)}/deployments`);
        const deployments = requireArray(result?.deployments, `GET ${scriptName}/deployments`);
        return {
          scriptExists: true,
          deployment: deployments.length > 0 ? normalizeDeployment(deployments[0]) : null,
        };
      } catch (error) {
        if (isScriptNotFoundError(error)) return { scriptExists: false, deployment: null };
        throw error;
      }
    },
  };
}

/** 環境変数（CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID）からクライアントを作る */
export function clientFromEnv(env = process.env) {
  return createCloudflareClient({ apiToken: env.CLOUDFLARE_API_TOKEN, accountId: env.CLOUDFLARE_ACCOUNT_ID });
}
