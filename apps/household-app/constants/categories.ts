/**
 * 支出カテゴリーマスターデータ
 * 家計簿で使用するカテゴリー一覧
 */

export const EXPENSE_CATEGORIES = [
  { value: 'food', label: '食費' },
  { value: 'daily-goods', label: '日用品' },
  { value: 'transportation', label: '交通費' },
  { value: 'utilities', label: '光熱費' },
  { value: 'communication', label: '通信費' },
  { value: 'medical', label: '医療費' },
  { value: 'entertainment', label: '娯楽費' },
  { value: 'clothing', label: '被服費' },
  { value: 'education', label: '教育費' },
  { value: 'housing', label: '住居費' },
  { value: 'insurance', label: '保険料' },
  { value: 'other', label: 'その他' },
] as const;

export type ExpenseCategoryValue = (typeof EXPENSE_CATEGORIES)[number]['value'];
