# Maronn Household - 家計簿アプリ

月々の予算に対して支出を記録し、残り使える金額をリアルタイムで確認できる家計簿アプリ。
**通信環境が悪くても爆速で表示・操作できること**を最優先とした、ローカルファースト・アーキテクチャを採用。

## 特徴

- ⚡ **爆速表示**: 初回表示 < 500ms、残額更新 < 50ms
- 📴 **オフライン対応**: ネットワーク不要で全機能が動作
- 🔄 **自動同期**: バックグラウンドでサーバーと同期、デバイス間でリアルタイム共有
- 🧪 **TDD開発**: テストファーストで品質を担保

## 技術スタック

### フロントエンド
- React + Vike (SSR)
- Dexie.js (IndexedDB)
- TanStack Query

### バックエンド
- Hono + Cloudflare Workers
- D1 (SQLite)
- Drizzle ORM
- Durable Objects (リアルタイム同期)

### テスト
- Vitest (ユニット・コンポーネント)
- Playwright (E2E)

## プロジェクト構成

```
maronn-household/
├── apps/
│   └── web/              # Vike + React アプリ
├── packages/
│   ├── domain/           # ドメインロジック (純粋関数)
│   └── api/              # Hono API + Cloudflare Workers
└── e2e/                  # E2Eテスト
```

## セットアップ

### 前提条件
- Node.js 20+
- pnpm 8+

### インストール

```bash
pnpm install
```

### 開発サーバー起動

```bash
# Web アプリ
pnpm dev

# API (Cloudflare Workers)
pnpm --filter api dev
```

### テスト実行

```bash
# ユニット・コンポーネントテスト
pnpm test

# ウォッチモード
pnpm test:watch

# E2Eテスト
pnpm test:e2e
```

### ビルド

```bash
pnpm build
```

### デプロイ

**初回デプロイ:**

```bash
# 開発環境（D1セットアップ + デプロイ）
pnpm deploy:dev

# 本番環境（D1セットアップ + デプロイ）
pnpm deploy:prod
```

**継続的デプロイ（D1設定済みの場合）:**

```bash
# クイックデプロイ（ビルドとDB設定をスキップ）
pnpm deploy:quick

# フルデプロイ
pnpm deploy
```

**D1データベースのみセットアップ:**

```bash
# 開発環境
pnpm setup:d1

# 本番環境
pnpm setup:d1:prod
```

詳細は [scripts/README.md](./scripts/README.md) を参照してください。

## 開発フロー

このプロジェクトは **TDD (Test-Driven Development)** で開発します。

1. **Red**: 失敗するテストを書く
2. **Green**: テストを通す最小限のコードを書く
3. **Refactor**: リファクタリング（テストは通ったまま）

詳細は [CLAUDE.md](./CLAUDE.md) を参照してください。

## パフォーマンス目標

| 指標 | 目標値 |
|------|--------|
| 初回表示 (FCP) | < 500ms |
| 残額更新 | < 50ms |
| オフライン動作 | 100% 機能 |
| Lighthouse Performance | > 90 |

## ライセンス

Private
