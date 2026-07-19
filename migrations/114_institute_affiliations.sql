CREATE TABLE institute_affiliations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    institute_id UUID NOT NULL REFERENCES teacher_institutes(id) ON DELETE CASCADE,
    teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    invited_by UUID NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','refused','removed','left')),
    is_main BOOLEAN NOT NULL DEFAULT false,
    responded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (institute_id, teacher_id)
);

CREATE INDEX idx_institute_affiliations_teacher ON institute_affiliations(teacher_id);
CREATE INDEX idx_institute_affiliations_institute ON institute_affiliations(institute_id, status);

CREATE UNIQUE INDEX idx_institute_affiliations_one_main 
    ON institute_affiliations(teacher_id) WHERE is_main = true AND status = 'accepted';
