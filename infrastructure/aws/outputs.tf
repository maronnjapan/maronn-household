# ==============================================================================
# 出力値
# ==============================================================================

# ------------------------------------------------------------------------------
# DNS設定用出力（ドメイン検証）
# ------------------------------------------------------------------------------

output "ses_verification_token" {
  description = "SESドメイン検証用のTXTレコード値"
  value       = aws_ses_domain_identity.main.verification_token
}

output "ses_dkim_tokens" {
  description = "DKIM設定用のCNAMEレコード（3つ）"
  value = [
    for token in aws_ses_domain_dkim.main.dkim_tokens : {
      name  = "${token}._domainkey.${var.domain_name}"
      value = "${token}.dkim.amazonses.com"
    }
  ]
}

output "mail_from_mx_record" {
  description = "Mail From用のMXレコード"
  value = {
    name     = "mail.${var.domain_name}"
    value    = "feedback-smtp.${var.aws_region}.amazonses.com"
    priority = 10
  }
}

output "mail_from_txt_record" {
  description = "Mail From用のSPF TXTレコード"
  value = {
    name  = "mail.${var.domain_name}"
    value = "v=spf1 include:amazonses.com ~all"
  }
}

# ------------------------------------------------------------------------------
# DNS設定手順（まとめ）
# ------------------------------------------------------------------------------

output "dns_records_to_add" {
  description = "追加が必要なDNSレコード一覧"
  value       = <<-EOT

================================================================================
以下のDNSレコードをドメインのDNS設定に追加してください:
================================================================================

1. ドメイン検証 (TXT)
   ホスト名: _amazonses.${var.domain_name}
   タイプ: TXT
   値: ${aws_ses_domain_identity.main.verification_token}

2. DKIM (CNAME) - 以下3つすべて追加
%{for i, token in aws_ses_domain_dkim.main.dkim_tokens}
   ホスト名: ${token}._domainkey.${var.domain_name}
   タイプ: CNAME
   値: ${token}.dkim.amazonses.com
%{endfor}

3. Mail From (MX)
   ホスト名: mail.${var.domain_name}
   タイプ: MX
   優先度: 10
   値: feedback-smtp.${var.aws_region}.amazonses.com

4. Mail From SPF (TXT)
   ホスト名: mail.${var.domain_name}
   タイプ: TXT
   値: "v=spf1 include:amazonses.com ~all"

================================================================================
EOT
}

# ------------------------------------------------------------------------------
# Cloudflare Workers環境変数用出力
# ------------------------------------------------------------------------------

output "aws_access_key_id" {
  description = "Cloudflare Workersに設定するAWSアクセスキーID"
  value       = var.create_iam_user ? aws_iam_access_key.ses_sender[0].id : null
  sensitive   = false
}

output "aws_secret_access_key" {
  description = "Cloudflare Workersに設定するAWSシークレットアクセスキー"
  value       = var.create_iam_user ? aws_iam_access_key.ses_sender[0].secret : null
  sensitive   = true
}

output "cloudflare_secrets_commands" {
  description = "Cloudflare Workersシークレット設定コマンド"
  value       = <<-EOT

================================================================================
以下のコマンドでCloudflare Workersにシークレットを設定してください:
================================================================================

cd apps/household-app

# AWSアクセスキーID
echo "${var.create_iam_user ? aws_iam_access_key.ses_sender[0].id : "IAM_USER_NOT_CREATED"}" | wrangler secret put AWS_ACCESS_KEY_ID

# AWSシークレットアクセスキー（terraform output -raw aws_secret_access_key で取得）
terraform output -raw aws_secret_access_key | wrangler secret put AWS_SECRET_ACCESS_KEY

# AWSリージョン
echo "${var.aws_region}" | wrangler secret put AWS_REGION

# 送信元メールアドレス
echo "${var.contact_email_from}" | wrangler secret put CONTACT_EMAIL_FROM

# 送信先メールアドレス
echo "${var.contact_email_to}" | wrangler secret put CONTACT_EMAIL_TO

================================================================================
EOT
}

# ------------------------------------------------------------------------------
# その他の情報
# ------------------------------------------------------------------------------

output "ses_domain_arn" {
  description = "SESドメインのARN"
  value       = aws_ses_domain_identity.main.arn
}

output "aws_region" {
  description = "使用中のAWSリージョン"
  value       = var.aws_region
}

output "account_id" {
  description = "AWSアカウントID"
  value       = data.aws_caller_identity.current.account_id
}

# ------------------------------------------------------------------------------
# SNS関連出力（SESバウンス・コンプレイント通知）
# ------------------------------------------------------------------------------

output "sns_bounce_topic_arn" {
  description = "SESバウンス通知用SNSトピックのARN"
  value       = aws_sns_topic.ses_bounces.arn
}

output "sns_complaint_topic_arn" {
  description = "SESコンプレイント通知用SNSトピックのARN"
  value       = aws_sns_topic.ses_complaints.arn
}

output "ses_bounce_notification_setup" {
  description = "SESバウンス通知の設定手順"
  value       = <<-EOT

================================================================================
SESバウンス・コンプレイント通知の設定手順
================================================================================

1. アプリケーションにWebhookエンドポイントをデプロイ
   - バウンス: /api/webhooks/ses/bounce
   - コンプレイント: /api/webhooks/ses/complaint

2. terraform.tfvarsに以下を追加:
   ses_bounce_webhook_url    = "https://your-app.workers.dev/api/webhooks/ses/bounce"
   ses_complaint_webhook_url = "https://your-app.workers.dev/api/webhooks/ses/complaint"

3. terraform apply を実行

4. SNSからの確認リクエスト（SubscriptionConfirmation）に応答
   - アプリケーションのWebhookエンドポイントで自動処理されます

================================================================================
EOT
}
