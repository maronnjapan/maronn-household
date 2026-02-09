-- カスタムヘッダー・ボディテンプレートをwebhooksテーブルに追加
-- カスタムヘッダーはAES-GCM暗号化して保存（シークレット漏洩防止）
ALTER TABLE `webhooks` ADD COLUMN `custom_headers` text;
ALTER TABLE `webhooks` ADD COLUMN `custom_headers_iv` text;
ALTER TABLE `webhooks` ADD COLUMN `body_template` text;

-- バッチスケジュールテーブルを作成
CREATE TABLE `webhook_batch_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`webhook_id` text NOT NULL,
	`schedule_type` text NOT NULL,
	`minute` integer NOT NULL DEFAULT 0,
	`hour` integer,
	`day_of_week` integer,
	`day_of_month` integer,
	`body_template` text,
	`custom_headers` text,
	`custom_headers_iv` text,
	`is_active` integer NOT NULL DEFAULT 1,
	`last_executed_at` text,
	`next_execution_at` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
