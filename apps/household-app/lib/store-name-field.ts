/**
 * カレンダーの編集フォームの店名の欄
 *
 * 店名を知らない古い JS が取り込んだ支出（storeName が undefined）は、欄が空で始まる。
 * そのまま空の店名を送るとサーバーの店名が消えるので、店名が分かっている支出か、欄を編集したときだけ保存する（内訳の saveItems と同じ考え方）
 */

export interface StoreNameField {
  /** 欄の値 */
  value: string;
  /** 保存するか（店名が分かっている、または欄を編集した） */
  save: boolean;
}

/** 支出の店名から欄を作る */
export function storeNameFieldFrom(storeName: string | null | undefined): StoreNameField {
  return { value: storeName ?? '', save: storeName !== undefined };
}

/** 欄を編集した */
export function editStoreNameField(value: string): StoreNameField {
  return { value, save: true };
}

/** 保存する店名（空文字は店名を消す。undefined は変えない） */
export function storeNameToSave(field: StoreNameField): string | undefined {
  return field.save ? field.value : undefined;
}
