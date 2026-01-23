# AWS Organizations によるテナント分離

このドキュメントでは、家計簿アプリ用の専用AWSアカウントをAWS Organizationsを使用して作成・管理する方法を説明します。

## 概要

AWS Organizationsを使用することで、以下のメリットがあります：

- **リソースの完全な分離**: 他のプロジェクトとAWSリソースを完全に分離
- **コスト管理**: プロジェクト単位での請求分離
- **セキュリティ**: 最小権限の原則に基づくアクセス制御
- **一元管理**: 複数アカウントをOrganizationsで統合管理

## アーキテクチャ

```
┌─────────────────────────────────────────────────────────────┐
│                    Management Account                        │
│                 (組織の管理用アカウント)                      │
│                                                              │
│  ┌─────────────────┐  ┌─────────────────────────────────┐   │
│  │ AWS Organizations│  │   IAM Identity Center (SSO)     │   │
│  │                  │  │   - ユーザー/グループ管理         │   │
│  │                  │  │   - Permission Sets             │   │
│  └─────────────────┘  └─────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Production OU  │  │  Development OU │  │   Sandbox OU    │
│                 │  │                 │  │                 │
│ ┌─────────────┐ │  │ ┌─────────────┐ │  │ ┌─────────────┐ │
│ │ household-  │ │  │ │ household-  │ │  │ │   個人用    │ │
│ │ app-prod    │ │  │ │ app-dev     │ │  │ │  実験用     │ │
│ │             │ │  │ │             │ │  │ │             │ │
│ │ - SES       │ │  │ │ - SES       │ │  │ │             │ │
│ │ - IAM       │ │  │ │ - IAM       │ │  │ │             │ │
│ └─────────────┘ │  │ └─────────────┘ │  │ └─────────────┘ │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

## セットアップ手順

### 1. AWS Organizations の有効化

管理アカウント（ルートアカウント）でOrganizationsを有効化します。
ルートアカウントのログインはaws cliのバージョンが2.32.0以上であれば`aws login  --profile プロファイル名`コマンドを使用してSSOログインできます。
参考：https://aws.amazon.com/jp/blogs/news/simplified-developer-access-to-aws-with-aws-login/

```bash
# AWS CLIで確認
aws organizations describe-organization
```

マネジメントコンソールから有効化する場合：
1. AWS マネジメントコンソールにログイン
2. AWS Organizations サービスに移動
3. 「組織を作成」をクリック

### 2. Organizational Units (OU) の作成

環境ごとにOUを作成してアカウントを整理します。

```bash

# ルートIDを取得
ROOT_ID=$(aws organizations list-roots --query 'Roots[0].Id' --output text)

# Production OU を作成
aws organizations create-organizational-unit \
  --parent-id $ROOT_ID \
  --name "Production"

# Development OU を作成
aws organizations create-organizational-unit \
  --parent-id $ROOT_ID \
  --name "Development"
```

### 3. メンバーアカウントの作成

家計簿アプリ用の専用アカウントを作成します。

```bash
# Production アカウントを作成
aws organizations create-account \
  --email "aws+household-prod@yourdomain.com" \
  --account-name "household-app-prod"

# Development アカウントを作成
aws organizations create-account \
  --email "aws+household-dev@yourdomain.com" \
  --account-name "household-app-dev"
```

**注意**: メールアドレスはAWSアカウント作成ごとに一意である必要があります。
Gmail の場合は `+` を使用したエイリアスが便利です。
例えばtest000@gmail.comをすでに使用している場合、`test000+household@gmail.com`とすれば同じメールアドレスを使用できます。(+の後ろの文字列は何でもいいです。)

### 4. アカウントをOUに移動

```bash
# Production OU のIDを取得
PROD_OU_ID=$(aws organizations list-organizational-units-for-parent \
  --parent-id $ROOT_ID \
  --query "OrganizationalUnits[?Name=='Production'].Id" \
  --output text)

# アカウントをProduction OUに移動
aws organizations move-account \
  --account-id <ACCOUNT_ID> \
  --source-parent-id $ROOT_ID \
  --destination-parent-id $PROD_OU_ID
