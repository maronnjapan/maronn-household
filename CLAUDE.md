# 家計簿アプリ — CLAUDE.md

## ツール役割分担

| ツール | 担当 |
|---|---|
| Claude Code | 全フェーズの進行・最終判断 |
| Codex CLI | 設計協議・コードレビュー（セカンドオピニオン） |
| Gemini CLI | 技術仕様調査・外部ドキュメント調査 |

## 開発ワークフロー

機能追加・修正の依頼を受けたとき、以下のフェーズ通りに原則実行する。
基本的にフェーズを順番通りに実行することを求めるが、依頼内容が軽微であり調査や設計が不要だと感じれば省略してもよい。
ただし、省略した場合は必ず省略したフェーズと省略した理由をユーザーに提示すること。
ユーザーへの確認は⑦の完了レポートまで行わない。

### ① 調査フェーズ
- 関連する既存コードをすべて読む
- Vikeの制約・Honoのルーティング・D1のスキーマを確認する
- 技術的に不明な仕様があれば `/tech-research` スキルでGeminiに調査させる

### ② 設計フェーズ（Claude起案）
- 実装方針のドラフトを作る
- ファイル構成・関数の責務・データの流れを箇条書きで言語化する

### ③ 設計協議フェーズ（Claude × Codex）
- `/design-discussion` スキルを使ってCodexに設計ドラフトを渡す
- Codexの意見をもとにClaudeが設計を再評価する
- 合意できた方針を「確定設計」として記録してから実装に進む

### ④ テスト先行実装フェーズ
- テストを先に書いてから実装する（TDD / Red → Green → Refactor）
- モックは原則使わない
- テストが通ることを確認してから次に進む
- テストが3回修正しても通らなければ実装を止め、⑦で報告する

### ⑤ コードレビュー（Claude × Codex）
- `/design-discussion` スキルを使ってCodexに実装済みコードを渡す
- Codexの指摘をClaudeが評価し、修正する箇所・しない箇所を判断する
- 修正がある場合はテストを再実行して通ることを確認する

### ⑥ セルフレビューフェーズ
- 設計との整合・可読性・エラーハンドリングを最終確認する

### ⑦ 完了レポート

```
## 実装内容
（何を実装したか、1〜3行で）

## 変更ファイル
- path/to/file.ts: （変更内容）
- path/to/test.ts: （テスト内容）

## テスト結果
（通過したテスト数）

## 省略したフェーズ（省略がない場合も「なし」と明記すること）
- フェーズ名: 省略した理由
  例) ① /tech-research: 既存コードに仕様が実装済みのため調査不要と判断

## 設計協議の結果
- Codexの主な意見: （要約）
- 採用した意見: （内容）
- 採用しなかった意見: （内容と理由）

## 判断が必要な点（あれば）
（AIだけでは解決できなかった点）
```

## AIだけでは解決しないこと

以下の状況になったら実装を止めて⑦に記載する:
- Vikeの挙動が不明で調査しても解決しない
- D1のスキーマ変更がデータ移行を伴う
- 認証まわりの設計判断が必要
- テストが3回修正しても通らない

---

## モノレポ構造

```
apps/
├── household-app/         # メインアプリ（Vike + Hono + Cloudflare Workers）
│   ├── server/            # Honoサーバーエントリ・ハンドラー群
│   ├── pages/             # Vikeページ（+Page.tsx, +Layout.tsx）
│   ├── components/        # Reactコンポーネント
│   ├── hooks/             # カスタムフック
│   ├── trpc/              # tRPCルーター定義
│   ├── auth/              # Better Auth設定
│   └── database/migrations/ # D1マイグレーションSQL
├── mcp-server/            # MCP（Model Context Protocol）サーバー（Cloudflare Workers）
├── delete-expired-session-cron/   # セッション削除バッチ
├── delete-no-user-household-data-cron/ # 孤立データ削除バッチ
└── webhook-batch-cron/    # Webhookバッチ実行cron

packages/
├── db-schema/             # @maronn/db-schema: Drizzle ORMスキーマ（全アプリ共通）
└── domain/                # @maronn/domain: ドメインロジック（純粋関数）
```

### サーバーアーキテクチャ

`household-app` は **Photon.js**（`@photonjs/hono`）を使ってVike（SSR）とHonoを統合している。`server/entry.ts` がエントリポイントで、`apply()` でミドルウェア・ハンドラーを登録し `serve()` でCloudflare Workers向けにエクスポートする。

ルーティング:
- `/api/auth/*` → Better Auth（認証）
- `/api/trpc/*` → tRPCハンドラー
- `/api/v1/export/*` → エクスポートAPI（トークン認証）
- `/oauth/*` → MCP用 OAuth 2.1 認可サーバー
- それ以外 → Vikeが処理（SSR）

