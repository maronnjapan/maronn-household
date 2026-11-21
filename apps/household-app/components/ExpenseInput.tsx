import { useState, useRef, useLayoutEffect } from 'react';
import type { CreateExpenseParams } from '@maronn/domain';
import { evaluateExpression } from '../utils/calculator';
import { finalizeItemDrafts, parseItemDrafts, summarizeItemDrafts, type ItemDraft } from '../lib/expense-items';
import { Accordion } from './Accordion';
import { CategoryOptions } from './CategoryOptions';
import { ExpenseItemsEditor } from './ExpenseItemsEditor';
import { SubBudgetSelector } from './SubBudgetSelector';

interface ExpenseInputProps {
  onAdd: (params: CreateExpenseParams) => void | Promise<void>;
}

/**
 * Pre-hydration状態を読み取る（初回のみ）
 * pre-hydration-calculator.jsが設定したdata属性から状態を復元
 */
function getPreHydrationState(): { expression: string; memo: string; category: string } {
  if (typeof document === 'undefined') {
    return { expression: '', memo: '', category: '' };
  }

  const el = document.querySelector('.expense-input.calculator');
  if (!el || !el.hasAttribute('data-pre-hydration')) {
    return { expression: '', memo: '', category: '' };
  }

  return {
    expression: el.getAttribute('data-expression') || '',
    memo: el.getAttribute('data-memo') || '',
    category: el.getAttribute('data-category') || '',
  };
}

/**
 * 支出入力コンポーネント（電卓UI）
 * 金額を電卓で計算し、即座に追加（< 50ms）
 * 電卓の金額は1回の会計の支払総額。何を買ったかは「内訳（任意）」に品名・金額・カテゴリーで残せる
 *
 * Progressive Enhancement対応:
 * - pre-hydration-calculator.jsがhydration前に動作
 * - hydration時にdata属性から状態を引き継ぎ
 * - Reactが引き継いだ後はReactのイベントハンドラーで動作
 */
