import { ulid } from 'ulid';
import type { ExpenseEntity } from './expense';

/**
 * 競合解決の結果
 */
export interface ConflictResolution {
  /**
   * 両方の支出を保持（IDを振り直して2件にする）
   */
  type: 'keep-both';
  /**
   * ローカルの支出（元のIDを保持）
   */
  local: ExpenseEntity;
  /**
   * リモートの支出（新しいIDを振る）
   */
  remote: ExpenseEntity;
}

/**
 * マージ結果
 */
export interface MergeResult {
  /**
   * 追加すべき新しい支出
   */
  toAdd: ExpenseEntity[];
  /**
   * 更新すべき支出（リモートの方が新しい）
   */
  toUpdate: ExpenseEntity[];
  /**
   * 競合した支出（両方残す）
   */
  conflicts: ConflictResolution[];
}

/**
 * ローカルの支出とサーバーの支出をマージする
 *
 * 戦略：
 * - 同じIDでupdatedAtが同じ → 何もしない
 * - 同じIDでupdatedAtが異なる → 競合として両方残す（リモートに新IDを振る）
 * - サーバーにしかないID → 追加
 * - ローカルにしかないID → 何もしない（次のアップロードで送られる）
 *
 * @param localExpenses ローカルの支出リスト
 * @param remoteExpenses サーバーから取得した支出リスト
 * @returns マージ結果
 */
export function mergeExpenses(
  localExpenses: ExpenseEntity[],
  remoteExpenses: ExpenseEntity[]
): MergeResult {
  const result: MergeResult = {
    toAdd: [],
    toUpdate: [],
    conflicts: [],
  };

  // ローカルのIDをマップに変換（高速検索用）
  const localMap = new Map<string, ExpenseEntity>();
  for (const expense of localExpenses) {
    localMap.set(expense.id, expense);
  }

  for (const remote of remoteExpenses) {
    const local = localMap.get(remote.id);

    if (!local) {
      // サーバーにしかない → 追加（syncedとしてマーク）
      result.toAdd.push({
        ...remote,
        syncStatus: 'synced',
      });
      continue;
    }

    // 同じIDが存在する
    const localUpdated = new Date(local.updatedAt);
    const remoteUpdated = new Date(remote.updatedAt);

    if (localUpdated.getTime() === remoteUpdated.getTime()) {
      // 同じ更新日時 → 何もしない
      continue;
    }

    // 更新日時が異なる → 競合
    if (local.deviceId === remote.deviceId) {
      // 同じデバイスからの更新 → より新しい方を採用
      if (remoteUpdated > localUpdated) {
        result.toUpdate.push({
          ...remote,
          syncStatus: 'synced',
        });
      }
      // ローカルの方が新しい場合は何もしない（次回アップロードで送られる）
    } else {
      // 異なるデバイスからの更新 → 両方残す
      // ローカルはそのまま、リモートに新しいIDを振る
      const remoteWithNewId: ExpenseEntity = {
        ...remote,
        id: ulid(),
        syncStatus: 'synced',
      };

      result.conflicts.push({
        type: 'keep-both',
        local,
        remote: remoteWithNewId,
      });
    }
  }

  return result;
}
