output "ses_email_identity" {
  description = "検証されたメールアドレス"
  value       = aws_ses_email_identity.main.email
}

output "ses_smtp_username" {
  description = "SES SMTP ユーザー名（Access Key ID）"
  value       = aws_iam_access_key.ses_smtp.id
}

output "ses_smtp_password_secret" {
  description = "SES SMTP パスワード（Secret Access Key）- この値を使ってSMTPパスワードを生成してください"
  value       = aws_iam_access_key.ses_smtp.secret
  sensitive   = true
}

output "ses_smtp_endpoint" {
  description = "SES SMTP エンドポイント"
  value       = "email-smtp.${var.aws_region}.amazonaws.com"
}

output "ses_smtp_port" {
  description = "SES SMTP ポート（TLS）"
  value       = "587"
}

output "ses_configuration_set" {
  description = "SES Configuration Set 名"
  value       = aws_ses_configuration_set.main.name
}

output "sns_topic_arn" {
  description = "SES通知用SNS Topic ARN"
  value       = aws_sns_topic.ses_notifications.arn
}

output "cloudflare_env_variables" {
  description = "Cloudflare Workers の環境変数に設定する値"
  value = {
    AWS_SES_REGION       = var.aws_region
    AWS_SES_FROM_EMAIL   = var.ses_email_identity
    AWS_SES_TO_EMAIL     = var.contact_form_recipient_email
    AWS_ACCESS_KEY_ID    = aws_iam_access_key.ses_smtp.id
    # AWS_SECRET_ACCESS_KEY は sensitive のため、以下のコマンドで取得してください:
    # terraform output -raw ses_smtp_password_secret
  }
}

output "next_steps" {
  description = "次のステップ"
  value = <<-EOT

  ✅ Terraform apply が完了しました！

  次のステップ:

  1. メールアドレスの検証
     - ${var.ses_email_identity} に送信された検証メールを確認
     - メール内のリンクをクリックして検証を完了してください

  2. SMTP パスワードの取得
     以下のコマンドで Secret Access Key を取得:

       terraform output -raw ses_smtp_password_secret

     この値をCloudflare Workers の環境変数 AWS_SECRET_ACCESS_KEY に設定してください

  3. Cloudflare Workers の環境変数設定
     以下の環境変数を設定:

       AWS_SES_REGION: ${var.aws_region}
       AWS_SES_FROM_EMAIL: ${var.ses_email_identity}
       AWS_SES_TO_EMAIL: ${var.contact_form_recipient_email}
       AWS_ACCESS_KEY_ID: ${aws_iam_access_key.ses_smtp.id}
       AWS_SECRET_ACCESS_KEY: (上記コマンドで取得した値)

  4. テスト送信
     お問い合わせフォームからテストメールを送信して動作確認

  ⚠️ 注意: 現在SESはサンドボックスモードです
     - 検証済みメールアドレスにのみ送信可能
     - 24時間で200通、1秒間に1通まで
     - 本番環境で使用する場合は送信制限の緩和を申請してください
       https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html

  EOT
}
