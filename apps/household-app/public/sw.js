/**
 * Service Worker for /household page
 * オフラインでも爆速表示 + IndexedDB保存を実現
 *
 * キャッシュ戦略:
 * - ナビゲーション (/household): Stale-While-Revalidate
 * - 静的アセット (/assets/*, public files): Cache-First
 * - API (/api/*, /trpc/*): キャッシュしない
 */

'use strict';

// キャッシュ名（バージョン管理用）
var CACHE_NAME = 'household-v1';
var STATIC_CACHE_NAME = 'household-static-v1';

// 事前キャッシュ対象
var PRECACHE_ASSETS = [
  '/household',
  '/pre-hydration-calculator.js',
  '/sw-register.js'
];

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

/**
 * Install イベント: 事前キャッシュ
 */
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function(cache) {
        console.info('[SW] Precaching assets');
        return cache.addAll(PRECACHE_ASSETS);
      })
      .then(function() {
        // 即座にアクティブ化
        return self.skipWaiting();
      })
  );
});

/**
 * Activate イベント: 古いキャッシュの削除
 */
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys()
      .then(function(cacheNames) {
        return Promise.all(
          cacheNames
            .filter(function(name) {
              // household-* で始まるが現在のバージョンではないものを削除
              return (name.startsWith('household-') && name !== CACHE_NAME && name !== STATIC_CACHE_NAME);
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

/**
 * Fetch イベント: リクエストのインターセプト
 */
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
  if (STATIC_PATTERNS.assets.test(url.pathname) || STATIC_PATTERNS.publicFiles.test(url.pathname)) {
    event.respondWith(handleStaticAsset(request));
    return;
  }

  // /household 配下のその他のリクエスト（CSS等）
  if (url.pathname.startsWith('/household')) {
    event.respondWith(handleNavigationRequest(request));
    return;
  }
});

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
        fetchPromise;
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
