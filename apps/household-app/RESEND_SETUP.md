# Resend メール送信機能の設定手順

お問い合わせページからのメール送信機能を有効にするため、Resend の設定が必要です。

## 1. Resend アカウントの作成

1. [Resend](https://resend.com) にアクセス
2. 無料アカウントを作成（月3,000通まで無料）
3. ログイン後、ダッシュボードにアクセス

## 2. ドメインの認証

お問い合わせメールを自前のドメインから送信するため、ドメイン認証が必要です。

### 2-1. ドメインの追加

1. Resend ダッシュボードで「Domains」タブをクリック
2. 「Add Domain」ボタンをクリック
3. 送信に使用するドメインを入力（例: `yourdomain.com`）

### 2-2. DNS レコードの設定

Resend が提供する DNS レコードを、ドメインの DNS 設定に追加します。

**必要な DNS レコード:**

| タイプ | ホスト名 | 値 |
|--------|----------|-----|
| TXT | @ または yourdomain.com | `v=spf1 include:_spf.resend.com ~all` |
| CNAME | resend._domainkey | `resend._domainkey.resend.com` |
| MX | @ または yourdomain.com | `feedback-smtp.resend.com` (優先度: 10) |

**DNS 設定例（Cloudflare の場合）:**

1. Cloudflare ダッシュボードにログイン
2. 該当ドメインを選択
3. 「DNS」タブをクリック
4. 「レコードを追加」から上記のレコードを追加

**注意:** DNS の反映には最大48時間かかる場合がありますが、通常は数分～数時間で完了します。

### 2-3. ドメイン認証の確認

1. Resend ダッシュボードの「Domains」ページに戻る
2. 追加したドメインの横に「Verified」と表示されるまで待つ
3. 「Verify」ボタンを押すと手動で確認可能

## 3. API キーの取得

1. Resend ダッシュボードで「API Keys」タブをクリック
2. 「Create API Key」ボタンをクリック
3. キー名を入力（例: `household-app-production`）
4. 権限は「Full Access」を選択（メール送信に必要）
5. 「Create」をクリック
6. 表示された API キーをコピー（**このキーは一度しか表示されません**）

## 4. 環境変数の設定

### ローカル開発環境

1. `.dev.vars.example` をコピーして `.dev.vars` を作成

```bash
cd apps/household-app
cp .dev.vars.example .dev.vars
```

2. `.dev.vars` を編集して以下を設定

```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
CONTACT_EMAIL_TO=your-email@example.com
CONTACT_EMAIL_FROM=noreply@yourdomain.com
```

**各環境変数の説明:**

- `RESEND_API_KEY`: Resend ダッシュボードで取得した API キー
- `CONTACT_EMAIL_TO`: お問い合わせを受け取るメールアドレス（任意のアドレス）
- `CONTACT_EMAIL_FROM`: 送信元メールアドレス（**認証済みドメインのアドレス**である必要あり）

**CONTACT_EMAIL_FROM の注意事項:**

- Resend で認証したドメインのメールアドレスを使用してください
- 例: `yourdomain.com` を認証した場合 → `noreply@yourdomain.com`, `contact@yourdomain.com` など
- 認証していないドメインのアドレスを使用するとメール送信に失敗します

### 本番環境（Cloudflare Workers）

Cloudflare Workers に環境変数をセキュアに設定します。

```bash
cd apps/household-app

# API キーを設定
wrangler secret put RESEND_API_KEY
# プロンプトが表示されたら API キーを入力

# 受信先メールアドレスを設定
wrangler secret put CONTACT_EMAIL_TO
# プロンプトが表示されたら受信先アドレスを入力

# 送信元メールアドレスを設定
wrangler secret put CONTACT_EMAIL_FROM
# プロンプトが表示されたら送信元アドレスを入力
```

**または Cloudflare Dashboard で設定:**

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) にログイン
2. 「Workers & Pages」をクリック
3. `household-app` を選択
4. 「Settings」タブ → 「Variables」セクション
5. 「Add variable」から環境変数を追加

## 5. 動作確認

### ローカル環境でテスト

1. 開発サーバーを起動

```bash
pnpm dev
```

2. ブラウザで `http://localhost:5173/contact` にアクセス
3. お問い合わせフォームに入力して送信
4. `CONTACT_EMAIL_TO` に設定したメールアドレスにメールが届くことを確認

### 本番環境でテスト

1. アプリをデプロイ

```bash
pnpm deploy
```

2. 本番環境の URL で `/contact` ページにアクセス
3. フォームを送信してメールが届くことを確認

## トラブルシューティング

### メールが送信されない

1. **環境変数の確認**
   - `.dev.vars` または Cloudflare Workers の環境変数が正しく設定されているか確認
   - API キーに誤字脱字がないか確認

2. **ドメイン認証の確認**
   - Resend ダッシュボードでドメインが「Verified」になっているか確認
   - DNS レコードが正しく設定されているか確認

3. **送信元アドレスの確認**
   - `CONTACT_EMAIL_FROM` が認証済みドメインのアドレスになっているか確認
   - 認証していないドメインのアドレスを使用していないか確認

4. **API キーの権限確認**
   - API キーが「Full Access」権限で作成されているか確認

5. **Resend のログを確認**
   - Resend ダッシュボードの「Logs」タブでエラー詳細を確認

### メールが届かない

1. **迷惑メールフォルダを確認**
   - 受信トレイではなく迷惑メールフォルダに振り分けられていないか確認

2. **SPF/DKIM の設定確認**
   - DNS レコードが正しく設定されているか再確認
   - [MXToolbox](https://mxtoolbox.com/) でドメインの SPF/DKIM を検証

3. **送信履歴の確認**
   - Resend ダッシュボードの「Emails」タブで送信ステータスを確認

## 参考リンク

- [Resend 公式ドキュメント](https://resend.com/docs)
- [Resend API リファレンス](https://resend.com/docs/api-reference)
- [ドメイン認証ガイド](https://resend.com/docs/dashboard/domains/introduction)
- [Cloudflare Workers での使用方法](https://resend.com/docs/send-with-cloudflare-workers)
