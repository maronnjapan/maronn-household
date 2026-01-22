# ==============================================================================
# AWS SES (Simple Email Service) 設定
# ==============================================================================
#
# 独自ドメインを使用したメール送信設定
# - ドメイン検証（DNS TXTレコード）
# - DKIM設定（メール認証）
# - Mail Fromドメイン設定（オプション）
# ==============================================================================

# ------------------------------------------------------------------------------
# SESドメイン検証
# ------------------------------------------------------------------------------

resource "aws_ses_domain_identity" "main" {
  domain = var.domain_name
}

resource "aws_ses_domain_identity_verification" "main" {
  domain = aws_ses_domain_identity.main.id

  depends_on = [aws_ses_domain_identity.main]

  # 注意: この検証を成功させるには、DNSに以下のTXTレコードを追加する必要があります
  # レコード名: _amazonses.${var.domain_name}
  # 値: output "ses_verification_token" で出力される値
}

# ------------------------------------------------------------------------------
# DKIM設定（メール認証強化）
# ------------------------------------------------------------------------------

resource "aws_ses_domain_dkim" "main" {
  domain = aws_ses_domain_identity.main.domain
}

# ------------------------------------------------------------------------------
# Mail Fromドメイン設定（オプション：カスタムバウンスメールドメイン）
# ------------------------------------------------------------------------------

resource "aws_ses_domain_mail_from" "main" {
  domain           = aws_ses_domain_identity.main.domain
  mail_from_domain = "mail.${var.domain_name}"
}

# ------------------------------------------------------------------------------
# メールアドレス検証（サンドボックスモード時のテスト用）
# 本番環境でサンドボックスを解除した後は不要
# ------------------------------------------------------------------------------

resource "aws_ses_email_identity" "contact_to" {
  email = var.contact_email_to
}

# ------------------------------------------------------------------------------
# SES設定セット（トラッキング用）
# ------------------------------------------------------------------------------

resource "aws_ses_configuration_set" "main" {
  name = "household-app-${var.environment}"

  reputation_metrics_enabled = true
  sending_enabled           = true
}

# ------------------------------------------------------------------------------
# イベント配信（CloudWatch Logs）
# ------------------------------------------------------------------------------

resource "aws_ses_event_destination" "cloudwatch" {
  name                   = "cloudwatch-logs"
  configuration_set_name = aws_ses_configuration_set.main.name
  enabled                = true
  matching_types         = ["send", "reject", "bounce", "complaint", "delivery"]

  cloudwatch_destination {
    default_value  = "default"
    dimension_name = "ses:caller-identity"
    value_source   = "messageTag"
  }
}
