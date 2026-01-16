# Infrastructure - AWS SES セットアップ

家計簿アプリのお問い合わせフォーム用のAWS SES（Simple Email Service）をTerraformで管理します。

## 概要

このディレクトリには、AWS SESを使用したメール送信機能のインフラ構成が含まれています。

### 構成

```
infrastructure/
├── aws/                          # Terraform設定ファイル
│   ├── main.tf                   # プロバイダー設定
│   ├── variables.tf              # 変数定義
│   ├── ses.tf                    # SESリソース定義
│   ├── outputs.tf                # 出力定義
│   ├── terraform.tfvars.example  # 環境変数のサンプル
│   └── .gitignore                # Git除外設定
├── scripts/                      # セットアップスクリプト
│   └── setup-aws-sso.sh          # AWS SSO初期設定スクリプト
└── docs/                         # ドキュメント
    ├── 01-aws-account-setup.md   # AWSアカウント作成手順
    ├── 02-aws-sso-setup.md       # AWS SSO設定手順
    └── 03-terraform-setup.md     # Terraform実行手順
```

## セットアップ手順

### 📋 前提条件

- AWSルートアカウントへのアクセス権限
- AWS CLI v2がインストール済み
- Terraform v1.5以上がインストール済み

### 🚀 クイックスタート

以下の手順で順番に進めてください。

#### ステップ1: AWSアカウントの作成

このアプリ専用のAWSアカウント（テナント）を作成します。

👉 **[docs/01-aws-account-setup.md](./docs/01-aws-account-setup.md)** を参照

所要時間: 約10分

#### ステップ2: AWS SSOの設定

Terraform実行用のAWS SSO認証を設定します。

👉 **[docs/02-aws-sso-setup.md](./docs/02-aws-sso-setup.md)** を参照

所要時間: 約15分

#### ステップ3: Terraformの実行

AWS SESリソースを作成します。

👉 **[docs/03-terraform-setup.md](./docs/03-terraform-setup.md)** を参照

所要時間: 約5分

### 📝 簡易版手順

経験者向けの簡易版手順：

```bash
# 1. AWSアカウント作成（Webコンソールで実施）
# - AWS Organizations で新規アカウントを作成
# - アカウント名: maronn-household-app
# - アカウントIDをメモ

# 2. AWS SSO設定スクリプト実行
cd infrastructure
chmod +x scripts/setup-aws-sso.sh
./scripts/setup-aws-sso.sh

# 3. Terraform設定
cd aws
cp terraform.tfvars.example terraform.tfvars
vim terraform.tfvars  # メールアドレスを編集

# 4. Terraformでリソース作成
terraform init
terraform plan
terraform apply

# 5. メールアドレス検証
# ses_email_identity に送信された検証メールのリンクをクリック

# 6. 環境変数の取得
terraform output
terraform output -raw ses_smtp_password_secret

# 7. Cloudflare Workers に環境変数を設定
# （プロジェクトルートで実行）
cd ../../
npx wrangler secret put AWS_ACCESS_KEY_ID
npx wrangler secret put AWS_SECRET_ACCESS_KEY
```

## 管理されるリソース

以下のAWSリソースがTerraformで管理されます：

| リソース | 説明 |
|---------|------|
| SES Email Identity | メールアドレスの検証 |
| SES Configuration Set | 送信ログ管理 |
| IAM User | SES SMTP認証用サービスアカウント |
| IAM Access Key | SMTP認証情報 |
| IAM Policy | SES送信権限（送信元アドレス制限付き） |
| SNS Topic | バウンス・苦情通知用 |

## セキュリティ

### 機密情報の管理

以下のファイルは `.gitignore` で除外され、Gitにコミットされません：

- `terraform.tfvars` - 実際の環境変数
- `.terraform/` - Terraform内部ファイル
- `*.tfstate` - Terraformステートファイル（機密情報を含む）

### IAMポリシー

作成されるIAMユーザーには最小権限の原則に基づき、以下の制限があります：

- SESのメール送信権限のみ
- 送信元アドレスは `ses_email_identity` に限定
- その他のAWS操作は不可

## トラブルシューティング

### SSOセッションの有効期限切れ

```bash
aws sso login --profile household-app
```

### Terraform実行時のエラー

```bash
# 認証情報の確認
aws sts get-caller-identity --profile household-app

# Terraformの再初期化
terraform init -upgrade
```

### メール送信エラー

1. メールアドレスが検証済みか確認
2. SESサンドボックスモードでは、送信先も検証済みである必要があります
3. Cloudflare Workers の環境変数が正しく設定されているか確認

## SES サンドボックスモード

初期状態ではSESはサンドボックスモードで、以下の制限があります：

- ✅ 検証済みメールアドレスにのみ送信可能
- ✅ 24時間で200通まで
- ✅ 1秒間に1通まで

開発・テスト環境ではこのまま使用できます。

### 本番環境への移行

本番環境で不特定多数のユーザーにメール送信する場合、[送信制限の緩和](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)を申請してください。

申請承認後：
- ✅ 任意のメールアドレスに送信可能
- ✅ 送信制限が大幅に緩和（1日50,000通〜）

## よくある質問

### Q. Terraformステートファイルはどこに保存されますか？

A. デフォルトではローカル（`terraform.tfstate`）に保存されます。チームで管理する場合は、S3バックエンドの使用を推奨します（`main.tf`にコメントアウト済み）。

### Q. 複数環境（dev/staging/production）を管理できますか？

A. はい。`environment` 変数を変更することで、同一アカウント内で複数環境を構築できます。また、Terraformワークスペースを使用して環境を分離することも可能です。

### Q. SESの料金はいくらですか？

A. 無料枠: 月1,000通まで無料（EC2/Lambda経由の場合62,000通まで）。詳細は[SES料金ページ](https://aws.amazon.com/ses/pricing/)を参照。

### Q. 他のメール送信サービスに移行できますか？

A. はい。Cloudflare Workers のメール送信ロジックを変更すれば、SendGrid、Mailgun、Postmarkなどにも対応可能です。

## 参考資料

- [AWS SES 公式ドキュメント](https://docs.aws.amazon.com/ses/)
- [Terraform AWS Provider - SES](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ses_email_identity)
- [AWS Organizations](https://docs.aws.amazon.com/organizations/)
- [AWS IAM Identity Center](https://docs.aws.amazon.com/singlesignon/)

## ライセンス

このインフラ構成は、親プロジェクトと同じライセンスで提供されます。
