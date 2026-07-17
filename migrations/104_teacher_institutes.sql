-- Teacher institute storefronts (one per teacher, unique public subdomain slug)

CREATE TABLE IF NOT EXISTS teacher_institutes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    slug TEXT NOT NULL,
    name TEXT NOT NULL,
    tagline TEXT,
    logo_path TEXT,
    cover_path TEXT,
    address TEXT,
    city TEXT,
    email TEXT,
    phone TEXT,
    phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    phone_otp TEXT,
    phone_otp_expires_at TIMESTAMPTZ,
    helpline TEXT,
    whatsapp TEXT,
    social_links JSONB NOT NULL DEFAULT '[]'::jsonb,
    fiscal_year TEXT,
    operating_hours JSONB NOT NULL DEFAULT '[]'::jsonb,
    offered_subjects JSONB NOT NULL DEFAULT '[]'::jsonb,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'draft')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT teacher_institutes_teacher_id_unique UNIQUE (teacher_id),
    CONSTRAINT teacher_institutes_slug_unique UNIQUE (slug),
    CONSTRAINT teacher_institutes_slug_format CHECK (
        slug ~ '^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$'
        AND length(slug) >= 3
        AND length(slug) <= 63
    )
);

CREATE INDEX IF NOT EXISTS idx_teacher_institutes_teacher_id ON teacher_institutes(teacher_id);
CREATE INDEX IF NOT EXISTS idx_teacher_institutes_slug ON teacher_institutes(slug);
CREATE INDEX IF NOT EXISTS idx_teacher_institutes_status ON teacher_institutes(status);

COMMENT ON TABLE teacher_institutes IS 'Public teacher institute storefront config and subdomain slug';
COMMENT ON COLUMN teacher_institutes.slug IS 'Normalized subdomain label, e.g. avilash-teach for avilash-teach.shikkhabhumi.com';
COMMENT ON COLUMN teacher_institutes.offered_subjects IS 'Free-text subject/course tags offered by the institute';
COMMENT ON COLUMN teacher_institutes.operating_hours IS 'Array of {day,isOpen,openTime,closeTime}';
COMMENT ON COLUMN teacher_institutes.social_links IS 'Array of {type,url} for facebook|instagram|website';

CREATE OR REPLACE FUNCTION update_teacher_institutes_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_teacher_institutes_updated_at ON teacher_institutes;
CREATE TRIGGER trigger_teacher_institutes_updated_at
    BEFORE UPDATE ON teacher_institutes
    FOR EACH ROW EXECUTE FUNCTION update_teacher_institutes_updated_at();
