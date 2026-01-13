import { useState } from 'react';
import { trpc } from '../trpc/client';
import './ContactForm.css';

interface FormState {
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

/**
 * お問い合わせフォームコンポーネント
 * Resend APIを使ってメールを送信
 */
export function ContactForm() {
  const [formState, setFormState] = useState<FormState>({
    name: '',
    email: '',
    subject: '',
    message: '',
  });
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitStatus, setSubmitStatus] = useState<'idle' | 'success' | 'error'>('idle');

  const sendEmailMutation = trpc.sendContactEmail.useMutation();

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formState.name.trim()) {
      newErrors.name = '名前を入力してください';
    }

    if (!formState.email.trim()) {
      newErrors.email = 'メールアドレスを入力してください';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formState.email)) {
      newErrors.email = '有効なメールアドレスを入力してください';
    }

    if (!formState.subject.trim()) {
      newErrors.subject = '件名を入力してください';
    }

    if (!formState.message.trim()) {
      newErrors.message = 'お問い合わせ内容を入力してください';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleChange = (field: keyof FormState, value: string) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
    // エラーをクリア
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }));
    }
    // 送信状態をリセット
    if (submitStatus !== 'idle') {
      setSubmitStatus('idle');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    sendEmailMutation.mutate(
      {
        name: formState.name.trim(),
        email: formState.email.trim(),
        subject: formState.subject.trim(),
        message: formState.message.trim(),
      },
      {
        onSuccess: () => {
          setSubmitStatus('success');
          setFormState({
            name: '',
            email: '',
            subject: '',
            message: '',
          });
        },
        onError: () => {
          setSubmitStatus('error');
        },
      }
    );
  };

  return (
    <form onSubmit={handleSubmit} className="contact-form">
      {submitStatus === 'success' && (
        <div className="success-message">
          お問い合わせを送信しました。ご連絡ありがとうございます。
        </div>
      )}

      {submitStatus === 'error' && (
        <div className="error-message">
          送信に失敗しました。時間をおいて再度お試しください。
        </div>
      )}

      <div className="form-group">
        <label htmlFor="name" className="form-label">
          お名前 <span className="required">*</span>
        </label>
        <input
          id="name"
          type="text"
          value={formState.name}
          onChange={(e) => handleChange('name', e.target.value)}
          className={`form-input ${errors.name ? 'error' : ''}`}
          placeholder="山田 太郎"
        />
        {errors.name && <span className="error-text">{errors.name}</span>}
      </div>

      <div className="form-group">
        <label htmlFor="email" className="form-label">
          メールアドレス <span className="required">*</span>
        </label>
        <input
          id="email"
          type="email"
          value={formState.email}
          onChange={(e) => handleChange('email', e.target.value)}
          className={`form-input ${errors.email ? 'error' : ''}`}
          placeholder="example@example.com"
        />
        {errors.email && <span className="error-text">{errors.email}</span>}
      </div>

      <div className="form-group">
        <label htmlFor="subject" className="form-label">
          件名 <span className="required">*</span>
        </label>
        <input
          id="subject"
          type="text"
          value={formState.subject}
          onChange={(e) => handleChange('subject', e.target.value)}
          className={`form-input ${errors.subject ? 'error' : ''}`}
          placeholder="お問い合わせの件名"
        />
        {errors.subject && <span className="error-text">{errors.subject}</span>}
      </div>

      <div className="form-group">
        <label htmlFor="message" className="form-label">
          お問い合わせ内容 <span className="required">*</span>
        </label>
        <textarea
          id="message"
          value={formState.message}
          onChange={(e) => handleChange('message', e.target.value)}
          className={`form-textarea ${errors.message ? 'error' : ''}`}
          placeholder="お問い合わせ内容を入力してください"
          rows={8}
        />
        {errors.message && <span className="error-text">{errors.message}</span>}
      </div>

      <button
        type="submit"
        disabled={sendEmailMutation.isPending}
        className="submit-button"
      >
        {sendEmailMutation.isPending ? '送信中...' : '送信する'}
      </button>
    </form>
  );
}
