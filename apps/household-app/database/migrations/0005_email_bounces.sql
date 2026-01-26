-- バウンス・コンプレイントメールアドレス記録テーブル
-- SESからのバウンス・コンプレイント通知を受信した際に記録
-- メール送信前にこのテーブルをチェックして送信を抑制する

CREATE TABLE IF NOT EXISTS email_bounces (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    bounce_type TEXT NOT NULL,  -- 'bounce' or 'complaint'
    bounce_sub_type TEXT,       -- 'Permanent', 'Transient', 'Undetermined' for bounce
    source_email TEXT,          -- 送信元メールアドレス
    feedback_id TEXT,           -- AWS SESのFeedback ID
    raw_message TEXT,           -- 元のSNSメッセージ（JSON）
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

-- メールアドレスによる高速検索用インデックス
CREATE INDEX IF NOT EXISTS idx_email_bounces_email ON email_bounces(email);

-- バウンスタイプによる検索用インデックス
CREATE INDEX IF NOT EXISTS idx_email_bounces_type ON email_bounces(bounce_type);

-- 作成日時による検索用インデックス（古いレコードのクリーンアップ用）
CREATE INDEX IF NOT EXISTS idx_email_bounces_created_at ON email_bounces(created_at);
