# Terraform セットアップ・実行手順

AWS SESをTerraformで構築する手順です。

## 前提条件

- AWSアカウントが作成済みであること
- AWS SSOが設定済みであること
- `setup-aws-sso.sh` スクリプトが実行済みであること
- Terraform がインストールされていること（v1.5以上）

## Terraform のインストール確認

```bash
terraform version
```

インストールされていない場合: [Terraform インストールガイド](https://developer.hashicorp.com/terraform/install)

## 手順

### 1. terraform.tfvars ファイルの作成

サンプルファイルをコピーして、環境に合わせて編集します。

```bash
cd infrastructure/aws
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を編集：

```hcl
# AWS認証設定（setup-aws-sso.sh で自動設定済み）
aws_profile    = "household-app"      # AWS SSO プロファイル名
aws_region     = "ap-northeast-1"     # 東京リージョン
aws_account_id = "123456789012"       # あなたのAWSアカウントID

# 環境設定
environment  = "dev"
project_name = "maronn-household"

# SES設定（以下を編集してください）
ses_email_identity            = "your-email@example.com"      # 送信元メールアドレス
contact_form_recipient_email  = "your-email@example.com"      # お問い合わせの受信先
```

**重要**: `ses_email_identity` と `contact_form_recipient_email` を実際のメールアドレスに変更してください。

### 2. Terraform の初期化

```bash
terraform init
```

以下のような出力が表示されればOK：

```
Terraform has been successfully initialized!
```

### 3. 実行プランの確認

どのリソースが作成されるか確認します。

```bash
terraform plan
```

出力例：

```
Plan: 8 to add, 0 to change, 0 to destroy.
```

作成されるリソース：
- SES Email Identity（メールアドレスの検証）
- SES Configuration Set（送信ログ管理）
- IAM User（SES SMTP用）
- IAM Access Key（認証情報）
- IAM Policy（送信権限）
- SNS Topic（通知用）
- SES Notification Topic（バウンス・苦情通知）

### 4. リソースの作成

```bash
terraform apply
```

実行確認が表示されるので、`yes` と入力：

```
Do you want to perform these actions?
  Terraform will perform the actions described above.
  Only 'yes' will be accepted to approve.

  Enter a value: yes
```

### 5. 出力情報の確認

apply完了後、以下の情報が表示されます：

```bash
# すべての出力を表示
terraform output

# SMTP パスワード用のSecret Access Keyを取得（機密情報）
terraform output -raw ses_smtp_password_secret
```

出力される情報：
- `ses_email_identity`: 検証されたメールアドレス
- `ses_smtp_username`: SMTP ユーザー名（Access Key ID）
- `ses_smtp_password_secret`: Secret Access Key（要変換）
- `ses_smtp_endpoint`: SMTP エンドポイント
- `cloudflare_env_variables`: Cloudflare Workers に設定する環境変数

### 6. メールアドレスの検証

1. `ses_email_identity` に指定したメールアドレスに検証メールが届きます
2. メール内のリンクをクリックして検証を完了してください
3. 検証が完了すると、そのメールアドレスから送信可能になります

検証状態の確認：

```bash
aws ses get-identity-verification-attributes \
  --identities your-email@example.com \
  --profile household-app
```

### 7. Cloudflare Workers の環境変数設定

以下の環境変数をCloudflare Workers（Wrangler）に設定します。

```bash
# プロジェクトルートに移動
cd ../../

# Cloudflare Workers に環境変数を設定
npx wrangler secret put AWS_ACCESS_KEY_ID
# プロンプトで terraform output の値を入力

npx wrangler secret put AWS_SECRET_ACCESS_KEY
# プロンプトで terraform output -raw ses_smtp_password_secret の値を入力

# wrangler.toml に以下を追加（または既存のファイルに追記）
```

`apps/household-app/wrangler.toml`:

```toml
[vars]
AWS_SES_REGION = "ap-northeast-1"
AWS_SES_FROM_EMAIL = "your-email@example.com"
AWS_SES_TO_EMAIL = "your-email@example.com"
```

### 8. テスト送信

お問い合わせフォームからテストメールを送信して動作確認します。

```bash
# アプリを起動
pnpm dev

# ブラウザで http://localhost:3000/contact にアクセス
# テストメールを送信
```

## トラブルシューティング

### SSOセッションの有効期限切れ

```bash
aws sso login --profile household-app
```

### メールが送信できない

1. メールアドレスが検証済みか確認
2. SESがサンドボックスモードの場合、送信先も検証済みである必要があります
3. Cloudflare Workers の環境変数が正しく設定されているか確認

### サンドボックスモードの制限

初期状態では以下の制限があります：
- **検証済みメールアドレスにのみ送信可能**
- 24時間で200通まで
- 1秒間に1通まで

本番環境で使用する場合は、[送信制限の緩和を申請](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)してください。

## リソースの削除

テスト環境を削除する場合：

```bash
terraform destroy
```

**警告**: すべてのSESリソースが削除されます。本番環境では実行しないでください。

## 次のステップ

- お問い合わせフォームのメール送信実装
- SES送信ログのモニタリング設定
- 本番環境での送信制限緩和申請

## 参考資料

- [AWS SES 公式ドキュメント](https://docs.aws.amazon.com/ses/)
- [Terraform AWS Provider - SES](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ses_email_identity)
- [SES SMTP 認証情報](https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html)
