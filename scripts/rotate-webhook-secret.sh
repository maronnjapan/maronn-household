#!/usr/bin/env bash
# Webhook シークレットキーのローテーションスクリプト
#
# 実行するだけでローテーションが完了する:
#   bash scripts/rotate-webhook-secret.sh
#   bash scripts/rotate-webhook-secret.sh --env production
#
# 処理フロー:
#   1. 新しいシークレットキーを生成
#   2. 現在の WEBHOOK_SECRET_KEY を WEBHOOK_SECRET_KEY_OLD に退避
#   3. 新キーを WEBHOOK_SECRET_KEY として設定（household-app + webhook-batch-cron）
#   4. Workers をデプロイして新シークレットを反映
#   5. /api/admin/rotate-secret-key を呼び出してDB内の暗号化データを再暗号化
#   6. WEBHOOK_SECRET_KEY_OLD を削除
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${PROJECT_ROOT}/apps/household-app"
CRON_DIR="${PROJECT_ROOT}/apps/webhook-batch-cron"

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}i ${NC}$1"; }
log_success() { echo -e "${GREEN}v${NC} $1"; }
log_warning() { echo -e "${YELLOW}!${NC} $1"; }
log_error()   { echo -e "${RED}x${NC} $1"; }
log_step()    { echo ""; echo -e "${CYAN}> $1${NC}"; echo "----------------------------------------"; }

# 使い方
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Webhook シークレットキーをローテーションします。

OPTIONS:
    -e, --env <env>        環境 (dev or production)。デフォルト: dev
    --admin-key <key>      ADMIN_API_KEY を直接指定（省略時はプロンプトで入力）
    --app-url <url>        アプリのベースURL（省略時は環境から自動判定）
    --dry-run              実際の変更を行わず、手順だけ表示する
    -h, --help             このヘルプを表示

EXAMPLES:
    # 開発環境でローテーション
    $0

    # 本番環境でローテーション
    $0 --env production

    # ADMIN_API_KEY を直接指定
    $0 --env production --admin-key "my-admin-key"

    # ドライラン（手順確認のみ）
    $0 --dry-run
EOF
}

# デフォルト値
ENVIRONMENT="dev"
ADMIN_KEY=""
APP_URL=""
DRY_RUN=false

# 引数解析
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --admin-key)
            ADMIN_KEY="$2"
            shift 2
            ;;
        --app-url)
            APP_URL="$2"
            shift 2
            ;;
        --dry-run)
            DRY_RUN=true
            shift
            ;;
        -h|--help)
            usage
            exit 0
            ;;
        *)
            log_error "Unknown option: $1"
            usage
            exit 1
            ;;
    esac
done

# 環境チェック
if [[ "${ENVIRONMENT}" != "dev" && "${ENVIRONMENT}" != "production" ]]; then
    log_error "Invalid environment: ${ENVIRONMENT} (dev or production)"
    exit 1
fi

# APP_URL 自動判定
if [[ -z "${APP_URL}" ]]; then
    if [[ "${ENVIRONMENT}" == "production" ]]; then
        APP_URL="https://maronn-household-budget.com"
    else
        APP_URL="https://household-app.$(wrangler whoami 2>/dev/null | grep -oP '[\w-]+\.workers\.dev' || echo '<your-subdomain>.workers.dev')"
        log_warning "開発環境のURLが自動判定できない場合は --app-url で指定してください"
    fi
fi

# ヘッダー表示
echo -e "${CYAN}"
cat << "EOF"
+--------------------------------------+
|   Webhook Secret Key Rotation Tool   |
+--------------------------------------+
EOF
echo -e "${NC}"

log_info "Configuration:"
echo "  Environment: ${ENVIRONMENT}"
echo "  App URL:     ${APP_URL}"
echo "  Dry Run:     ${DRY_RUN}"
echo ""

# 本番環境の確認
if [[ "${ENVIRONMENT}" == "production" && "${DRY_RUN}" == false ]]; then
    log_warning "本番環境のシークレットキーをローテーションします"
    read -p "続行しますか? (yes/no): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log_info "キャンセルしました"
        exit 0
    fi
fi

# wrangler コマンドの存在確認
if ! command -v wrangler &> /dev/null; then
    log_error "wrangler が見つかりません。pnpm install を実行してください。"
    exit 1
fi

