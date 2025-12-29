# デプロイスクリプト

Cloudflare Workers と D1 データベースをセットアップ・デプロイするためのスクリプト集。

## 📦 スクリプト一覧

### `deploy.sh` - メインデプロイスクリプト

ビルド、D1セットアップ、Workersデプロイを一括で実行します。

**基本的な使い方:**

```bash
# 開発環境へデプロイ
pnpm deploy
# または
bash scripts/deploy.sh

# 本番環境へデプロイ
pnpm deploy:prod
# または
bash scripts/deploy.sh --env production

# クイックデプロイ（ビルドとDB設定をスキップ）
pnpm deploy:quick
# または
bash scripts/deploy.sh --skip-build --skip-db
```

**オプション:**

- `-e, --env <environment>` - デプロイ環境 (dev または production)
- `-s, --skip-db` - D1データベースのセットアップをスキップ
- `-b, --skip-build` - ビルドステップをスキップ
- `-h, --help` - ヘルプを表示

**実行内容:**

1. **ビルド** - TypeScriptのビルドと型チェック
2. **D1セットアップ** - データベース作成とマイグレーション実行
3. **Workersデプロイ** - Cloudflare Workersへデプロイ

### `setup-d1.sh` - D1データベースセットアップ

D1データベースの作成とマイグレーションのみを実行します。

**使い方:**

```bash
# 開発環境のD1をセットアップ
pnpm setup:d1
# または
bash scripts/setup-d1.sh dev

# 本番環境のD1をセットアップ
pnpm setup:d1:prod
# または
bash scripts/setup-d1.sh production
```

**実行内容:**

1. D1データベースの存在確認
2. 新規の場合、データベースを作成
3. `wrangler.toml` の `database_id` を自動更新
4. SQLマイグレーションファイルを実行
5. テーブル作成を確認

## 🚀 初回デプロイ手順

### 1. 前提条件

- [Cloudflare アカウント](https://dash.cloudflare.com/sign-up)
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/) のインストール
- Wrangler でログイン済み: `wrangler login`

### 2. 開発環境へデプロイ

```bash
# すべてを自動で実行
pnpm deploy:dev
```

これで以下が完了します:

- ✅ プロジェクトのビルド
- ✅ D1データベース `maronn-household` の作成
- ✅ テーブルのマイグレーション
- ✅ Workers のデプロイ

### 3. 本番環境へデプロイ

```bash
# 本番環境へデプロイ（確認プロンプトあり）
pnpm deploy:prod
```

これで別の本番用データベース `maronn-household-production` が作成されます。

## 🔧 個別タスクの実行

### D1データベースのみセットアップ

```bash
# 開発環境
pnpm setup:d1

# 本番環境
pnpm setup:d1:prod
```

### Workersのみデプロイ（D1設定済みの場合）

```bash
# 開発環境
cd packages/api
pnpm deploy

# 本番環境
cd packages/api
pnpm deploy:prod
```

### マイグレーションファイルを生成

スキーマ定義（`packages/api/src/db/schema.ts`）を変更した後、マイグレーションファイルを自動生成:

```bash
# ルートディレクトリから
pnpm db:generate

# または packages/api ディレクトリから
cd packages/api
pnpm db:generate
```

これにより `packages/api/drizzle/` ディレクトリに新しいマイグレーションファイルが生成されます。

### マイグレーションのみ実行

```bash
# ローカル（開発用）
pnpm db:migrate
# または
cd packages/api
pnpm db:migrate

# リモート（本番用）
pnpm db:migrate:prod
# または
cd packages/api
pnpm db:migrate:prod
```

## 📊 データベース管理

### マイグレーション開発のワークフロー

スキーマを変更してデータベースに反映させる手順:

```bash
# 1. スキーマを編集
nano packages/api/src/db/schema.ts

# 2. マイグレーションファイルを生成
pnpm db:generate

# 3. 生成されたマイグレーションを確認
cat packages/api/drizzle/*.sql

# 4. マイグレーションを実行
pnpm db:migrate

# 5. Drizzle Studio で確認
pnpm db:studio
```

### Drizzle Studio でデータを確認

```bash
# ルートディレクトリから
pnpm db:studio

# または packages/api ディレクトリから
cd packages/api
pnpm db:studio
```

ブラウザで `https://local.drizzle.studio` が開き、GUIでデータベースを操作できます。

### Drizzle Kit の便利なコマンド

```bash
# マイグレーションファイルを生成（スキーマ変更後）
pnpm db:generate

# マイグレーションの整合性チェック
cd packages/api
pnpm db:check

# スキーマを直接D1にプッシュ（開発時のみ推奨）
cd packages/api
pnpm db:push
```

**注意:**
- `db:push` はマイグレーションファイルを生成せず、スキーマを直接データベースに反映します
- 本番環境では必ず `db:generate` → `db:migrate:prod` の流れでマイグレーションを管理してください

### D1データベースにSQLクエリを実行

```bash
# ローカル（開発）
wrangler d1 execute maronn-household --local --command="SELECT * FROM users;"

# リモート（本番）
wrangler d1 execute maronn-household-production --remote --command="SELECT * FROM users;"
```

### D1データベースの一覧表示

```bash
wrangler d1 list
```

## 🔄 継続的デプロイ

コードを変更した後のデプロイ:

```bash
# D1設定は変更なし、コードのみ更新する場合
pnpm deploy:quick

# フルデプロイ（D1設定も含む）
pnpm deploy
```

## ⚠️ トラブルシューティング

### `database_id = "placeholder"` エラー

`wrangler.toml` の `database_id` が未設定の場合は、以下を実行:

```bash
pnpm setup:d1
```

### マイグレーションエラー

すでにテーブルが存在する場合、エラーが出ることがあります。
その場合は `--skip-db` オプションでD1セットアップをスキップしてデプロイ:

```bash
pnpm deploy:quick
```

### 本番環境の設定確認

`wrangler.toml` に本番環境のD1設定が追加されているか確認:

```bash
cat packages/api/wrangler.toml | grep -A 5 "env.production"
```

### ログ確認

デプロイ後のログをリアルタイムで確認:

```bash
# 開発環境
wrangler tail

# 本番環境
wrangler tail --env production
```

## 📁 ファイル構成

```
scripts/
├── deploy.sh          # メインデプロイスクリプト
├── setup-d1.sh        # D1セットアップスクリプト
└── README.md          # このファイル

packages/api/
├── wrangler.toml      # Cloudflare Workers設定
├── drizzle.config.ts  # Drizzle Kit設定
├── migrations/        # SQLマイグレーションファイル
│   └── 0001_init-tables.sql
└── src/db/
    └── schema.ts      # Drizzle ORM スキーマ定義
```

## 🔐 環境変数

環境変数が必要な場合は、`.env` ファイルまたは Cloudflare Dashboard で設定します。

```bash
# .env.example をコピー
cp packages/api/.env.example packages/api/.env

# 環境変数を編集
nano packages/api/.env
```

Cloudflare Dashboard での設定方法:

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン
2. Workers & Pages → あなたのWorker を選択
3. Settings → Variables → Add variable

## 📚 参考リンク

- [Cloudflare Workers ドキュメント](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 ドキュメント](https://developers.cloudflare.com/d1/)
- [Wrangler CLI リファレンス](https://developers.cloudflare.com/workers/wrangler/commands/)
- [Drizzle ORM ドキュメント](https://orm.drizzle.team/docs/overview)