```

## IAM Identity Center (AWS SSO) の設定

### 1. IAM Identity Center の有効化

1. AWS マネジメントコンソールで「IAM Identity Center」を検索
2. 「有効化」をクリック
3. リージョンを選択（東京リージョン推奨: ap-northeast-1）

### 2. ユーザーの作成

```
IAM Identity Center > ユーザー > ユーザーを追加
```

- ユーザー名: 任意（例: `admin`）
- メールアドレス: 通知受信用
- 名・姓: 任意

### 3. グループの作成

```
IAM Identity Center > グループ > グループを作成
```

推奨グループ構成：
- `Administrators` - 全アカウントへの管理者アクセス
- `Developers` - 開発アカウントへのアクセス
- `ReadOnly` - 本番アカウントへの読み取り専用アクセス

### 4. Permission Sets の作成

Permission Setは、SSOユーザーがメンバーアカウントで使用する権限を定義します。

#### 管理者用 Permission Set

```
IAM Identity Center > 権限セット > 権限セットを作成
```

- 名前: `AdministratorAccess`
- ポリシー: AWS managed policy `AdministratorAccess`
- セッション時間: 8時間（推奨）

#### 開発者用 Permission Set

```
名前: DeveloperAccess
ポリシー: カスタムポリシー
```

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "ses:*",
        "iam:GetUser",
        "iam:ListUsers",
        "iam:GetRole",
        "iam:ListRoles",
        "iam:CreateAccessKey",
        "iam:DeleteAccessKey",
        "iam:ListAccessKeys"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:*"
      ],
      "Resource": [
        "arn:aws:s3:::household-app-*",
        "arn:aws:s3:::household-app-*/*"
      ]
    }
  ]
}
```

### 5. アカウントへのアクセス権付与

```
IAM Identity Center > AWSアカウント > アカウントを選択 > ユーザーまたはグループを割り当て
```

1. 対象アカウントを選択
2. グループを選択（例: `Administrators`）
3. Permission Setを選択（例: `AdministratorAccess`）
4. 「送信」をクリック

## CLI での SSO ログイン

### 初回設定

```bash
# scripts/setup-aws-sso.sh を実行
./scripts/setup-aws-sso.sh
```

または手動で設定：

```bash
aws configure sso --profile household-app
```

以下の情報を入力：
- SSO session name: `household-sso`
- SSO start URL: `https://d-xxxxxxxxxx.awsapps.com/start`
- SSO Region: `ap-northeast-1`
- SSO registration scopes: デフォルトでEnter

### ログイン

```bash
aws sso login --profile household-app
```

ブラウザが開き、認証を求められます。

### 認証情報の確認

```bash
aws sts get-caller-identity --profile household-app
```

## Service Control Policies (SCP)

Organization全体にセキュリティポリシーを適用できます。

### 推奨SCP: リージョン制限

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyNonApprovedRegions",
      "Effect": "Deny",
      "NotAction": [
        "iam:*",
        "organizations:*",
        "support:*"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": [
            "ap-northeast-1",
            "us-east-1"
          ]
        }
      }
    }
  ]
}
```

### 推奨SCP: ルートユーザー制限

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyRootUser",
      "Effect": "Deny",
      "Action": "*",
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "aws:PrincipalArn": "arn:aws:iam::*:root"
        }
      }
    }
  ]
}
```

## コスト管理

### Cost Explorer の有効化

管理アカウントでCost Explorerを有効化し、アカウント別のコスト表示を設定します。

```
Billing > Cost Explorer > 有効化
```

### 予算アラート設定

```bash
aws budgets create-budget \
  --account-id <ACCOUNT_ID> \
  --budget '{
    "BudgetName": "household-app-monthly",
    "BudgetLimit": {
      "Amount": "10",
      "Unit": "USD"
    },
    "TimeUnit": "MONTHLY",
    "BudgetType": "COST"
  }' \
  --notifications-with-subscribers '[{
    "Notification": {
      "NotificationType": "ACTUAL",
      "ComparisonOperator": "GREATER_THAN",
      "Threshold": 80,
      "ThresholdType": "PERCENTAGE"
    },
    "Subscribers": [{
      "SubscriptionType": "EMAIL",
      "Address": "your-email@example.com"
    }]
  }]'
```

## トラブルシューティング

### SSO ログインエラー

```
Error: The security token included in the request is expired
```

対処法:
```bash
aws sso login --profile household-app
```

### アカウント作成が遅い

アカウント作成は非同期で行われます。ステータスを確認：

```bash
aws organizations describe-create-account-status \
  --create-account-request-id <REQUEST_ID>
```

### Permission Set が反映されない

1. IAM Identity Center で「プロビジョニング」が完了しているか確認
2. 一度ログアウトして再ログイン
3. キャッシュをクリア: `rm -rf ~/.aws/sso/cache/*`

## 参考リンク

- [AWS Organizations ドキュメント](https://docs.aws.amazon.com/organizations/)
- [IAM Identity Center ドキュメント](https://docs.aws.amazon.com/singlesignon/)
- [AWS CLI SSO 設定](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
