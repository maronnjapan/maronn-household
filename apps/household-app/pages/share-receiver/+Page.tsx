import { navigate } from 'vike/client/router';
import { useEffect } from 'react';
import { extractAmount } from '../../utils/extract-amount';

/**
 * Share Target API 受け取りページ
 *
 * 通知からの共有を受け取り、金額を抽出して /household にリダイレクト
 *
 * Flow:
 * 1. クエリパラメータから text, title を取得
 * 2. extractAmount() で金額を抽出
 * 3. /household?amount=XXX にリダイレクト
 */
export function Page() {
  useEffect(() => {
    // クエリパラメータを取得
    const params = new URLSearchParams(window.location.search);
    const text = params.get('text') || '';
    const title = params.get('title') || '';

    // テキストから金額を抽出（title も試す）
    const amount = extractAmount(text) || extractAmount(title);

    // リダイレクト先を決定
    if (amount) {
      // 金額が見つかった場合: クエリパラメータに金額を付けて /household へ
      navigate(`/household?amount=${amount}`);
    } else {
      // 金額が見つからない場合: そのまま /household へ
      navigate('/household');
    }
  }, []);

  // リダイレクト中の表示
  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      padding: '1rem',
      textAlign: 'center'
    }}>
      <p style={{ fontSize: '1rem', color: '#666' }}>
        金額を読み取り中...
      </p>
    </div>
  );
}
