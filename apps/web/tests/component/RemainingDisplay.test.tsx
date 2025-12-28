import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RemainingDisplay } from '#components/RemainingDisplay';

describe('RemainingDisplay', () => {
  it('残額を表示する', () => {
    render(
      <RemainingDisplay budget={100000} spent={25000} remaining={75000} />
    );

    expect(screen.getByText(/¥75,000/)).toBeInTheDocument();
  });

  it('予算と支出も表示する', () => {
    render(
      <RemainingDisplay budget={100000} spent={25000} remaining={75000} />
    );

    expect(screen.getByText('予算:')).toBeInTheDocument();
    expect(screen.getByText('¥100,000')).toBeInTheDocument();
    expect(screen.getByText('支出:')).toBeInTheDocument();
    expect(screen.getByText('¥25,000')).toBeInTheDocument();
  });

  it('残額がマイナスの場合は赤字で表示', () => {
    render(
      <RemainingDisplay budget={10000} spent={15000} remaining={-5000} />
    );

    const remainingElement = screen.getByText(/¥-5,000/);
    expect(remainingElement).toBeInTheDocument();
    expect(remainingElement.className).toContain('negative');
  });

  it('残額がプラスの場合は通常表示', () => {
    render(
      <RemainingDisplay budget={100000} spent={50000} remaining={50000} />
    );

    // 残額の値を持つ要素を取得（.remaining-value クラスを持つもの）
    const remainingElements = screen.getAllByText('¥50,000');
    const remainingElement = remainingElements.find((el) =>
      el.className.includes('remaining-value')
    );

    expect(remainingElement).toBeDefined();
    expect(remainingElement?.className).not.toContain('negative');
  });

  it('ローディング中は「読み込み中...」と表示', () => {
    render(<RemainingDisplay budget={0} spent={0} remaining={0} isLoading />);

    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
  });
});
