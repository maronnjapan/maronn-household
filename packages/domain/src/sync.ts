import { ulid } from 'ulidx';
import type { ExpenseEntity } from './expense';
import { sameExpenseItems } from './expense-items';

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
 * - 同じIDでupdatedAtが同じ → 何もしない（ローカルに内訳の情報がなくサーバーにあれば、内訳だけ補う）
 * - 同じIDでサーバーの方が新しい
 *   - ローカルに未送信の編集がない（pending でない）→ サーバーの版を採用する
 *   - ローカルに未送信の編集があり、同じデバイスの更新 → サーバーの版を採用する
 *   - ローカルに未送信の編集があり、異なるデバイスの更新 → 競合として両方残す（リモートに新IDを振る）
 * - 同じIDでローカルの方が新しい → 何もしない（次のアップロードで送られる）
 * - サーバーにしかないID → 追加
 * - ローカルにしかないID → 何もしない（次のアップロードで送られる）
 *
 * 内訳（items）は undefined なら「内訳を知らないコードが書いた行（不明）」、null なら「内訳なし」。
 * サーバーの版の items が undefined（内訳を知らない古いサーバー）なら、ローカルの内訳を残す
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
    const localUpdated = new Date(local.updatedAt).getTime();
    const remoteUpdated = new Date(remote.updatedAt).getTime();

    if (localUpdated === remoteUpdated) {
      if (needsRemoteItems(local, remote)) {
        result.toUpdate.push({ ...local, items: remote.items, syncStatus: 'synced' });
      }
      continue;
    }

    if (remoteUpdated < localUpdated) {
      // ローカルの方が新しい → 何もしない（次回アップロードで送られる）
      continue;
    }

    // サーバーの方が新しい
    const remoteVersion: ExpenseEntity = {
      ...remote,
      items: remote.items !== undefined ? remote.items : local.items,
      syncStatus: 'synced',
    };

    if (local.syncStatus !== 'pending' || local.deviceId === remote.deviceId) {
      // ローカルに未送信の編集がない、または同じデバイスからの更新 → サーバーの版を採用
      result.toUpdate.push(remoteVersion);
      continue;
    }

    // ローカルの未送信の編集と、異なるデバイスからの更新 → 両方残す
    // ローカルはそのまま、リモートに新しいIDを振る
    result.conflicts.push({
      type: 'keep-both',
      local,
      remote: { ...remoteVersion, id: ulid(Date.now()) },
    });
  }

  return result;
}

/**
 * 同じ版のローカルの行の内訳を、サーバーの内訳にすべきか
 * - 内訳を知らないコードが取り込んだ行（items が undefined）
 * - 同期済みなのに内訳が違う行（内訳の項目を知らない古いコードが、メモなどを落として取り込んだ行）。
 *   同期済みで同じ版ならサーバーと同じはずなので、サーバーの内訳で直す（そのまま編集して送ると、サーバーの項目も消える）
 * サーバーが内訳を返さない（内訳を知らない古いサーバー）ときや、ローカルに未送信の編集があるときは変えない
 */
export function needsRemoteItems(
  local: Pick<ExpenseEntity, 'items' | 'syncStatus'>,
  remote: Pick<ExpenseEntity, 'items'>
): boolean {
  if (remote.items === undefined) return false;
  if (local.items === undefined) return true;
  return local.syncStatus === 'synced' && !sameExpenseItems(local.items, remote.items);
}
