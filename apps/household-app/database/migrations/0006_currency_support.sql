-- 定期支出テーブルに通貨関連カラムを追加
-- 外貨建てサブスクリプション（USD, EUR等）の為替換算対応

ALTER TABLE recurring_expenses ADD COLUMN currency TEXT DEFAULT 'JPY';
ALTER TABLE recurring_expenses ADD COLUMN original_amount INTEGER;
ALTER TABLE recurring_expenses ADD COLUMN last_exchange_rate TEXT;
