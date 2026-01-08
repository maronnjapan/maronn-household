import { useState, useCallback } from "react";
import { useDeleteAccount } from "../hooks/use-delete-account";
import styles from "./DeleteAccountSection.module.css";

/**
 * 退会セクションコンポーネント
 * 確認ダイアログを表示し、ユーザーの意思を確認してから退会処理を実行
 */
export function DeleteAccountSection() {
  const [showConfirm, setShowConfirm] = useState(false);
  const { deleteAccount, isDeleting, error } = useDeleteAccount();

  const handleOpenConfirm = useCallback(() => {
    setShowConfirm(true);
  }, []);

  const handleCloseConfirm = useCallback(() => {
    setShowConfirm(false);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    await deleteAccount();
  }, [deleteAccount]);

  return (
    <section className={styles.section}>
      <h2 className={styles.title}>アカウント削除</h2>
      <p className={styles.description}>
        アカウントを削除すると、すべてのデータが完全に削除され、復元できません。
      </p>

      {error && <p className={styles.error}>{error}</p>}

      {!showConfirm ? (
        <button
          onClick={handleOpenConfirm}
          className={styles.deleteButton}
          disabled={isDeleting}
        >
          退会する
        </button>
      ) : (
        <div className={styles.confirmBox}>
          <p className={styles.confirmText}>
            本当に退会しますか？この操作は取り消せません。
          </p>
          <div className={styles.confirmButtons}>
            <button
              onClick={handleCloseConfirm}
              className={styles.cancelButton}
              disabled={isDeleting}
            >
              キャンセル
            </button>
            <button
              onClick={handleConfirmDelete}
              className={styles.confirmDeleteButton}
              disabled={isDeleting}
            >
              {isDeleting ? "削除中..." : "退会を確定"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
