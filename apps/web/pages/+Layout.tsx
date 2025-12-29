// バックグラウンド同期を確実に起動するため、モジュールをインポート
import '#lib/sync';
// グローバルスタイルをインポート
import '../styles/global.css';

/**
 * グローバルレイアウト
 * すべてのページで共通のレイアウト
 */
export function Layout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
