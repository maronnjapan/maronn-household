import { describe, expect, it } from 'vitest';
import {
  draftsFromItems,
  finalizeItemDrafts,
  initialSpreadDifference,
  newItemDraft,
  updateItemDraft,
  parseItemDrafts,
  summarizeItemDrafts,
  type ItemDraft,
} from './expense-items';

const draft = (overrides: Partial<ItemDraft>): ItemDraft => ({ ...newItemDraft(), ...overrides });

describe('parseItemDrafts', () => {
  it('入力した行を内訳にする（品名の前後の空白を除き、カテゴリーが空なら会計のカテゴリーに任せる）', () => {
    const result = parseItemDrafts([
      draft({ name: ' 牛乳 ', amount: '198', category: 'food' }),
      draft({ name: '洗剤', amount: '398', category: '' }),
    ]);

    expect(result).toEqual({
      ok: true,
      items: [
        { name: '牛乳', amount: 198, category: 'food' },
        { name: '洗剤', amount: 398 },
      ],
    });
  });

  it('品名も金額もない行は無視し、内訳が残らなければ items は undefined', () => {
    expect(parseItemDrafts([draft({ name: ' ', amount: '', category: 'food' })])).toEqual({
      ok: true,
      items: undefined,
    });
    expect(parseItemDrafts([])).toEqual({ ok: true, items: undefined });
  });

  it('品名がなくても金額があれば内訳にする（カテゴリーごとの金額だけ残す使い方）', () => {
    expect(parseItemDrafts([draft({ name: '', amount: '1200', category: 'food' })])).toEqual({
      ok: true,
      items: [{ name: '', amount: 1200, category: 'food' }],
    });
  });

  it('金額は全角数字・カンマ・電卓の式（120*3）も受け付ける', () => {
    const result = parseItemDrafts([
      draft({ name: 'a', amount: '１，２００' }),
      draft({ name: 'b', amount: '120*3' }),
      draft({ name: 'c', amount: '0' }),
    ]);

    expect(result).toEqual({
      ok: true,
      items: [
        { name: 'a', amount: 1200 },
        { name: 'b', amount: 360 },
        { name: 'c', amount: 0 },
      ],
    });
  });

  it('品名だけの行は金額0の内訳にする（何を買ったかだけ残す使い方）', () => {
    expect(parseItemDrafts([draft({ name: '牛乳', amount: ' ' })])).toEqual({
      ok: true,
      items: [{ name: '牛乳', amount: 0 }],
    });
  });

  it('数として読めない・負・上限を超える金額の行があればエラーにし、その行を示す', () => {
    const invalid = draft({ name: '卵', amount: 'abc' });
    const negative = draft({ name: '値引き', amount: '-100' });
    const tooLarge = draft({ name: '家', amount: '100000001' });

    const result = parseItemDrafts([invalid, negative, tooLarge, draft({ name: 'ok', amount: '100' })]);

    expect(result).toEqual({
      ok: false,
      error: '内訳の金額を0〜100,000,000の数で入力してください',
      invalidKeys: [invalid.key, negative.key, tooLarge.key],
    });
  });

  it('品名が長すぎる行はエラーにする', () => {
    const long = draft({ name: 'あ'.repeat(101), amount: '100' });

    expect(parseItemDrafts([long])).toEqual({
      ok: false,
      error: '内訳の品名は100文字以内で入力してください',
      invalidKeys: [long.key],
    });
  });

  it('編集前の数量は保つ', () => {
    expect(parseItemDrafts([draft({ name: 'ティッシュ', amount: '300', quantity: 2 })])).toEqual({
      ok: true,
      items: [{ name: 'ティッシュ', amount: 300, quantity: 2 }],
    });
  });

  it('内訳ごとのメモ（任意）を1行にして保存する', () => {
    expect(
      parseItemDrafts([
        draft({ name: 'ケーキ', amount: '1200', memo: ' 誕生日用 ' }),
        draft({ name: '牛乳', amount: '198', memo: '' }),
      ])
    ).toEqual({
      ok: true,
      items: [
        { name: 'ケーキ', amount: 1200, memo: '誕生日用' },
        { name: '牛乳', amount: 198 },
      ],
    });
  });

  it('メモだけの行も無視せず内訳にする（金額0）', () => {
    expect(parseItemDrafts([draft({ memo: 'おまけ付き' })])).toEqual({
      ok: true,
      items: [{ name: '', amount: 0, memo: 'おまけ付き' }],
    });
  });

  it('メモが長すぎる行はエラーにする', () => {
    const long = draft({ name: 'ケーキ', amount: '1200', memo: 'あ'.repeat(201) });

    expect(parseItemDrafts([long])).toEqual({
      ok: false,
      error: '内訳のメモは200文字以内で入力してください',
      invalidKeys: [long.key],
    });
  });
});

