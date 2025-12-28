import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpenseInput } from '#components/ExpenseInput';

describe('ExpenseInput', () => {
  it('金額入力フィールドが表示される', () => {
    render(<ExpenseInput onAdd={vi.fn()} />);

    expect(screen.getByPlaceholderText('金額')).toBeInTheDocument();
  });

  it('追加ボタンが表示される', () => {
    render(<ExpenseInput onAdd={vi.fn()} />);

    expect(
      screen.getByRole('button', { name: /追加|Add/i })
    ).toBeInTheDocument();
  });

  it('金額を入力して追加ボタンを押すとonAddが呼ばれる', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<ExpenseInput onAdd={onAdd} />);

    const input = screen.getByPlaceholderText('金額');
    const button = screen.getByRole('button', { name: /追加|Add/i });

    await user.type(input, '3000');
    await user.click(button);

    expect(onAdd).toHaveBeenCalledWith({ amount: 3000 });
  });

  it('追加後は入力フィールドがクリアされる', async () => {
    const user = userEvent.setup();
    render(<ExpenseInput onAdd={vi.fn()} />);

    const input = screen.getByPlaceholderText('金額') as HTMLInputElement;
    const button = screen.getByRole('button', { name: /追加|Add/i });

    await user.type(input, '5000');
    await user.click(button);

    expect(input.value).toBe('');
  });

  it('メモを入力できる', async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    render(<ExpenseInput onAdd={onAdd} />);

    const amountInput = screen.getByPlaceholderText('金額');
    const memoInput = screen.getByPlaceholderText('メモ');
    const button = screen.getByRole('button', { name: /追加|Add/i });

    await user.type(amountInput, '2000');
    await user.type(memoInput, 'スーパーで買い物');
    await user.click(button);

    expect(onAdd).toHaveBeenCalledWith({
      amount: 2000,
      memo: 'スーパーで買い物',
    });
  });

  it('金額が空の場合は追加ボタンが無効', () => {
    render(<ExpenseInput onAdd={vi.fn()} />);

    const button = screen.getByRole('button', { name: /追加|Add/i });

    expect(button).toBeDisabled();
  });

  it('金額が0以下の場合は追加ボタンが無効', async () => {
    const user = userEvent.setup();
    render(<ExpenseInput onAdd={vi.fn()} />);

    const input = screen.getByPlaceholderText('金額');
    const button = screen.getByRole('button', { name: /追加|Add/i });

    await user.type(input, '0');

    expect(button).toBeDisabled();
  });
});
