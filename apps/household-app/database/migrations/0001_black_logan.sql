DROP TABLE `users`;--> statement-breakpoint
DROP TABLE `todos`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`month` text NOT NULL,
	`amount` integer NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_budgets`("id", "user_id", "month", "amount", "updated_at") SELECT "id", "user_id", "month", "amount", "updated_at" FROM `budgets`;--> statement-breakpoint
DROP TABLE `budgets`;--> statement-breakpoint
ALTER TABLE `__new_budgets` RENAME TO `budgets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_expenses` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`amount` integer NOT NULL,
	`category` text,
	`memo` text,
	`date` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`device_id` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_expenses`("id", "user_id", "amount", "category", "memo", "date", "created_at", "updated_at", "device_id") SELECT "id", "user_id", "amount", "category", "memo", "date", "created_at", "updated_at", "device_id" FROM `expenses`;--> statement-breakpoint
DROP TABLE `expenses`;--> statement-breakpoint
ALTER TABLE `__new_expenses` RENAME TO `expenses`;