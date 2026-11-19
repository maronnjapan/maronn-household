#!/usr/bin/env node
/**
 * Worker の secret をそろえる
 *
 * household-auth:
 *   - GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET: 毎回 GitHub secret の値を入れる
 *   - OIDC_SIGNING_KEY: 無いときだけ生成する（RSA-2048 / RS256 の秘密鍵 JWK 1 つ）。既存の鍵は決して上書きしない
 *     （上書きすると発行済みのトークンがすべて検証できなくなる）
 * household-auth と household-app:
 *   - HOUSEHOLD_CLIENT_SECRET: どちらかに無ければ新しい値（32 バイトの base64url）を生成し、両方に入れる（household-auth が先）
 *
 * secret の一覧は Cloudflare API（GET /accounts/:id/workers/scripts/:name/secrets）で読む。
 * `wrangler secret list` は Worker が無いとき（10007）にエラーにせず [] を返すため、
 * 「Worker が無い」と「secret が無い」を区別できるよう API を直接呼ぶ。一覧が読めなければ失敗する
 * （失敗を「secret が無い」と見なすと署名鍵を作り直してしまう）。
 *
 * 値は標準入力で wrangler に渡す（ログにも引数にも出さない）:
 * - household-auth: `wrangler secret put <NAME> --name household-auth`。新しいバージョンを作ってすぐ本番に反映する
 *   （直前に wrangler deploy しているので、最新のバージョン＝本番のバージョン）
 * - household-app: `wrangler versions secret put <NAME> --name household-app --message ...`。最新のバージョンに secret を
 *   足した新しいバージョンを作るだけで、本番には出さない。あとの `wrangler versions upload` がこの secret を引き継ぎ、
 *   カットオーバーで本番に出る。カットオーバー前の household-app を変えないので、失敗時にデプロイ前のバージョンへ戻しても
 *   次の実行で `secret put` が「最新のバージョンが本番に出ていない」（10215）で止まることがない。
 *   household-app がまだ無い（バージョンが 1 つもない）ときだけ `wrangler secret put`（仮の Worker を作る）
 */
import { clientFromEnv } from './cloudflare-api.mjs';
import { APP_WORKER, AUTH_WORKER, WORKER_DIRS } from './config.mjs';
import { isMainModule, logWarning, maskSecret, parseCliArgs, runCli } from './cli-utils.mjs';
import { runWrangler } from './wrangler.mjs';

export const GOOGLE_CLIENT_ID = 'GOOGLE_CLIENT_ID';
export const GOOGLE_CLIENT_SECRET = 'GOOGLE_CLIENT_SECRET';
export const OIDC_SIGNING_KEY = 'OIDC_SIGNING_KEY';
export const HOUSEHOLD_CLIENT_SECRET = 'HOUSEHOLD_CLIENT_SECRET';

