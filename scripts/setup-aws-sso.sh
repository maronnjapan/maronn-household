#!/bin/bash

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AWS_DIR="$SCRIPT_DIR/../infrastructure/aws"

echo "=== AWS SSO 初期設定スクリプト ==="
echo ""
echo "このスクリプトは、家計簿アプリ用のAWS SSO認証を設定します。"
echo ""

# プロファイル名を入力
read -p "作成するプロファイル名を入力してください (推奨: household-app): " PROFILE_NAME

if [[ -z "$PROFILE_NAME" ]]; then
    echo "エラー: プロファイル名が入力されていません"
    exit 1
fi

# AWS SSO設定を実行
echo ""
echo "AWS SSO設定を開始します..."
echo ""
echo "以下の情報が必要です："
echo "  - SSO開始URL: IAM Identity Centerのダッシュボードに表示されています"
echo "  - SSOリージョン: ap-northeast-1 (東京リージョン推奨)"
echo ""

aws configure sso --profile "$PROFILE_NAME"

# アカウントIDを取得
ACCOUNT_ID=$(aws configure get sso_account_id --profile "$PROFILE_NAME")

if [[ -z "$ACCOUNT_ID" ]]; then
    echo "エラー: アカウントIDを取得できませんでした"
    exit 1
fi

echo ""
echo "取得したアカウントID: $ACCOUNT_ID"

# AWS SSO ログイン実行
echo ""
echo "AWS SSOにログインします..."
aws sso login --profile "$PROFILE_NAME"

# terraform.tfvars ファイルの更新
echo ""
echo "Terraform設定ファイルを更新します..."

TFVARS_FILE="$AWS_DIR/terraform.tfvars"

update_tfvars() {
    local file="$1" key="$2" value="$3"

    if [[ ! -f "$file" ]]; then
        echo "terraform.tfvars が存在しないため新規作成します"
        touch "$file"
    fi

    if grep -q "^$key" "$file"; then
        # 既存の行を更新（macOS と Linux の両方に対応）
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/^$key *= *\"[^\"]*\"/$key = \"$value\"/" "$file"
        else
            sed -i "s/^$key *= *\"[^\"]*\"/$key = \"$value\"/" "$file"
        fi
        echo "  更新: $key = \"$value\""
    else
        # 新しい行を追加
        echo "$key = \"$value\"" >> "$file"
        echo "  追加: $key = \"$value\""
    fi
}

update_tfvars "$TFVARS_FILE" "aws_profile" "$PROFILE_NAME"
update_tfvars "$TFVARS_FILE" "aws_account_id" "$ACCOUNT_ID"

# リージョンの設定（デフォルト値の確認）
AWS_REGION=$(aws configure get region --profile "$PROFILE_NAME")
if [[ -z "$AWS_REGION" ]]; then
    AWS_REGION="ap-northeast-1"
    echo "  リージョンが未設定のため、デフォルト値を使用: $AWS_REGION"
fi
update_tfvars "$TFVARS_FILE" "aws_region" "$AWS_REGION"

echo ""
echo "=== 設定完了 ==="
echo ""
echo "✅ AWS SSO プロファイル: $PROFILE_NAME"
echo "✅ AWSアカウントID: $ACCOUNT_ID"
echo "✅ リージョン: $AWS_REGION"
echo ""
echo "次のステップ:"
echo "  1. infrastructure/aws/terraform.tfvars を編集してドメイン設定を追加"
echo "     - domain_name: あなたのドメイン名"
echo "     - contact_email_from: 送信元メールアドレス"
echo "     - contact_email_to: お問い合わせ受信アドレス"
echo ""
echo "  2. Terraformを実行"
echo "     cd infrastructure/aws"
echo "     terraform init"
echo "     terraform plan"
echo "     terraform apply"
echo ""
echo "  3. DNS設定を追加（terraform apply の出力を参照）"
echo ""
echo "  4. Cloudflare Workersにシークレットを設定"
echo "     （terraform output cloudflare_secrets_commands を参照）"
echo ""
echo "詳細は docs/aws-ses-setup.md を参照してください。"