# ADMIN_API_KEY の取得
if [[ -z "${ADMIN_KEY}" ]]; then
    echo ""
    read -sp "ADMIN_API_KEY を入力してください: " ADMIN_KEY
    echo ""
    if [[ -z "${ADMIN_KEY}" ]]; then
        log_error "ADMIN_API_KEY が空です"
        exit 1
    fi
fi

# wrangler secret put のヘルパー（環境対応）
wrangler_secret_put() {
    local worker_dir="$1"
    local secret_name="$2"
    local secret_value="$3"

    if [[ "${DRY_RUN}" == true ]]; then
        log_info "[DRY RUN] wrangler secret put ${secret_name} (in $(basename "${worker_dir}"))"
        return 0
    fi

    echo "${secret_value}" | wrangler secret put "${secret_name}" --config "${worker_dir}/wrangler.jsonc"
}

# wrangler secret delete のヘルパー（環境対応）
wrangler_secret_delete() {
    local worker_dir="$1"
    local secret_name="$2"

    if [[ "${DRY_RUN}" == true ]]; then
        log_info "[DRY RUN] wrangler secret delete ${secret_name} (in $(basename "${worker_dir}"))"
        return 0
    fi

    # --force で確認プロンプトをスキップ
    wrangler secret delete "${secret_name}" --config "${worker_dir}/wrangler.jsonc" --force 2>/dev/null || true
}

# ステップ1: 新しいキーを生成
log_step "Step 1: 新しいシークレットキーを生成"
NEW_KEY=$(openssl rand -base64 32)
log_success "新しいキーを生成しました (${#NEW_KEY} chars)"

# ステップ2: 現在のキーを取得（wrangler secret list で存在確認）
log_step "Step 2: 現在のキーの存在を確認"

CURRENT_SECRETS=$(wrangler secret list --config "${APP_DIR}/wrangler.jsonc" 2>/dev/null || echo "")
if echo "${CURRENT_SECRETS}" | grep -q "WEBHOOK_SECRET_KEY"; then
    log_success "WEBHOOK_SECRET_KEY が設定済みです"
    HAS_CURRENT_KEY=true
else
    log_warning "WEBHOOK_SECRET_KEY が未設定です。初回設定として新キーのみ設定します。"
    HAS_CURRENT_KEY=false
fi

# ステップ3: 現在のキーを OLD に退避 + 新キーを設定
if [[ "${HAS_CURRENT_KEY}" == true ]]; then
    log_step "Step 3: 現在のキーを WEBHOOK_SECRET_KEY_OLD に退避"
    log_info "現在のキーの値を入力してください（wrangler secret list では値を取得できないため）"
    read -sp "現在の WEBHOOK_SECRET_KEY の値: " CURRENT_KEY
    echo ""

    if [[ -z "${CURRENT_KEY}" ]]; then
        log_error "現在のキーが空です"
        exit 1
    fi

    # household-app に OLD キーを設定
    log_info "household-app: WEBHOOK_SECRET_KEY_OLD を設定中..."
    wrangler_secret_put "${APP_DIR}" "WEBHOOK_SECRET_KEY_OLD" "${CURRENT_KEY}"
    log_success "household-app: WEBHOOK_SECRET_KEY_OLD 設定完了"

    # webhook-batch-cron に OLD キーを設定
    log_info "webhook-batch-cron: WEBHOOK_SECRET_KEY_OLD を設定中..."
    wrangler_secret_put "${CRON_DIR}" "WEBHOOK_SECRET_KEY_OLD" "${CURRENT_KEY}"
    log_success "webhook-batch-cron: WEBHOOK_SECRET_KEY_OLD 設定完了"
else
    log_step "Step 3: 初回設定（OLD キーの退避なし）"
fi

# ステップ4: 新キーを WEBHOOK_SECRET_KEY に設定
log_step "Step 4: 新しいキーを WEBHOOK_SECRET_KEY に設定"

log_info "household-app: WEBHOOK_SECRET_KEY を設定中..."
wrangler_secret_put "${APP_DIR}" "WEBHOOK_SECRET_KEY" "${NEW_KEY}"
log_success "household-app: WEBHOOK_SECRET_KEY 設定完了"

log_info "webhook-batch-cron: WEBHOOK_SECRET_KEY を設定中..."
wrangler_secret_put "${CRON_DIR}" "WEBHOOK_SECRET_KEY" "${NEW_KEY}"
log_success "webhook-batch-cron: WEBHOOK_SECRET_KEY 設定完了"

