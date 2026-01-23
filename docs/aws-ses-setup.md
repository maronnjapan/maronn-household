# AWS SES セットアップガイド

このドキュメントでは、家計簿アプリのお問い合わせ機能で使用するAWS SES（Simple Email Service）の設定方法を説明します。

## 前提条件

- AWSアカウント
- 独自ドメインのDNS管理権限
- AWS CLI がインストール済み
- Terraform がインストール済み（v1.0.0以上）

## セットアップ手順

### 1. AWS SSO の設定

まず、AWS SSO を設定してAWSアカウントにアクセスできるようにします。

```bash
./scripts/setup-aws-sso.sh
```

プロンプトに従って以下を設定：
- プロファイル名（推奨: `household-app`）
- SSO開始URL
- SSOリージョン

### 2. Terraform 変数の設定

```bash
cd infrastructure/aws
cp terraform.tfvars.example terraform.tfvars
```

`terraform.tfvars` を編集して以下を設定：

```hcl
# AWS設定（setup-aws-sso.sh で自動設定済み）
aws_profile    = "household-app"
aws_account_id = "123456789012"  # 自動設定済み
aws_region     = "ap-northeast-1"

# ドメイン設定（必須）
domain_name        = "yourdomain.com"
contact_email_from = "noreply@yourdomain.com"
contact_email_to   = "admin@yourdomain.com"
```

### 3. Terraform の実行

```bash
cd infrastructure/aws

# 初期化
terraform init

# プランを確認
terraform plan

# 適用
terraform apply
```
最初の`terraform apply` では`aws_ses_domain_identity_verification`が完了しないので、エラーになります。  
もしくはずっとapplyが終わらないです。  
エラーになったら、表示されるoutputにしたがってやればいいのですが、applyが終わらない場合は以下のapplyコマンドを行いoutputを取得します。

```bash
terraform apply -target=aws_ses_domain_identity.main
terraform apply -target=aws_ses_domain_dkim.main 
terraform apply -target=aws_ses_domain_mail_from.main
```

### 4. DNS レコードの設定（Cloudflare）

`terraform apply` の出力に表示されるDNSレコードを、Cloudflareダッシュボードの DNS タブで追加します。

1. Cloudflareにログインし、対象ドメインを開く
2. 「DNS」タブ → 「Add record」をクリック
3. `terraform output dns_records_to_add` の内容を以下のルールで入力
   - **Type**: Terraformのテーブルに記載されたタイプを選択（TXT/CNAME/MX）
   - **Name**: `_amazonses` や `xxxx._domainkey` などホスト名部分のみを入力（Cloudflareが自動でドメイン名を付与）
   - **Content**: Terraformで出力された値をそのまま貼り付け
   - **TTL**: 「Auto」でOK
   - **Proxy status**: すべて「DNS only」に切り替え（オレンジ雲をグレーに）

```bash
terraform output dns_records_to_add
```

追加するレコード：

| タイプ | 名前 | 値 |
|--------|----------|-----|
| TXT | `_amazonses` | 検証トークン |
| CNAME | `xxxx._domainkey` | DKIM値（3つ） |
| MX | `mail` | `10 feedback-smtp.ap-northeast-1.amazonses.com` |
| TXT | `mail` | `v=spf1 include:amazonses.com ~all` |

> **補足**: Cloudflareは入力したホスト名に自動でドメイン名を追加するため、`yourdomain.com` まで手動入力しないよう注意してください。

### 5. ドメイン検証の確認

DNSレコード追加後、検証が完了するまで待ちます（通常数分〜数時間）。

```bash
# 検証ステータスを確認
aws ses get-identity-verification-attributes \
  --identities yourdomain.com \
  --profile household-app
```

出力例（検証完了時）：
```json
{
  "VerificationAttributes": {
    "yourdomain.com": {
      "VerificationStatus": "Success"
    }
  }
}
```

### 6. Cloudflare Workers へのシークレット設定

```bash
# シークレット設定コマンドを表示
terraform output cloudflare_secrets_commands
```

