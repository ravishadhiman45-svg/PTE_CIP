-- Backfill skill_level_definitions for skills that have none.
--
-- db/02_seed.sql applies the 1–5 rubric with a CROSS JOIN over `skills`, so it
-- only ever covered the skills that existed when it ran. Skills added later
-- through the app got no rubric, which left the Level Definition tab blank on
-- the skill detail page. POST /api/skills now inserts the ladder alongside the
-- skill; this catches the ones created before that fix.
--
-- Idempotent: safe to run repeatedly.

INSERT INTO skill_level_definitions (skill_id, level_no, level_title, level_definition)
SELECT s.id, v.level_no, v.level_title, v.level_definition
FROM skills s
CROSS JOIN (VALUES
(1,'Awareness','Understands basic terminology, purpose and safety precautions.'),
(2,'Working Knowledge','Can explain concepts and perform simple tasks with guidance.'),
(3,'Practitioner','Can apply the skill independently in regular projects.'),
(4,'Advanced Practitioner','Can solve complex issues, guide others and validate outputs.'),
(5,'Expert / SME','Can define standards, mentor others, create training and approve capability.')
) AS v(level_no, level_title, level_definition)
ON CONFLICT (skill_id, level_no) DO NOTHING;

-- Every skill should now report 5.
-- SELECT s.name, count(d.id) AS levels
--   FROM skills s
--   LEFT JOIN skill_level_definitions d ON d.skill_id = s.id
--  GROUP BY s.name HAVING count(d.id) <> 5;
