-- Seed initial admin_categories for Bangladeshi Academic and Skill-based tracks.
-- This file is idempotent and safe to run multiple times.

-- Helper CTE to upsert a root category and return its id
WITH upsert_root AS (
  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES
    (NULL, 'Academic (Bangladesh)', 'academic-bd', 'Bangladesh curriculum academic subjects (NCTB, board exams, admission).', 'active', 0, 0)
  ON CONFLICT (slug) WHERE parent_id IS NULL DO UPDATE
    SET description = EXCLUDED.description,
        status = EXCLUDED.status
  RETURNING id
),
root_skill AS (
  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES
    (NULL, 'Skill-based (Professional)', 'skill-based-bd', 'Practical skills for jobs, freelancing and career growth in Bangladesh.', 'active', 0, 1)
  ON CONFLICT (slug) WHERE parent_id IS NULL DO UPDATE
    SET description = EXCLUDED.description,
        status = EXCLUDED.status
  RETURNING id
)
SELECT 1;

-- Academic (Bangladesh) - level 1
DO $$
DECLARE
  v_root_academic UUID;
  v_root_skill UUID;
  v_existing RECORD;
BEGIN
  SELECT id INTO v_root_academic FROM admin_categories WHERE parent_id IS NULL AND slug = 'academic-bd';
  SELECT id INTO v_root_skill FROM admin_categories WHERE parent_id IS NULL AND slug = 'skill-based-bd';

  IF v_root_academic IS NULL OR v_root_skill IS NULL THEN
    RAISE NOTICE 'Root categories not found; skipping children seed.';
    RETURN;
  END IF;

  -- ===== Academic main branches =====
  -- 1) Primary (Class 1–5)
  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_academic, 'Primary (Class 1–5)', 'primary-1-5', 'NCTB primary level subjects for Bangladeshi students.', 'active', 1, 0)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  -- 2) Junior Secondary (Class 6–8)
  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_academic, 'Junior Secondary (Class 6–8)', 'junior-secondary-6-8', 'NCTB junior secondary level (Bangla & English version).', 'active', 1, 1)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  -- 3) Secondary – SSC (Class 9–10)
  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_academic, 'Secondary – SSC (Class 9–10)', 'secondary-ssc-9-10', 'SSC preparation for Bangladeshi boards (Science, Business, Humanities).', 'active', 1, 2)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  -- 4) Higher Secondary – HSC (Class 11–12)
  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_academic, 'Higher Secondary – HSC (Class 11–12)', 'higher-secondary-hsc-11-12', 'HSC preparation for Bangladeshi boards (Science, Business, Humanities).', 'active', 1, 3)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  -- 5) University Admission (Bangladesh)
  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_academic, 'University Admission (Bangladesh)', 'university-admission-bd', 'Public university, medical, engineering and other admission test preparation in Bangladesh.', 'active', 1, 4)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  -- 6) Madrasa Education
  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_academic, 'Madrasa Education', 'madrasa-education', 'Dakhil, Alim and other Madrasa curriculum based in Bangladesh.', 'active', 1, 5)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  -- ===== Academic – example level 2 under key branches =====
  -- Under Secondary – SSC (Class 9–10)
  SELECT * INTO v_existing FROM admin_categories WHERE parent_id = v_root_academic AND slug = 'secondary-ssc-9-10';
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'SSC Science (Bangladesh)', 'ssc-science-bd', 'Physics, Chemistry, Higher Math, Biology for SSC Science students.', 'active', 2, 0)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'SSC Business Studies (Bangladesh)', 'ssc-business-bd', 'Accounting, Finance, Business Entrepreneurship for SSC Business students.', 'active', 2, 1)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'SSC Humanities (Bangladesh)', 'ssc-humanities-bd', 'Bangla, English, Social Science and related subjects for Humanities.', 'active', 2, 2)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;
  END IF;

  -- Under Higher Secondary – HSC (Class 11–12)
  SELECT * INTO v_existing FROM admin_categories WHERE parent_id = v_root_academic AND slug = 'higher-secondary-hsc-11-12';
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'HSC Science (Bangladesh)', 'hsc-science-bd', 'HSC Physics, Chemistry, Higher Math, Biology for Bangladeshi students.', 'active', 2, 0)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'HSC Business Studies (Bangladesh)', 'hsc-business-bd', 'Accounting, Finance, Business, Management for HSC Business students.', 'active', 2, 1)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'HSC Humanities (Bangladesh)', 'hsc-humanities-bd', 'Bangla, English, Civics, Social Science for HSC Humanities.', 'active', 2, 2)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;
  END IF;

  -- Under University Admission (Bangladesh)
  SELECT * INTO v_existing FROM admin_categories WHERE parent_id = v_root_academic AND slug = 'university-admission-bd';
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Medical Admission (MBBS/BDS)', 'medical-admission-bd', 'Govt. & private medical admission exam preparation in Bangladesh.', 'active', 2, 0)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Engineering Admission (BUET, RUET, CUET, KUET)', 'engineering-admission-bd', 'Engineering university admission (BUET and other public engineering universities).', 'active', 2, 1)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Public University (General) Admission', 'public-university-admission-bd', 'General public university admission tests (A, B, C units).', 'active', 2, 2)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;
  END IF;

  -- ===== Skill-based (Professional) - level 1 popular tracks =====
  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_skill, 'Web & Software Development', 'web-software-dev', 'Full-stack, frontend, backend development skills for Bangladeshi job and freelance market.', 'active', 1, 0)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_skill, 'Graphic Design & UI/UX', 'graphic-design-uiux', 'Logo design, branding, UI/UX and marketplace-focused design skills.', 'active', 1, 1)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_skill, 'Digital Marketing & SEO', 'digital-marketing-seo', 'Facebook/Instagram marketing, Google Ads, SEO tailored for Bangladeshi businesses and freelancing.', 'active', 1, 2)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_skill, 'Freelancing & Marketplace Skills', 'freelancing-marketplace', 'Upwork, Fiverr, Freelancer.com profile building, gig strategy and client communication.', 'active', 1, 3)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_skill, 'Spoken English & Communication', 'spoken-english-communication', 'Spoken English, presentation, interview skills focused on Bangladeshi learners.', 'active', 1, 4)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
  VALUES (v_root_skill, 'Career Development & Jobs', 'career-development-jobs', 'CV writing, interview preparation, BCS & bank job related soft skills.', 'active', 1, 5)
  ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
    SET description = EXCLUDED.description, status = EXCLUDED.status;

  -- ===== Skill-based (Professional) - level 2 specific tracks =====
  -- Under Web & Software Development
  SELECT * INTO v_existing FROM admin_categories WHERE parent_id = v_root_skill AND slug = 'web-software-dev';
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Full-Stack Web Development (MERN/Next.js)', 'fullstack-web-mern-next', 'Practical MERN/Next.js full-stack development for local jobs and freelancing.', 'active', 2, 0)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Frontend Development (React/Next.js)', 'frontend-react-next', 'Modern frontend (React, Next.js, Tailwind) tailored for Bangladeshi market demand.', 'active', 2, 1)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Backend Development (Node.js/Express)', 'backend-node-express', 'API, database and backend skills using Node.js/Express and PostgreSQL/MySQL.', 'active', 2, 2)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Mobile App Development (Flutter/React Native)', 'mobile-app-flutter-react-native', 'Cross-platform mobile app development focused on practical Bangladeshi use cases.', 'active', 2, 3)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;
  END IF;

  -- Under Graphic Design & UI/UX
  SELECT * INTO v_existing FROM admin_categories WHERE parent_id = v_root_skill AND slug = 'graphic-design-uiux';
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Logo & Brand Identity Design', 'logo-brand-identity', 'Logo, brand identity and print design for local and international clients.', 'active', 2, 0)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'UI/UX Design for Web & Mobile', 'uiux-web-mobile', 'Figma-based UI/UX design for web apps, mobile apps and SaaS products.', 'active', 2, 1)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Social Media Post & Banner Design', 'social-media-design', 'Facebook, Instagram and marketplace-optimized banner/post design.', 'active', 2, 2)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;
  END IF;

  -- Under Digital Marketing & SEO
  SELECT * INTO v_existing FROM admin_categories WHERE parent_id = v_root_skill AND slug = 'digital-marketing-seo';
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Facebook & Instagram Ads (Bangladesh)', 'facebook-instagram-ads-bd', 'Paid campaign setup and optimization for Bangladeshi SME and e-commerce.', 'active', 2, 0)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'SEO for Local & International Clients', 'seo-local-global', 'On-page, off-page SEO and keyword research for local and foreign projects.', 'active', 2, 1)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'YouTube & Content Marketing', 'youtube-content-marketing', 'YouTube channel growth and content marketing strategies for Bangladesh.', 'active', 2, 2)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;
  END IF;

  -- Under Freelancing & Marketplace Skills
  SELECT * INTO v_existing FROM admin_categories WHERE parent_id = v_root_skill AND slug = 'freelancing-marketplace';
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Upwork Freelancing (Profile to First Job)', 'upwork-freelancing', 'Upwork profile, proposal writing and project delivery for Bangladeshi freelancers.', 'active', 2, 0)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Fiverr Gig & Client Management', 'fiverr-gigs', 'Fiverr gig research, optimization and client communication best practices.', 'active', 2, 1)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;
  END IF;

  -- Under Spoken English & Communication
  SELECT * INTO v_existing FROM admin_categories WHERE parent_id = v_root_skill AND slug = 'spoken-english-communication';
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Spoken English for Students', 'spoken-english-students', 'Everyday English speaking practice tailored for Bangladeshi school & college students.', 'active', 2, 0)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Spoken English for Jobs & Interviews', 'spoken-english-jobs', 'Job interview, office communication and presentation-focused spoken English.', 'active', 2, 1)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;
  END IF;

  -- Under Career Development & Jobs
  SELECT * INTO v_existing FROM admin_categories WHERE parent_id = v_root_skill AND slug = 'career-development-jobs';
  IF v_existing.id IS NOT NULL THEN
    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'Bank Job Preparation (Bangladesh)', 'bank-job-preparation-bd', 'MCQ and written preparation for Bangladeshi bank recruitment exams.', 'active', 2, 0)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;

    INSERT INTO admin_categories (parent_id, name, slug, description, status, level, display_order)
    VALUES (v_existing.id, 'BCS & Govt. Job Skills', 'bcs-govt-job-skills', 'BCS preliminary/written support skills and govt. job focused soft skills.', 'active', 2, 1)
    ON CONFLICT (parent_id, slug) WHERE parent_id IS NOT NULL DO UPDATE
      SET description = EXCLUDED.description, status = EXCLUDED.status;
  END IF;

END $$;

