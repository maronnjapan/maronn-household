# @maronn/editor

Milkdown ベースのマークダウンエディタコンポーネント

## 使い方

```tsx
import { Editor } from '@maronn/editor';

function MyComponent() {
  return (
    <Editor
      defaultValue="# Hello World"
      onChange={(markdown) => console.log(markdown)}
      height="400px"
    />
  );
}
```

## Props

- `defaultValue?: string` - 初期値（Markdown形式）
- `onChange?: (markdown: string) => void` - エディタの内容が変更されたときのコールバック
- `height?: string` - エディタの高さ（デフォルト: '100%'）
- `readOnly?: boolean` - 読み取り専用モード（デフォルト: false）

## 開発

プレイグラウンドで動作確認：

```bash
cd playgrounds/editor
pnpm dev
```
