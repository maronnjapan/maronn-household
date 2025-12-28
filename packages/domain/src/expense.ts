// 支出エンティティのドメインロジック

export interface Expense {
  id: string;
  amount: number;
  category?: string;
  memo?: string;
  date: string;
  createdAt: string;
  updatedAt: string;
  syncStatus: 'pending' | 'synced' | 'conflict';
  deviceId: string;
}