export function ExpenseInput({ onAdd }: ExpenseInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialState = useRef(getPreHydrationState());

  const [expression, setExpression] = useState(initialState.current.expression);
  const [memo, setMemo] = useState(initialState.current.memo);
  const [category, setCategory] = useState(initialState.current.category);
  const [subBudgetId, setSubBudgetId] = useState('');
  const [itemDrafts, setItemDrafts] = useState<ItemDraft[]>([]);
  const [spreadDifference, setSpreadDifference] = useState(false);

  // 式を評価して金額を取得
  const calculatedAmount = evaluateExpression(expression);
  const parsedItems = parseItemDrafts(itemDrafts);
  const itemCount = parsedItems.ok ? (parsedItems.items?.length ?? 0) : 0;

  const handleButtonClick = (value: string) => {
    if (value === 'C') {
      // クリア
      setExpression('');
    } else if (value === '=') {
      // 計算実行（表示のみ、送信は別ボタン）
      const result = evaluateExpression(expression);
      if (result !== null) {
        setExpression(result.toString());
      }
    } else if (value === '←') {
      // 1文字削除
      setExpression((prev) => prev.slice(0, -1));
    } else {
      // 数字または演算子を追加
      setExpression((prev) => prev + value);
    }
  };

  const handleSubmit = async () => {
    const amount = evaluateExpression(expression);
    // 内訳の合計が支払総額より少なければ、足りない分を「残り」の1行にする（差を税・値引きとして配分するなら作らない）
    const items = finalizeItemDrafts(itemDrafts, amount, { spreadDifference, expenseCategory: category });
    if (!amount || amount <= 0 || !items.ok) {
      return;
    }

    // 支出を追加（金額は支払総額、内訳は何を買ったか）
    await onAdd({
      amount,
      category: category || undefined,
      memo: memo.trim() || undefined,
      subBudgetId: subBudgetId || undefined,
      items: items.items,
    });

    // フォームをクリア
    setExpression('');
    setMemo('');
    setCategory('');
    setSubBudgetId('');
    setItemDrafts([]);
    setSpreadDifference(false);
  };

  const isValid = calculatedAmount !== null && calculatedAmount > 0 && parsedItems.ok;

  // hydration完了後にマーク（pre-hydrationスクリプトのイベントを無効化）
  // useLayoutEffectは例外的に使用（hydration時の一度限りのDOM操作のため）
  useLayoutEffect(() => {
    if (containerRef.current) {
      containerRef.current.setAttribute('data-hydrated', 'true');
      containerRef.current.removeAttribute('data-pre-hydration');
    }
  }, []);

  return (
    <div ref={containerRef} className="expense-input calculator">
      {/* 表示領域 */}
      <div className="calculator-display">
        <div className="expression">{expression || '0'}</div>
        <div className="result">
          {calculatedAmount !== null && expression !== calculatedAmount.toString() ? `= ${calculatedAmount}` : ''}
        </div>
      </div>

      {/* 電卓ボタン */}
      <div className="calculator-buttons">
        <button type="button" onClick={() => handleButtonClick('7')} className="calc-btn">
          7
        </button>
        <button type="button" onClick={() => handleButtonClick('8')} className="calc-btn">
          8
        </button>
        <button type="button" onClick={() => handleButtonClick('9')} className="calc-btn">
          9
        </button>
        <button type="button" onClick={() => handleButtonClick('÷')} className="calc-btn operator">
          ÷
        </button>

        <button type="button" onClick={() => handleButtonClick('4')} className="calc-btn">
          4
        </button>
        <button type="button" onClick={() => handleButtonClick('5')} className="calc-btn">
          5
        </button>
        <button type="button" onClick={() => handleButtonClick('6')} className="calc-btn">
          6
        </button>
        <button type="button" onClick={() => handleButtonClick('×')} className="calc-btn operator">
          ×
        </button>

        <button type="button" onClick={() => handleButtonClick('1')} className="calc-btn">
          1
        </button>
        <button type="button" onClick={() => handleButtonClick('2')} className="calc-btn">
          2
        </button>
        <button type="button" onClick={() => handleButtonClick('3')} className="calc-btn">
          3
        </button>
        <button type="button" onClick={() => handleButtonClick('-')} className="calc-btn operator">
          -
        </button>

        <button type="button" onClick={() => handleButtonClick('C')} className="calc-btn clear">
          C
        </button>
        <button type="button" onClick={() => handleButtonClick('0')} className="calc-btn">
          0
        </button>
        <button type="button" onClick={() => handleButtonClick('=')} className="calc-btn equals">
          =
        </button>
        <button type="button" onClick={() => handleButtonClick('+')} className="calc-btn operator">
          +
        </button>

        <button type="button" onClick={() => handleButtonClick('←')} className="calc-btn backspace">
          ←
        </button>
        <button type="button" onClick={() => handleButtonClick('(')} className="calc-btn">
          (
        </button>
        <button type="button" onClick={() => handleButtonClick(')')} className="calc-btn">
          )
        </button>
        <button type="button" onClick={() => handleButtonClick('.')} className="calc-btn">
          .
        </button>
      </div>

      {/* サブ予算選択（サブ予算が存在する場合のみ表示） */}
      <SubBudgetSelector value={subBudgetId} onChange={setSubBudgetId} />

      {/* 内訳（アコーディオン。開くまで描画しないので、hydration 前の電卓には影響しない） */}
      {/* 閉じると中身は描画しないので、見出しに入力済みの内訳を出す（隠れた内訳に気づかず送信しないように） */}
      <Accordion
        title={
          !parsedItems.ok
            ? '内訳（入力を確認してください）'
            : itemCount > 0
              ? `内訳（${itemCount}件・¥${summarizeItemDrafts(itemDrafts, null).itemsTotal.toLocaleString()}）`
              : '内訳（任意）'
        }
        defaultOpen={false}
      >
        <ExpenseItemsEditor
          drafts={itemDrafts}
          onChange={setItemDrafts}
          total={calculatedAmount !== null && calculatedAmount > 0 ? calculatedAmount : null}
          expenseCategory={category}
          spreadDifference={spreadDifference}
          onSpreadDifferenceChange={setSpreadDifference}
          onUseItemsTotal={(itemsTotal) => setExpression(String(itemsTotal))}
        />
      </Accordion>

      {/* メモ・カテゴリー入力（アコーディオン） */}
      <Accordion title="詳細設定（任意）" defaultOpen={false}>
        <div className="detail-inputs">
          {/* カテゴリー選択 */}
          <div className="category-section">
            <label htmlFor="category-select" className="input-label">
              カテゴリー
            </label>
            <select
              id="category-select"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="category-select"
            >
              <option value="">未選択</option>
              <CategoryOptions selected={category} />
            </select>
          </div>

          {/* メモ入力 */}
          <div className="memo-section">
            <label htmlFor="memo-input" className="input-label">
              メモ
            </label>
            <input
              id="memo-input"
              type="text"
              placeholder="メモを入力"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="memo-input"
            />
          </div>
        </div>
      </Accordion>

      {/* 送信ボタン */}
      <button type="button" onClick={handleSubmit} disabled={!isValid} className="submit-button">
        {/* pre-hydration-calculator.js が書く文言（「送信」「送信 (¥N)」）と1つの文字列で一致させる（hydration の不一致を避ける） */}
        {isValid
          ? `送信 (¥${calculatedAmount?.toLocaleString()}${itemCount > 0 ? `・内訳${itemCount}件` : ''})`
          : '送信'}
      </button>
    </div>
  );
}
