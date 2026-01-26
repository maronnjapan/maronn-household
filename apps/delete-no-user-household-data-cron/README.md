# delete-no-user-household-data-cron

孤立した家計データを自動削除するCloudflare Workers Cronジョブ

## 概要

このWorkerは、D1データベースの`user`テーブルに存在しないユーザーの家計データ（expenses, budgets）を削除します。
ユーザーアカウントが削除された後に残った孤立データをクリーンアップするために使用します。

### 実装アプローチ

このCronジョブは、D1のネイティブAPIを使用してデータを処理します。これにより:

- 単一のD1データベースで認証・家計データ両方を管理
- エッジでの高速な処理
- json_eachを使用した効率的なバッチ削除

## 実行スケジュール

- **実行時刻**: UTC 20:00（日本時間 05:00）
- **実行頻度**: 毎日

## 主な機能

- userテーブルに存在しないユーザーの家計データを検出
- expenses, budgetsテーブルから孤立データを削除
- json_eachを使用した効率的なバッチ削除
- 詳細なログ出力で削除状況を追跡

## 処理フロー

1. D1の`user`テーブルから全ユーザーIDを取得
2. `expenses`と`budgets`テーブルから全ユーザーIDを取得
3. userテーブルに存在しない孤立user_idを特定
4. 孤立データをバッチ削除

## セットアップ

### 1. 依存関係のインストール

```bash
cd apps/delete-no-user-household-data-cron
pnpm install
```

### 2. D1バインディングの確認

`wrangler.jsonc` でD1データベースバインディングが設定されていることを確認:

```jsonc
"d1_databases": [
  {
    "binding": "DB",
    "database_name": "household-db",
    "database_id": "91552f81-4280-49ed-b9f0-5534d41a0a34"
  }
]
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
2. **削除されたデータ数**: ログに `Successfully deleted X expenses and Y budgets from Z orphaned users` と表示されます

## 設定のカスタマイズ

実行スケジュールを変更する場合は、`wrangler.jsonc` の `triggers.crons` を編集してください：

```jsonc
"triggers": {
  "crons": [
    "0 20 * * *"  // 分 時 日 月 曜日（UTC）
  ]
}
```

## トラブルシューティング

### D1バインディングが設定されていない

ログに以下のエラーが表示される場合：

```
D1 database binding (DB) is not configured
```

解決方法：`wrangler.jsonc` でD1バインディングが正しく設定されているか確認してください。

### userテーブルが存在しない

認証テーブルのマイグレーションが適用されていない可能性があります：

```bash
pnpm --filter household-app drizzle:migrate:remote
```

## 参考リンク

- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/platform/triggers/cron-triggers/)
- [Cloudflare D1](https://developers.cloudflare.com/d1/)
