# ==============================================================================
# 家計簿アプリ - AWS インフラストラクチャ設定
# ==============================================================================
#
# このTerraform設定は、AWS SES（Simple Email Service）を使用したお問い合わせ
# メール送信機能のインフラを管理します。
#
# 前提条件:
# - AWS SSOでログイン済み
# - 独自ドメインのDNS管理権限
#
# 使用方法:
# 1. scripts/setup-aws-sso.sh を実行してAWS SSO設定を完了
# 2. terraform.tfvars を作成し、必要な変数を設定
# 3. terraform init
# 4. terraform plan
# 5. terraform apply
# ==============================================================================

terraform {
  required_version = ">= 1.0.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # 状態ファイルをS3に保存する場合は以下のブロックを有効化
  # backend "s3" {
  #   bucket         = "your-terraform-state-bucket"
  #   key            = "household-app/terraform.tfstate"
  #   region         = "ap-northeast-1"
  #   encrypt        = true
  #   dynamodb_table = "terraform-state-lock"
  # }
}

# ==============================================================================
# Provider設定
# ==============================================================================

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project     = "household-app"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ==============================================================================
# データソース
# ==============================================================================

data "aws_caller_identity" "current" {}

data "aws_region" "current" {}