## プロジェクト概要

月々の予算に対して支出を記録し、残り使える金額をリアルタイムで確認できる家計簿アプリ。通信環境が悪くても爆速で表示・操作できることを最優先とする。

## 設計思想

### ローカルファースト・アーキテクチャ

すべてのデータ操作はローカル（IndexedDB）を起点とし、サーバー同期はバックグラウンドで行う。

```
[ユーザー操作]
    ↓ 即座に
[IndexedDB] → UI更新（< 50ms）
    ↓ 非同期
[バックグラウンド同期] → サーバーDB
    ↓ 非同期
[他デバイスへ伝播]
```

ネットワークを待つ瞬間をゼロにする。

### 爆速表示の原則

1. 初回表示はローカルDBから取得（ネットワーク不要）
2. 入力操作は即座にローカル反映 → 残額は瞬時に更新
3. サーバー同期の成否はUIをブロックしない
4. オフラインでも全機能が動作する

## 技術スタック

### フロントエンド

| 技術 | 選定理由 |
|------|----------|
| React | エコシステムの充実、TDDとの相性 |
| Vike (vite-plugin-ssr) | ストリーミングSSR対応、Honoとの統合が容易 |
| Dexie.js | IndexedDBのラッパー、useLiveQueryでリアクティブ更新 |
| TanStack Query | サーバー同期のキャッシュ管理、Optimistic Updates |

### バックエンド

| 技術 | 選定理由 |
|------|----------|
| Hono | 軽量、エッジランタイム対応、TypeScript first |
| Cloudflare Workers | エッジ実行でレイテンシ最小化 |
| Cloudflare D1 | エッジに近いSQLite、Workersとの統合が容易 |
| Drizzle ORM | 型安全、軽量、D1対応 |

### 同期・リアルタイム

| 技術 | 選定理由 |
|------|----------|
| Cloudflare Durable Objects | デバイス間リアルタイム同期、競合解決 |
| WebSocket | 他デバイスへの変更プッシュ |

### 認証

**Google OAuth のみ対応**

Better Auth + Google OAuth を使用。メール/パスワード認証は非対応。

#### 必要な環境変数

```bash
BETTER_AUTH_SECRET=<ランダムな秘密鍵（32文字以上推奨）>
BETTER_AUTH_URL=<アプリのベースURL（例: https://example.com）>
GOOGLE_CLIENT_ID=<Google Cloud Consoleで取得>
GOOGLE_CLIENT_SECRET=<Google Cloud Consoleで取得>
```

#### ファイル構成

```
apps/household-app/
├── auth/
│   ├── config.ts       # Better Auth サーバー設定（Googleプロバイダー）
│   └── client.ts       # クライアント用関数（signInWithGoogle, signOut）
├── pages/
│   └── auth/
│       └── login/
│           └── +Page.tsx   # Googleログインボタンのみ
└── hooks/
    └── use-auth.ts     # 認証状態フック
```

### テスト

| 技術 | 用途 |
|------|------|
| Vitest | ユニットテスト、ドメインロジック |
| Testing Library | UIコンポーネントテスト |
| Playwright | E2Eテスト |
| MSW | APIモック |

## データモデル

### ローカル（IndexedDB / Dexie）

```typescript
interface Expense {
  id: string;           // ULID（ソート可能なユニークID）
  amount: number;
  category?: string;
  memo?: string;
  date: string;         // ISO 8601
  createdAt: string;
  updatedAt: string;
  syncStatus: 'pending' | 'synced' | 'conflict';
  deviceId: string;     // 競合解決用
}

interface Budget {
  id: string;
  month: string;        // 'YYYY-MM'
  amount: number;
  updatedAt: string;
}

interface SyncMeta {
  id: 'main';
  lastSyncedAt: string;
  deviceId: string;
}
```

### サーバー（D1 / Drizzle）

スキーマは `packages/db-schema/src/` で管理し、`@maronn/db-schema` パッケージとして各アプリから参照する。

主なテーブル（`packages/db-schema/src/household.ts`）:
- `expenses`: 支出記録（`subBudgetId` フィールドあり）
- `budgets`: 月次予算
- `subBudgets` / `subBudgetMonthlyAmounts`: サブ予算
- `apiTokens` / `apiUsage`: エクスポートAPI用トークン管理
- `webhooks` / `webhookBatchSchedules`: Webhook設定

Better Auth 関連テーブルは `packages/db-schema/src/auth.ts`、MCP OAuth は `packages/db-schema/src/mcp-oauth.ts` で管理。

## 同期戦略

### マージ方式（両方の入力を残す）

