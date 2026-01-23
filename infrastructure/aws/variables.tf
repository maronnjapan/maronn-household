# ==============================================================================
# 変数定義
# ==============================================================================

variable "aws_profile" {
  description = "AWS SSO プロファイル名"
  type        = string
  default     = "household-app"
}

variable "aws_region" {
  description = "AWSリージョン"
  type        = string
  default     = "ap-northeast-1"
}

variable "aws_account_id" {
  description = "AWSアカウントID"
  type        = string
}

variable "environment" {
  description = "環境名 (dev/staging/prod)"
  type        = string
  default     = "prod"
}

# ==============================================================================
# SES関連変数
# ==============================================================================

variable "domain_name" {
  description = "SESで使用するドメイン名（例: example.com）"
  type        = string
}

variable "contact_email_from" {
  description = "お問い合わせメールの送信元アドレス（例: noreply@example.com）"
  type        = string
}

variable "contact_email_to" {
  description = "お問い合わせメールの送信先アドレス（例: admin@example.com）"
  type        = string
}

variable "enable_email_receiving" {
  description = "メール受信機能を有効にするか（オプション）"
  type        = bool
  default     = false
}

# ==============================================================================
# IAM関連変数
# ==============================================================================

variable "create_iam_user" {
  description = "SES送信用のIAMユーザーを作成するか（Cloudflare Workers用）"
  type        = bool
  default     = true
}

variable "iam_user_name" {
  description = "SES送信用IAMユーザー名"
  type        = string
  default     = "household-app-ses-sender"
}