# 初回設定の場合はここで完了
if [[ "${HAS_CURRENT_KEY}" == false ]]; then
    echo ""
    log_step "完了"
    log_success "WEBHOOK_SECRET_KEY を初回設定しました"
    log_info "新しいキー: ${NEW_KEY}"
    log_warning "このキーは安全な場所に保管してください（次回ローテーション時に必要です）"
    exit 0
fi

# ステップ5: Workers をデプロイ（シークレット変更を反映）
log_step "Step 5: Workers をデプロイ（シークレット反映）"

if [[ "${DRY_RUN}" == true ]]; then
    log_info "[DRY RUN] wrangler deploy (household-app)"
    log_info "[DRY RUN] wrangler deploy (webhook-batch-cron)"
else
    log_info "household-app をデプロイ中..."
    cd "${APP_DIR}"
    wrangler deploy
    log_success "household-app デプロイ完了"

    log_info "webhook-batch-cron をデプロイ中..."
    cd "${CRON_DIR}"
    wrangler deploy
    log_success "webhook-batch-cron デプロイ完了"
fi

# ステップ6: 再暗号化APIを呼び出し
log_step "Step 6: DB内の暗号化データを再暗号化"

ROTATE_URL="${APP_URL}/api/admin/rotate-secret-key"
log_info "POST ${ROTATE_URL}"

if [[ "${DRY_RUN}" == true ]]; then
    log_info "[DRY RUN] curl -X POST ${ROTATE_URL} -H 'Authorization: Bearer ***'"
else
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${ROTATE_URL}" \
        -H "Authorization: Bearer ${ADMIN_KEY}" \
        -H "Content-Type: application/json")

    HTTP_CODE=$(echo "${RESPONSE}" | tail -n1)
    BODY=$(echo "${RESPONSE}" | sed '$d')

    if [[ "${HTTP_CODE}" == "200" ]]; then
        log_success "再暗号化完了"
        echo "${BODY}" | python3 -m json.tool 2>/dev/null || echo "${BODY}"
    elif [[ "${HTTP_CODE}" == "207" ]]; then
        log_warning "一部エラーあり (HTTP ${HTTP_CODE})"
        echo "${BODY}" | python3 -m json.tool 2>/dev/null || echo "${BODY}"
        log_error "エラーを確認してください。WEBHOOK_SECRET_KEY_OLD はまだ削除しません。"
        log_info "問題を解決後、再度このスクリプトを実行するか、手動で以下を実行:"
        echo "  curl -X POST ${ROTATE_URL} -H 'Authorization: Bearer <ADMIN_API_KEY>'"
        exit 1
    else
        log_error "再暗号化APIの呼び出しに失敗 (HTTP ${HTTP_CODE})"
        echo "${BODY}" | python3 -m json.tool 2>/dev/null || echo "${BODY}"
        log_error "WEBHOOK_SECRET_KEY_OLD はまだ削除しません。"
        log_info "問題を解決後、手動で再暗号化を実行してください:"
        echo "  curl -X POST ${ROTATE_URL} -H 'Authorization: Bearer <ADMIN_API_KEY>'"
        exit 1
    fi
fi

# ステップ7: WEBHOOK_SECRET_KEY_OLD を削除
log_step "Step 7: WEBHOOK_SECRET_KEY_OLD を削除"

log_info "household-app: WEBHOOK_SECRET_KEY_OLD を削除中..."
wrangler_secret_delete "${APP_DIR}" "WEBHOOK_SECRET_KEY_OLD"
log_success "household-app: WEBHOOK_SECRET_KEY_OLD 削除完了"

log_info "webhook-batch-cron: WEBHOOK_SECRET_KEY_OLD を削除中..."
wrangler_secret_delete "${CRON_DIR}" "WEBHOOK_SECRET_KEY_OLD"
log_success "webhook-batch-cron: WEBHOOK_SECRET_KEY_OLD 削除完了"

# 完了
echo ""
log_step "ローテーション完了"
log_success "全ステップが正常に完了しました"
echo ""
log_info "新しいキー: ${NEW_KEY}"
log_warning "このキーは安全な場所に保管してください（次回ローテーション時に必要です）"
echo ""
