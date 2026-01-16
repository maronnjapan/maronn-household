variable "aws_profile" {
  description = "AWS CLI プロファイル名（AWS SSO用）"
  type        = string
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
  description = "環境名（dev, staging, production）"
  type        = string
  default     = "dev"
}

variable "project_name" {
  description = "プロジェクト名"
  type        = string
  default     = "maronn-household"
}

variable "ses_email_identity" {
  description = "SESで検証するメールアドレスまたはドメイン"
  type        = string
}

variable "contact_form_recipient_email" {
  description = "お問い合わせフォームの送信先メールアドレス"
  type        = string
}
