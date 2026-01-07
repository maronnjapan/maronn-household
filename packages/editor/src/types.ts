/**
 * エディタの型定義
 */

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
