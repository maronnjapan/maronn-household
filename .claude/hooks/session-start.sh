#!/bin/bash
set -euo pipefail

# Only run in Claude Code on the web
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

echo "🚀 Setting up development environment..."

# Install pnpm dependencies
echo "📦 Installing pnpm dependencies..."
if [ -f "pnpm-lock.yaml" ]; then
  pnpm install --frozen-lockfile
else
  pnpm install
fi

# Install GitHub CLI if not already installed
if ! command -v gh &> /dev/null; then
  echo "📥 Installing GitHub CLI..."

  # Try apt-get first (works better in some environments)
  if command -v apt-get &> /dev/null; then
    # Update package list only if needed (check cache age)
    if [ ! -f /var/lib/apt/periodic/update-success-stamp ] || \
       [ $(find /var/lib/apt/periodic/update-success-stamp -mmin +60 2>/dev/null | wc -l) -gt 0 ]; then
      echo "  Updating package list..."
      sudo apt-get update -qq 2>/dev/null || true
    fi

    # Try to install gh from apt
    if sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq gh 2>/dev/null; then
      echo "✅ GitHub CLI installed via apt-get"
    else
      echo "⚠️  apt-get installation failed, trying direct download..."

      # Fallback: Download gh CLI binary
      GH_VERSION="2.62.0"
      GH_ARCH="linux_amd64"
      GH_TAR="gh_${GH_VERSION}_${GH_ARCH}.tar.gz"
      GH_URL="https://github.com/cli/cli/releases/download/v${GH_VERSION}/${GH_TAR}"

      TMP_DIR=$(mktemp -d)
      cd "$TMP_DIR"

      if curl -fsSL "$GH_URL" -o "$GH_TAR" 2>/dev/null; then
        tar -xzf "$GH_TAR"
        if [ -w /usr/local/bin ]; then
          cp "gh_${GH_VERSION}_${GH_ARCH}/bin/gh" /usr/local/bin/
          chmod +x /usr/local/bin/gh
        else
          sudo cp "gh_${GH_VERSION}_${GH_ARCH}/bin/gh" /usr/local/bin/
          sudo chmod +x /usr/local/bin/gh
        fi
        cd - > /dev/null
        rm -rf "$TMP_DIR"
        echo "✅ GitHub CLI installed via direct download"
      else
        cd - > /dev/null
        rm -rf "$TMP_DIR"
        echo "⚠️  Failed to install GitHub CLI, continuing without it..."
      fi
    fi
  else
    echo "⚠️  apt-get not available, skipping GitHub CLI installation..."
  fi
else
  echo "✅ GitHub CLI already installed"
fi

echo "✨ Development environment ready!"