表示されたコマンドを実行してシークレットを設定：

```bash
cd apps/household-app

# AWSアクセスキーID
echo "AKIAXXXXXXXXXX" | wrangler secret put AWS_ACCESS_KEY_ID

# AWSシークレットアクセスキー
terraform output -raw aws_secret_access_key | wrangler secret put AWS_SECRET_ACCESS_KEY

# AWSリージョン
echo "ap-northeast-1" | wrangler secret put AWS_REGION

# 送信元メールアドレス
echo "noreply@yourdomain.com" | wrangler secret put CONTACT_EMAIL_FROM

# 送信先メールアドレス
echo "admin@yourdomain.com" | wrangler secret put CONTACT_EMAIL_TO
```

### 7. ローカル開発環境の設定

`.dev.vars` ファイルに以下を追加：

```
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_REGION=ap-northeast-1
CONTACT_EMAIL_FROM=noreply@yourdomain.com
CONTACT_EMAIL_TO=admin@yourdomain.com
```

## SES サンドボックスの解除

新しいSESアカウントは「サンドボックスモード」で制限されています。

### サンドボックスモードの制限

- 検証済みのメールアドレスにのみ送信可能
- 24時間あたり200通まで
- 1秒あたり1通まで

### 本番運用申請

本番環境で運用する場合は、サンドボックスの解除を申請します。

1. AWS コンソールで「SES」を開く
2. 「Account dashboard」を選択
3. 「Request production access」をクリック
4. 以下の情報を入力：
   - Mail type: Transactional
   - Website URL: アプリのURL
   - Use case description: お問い合わせフォームからの通知メール送信

申請は通常24時間以内に審査されます。

## トラブルシューティング

### メールが送信されない

1. **SESドメイン検証を確認**
   ```bash
   aws ses get-identity-verification-attributes \
     --identities yourdomain.com \
     --profile household-app
   ```

2. **IAMポリシーを確認**
   IAMユーザーに `ses:SendEmail` 権限があるか確認

3. **サンドボックスモードを確認**
   サンドボックスモードの場合、送信先メールアドレスも検証が必要

4. **Cloudflare Workersのログを確認**
   ```bash
   wrangler tail
   ```

### DNS検証が完了しない

1. DNSレコードが正しく設定されているか確認
   ```bash
   dig TXT _amazonses.yourdomain.com
   ```

2. DNS伝播を待つ（最大48時間かかる場合あり）

3. DNSプロバイダーの設定を再確認

### DKIM署名エラー

1. 3つのCNAMEレコードがすべて設定されているか確認
2. CNAMEの値が正しいか確認（末尾のドットに注意）

## セキュリティのベストプラクティス

### IAMユーザーの権限制限

Terraformで作成されるIAMユーザーは、必要最小限の権限のみ付与されています：

- `ses:SendEmail` - メール送信
- `ses:SendRawEmail` - 添付ファイル付きメール送信（将来用）

### シークレットのローテーション

定期的にアクセスキーをローテーションすることを推奨します。

```bash
# 新しいアクセスキーを作成
aws iam create-access-key \
  --user-name household-app-ses-sender \
  --profile household-app

# 古いアクセスキーを無効化
aws iam update-access-key \
  --user-name household-app-ses-sender \
  --access-key-id OLD_ACCESS_KEY_ID \
  --status Inactive \
  --profile household-app

# Cloudflare Workersのシークレットを更新
wrangler secret put AWS_ACCESS_KEY_ID
wrangler secret put AWS_SECRET_ACCESS_KEY

# 古いアクセスキーを削除
aws iam delete-access-key \
  --user-name household-app-ses-sender \
  --access-key-id OLD_ACCESS_KEY_ID \
  --profile household-app
```

## 参考リンク

- [AWS SES ドキュメント](https://docs.aws.amazon.com/ses/)
- [SES サンドボックス解除](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html)
- [Cloudflare Workers シークレット](https://developers.cloudflare.com/workers/configuration/secrets/)
