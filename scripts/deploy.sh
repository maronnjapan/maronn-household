#!/usr/bin/env bash
# Cloudflare Workers + D1 デプロイスクリプト
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
APP_DIR="${PROJECT_ROOT}/apps/household-app"

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# ロゴ表示
print_logo() {
    echo -e "${CYAN}"
    cat << "EOF"
╔══════════════════════════════════════╗
║   Maronn Household - Deploy Tool    ║
║   Cloudflare Workers + D1            ║
╚══════════════════════════════════════╝
EOF
    echo -e "${NC}"
}

# ログ関数
log_info() {
    echo -e "${BLUE}ℹ ${NC}$1"
}

log_success() {
    echo -e "${GREEN}✓${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}⚠${NC} $1"
}

log_error() {
    echo -e "${RED}✗${NC} $1"
}

log_step() {
    echo ""
    echo -e "${CYAN}▶ $1${NC}"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
}

# 使い方表示
usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy Cloudflare Workers with D1 database setup

OPTIONS:
    -e, --env <environment>    Environment to deploy (dev or production)
                               Default: dev
    -s, --skip-db              Skip D1 database setup
    -b, --skip-build           Skip build step
    -h, --help                 Show this help message

EXAMPLES:
    # Deploy to development
    $0

    # Deploy to production
    $0 --env production

    # Deploy without setting up D1 (if already configured)
    $0 --skip-db

    # Quick deploy (skip build and DB setup)
    $0 --skip-build --skip-db
EOF
}

# デフォルト値
ENVIRONMENT="dev"
SKIP_DB=false
SKIP_BUILD=false

# 引数解析
while [[ $# -gt 0 ]]; do
    case $1 in
        -e|--env)
            ENVIRONMENT="$2"
            shift 2
            ;;
        -s|--skip-db)
            SKIP_DB=true
            shift
            ;;
        -b|--skip-build)
            SKIP_BUILD=true
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

# 環境変数チェック
if [[ "${ENVIRONMENT}" != "dev" && "${ENVIRONMENT}" != "production" ]]; then
    log_error "Invalid environment: ${ENVIRONMENT}"
    log_info "Environment must be 'dev' or 'production'"
    exit 1
fi

# ロゴ表示
print_logo

log_info "Deployment Configuration:"
echo "  Environment: ${ENVIRONMENT}"
echo "  Skip DB Setup: ${SKIP_DB}"
echo "  Skip Build: ${SKIP_BUILD}"
echo ""

# 確認プロンプト（本番環境の場合）
if [ "${ENVIRONMENT}" = "production" ]; then
    log_warning "You are about to deploy to PRODUCTION"
    read -p "Are you sure? (yes/no): " -r
    echo
    if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
        log_info "Deployment cancelled"
        exit 0
    fi
fi

# ステップ1: ビルド
if [ "${SKIP_BUILD}" = false ]; then
    log_step "Step 1: Building project"
    cd "${PROJECT_ROOT}"

    log_info "Running type check..."
    pnpm typecheck || {
        log_error "Type check failed"
        exit 1
    }
    log_success "Type check passed"

    log_info "Building packages..."
    pnpm build || {
        log_error "Build failed"
        exit 1
    }
    log_success "Build completed"
else
    log_step "Step 1: Build (Skipped)"
fi

# ステップ2: D1セットアップ
if [ "${SKIP_DB}" = false ]; then
    log_step "Step 2: Setting up D1 Database"

    if [ ! -f "${SCRIPT_DIR}/setup-d1.sh" ]; then
        log_error "setup-d1.sh not found"
        exit 1
    fi

    bash "${SCRIPT_DIR}/setup-d1.sh" "${ENVIRONMENT}" || {
        log_error "D1 setup failed"
        exit 1
    }
else
    log_step "Step 2: D1 Setup (Skipped)"
fi

# ステップ3: Workers デプロイ
log_step "Step 3: Deploying Cloudflare Workers"

cd "${APP_DIR}"

if [ "${ENVIRONMENT}" = "production" ]; then
    log_info "Deploying to production..."
    pnpm dlx wrangler deploy --env production || {
        log_error "Production deployment failed"
        exit 1
    }
    log_success "Deployed to production successfully"
else
    log_info "Deploying to development..."
    pnpm dlx wrangler deploy || {
        log_error "Development deployment failed"
        exit 1
    }
    log_success "Deployed to development successfully"
fi

# 完了メッセージ
echo ""
log_step "Deployment Complete! 🎉"

if [ "${ENVIRONMENT}" = "production" ]; then
    log_success "Your app is now live in production"
    log_info "Worker URL: https://maronn-household-api-production.<your-subdomain>.workers.dev"
else
    log_success "Your app is deployed to development"
    log_info "Worker URL: https://maronn-household-api.<your-subdomain>.workers.dev"
fi

echo ""
log_info "Next steps:"
echo "  • Test your API endpoints"
echo "  • Monitor logs: wrangler tail"
echo "  • Check metrics in Cloudflare dashboard"
echo ""
