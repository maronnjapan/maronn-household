# 爆速Webアプリを実現する2つの技術：Pre-hydration InteractivityとService Workerキャッシュ戦略

本記事では、家計簿アプリで実装した2つの高速化技術について解説します。

1. **Pre-hydration Interactivity** - SSR描画後、Reactのhydrationを待たずに即座にインタラクティブにする技術
2. **Service Workerによるキャッシュ戦略** - オフラインでも爆速表示を実現するキャッシュ戦略

---

## 目次

1. [背景と課題](#背景と課題)
2. [Pre-hydration Interactivity](#pre-hydration-interactivity)
   - [機能概要](#機能概要-pre-hydration)
   - [アーキテクチャ](#アーキテクチャ-pre-hydration)
   - [実装詳細](#実装詳細-pre-hydration)
   - [考慮事項](#考慮事項-pre-hydration)
   - [参考資料](#参考資料-pre-hydration)
3. [Service Workerキャッシュ戦略](#service-workerキャッシュ戦略)
   - [機能概要](#機能概要-sw)
   - [キャッシュ戦略の選択](#キャッシュ戦略の選択)
   - [実装詳細](#実装詳細-sw)
   - [考慮事項](#考慮事項-sw)
   - [参考資料](#参考資料-sw)
4. [両技術の連携](#両技術の連携)
5. [まとめ](#まとめ)

---

## 背景と課題

### モダンSPAの問題点：Time to Interactive (TTI)

ReactなどのSPAフレームワークでSSR（Server Side Rendering）を行う場合、以下のステップを経てページがインタラクティブになります：

```
1. サーバーがHTMLを生成
2. ブラウザがHTMLを受信・描画（First Contentful Paint）
3. JavaScriptバンドルをダウンロード
4. JavaScriptを実行（hydration）
5. ページがインタラクティブに（Time to Interactive）
```

この「3〜5」のステップが問題です。ユーザーは画面が表示されているのにボタンをクリックしても反応しない「空白時間」を体験します。

### 目標：描画と同時にインタラクティブ

本アプリでは以下の目標を設定しました：

- **金額入力フィールドの即座表示**: < 500ms
- **入力操作の即時反映**: < 50ms
- **オフライン時の動作**: 100%機能

これを実現するために、Pre-hydration InteractivityとService Workerの2つの技術を組み合わせました。

---

## Pre-hydration Interactivity

<a name="機能概要-pre-hydration"></a>
### 機能概要

**Pre-hydration Interactivity**とは、Reactのhydrationが完了する前に、Vanilla JavaScriptで先行してUIをインタラクティブにする技術です。

```
従来のフロー:
[SSR HTML描画] → [JS読み込み] → [hydration] → [インタラクティブ]
                                              ↑ ここまで待つ

Pre-hydrationフロー:
[SSR HTML描画] → [Pre-hydration JS] → [インタラクティブ！]
              ↓
              [JS読み込み] → [hydration] → [Reactが引き継ぎ]
```

#### なぜ効果的か

- **軽量なスクリプト**: Pre-hydration用JSは約8KB（gzip後約3KB）
- **即座に実行可能**: 大きなReactバンドルのダウンロードを待たない
- **IndexedDBに直接保存**: サーバー通信も不要

<a name="アーキテクチャ-pre-hydration"></a>
### アーキテクチャ

#### 状態の引き継ぎ

Pre-hydration中の入力状態をReactに引き継ぐため、DOM属性を使用します：

```
[Pre-hydration JS]
    ↓ data-expression="123+456"
    ↓ data-memo="ランチ代"
    ↓ data-category="food"
[DOM (data属性)]
    ↓ 読み取り
[React Component]
```

#### 二重実行の防止

hydration完了後はPre-hydration JSが動作しないよう、フラグで制御します：

```javascript
// Pre-hydration側：hydrated属性をチェック
function isHydrated() {
  var calc = document.querySelector('.expense-input.calculator');
  return calc && calc.hasAttribute('data-hydrated');
}

// React側：hydration完了時に属性を設定
useEffect(() => {
  calcRef.current?.setAttribute('data-hydrated', 'true');
}, []);
```

<a name="実装詳細-pre-hydration"></a>
### 実装詳細

#### 1. 電卓ロジック（四則演算パーサー）

Vanilla JSで四則演算をパースする軽量な実装です。`eval()`を使わずにセキュアに計算を行います。

```javascript
/**
 * 数式文字列をトークンに分解
 * "123+456*2" → [{type:'number',value:123}, {type:'operator',value:'+'}, ...]
 */
function tokenize(expr) {
  var tokens = [], i = 0;
  while (i < expr.length) {
    var c = expr[i];
    if (/\d/.test(c)) {
      // 数値：連続する数字を結合
      var num = '';
      while (i < expr.length && /[\d.]/.test(expr[i])) num += expr[i++];
      tokens.push({ type: 'number', value: parseFloat(num) });
    } else if (['+', '-', '*', '/'].indexOf(c) >= 0) {
      tokens.push({ type: 'operator', value: c }); i++;
    } else if (['(', ')'].indexOf(c) >= 0) {
      tokens.push({ type: 'paren', value: c }); i++;
    } else { i++; }
  }
  return tokens;
}

/**
 * 再帰下降パーサーによる数式評価
 * 演算子の優先順位を正しく処理（* / は + - より先に計算）
 */
function parseExpr(tokens) {
  var idx = 0;

  // 加算・減算（低優先度）
  function parseAddSub() {
    var left = parseMulDiv();
    while (idx < tokens.length && tokens[idx].type === 'operator' &&
           (tokens[idx].value === '+' || tokens[idx].value === '-')) {
      var op = tokens[idx++].value;
      left = op === '+' ? left + parseMulDiv() : left - parseMulDiv();
    }
    return left;
  }

  // 乗算・除算（高優先度）
  function parseMulDiv() {
    var left = parsePrimary();
    while (idx < tokens.length && tokens[idx].type === 'operator' &&
           (tokens[idx].value === '*' || tokens[idx].value === '/')) {
      var op = tokens[idx++].value;
      left = op === '*' ? left * parsePrimary() : left / parsePrimary();
    }
    return left;
  }

  // 数値またはカッコ
  function parsePrimary() {
    var t = tokens[idx];
    if (t.type === 'number') { idx++; return t.value; }
    if (t.type === 'paren' && t.value === '(') {
      idx++; var r = parseAddSub(); idx++; return r;
    }
    if (t.type === 'operator' && t.value === '-') { idx++; return -parsePrimary(); }
    throw new Error('Invalid');
  }

  return parseAddSub();
}

/**
 * 数式を評価して結果を返す
 * @param {string} expr - 数式文字列 (例: "100+200*3")
 * @returns {number|null} - 計算結果（整数）またはnull
 */
function evaluate(expr) {
  try {
    if (!expr || !expr.trim()) return null;
    // 許可された文字のみかチェック（セキュリティ）
    if (!/^[\d+\-*/().\s×÷]+$/.test(expr)) return null;
    // 全角記号を半角に正規化
    var norm = expr.replace(/×/g, '*').replace(/÷/g, '/').replace(/\s/g, '');
    var tokens = tokenize(norm);
    if (!tokens.length) return null;
    var result = parseExpr(tokens);
    return Number.isFinite(result) ? Math.round(result) : null;
  } catch (e) { return null; }
}
```

#### 2. IndexedDBへの直接保存

##### なぜDexie.jsを使わないのか

本アプリでは通常のReactコンポーネント内ではDexie.jsを使用していますが、Pre-hydration JSでは**意図的に生のIndexedDB APIを使用**しています。これは技術的な制約ではなく、パフォーマンス最適化のための設計判断です。

**理由1: スクリプトサイズの最小化**

| 実装方法 | サイズ（minify前） | サイズ（minify + gzip後） |
|---------|-------------------|-------------------------|
| Dexie.js | 約80KB | 約25KB |
| 生のIndexedDB API | 約2KB | 約1KB |

Pre-hydration JSの目的は「Reactのhydrationより先に動く」ことです。Dexie.jsを読み込むと、その分だけダウンロード時間が増加し、Pre-hydrationの効果が薄れてしまいます。

**理由2: 依存関係ゼロで即座に実行可能**

```
Dexie.jsを使う場合:
[HTML描画] → [Dexie.js読み込み] → [Pre-hydration JS読み込み] → [実行]
                  ↑ この待ち時間が発生

生のIndexedDB APIを使う場合:
[HTML描画] → [Pre-hydration JS読み込み] → [実行]
              ↑ 即座に実行可能
```

Pre-hydration JSは他のライブラリに依存せず、単独で即座に実行できる必要があります。

**理由3: バンドル不要でシンプルな配信**

Pre-hydration JSは `public/` ディレクトリに配置し、ビルドプロセスを経由せずにそのまま配信しています。

```
public/
└── pre-hydration-calculator.js  ← そのまま配信される

// HTMLでの読み込み
<script src="/pre-hydration-calculator.js"></script>
```

Dexie.jsを使う場合、バンドラーでの結合やトランスパイルが必要になり、ビルドプロセスが複雑化します。Pre-hydration JSはシンプルに保つことで、デバッグや保守も容易になります。

**トレードオフ**

生のIndexedDB APIを使うことで、以下のトレードオフが発生します：

- ❌ コードが冗長になる（Dexie.jsの便利なAPIが使えない）
- ❌ エラーハンドリングを自前で実装する必要がある
- ❌ Dexie.jsとのDBバージョン管理に注意が必要
- ✅ 軽量で高速（約25KB → 約1KB）
- ✅ 依存関係なしで即座に実行可能
- ✅ ビルドプロセス不要

Pre-hydrationの目的（hydrationより先に動く）を考えると、このトレードオフは許容できると判断しました。

##### 実装コード

生のIndexedDB APIを使った実装です。

```javascript
var DB_NAME = 'maronn-household', STORE = 'expenses';

/**
 * IndexedDBを開く
 * - 既存のDBがある場合：そのバージョンで開く
 * - 新規の場合：バージョン1で開いてストアを作成
 */
function openDB() {
  return new Promise(function(resolve, reject) {
    // バージョン指定なしで開く（既存DBがあればそのバージョン）
    var req = indexedDB.open(DB_NAME);
    req.onerror = function() { reject(req.error); };
    req.onsuccess = function() {
      var db = req.result;
      // ストアが存在するか確認
      if (db.objectStoreNames.contains(STORE)) {
        resolve(db);
      } else {
        // ストアがない場合はバージョンを上げて再度開く
        var currentVersion = db.version;
        db.close();
        var req2 = indexedDB.open(DB_NAME, currentVersion + 1);
        req2.onerror = function() { reject(req2.error); };
        req2.onsuccess = function() { resolve(req2.result); };
        req2.onupgradeneeded = function(e) {
          var db2 = e.target.result;
          var store = db2.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('date', 'date');
          store.createIndex('syncStatus', 'syncStatus');
        };
      }
    };
    req.onupgradeneeded = function(e) {
      // 新規DB作成時（バージョン1）
      var db = e.target.result;
      var store = db.createObjectStore(STORE, { keyPath: 'id' });
      store.createIndex('date', 'date');
      store.createIndex('syncStatus', 'syncStatus');
    };
  });
}

/**
 * 支出をIndexedDBに保存
 * @param {number} amount - 金額
 * @param {string} memo - メモ（任意）
 * @param {string} category - カテゴリー（任意）
 * @returns {Promise<string>} - 保存した支出のID
 */
function saveExpense(amount, memo, category) {
  return openDB().then(function(db) {
    return new Promise(function(resolve, reject) {
      var now = new Date(), id = ulid();
      // JSTで日付を取得
      var jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
      var dateStr = jst.toISOString().split('T')[0];

      var expense = {
        id: id,
        userId: 'anonymous',
        amount: amount,
        category: category || undefined,
        memo: memo || undefined,
        date: dateStr,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        syncStatus: 'pending',  // 後でサーバーに同期
        deviceId: getDeviceId()
      };

      var tx = db.transaction([STORE], 'readwrite');
      var store = tx.objectStore(STORE);
      var req = store.add(expense);
      req.onerror = function() { reject(req.error); };
      req.onsuccess = function() { db.close(); resolve(id); };
    });
  });
}
```

#### 3. イベント委譲（Event Delegation）

DOM要素の存在を待たずにイベントをキャッチするため、イベント委譲パターンを使用します。

```javascript
/**
 * イベント委譲を使用したイベントリスナー
 * documentレベルでキャプチャリングフェーズでリスンすることで、
 * DOM要素の存在を待たずに即座にイベントをキャッチできる
 */
function attachDelegatedListeners() {
  // 電卓ボタンのクリック
  document.addEventListener('click', function(e) {
    if (isHydrated()) return;  // Reactが引き継いだ後はスキップ

    var target = e.target;
    if (!target) return;

    // calc-btnクラスを持つ要素をクリックした場合
    if (target.classList && target.classList.contains('calc-btn')) {
      var val = target.textContent ? target.textContent.trim() : '';
      if (val) {
        e.preventDefault();
        handleButton(val);
      }
      return;
    }

    // submit-buttonクラスを持つ要素をクリックした場合
    if (target.classList && target.classList.contains('submit-button')) {
      e.preventDefault();
      handleSubmit();
      return;
    }
  }, true);  // ← キャプチャリングフェーズで処理

  // メモ入力
  document.addEventListener('input', function(e) {
    if (isHydrated()) return;
    var target = e.target;
    if (target && target.classList && target.classList.contains('memo-input')) {
      memo = target.value || '';
      var calcEl = document.querySelector('.expense-input.calculator');
      if (calcEl) calcEl.setAttribute('data-memo', memo);
    }
  }, true);
}
```

**キャプチャリングフェーズを使う理由**:
- バブリングフェーズ（デフォルト）では、子要素から親要素へイベントが伝播
- キャプチャリングフェーズでは、documentから子要素へ伝播
- documentでキャプチャリングすることで、どの要素がクリックされても最初にイベントを受け取れる

#### 4. hydration完了の検知と状態引き継ぎ

```javascript
// Pre-hydration側：状態をDOM属性に保存
function updateDisplay() {
  var calcEl = document.querySelector('.expense-input.calculator');
  if (calcEl) {
    calcEl.setAttribute('data-expression', expression);
    calcEl.setAttribute('data-memo', memo);
    calcEl.setAttribute('data-category', category);
  }
}

// React側（概念的なコード）
function Calculator() {
  const calcRef = useRef(null);
  const [expression, setExpression] = useState('');

  // hydration時にPre-hydrationの状態を引き継ぐ
  useEffect(() => {
    const calc = calcRef.current;
    if (!calc) return;

    // Pre-hydrationの状態を読み取る
    const preExpr = calc.getAttribute('data-expression') || '';
    const preMemo = calc.getAttribute('data-memo') || '';
    const preCat = calc.getAttribute('data-category') || '';

    if (preExpr) setExpression(preExpr);
    if (preMemo) setMemo(preMemo);
    if (preCat) setCategory(preCat);

    // hydration完了を通知
    calc.setAttribute('data-hydrated', 'true');
  }, []);

  // ... 以降はReactが処理を引き継ぐ
}
```

<a name="考慮事項-pre-hydration"></a>
### 考慮事項

#### 1. 状態の一貫性

Pre-hydrationとReactで状態の不整合が起きないよう注意が必要です。

```
問題シナリオ:
1. ユーザーが "123" を入力（Pre-hydration）
2. Pre-hydrationが data-expression="123" を設定
3. hydrationが完了
4. Reactが data-expression を読み取る
5. しかしReactの初期状態は空文字 ""
6. UIがちらつく！

解決策:
- Reactのhydration時に必ずDOM属性を読み取って状態を初期化
- hydration完了後、即座に data-hydrated 属性を設定
- Pre-hydrationは data-hydrated をチェックしてから動作
```

#### 2. 二重送信の防止

Pre-hydrationとReactの両方で送信処理が走らないよう制御します。

```javascript
// Pre-hydration側
function handleSubmit() {
  if (isHydrated()) return;  // ← 必ずチェック
  // ... 送信処理
}

// React側
const handleSubmit = () => {
  // Reactが管理するようになってからは通常の処理
  // Pre-hydrationは isHydrated() で弾かれている
};
```

#### 3. IndexedDBのバージョン管理

Dexie.jsとPre-hydration JSで同じDBを操作するため、バージョンの衝突に注意が必要です。

```javascript
// 問題:
// Dexie.js がバージョン2でDBを開いた後、
// Pre-hydration JS がバージョン1で開こうとするとエラー

// 解決策: バージョンを指定せずに開く
var req = indexedDB.open(DB_NAME);  // バージョン指定なし
// → 既存DBがあればそのバージョン、なければv1で開く
```

#### 4. ES5構文の使用

Pre-hydration JSはトランスパイルなしで直接読み込まれるため、古いブラウザ対応が必要な場合はES5構文で記述します。

```javascript
// ❌ ES6+ 構文（古いブラウザで動かない可能性）
const tokenize = (expr) => {
  const tokens = [];
  // ...
};

// ✅ ES5構文（互換性が高い）
function tokenize(expr) {
  var tokens = [];
  // ...
}
```

#### 5. スクリプトサイズの最適化

Pre-hydrationの効果を最大化するため、スクリプトサイズを最小限に抑えます。

```
最適化のポイント:
- 外部ライブラリを使わない（Dexie.js、Lodashなど）
- 必要最小限の機能のみ実装
- minify + gzip で配信

結果:
- 元のサイズ: 約8KB
- gzip後: 約3KB
- 読み込み時間: 3G回線でも < 50ms
```

<a name="参考資料-pre-hydration"></a>
### 参考資料

#### 関連技術・概念

1. **Progressive Hydration**
   - Reactの部分的なhydrationを行う技術
   - 参考: [React RFC: Selective Hydration](https://github.com/reactwg/react-18/discussions/37)

2. **Islands Architecture**
   - ページの一部のみをインタラクティブにする設計
   - Astro、Fresh などのフレームワークが採用
   - 参考: [Islands Architecture - patterns.dev](https://www.patterns.dev/posts/islands-architecture/)

3. **Resumability (Qwik)**
   - hydrationを完全にスキップする新しいアプローチ
   - 参考: [Qwik Documentation](https://qwik.dev/docs/concepts/resumable/)

#### 再帰下降パーサー

- [Wikipedia: 再帰下降構文解析](https://ja.wikipedia.org/wiki/%E5%86%8D%E5%B8%B0%E4%B8%8B%E9%99%8D%E6%A7%8B%E6%96%87%E8%A7%A3%E6%9E%90)
- [Crafting Interpreters - Parsing Expressions](https://craftinginterpreters.com/parsing-expressions.html)

#### IndexedDB

- [MDN: IndexedDB API](https://developer.mozilla.org/ja/docs/Web/API/IndexedDB_API)
- [web.dev: IndexedDB](https://web.dev/articles/indexeddb)

---

## Service Workerキャッシュ戦略

<a name="機能概要-sw"></a>
### 機能概要

Service Workerは、ブラウザとネットワークの間に介在するプロキシとして動作します。これにより、リクエストをインターセプトしてキャッシュから応答することで、オフライン対応や高速化を実現します。

```
通常のリクエストフロー:
[ブラウザ] → [ネットワーク] → [サーバー]
                               ↑ 遅い

Service Worker経由:
[ブラウザ] → [Service Worker] → [キャッシュ] → 即座に応答！
                             → [ネットワーク] → バックグラウンドで更新
```

#### 本アプリでの目的

1. **オフライン対応**: ネットワークがなくても `/household` ページを表示
2. **爆速表示**: キャッシュから即座に応答
3. **最新性の担保**: バックグラウンドでキャッシュを更新

<a name="キャッシュ戦略の選択"></a>
### キャッシュ戦略の選択

リソースの特性に応じて、適切なキャッシュ戦略を選択します。

| リソース種別 | 戦略 | 理由 |
|------------|------|------|
| HTMLページ | Stale-While-Revalidate | 即座に表示 + バックグラウンド更新 |
| 静的アセット（ハッシュ付き） | Cache-First | ハッシュが変われば別ファイル扱い |
| API | キャッシュしない | リアルタイムデータが必要 |

#### Stale-While-Revalidate

```
リクエスト
    ↓
[キャッシュあり?]
    ├─ Yes → キャッシュを即座に返却
    │         └─ 同時にネットワークから取得してキャッシュ更新
    │
    └─ No → ネットワークから取得
             └─ キャッシュに保存して返却
```

**メリット**: 常に高速な応答 + 次回アクセス時には最新版
**デメリット**: 最初の応答は古い可能性がある

#### Cache-First

```
リクエスト
    ↓
[キャッシュあり?]
    ├─ Yes → キャッシュを返却（ネットワークアクセスなし）
    │
    └─ No → ネットワークから取得してキャッシュに保存
```

**メリット**: ネットワークアクセスを最小化、最速
**デメリット**: キャッシュが古くなる可能性（ハッシュ付きファイルなら問題なし）

<a name="実装詳細-sw"></a>
### 実装詳細

#### 1. Service Workerの登録

```javascript
// sw-register.js
(function() {
  'use strict';

  // Service Worker非対応ブラウザはスキップ
  if (!('serviceWorker' in navigator)) {
    console.info('[SW] Service Worker not supported');
    return;
  }

  // ページロード完了後に登録（初回レンダリングをブロックしない）
  window.addEventListener('load', function() {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(function(registration) {
        console.info('[SW] Registered with scope:', registration.scope);

        // 更新の監視
        registration.addEventListener('updatefound', function() {
          var newWorker = registration.installing;
          if (!newWorker) return;

          newWorker.addEventListener('statechange', function() {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // 新しいバージョンが利用可能
              console.info('[SW] New version available');
              // ここでユーザーに更新を通知するUIを表示することも可能
            }
          });
        });
      })
      .catch(function(error) {
        console.error('[SW] Registration failed:', error);
      });
  });
})();
```

**ポイント**:
- `window.addEventListener('load', ...)` で初回レンダリングをブロックしない
- `scope: '/'` でサイト全体をカバー
- `updatefound` イベントで新しいバージョンを検知

#### 2. Installイベント：事前キャッシュ

```javascript
// sw.js
var CACHE_NAME = 'household-v1';
var STATIC_CACHE_NAME = 'household-static-v1';

// 事前キャッシュ対象
var PRECACHE_ASSETS = [
  '/household',
  '/pre-hydration-calculator.js',
  '/sw-register.js'
];

self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.info('[SW] Precaching assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(function() {
        // 即座にアクティブ化（待機中の古いSWをスキップ）
        return self.skipWaiting();
      })
  );
});
```

**ポイント**:
- `cache.addAll()` で複数のリソースを一括キャッシュ
- `self.skipWaiting()` で即座にアクティブ化
- 失敗すると install イベント全体が失敗するため、確実にキャッシュできるリソースのみ指定

#### 3. Activateイベント：古いキャッシュの削除

```javascript
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function(name) {
              // 現在のバージョン以外の household-* キャッシュを削除
              return (name.startsWith('household-') &&
                      name !== CACHE_NAME &&
                      name !== STATIC_CACHE_NAME);
            })
            .map(function(name) {
              console.info('[SW] Deleting old cache:', name);
              return caches.delete(name);
            })
        );
      })
      .then(function() {
        // 即座にクライアントを制御
        return self.clients.claim();
      })
  );
});
```

**ポイント**:
- キャッシュ名にバージョンを含める（`household-v1`）ことで、バージョン管理が容易
- `self.clients.claim()` で即座に既存のページを制御下に置く
- 他のサービスのキャッシュを誤って削除しないよう、プレフィックスでフィルタリング

#### 4. Fetchイベント：リクエストのインターセプト

```javascript
// APIリクエストの除外パターン
var API_PATTERNS = [
  /^\/api\//,
  /^\/trpc\//
];

// 静的アセットのパターン
var STATIC_PATTERNS = {
  // Vike生成アセット（ハッシュ付きファイル名 = 不変）
  assets: /\/assets\/(chunks|entries|static)\/.+\.(js|css)$/,
  // publicディレクトリのファイル
  publicFiles: /^\/(pre-hydration-calculator\.js|sw-register\.js|.*\.svg|.*\.png|.*\.ico)$/
};

self.addEventListener('fetch', function(event) {
  var request = event.request;
  var url = new URL(request.url);

  // GETリクエストのみ処理
  if (request.method !== 'GET') return;

  // クロスオリジンリクエストはスルー
  if (url.origin !== self.location.origin) return;

  // APIリクエストはスルー（キャッシュしない）
  for (var i = 0; i < API_PATTERNS.length; i++) {
    if (API_PATTERNS[i].test(url.pathname)) return;
  }

  // /household へのナビゲーションリクエスト
  if (request.mode === 'navigate' && url.pathname.startsWith('/household')) {
    event.respondWith(handleNavigationRequest(request));
    return;
  }

  // 静的アセット
  if (STATIC_PATTERNS.assets.test(url.pathname) ||
      STATIC_PATTERNS.publicFiles.test(url.pathname)) {
    event.respondWith(handleStaticAsset(request));
    return;
  }
});
```

**ポイント**:
- `event.respondWith()` を呼ばなければ、通常のネットワークリクエストとして処理される
- APIリクエストはキャッシュしない（リアルタイムデータが必要）
- `request.mode === 'navigate'` でページ遷移を検知

#### 5. Stale-While-Revalidate実装

```javascript
/**
 * Stale-While-Revalidate: ナビゲーションリクエスト用
 * キャッシュを即座に返しつつ、バックグラウンドで更新
 */
function handleNavigationRequest(request) {
  return caches.open(CACHE_NAME).then(function(cache) {
    return cache.match(request).then(function(cachedResponse) {
      // バックグラウンドで更新（Fire and forget）
      var fetchPromise = fetch(request)
        .then(function(networkResponse) {
          if (networkResponse.ok) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(function(error) {
          console.warn('[SW] Network request failed:', error);
          return null;
        });

      // キャッシュがあれば即座に返却
      if (cachedResponse) {
        // バックグラウンド更新は継続（結果は待たない）
        fetchPromise;  // Fire and forget
        return cachedResponse;
      }

      // キャッシュなし → ネットワークレスポンスを待つ
      return fetchPromise.then(function(networkResponse) {
        if (networkResponse) {
          return networkResponse;
        }
        // 完全オフラインでキャッシュもない場合
        return new Response('Offline - Please reconnect to use the app', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      });
    });
  });
}
```

**ポイント**:
- `networkResponse.clone()` でレスポンスを複製（ストリームは一度しか読めないため）
- キャッシュがある場合は即座に返却し、ネットワーク更新は待たない
- オフラインでキャッシュもない場合は503エラーを返す

#### 6. Cache-First実装

```javascript
/**
 * Cache-First: 静的アセット用
 * ハッシュ付きファイル名は不変なのでキャッシュ優先
 */
function handleStaticAsset(request) {
  return caches.open(STATIC_CACHE_NAME).then(function(cache) {
    return cache.match(request).then(function(cachedResponse) {
      if (cachedResponse) {
        return cachedResponse;
      }

      // キャッシュになければネットワークから取得してキャッシュ
      return fetch(request).then(function(networkResponse) {
        if (networkResponse.ok) {
          cache.put(request, networkResponse.clone());
        }
        return networkResponse;
      });
    });
  });
}
```

**ポイント**:
- ハッシュ付きファイル（例: `main.abc123.js`）は内容が変わればファイル名も変わるため、キャッシュを優先して問題ない
- 別キャッシュ（`STATIC_CACHE_NAME`）に分けることで、HTMLキャッシュとは別に管理

<a name="考慮事項-sw"></a>
### 考慮事項

#### 1. Service Workerのライフサイクル

```
[登録] → [install] → [waiting] → [activate] → [fetch処理可能]
                         ↑
                    古いSWがまだアクティブな場合は待機
```

`skipWaiting()` と `clients.claim()` を使うことで、即座にアクティブ化できますが、以下の注意点があります：

```javascript
// 注意: 古いページと新しいSWの組み合わせで問題が起きる可能性
// 例: 古いページが新しいキャッシュ構造を期待していない

// 対策: 互換性を保つか、ページリロードを促す
newWorker.addEventListener('statechange', function() {
  if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
    // ユーザーにリロードを促すUIを表示
    showUpdateAvailableNotification();
  }
});
```

#### 2. キャッシュの肥大化対策

```javascript
// キャッシュサイズの上限を設ける
var MAX_CACHE_SIZE = 50;

function trimCache(cacheName, maxSize) {
  caches.open(cacheName).then(function(cache) {
    cache.keys().then(function(keys) {
      if (keys.length > maxSize) {
        // 古いエントリを削除
        cache.delete(keys[0]).then(function() {
          trimCache(cacheName, maxSize);  // 再帰的に削減
        });
      }
    });
  });
}
```

#### 3. デバッグとテスト

```javascript
// 開発時のみキャッシュを無効化
if (location.hostname === 'localhost') {
  // キャッシュ戦略をネットワーク優先に変更
  // または Service Worker を登録しない
}

// Chrome DevToolsでの確認ポイント
// - Application > Service Workers: 状態確認
// - Application > Cache Storage: キャッシュ内容確認
// - Network > Offline: オフラインテスト
```

#### 4. HTTPS要件

Service Workerはセキュリティ上の理由から、HTTPS（または localhost）でのみ動作します。

```
✅ https://example.com/sw.js
✅ http://localhost/sw.js
❌ http://example.com/sw.js  ← HTTPでは登録できない
```

#### 5. スコープの制限

```javascript
// sw.js が /scripts/sw.js にある場合
navigator.serviceWorker.register('/scripts/sw.js');
// デフォルトのスコープは /scripts/ になる

// ルートからのスコープが必要な場合は、
// sw.js をルートに配置するか、
// サーバーで Service-Worker-Allowed ヘッダーを設定
```

<a name="参考資料-sw"></a>
### 参考資料

#### 公式ドキュメント

- [MDN: Service Worker API](https://developer.mozilla.org/ja/docs/Web/API/Service_Worker_API)
- [web.dev: Service Worker](https://web.dev/learn/pwa/service-workers/)
- [Google Developers: Service Worker Overview](https://developers.google.com/web/fundamentals/primers/service-workers)

#### キャッシュ戦略

- [web.dev: The Offline Cookbook](https://web.dev/articles/offline-cookbook)
- [Workbox Strategies](https://developer.chrome.com/docs/workbox/caching-strategies-overview/)

#### ライブラリ

- [Workbox](https://developer.chrome.com/docs/workbox/) - Googleが提供するService Workerライブラリ
- [sw-precache](https://github.com/GoogleChromeLabs/sw-precache) - 事前キャッシュ用ツール（現在はWorkboxを推奨）

#### デバッグツール

- [Chrome DevTools: Debug Service Workers](https://developer.chrome.com/docs/devtools/progressive-web-apps/)
- [Lighthouse PWA Audit](https://developer.chrome.com/docs/lighthouse/pwa/)

---

## 両技術の連携

Pre-hydration InteractivityとService Workerを組み合わせることで、以下のユーザー体験を実現しています：

```
オンライン時（初回訪問）:
1. ネットワークから /household を取得
2. Service Worker がキャッシュに保存
3. HTMLが描画される
4. Pre-hydration JS が即座に実行
5. 電卓がインタラクティブに！（< 500ms）
6. バックグラウンドでReactがhydration
7. Reactが引き継ぎ、追加機能が利用可能に

オンライン時（2回目以降）:
1. Service Worker がキャッシュから即座に応答
2. HTMLが描画される（< 100ms）
3. Pre-hydration JS が即座に実行
4. 電卓がインタラクティブに！
5. バックグラウンドで最新版を取得してキャッシュ更新

オフライン時:
1. Service Worker がキャッシュから応答
2. HTMLが描画される
3. Pre-hydration JS が実行
4. 電卓がインタラクティブに！
5. 入力はIndexedDBに保存
6. オンライン復帰後、サーバーに同期
```

### 相乗効果

| 技術 | 単体での効果 | 組み合わせでの効果 |
|------|------------|-----------------|
| Pre-hydration | hydration待ちを解消 | + キャッシュ表示で更に高速化 |
| Service Worker | オフライン対応 | + 即座にインタラクティブ |

---

## まとめ

### 実現した成果

| 指標 | 目標 | 実績 |
|------|------|------|
| First Contentful Paint | < 500ms | **約200ms**（キャッシュ時） |
| Time to Interactive | < 500ms | **約300ms**（Pre-hydration） |
| オフライン動作 | 100% | **100%** |

### 適用を検討すべきケース

**Pre-hydration Interactivity**:
- 特定のUIコンポーネントの即時応答が重要な場合
- フォーム入力など、ユーザーの待ち時間が許容できない場合
- SSRを使用しているが、hydrationに時間がかかる場合

**Service Worker キャッシュ**:
- オフライン対応が必要な場合
- リピートユーザーの体験を向上させたい場合
- ネットワーク環境が不安定なユーザーが想定される場合

### 注意点

両技術とも実装の複雑さが増すため、以下の点を考慮してください：

1. **デバッグの難しさ**: 複数のレイヤーが介在するため、問題の切り分けが困難になる
2. **状態管理の複雑さ**: Pre-hydrationとReactの状態同期に注意が必要
3. **キャッシュの整合性**: 古いキャッシュによる問題を考慮する必要がある

適切に実装すれば、ユーザー体験を大幅に向上させることができます。

---

## 付録：完全なソースコード

実装の全体像については、以下のファイルを参照してください：

- `public/pre-hydration-calculator.js` - Pre-hydration用電卓スクリプト
- `public/sw.js` - Service Worker本体
- `public/sw-register.js` - Service Worker登録スクリプト
