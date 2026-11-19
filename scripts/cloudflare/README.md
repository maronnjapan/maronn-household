# 本番デプロイ（Cloudflare）

`main` への push（`apps/**` `packages/**` `pnpm-lock.yaml` `scripts/cloudflare/**` `.github/workflows/deploy.yml` の変更）と手動実行（workflow_dispatch）で、`.github/workflows/deploy.yml` が `maronn-household-budget.com` にデプロイする。
同時に走らないよう `deploy-production` で直列化している。本番を変更するのは `main` からの実行だけ。

## 流れ

1. **retire-legacy**（後続の成否に関係なく最初に実行）
   旧 Worker `mcp-server` → `auth-server` → `delete-expired-session-cron` の順に、ゾーンのルートを削除し、Workers Custom Domain を外し、Worker を削除する。無ければ何もしない。許可リスト以外の Worker には触れない。
2. **deploy**
   1. プリフライト（`preflight.mjs`）: GitHub secret がそろっているか、API トークンでゾーンとルートを読めるか、household-app の現在のデプロイを読めるか。ここで失敗すれば本番は何も変わらない
   2. 型検査（gateway / auth-server / mcp-server / @maronn/domain）
   3. D1 マイグレーション（`CLOUDFLARE_D1_API_TOKEN`）
   4. `household-auth` → `household-mcp` を `wrangler deploy`（ルートを持たないので、まだ公開されない）
   5. secret をそろえる（`ensure-secrets.mjs`）
   6. `household-gateway` を `wrangler deploy`（ルートは書かない）
   7. household-app を `vike build` し、`wrangler versions upload`（`upload-app-version.mjs`。まだ本番には出さない）
   8. カットオーバー（`cutover-routes.mjs`）: 変更前の状態を記録してから、`maronn-household-budget.com/*` と `www.maronn-household-budget.com/*` を `household-gateway` に割り当て（既存のルートは PUT で付け替えるので未割り当ての時間はない）、household-app の新バージョンを 100% で出す
   9. スモークテスト（`smoke-test.mjs`）。反映待ちのため数回やり直す
   10. 8 か 9 が失敗したら自動でロールバック（household-app を以前のデプロイに、ルートを以前の割り当てに戻す）し、ジョブは失敗にする
3. **deploy-crons**: `delete-no-user-household-data-cron` を `wrangler deploy`。deploy が成功したときだけ実行する（ユーザーのいないデータを消す cron なので、マイグレーションと認証基盤の更新が済んだ状態でだけ新しくする。失敗時は既存の cron が動き続ける）。`webhook-batch-cron` はこのワークフローでは扱わない

## GitHub secret

| 名前 | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers のデプロイ・secret・ルート・Custom Domain の操作。アカウントの Workers Scripts:Edit と、ゾーン `maronn-household-budget.com` の Zone:Read・Workers Routes:Edit が必要 |
| `CLOUDFLARE_ACCOUNT_ID` | アカウント ID |
| `CLOUDFLARE_D1_API_TOKEN` | D1 マイグレーション |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | household-auth の Google ログイン。毎回のデプロイで Worker の secret に入れ直す |

Worker の secret（`OIDC_SIGNING_KEY` と `HOUSEHOLD_CLIENT_SECRET`）は GitHub に置かない。無ければデプロイが生成する（既存の値は上書きしない）。

## 初回のデプロイ

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を追加する前は、retire-legacy（旧 MCP サーバーなどの削除）だけが実行され、deploy はプリフライトで失敗する。本番の household-app は旧バージョンのまま動き続ける。secret を追加したら Actions の「Deploy production」を Run workflow で再実行する
- 初回は household-auth に `OIDC_SIGNING_KEY` と `HOUSEHOLD_CLIENT_SECRET` を、household-app に `HOUSEHOLD_CLIENT_SECRET` を生成して入れる
- Google Cloud Console の承認済みリダイレクト URI に `https://maronn-household-budget.com/api/auth/callback/google` があること（Better Auth 時代と同じ URI）

## 手動のロールバック

自動のロールバックが失敗したときや、あとから戻したいとき。

- **カットオーバー前の状態に戻す**: 実行結果の Artifacts から `cutover-state` をダウンロードし、
  ```bash
  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
    node scripts/cloudflare/cutover-routes.mjs --rollback ./cutover-state.json
  ```
  （先に `pnpm install`。household-app の切り替えに `apps/household-app` の wrangler を使う）
