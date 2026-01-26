# ==============================================================================
# AWS SNS (Simple Notification Service) 設定
# ==============================================================================
#
# SESバウンス・コンプレイント通知をアプリケーションに配信するためのSNS設定
# - バウンスメール発生時にWebhookでアプリに通知
# - コンプレイント発生時にWebhookでアプリに通知
# ==============================================================================

# ------------------------------------------------------------------------------
# SNSトピック（バウンス通知用）
# ------------------------------------------------------------------------------

resource "aws_sns_topic" "ses_bounces" {
  name = "household-app-ses-bounces-${var.environment}"

  tags = {
    Name        = "household-app-ses-bounces"
    Environment = var.environment
    Purpose     = "SES bounce notifications"
  }
}

# ------------------------------------------------------------------------------
# SNSトピック（コンプレイント通知用）
# ------------------------------------------------------------------------------

resource "aws_sns_topic" "ses_complaints" {
  name = "household-app-ses-complaints-${var.environment}"

  tags = {
    Name        = "household-app-ses-complaints"
    Environment = var.environment
    Purpose     = "SES complaint notifications"
  }
}

# ------------------------------------------------------------------------------
# SNSトピックポリシー（SESからの発行を許可）
# ------------------------------------------------------------------------------

resource "aws_sns_topic_policy" "ses_bounces" {
  arn = aws_sns_topic.ses_bounces.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSESToPublish"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.ses_bounces.arn
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = var.aws_account_id
          }
          ArnLike = {
            "AWS:SourceArn" = "arn:aws:ses:${var.aws_region}:${var.aws_account_id}:identity/*"
          }
        }
      }
    ]
  })
}

resource "aws_sns_topic_policy" "ses_complaints" {
  arn = aws_sns_topic.ses_complaints.arn

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "AllowSESToPublish"
        Effect = "Allow"
        Principal = {
          Service = "ses.amazonaws.com"
        }
        Action   = "SNS:Publish"
        Resource = aws_sns_topic.ses_complaints.arn
        Condition = {
          StringEquals = {
            "AWS:SourceAccount" = var.aws_account_id
          }
          ArnLike = {
            "AWS:SourceArn" = "arn:aws:ses:${var.aws_region}:${var.aws_account_id}:identity/*"
          }
        }
      }
    ]
  })
}

# ------------------------------------------------------------------------------
# SNSサブスクリプション（HTTPSエンドポイント）
# ------------------------------------------------------------------------------

resource "aws_sns_topic_subscription" "ses_bounces_webhook" {
  count = var.ses_bounce_webhook_url != "" ? 1 : 0

  topic_arn = aws_sns_topic.ses_bounces.arn
  protocol  = "https"
  endpoint  = var.ses_bounce_webhook_url

  # メッセージのraw配信（SNSラッパーなし）
  raw_message_delivery = false

  # 配信ポリシー
  delivery_policy = jsonencode({
    healthyRetryPolicy = {
      numRetries         = 3
      minDelayTarget     = 20
      maxDelayTarget     = 20
      numMaxDelayRetries = 0
      backoffFunction    = "linear"
    }
  })
}

resource "aws_sns_topic_subscription" "ses_complaints_webhook" {
  count = var.ses_complaint_webhook_url != "" ? 1 : 0

  topic_arn = aws_sns_topic.ses_complaints.arn
  protocol  = "https"
  endpoint  = var.ses_complaint_webhook_url

  raw_message_delivery = false

  delivery_policy = jsonencode({
    healthyRetryPolicy = {
      numRetries         = 3
      minDelayTarget     = 20
      maxDelayTarget     = 20
      numMaxDelayRetries = 0
      backoffFunction    = "linear"
    }
  })
}

# ------------------------------------------------------------------------------
# SESドメインIDへのバウンス・コンプレイント通知設定
# ------------------------------------------------------------------------------

resource "aws_ses_identity_notification_topic" "bounces" {
  topic_arn                = aws_sns_topic.ses_bounces.arn
  notification_type        = "Bounce"
  identity                 = aws_ses_domain_identity.main.domain
  include_original_headers = true
}

resource "aws_ses_identity_notification_topic" "complaints" {
  topic_arn                = aws_sns_topic.ses_complaints.arn
  notification_type        = "Complaint"
  identity                 = aws_ses_domain_identity.main.domain
  include_original_headers = true
}
