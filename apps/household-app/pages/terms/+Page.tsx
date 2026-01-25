import './terms.css';
import ReactMarkdown from 'react-markdown';
import termsContent from './terms-of-service.md?raw';

export default function TermsPage() {
  return (
    <div className="terms-page">
      <div className="terms-container">
        <ReactMarkdown className="markdown-content">{termsContent}</ReactMarkdown>
      </div>
    </div>
  );
}
