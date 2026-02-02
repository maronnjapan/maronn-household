-- マネタイズ機能用テーブル
-- 定期支出、予算アラート

-- 定期支出（繰り返し支出）テーブル
CREATE TABLE IF NOT EXISTS recurring_expenses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  amount INTEGER NOT NULL,
  category TEXT,
  memo TEXT,
  day_of_month INTEGER NOT NULL CHECK(day_of_month >= 1 AND day_of_month <= 31),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_generated_month TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_user_id ON recurring_expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_recurring_expenses_active ON recurring_expenses(is_active);

-- 予算アラート設定テーブル
CREATE TABLE IF NOT EXISTS budget_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  threshold_percent INTEGER NOT NULL CHECK(threshold_percent > 0 AND threshold_percent <= 100),
  threshold_amount INTEGER,
  is_enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_budget_alerts_user_id ON budget_alerts(user_id);
