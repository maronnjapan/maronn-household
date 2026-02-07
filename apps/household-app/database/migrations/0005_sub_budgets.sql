-- サブ予算テーブル
CREATE TABLE `sub_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`amount` integer NOT NULL,
	`start_month` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);

-- サブ予算月別金額テーブル（繰り越し計算用）
CREATE TABLE `sub_budget_monthly_amounts` (
	`id` text PRIMARY KEY NOT NULL,
	`sub_budget_id` text NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`updated_at` text NOT NULL
);

-- 支出テーブルにサブ予算IDカラムを追加
ALTER TABLE `expenses` ADD COLUMN `sub_budget_id` text;
