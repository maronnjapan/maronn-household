import { useState, useRef, useLayoutEffect } from 'react';
import type { CreateExpenseParams } from '@maronn/domain';
import { evaluateExpression } from '../utils/calculator';
import { Accordion } from './Accordion';
import { EXPENSE_CATEGORIES } from '../constants/categories';

interface ExpenseInputProps {
  onAdd: (params: CreateExpenseParams) => void | Promise<void>;
  initialAmount?: number;
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
 *
 * Progressive Enhancement対応:
 * - pre-hydration-calculator.jsがhydration前に動作
 * - hydration時にdata属性から状態を引き継ぎ
 * - Reactが引き継いだ後はReactのイベントハンドラーで動作
 */
export function ExpenseInput({ onAdd, initialAmount }: ExpenseInputProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const initialState = useRef(getPreHydrationState());

  // initialAmount が指定されていればそれを優先、なければ pre-hydration state を使用
  const initialExpression = initialAmount !== undefined
    ? initialAmount.toString()
    : initialState.current.expression;

  const [expression, setExpression] = useState(initialExpression);
  const [memo, setMemo] = useState(initialState.current.memo);
  const [category, setCategory] = useState(initialState.current.category);

  // 式を評価して金額を取得
  const calculatedAmount = evaluateExpression(expression);

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
    if (!amount || amount <= 0) {
      return;
    }

    // 支出を追加
    await onAdd({
      amount,
      category: category || undefined,
      memo: memo.trim() || undefined,
    });

    // フォームをクリア
    setExpression('');
    setMemo('');
    setCategory('');
  };

  const isValid = calculatedAmount !== null && calculatedAmount > 0;

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
              {EXPENSE_CATEGORIES.map((cat) => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
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
        送信 {isValid && `(¥${calculatedAmount?.toLocaleString()})`}
      </button>
    </div>
  );
}
