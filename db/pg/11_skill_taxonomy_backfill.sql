-- Backfill missing category and label metadata on the skills library.
--
-- Two separate gaps showed up as blank Category / Labels columns on the Skills
-- Library page:
--
--   1. Skills created by typing a new name in the profile "Add Skill" flow were
--      inserted with only code/name/description, so they had no category at all.
--      POST /api/employees/:id/skills now requires a category_id when it creates
--      a skill; this fixes the rows made before that.
--   2. db/02_seed.sql only tagged some of the skills it ships, so a number of
--      seeded skills had no labels either.
--
-- Category assignments use the categories that already exist (no new ones).
-- Idempotent: only fills blanks, safe to run repeatedly.

-- 1. Categories for skills that have none.
UPDATE skills s
SET category_id = c.id
FROM (VALUES
  ('React JS',              '1234'),  -- FrontEnd
  ('Next JS',               '1234'),
  ('Node JS',               '1234'),
  ('QA',                    'PM'),    -- Project & Leadership
  ('Analysis market cases', 'DATA')   -- Data Analytics
) AS m(skill_name, cat_code)
JOIN skill_categories c ON c.code = m.cat_code
WHERE s.name = m.skill_name
  AND s.category_id IS NULL;

-- 2. Labels for skills carrying none.
INSERT INTO skill_label_map (skill_id, label_id)
SELECT s.id, l.id
FROM (VALUES
  ('Analysis market cases',       'Data'),
  ('Data Analytics for Warranty', 'Data'),
  ('EV Safety Level 1',           'Safety'),
  ('EV Safety Level 1',           'EV'),
  ('Model-Based Development',     'Controls'),
  ('Model-Based Development',     'Simulation'),
  ('Powertrain NVH Basics',       'Simulation'),
  ('Powertrain NVH Basics',       'Foundation'),
  ('Project Management',          'Foundation'),
  ('Thermal Management',          'Simulation'),
  ('New Skill',                   'Battery'),
  ('React JS',                    'Foundation'),
  ('Next JS',                     'Foundation'),
  ('Node JS',                     'Foundation'),
  ('QA',                          'Foundation')
) AS m(skill_name, label_name)
JOIN skills s       ON s.name = m.skill_name
JOIN skill_labels l ON l.label_name = m.label_name
ON CONFLICT DO NOTHING;

-- Should both report 0.
-- SELECT count(*) FROM skills WHERE category_id IS NULL;
-- SELECT count(*) FROM skills s
--  WHERE NOT EXISTS (SELECT 1 FROM skill_label_map m WHERE m.skill_id = s.id);
