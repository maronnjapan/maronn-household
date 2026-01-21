import './guide.css';
import ReactMarkdown from 'react-markdown';
import guideContent from './usage-guide.md?raw';

export default function GuidePage() {
  return (
    <div className="guide-page">
      <div className="guide-container">
        <ReactMarkdown className="markdown-content">{guideContent}</ReactMarkdown>
      </div>
    </div>
  );
}
