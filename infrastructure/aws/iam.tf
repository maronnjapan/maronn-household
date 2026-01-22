# ==============================================================================
# IAM設定 - SES送信用
# ==============================================================================
#
# Cloudflare Workersからメール送信するために、最小権限のIAMユーザーを作成
# ==============================================================================

# ------------------------------------------------------------------------------
# SES送信ポリシー
# ------------------------------------------------------------------------------

data "aws_iam_policy_document" "ses_sender" {
  statement {
    sid    = "AllowSendEmail"
    effect = "Allow"

    actions = [
      "ses:SendEmail",
      "ses:SendRawEmail",
    ]

    resources = [
      aws_ses_domain_identity.main.arn,
      "arn:aws:ses:${var.aws_region}:${var.aws_account_id}:identity/${var.contact_email_from}",
    ]

    # 送信元アドレスを制限
    condition {
      test     = "StringEquals"
      variable = "ses:FromAddress"
      values   = [var.contact_email_from]
    }
  }

  statement {
    sid    = "AllowSendEmailWithConfigSet"
    effect = "Allow"

    actions = [
      "ses:SendEmail",
      "ses:SendRawEmail",
    ]

    resources = [
      aws_ses_configuration_set.main.arn,
    ]
  }
}

resource "aws_iam_policy" "ses_sender" {
  name        = "household-app-ses-sender-${var.environment}"
  description = "Policy for sending emails via SES for household app"
  policy      = data.aws_iam_policy_document.ses_sender.json
}

# ------------------------------------------------------------------------------
# SES送信用IAMユーザー（Cloudflare Workers用）
# ------------------------------------------------------------------------------

resource "aws_iam_user" "ses_sender" {
  count = var.create_iam_user ? 1 : 0

  name = var.iam_user_name
  path = "/service-accounts/"

  tags = {
    Purpose = "SES email sending for household app contact form"
  }
}

resource "aws_iam_user_policy_attachment" "ses_sender" {
  count = var.create_iam_user ? 1 : 0

  user       = aws_iam_user.ses_sender[0].name
  policy_arn = aws_iam_policy.ses_sender.arn
}

# ------------------------------------------------------------------------------
# アクセスキー（Cloudflare Workersのシークレットに設定）
# ------------------------------------------------------------------------------

resource "aws_iam_access_key" "ses_sender" {
  count = var.create_iam_user ? 1 : 0

  user = aws_iam_user.ses_sender[0].name
}