const SIGNING_ALGORITHM = { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' };

const USAGE = `使い方:
  node scripts/cloudflare/ensure-secrets.mjs [--dry-run]
      ${AUTH_WORKER} と ${APP_WORKER} の secret をそろえる（--dry-run は計画の表示だけ）
      環境変数: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET

  node scripts/cloudflare/ensure-secrets.mjs --generate-signing-key [--kid key-YYYYMMDD]
      OIDC_SIGNING_KEY に入れる新しい秘密鍵 JWK を標準出力に書く（手動のローテーション用。Cloudflare には何もしない）`;

/**
 * どの secret をどこに入れるか（純粋関数）
 * @param {string[]} existingAuthNames household-auth にある secret 名
 * @param {string[]} existingAppNames household-app にある secret 名
 * @param {{ appExists?: boolean }} [options] household-app がまだ無いときは false
 * @returns {{ puts: { worker: string, name: string, command: 'secret-put' | 'versions-secret-put', source: { type: 'env', env: string } | { type: 'generate', generator: 'oidc-signing-key' | 'household-client-secret' } }[], kept: { worker: string, name: string }[] }}
 *   puts はこの順に実行する（household-auth が先）。同じ generator の値は同じ値を使う
 */
export function decideSecretActions(existingAuthNames, existingAppNames, { appExists = true } = {}) {
  const auth = new Set(existingAuthNames);
  const app = new Set(existingAppNames);
  const commandFor = (worker) => (worker === APP_WORKER && appExists ? 'versions-secret-put' : 'secret-put');
  const fromEnv = (name) => ({ worker: AUTH_WORKER, name, command: 'secret-put', source: { type: 'env', env: name } });
  const generated = (worker, name, generator) => ({ worker, name, command: commandFor(worker), source: { type: 'generate', generator } });

  const puts = [fromEnv(GOOGLE_CLIENT_ID), fromEnv(GOOGLE_CLIENT_SECRET)];
  const kept = [];

  if (auth.has(OIDC_SIGNING_KEY)) kept.push({ worker: AUTH_WORKER, name: OIDC_SIGNING_KEY });
  else puts.push(generated(AUTH_WORKER, OIDC_SIGNING_KEY, 'oidc-signing-key'));

  if (auth.has(HOUSEHOLD_CLIENT_SECRET) && app.has(HOUSEHOLD_CLIENT_SECRET)) {
    kept.push({ worker: AUTH_WORKER, name: HOUSEHOLD_CLIENT_SECRET }, { worker: APP_WORKER, name: HOUSEHOLD_CLIENT_SECRET });
  } else {
    puts.push(
      generated(AUTH_WORKER, HOUSEHOLD_CLIENT_SECRET, 'household-client-secret'),
      generated(APP_WORKER, HOUSEHOLD_CLIENT_SECRET, 'household-client-secret')
    );
  }
  return { puts, kept };
}

/** secret を入れる wrangler の引数（値は標準入力で渡す。純粋関数） */
export function secretPutArgs(put) {
  if (put.command === 'secret-put') return ['secret', 'put', put.name, '--name', put.worker];
  if (put.command === 'versions-secret-put') {
    return ['versions', 'secret', 'put', put.name, '--name', put.worker, '--message', `deploy: set ${put.name}`];
  }
  throw new Error(`未知のコマンド: ${put.command}`);
}

/** 署名鍵の kid（UTC の日付で key-YYYYMMDD） */
export function signingKeyId(date = new Date()) {
  return `key-${date.toISOString().slice(0, 10).replaceAll('-', '')}`;
}

/** OIDC_SIGNING_KEY の値: RSA-2048 / RS256 の秘密鍵 JWK（kid・alg 付き）を 1 つの JSON オブジェクトにした文字列 */
export async function generateOidcSigningKey(kid = signingKeyId()) {
  const pair = await crypto.subtle.generateKey(
    { ...SIGNING_ALGORITHM, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
    true,
    ['sign', 'verify']
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return JSON.stringify({ ...jwk, kid, alg: 'RS256' });
}

/** HOUSEHOLD_CLIENT_SECRET の値: 32 バイトの乱数を base64url にした文字列 */
export function generateHouseholdClientSecret() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
}

export const DEFAULT_GENERATORS = Object.freeze({
  'oidc-signing-key': () => generateOidcSigningKey(),
  'household-client-secret': () => generateHouseholdClientSecret(),
});

/**
 * 各 put に入れる値を決める。生成する値は generator ごとに 1 回だけ作り、同じ generator の put で共有する
 * @returns {Promise<{ put: object, value: string, generated: boolean }[]>}
 */
export async function resolveSecretValues(puts, env, generators = DEFAULT_GENERATORS) {
  const generatedValues = new Map();
  const resolved = [];
  for (const put of puts) {
    if (put.source.type === 'env') {
      const value = env[put.source.env]?.trim();
      if (!value) throw new Error(`環境変数 ${put.source.env} が空です（GitHub secret ${put.source.env} を設定してください）`);
      resolved.push({ put, value, generated: false });
    } else {
      const { generator } = put.source;
      if (!generatedValues.has(generator)) {
        const generate = generators[generator];
        if (!generate) throw new Error(`未知の generator: ${generator}`);
        generatedValues.set(generator, await generate());
      }
      resolved.push({ put, value: generatedValues.get(generator), generated: true });
    }
  }
  return resolved;
}

/** 値と、JSON（JWK）ならその秘密の成分もマスクする */
function maskValue(value) {
  maskSecret(value);
  try {
    const jwk = JSON.parse(value);
    for (const field of ['d', 'p', 'q', 'dp', 'dq', 'qi']) {
      if (typeof jwk?.[field] === 'string') maskSecret(jwk[field]);
    }
  } catch {
    // JSON でない値（クライアントシークレットなど）はそのまま
  }
}

function describePut(put) {
  const what =
    put.source.type === 'env'
      ? `${put.worker}: ${put.name} を GitHub secret ${put.source.env} の値で設定`
      : `${put.worker}: ${put.name} を新しく生成して設定`;
  return put.command === 'versions-secret-put' ? `${what}（新しいバージョンに入れるだけで、本番にはカットオーバーで出る）` : what;
}

async function listSecretNames(client) {
  const authNames = await client.listScriptSecretNames(AUTH_WORKER);
  if (authNames === null) {
    throw new Error(`${AUTH_WORKER} がありません。secret より先に wrangler deploy でデプロイしてください`);
  }
  const appNames = await client.listScriptSecretNames(APP_WORKER);
  return { authNames, appNames: appNames ?? [], appExists: appNames !== null };
}

export async function main(argv) {
  const args = parseCliArgs(argv, {
    'dry-run': { type: 'boolean' },
    'generate-signing-key': { type: 'boolean' },
    kid: { type: 'string' },
  });
  if (args.help) {
    console.log(USAGE);
    return 0;
  }
  if (args['generate-signing-key']) {
    console.error('秘密鍵を標準出力に書きます。ファイルへのリダイレクトかパイプで受け取り、画面やログに残さないでください');
    process.stdout.write(`${await generateOidcSigningKey(args.kid ?? signingKeyId())}\n`);
    return 0;
  }
  if (args.kid) throw new Error('--kid は --generate-signing-key と一緒にだけ使えます');

  const client = clientFromEnv();
  const { authNames, appNames, appExists } = await listSecretNames(client);
  if (!appExists) {
    logWarning(`${APP_WORKER} がまだありません。wrangler secret put が仮の Worker を作り、あとの versions upload で置き換わります`);
  }
  const { puts, kept } = decideSecretActions(authNames, appNames, { appExists });
  for (const put of puts) console.log(`- ${describePut(put)}`);
  for (const { worker, name } of kept) console.log(`- ${worker}: ${name} は設定済みなので変更しません`);
  if (args['dry-run']) {
    console.log('--dry-run のため変更しません');
    return 0;
  }

  const resolved = await resolveSecretValues(puts, process.env);
  for (const { value } of resolved) maskValue(value);
  for (const { put, value } of resolved) {
    console.log(`${describePut(put)}...`);
    runWrangler(secretPutArgs(put), { appDir: WORKER_DIRS[put.worker], input: value });
  }

  // 本番に反映した secret（secret put）が実際に一覧に現れることを確かめる
  // （versions secret put はまだ本番に出ていないバージョンに入れるだけなので、wrangler の成功で判断する）
  const after = await listSecretNames(client);
  const byWorker = { [AUTH_WORKER]: new Set(after.authNames), [APP_WORKER]: new Set(after.appNames) };
  const absent = puts.filter((put) => put.command === 'secret-put' && !byWorker[put.worker].has(put.name));
  if (absent.length > 0) {
    throw new Error(`設定したはずの secret が見つかりません: ${absent.map((p) => `${p.worker}/${p.name}`).join(', ')}`);
  }
  console.log('secret の設定が完了しました');
  return 0;
}

if (isMainModule(import.meta.url)) await runCli(main);
