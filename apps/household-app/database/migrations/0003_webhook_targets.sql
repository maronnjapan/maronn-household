CREATE TABLE `webhooks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`url` text NOT NULL,
	`secret_encrypted` text,
	`secret_iv` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
