import { describe, expect, it } from 'vitest';
import { editStoreNameField, storeNameFieldFrom, storeNameToSave } from './store-name-field';

describe('店名の欄（カレンダーの編集）', () => {
  it('店名が分かっている支出は、欄に触れなくても今の店名を保存する', () => {
    expect(storeNameToSave(storeNameFieldFrom('スーパーA'))).toBe('スーパーA');
    expect(storeNameToSave(storeNameFieldFrom(null))).toBe('');
  });

  it('店名を知らない古い JS が取り込んだ支出（undefined）は、欄に触れなければ店名を送らない（サーバーの店名を消さない）', () => {
    const field = storeNameFieldFrom(undefined);

    expect(field.value).toBe('');
    expect(storeNameToSave(field)).toBeUndefined();
  });

  it('欄を編集したら、店名を知らない支出でも入力した値（空なら消す）を保存する', () => {
    expect(storeNameToSave(editStoreNameField('スーパーB'))).toBe('スーパーB');
    expect(storeNameToSave(editStoreNameField(''))).toBe('');
  });
});
