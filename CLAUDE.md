# 家計簿アプリ - CLAUDE.md

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

### 認証（将来実装）

認証方式は未定。将来的に不特定多数のユーザーを想定するため、以下を候補として検討:

- Better Auth（セルフホスト、Hono統合）
- Cloudflare Access（Zero Trust）
- Auth.js（OAuth連携が必要な場合）

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

```typescript
// packages/api/src/db/schema.ts
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  createdAt: text('created_at').notNull(),
});

export const expenses = sqliteTable('expenses', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  amount: integer('amount').notNull(),
  category: text('category'),
  memo: text('memo'),
  date: text('date').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  deviceId: text('device_id').notNull(),
});

export const budgets = sqliteTable('budgets', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id),
  month: text('month').notNull(),
  amount: integer('amount').notNull(),
  updatedAt: text('updated_at').notNull(),
});
```

## 同期戦略

### マージ方式（両方の入力を残す）

同じ月の支出を複数デバイスで編集した場合、すべての入力を保持する。

```typescript
// packages/domain/src/sync.ts
interface SyncResult {
  toUpload: Expense[];      // ローカル → サーバー
  toDownload: Expense[];    // サーバー → ローカル
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

純粋関数としてテストしやすく設計。外部依存なし。

```typescript
// packages/domain/tests/budget.test.ts
import { describe, it, expect } from 'vitest';
import { calculateRemaining } from '../src/budget';

describe('calculateRemaining', () => {
  it('予算から支出合計を引いた残額を返す', () => {
    const budget = 100000;
    const expenses = [
      { amount: 3000 },
      { amount: 5000 },
    ];
    
    expect(calculateRemaining(budget, expenses)).toBe(92000);
  });

  it('支出がない場合は予算全額を返す', () => {
    expect(calculateRemaining(100000, [])).toBe(100000);
  });

  it('支出が予算を超えた場合は負の値を返す', () => {
    const budget = 10000;
    const expenses = [{ amount: 15000 }];
    
    expect(calculateRemaining(budget, expenses)).toBe(-5000);
  });
});
```

#### UIコンポーネント（apps/web）

Testing Library でユーザー視点のテスト。

```typescript
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpenseInput } from '../../components/ExpenseInput';

describe('ExpenseInput', () => {
  it('金額を入力して追加すると残額が減る', async () => {
    const user = userEvent.setup();
    render(<ExpenseInput initialBudget={100000} />);
    
    expect(screen.getByText('残り: ¥100,000')).toBeInTheDocument();
    
    await user.type(screen.getByPlaceholderText('金額'), '3000');
    await user.click(screen.getByRole('button', { name: '追加' }));
    
    expect(screen.getByText('残り: ¥97,000')).toBeInTheDocument();
  });
});
```

#### E2E（e2e/）

Playwright でユーザーシナリオをテスト。

```typescript
// e2e/budget-flow.spec.ts
import { test, expect } from '@playwright/test';

test('支出を入力すると残額がリアルタイムで更新される', async ({ page }) => {
  await page.goto('/');
  
  // 初期状態
  await expect(page.getByText('残り: ¥100,000')).toBeVisible();
  
  // 支出入力
  await page.getByPlaceholder('金額').fill('5000');
  await page.getByRole('button', { name: '追加' }).click();
  
  // 即座に更新（ネットワーク待ちなし）
  await expect(page.getByText('残り: ¥95,000')).toBeVisible();
});

test('オフラインでも支出入力ができる', async ({ page, context }) => {
  await page.goto('/');
  
  // オフラインにする
  await context.setOffline(true);
  
  await page.getByPlaceholder('金額').fill('3000');
  await page.getByRole('button', { name: '追加' }).click();
  
  // ローカルで処理されるので動作する
  await expect(page.getByText('残り: ¥97,000')).toBeVisible();
});
```

### テストピラミッド

```
        /\
       /  \  E2E（少数・重要フロー）
      /----\
     /      \  コンポーネント（UIの振る舞い）
    /--------\
   /          \  ユニット（ドメインロジック・多数）
  --------------
```

ドメインロジックのユニットテストを厚く、E2Eは重要なユーザーフローに絞る。

## コーディング規約

### 全般

- TypeScript strict モード必須
- 関数は可能な限り純粋関数として実装
- 副作用は hooks または専用モジュールに分離
- any 禁止、unknown + 型ガードを使用

### 命名規則

```typescript
// ファイル名: kebab-case
expense-input.tsx
use-remaining-budget.ts

