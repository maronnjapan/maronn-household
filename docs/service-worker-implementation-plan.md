# Service Worker実装計画: /householdページのオフライン対応

## 目標

- `/household`ページをService Workerでキャッシュ
- オフラインでも爆速で表示
- IndexedDBへの金額保存を確実に動作させる
- サーバー同期はオンライン復帰後でOK

## 技術選定

| 項目 | 選定 | 理由 |
|------|------|------|
| キャッシュ戦略 | Stale-While-Revalidate | キャッシュを即座に返しつつ、バックグラウンドで更新 |
| 実装方法 | Vanilla JS | 依存ゼロ、軽量、デバッグしやすい |

---

## 作成するファイル

| ファイル | 目的 |
|----------|------|
| `apps/household-app/public/sw.js` | Service Worker本体 |
| `apps/household-app/public/sw-register.js` | SW登録スクリプト（Head経由でロード） |

## 修正するファイル

| ファイル | 修正内容 |
|----------|----------|
| `apps/household-app/pages/household/+Head.tsx` | SW登録スクリプトの読み込み追加 |

---

## 実装詳細

### 1. Service Worker (`public/sw.js`)

#### キャッシュ設定

```javascript
const CACHE_NAME = 'household-v1';
const STATIC_CACHE_NAME = 'household-static-v1';

// 事前キャッシュ対象
const PRECACHE_ASSETS = [
  '/household',
  '/pre-hydration-calculator.js',
];

// APIリクエストの除外パターン
const API_PATTERNS = [
  /^\/api\//,
  /^\/trpc\//,
];
```

#### キャッシュ対象判定

| リクエスト | 戦略 | 理由 |
|------------|------|------|
| `/household` ナビゲーション | Stale-While-Revalidate | オフライン対応＋バックグラウンド更新 |
| `/assets/**/*.js\|css` | Cache-First | ハッシュ付きファイル名で不変 |
| `/pre-hydration-calculator.js` | Cache-First | 即座動作に必須 |
| `/api/*`, `/trpc/*` | キャッシュしない | リアルタイムデータ必須 |

#### イベントハンドラ

**install イベント:**
```javascript
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_ASSETS))
      .then(() => self.skipWaiting())
  );
});
```

**activate イベント:**
```javascript
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('household-') && name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});
```

**fetch イベント:**
- GETリクエストのみ処理
- APIリクエストはスルー
- ナビゲーションリクエストはStale-While-Revalidate
- 静的アセットはCache-First

### 2. SW登録スクリプト (`public/sw-register.js`)

```javascript
/**
 * Service Worker Registration
 * /household ページのオフラインサポート
 */
(function() {
  'use strict';

  if (!('serviceWorker' in navigator)) return;

  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function(registration) {
        console.info('[SW] Registered:', registration.scope);
      })
      .catch(function(error) {
        console.error('[SW] Registration failed:', error);
      });
  });
})();
```

### 3. Head修正 (`+Head.tsx`)

```tsx
export function Head() {
  return (
    <>
      {/* Pre-hydration Calculator */}
      <script src="/pre-hydration-calculator.js" />
      {/* Service Worker Registration */}
      <script src="/sw-register.js" />
    </>
  );
}
```

---

## オフライン動作フロー

```
[オフラインでアクセス]
    │
    ▼
[Service Worker] ──→ キャッシュからHTML返却
    │
    ▼
[ブラウザ] ──→ キャッシュからJS/CSS読み込み
    │
    ▼
[pre-hydration-calculator.js] ──→ 電卓UI即座に動作
    │
    ▼
[金額入力]
    │
    ▼
[IndexedDB保存] ──→ syncStatus: 'pending'
    │
    ▼
[オンライン復帰時]
    │
    ▼
[lib/sync.ts] ──→ サーバーへ同期
```

---

## キャッシュ戦略詳細

### Stale-While-Revalidate (ナビゲーション)