```typescript
interface SyncResult {
  toUpload: Expense[];
  toDownload: Expense[];
  conflicts: ConflictPair[];
}

interface ConflictPair {
  local: Expense;
  remote: Expense;
  resolution: 'keep-both' | 'keep-local' | 'keep-remote';
}

function resolveConflicts(local: Expense[], remote: Expense[]): SyncResult {
  // 同一IDで updatedAt が異なる場合:
  // - 支出（Expense）: 両方残す（IDを振り直して2件に）
  // - 予算（Budget）: updatedAt が新しい方を採用
}
```

### 同期フロー

```
1. アプリ起動時
   └── ローカルから即表示 → バックグラウンドで差分同期

2. 支出入力時
   └── ローカル保存（syncStatus: 'pending'）→ 即座にUI更新
   └── バックグラウンドでサーバー送信
   └── 成功したら syncStatus: 'synced'

3. オンライン復帰時（navigator.onLine）
   └── pending な全件を一括送信
   └── サーバーから差分取得

4. 他デバイスからの更新（WebSocket / Durable Objects）
   └── 差分をローカルにマージ → useLiveQuery で自動UI更新
```

## TDD 開発フロー

twada 流 TDD を全レイヤーで適用する。

### Red → Green → Refactor サイクル

```
1. Red:    失敗するテストを書く
2. Green:  テストを通す最小限のコードを書く
3. Refactor: リファクタリング（テストは通ったまま）
```

### テストの書き方

#### ドメインロジック（packages/domain）

```typescript
describe('calculateRemaining', () => {
  it('予算から支出合計を引いた残額を返す', () => {
    const budget = 100000;
    const expenses = [{ amount: 3000 }, { amount: 5000 }];
    expect(calculateRemaining(budget, expenses)).toBe(92000);
  });
});
```

#### UIコンポーネント（apps/web）

```typescript
describe('ExpenseInput', () => {
  it('金額を入力して追加すると残額が減る', async () => {
    const user = userEvent.setup();
    render(<ExpenseInput initialBudget={100000} />);
    await user.type(screen.getByPlaceholderText('金額'), '3000');
    await user.click(screen.getByRole('button', { name: '追加' }));
    expect(screen.getByText('残り: ¥97,000')).toBeInTheDocument();
  });
});
```

#### E2E（e2e/）

```typescript
test('支出を入力すると残額がリアルタイムで更新される', async ({ page }) => {
  await page.goto('/');
  await page.getByPlaceholder('金額').fill('5000');
  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByText('残り: ¥95,000')).toBeVisible();
});

test('オフラインでも支出入力ができる', async ({ page, context }) => {
  await page.goto('/');
  await context.setOffline(true);
  await page.getByPlaceholder('金額').fill('3000');
  await page.getByRole('button', { name: '追加' }).click();
  await expect(page.getByText('残り: ¥97,000')).toBeVisible();
});
```

### テストピラミッド

ドメインロジックのユニットテストを厚く、E2Eは重要なユーザーフローに絞る。

## コーディング規約

### 全般

- TypeScript strict モード必須
- 関数は可能な限り純粋関数として実装
- 副作用は hooks または専用モジュールに分離
- `any` 禁止、`unknown` + 型ガードを使用

### CSS / スタイリング

相対単位を優先使用。

| 単位 | 用途 |
|------|------|
| `rem` | フォントサイズ、余白、サイズ全般（基本） |
| `em` | 親要素のフォントサイズに比例させたい場合 |
| `%` | 親要素に対する相対的な幅・高さ |
| `vw` / `vh` | ビューポート基準のサイズ |
| `min()` / `max()` | 上限・下限の設定 |

例外的に `px` が許可される場合: `border-width`、`box-shadow` のぼかし半径、メディアクエリ。

### 命名規則

```typescript
// ファイル名: kebab-case
expense-input.tsx

// 関数・変数: camelCase
function calculateRemaining() {}

// 型・インターフェース: PascalCase
interface Expense {}

// 定数: UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
```

### React パターン

**useEffect 使用禁止**。副作用の管理は以下を優先する:

1. データフェッチ: TanStack Query の `useQuery`, `useMutation`
2. モジュールレベル初期化: ブラウザ環境チェック付きでモジュールロード時に実行

**useCallback / useMemo は原則使用しない**。React Compiler による自動メモ化を使う。

### エラーハンドリング

try-catch は最小限に。予期しないエラーはそのまま上位に伝播させ、グローバルエラーハンドラー（Hono の `onError`、React ErrorBoundary）で一元管理する。

## パフォーマンス目標

| 指標 | 目標値 |
|------|--------|
| 初回表示（FCP） | < 500ms |
| 残額更新（入力後） | < 50ms |
| オフライン時の動作 | 100%機能 |
| Lighthouse Performance | > 90 |