describe('draftsFromItems', () => {
  it('保存した内訳を編集用の行にする（行ごとに別の key）', () => {
    const drafts = draftsFromItems([
      { name: '牛乳', amount: 198, category: 'food' },
      { name: 'ティッシュ', amount: 300, quantity: 2 },
      { name: 'ケーキ', amount: 1200, memo: '誕生日用' },
    ]);

    expect(drafts.map(({ key: _key, ...rest }) => rest)).toEqual([
      { name: '牛乳', amount: '198', category: 'food' },
      { name: 'ティッシュ', amount: '300', category: '', quantity: 2 },
      { name: 'ケーキ', amount: '1200', category: '', memo: '誕生日用' },
    ]);
    expect(new Set(drafts.map((d) => d.key)).size).toBe(3);
  });

  it('内訳がなければ行はない', () => {
    expect(draftsFromItems(undefined)).toEqual([]);
    expect(draftsFromItems(null)).toEqual([]);
  });
});

describe('summarizeItemDrafts', () => {
  it('読める行の金額の合計と、支払総額との差を返す', () => {
    const drafts = [draft({ amount: '198' }), draft({ amount: '398' }), draft({ amount: 'x' })];

    expect(summarizeItemDrafts(drafts, 650)).toEqual({ itemsTotal: 596, difference: 54 });
  });

  it('支払総額が未入力なら差は null', () => {
    expect(summarizeItemDrafts([draft({ amount: '100' })], null)).toEqual({ itemsTotal: 100, difference: null });
  });
});

describe('finalizeItemDrafts', () => {
  it('支払総額に足りない分は、品名なし・カテゴリーなし（会計のカテゴリーに計上）の「残り」の1行にする', () => {
    const result = finalizeItemDrafts([draft({ name: 'シャンプー', amount: '480', category: 'daily-goods' })], 3280, {
      spreadDifference: false,
    });

    expect(result).toEqual({
      ok: true,
      items: [
        { name: 'シャンプー', amount: 480, category: 'daily-goods' },
        { name: '', amount: 2800 },
      ],
    });
  });

  it('品名もカテゴリーもない行がすでにあれば、足りない分をその行に足す（編集で支払総額を変えたとき）', () => {
    const result = finalizeItemDrafts(
      [draft({ name: 'シャンプー', amount: '480', category: 'daily-goods' }), draft({ name: '', amount: '2800' })],
      3500,
      { spreadDifference: false }
    );

    expect(result).toEqual({
      ok: true,
      items: [
        { name: 'シャンプー', amount: 480, category: 'daily-goods' },
        { name: '', amount: 3020 },
      ],
    });
  });

  it('保存済みの残りの行（品名なし・会計のカテゴリー）にも足りない分を足す（行を増やさない）', () => {
    const drafts = draftsFromItems([
      { name: 'シャンプー', amount: 480, category: 'daily-goods' },
      { name: '', amount: 2800, category: 'food' },
    ]);

    const result = finalizeItemDrafts(drafts, 3500, { spreadDifference: false, expenseCategory: 'food' });

    expect(result).toEqual({
      ok: true,
      items: [
        { name: 'シャンプー', amount: 480, category: 'daily-goods' },
        { name: '', amount: 3020, category: 'food' },
      ],
    });
  });

  it('品名もカテゴリーもなくてもメモのある行には足さず、残りの行を加える', () => {
    const result = finalizeItemDrafts([draft({ amount: '300', memo: 'お土産' })], 1000, { spreadDifference: false });

    expect(result).toEqual({
      ok: true,
      items: [
        { name: '', amount: 300, memo: 'お土産' },
        { name: '', amount: 700 },
      ],
    });
  });

  it('品名なしでも会計と違うカテゴリーの行（カテゴリーごとの金額）には足さず、残りの行を加える', () => {
    const drafts = [draft({ name: '', amount: '1200', category: 'daily-goods' })];

    const result = finalizeItemDrafts(drafts, 3000, { spreadDifference: false, expenseCategory: 'food' });

    expect(result).toEqual({
      ok: true,
      items: [
        { name: '', amount: 1200, category: 'daily-goods' },
        { name: '', amount: 1800 },
      ],
    });
  });

  it('差額を税・値引きとして配分するなら、内訳はそのまま（カテゴリー別には比率で按分される）', () => {
    const drafts = [draft({ name: '米', amount: '700', category: 'food' }), draft({ name: '紙', amount: '300' })];

    expect(finalizeItemDrafts(drafts, 1100, { spreadDifference: true })).toEqual(parseItemDrafts(drafts));
  });

  it('内訳の合計が支払総額以上（値引き）・支払総額が未入力・内訳がないときは行を足さない', () => {
    const drafts = [draft({ name: '肉', amount: '1000' })];

    expect(finalizeItemDrafts(drafts, 900, { spreadDifference: false })).toEqual(parseItemDrafts(drafts));
    expect(finalizeItemDrafts(drafts, null, { spreadDifference: false })).toEqual(parseItemDrafts(drafts));
    expect(finalizeItemDrafts([], 900, { spreadDifference: false })).toEqual({ ok: true, items: undefined });
  });

  it('品名だけの内訳（金額がすべて0）には残りの行を足さない（会計のカテゴリーに全額が計上される）', () => {
    const drafts = [draft({ name: '牛乳', amount: '' }), draft({ name: '卵', amount: '' })];

    expect(finalizeItemDrafts(drafts, 500, { spreadDifference: false })).toEqual(parseItemDrafts(drafts));
  });

  it('内訳が上限（200行）に達していれば残りの行を足さない（サーバーが受け付けない行数にしない）', () => {
    const drafts = Array.from({ length: 200 }, (_, i) => draft({ name: `品${i}`, amount: '1' }));

    const result = finalizeItemDrafts(drafts, 1000, { spreadDifference: false });

    expect(result.ok && result.items).toHaveLength(200);
  });

  it('入力に誤りがあればエラーのまま返す', () => {
    const bad = draft({ name: '卵', amount: 'abc' });

    expect(finalizeItemDrafts([bad], 500, { spreadDifference: false })).toMatchObject({ ok: false });
  });
});

