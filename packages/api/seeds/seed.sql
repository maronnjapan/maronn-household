INSERT INTO users (id, created_at)
VALUES ('default-user', datetime('now'))
ON CONFLICT (id) DO NOTHING;