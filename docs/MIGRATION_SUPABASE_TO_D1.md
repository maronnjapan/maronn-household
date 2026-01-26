# Supabase から Cloudflare D1 への移行手順

このドキュメントでは、認証データ（user, session, account, verification）を Supabase (PostgreSQL) から Cloudflare D1 (SQLite) に移行する手順を説明します。

## 前提条件

- Supabase プロジェクトへのアクセス権限
- Cloudflare アカウントと D1 データベースの設定済み
- Supabase CLI がインストールされていること（`npm install -g supabase`）
- Wrangler CLI がインストールされていること

## 移行の概要

1. Supabase から認証データをエクスポート
2. D1 に認証テーブルのマイグレーションを適用
3. データを変換（PostgreSQL → SQLite 形式）
4. D1 にデータをインポート
5. 動作確認

## 手順

### 1. D1 マイグレーションの適用

まず、D1 に認証テーブルを作成します。

```bash
# ローカルでテスト
pnpm --filter household-app drizzle:migrate

# リモート（本番）に適用
pnpm --filter household-app drizzle:migrate:remote
```

### 2. Supabase からデータをエクスポート

Supabase CLI または psql を使用してデータをエクスポートします。

#### 方法A: psql を使用（推奨）

```bash
# 環境変数に Supabase 接続文字列を設定
export SUPABASE_DB_URL="postgresql://postgres:[PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"

# 各テーブルをCSVでエクスポート
psql "$SUPABASE_DB_URL" -c "\COPY (SELECT id, name, email, email_verified, image, created_at, updated_at FROM \"user\") TO 'user_export.csv' WITH CSV HEADER"

psql "$SUPABASE_DB_URL" -c "\COPY (SELECT id, expires_at, token, created_at, updated_at, ip_address, user_agent, user_id FROM session) TO 'session_export.csv' WITH CSV HEADER"

psql "$SUPABASE_DB_URL" -c "\COPY (SELECT id, account_id, provider_id, user_id, access_token, refresh_token, id_token, access_token_expires_at, refresh_token_expires_at, scope, password, created_at, updated_at FROM account) TO 'account_export.csv' WITH CSV HEADER"

psql "$SUPABASE_DB_URL" -c "\COPY (SELECT id, identifier, value, expires_at, created_at, updated_at FROM verification) TO 'verification_export.csv' WITH CSV HEADER"
```

#### 方法B: Supabase Dashboard を使用

1. Supabase Dashboard にログイン
2. Table Editor で各テーブルを選択
3. Export to CSV をクリック

### 3. データの変換

PostgreSQL の timestamp 型は SQLite では text（ISO 8601 形式）として保存されます。
通常、PostgreSQL からエクスポートした timestamp はそのまま使用可能ですが、フォーマットに問題がある場合は以下のスクリプトで変換してください。

```javascript
// convert-timestamps.js
const fs = require('fs');
const csv = require('csv-parser');
const { stringify } = require('csv-stringify/sync');

const inputFile = process.argv[2];
const outputFile = process.argv[3];

const rows = [];

fs.createReadStream(inputFile)
  .pipe(csv())
  .on('data', (row) => {
    // timestamp カラムを ISO 8601 形式に変換
    for (const key of Object.keys(row)) {
      if (key.includes('_at') && row[key]) {
        const date = new Date(row[key]);
        if (!isNaN(date.getTime())) {
          row[key] = date.toISOString();
        }
      }
    }
    // boolean を integer に変換 (email_verified)
    if ('email_verified' in row) {
      row.email_verified = row.email_verified === 'true' || row.email_verified === 't' ? 1 : 0;
    }
    rows.push(row);
  })
  .on('end', () => {
    const output = stringify(rows, { header: true });
    fs.writeFileSync(outputFile, output);
    console.log(`Converted ${rows.length} rows to ${outputFile}`);
  });
```

### 4. D1 へのデータインポート

