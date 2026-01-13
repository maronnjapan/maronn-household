import { ContactForm } from '../../components/ContactForm';
import './contact.css';

/**
 * お問い合わせページ
 * ユーザーからの問い合わせを受け付けるフォーム
 */
export function Page() {
  return (
    <main className="contact-page">
      <header>
        <h1>お問い合わせ</h1>
        <p className="description">
          ご質問、ご要望、バグ報告などお気軽にお問い合わせください。
        </p>
      </header>

      <section className="form-section">
        <ContactForm />
      </section>
    </main>
  );
}
