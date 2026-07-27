DO $$
DECLARE constraint_name text;
BEGIN
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'exams'::regclass AND contype = 'c' AND pg_get_constraintdef(oid) LIKE '%status%';
    
    IF constraint_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE exams DROP CONSTRAINT ' || constraint_name;
    END IF;
END $$;
ALTER TABLE exams ADD CONSTRAINT exams_status_check CHECK (status IN ('draft', 'published', 'inactive'));
