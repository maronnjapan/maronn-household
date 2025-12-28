// 同期・競合解決ロジック

import type { Expense } from './expense';

export interface SyncResult {
  toUpload: Expense[];
  toDownload: Expense[];
  conflicts: ConflictPair[];
}

export interface ConflictPair {
  local: Expense;
  remote: Expense;
  resolution: 'keep-both' | 'keep-local' | 'keep-remote';
}
