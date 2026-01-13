import { useState } from 'react';

interface AccordionProps {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}

/**
 * アコーディオンコンポーネント
 * クリックで開閉可能なコンテナ
 */
export function Accordion({ title, children, defaultOpen = false }: AccordionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="accordion">
      <button type="button" className="accordion-header" onClick={() => setIsOpen(!isOpen)}>
        <span className="accordion-title">{title}</span>
        <span className="accordion-icon">{isOpen ? '▼' : '▶'}</span>
      </button>
      {isOpen && <div className="accordion-content">{children}</div>}
    </div>
  );
}
