import type { CSSProperties } from 'react';

/**
 * エディタのテーマ
 */
export type EditorTheme = 'nord' | 'tokyo-night' | 'github';

/**
 * エディタの設定オプション
 */
export interface EditorConfig {
  /**
   * テーマ
   * @default 'nord'
   */
  theme?: EditorTheme;
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

/**
 * エディタのインスタンス（将来の拡張用）
 */
export interface EditorInstance {
  /**
   * エディタの内容を取得
   */
  getMarkdown: () => string;
  /**
   * エディタの内容を設定
   */
  setMarkdown: (markdown: string) => void;
  /**
   * エディタをフォーカス
   */
  focus: () => void;
  /**
   * エディタをクリア
   */
  clear: () => void;
}

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
export function Editor(props: EditorProps): JSX.Element;
