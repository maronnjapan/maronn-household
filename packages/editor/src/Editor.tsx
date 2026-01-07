import { Editor as MilkdownEditor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { nord } from '@milkdown/theme-nord';
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
import type { CSSProperties } from 'react';

/**
 * エディタコンポーネントのプロパティ
 */
export interface EditorProps {
  /**
   * 初期値（Markdown形式）
   * @default ''
   */
  defaultValue?: string;

  /**
   * エディタの内容が変更されたときのコールバック
   * @param markdown - 変更後のMarkdown文字列
   */
  onChange?: (markdown: string) => void;

  /**
   * エディタのスタイル
   */
  style?: CSSProperties;

  /**
   * エディタのクラス名
   */
  className?: string;

  /**
   * 読み取り専用モード
   * @default false
   */
  readOnly?: boolean;

  /**
   * プレースホルダーテキスト
   */
  placeholder?: string;
}

interface EditorComponentProps extends EditorProps {
  // MilkdownProviderの内部で使用
}

function EditorComponent({
  defaultValue = '',
  onChange,
  style,
  className,
  readOnly = false,
}: EditorComponentProps) {
  useEditor((root) =>
    MilkdownEditor.make()
      .config((ctx) => {
        ctx.set(rootCtx, root);
        ctx.set(defaultValueCtx, defaultValue);

        // 読み取り専用モードの設定
        if (readOnly) {
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            editable: () => false,
          }));
        }

        // onChangeハンドラの設定
        if (onChange) {
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onChange(markdown);
          });
        }
      })
      .config(nord)
      .use(commonmark)
      .use(listener)
  );

  return (
    <div style={style} className={className}>
      <Milkdown />
    </div>
  );
}

/**
 * Milkdownベースのマークダウンエディタコンポーネント
 *
 * @example
 * 基本的な使い方:
 * ```tsx
 * import { Editor } from '@maronn/editor';
 *
 * function MyComponent() {
 *   const [markdown, setMarkdown] = useState('# Hello World');
 *
 *   return (
 *     <Editor
 *       defaultValue={markdown}
 *       onChange={setMarkdown}
 *       style={{ height: '400px' }}
 *     />
 *   );
 * }
 * ```
 *
 * @example
 * 読み取り専用モード:
 * ```tsx
 * <Editor
 *   defaultValue="# Read Only Content"
 *   readOnly
 * />
 * ```
 */
export function Editor(props: EditorProps) {
  return (
    <MilkdownProvider>
      <EditorComponent {...props} />
    </MilkdownProvider>
  );
}
