#!/usr/bin/env bash
# シークレットキーのローテーションスクリプト
#
# 実行するだけでローテーションが完了する:
#   bash scripts/rotate-webhook-secret.sh
#   bash scripts/rotate-webhook-secret.sh --env production
#
# 処理フロー:
#   1. 新しいシークレットキーを生成（WEBHOOK_SECRET_KEY + ADMIN_API_KEY）
#   2. ADMIN_API_KEY を先に wrangler で更新
#   3. 新しい ADMIN_API_KEY でローテーションAPIを呼び出し（DB再暗号化）
#   4. WEBHOOK_SECRET_KEY を全Workerで更新
#
# 手動入力は一切不要。スクリプト実行者 = wrangler アクセス権のある管理者。
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

WEBHOOK_SECRET_KEY と ADMIN_API_KEY をローテーションします。
手動入力は一切不要です。

OPTIONS:
    -e, --env <env>        環境 (dev or production)。デフォルト: dev
    --app-url <url>        アプリのベースURL（省略時は環境から自動判定）
    --dry-run              実際の変更を行わず、手順だけ表示する
    -h, --help             このヘルプを表示

EXAMPLES:
    # 開発環境でローテーション
    $0

    # 本番環境でローテーション
    $0 --env production

    # ドライラン（手順確認のみ）
    $0 --dry-run
EOF
}

# デフォルト値
ENVIRONMENT="dev"
APP_URL=""
DRY_RUN=false

# 引数解析
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--env)
            ENVIRONMENT="$2"
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

# wrangler secret put のヘルパー
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

# ステップ1: 新しいキーを生成
log_step "Step 1: 新しいシークレットキーを生成"
NEW_WEBHOOK_KEY=$(openssl rand -base64 32)
NEW_ADMIN_KEY=$(openssl rand -base64 32)
log_success "WEBHOOK_SECRET_KEY 用の新しいキーを生成しました"
log_success "ADMIN_API_KEY 用の新しいキーを生成しました"

# ステップ2: ADMIN_API_KEY を先に更新
# wrangler secret put で更新すると次のリクエストから新しい値が使われる
log_step "Step 2: ADMIN_API_KEY を更新"

log_info "household-app: ADMIN_API_KEY を更新中..."
wrangler_secret_put "${APP_DIR}" "ADMIN_API_KEY" "${NEW_ADMIN_KEY}"
log_success "household-app: ADMIN_API_KEY 更新完了"

# ステップ3: 新しい ADMIN_API_KEY でローテーションAPIを呼び出し
# サーバーが現在の env.WEBHOOK_SECRET_KEY を旧キーとして使い、
# リクエストボディの newKey で全データを再暗号化する
log_step "Step 3: DB内の暗号化データを再暗号化（ローテーションAPI）"

ROTATE_URL="${APP_URL}/api/admin/rotate-secret-key"
log_info "POST ${ROTATE_URL}"

if [[ "${DRY_RUN}" == true ]]; then
    log_info "[DRY RUN] curl -X POST ${ROTATE_URL} -H 'Authorization: Bearer ***' -d '{\"newKey\": \"***\"}'"
else
    RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${ROTATE_URL}" \
        -H "Authorization: Bearer ${NEW_ADMIN_KEY}" \
        -H "Content-Type: application/json" \
        -d "{\"newKey\": \"${NEW_WEBHOOK_KEY}\"}")

    HTTP_CODE=$(echo "${RESPONSE}" | tail -n1)
    BODY=$(echo "${RESPONSE}" | sed '$d')

    if [[ "${HTTP_CODE}" == "200" ]]; then
        log_success "再暗号化完了"
        echo "${BODY}" | python3 -m json.tool 2>/dev/null || echo "${BODY}"
    elif [[ "${HTTP_CODE}" == "207" ]]; then
        log_warning "一部エラーあり (HTTP ${HTTP_CODE})"
        echo "${BODY}" | python3 -m json.tool 2>/dev/null || echo "${BODY}"
        log_error "エラーを確認してください。WEBHOOK_SECRET_KEY はまだ更新しません。"
        exit 1
    else
        log_error "再暗号化APIの呼び出しに失敗 (HTTP ${HTTP_CODE})"
        echo "${BODY}" | python3 -m json.tool 2>/dev/null || echo "${BODY}"
        log_error "WEBHOOK_SECRET_KEY はまだ更新しません。"
        exit 1
    fi
fi

# ステップ4: WEBHOOK_SECRET_KEY を全Workerで更新
log_step "Step 4: WEBHOOK_SECRET_KEY を更新"

log_info "household-app: WEBHOOK_SECRET_KEY を更新中..."
wrangler_secret_put "${APP_DIR}" "WEBHOOK_SECRET_KEY" "${NEW_WEBHOOK_KEY}"
log_success "household-app: WEBHOOK_SECRET_KEY 更新完了"

log_info "webhook-batch-cron: WEBHOOK_SECRET_KEY を更新中..."
wrangler_secret_put "${CRON_DIR}" "WEBHOOK_SECRET_KEY" "${NEW_WEBHOOK_KEY}"
log_success "webhook-batch-cron: WEBHOOK_SECRET_KEY 更新完了"

# 完了
echo ""
log_step "ローテーション完了"
log_success "全ステップが正常に完了しました"
echo ""
