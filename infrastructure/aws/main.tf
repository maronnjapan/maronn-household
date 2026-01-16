terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }

  # Terraform State をS3に保存する場合はコメントを外してください
  # backend "s3" {
  #   bucket         = "maronn-household-terraform-state"
  #   key            = "household-app/terraform.tfstate"
  #   region         = "ap-northeast-1"
  #   encrypt        = true
  #   dynamodb_table = "terraform-state-lock"
  # }
}

provider "aws" {
  region  = var.aws_region
  profile = var.aws_profile

  default_tags {
    tags = {
      Project     = "maronn-household"
      Environment = var.environment
      ManagedBy   = "Terraform"
    }
  }
}