```javascript
async function handleNavigationRequest(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);

  // バックグラウンドで更新
  const fetchPromise = fetch(request)
    .then((networkResponse) => {
      if (networkResponse.ok) {
        cache.put(request, networkResponse.clone());
      }
      return networkResponse;
    })
    .catch(() => null);

  // キャッシュがあれば即座に返却
  if (cachedResponse) {
    fetchPromise; // Fire and forget
    return cachedResponse;
  }

  // キャッシュなし → ネットワーク待ち
  const networkResponse = await fetchPromise;
  if (networkResponse) {
    return networkResponse;
  }

  // 完全オフライン失敗
  return new Response('Offline', { status: 503 });
}
```

### Cache-First (静的アセット)

```javascript
async function handleStaticAsset(request) {
  const cache = await caches.open(STATIC_CACHE_NAME);
  const cachedResponse = await cache.match(request);

  if (cachedResponse) {
    return cachedResponse;
  }

  const networkResponse = await fetch(request);
  if (networkResponse.ok) {
    cache.put(request, networkResponse.clone());
  }
  return networkResponse;
}
```

---

## 実装手順

### Step 1: Service Worker作成

`apps/household-app/public/sw.js` を作成:
- install/activate/fetchイベント実装
- Stale-While-Revalidate + Cache-First戦略

### Step 2: 登録スクリプト作成

`apps/household-app/public/sw-register.js` を作成:
- load時にSW登録

### Step 3: Head修正

`apps/household-app/pages/household/+Head.tsx` を修正:
- sw-register.jsの読み込み追加

### Step 4: 動作検証

1. ビルド: `pnpm build`
2. ローカル確認: `pnpm dev`
3. オフラインテスト（DevTools）
4. IndexedDB保存確認
5. オンライン復帰後の同期確認

---

## 検証方法

### 1. ビルド

```bash
pnpm build
```

### 2. 開発サーバー起動

```bash
pnpm dev
```

### 3. オフラインテスト

1. Chrome DevTools → Application → Service Workers で登録確認
2. Network → Offline チェック
3. `/household` にアクセス → 表示されることを確認
4. 金額入力 → IndexedDBに保存されることを確認
   - Application → IndexedDB → maronn-household → expenses で確認

### 4. オンライン復帰テスト

1. Offlineチェック解除
2. Console で同期ログを確認

---

## 注意事項

### 開発時

- Service Workerがホットリロードを妨げる可能性あり
- DevToolsで「Bypass for network」有効化で回避
- または「Update on reload」を有効化

### デプロイ時

- `CACHE_NAME` のバージョンを更新して古いキャッシュを削除
- 例: `household-v1` → `household-v2`

### キャッシュサイズ

- ブラウザのストレージ制限に注意
- 古いキャッシュは `activate` イベントで自動削除

---

## 既存コードとの連携

### pre-hydration-calculator.js

既にIndexedDB保存を実装済み:
- ULID生成
- デバイスID管理
- expense保存（syncStatus: 'pending'）

Service Workerがキャッシュを提供することで、このスクリプトがオフラインでも動作可能になる。

### lib/sync.ts

オンライン復帰時の同期ロジックを実装済み:
- `syncPendingExpenses()` - ローカル → サーバー
- オンライン/オフラインイベントリスナー設定済み

Service Workerとの追加連携は不要。既存の同期メカニズムがそのまま動作する。

---

## ファイル構成（実装後）

```
apps/household-app/
├── public/
│   ├── pre-hydration-calculator.js  # 既存: hydration前の電卓
│   ├── sw.js                        # 新規: Service Worker本体
│   └── sw-register.js               # 新規: SW登録スクリプト
├── pages/household/
│   ├── +Page.tsx                    # 既存: メインページ
│   ├── +Head.tsx                    # 修正: SW登録追加
│   └── household.css                # 既存: ページ専用CSS
└── lib/
    ├── db.ts                        # 既存: IndexedDB/Dexie設定
    ├── sync.ts                      # 既存: サーバー同期ロジック
    └── device.ts                    # 既存: デバイスID管理
```
