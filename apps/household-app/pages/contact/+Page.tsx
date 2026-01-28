import './contact.css';

const GOOGLE_FORM_URL =
  'https://docs.google.com/forms/d/e/1FAIpQLSepN68u_vfFX1rBoO27yfRA4slx0m5N5v9li_cH1_zaOxz5ag/viewform?usp=publish-editor';

export default function ContactPage() {
  return (
    <div className="contact-page">
      <h1>お問い合わせ</h1>
      <p className="contact-description">
        ご質問・ご要望・不具合報告などお気軽にお問い合わせください。
      </p>

      <div className="contact-form-link">
        <p>お問い合わせはGoogleフォームから受け付けております。</p>
        <a
          href={GOOGLE_FORM_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="contact-button"
        >
          お問い合わせフォームを開く
        </a>
      </div>
    </div>
  );
}
