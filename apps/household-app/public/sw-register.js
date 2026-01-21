/**
 * Service Worker Registration Script
 * /household ページのオフラインサポートを提供
 */
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
            }
          });
        });
      })
      .catch(function(error) {
        console.error('[SW] Registration failed:', error);
      });
  });
})();
