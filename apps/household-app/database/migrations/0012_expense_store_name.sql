-- 支出（1回の会計）の店名。メモとは別の任意の項目（NULL は店名なし）
-- 以前に MCP で記録したレシートの支出は、メモに店名が入ったまま（店名は receipts.store_name にもある）。
-- 既存データの移行は不要（列の追加のみ）。
ALTER TABLE `expenses` ADD COLUMN `store_name` text;
