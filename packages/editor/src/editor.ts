import { Editor as MilkdownEditor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { nord } from '@milkdown/theme-nord';
import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
export interface EditorProps {

    /**
     * エディタの適用先
     * @remarks HTMLElementまたはIDセレクタ文字列
     */
    root: HTMLElement | string;

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
     * 読み取り専用モード
     * @default false
     */
    readOnly?: boolean;

    /**
     * プレースホルダーテキスト
     */
    placeholder?: string;
}

export const getEditorModule = ({ root, defaultValue = '', readOnly, onChange }: EditorProps) => MilkdownEditor.make().config((ctx) => {
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