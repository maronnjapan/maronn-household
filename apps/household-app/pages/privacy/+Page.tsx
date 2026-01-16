import './privacy.css';

/**
 * プライバシーポリシーページ
 * 個人情報の取り扱いに関する方針を明示
 */
export function Page() {
  return (
    <main className="privacy-page">
      <header>
        <h1>プライバシーポリシー</h1>
        <p className="last-updated">最終更新日: 2026年1月16日</p>
      </header>

      <section className="privacy-section">
        <h2>1. はじめに</h2>
        <p>
          本プライバシーポリシーは、本家計簿アプリ（以下「本サービス」）における個人情報の取扱いについて説明するものです。
          本サービスは、ユーザーのプライバシーを尊重し、個人情報を適切に保護することをお約束します。
        </p>
      </section>

      <section className="privacy-section">
        <h2>2. 収集する情報</h2>
        <p>本サービスでは、以下の情報を収集します：</p>
        <ul>
          <li>
            <strong>アカウント情報</strong>: メールアドレス、パスワード（暗号化して保存）
          </li>
          <li>
            <strong>家計簿データ</strong>: 支出金額、カテゴリ、メモ、日付、予算設定
          </li>
          <li>
            <strong>デバイス情報</strong>: デバイスID（複数デバイス間の同期に使用）
          </li>
          <li>
            <strong>利用状況データ</strong>: アクセス日時、IPアドレス、ブラウザ情報
          </li>
        </ul>
      </section>

      <section className="privacy-section">
        <h2>3. 情報の使用目的</h2>
        <p>収集した情報は、以下の目的で使用します：</p>
        <ul>
          <li>本サービスの提供、維持、改善</li>
          <li>ユーザーアカウントの管理および認証</li>
          <li>複数デバイス間でのデータ同期</li>
          <li>サービスの不正利用の防止</li>
          <li>ユーザーサポートの提供</li>
          <li>サービスの利用状況分析および機能改善</li>
        </ul>
      </section>

      <section className="privacy-section">
        <h2>4. 情報の共有</h2>
        <p>
          本サービスは、ユーザーの個人情報を第三者に販売、貸与、または共有することはありません。
          ただし、以下の場合には情報を開示する場合があります：
        </p>
        <ul>
          <li>ユーザーの同意がある場合</li>
          <li>法令に基づく開示が必要な場合</li>
          <li>
            サービスの運営に必要なインフラ提供者（Cloudflare等）への提供（これらの提供者は契約により情報保護が義務付けられています）
          </li>
        </ul>
      </section>

      <section className="privacy-section">
        <h2>5. データの保存場所と期間</h2>
        <p>
          ユーザーの家計簿データは、以下の場所に保存されます：
        </p>
        <ul>
          <li>
            <strong>ローカルストレージ（IndexedDB）</strong>: ユーザーのデバイス上に保存され、オフラインでもアクセス可能
          </li>
          <li>
            <strong>クラウドデータベース（Cloudflare D1）</strong>: 複数デバイス間の同期およびバックアップ用
          </li>
        </ul>
        <p>
          データは、ユーザーがアカウントを削除するまで保存されます。アカウント削除後、すべてのデータは30日以内に完全に削除されます。
        </p>
      </section>

      <section className="privacy-section">
        <h2>6. セキュリティ</h2>
        <p>
          本サービスは、ユーザーの個人情報を保護するために以下のセキュリティ対策を実施しています：
        </p>
        <ul>
          <li>HTTPS通信による暗号化</li>
          <li>パスワードのハッシュ化保存</li>
          <li>定期的なセキュリティ監査</li>
          <li>最小権限の原則に基づくアクセス制御</li>
        </ul>
        <p>
          ただし、インターネット上の通信やデータ保存に完全なセキュリティを保証することはできません。
          ユーザーは、強固なパスワードの使用など、自身のアカウントのセキュリティにも注意を払ってください。
        </p>
      </section>

      <section className="privacy-section">
        <h2>7. ユーザーの権利</h2>
        <p>ユーザーは、以下の権利を有します：</p>
        <ul>
          <li>
            <strong>アクセス権</strong>: 自身の個人情報へのアクセス
          </li>
          <li>
            <strong>修正権</strong>: 不正確な情報の修正
          </li>
          <li>
            <strong>削除権</strong>: アカウントおよびすべてのデータの削除
          </li>
          <li>
            <strong>データポータビリティ権</strong>: データのエクスポート（CSV形式）
          </li>
        </ul>
        <p>
          これらの権利を行使するには、設定ページまたはお問い合わせフォームからご連絡ください。
        </p>
      </section>

      <section className="privacy-section">
        <h2>8. Cookie およびローカルストレージ</h2>
        <p>
          本サービスは、以下の目的でCookieおよびローカルストレージ技術を使用します：
        </p>
        <ul>
          <li>ユーザーのログイン状態の維持</li>
          <li>ユーザー設定の保存</li>
          <li>オフライン機能の提供（IndexedDB）</li>
        </ul>
        <p>
          ブラウザの設定でCookieを無効化することも可能ですが、その場合、一部の機能が制限される可能性があります。
        </p>
      </section>

      <section className="privacy-section">
        <h2>9. 子供のプライバシー</h2>
        <p>
          本サービスは、13歳未満の子供を対象としていません。13歳未満の子供の個人情報を意図的に収集することはありません。
          保護者の方で、お子様が個人情報を提供したことにお気づきの場合は、お問い合わせください。
        </p>
      </section>

      <section className="privacy-section">
        <h2>10. プライバシーポリシーの変更</h2>
        <p>
          本プライバシーポリシーは、法令の変更やサービスの改善に伴い、予告なく変更される場合があります。
          重要な変更がある場合は、本ページおよびサービス内で通知します。
          定期的に本ページを確認することをお勧めします。
        </p>
      </section>

      <section className="privacy-section">
        <h2>11. お問い合わせ</h2>
        <p>
          本プライバシーポリシーに関するご質問や、個人情報の取扱いに関するお問い合わせは、
          <a href="/contact" className="contact-link">お問い合わせフォーム</a>からご連絡ください。
        </p>
      </section>
    </main>
  );
}
