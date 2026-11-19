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
├── gateway/               # household-gateway: 全リクエストの入口（ドメインのルートを唯一持つ）。パスで各 Worker へ振り分け
├── auth-server/           # household-auth: 認証基盤（OpenID Provider、maronn-openid-connect）。アプリのログインと MCP の OAuth
│   ├── src/oidc-provider/ # CLI（@maronn-openid-connect/cli 0.17.0）の生成コード。手で編集しない（db/instance.ts のみ自前）
│   └── src/*.ts           # 差し込み部品（Google ログイン、既存 user/account のユーザーストア、D1 の DCR ストア、署名鍵、画面、定期削除）
├── mcp-server/            # household-mcp: MCP サーバー（レシートの記録・家計データの参照、~120行）
├── household-app/         # household-app: メインアプリ（Vike + Hono）。認証基盤の RP
│   ├── server/            # Honoサーバーエントリ・ハンドラー群（session/ がログイン・ログアウト）
│   ├── pages/             # Vikeページ（+Page.tsx, +Layout.tsx）
│   ├── components/        # Reactコンポーネント
│   ├── hooks/             # カスタムフック
│   ├── trpc/              # tRPCルーター定義
│   ├── auth/              # ログイン状態のクライアント（/api/session）
│   ├── integration/       # 認証基盤と組み合わせた結合テスト
│   └── database/migrations/ # D1マイグレーションSQL（全 Worker 共通の household-db）
├── delete-no-user-household-data-cron/ # 孤立データ削除バッチ
└── webhook-batch-cron/    # Webhookバッチ実行cron

packages/
├── db-schema/             # @maronn/db-schema: Drizzle ORMスキーマ（全アプリ共通）
├── domain/                # @maronn/domain: ドメインロジック（純粋関数。レシートの按分など）
├── household-store/       # @maronn/household-store: 家計データ（支出・予算・レシート）の D1 読み書き
├── oauth-resource/        # @maronn/oauth-resource: 認証基盤のトークンで守る API の共通部品（RFC 9728、Bearer 検証）
└── test-utils/            # @maronn/test-utils: 全マイグレーションを適用したローカル D1（Miniflare）
```

### サーバーアーキテクチャ

単一ホスト `maronn-household-budget.com` の全リクエストを `household-gateway` が受け、パスで service binding 先を決める（`apps/gateway/src/routes.ts`）。
他の Worker はルートも workers.dev も持たない。Worker 間の通信も service binding（同じゾーンの URL への fetch は Worker を経由しないため）。

| パス | 行き先 |
|---|---|
| `/authorize` `/token` `/userinfo` `/login` `/login/*` `/consent` `/register` `/revoke` `/introspect` `/logout` `/.well-known/openid-configuration` `/.well-known/jwks.json` `/api/auth/callback/google` | household-auth |
| `/.well-known/oauth-authorization-server` | household-auth（OIDC Discovery に書き換え） |
| `/mcp` `/.well-known/oauth-protected-resource/*` | household-mcp |
| それ以外 | household-app |

`/register` と `/authorize` は IP ごとにレート制限する。`www.` は apex に 301。

`household-app` は **Photon.js**（`@photonjs/hono`）を使ってVike（SSR）とHonoを統合している。`server/entry.ts` がエントリポイントで、`apply()` でミドルウェア・ハンドラーを登録し `serve()` でCloudflare Workers向けにエクスポートする。

ルーティング:
- `/api/session/*` → ログイン・ログアウト（認証基盤の RP）
- `/api/trpc/*` → tRPCハンドラー
- `/api/v1/export/*` → エクスポートAPI（トークン認証）
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

**認証基盤（household-auth）+ Google ログイン**

- `apps/auth-server` が OpenID Provider（maronn-openid-connect の生成コード）。issuer は公開オリジン（`https://maronn-household-budget.com`）で、ルートはオリジン直下に固定
- エンドユーザーは Google でログインする（上流 OP への認可コードフロー。Workers で動く自前実装 `google-login.ts`）。Google のリダイレクト URI は Better Auth 時代と同じ `/api/auth/callback/google`
- ユーザーは既存の `user` / `account`（provider_id='google'）テーブルをそのまま使い、既存ユーザーの user_id を維持する（`household-user-store.ts`）
- household-app は confidential クライアント `household-app`（認可コード + PKCE）。セッションは D1 の `session` テーブル（トークンは SHA-256 で保存）、Cookie は `__Host-hh_session`
- MCP クライアントは動的クライアント登録（RFC 7591）+ PKCE。`resource`（RFC 8707）は認証基盤の入口で audience に変換し、MCP 宛てのトークンにだけ MCP サーバーの URL が aud に入る
- 移行期間は Better Auth のセッション Cookie も BETTER_AUTH_SECRET で検証して受け付ける（既定の寿命 7 日で自然に消える。消えたら server/session/store.ts の互換処理を削除してよい）

#### secrets

| Worker | 名前 | 説明 |
|---|---|---|
| household-auth | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | GitHub Secrets から毎回投入 |
| household-auth | `OIDC_SIGNING_KEY`（任意で `OIDC_SIGNING_KEY_PREVIOUS`） | RSA 秘密鍵 JWK。未設定ならデプロイが生成 |
| household-auth / household-app | `HOUSEHOLD_CLIENT_SECRET` | 両方に同じ値。片方でも欠けたらデプロイが再生成 |
| household-app | `BETTER_AUTH_SECRET` | 移行期間だけ旧 Cookie の検証に使う |

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
- `expenses`: 支出記録（`subBudgetId`、レシート由来なら `receiptId`）
- `receipts` / `receipt_items`: 生成AIがレシート写真から読み取った購入（支払総額を明細の比率でカテゴリ別の `expenses` に按分して紐づける）
- `budgets`: 月次予算
- `subBudgets` / `subBudgetMonthlyAmounts`: サブ予算
- `apiTokens` / `apiUsage`: エクスポートAPI用トークン管理
- `webhooks` / `webhookBatchSchedules`: Webhook設定

ユーザーとアプリのセッションは `packages/db-schema/src/auth.ts`（`user` / `account` / `session`）。
認証基盤の生成OPのテーブル（`clients` / `transactions` / `access_tokens` など）は `0008_oidc_provider.sql`（生成コードの `db/schema.sql` と同じ）。OP の `users` / `federated_identities` は使わない。

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
# gateway・auth-server・mcp-server は apps/ 内で `pnpm dev`（wrangler dev）。テストは Miniflare のローカル D1 で通しで動く
pnpm test             # ユニット + コンポーネント（Vitest）
pnpm test:e2e         # E2Eテスト（Playwright）
pnpm test:watch       # ウォッチモード
pnpm typecheck        # 全パッケージの型チェック
pnpm lint             # ESLintリント
pnpm lint:fix         # ESLintリント + 自動修正
pnpm format           # Prettierフォーマット

# DBマイグレーション（apps/household-app 内で実行）
pnpm drizzle:generate:household  # household テーブルのマイグレーション生成
pnpm drizzle:generate:auth       # user/account/session テーブルのマイグレーション生成
pnpm drizzle:migrate             # ローカルD1にマイグレーション適用
pnpm drizzle:migrate:remote      # リモートD1にマイグレーション適用
pnpm drizzle:studio              # Drizzle Studio（DB GUI）

# デプロイ: main への push で GitHub Actions（.github/workflows/deploy.yml、詳細は scripts/cloudflare/README.md）
```

## 実装済み機能

### 認証基盤（`apps/auth-server/`、Worker 名 `household-auth`）

maronn-openid-connect（`@maronn-openid-connect/core` 0.12.0 / `experimental` 0.0.19、CLI 0.17.0 で生成）の OpenID Provider。
家計簿アプリのログインと MCP クライアントの OAuth を担う。

- 生成コード: `pnpm --filter auth-server generate`（`src/oidc-provider/` に上書き。生成物は手で編集しない）
- 差し込み: `src/app.ts`（applyOidc のオプション、追加のルート、エラーページ、クリックジャッキング対策のヘッダー）
- 定期削除（Cron Trigger、毎日 20:00 UTC）: 期限切れのトランザクション・コード・トークン、90 日超の OP のブラウザセッション、期限切れのアプリのセッション、24 時間使われなかった動的登録クライアント
- 内部エンドポイント `POST /internal/users/delete`（アカウント削除。household-app から service binding でだけ呼ぶ）
- 生成OPの制約: ルートのプレフィックス不可、RFC 8414 のメタデータなし（gateway が OIDC Discovery に書き換え）、RFC 8707 なし（入口で audience に変換）、DCR のストアはメモリ（D1 版に差し替え）

### MCP サーバー（`apps/mcp-server/`、Worker 名 `household-mcp`）

OAuth の保護リソースとして Bearer トークン（RS256 の JWT、aud に `${ISSUER}/mcp`、scope に `household`、発行済みの記録があること）を検証し、Streamable HTTP（ステートレス）でツールを提供する。

- `record_receipt`: レシート（店名・購入日時・支払総額・税・支払方法・明細）を記録。カテゴリ別に按分した支出を作る。同日・同額のレシートは duplicate を返す
- `delete_receipt`: 記録したレシートを取り消す
- `list_records`: 月の支出（店名付き）。`includeItems` でレシートと明細
- `get_budget_summary`: 月の予算・支出・残額・カテゴリ別内訳（アプリの「残り」と同じくサブ予算を除く）
- 接続先: `https://maronn-household-budget.com/mcp`（Claude のカスタムコネクタなど。ログインと同意は認証基盤の画面）
- 既知の制限: MCP で記録した支出では Webhook（expense.created）は送らない

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