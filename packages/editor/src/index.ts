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

export { Editor } from './Editor';
export type { EditorProps } from './Editor';
export type {
  EditorTheme,
  EditorConfig,
  EditorInstance,
} from './types';