#### 方法A: Wrangler D1 execute を使用

CSVデータをSQLのINSERT文に変換してインポートします。

```bash
# インポート用SQLファイルを作成
# (CSVをINSERT文に変換するスクリプトを使用)

# ローカルD1にインポート
wrangler d1 execute household-db --local --file=import_data.sql

# リモートD1にインポート
wrangler d1 execute household-db --remote --file=import_data.sql
```

#### 方法B: D1 REST API を使用

大量のデータがある場合は、D1 の REST API を使用してバッチインポートを行います。

```javascript
// import-to-d1.js
const fs = require('fs');
const csv = require('csv-parser');

async function importTable(tableName, csvFile, accountId, databaseId, apiToken) {
  const rows = [];

  return new Promise((resolve, reject) => {
    fs.createReadStream(csvFile)
      .pipe(csv())
      .on('data', (row) => rows.push(row))
      .on('end', async () => {
        // バッチサイズを設定（D1の制限に合わせる）
        const batchSize = 100;

        for (let i = 0; i < rows.length; i += batchSize) {
          const batch = rows.slice(i, i + batchSize);
          const columns = Object.keys(batch[0]);
          const placeholders = columns.map(() => '?').join(', ');

          const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES (${placeholders})`;

          for (const row of batch) {
            const values = columns.map(col => row[col] || null);

            const response = await fetch(
              `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`,
              {
                method: 'POST',
                headers: {
                  'Authorization': `Bearer ${apiToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  sql,
                  params: values,
                }),
              }
            );

            if (!response.ok) {
              console.error(`Failed to insert row:`, await response.text());
            }
          }

          console.log(`Imported ${Math.min(i + batchSize, rows.length)} / ${rows.length} rows`);
        }

        resolve();
      })
      .on('error', reject);
  });
}

// 使用例
// node import-to-d1.js
```

### 5. インポート順序

外部キー制約があるため、以下の順序でインポートしてください：

1. `user` テーブル（他のテーブルから参照される）
2. `session` テーブル（user_id を参照）
3. `account` テーブル（user_id を参照）
4. `verification` テーブル（独立）

### 6. 動作確認

```bash
# D1 のデータを確認
wrangler d1 execute household-db --remote --command="SELECT COUNT(*) FROM user"
wrangler d1 execute household-db --remote --command="SELECT COUNT(*) FROM session"
wrangler d1 execute household-db --remote --command="SELECT COUNT(*) FROM account"
wrangler d1 execute household-db --remote --command="SELECT COUNT(*) FROM verification"

# アプリケーションの動作確認
# 1. ログイン機能が動作すること
# 2. セッションが正しく維持されること
# 3. パスワードリセットが動作すること
```

### 7. 移行後のクリーンアップ

移行が完了し、動作確認が済んだら：

1. Supabase の Hyperdrive 設定を削除（既に wrangler.jsonc から削除済み）
2. Supabase プロジェクトを削除（必要に応じて）
3. `DATABASE_URL` シークレットを Cloudflare Workers から削除
   ```bash
   wrangler secret delete DATABASE_URL
   ```

## トラブルシューティング

### セッションが無効になる

- timestamp の形式が正しいか確認してください（ISO 8601 形式）
- `expires_at` が未来の日時であることを確認してください

### ログインできない

- `account` テーブルの `password` カラムが正しく移行されているか確認
- ハッシュ化されたパスワードがそのまま移行されている必要があります

### 外部キー制約エラー

- インポート順序が正しいか確認してください（user → session/account → verification）
- 参照先のユーザーが存在することを確認してください

## 注意事項

- **バックアップ**: 移行前に必ず Supabase のバックアップを取得してください
- **ダウンタイム**: 移行中はアプリケーションを一時停止することを推奨します
- **セッション**: 既存セッションは移行後も有効ですが、安全のため全ユーザーに再ログインを促すことも検討してください
