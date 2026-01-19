# AWS SES メール送信機能の設定手順

お問い合わせページからのメール送信機能を有効にするため、AWS SES (Simple Email Service) の設定が必要です。

## 1. AWS アカウントの作成

1. [AWS](https://aws.amazon.com/) にアクセス
2. AWS アカウントを作成（既存のアカウントがあればログイン）
3. AWS Management Console にアクセス

## 2. AWS SES の初期設定

### 2-1. SES サービスへのアクセス

1. AWS Management Console で「SES」を検索
2. 「Amazon Simple Email Service」を選択
3. 利用するリージョンを選択（例: `us-east-1` (バージニア北部)）
   - **重要**: リージョンは後で環境変数 `AWS_REGION` に設定します

### 2-2. メールアドレスまたはドメインの検証

AWS SES では、送信元として使用するメールアドレスまたはドメインを事前に検証する必要があります。

#### オプション A: 個別のメールアドレスを検証（簡単）

1. SES コンソールで「Verified identities」をクリック
2. 「Create identity」ボタンをクリック
3. 「Email address」を選択
4. 送信元として使用するメールアドレスを入力（例: `noreply@yourdomain.com`）
5. 「Create identity」をクリック
6. 入力したメールアドレス宛に検証メールが届くので、リンクをクリックして検証完了

#### オプション B: ドメイン全体を検証（推奨）

1. SES コンソールで「Verified identities」をクリック
2. 「Create identity」ボタンをクリック
3. 「Domain」を選択
4. ドメイン名を入力（例: `yourdomain.com`）
5. 「Use a custom MAIL FROM domain」はオプション（設定すると送信元の信頼性が向上）
6. 「Create identity」をクリック
7. 表示される CNAME レコードをドメインの DNS 設定に追加

**必要な DNS レコード例:**

| タイプ | 名前 | 値 |
|--------|------|-----|
| CNAME | _amazonses.yourdomain.com | xxxxxxxxxxxxx.dkim.amazonses.com |
| TXT | @ または yourdomain.com | "amazonses:xxxxxxxxxxxxx" |

**Cloudflare での DNS 設定例:**

1. Cloudflare ダッシュボードにログイン
2. 該当ドメインを選択
3. 「DNS」タブをクリック
4. 「レコードを追加」から上記のレコードを追加
5. SES コンソールに戻り、検証が完了するまで待つ（通常数分～数時間）

### 2-3. サンドボックスモードの解除（本番運用時）

AWS SES は初期状態では「サンドボックスモード」で動作します。このモードでは以下の制限があります:

- **検証済みメールアドレスにのみ送信可能**
- 送信数制限: 1日200通、1秒あたり1通

本番運用では制限を解除する必要があります。

**サンドボックス解除手順:**

1. SES コンソールで「Account dashboard」をクリック
2. 「Request production access」ボタンをクリック
3. フォームに以下を入力:
   - **Mail type**: Transactional
   - **Website URL**: アプリの URL
   - **Use case description**: お問い合わせフォームからのメール送信など、用途を説明
   - **Expected sending rate**: 予想される送信数
4. 送信後、AWS サポートからの承認を待つ（通常24時間以内）

**開発・テスト段階ではサンドボックスモードのままで問題ありません。** 受信先メールアドレス（`CONTACT_EMAIL_TO`）も検証しておけば、テスト送信が可能です。

## 3. IAM ユーザーとアクセスキーの作成

メール送信に必要な認証情報（アクセスキー）を作成します。

### 3-1. IAM ユーザーの作成

1. AWS Management Console で「IAM」を検索
2. 「Users」→「Create user」をクリック
3. ユーザー名を入力（例: `household-app-ses-user`）
4. 「Next」をクリック

### 3-2. SES 送信権限の付与

1. 「Attach policies directly」を選択
2. 「AmazonSESFullAccess」を検索して選択
   - より厳格な権限設定が必要な場合は、カスタムポリシーを作成:
     ```json
     {
       "Version": "2012-10-17",
       "Statement": [
         {
           "Effect": "Allow",
           "Action": [
             "ses:SendEmail",
             "ses:SendRawEmail"
           ],
           "Resource": "*"
         }
       ]
     }
     ```
3. 「Next」→「Create user」をクリック

### 3-3. アクセスキーの作成

1. 作成したユーザーをクリック
2. 「Security credentials」タブを選択
3. 「Create access key」をクリック
4. 「Application running outside AWS」を選択
5. 「Next」→「Create access key」をクリック
6. **Access key ID** と **Secret access key** をコピー
   - **重要**: Secret access key は一度しか表示されないため、必ず保存してください

## 4. 環境変数の設定

### ローカル開発環境

1. `.dev.vars.example` をコピーして `.dev.vars` を作成

```bash
cd apps/household-app
cp .dev.vars.example .dev.vars
```

2. `.dev.vars` を編集して以下を設定

```bash
AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
AWS_REGION=us-east-1
CONTACT_EMAIL_TO=your-email@example.com
CONTACT_EMAIL_FROM=noreply@yourdomain.com
```

**各環境変数の説明:**

- `AWS_ACCESS_KEY_ID`: IAM ユーザーのアクセスキー ID
- `AWS_SECRET_ACCESS_KEY`: IAM ユーザーのシークレットアクセスキー
- `AWS_REGION`: SES を利用するリージョン（例: `us-east-1`, `ap-northeast-1`）
- `CONTACT_EMAIL_TO`: お問い合わせを受け取るメールアドレス（任意のアドレス、サンドボックスモードでは検証済みアドレスのみ）
- `CONTACT_EMAIL_FROM`: 送信元メールアドレス（**SES で検証済み**のアドレスである必要あり）

**CONTACT_EMAIL_FROM の注意事項:**

- SES で検証したメールアドレスまたはドメインのアドレスを使用してください
- 検証していないアドレスを使用するとメール送信に失敗します

### 本番環境（Cloudflare Workers）

Cloudflare Workers に環境変数をセキュアに設定します。

```bash
cd apps/household-app

# AWS アクセスキー ID を設定
wrangler secret put AWS_ACCESS_KEY_ID
# プロンプトが表示されたらアクセスキー ID を入力

# AWS シークレットアクセスキーを設定
wrangler secret put AWS_SECRET_ACCESS_KEY
# プロンプトが表示されたらシークレットアクセスキーを入力

# AWS リージョンを設定
wrangler secret put AWS_REGION
# プロンプトが表示されたらリージョン（例: us-east-1）を入力

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
   - アクセスキーに誤字脱字がないか確認

2. **送信元アドレスの確認**
   - `CONTACT_EMAIL_FROM` が SES で検証済みのアドレスになっているか確認
   - SES コンソールの「Verified identities」で検証状態を確認

3. **サンドボックスモードの確認**
   - サンドボックスモードの場合、`CONTACT_EMAIL_TO` も検証済みアドレスである必要があります
   - SES コンソールで受信先アドレスも検証してください

4. **IAM 権限の確認**
   - IAM ユーザーに SES の送信権限が付与されているか確認
   - `AmazonSESFullAccess` または `ses:SendEmail` 権限があるか確認

5. **リージョンの確認**
   - `AWS_REGION` が SES で設定したリージョンと一致しているか確認

6. **CloudWatch Logs で確認**
   - AWS CloudWatch で SES のログを確認
   - エラーメッセージから原因を特定

### メールが届かない

1. **迷惑メールフォルダを確認**
   - 受信トレイではなく迷惑メールフォルダに振り分けられていないか確認

2. **DNS 設定の確認**
   - ドメイン検証の場合、DNS レコードが正しく設定されているか確認
   - [MXToolbox](https://mxtoolbox.com/) でドメインの SPF/DKIM を検証

3. **SES の送信統計を確認**
   - SES コンソールの「Sending statistics」で送信ステータスを確認
   - バウンス率や苦情率が高いとアカウントが制限される可能性があります

4. **送信制限の確認**
   - サンドボックスモードの場合、1日200通、1秒あたり1通の制限があります
   - 制限を超えていないか確認

## AWS SES の料金

AWS SES は従量課金制です。

- **送信料金**: $0.10 / 1,000通
- **受信料金**: $0.10 / 1,000通（受信機能を使用する場合）
- **添付ファイル**: $0.12 / GB

**無料利用枠（AWS EC2 または Elastic Beanstalk からの送信）:**
- 月62,000通まで無料

**Cloudflare Workers からの送信の場合、無料利用枠は適用されません**が、お問い合わせフォーム程度の利用であれば、コストは非常に低額です（月100通送信した場合: $0.01）。

## 参考リンク

- [AWS SES 公式ドキュメント](https://docs.aws.amazon.com/ses/)
- [AWS SES Developer Guide](https://docs.aws.amazon.com/ses/latest/dg/Welcome.html)
- [AWS SES API リファレンス](https://docs.aws.amazon.com/ses/latest/APIReference/Welcome.html)
- [サンドボックス解除ガイド](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [AWS SDK for JavaScript v3 - SES Client](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/ses/)
