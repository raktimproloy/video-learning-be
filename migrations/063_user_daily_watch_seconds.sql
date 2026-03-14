-- Store per-day watch time per user for dashboard activity chart (line chart: watch time by day).
-- Updated on each progress upsert by adding watchDeltaSeconds to today's row.

CREATE TABLE IF NOT EXISTS user_daily_watch_seconds (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_seconds DECIMAL(12, 2) NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_user_daily_watch_seconds_user_date ON user_daily_watch_seconds(user_id, date);

COMMENT ON TABLE user_daily_watch_seconds IS 'Daily watch time per user for dashboard activity chart; incremented on each video progress save.';