// 関数・変数: camelCase
function calculateRemaining() {}
const totalSpent = 0;

// 型・インターフェース: PascalCase
interface Expense {}
type SyncStatus = 'pending' | 'synced';

// 定数: UPPER_SNAKE_CASE
const MAX_RETRY_COUNT = 3;
```

### コンポーネント設計

```typescript
// Props は明示的に定義
interface ExpenseInputProps {
  onSubmit: (amount: number) => void;
  initialBudget?: number;
}

// デフォルトエクスポートは使わない
export function ExpenseInput({ onSubmit, initialBudget = 0 }: ExpenseInputProps) {
  // ...
}
```

### React パターン

**useEffect 使用禁止**

副作用の管理には以下のパターンを優先する：

1. **データフェッチ**: TanStack Query の `useQuery`, `useMutation` を使用
2. **サブスクリプション**: TanStack Query の subscription 機能
3. **ライフサイクル制御**: Suspense + ErrorBoundary
4. **モジュールレベル初期化**: ブラウザ環境チェック付きでモジュールロード時に実行

```typescript
// ❌ 悪い例
function Component() {
  useEffect(() => {
    startSync();
  }, []);
}

// ✅ 良い例1: モジュールレベル初期化
// sync.ts
if (typeof window !== 'undefined') {
  startBackgroundSync();
}

// ✅ 良い例2: TanStack Query
function Component() {
  const { data } = useQuery({
    queryKey: ['expenses'],
    queryFn: fetchExpenses,
  });
}
```

### エラーハンドリング

**try-catch は最小限に**

- try-catch はエラーを隠蔽しデバッグを困難にする
- 原則として、予期しないエラーはそのまま上位に伝播させる
- グローバルエラーハンドラー（Hono の `onError`, React ErrorBoundary）で一元管理

**使用が許可される場合**:

1. **外部API呼び出し**: リトライロジックが必要な場合
2. **ユーザー入力のパース**: JSON.parse など明示的に失敗が予想される場合
3. **リソースクリーンアップ**: finally でのクリーンアップが必須の場合

```typescript
// ❌ 悪い例: エラーを隠蔽
try {
  await db.insert(data);
} catch (error) {
  console.error(error);
  return { success: false };
}

// ✅ 良い例: エラーをそのまま伝播
await db.insert(data); // エラーはグローバルハンドラーで処理

// ✅ 許可される例: リトライロジック
async function fetchWithRetry(url: string, retries = 3) {
  try {
    return await fetch(url);
  } catch (error) {
    if (retries > 0) return fetchWithRetry(url, retries - 1);
    throw error;
  }
}
```

## パフォーマンス目標

| 指標 | 目標値 |
|------|--------|
| 初回表示（FCP） | < 500ms |
| 残額更新（入力後） | < 50ms |
| オフライン時の動作 | 100%機能 |
| Lighthouse Performance | > 90 |

## 開発コマンド

```bash
# 開発サーバー起動
pnpm dev

# テスト実行
pnpm test              # ユニット + コンポーネント
pnpm test:e2e          # E2E

# テスト（ウォッチモード）
pnpm test:watch

# 型チェック
pnpm typecheck

# リント
pnpm lint

# ビルド
pnpm build

# Cloudflare Workers へデプロイ
pnpm deploy
```

## 実装済み機能

### 月次予算設定機能

月ごとの予算を設定・更新できる機能。支出記録機能と異なり、予算はサーバーのみで管理する。

#### 設計方針

- **支出記録**: ローカルファースト（IndexedDB → サーバー同期）→ 爆速動作
- **予算設定**: サーバーのみで管理 → データ整合性優先、IndexedDBとの二重管理を避ける

予算は頻繁に変更されないため、サーバー同期の待ち時間は許容範囲内と判断。
ネットワーク環境が悪く予算が読み込めない場合は、デフォルト予算（120,000円）を使用し、支出記録の表示はブロックしない。

#### API エンドポイント

```typescript
// apps/household-app/trpc/server.ts

// 予算取得
getBudget: publicProcedure
  .input(z.object({ month: z.string() }))
  .query(async (opts) => {
    // D1 から指定月の予算を取得
    // 存在しない場合は null を返す
  });

// 予算更新
updateBudget: publicProcedure
  .input(z.object({
    month: z.string(),
    amount: z.number()
  }))
  .mutation(async (opts) => {
    // D1 に予算を保存（既存なら UPDATE、なければ INSERT）
    // 更新日時（updatedAt）を記録
  });
