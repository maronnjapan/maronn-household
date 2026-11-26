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
 * - 同じIDでupdatedAtが同じ → 何もしない（内訳・店名だけはサーバーのものにすることがある。sameVersionRepair）
 * - 同じIDでサーバーの方が新しい
 *   - ローカルに未送信の編集がない（pending でない）→ サーバーの版を採用する
 *   - ローカルに未送信の編集があり、同じデバイスの更新 → サーバーの版を採用する
 *   - ローカルに未送信の編集があり、異なるデバイスの更新 → 競合として両方残す（リモートに新IDを振る）
 * - 同じIDでローカルの方が新しい → 何もしない（次のアップロードで送られる）
 * - サーバーにしかないID → 追加
 * - ローカルにしかないID → 何もしない（次のアップロードで送られる）
 *
 * 内訳（items）・店名（storeName）は undefined なら「その項目を知らないコードが書いた行（不明）」、null なら「なし」。
 * サーバーの版の値が undefined（その項目を知らない古いサーバー）なら、ローカルの値を残す
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
      const repair = sameVersionRepair(local, remote);
      if (repair) {
        result.toUpdate.push({ ...local, ...repair, syncStatus: 'synced' });
      }
      continue;
    }

    if (remoteUpdated < localUpdated) {
      // ローカルの方が新しい → 何もしない（次回アップロードで送られる）
      continue;
    }

    // サーバーの方が新しい
    const remoteVersion: ExpenseEntity = {
      ...withLocalFieldsUnknownToServer(remote, local),
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

/** 内訳・店名のように、知らないコードが書いた行では undefined（不明）になる項目 */
type ExtendedFields = Pick<ExpenseEntity, 'items' | 'storeName'>;

/**
 * サーバーの新しい版に、サーバーが返さなかった項目（その項目を知らない古いサーバー）だけローカルの値を残す
 */
export function withLocalFieldsUnknownToServer<T extends ExtendedFields>(remote: T, local: ExtendedFields): T {
  return {
    ...remote,
    items: remote.items !== undefined ? remote.items : local.items,
    storeName: remote.storeName !== undefined ? remote.storeName : local.storeName,
  };
}

/**
 * 同じ版のローカルの行で、サーバーの値にすべき項目（内訳・店名）。直すものがなければ undefined
 * - その項目を知らないコードが取り込んだ行（undefined）。同期の状態によらず補う
 * - 同期済みなのに値が違う行（内訳のメモなど、項目を知らない古いコードが落として取り込んだ行）。
 *   同期済みで同じ版ならサーバーと同じはずなので、サーバーの値で直す（そのまま編集して送ると、サーバーの値も消える）。
 *   内訳は両方を保存する形にそろえて比べる（キーの順序の違いなどで書き込みを繰り返さないように）
 * サーバーが返さない項目（その項目を知らない古いサーバー）と、同期済みでない行（未送信の編集など）の分かっている値は変えない
 */
export function sameVersionRepair(
  local: ExtendedFields & Pick<ExpenseEntity, 'syncStatus'>,
  remote: ExtendedFields
): Partial<ExtendedFields> | undefined {
  const synced = local.syncStatus === 'synced';
  const repair: Partial<ExtendedFields> = {};
  if (
    remote.items !== undefined &&
    (local.items === undefined || (synced && !sameExpenseItems(local.items, remote.items)))
  ) {
    repair.items = remote.items;
  }
  if (
    remote.storeName !== undefined &&
    (local.storeName === undefined || (synced && local.storeName !== remote.storeName))
  ) {
    repair.storeName = remote.storeName;
  }
  return Object.keys(repair).length > 0 ? repair : undefined;
}
