-- レシート記録（生成AIがレシート写真を読み取り、MCPサーバー経由で登録する）
-- レシートを購入記録の正とし、予算計算に使う支出（expenses）はカテゴリ別に按分して紐づける。
-- 既存データの移行は不要（テーブル・カラム・インデックスの追加のみ）。

CREATE TABLE `receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`store_name` text NOT NULL,
	-- 購入日時（ISO 8601）
	`purchased_at` text NOT NULL,
	-- 支払総額（税込・値引き後）
	`total_amount` integer NOT NULL,
	`tax_amount` integer,
	`payment_method` text,
	-- 登録元のクライアント（MCPクライアントのclient_idなど）
	`source` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `receipts_user_purchased_at_idx` ON `receipts` (`user_id`, `purchased_at`);
--> statement-breakpoint
CREATE TABLE `receipt_items` (
	`id` text PRIMARY KEY NOT NULL,
	`receipt_id` text NOT NULL,
	-- レシート上の並び順（0始まり）
	`position` integer NOT NULL,
	`name` text NOT NULL,
	-- 行の金額（数量×単価）
	`amount` integer NOT NULL,
	`quantity` real,
	`category` text,
	FOREIGN KEY (`receipt_id`) REFERENCES `receipts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `receipt_items_receipt_id_idx` ON `receipt_items` (`receipt_id`);
--> statement-breakpoint
-- レシートから按分された支出にレシートIDを持たせる（手入力の支出はNULL）
ALTER TABLE `expenses` ADD COLUMN `receipt_id` text;
--> statement-breakpoint
CREATE INDEX `expenses_receipt_id_idx` ON `expenses` (`receipt_id`);
--> statement-breakpoint
-- 月別取得（user_id + date の範囲検索）の高速化
CREATE INDEX `expenses_user_date_idx` ON `expenses` (`user_id`, `date`);
--> statement-breakpoint
CREATE INDEX `budgets_user_month_idx` ON `budgets` (`user_id`, `month`);
