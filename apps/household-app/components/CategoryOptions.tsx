import { useCategories } from '../hooks/use-categories';
import { categoryChoices } from '../lib/categories';

interface CategoryOptionsProps {
  /** select で選んでいる値（未選択は空文字） */
  selected: string;
}

/**
 * カテゴリーの select の選択肢（ユーザーのカテゴリー）
 * select の中で描画したときだけ一覧を取得する（記録ページでは「詳細設定」を開いたときだけ）
 */
export function CategoryOptions({ selected }: CategoryOptionsProps) {
  const { categories } = useCategories();

  return (
    <>
      {categoryChoices(categories, selected).map((choice) => (
        <option key={choice.value} value={choice.value}>
          {choice.label}
        </option>
      ))}
    </>
  );
}
