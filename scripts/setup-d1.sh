#!/usr/bin/env bash
# D1データベースのセットアップスクリプト
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
API_DIR="${PROJECT_ROOT}/packages/api"

# 色定義
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

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

# 引数チェック
if [ $# -lt 1 ]; then
    log_error "Usage: $0 <environment>"
    echo "  environment: dev or production"
    exit 1
fi

ENVIRONMENT="$1"
DB_NAME="maronn-household"

if [ "${ENVIRONMENT}" = "production" ]; then
    DB_NAME="maronn-household-production"
fi

cd "${API_DIR}"

log_info "Setting up D1 database for ${ENVIRONMENT} environment..."
log_info "Database name: ${DB_NAME}"

# D1データベースが既に存在するかチェック
log_info "Checking if database already exists..."
if wrangler d1 list | grep -q "${DB_NAME}"; then
    log_warning "Database '${DB_NAME}' already exists. Skipping creation."

    # 既存のdatabase_idを取得
    DB_ID=$(wrangler d1 list | grep "${DB_NAME}" | awk '{print $2}')
    log_info "Using existing database ID: ${DB_ID}"
else
    # D1データベースを作成
    log_info "Creating new D1 database '${DB_NAME}'..."
    CREATE_OUTPUT=$(wrangler d1 create "${DB_NAME}")

    # database_idを抽出
    DB_ID=$(echo "${CREATE_OUTPUT}" | grep "database_id" | sed -E 's/.*"([^"]+)".*/\1/')

    if [ -z "${DB_ID}" ]; then
        log_error "Failed to extract database_id from creation output"
        exit 1
    fi

    log_success "Database created with ID: ${DB_ID}"

    # wrangler.tomlを更新
    log_info "Updating wrangler.toml with database_id..."

    if [ "${ENVIRONMENT}" = "production" ]; then
        # 本番環境用の設定を追加（環境変数セクションに追加）
        if ! grep -q "^\[env\.production\.d1_databases\]" wrangler.toml; then
            cat >> wrangler.toml << EOF

# Production D1 Database
[[env.production.d1_databases]]
binding = "DB"
database_name = "${DB_NAME}"
database_id = "${DB_ID}"
EOF
            log_success "Added production database configuration to wrangler.toml"
        else
            # 既存の設定を更新
            sed -i "/^\[env\.production\.d1_databases\]/,/^database_id/ s/database_id = .*/database_id = \"${DB_ID}\"/" wrangler.toml
            log_success "Updated production database_id in wrangler.toml"
        fi
    else
        # 開発環境のdatabase_idを更新
        sed -i "/^\[\[d1_databases\]\]/,/^database_id/ s/database_id = .*/database_id = \"${DB_ID}\"/" wrangler.toml
        log_success "Updated database_id in wrangler.toml"
    fi
fi

# マイグレーション実行
log_info "Running migrations..."

if [ "${ENVIRONMENT}" = "production" ]; then
    # 本番環境へのマイグレーション
    for migration in migrations/*.sql; do
        if [ -f "$migration" ]; then
            log_info "Applying migration: $(basename "$migration")"
            wrangler d1 execute "${DB_NAME}" --remote --file="$migration"
        fi
    done
else
    # 開発環境へのマイグレーション
    for migration in migrations/*.sql; do
        if [ -f "$migration" ]; then
            log_info "Applying migration: $(basename "$migration")"
            wrangler d1 execute "${DB_NAME}" --local --file="$migration" 2>/dev/null || \
            wrangler d1 execute "${DB_NAME}" --file="$migration"
        fi
    done
fi

log_success "Migrations completed successfully"

# テーブル確認
log_info "Verifying tables..."
if [ "${ENVIRONMENT}" = "production" ]; then
    wrangler d1 execute "${DB_NAME}" --remote --command="SELECT name FROM sqlite_master WHERE type='table';"
else
    wrangler d1 execute "${DB_NAME}" --local --command="SELECT name FROM sqlite_master WHERE type='table';" 2>/dev/null || \
    wrangler d1 execute "${DB_NAME}" --command="SELECT name FROM sqlite_master WHERE type='table';"
fi

log_success "D1 database setup complete!"
echo ""
log_info "Database Name: ${DB_NAME}"
log_info "Database ID: ${DB_ID}"
log_info "Environment: ${ENVIRONMENT}"
