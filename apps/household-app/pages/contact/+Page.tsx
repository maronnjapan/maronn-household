import { useState } from 'react';
import { trpc } from '../../trpc/client';
import './contact.css';

interface FormData {
  name: string;
  email: string;
  subject: string;
  message: string;
}

interface FormErrors {
  name?: string;
  email?: string;
  subject?: string;
  message?: string;
}

export default function ContactPage() {
  const [formData, setFormData] = useState<FormData>({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const sendContactMutation = trpc.sendContactMessage.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setFormData({ name: '', email: '', subject: '', message: '' });
    },
  });

  function validateForm(): boolean {
    const newErrors: FormErrors = {};

    if (!formData.name.trim()) {
      newErrors.name = 'お名前を入力してください';
    }

    if (!formData.email.trim()) {
      newErrors.email = 'メールアドレスを入力してください';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) {
      newErrors.email = '有効なメールアドレスを入力してください';
    }

    if (!formData.subject.trim()) {
      newErrors.subject = '件名を入力してください';
    }

    if (!formData.message.trim()) {
      newErrors.message = 'お問い合わせ内容を入力してください';
    } else if (formData.message.length < 10) {
      newErrors.message = 'お問い合わせ内容は10文字以上で入力してください';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleInputChange(
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>
  ) {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // 入力時にエラーをクリア
    if (errors[name as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }));
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    sendContactMutation.mutate(formData);
  }

  if (submitted) {
    return (
      <div className="contact-page">
        <div className="contact-success">
          <h1>お問い合わせありがとうございます</h1>
          <p>
            お問い合わせを受け付けました。
            <br />
            内容を確認の上、ご連絡させていただきます。
          </p>
          <button
            type="button"
            className="contact-button"
            onClick={() => setSubmitted(false)}
          >
            新しいお問い合わせ
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="contact-page">
      <h1>お問い合わせ</h1>
      <p className="contact-description">
        ご質問・ご要望・不具合報告などお気軽にお問い合わせください。
      </p>

      <form className="contact-form" onSubmit={handleSubmit}>
        <div className="contact-field">
          <label htmlFor="name">お名前</label>
          <input
            type="text"
            id="name"
            name="name"
            value={formData.name}
            onChange={handleInputChange}
            placeholder="山田 太郎"
            disabled={sendContactMutation.isPending}
          />
          {errors.name && <span className="contact-error">{errors.name}</span>}
        </div>

        <div className="contact-field">
          <label htmlFor="email">メールアドレス</label>
          <input
            type="email"
            id="email"
            name="email"
            value={formData.email}
            onChange={handleInputChange}
            placeholder="example@mail.com"
            disabled={sendContactMutation.isPending}
          />
          {errors.email && (
            <span className="contact-error">{errors.email}</span>
          )}
        </div>

        <div className="contact-field">
          <label htmlFor="subject">件名</label>
          <input
            type="text"
            id="subject"
            name="subject"
            value={formData.subject}
            onChange={handleInputChange}
            placeholder="お問い合わせ件名"
            disabled={sendContactMutation.isPending}
          />
          {errors.subject && (
            <span className="contact-error">{errors.subject}</span>
          )}
        </div>

        <div className="contact-field">
          <label htmlFor="message">お問い合わせ内容</label>
          <textarea
            id="message"
            name="message"
            value={formData.message}
            onChange={handleInputChange}
            placeholder="お問い合わせ内容を入力してください"
            rows={6}
            disabled={sendContactMutation.isPending}
          />
          {errors.message && (
            <span className="contact-error">{errors.message}</span>
          )}
        </div>

        {sendContactMutation.isError && (
          <div className="contact-error-message">
            送信に失敗しました。しばらく経ってから再度お試しください。
          </div>
        )}

        <button
          type="submit"
          className="contact-button"
          disabled={sendContactMutation.isPending}
        >
          {sendContactMutation.isPending ? '送信中...' : '送信する'}
        </button>
      </form>
    </div>
  );
}
