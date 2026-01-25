import './privacy.css';
import ReactMarkdown from 'react-markdown';
import privacyContent from './privacy-policy.md?raw';

export default function PrivacyPage() {
  return (
    <div className="privacy-page">
      <div className="privacy-container">
        <ReactMarkdown className="markdown-content">{privacyContent}</ReactMarkdown>
      </div>
    </div>
  );
}
