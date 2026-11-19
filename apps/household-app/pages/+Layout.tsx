import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../styles/global.css";

import logoUrl from "../assets/kakeibo-icon.svg";
import { Link } from "../components/Link";
import { trpc, getTRPCClient } from "../trpc/client";
import { AuthButton } from "../components/AuthButton";
import { ClientOnly } from 'vike-react/ClientOnly'
import { FloatingExpenseContainer } from "../components/FloatingExpenseContainer";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5分
    },
  },
});

const trpcClient = getTRPCClient();

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        <div id="page-container">
          <AppHeader />
          <div id="page-content">{children}</div>
          <AppFooter />
        </div>
        <ClientOnly fallback={null}>
          <FloatingExpenseContainer />
        </ClientOnly>
      </QueryClientProvider>
    </trpc.Provider>
  );
}

/**
 * 上部ヘッダー（通常フロー。固定・重なりなし）
 * 1段目: ブランド（左）+ 認証ボタン（右）
 * 2段目: 主要ページへのタブ
 */
function AppHeader() {
  return (
    <header className="app-header">
      <div className="app-header-bar">
        <a href="/household" className="app-brand">
          <img src={logoUrl} width={28} height={28} alt="" />
          <span>家計簿</span>
        </a>
        {/* 認証状態はクライアントでしか確定しないため、枠の大きさを先に確保してレイアウトのずれを防ぐ */}
        <div className="app-header-auth">
          <AuthButton />
        </div>
      </div>
      <nav className="app-nav" aria-label="メインメニュー">
        <Link href="/household">記録</Link>
        <Link href="/household/budget">予算</Link>
        <Link href="/calendar">カレンダー</Link>
        <Link href="/settings">設定</Link>
      </nav>
    </header>
  );
}

/**
 * 下部フッター（補助的なリンク）
 */
function AppFooter() {
  return (
    <footer className="app-footer">
      <nav className="app-footer-links" aria-label="その他のリンク">
        <a href="/guide">使い方</a>
        <a href="/contact">お問い合わせ</a>
        <a href="/privacy">プライバシー</a>
        <a href="/terms">利用規約</a>
      </nav>
    </footer>
  );
}
