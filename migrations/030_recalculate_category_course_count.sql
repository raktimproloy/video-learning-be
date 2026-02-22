-- Recalculate course_count to match incrementCourseCountForPath semantics:
-- Each category's count = direct courses (admin_category_id = id) + sum of descendants' counts.
-- We compute bottom-up: level 2 first, then level 1, then level 0.

UPDATE admin_categories SET course_count = 0;

-- Direct assignments per category
WITH direct AS (
  SELECT admin_category_id, COUNT(*)::int as cnt
  FROM courses
  WHERE admin_category_id IS NOT NULL
  GROUP BY admin_category_id
)
UPDATE admin_categories ac
SET course_count = COALESCE(d.cnt, 0)
FROM direct d
WHERE ac.id = d.admin_category_id;

-- Level 1: add children (level 2) counts
UPDATE admin_categories p
SET course_count = p.course_count + COALESCE(sub.s, 0)
FROM (
  SELECT parent_id, SUM(course_count)::int as s
  FROM admin_categories
  WHERE parent_id IS NOT NULL
  GROUP BY parent_id
) sub
WHERE p.id = sub.parent_id;

-- Level 0: add children (level 1) counts
UPDATE admin_categories p
SET course_count = p.course_count + COALESCE(sub.s, 0)
FROM (
  SELECT parent_id, SUM(course_count)::int as s
  FROM admin_categories
  WHERE parent_id IS NOT NULL
  GROUP BY parent_id
) sub
WHERE p.id = sub.parent_id;
