# 認証機能セットアップガイド

このガイドでは、BetterAuth + Auth0 + Supabase + Hyperdriveを使用した認証機能のセットアップ手順を説明します。

## アーキテクチャ概要

```
[Auth0] ← OAuth → [Better Auth] → [Hyperdrive] → [Supabase PostgreSQL]
                        ↓
                   [Cloudflare Workers]
```

- **Auth0**: OAuth認証プロバイダー（ユーザー認証を処理）
- **Better Auth**: 認証ライブラリ（Auth0とアプリを中継）
- **Supabase**: PostgreSQLデータベース（ユーザー・セッションデータを保存）
- **Hyperdrive**: Cloudflareのコネクションプーリング（低レイテンシ接続）

## 前提条件

- Cloudflareアカウント
- Auth0アカウント
- Supabaseアカウント

---

## 1. Supabaseプロジェクトの作成

### 1-1. プロジェクト作成

1. [Supabase Dashboard](https://supabase.com/dashboard)にログイン
2. 「New Project」をクリック
3. 以下を設定：
   - **Name**: `household-app` (任意)
   - **Database Password**: 強力なパスワードを設定（後で使用）
   - **Region**: `Tokyo (Northeast Asia)` (低レイテンシのため)
4. 「Create new project」をクリック

### 1-2. 接続文字列の取得

1. プロジェクトダッシュボード → **Settings** → **Database**
2. **Connection string** セクションで **Direct connection** を選択
3. 接続文字列をコピー（以下の形式）:
   ```
   postgresql://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT-REF].supabase.co:5432/postgres
   ```
4. `.env` ファイルに保存:
   ```bash
   DATABASE_URL="postgresql://postgres:YOUR-PASSWORD@db.YOUR-PROJECT-REF.supabase.co:5432/postgres"
   ```

### 1-3. データベースマイグレーション

```bash
cd apps/household-app

# マイグレーションファイルを生成
pnpm drizzle:generate

# Supabaseに接続してマイグレーションを実行
# 注意: これはローカルから直接Supabaseに接続します
npx drizzle-kit migrate
```

マイグレーションにより、以下のテーブルが作成されます：
- `user` - ユーザー情報
- `session` - セッション情報
- `account` - OAuth アカウント情報
- `verification` - メール認証情報
- `expenses` - 支出データ
- `budgets` - 予算データ

---

## 2. Cloudflare Hyperdriveの設定

Hyperdriveは、PostgreSQLへの接続を最適化し、コネクションプーリングとクエリキャッシングを提供します。

### 2-1. Hyperdriveの作成

```bash
cd apps/household-app

# Hyperdriveを作成
wrangler hyperdrive create household-db \
  --connection-string="postgresql://postgres:YOUR-PASSWORD@db.YOUR-PROJECT-REF.supabase.co:5432/postgres"
```

**出力例**:
```
✨ Created new Hyperdrive config
 {
   id = "a76a99bc715a4f7d9c1254ec76f4e0c8",
   name = "household-db",
   ...
 }
```

### 2-2. Hyperdrive IDの設定

`wrangler.jsonc` の `YOUR_HYPERDRIVE_ID_HERE` を、上記コマンドで取得した`id`に置き換えます:

```jsonc
{
  "hyperdrive": [
    {
      "binding": "HYPERDRIVE",
      "id": "a76a99bc715a4f7d9c1254ec76f4e0c8"  // ここを更新
    }
  ]
}
```

---

## 3. Auth0アプリケーションの作成

### 3-1. Auth0アプリケーションの設定

1. [Auth0 Dashboard](https://manage.auth0.com/)にログイン
2. **Applications** → **Create Application**
3. 以下を設定：
   - **Name**: `Household App`
   - **Application Type**: `Regular Web Application`
4. **Settings** タブで以下を設定：

   **Allowed Callback URLs**:
   ```
   http://localhost:5173/api/auth/callback/auth0
   https://your-app.pages.dev/api/auth/callback/auth0
   ```

   **Allowed Logout URLs**:
   ```
   http://localhost:5173
   https://your-app.pages.dev
   ```

   **Allowed Web Origins**:
   ```
   http://localhost:5173
   https://your-app.pages.dev
   ```

5. **Save Changes** をクリック

### 3-2. 認証情報の取得

**Settings** タブから以下をコピー:
- **Domain**: `your-tenant.auth0.com`
- **Client ID**: `xxxxxxxxxxxxxxxxxxxx`
- **Client Secret**: `yyyyyyyyyyyyyyyyyyyy`

`.env` ファイルに追加:
```bash
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_CLIENT_ID="xxxxxxxxxxxxxxxxxxxx"
AUTH0_CLIENT_SECRET="yyyyyyyyyyyyyyyyyyyy"
```

---

## 4. Better Auth シークレットの生成

Better Authはセッションの暗号化に使用するシークレットが必要です。

```bash
# ランダムな文字列を生成（32文字以上推奨）
openssl rand -base64 32
```

`.env` ファイルに追加:
```bash
BETTER_AUTH_SECRET="生成されたランダム文字列"
BETTER_AUTH_URL="http://localhost:5173"
```

---

## 5. 環境変数の設定

### 5-1. ローカル開発用 (`.env`)

`.env.example` をコピーして `.env` を作成し、以下を設定:

```bash
# Supabase接続（マイグレーション用）
DATABASE_URL="postgresql://postgres:YOUR-PASSWORD@db.YOUR-PROJECT-REF.supabase.co:5432/postgres"

# Auth0
AUTH0_DOMAIN="your-tenant.auth0.com"
AUTH0_CLIENT_ID="your-client-id"
AUTH0_CLIENT_SECRET="your-client-secret"

# Better Auth
BETTER_AUTH_SECRET="your-random-secret"
BETTER_AUTH_URL="http://localhost:5173"

# Hyperdrive ID
HYPERDRIVE_ID="your-hyperdrive-id"
```

### 5-2. 本番環境用 (`wrangler.jsonc`)

`wrangler.jsonc` の `vars` セクションを更新:

```jsonc
{
  "vars": {
    "AUTH0_DOMAIN": "your-tenant.auth0.com",
    "AUTH0_CLIENT_ID": "your-client-id",
    "AUTH0_CLIENT_SECRET": "your-client-secret",
    "BETTER_AUTH_SECRET": "your-random-secret",
    "BETTER_AUTH_URL": "https://your-app.pages.dev"
  }
}
```

**⚠️ セキュリティ注意**:
- `wrangler.jsonc` に機密情報を直接記載しないでください
- 本番環境では Cloudflare Dashboard の環境変数設定を使用してください

---

## 6. 動作確認

### 6-1. ローカル開発サーバーの起動

```bash
cd apps/household-app
pnpm dev
```

### 6-2. 認証フローのテスト

1. ブラウザで `http://localhost:5173` を開く
2. 右上の「Auth0でログイン」ボタンをクリック
3. Auth0のログイン画面にリダイレクトされる
4. 認証情報を入力してログイン
5. アプリにリダイレクトされ、右上にユーザー名が表示される
6. `/household` ページで支出を記録できることを確認

### 6-3. データベースの確認

Supabase Dashboardで以下を確認:

1. **Database** → **Table Editor** → **user** テーブル
2. ログインしたユーザーが登録されているか確認
3. **session** テーブルでセッション情報を確認

---

## 7. 本番環境へのデプロイ

### 7-1. Cloudflare Pagesへのデプロイ

```bash
cd apps/household-app

# ビルド & デプロイ
pnpm deploy
```

### 7-2. 環境変数の設定（Cloudflare Dashboard）

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン
2. **Workers & Pages** → **household-app** を選択
3. **Settings** → **Environment variables** を開く
4. 以下の環境変数を追加:
   - `AUTH0_DOMAIN`
   - `AUTH0_CLIENT_ID`
   - `AUTH0_CLIENT_SECRET`
   - `BETTER_AUTH_SECRET`
   - `BETTER_AUTH_URL` (本番環境のURL)

5. **Save** をクリックして再デプロイ

---

## トラブルシューティング

### エラー: "Database connection not available"

**原因**: Hyperdriveの設定が正しくないか、`wrangler.jsonc` のHyperdrive IDが間違っています。

**解決策**:
```bash
# Hyperdriveの一覧を確認
wrangler hyperdrive list

# wrangler.jsonc のIDを確認して修正
```

### エラー: "UNAUTHORIZED" (tRPCエラー)

**原因**: ログインしていないユーザーが認証保護されたエンドポイントにアクセスしています。

**解決策**:
- Auth0でログインしてください
- ブラウザのCookieをクリアして再度ログイン

### Auth0ログイン後にエラー

**原因**: Callback URLが正しく設定されていません。

**解決策**:
1. Auth0 Dashboard → Application Settings
2. **Allowed Callback URLs** に正しいURLが設定されているか確認
3. URLの末尾に `/api/auth/callback/auth0` が含まれているか確認

### Hyperdriveタイムアウト

**原因**: Supabaseへの接続が遅い、またはSupabaseのリージョンが遠い。

**解決策**:
1. Supabaseプロジェクトのリージョンを確認（日本からなら Tokyo推奨）
2. Hyperdriveの設定を確認:
   ```bash
   wrangler hyperdrive get household-db
   ```

---

## 参考資料

- [Better Auth Documentation](https://www.better-auth.com/)
- [Cloudflare Hyperdrive Documentation](https://developers.cloudflare.com/hyperdrive/)
- [Supabase Documentation](https://supabase.com/docs)
- [Auth0 Documentation](https://auth0.com/docs)
- [Drizzle ORM Documentation](https://orm.drizzle.team/)

---

## セキュリティのベストプラクティス

1. **機密情報を Git にコミットしない**
   - `.env` ファイルを `.gitignore` に追加
   - `wrangler.jsonc` に機密情報を直接記載しない

2. **強力なパスワードを使用**
   - Supabase DBパスワード: 32文字以上
   - Better Auth Secret: 32文字以上のランダム文字列

3. **本番環境の環境変数**
   - Cloudflare Dashboard の Environment Variables を使用
   - シークレットは暗号化される

4. **Auth0のセキュリティ設定**
   - Allowed URLs を本番環境のみに制限
   - Multi-Factor Authentication (MFA) を有効化（推奨）

---

## 次のステップ

認証機能が動作したら、以下の機能拡張を検討してください：

1. **プロフィール編集機能**: ユーザー名やアバター画像の変更
2. **メール認証**: Email/Passwordログインの追加
3. **多要素認証 (MFA)**: セキュリティ強化
4. **セッション管理**: 複数デバイスからのログイン管理
5. **ロール・権限管理**: 管理者と一般ユーザーの区別

---

質問や問題がある場合は、GitHubのIssuesで報告してください。
