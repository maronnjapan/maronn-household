import { ulid } from 'ulidx';

/**
 * テスト用の支出データを生成
 */
export function createExpenseFixture(overrides?: Partial<ExpenseInput>) {
  const now = new Date().toISOString();

  return {
    id: ulid(),
    amount: 1000,
    category: 'food',
    memo: 'test expense',
    date: new Date().toISOString().split('T')[0],
    createdAt: now,
    updatedAt: now,
    deviceId: 'test-device',
    ...overrides,
  };
}

/**
 * テスト用の予算データを生成
 */
export function createBudgetFixture(overrides?: Partial<BudgetInput>) {
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  return {
    id: ulid(),
    month,
    amount: 100000,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

type ExpenseInput = {
  id: string;
  amount: number;
  category?: string;
  memo?: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  deviceId: string;
};

type BudgetInput = {
  id: string;
  month: string;
  amount: number;
  updatedAt: string;
};