- **household-app だけ戻す**: `cd apps/household-app && npx wrangler deployments list --name household-app` で戻す先を確かめ、`npx wrangler rollback <version-id> --name household-app`
- **household-auth / household-mcp / household-gateway**: 自動のロールバックの対象外（`wrangler deploy` で即時反映される）。`npx wrangler rollback <version-id> --name <worker>` で戻す
- **ルートだけ戻す**: ダッシュボードの Websites → maronn-household-budget.com → Workers Routes で割り当てを変える

## OIDC_SIGNING_KEY のローテーション

household-auth は `OIDC_SIGNING_KEY` で署名し、`OIDC_SIGNING_KEY_PREVIOUS` があればその公開鍵も JWKS に載せる。どちらも RSA 秘密鍵の JWK（kid 付き）1 つ。

```bash
umask 077
node scripts/cloudflare/ensure-secrets.mjs --generate-signing-key --kid key-20270101 > new-key.json   # kid は現在の鍵と別の値にする
cd apps/auth-server
npx wrangler secret put OIDC_SIGNING_KEY_PREVIOUS --name household-auth < ../../old-key.json  # 現在の鍵（下の注意を参照）
npx wrangler secret put OIDC_SIGNING_KEY --name household-auth < ../../new-key.json
# 古い鍵で署名したアクセストークンが失効したら（15 分以上たってから）
npx wrangler secret delete OIDC_SIGNING_KEY_PREVIOUS --name household-auth
```

- `PREVIOUS` を先に入れる（`secret put` はそのたびに本番へ反映されるので、この順なら古い鍵のトークンを検証できない時間がない）
- 注意: Cloudflare の secret は読み出せないので、デプロイが自動生成した鍵の値は誰も持っていない。その場合は `PREVIOUS` を入れずに `OIDC_SIGNING_KEY` だけを入れ替える（直近 15 分に発行したアクセストークンが無効になり、MCP クライアントはリフレッシュする）。次のローテーションのために `new-key.json` はパスワードマネージャーなどに保管し、作業ディレクトリからは消す

`HOUSEHOLD_CLIENT_SECRET` を入れ替えたいときは、どちらかの Worker から `npx wrangler secret delete HOUSEHOLD_CLIENT_SECRET --name <worker>` で消せば、次のデプロイが新しい値を両方に入れる。

## スクリプト

すべて依存なしの Node（ESM）。`--help` で使い方を表示する。判断は純粋関数に分け、`npx vitest run scripts/cloudflare` で検査する。

| ファイル | 役割 |
|---|---|
| `config.mjs` | Worker 名・ゾーン・ルートのパターン・退役の許可リスト |
| `cloudflare-api.mjs` | Cloudflare API の小さなクライアント（`success: false` は例外。「Worker が無い」は HTTP 404 かつ 10007 のときだけ） |
| `wrangler.mjs` | 各アプリの wrangler の実行と、`WRANGLER_OUTPUT_FILE_PATH` の ND-JSON の解釈 |
| `retire-legacy-workers.mjs` | 旧 Worker の退役（`--dry-run` あり） |
| `preflight.mjs` | デプロイ前の確認 |
| `ensure-secrets.mjs` | Worker の secret をそろえる（`--dry-run` あり。一覧が読めなければ失敗し、生成し直さない） |
| `upload-app-version.mjs` | household-app の `wrangler versions upload` とバージョン ID の取り出し |
| `cutover-routes.mjs` | カットオーバーとロールバック（`--rollback <file>`） |
| `smoke-test.mjs` | 公開 URL のスモークテスト |

## うまくいかないとき

- `ensure-secrets` で household-app への `secret put` が「latest version isn't currently deployed」（10215）で失敗する: household-app の最新のバージョンが本番に出ていない（以前の実行がアップロード後に止まった、など）。`npx wrangler versions deploy <最新のversion-id>@100% --name household-app` か `npx wrangler rollback` で最新のバージョンを本番にそろえるか、`npx wrangler versions secret put HOUSEHOLD_CLIENT_SECRET --name household-app` で入れてから再実行する
- スモークテストだけが失敗する: ログの NG の行に、どの URL が何を返したかが出る。`node scripts/cloudflare/smoke-test.mjs --attempts 1` で手元から同じ確認ができる
