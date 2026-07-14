-- 1. Custom percentages for individual marketers or teachers
CREATE TABLE IF NOT EXISTS custom_user_percentages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_type TEXT NOT NULL CHECK (user_type IN ('teacher', 'marketer')),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    custom_percent NUMERIC(5,2) NOT NULL CHECK (custom_percent >= 0 AND custom_percent <= 100),
    set_by_admin_id UUID REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_type, user_id)
);

CREATE INDEX IF NOT EXISTS idx_custom_user_percentages_user_id ON custom_user_percentages(user_id);

-- Trigger for custom_user_percentages updated_at
CREATE OR REPLACE FUNCTION update_custom_user_percentages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_custom_user_percentages_updated_at ON custom_user_percentages;
CREATE TRIGGER trigger_custom_user_percentages_updated_at
    BEFORE UPDATE ON custom_user_percentages
    FOR EACH ROW EXECUTE FUNCTION update_custom_user_percentages_updated_at();


-- 2. Teacher to Reference User connections (allowing teachers to share their percentage)
CREATE TABLE IF NOT EXISTS teacher_reference_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    marketer_id UUID NOT NULL REFERENCES marketers(id) ON DELETE CASCADE,
    shared_percent NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (shared_percent >= 0 AND shared_percent <= 100),
    connected_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(teacher_id, marketer_id)
);

CREATE INDEX IF NOT EXISTS idx_teacher_reference_connections_teacher_id ON teacher_reference_connections(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_reference_connections_marketer_id ON teacher_reference_connections(marketer_id);

-- Trigger for teacher_reference_connections updated_at
CREATE OR REPLACE FUNCTION update_teacher_reference_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_teacher_reference_connections_updated_at ON teacher_reference_connections;
CREATE TRIGGER trigger_teacher_reference_connections_updated_at
    BEFORE UPDATE ON teacher_reference_connections
    FOR EACH ROW EXECUTE FUNCTION update_teacher_reference_connections_updated_at();