```

#### フロントエンド実装

**フック（apps/household-app/hooks/use-set-budget.ts）**

```typescript
export function useSetBudget() {
  const mutation = trpc.updateBudget.useMutation();

  const updateBudget = async (month: string, amount: number) => {
    // サーバーのみに保存（IndexedDBには保存しない）
    await mutation.mutateAsync({ month, amount });
  };

  return { updateBudget, isUpdating: mutation.isPending };
}

export function useGetBudget(month: string) {
  const query = trpc.getBudget.useQuery({ month });
  return { budget: query.data?.budget, isLoading: query.isLoading };
}
```

**フック（apps/household-app/hooks/use-remaining-budget.ts）**

```typescript
export function useRemainingBudget(month: string) {
  // 予算をサーバーから取得（ネットワーク環境に依存）
  const budgetQuery = trpc.getBudget.useQuery({ month });

  // 支出をIndexedDBからリアルタイム取得（ローカルファースト）
  const expensesData = useLiveQuery(async () => {
    const expenses = await getExpensesByMonth(month);
    const spent = expenses.reduce((sum, e) => sum + e.amount, 0);
    return { expenses, spent };
  }, [month]);

  // 予算額を決定（サーバーから取得できない場合はデフォルト値）
  const budgetAmount = budgetQuery.data?.budget?.amount ?? DEFAULT_BUDGET_AMOUNT;

  return {
    budget: budgetAmount,
    spent: expensesData?.spent ?? 0,
    remaining: calculateRemaining(budgetAmount, expensesData?.expenses ?? []),
    isLoading: !expensesData,
    isBudgetLoading: budgetQuery.isLoading,
  };
}
```

**コンポーネント（apps/household-app/components/BudgetInput.tsx）**

- 予算読込中: スケルトン表示「読込中...」
- 予算未設定時: 「設定」ボタンを表示
- 予算設定済み: 金額を表示 + 「変更」ボタン
- 編集モード: 金額入力フィールド + 「保存」「キャンセル」ボタン

#### 動作フロー

```
1. ページ読み込み
   └── サーバーから予算を取得（並列処理、支出表示はブロックしない）
   └── 予算読込中はデフォルト予算（120,000円）を使用
   └── ネットワークエラー時もデフォルト予算で動作可能

2. 予算読込完了
   └── tRPCキャッシュに保存
   └── 残額が自動で再計算される

3. 予算設定ボタンをクリック
   └── 入力フォームを表示
   └── 金額を入力して「保存」

4. 保存処理
   └── tRPC で サーバーに送信
   └── 成功したら tRPCキャッシュが自動更新
   └── 残額表示が自動更新される

5. 支出記録（並列動作）
   └── IndexedDB に即座に保存（< 50ms）
   └── useLiveQuery が検知して残額表示が即座に更新
   └── 予算の読込状態に関わらず、支出記録は常に動作
```

#### ファイル構成

```
apps/household-app/
├── components/
│   ├── BudgetInput.tsx          # 予算設定UI（ローディング状態対応）
│   ├── RemainingDisplay.tsx     # 残額表示（予算を使用）
│   └── ExpenseInput.tsx         # 支出入力
├── hooks/
│   ├── use-set-budget.ts        # 予算設定フック（tRPC経由）
│   └── use-remaining-budget.ts  # 残額計算フック（予算はtRPC、支出はIndexedDB）
├── pages/
│   └── household/
│       └── +Page.tsx            # 家計簿ページ（予算設定UIを統合）
└── trpc/
    └── server.ts                # tRPCエンドポイント（getBudget, updateBudget）
```

#### 注意事項

- **予算はサーバーのみで管理**: IndexedDBには保存せず、tRPCキャッシュで管理
- **支出記録はブロックしない**: 予算読込中でも支出記録は即座に動作
- **オフライン対応**: ネットワークエラー時はデフォルト予算（120,000円）を使用
- **認証未実装**: 現在はすべてのユーザーが `userId: 'default-user'` を使用
- **月単位管理**: 予算は月単位（YYYY-MM形式）で管理
- **競合解決**: 同じ月の予算を複数デバイスで同時編集した場合、`updatedAt` が新しい方を採用（Last Write Wins）

## 今後の拡張予定

1. **認証機能**: ユーザー登録・ログイン（Better Auth 候補）
2. **カテゴリ管理**: 支出のカテゴリ分類・集計
3. **グラフ表示**: 月別・カテゴリ別の支出可視化
4. **予算アラート**: 残額が少なくなったら通知
5. **CSV エクスポート**: データのバックアップ・分析用
