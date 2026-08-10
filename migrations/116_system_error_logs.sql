-- Migration 116: System Error Logs + Video Processing Enhancements
-- Run with: node run_migrations.js OR psql directly

-- 1. System error logs table for comprehensive error monitoring
CREATE TABLE IF NOT EXISTS system_error_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Auto-generated title: "POST /v1/teacher/videos → 500"
    title TEXT NOT NULL,
    -- Full error message
    message TEXT NOT NULL,
    -- Full stack trace
    stack TEXT,
    -- DB/OS error codes e.g. "23503", "ENOENT"
    error_code TEXT,
    -- Request context
    method TEXT,
    path TEXT,
    query JSONB DEFAULT '{}'::jsonb,
    body_summary JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT,
    user_agent TEXT,
    -- User context (snapshot at time of error)
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    user_role TEXT,
    user_email TEXT,
    -- Severity & source classification
    severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warn', 'error', 'critical')),
    source TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('api', 'worker', 'system')),
    -- Extra structured context (e.g. video_id, task_id for worker errors)
    context JSONB DEFAULT '{}'::jsonb,
    -- Resolution tracking
    resolved BOOLEAN NOT NULL DEFAULT false,
    resolved_at TIMESTAMPTZ,
    resolved_by_admin_id UUID,
    resolution_note TEXT,
    -- Timestamps
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes
CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON system_error_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_severity ON system_error_logs(severity);
CREATE INDEX IF NOT EXISTS idx_error_logs_source ON system_error_logs(source);
CREATE INDEX IF NOT EXISTS idx_error_logs_resolved ON system_error_logs(resolved);
CREATE INDEX IF NOT EXISTS idx_error_logs_user_id ON system_error_logs(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_error_logs_path ON system_error_logs(path) WHERE path IS NOT NULL;

-- 2. Add started_at to video_processing_tasks (tracks when worker actually started the task)
ALTER TABLE video_processing_tasks ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;

-- 3. Ensure processing_stage column exists (may already be added by migration 057)
ALTER TABLE video_processing_tasks ADD COLUMN IF NOT EXISTS processing_stage TEXT;
