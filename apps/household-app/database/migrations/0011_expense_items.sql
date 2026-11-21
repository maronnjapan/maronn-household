-- 支出（1回の会計）の内訳（何を買ったか: 品名・金額・任意の数量とカテゴリー）
-- 支出の amount は支払総額（カード明細などと一致する額）のまま。内訳は JSON 配列で支出の行に持たせ、行と一緒に丸ごと置き換える
-- （同期の単位が支出の行で、内訳の行には ID がないため）。NULL は内訳なし。
-- 壊れた JSON が1行でもあると月の支出の取得がすべて失敗するので、JSON の配列だけを許す。
-- 既存データの移行は不要（列の追加のみ）。

ALTER TABLE `expenses` ADD COLUMN `items` text CHECK (`items` IS NULL OR (json_valid(`items`) AND json_type(`items`) = 'array'));
