# 本番デプロイ（Cloudflare）

`main` への push（`apps/**` `packages/**` `pnpm-lock.yaml` `scripts/cloudflare/**` `.github/workflows/deploy.yml` の変更）と手動実行（workflow_dispatch）で、`.github/workflows/deploy.yml` が `maronn-household-budget.com` にデプロイする。
同時に走らないよう `deploy-production` で直列化している。本番を変更するのは `main` からの実行だけ。

## 流れ

1. **retire-legacy**（後続の成否に関係なく最初に実行）
   旧 Worker `mcp-server` → `auth-server` → `delete-expired-session-cron` の順に、ゾーンのルートを削除し、Workers Custom Domain を外し、Worker を削除する。無ければ何もしない。許可リスト以外の Worker には触れない。
2. **deploy**
   1. プリフライト（`preflight.mjs`）: GitHub secret がそろっているか、`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を Google が受け付けるか（Google のトークンエンドポイントにダミーの認可コードを送り、`invalid_grant` なら正しい、`invalid_client` / `unauthorized_client` なら誤り。確かめられない応答も失敗にする）、API トークンでゾーンとルートを読めるか、household-app の現在のデプロイを読めるか。ここで失敗すれば本番は何も変わらない
   2. 型検査（gateway / auth-server / mcp-server / @maronn/domain）
   3. D1 マイグレーション（`CLOUDFLARE_D1_API_TOKEN`）
   4. 現在のデプロイを記録（`record-deployments.mjs`）: household-auth / household-mcp / household-gateway / household-app の今のバージョン。ここから先で本番を変える
   5. `household-auth` → `household-mcp` を `wrangler deploy`（初回はルートを持たないのでまだ公開されない。2 回目以降は gateway 経由で即時に 100%）
   6. secret をそろえる（`ensure-secrets.mjs`）。household-auth へはすぐ反映、household-app へは `wrangler versions secret put` で新しいバージョンに入れるだけ（本番にはカットオーバーで出る）
   7. `household-gateway` を `wrangler deploy`（ルートは書かない）
   8. household-app を `vike build` し、`wrangler versions upload`（`upload-app-version.mjs`。まだ本番には出さない）
   9. カットオーバー（`cutover-routes.mjs`）: 変更前の状態を記録してから、`maronn-household-budget.com/*` と `www.maronn-household-budget.com/*` を `household-gateway` に割り当て（既存のルートは PUT で付け替えるので未割り当ての時間はない）、household-app の新バージョンを 100% で出す
   10. スモークテスト（`smoke-test.mjs`）。反映待ちのため数回やり直す
   11. 4 のあとのどのステップが失敗（または中断）しても自動でロールバックし（`rollback.mjs`）、ジョブは失敗にする。デプロイと逆の順に household-app → ルート → household-gateway → household-mcp → household-auth を記録した状態へ戻す。記録と同じ Worker（そこまで進まなかったもの）と、記録したときにまだ無かった Worker（初回。ルートを持たないので公開されない）はそのまま。D1 のマイグレーションは戻さない
3. **deploy-crons**: `delete-no-user-household-data-cron` を `wrangler deploy`。deploy が成功したときだけ実行する（ユーザーのいないデータを消す cron なので、マイグレーションと認証基盤の更新が済んだ状態でだけ新しくする。失敗時は既存の cron が動き続ける）。`webhook-batch-cron` はこのワークフローでは扱わない

## GitHub secret

| 名前 | 用途 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Workers のデプロイ・secret・ルート・Custom Domain の操作。アカウントの Workers Scripts:Edit と、ゾーン `maronn-household-budget.com` の Zone:Read・Workers Routes:Edit が必要 |
| `CLOUDFLARE_ACCOUNT_ID` | アカウント ID |
| `CLOUDFLARE_D1_API_TOKEN` | D1 マイグレーション |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | household-auth の Google ログイン。プリフライトで Google が受け付けることを確かめてから、毎回のデプロイで Worker の secret に入れ直す |

Worker の secret（`OIDC_SIGNING_KEY` と `HOUSEHOLD_CLIENT_SECRET`）は GitHub に置かない。無ければデプロイが生成する（既存の値は上書きしない）。

## 初回のデプロイ

- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` を追加する前は、retire-legacy（旧 MCP サーバーなどの削除）だけが実行され、deploy はプリフライトで失敗する。本番の household-app は旧バージョンのまま動き続ける。secret を追加したら Actions の「Deploy production」を Run workflow で再実行する
- 初回は household-auth に `OIDC_SIGNING_KEY` と `HOUSEHOLD_CLIENT_SECRET` を、household-app に `HOUSEHOLD_CLIENT_SECRET` を生成して入れる
- Google Cloud Console の承認済みリダイレクト URI に `https://maronn-household-budget.com/api/auth/callback/google` があること（Better Auth 時代と同じ URI）

## 手動のロールバック

自動のロールバックが失敗したときや、あとから戻したいとき。

- **デプロイ前の状態に戻す**: 実行結果の Artifacts から `deploy-state`（`workers-state.json` と、カットオーバーまで進んでいれば `cutover-state.json`）をダウンロードし、
  ```bash
  pnpm install
  CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... \
    node scripts/cloudflare/rollback.mjs --workers-state ./workers-state.json --cutover-state ./cutover-state.json --if-exists
  ```
  各 Worker はそれぞれのアプリのディレクトリの wrangler で `wrangler rollback <version-id> --name <worker> --yes --message "deploy rollback"` を実行する（記録が複数バージョンの配分なら `wrangler versions deploy <id>@<n>% ... --name <worker> --yes`）。戻す先のあとに secret を入れていても、CI（非対話）では確認なしで強制し、そのバージョンの secret に戻る
- **1 つの Worker だけ戻す**: `cd apps/<app> && npx wrangler deployments list --name <worker>` で戻す先を確かめ、`npx wrangler rollback <version-id> --name <worker>`（household-auth と household-app は `HOUSEHOLD_CLIENT_SECRET` が食い違わないよう同じ時点に戻す）
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
| `preflight.mjs` | デプロイ前の確認（GitHub secret・Google の資格情報・API トークン） |
| `record-deployments.mjs` | 本番を変える前の各 Worker のデプロイの記録 |
| `ensure-secrets.mjs` | Worker の secret をそろえる（`--dry-run` あり。一覧が読めなければ失敗し、生成し直さない） |
| `upload-app-version.mjs` | household-app の `wrangler versions upload` とバージョン ID の取り出し |
| `cutover-routes.mjs` | カットオーバー（変更前の状態を記録してからルートと household-app を切り替える） |
| `rollback.mjs` | 記録した状態へのロールバック |
| `smoke-test.mjs` | 公開 URL のスモークテスト |

## うまくいかないとき

- プリフライトで Google に拒否される（`invalid_client`）: `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` が Google Cloud Console の OAuth クライアント（ウェブアプリケーション）の値と一致しているか確かめる。`redirect_uri_mismatch` なら承認済みのリダイレクト URI に `https://maronn-household-budget.com/api/auth/callback/google` を追加する
- スモークテストだけが失敗する: ログの NG の行に、どの URL が何を返したかが出る。`node scripts/cloudflare/smoke-test.mjs --attempts 1` で手元から同じ確認ができる
