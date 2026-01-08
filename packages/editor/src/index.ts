/**
 * @maronn/editor
 *
 * Milkdownベースのマークダウンエディタライブラリ
 *
 * @example
 * ```tsx
 * import { Editor } from '@maronn/editor';
 *
 * function App() {
 *   return (
 *     <Editor
 *       defaultValue="# Hello World"
 *       onChange={(markdown) => console.log(markdown)}
 *     />
 *   );
 * }
 * ```
 */

export { getEditorModule } from './editor.ts';
export type { EditorProps } from './editor.ts';
export type {
  EditorTheme,
  EditorConfig,
  EditorInstance,
} from './types';
