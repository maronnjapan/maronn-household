-- 認証基盤（household-auth）への移行に伴う追加。既存データの移行は不要（列・テーブルの追加のみ）。

-- household-app のセッションに ID トークンを持たせる（ログアウト時に認証基盤の end_session へ id_token_hint として渡す）
-- 新しいセッションの token 列にはトークンの SHA-256 を保存する（Better Auth 時代の行は平文のまま、期限切れで消える）
ALTER TABLE `session` ADD COLUMN `id_token` text;
--> statement-breakpoint
-- 動的クライアント登録（RFC 7591）の登録日時。登録数の上限を「直近24時間」で数え、未使用のクライアントを掃除するために使う
CREATE TABLE `dcr_client_registrations` (
	`client_id` text PRIMARY KEY NOT NULL,
	-- 登録日時（Unix epoch 秒）
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `dcr_client_registrations_created_at_idx` ON `dcr_client_registrations` (`created_at`);
