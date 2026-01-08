# delete-no-user-household-data-cron

期限切れセッションを自動削除するCloudflare Workers Cronジョブ

## 概要

このWorkerは、外部データベース（Supabase）の`session`テーブルから、`expires_at`が現在時刻（UTC）から3日以上経過したセッションを削除します。

### 実装アプローチ

このCronジョブは、生のSQLクエリ（`postgres`パッケージ）を使用してセッションを削除します。これにより:

- ORM（Drizzle）の依存関係競合を回避
- シンプルで理解しやすいコード
- PostgreSQLの最適化されたバッチ削除を活用

セッションテーブルのスキーマは`@maronn-household/db-schema`パッケージで一元管理されており、複数のアプリケーション間で共有されています。

## 実行スケジュール

- **実行時刻**: UTC 20:00（日本時間 05:00）
- **実行頻度**: 毎日

## 主な機能

- UTC基準で期限切れから3日経過したセッションを削除
- バッチ処理（100件ずつ）でCPUレートリミットを回避
- 各バッチ間に100msの待機時間を設けて負荷を分散
- 詳細なログ出力で削除状況を追跡

## セットアップ

### 1. 依存関係のインストール

```bash
cd apps/delete-no-user-household-data-cron
pnpm install
```

### 2. DATABASE_URLシークレットの設定

Supabaseの接続URLをシークレットとして設定します：

```bash
# 本番環境
wrangler secret put DATABASE_URL

# プロンプトが表示されたら、Supabaseの接続URLを入力
# 例: postgresql://user:password@db.xxxxxxxxxxxx.supabase.co:5432/postgres
```

### 3. 型定義の生成（オプション）

```bash
pnpm run cf-typegen
```

## ローカルでのテスト

### 開発サーバーの起動

```bash
pnpm dev
```

### Cronトリガーのテスト

別のターミナルで以下を実行：

```bash
curl "http://localhost:8787/__scheduled?cron=0+20+*+*+*"
```

## デプロイ

```bash
pnpm run deploy
```

## 動作確認

デプロイ後、Cloudflareダッシュボードで以下を確認できます：

1. **Cronトリガーの実行履歴**: Workers & Pages > delete-no-user-household-data-cron > Logs
2. **削除されたセッション数**: ログに `Successfully deleted X expired sessions` と表示されます

## 設定のカスタマイズ

`src/index.ts` の以下の定数を変更することで動作をカスタマイズできます：

```typescript
const BATCH_SIZE = 100;        // 1回のバッチで削除する最大件数
const BATCH_DELAY_MS = 100;    // バッチ間の待機時間（ミリ秒）
const EXPIRY_DAYS = 3;         // 期限切れとみなす日数
```

実行スケジュールを変更する場合は、`wrangler.jsonc` の `triggers.crons` を編集してください：

```jsonc
"triggers": {
  "crons": [
    "0 20 * * *"  // 分 時 日 月 曜日（UTC）
  ]
}
```

## トラブルシューティング

### DATABASE_URLが設定されていない

ログに以下のエラーが表示される場合：

```
DATABASE_URL is not set. Please set it using: wrangler secret put DATABASE_URL
```

解決方法：

```bash
wrangler secret put DATABASE_URL
```

### 接続エラー

データベース接続に失敗する場合：

1. DATABASE_URLが正しいことを確認
2. SupabaseのIPホワイトリストにCloudflare Workersが含まれているか確認
3. SSL接続が有効になっているか確認

### CPU時間超過

大量のセッションを削除する際にCPU時間制限に達する場合：

- `BATCH_SIZE` を小さくする（例: 50）
- `BATCH_DELAY_MS` を大きくする（例: 200）

## 参考リンク

- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/)
- [Wrangler Configuration](https://developers.cloudflare.com/workers/wrangler/configuration/)
- [Drizzle ORM PostgreSQL](https://orm.drizzle.team/docs/get-started-postgresql)
