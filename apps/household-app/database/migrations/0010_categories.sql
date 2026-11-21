-- 支出カテゴリーの追加・名前変更・削除（MCP サーバーから操作する）
-- 行を持つのは、ユーザーが追加したカテゴリーと、既定のカテゴリー（'food' など）の名前変更・削除だけ。
-- 行がないユーザーは既定のカテゴリーのまま使えるので、既存データの移行は不要（テーブルの追加のみ）。
-- 名前変更や削除で expenses / receipt_items の category は書き換えない（value は変えず、削除しても行を残して表示名に使う）。

CREATE TABLE `categories` (
	`user_id` text NOT NULL,
	-- 支出・レシート明細の category に保存する値（既定のカテゴリーは 'food' など、追加したカテゴリーは ULID）
	`value` text NOT NULL,
	`label` text NOT NULL,
	-- 削除日時（ISO 8601）。削除していなければ NULL
	`deleted_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY (`user_id`, `value`)
);
