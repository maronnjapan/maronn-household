import { useState } from 'react';
import { FloatingExpenseButton } from './FloatingExpenseButton';
import { FloatingExpenseModal } from './FloatingExpenseModal';

/**
 * フローティング支出入力コンテナ
 * ボタンとモーダルの状態管理を行う
 * 全ページで表示されるように +Layout.tsx で使用
 */
export function FloatingExpenseContainer() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <>
      <FloatingExpenseButton onClick={() => setIsModalOpen(true)} />
      <FloatingExpenseModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </>
  );
}
