import { useEffect } from 'react';
import { startBackgroundSync } from '#lib/sync';

/**
 * グローバルレイアウト
 * すべてのページで共通のロジックを実行
 */
export function Layout({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    // アプリ起動時にバックグラウンド同期を開始
    startBackgroundSync();
  }, []);

  return <>{children}</>;
}
