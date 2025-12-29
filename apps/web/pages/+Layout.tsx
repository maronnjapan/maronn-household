// バックグラウンド同期を確実に起動するため、モジュールをインポート
import '#lib/sync';

/**
 * グローバルレイアウト
 * すべてのページで共通のレイアウト
 */
export function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
