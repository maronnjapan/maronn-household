# AWS SSO（IAM Identity Center）セットアップ手順

Terraform実行用のAWS SSO認証を設定する手順です。

## 前提条件

- AWS Organizationsが有効化されていること
- 家計簿アプリ専用のAWSアカウントが作成済みであること
- 管理アカウントにログインできること

## 手順

### 1. IAM Identity Center の有効化

1. 管理アカウントのAWSマネジメントコンソールにログイン
2. 検索バーで「IAM Identity Center」を検索
3. **IAM Identity Center** サービスを開く
4. 「有効化」ボタンをクリック
5. 組織が検出されたら「有効にする」をクリック
6. リージョンは **東京（ap-northeast-1）** を推奨

### 2. ユーザーの作成

Terraform実行用のユーザーを作成します。

1. 左メニューから「ユーザー」を選択
2. 「ユーザーを追加」ボタンをクリック
3. 以下の情報を入力：
   - **ユーザー名**: `terraform-admin` （任意）
   - **パスワード**: 「パスワードをユーザーに送信」を選択
   - **メールアドレス**: あなたのメールアドレス
   - **名**: `Terraform`
   - **姓**: `Admin`
4. 「次へ」をクリック
5. グループの追加はスキップして「次へ」
6. 「ユーザーを追加」をクリック
7. メールアドレスに招待メールが届くので、パスワードを設定

### 3. 権限セットの作成

Terraform用の権限セットを作成します。

1. 左メニューから「権限セット」を選択
2. 「権限セットを作成」ボタンをクリック
3. 「カスタム権限セット」を選択
4. 以下の情報を入力：
   - **権限セット名**: `TerraformAdministrator`
   - **説明**: `Terraform execution with full administrative access`
   - **セッション期間**: `8時間` （デフォルト1時間から変更推奨）
5. 「次へ」をクリック

#### 3-1. ポリシーのアタッチ

開発環境のため、管理者権限をアタッチします。

1. 「AWS管理ポリシー」タブを選択
2. 検索ボックスで `AdministratorAccess` を検索
3. **AdministratorAccess** にチェックを入れる
4. 「次へ」をクリック
5. 内容を確認して「作成」をクリック

> **本番環境の場合**: 最小権限の原則に従い、SES、IAM、S3など必要な権限のみをアタッチすることを推奨します。

### 4. ユーザーに権限セットを割り当て

作成したユーザーに、家計簿アプリアカウントへのアクセス権限を付与します。

1. 左メニューから「AWSアカウント」を選択
2. 家計簿アプリ用アカウント（`maronn-household-app`）にチェック
3. 「ユーザーまたはグループを割り当て」ボタンをクリック
4. 「ユーザー」タブで `terraform-admin` を選択
5. 「次へ」をクリック
6. 権限セット `TerraformAdministrator` にチェック
7. 「次へ」をクリック
8. 内容を確認して「送信」をクリック

### 5. AWS CLI v2 のインストール確認

ローカル環境にAWS CLI v2がインストールされていることを確認します。

```bash
aws --version
```

- **バージョン2.x以上** が必要です
- インストールされていない場合: [AWS CLI v2 インストールガイド](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)

### 6. SSO設定スクリプトの実行

プロジェクトのスクリプトを使用してSSO設定を行います。

```bash
cd /path/to/maronn-household
chmod +x infrastructure/scripts/setup-aws-sso.sh
./infrastructure/scripts/setup-aws-sso.sh
```

スクリプトが以下の情報を尋ねるので入力します：

1. **プロファイル名**: `household-app` （任意、わかりやすい名前）
2. **SSO開始URL**: IAM Identity Centerのダッシュボードに表示されているURL
   - 例: `https://d-xxxxxxxxxx.awsapps.com/start`
3. **SSOリージョン**: `ap-northeast-1` （東京リージョン）
4. **アカウントを選択**: 家計簿アプリ用アカウント
5. **ロールを選択**: `TerraformAdministrator`

### 7. ブラウザでの認証

スクリプト実行中にブラウザが自動で開きます。

1. SSOログイン画面が表示される
2. 先ほど作成した `terraform-admin` ユーザーでログイン
3. 「許可」をクリック
4. 「ブラウザを閉じても構いません」と表示されればOK

### 8. 設定の確認

認証情報が正しく設定されているか確認します。

```bash
# プロファイルの確認
cat ~/.aws/config

# 認証テスト
aws sts get-caller-identity --profile household-app
```

以下のような出力が表示されればOK：

```json
{
    "UserId": "AROAXXXXXXXXXXXXXXXXX:terraform-admin",
    "Account": "123456789012",
    "Arn": "arn:aws:sts::123456789012:assumed-role/AWSReservedSSO_TerraformAdministrator_xxxxx/terraform-admin"
}
```

## トラブルシューティング

### SSOセッションの有効期限切れ

以下のコマンドで再ログインできます：

```bash
aws sso login --profile household-app
```

### 認証情報が見つからないエラー

```bash
# SSOセッションの再作成
aws configure sso --profile household-app
aws sso login --profile household-app
```

## 次のステップ

AWS SSOの設定が完了したら、次は **Terraformの初期化とリソース作成** を行います。

👉 [03-terraform-setup.md](./03-terraform-setup.md) に進んでください。

## 参考資料

- [AWS IAM Identity Center 公式ドキュメント](https://docs.aws.amazon.com/singlesignon/latest/userguide/what-is.html)
- [AWS CLI v2 SSO 設定ガイド](https://docs.aws.amazon.com/cli/latest/userguide/cli-configure-sso.html)
