# ============================================
# SES Email Identity (メールアドレスまたはドメイン)
# ============================================

resource "aws_ses_email_identity" "main" {
  email = var.ses_email_identity
}

# ============================================
# SES Configuration Set（送信ログ管理用）
# ============================================

resource "aws_ses_configuration_set" "main" {
  name = "${var.project_name}-${var.environment}"

  # バウンスや苦情の追跡を有効化
  reputation_metrics_enabled = true
  sending_enabled            = true
}

# ============================================
# SES IAM User（Cloudflare Workersから使用）
# ============================================

resource "aws_iam_user" "ses_smtp" {
  name = "${var.project_name}-ses-smtp-${var.environment}"
  path = "/service-accounts/"

  tags = {
    Purpose = "SES SMTP authentication for contact form"
  }
}

# SES送信専用ポリシー
resource "aws_iam_user_policy" "ses_smtp_policy" {
  name = "SESSendEmailPolicy"
  user = aws_iam_user.ses_smtp.name

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "ses:SendEmail",
          "ses:SendRawEmail"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "ses:FromAddress" = var.ses_email_identity
          }
        }
      }
    ]
  })
}

# ============================================
# SES SMTP 認証情報
# ============================================

resource "aws_iam_access_key" "ses_smtp" {
  user = aws_iam_user.ses_smtp.name
}

# SMTP パスワードの生成（SES専用の変換が必要）
# 参考: https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html

locals {
  # SES SMTP パスワードは AWS Secret Access Key を特殊な方法で変換したもの
  # Terraform では直接生成できないため、outputs で Secret Access Key を出力し、
  # 別途変換スクリプトを使用するか、AWS Console で SMTP 認証情報を生成する
  smtp_username = aws_iam_access_key.ses_smtp.id
}

# ============================================
# SNS Topic（バウンス・苦情通知用）- オプション
# ============================================

resource "aws_sns_topic" "ses_notifications" {
  name = "${var.project_name}-ses-notifications-${var.environment}"

  tags = {
    Purpose = "SES bounce and complaint notifications"
  }
}

# SESイベントの通知設定
resource "aws_ses_identity_notification_topic" "bounce" {
  topic_arn                = aws_sns_topic.ses_notifications.arn
  notification_type        = "Bounce"
  identity                 = aws_ses_email_identity.main.email
  include_original_headers = true
}

resource "aws_ses_identity_notification_topic" "complaint" {
  topic_arn                = aws_sns_topic.ses_notifications.arn
  notification_type        = "Complaint"
  identity                 = aws_ses_email_identity.main.email
  include_original_headers = true
}

# ============================================
# SES Sending Authorization（送信制限の緩和申請後に設定）
# ============================================

# 初期状態ではSESはサンドボックスモードで、以下の制限があります：
# - 検証済みメールアドレスにのみ送信可能
# - 24時間で200通まで
# - 1秒間に1通まで
#
# 本番環境で使用する場合は、AWS Support に送信制限の緩和を申請してください。
# 申請方法: https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html
