import { useAuth } from '../../hooks/use-auth';
import { DeleteAccountSection } from '../../components/DeleteAccountSection';
import { HandPreferenceSection } from '../../components/HandPreferenceSection';
import { ApiTokenSection } from '../../components/ApiTokenSection';
import { WebhookSection } from '../../components/WebhookSection';
import { BudgetAlertSection } from '../../components/BudgetAlertSection';
import './settings.css';

/**
 * 設定ページ
 * 利き手設定は全ユーザーがアクセス可能
 * 退会機能は認証済みユーザーのみ
 */
export function Page() {
  const { isLoading, isAuthenticated } = useAuth();

  return (
    <main className="settings-page">
      <h1>設定</h1>
      <HandPreferenceSection />
      {isLoading ? (
        <p>読込中...</p>
      ) : isAuthenticated ? (
        <>
          <BudgetAlertSection />
          <ApiTokenSection />
          <WebhookSection />
          <DeleteAccountSection />
        </>
      ) : null}
    </main>
  );
}