describe('initialSpreadDifference', () => {
  it('保存済みの内訳の合計が支払総額より少なければ（差を比率で配分している記録）、編集でも比率での配分を既定にする', () => {
    const items = [
      { name: '米', amount: 700, category: 'food' },
      { name: '紙', amount: 300, category: 'daily-goods' },
    ];

    expect(initialSpreadDifference(items, 1100)).toBe(true);
  });

  it('内訳の合計が支払総額と同じ・内訳がない・品名だけの内訳なら比率での配分にしない', () => {
    expect(initialSpreadDifference([{ name: '米', amount: 1100 }], 1100)).toBe(false);
    expect(initialSpreadDifference(undefined, 1100)).toBe(false);
    expect(initialSpreadDifference(null, 1100)).toBe(false);
    expect(initialSpreadDifference([{ name: '米', amount: 0 }], 1100)).toBe(false);
  });
});

describe('updateItemDraft', () => {
  it('品名か金額を書き換えた行は、保存済みの数量を外す（読み取りの誤りを直したときに古い数量が残らないように）', () => {
    const saved = draft({ name: '洗剤', amount: '398', quantity: 2 });

    expect(updateItemDraft(saved, { name: '柔軟剤' }).quantity).toBeUndefined();
    expect(updateItemDraft(saved, { amount: '400' }).quantity).toBeUndefined();
  });

  it('品名や金額を書き換えてもメモは保つ（メモは行の欄で直せる）', () => {
    const saved = draft({ name: 'ケーキ', amount: '1200', memo: '誕生日用' });

    expect(updateItemDraft(saved, { name: 'ショートケーキ' }).memo).toBe('誕生日用');
    expect(parseItemDrafts([updateItemDraft(saved, { memo: undefined })])).toEqual({
      ok: true,
      items: [{ name: 'ケーキ', amount: 1200 }],
    });
  });

  it('カテゴリーだけを変えた行は数量を保つ', () => {
    const saved = draft({ name: '洗剤', amount: '398', quantity: 2 });

    expect(updateItemDraft(saved, { category: 'daily-goods' })).toEqual({ ...saved, category: 'daily-goods' });
  });
});
