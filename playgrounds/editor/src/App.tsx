import { useEffect, useState } from 'react';
import { getEditorModule } from '@maronn/editor';

const defaultMarkdown = `# Milkdown Editor Playground

## 特徴

- **シンプル**: 使いやすいAPIを提供
- **高速**: 軽量で高速な動作
- **拡張可能**: プラグインで機能を追加可能

## 使い方

エディタに自由に入力してください。

### コードブロック

\`\`\`typescript
function hello() {
  console.log('Hello, World!');
}
\`\`\`

### リスト

1. 項目1
2. 項目2
3. 項目3

---

このプレイグラウンドは開発用です。本番環境にはデプロイされません。
`;

function App() {
  const [markdown, setMarkdown] = useState(defaultMarkdown);
  const editor = getEditorModule({
    root: '#milkdown-editor',
    defaultValue: defaultMarkdown,
    onChange: (md) => setMarkdown(md),
  });

  useEffect(() => {
    editor.create();
  }, []);

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      padding: '20px',
      boxSizing: 'border-box'
    }}>
      <h1 style={{ marginBottom: '20px' }}>Milkdown Editor Playground</h1>

      <div style={{
        display: 'flex',
        gap: '20px',
        flex: 1,
        minHeight: 0
      }}>
        {/* エディタ部分 */}
        <div style={{
          flex: 1,
          border: '1px solid #ccc',
          borderRadius: '4px',
          overflow: 'auto'
        }}

        >
          <div id="milkdown-editor" style={{ height: '100%' }}></div>
        </div>

        {/* プレビュー部分（将来の拡張用） */}
        <div style={{
          flex: 1,
          border: '1px solid #ccc',
          borderRadius: '4px',
          padding: '20px',
          overflow: 'auto',
          backgroundColor: '#f9f9f9'
        }}>
          <h2>Markdown Output</h2>
          <pre style={{
            whiteSpace: 'pre-wrap',
            wordWrap: 'break-word',
            fontFamily: 'monospace',
            fontSize: '14px'
          }}>
            {markdown}
          </pre>
        </div>
      </div>
    </div>
  );
}

export default App;