### /household ページの表示速度優先ルール

**最優先**: 金額入力フィールドの即座表示とIndexedDB保存。

- `global.css` には `/household` ページ以外のスタイルを含めない
- 予算・残額の表示は後回しでよい。入力フィールドが表示されれば「表示完了」

## 開発コマンド

```bash
# 開発（各アプリは個別に起動）
pnpm dev              # 開発サーバー起動（household-app、port 3000）
# auth-server と mcp-server は apps/ 内で個別に起動:
#   cd apps/auth-server && pnpm dev   # port 3001
#   cd apps/mcp-server  && pnpm dev   # port 8787（wrangler デフォルト）
pnpm test             # ユニット + コンポーネント（Vitest）
pnpm test:e2e         # E2Eテスト（Playwright）
pnpm test:watch       # ウォッチモード
pnpm typecheck        # 全パッケージの型チェック
pnpm lint             # ESLintリント
pnpm lint:fix         # ESLintリント + 自動修正
pnpm format           # Prettierフォーマット

# DBマイグレーション（apps/household-app 内で実行）
pnpm drizzle:generate:household  # household テーブルのマイグレーション生成
pnpm drizzle:generate:auth       # Better Auth テーブルのマイグレーション生成
pnpm drizzle:migrate             # ローカルD1にマイグレーション適用
pnpm drizzle:migrate:remote      # リモートD1にマイグレーション適用
pnpm drizzle:studio              # Drizzle Studio（DB GUI）

# デプロイ
pnpm deploy           # デプロイ（スクリプト経由）
pnpm deploy:prod      # 本番環境デプロイ
pnpm deploy:dev       # 開発環境デプロイ
pnpm deploy:quick     # ビルド・DBスキップの高速デプロイ
```

## 実装済み機能

### MCP OAuth 認可サーバー（`apps/auth-server/`）

household-app から切り出した独立した Cloudflare Worker。MCP クライアント（Claude Desktop 等）専用の認証基盤。

#### 設計方針

- household-app の Web ログインとは**独立したセッション**を持つ（MCP OAuth フロー専用）
- 同じ D1（`household-db`）を共有するため、同一 Google アカウントで認証すると同じ `user_id` を持つ
- D1 マイグレーションは `apps/household-app/database/migrations/` で一元管理

#### エンドポイント

| パス | 説明 |
|------|------|
| `GET /.well-known/oauth-authorization-server` | RFC 8414 AS メタデータ |
| `POST /oauth/register` | RFC 7591 動的クライアント登録 |
| `GET /oauth/authorize` | 認可エンドポイント（PKCE 必須）|
| `POST /oauth/token` | トークンエンドポイント |
| `/api/auth/*` | Better Auth（Google OAuth） |

#### 環境変数（`.dev.vars`）

```
AUTH_SERVER_URL=http://localhost:3001
BETTER_AUTH_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
```

#### 本番デプロイ前の追加作業

- Google Cloud Console に `https://auth.maronn-household-budget.com/api/auth/callback/google` を追加
- `wrangler.jsonc` に `routes`（`auth.maronn-household-budget.com`）を追加

### MCP サーバー（`apps/mcp-server/`）

OAuth Resource Server として Bearer トークンを検証し、MCP Protocol（Streamable HTTP）でツールを提供する。

- 認可サーバーは `apps/auth-server/` を参照（環境変数 `AUTH_SERVER_URL`）
- `/.well-known/oauth-protected-resource` で RFC 9728 準拠のメタデータを返す
- ローカル開発: `AUTH_SERVER_URL=http://localhost:3001`（auth-server と別ポートで起動）

### 月次予算設定機能

#### 設計方針

- **支出記録**: ローカルファースト（IndexedDB → サーバー同期）
- **予算設定**: サーバーのみで管理（IndexedDBとの二重管理を避ける）

ネットワークエラー時はデフォルト予算（120,000円）を使用し、支出記録の表示はブロックしない。

#### API エンドポイント（`apps/household-app/trpc/`）

```typescript
// 予算取得
getBudget: publicProcedure
  .input(z.object({ month: z.string() }))
  .query(async (opts) => { /* D1 から指定月の予算を取得 */ });

// 予算更新
updateBudget: publicProcedure
  .input(z.object({ month: z.string(), amount: z.number() }))
  .mutation(async (opts) => { /* D1 に予算を保存 */ });
```

#### 注意事項

- 予算はサーバーのみで管理（IndexedDBには保存しない）
- 月単位（YYYY-MM形式）で管理
- 競合解決: `updatedAt` が新しい方を採用（Last Write Wins）